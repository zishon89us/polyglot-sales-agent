// The one way from an adapter to a client (design note, section 2). It
// keeps the time and checks the answer, so neither can be left out.

import {
  MODEL_CALL_TIMEOUT_CEILING_MS,
  MODEL_HEALTH_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_CEILING,
  type ModelPrices,
  modelCostMicros,
  PROMPT_NAME,
  PROMPT_VERSION_MAX,
  PROMPTS_PER_REQUEST_MAX,
  TOOL_NAME,
  TRACE_MODEL_NAME,
  TRACE_MODEL_OTHER,
  TRACE_WRITE_TIMEOUT_MS,
} from "@polyglot-sales-agent/core";
import { keepable, readOutput } from "./output.ts";
import {
  type AdapterAnswer,
  type CallPlace,
  type Health,
  type LlmAdapter,
  type LlmRequest,
  type LlmResult,
  PROVIDER_ERROR_CODES,
  type PromptIdentity,
  type TokenUse,
  type TraceRecord,
  type TraceRecorder,
} from "./types.ts";

/** The timer `bounded` uses. A test gives one it moves by hand. */
export interface Timers {
  set(run: () => void, afterMs: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = {
  set: (run, afterMs) => setTimeout(run, afterMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The longest name of a model that is passed on. */
const MODEL_NAME_MAX = 200;

function whole(value: unknown, ceiling: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= ceiling;
}

function count(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** An adapter that broke its own contract: a fault in this repository's code, thrown to the caller. */
export class AdapterFault extends Error {
  constructor(what: string) {
    super(`the model adapter ${what}`);
    this.name = "AdapterFault";
  }
}

function usageOf(answer: { usage: TokenUse; model: string }): TokenUse {
  if (
    typeof answer.usage !== "object" ||
    answer.usage === null ||
    !count(answer.usage.inputTokens) ||
    !count(answer.usage.outputTokens)
  ) {
    throw new AdapterFault("returned no token counts");
  }
  // The name goes into results and, later, a trace: it is a name, not a place for text.
  if (
    typeof answer.model !== "string" ||
    answer.model === "" ||
    [...answer.model].length > MODEL_NAME_MAX ||
    !keepable(answer.model) ||
    answer.model.includes("\n")
  ) {
    throw new AdapterFault("returned no model name, or one that is not a name");
  }
  return { inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens };
}

function resultOf(
  answer: AdapterAnswer,
  offered: { readonly claimKinds: readonly string[]; readonly tools: readonly string[] },
): LlmResult {
  if (typeof answer !== "object" || answer === null) {
    throw new AdapterFault("returned nothing");
  }
  if (answer.kind === "provider-error") {
    if (!(PROVIDER_ERROR_CODES as readonly string[]).includes(answer.code)) {
      throw new AdapterFault("returned a failure with a code that is not in the list");
    }
    return { kind: "provider-error", code: answer.code };
  }
  if (answer.kind !== "answer") {
    throw new AdapterFault("returned something that is neither an answer nor a failure");
  }
  const usage = usageOf(answer);
  // Cut text is not an answer, whatever it happens to look like.
  if (answer.truncated !== false) {
    return { kind: "invalid-output", code: "truncated", usage, model: answer.model };
  }
  const read = readOutput(answer.value, offered);
  return read.ok
    ? { kind: "ok", output: read.output, usage, model: answer.model }
    : { kind: "invalid-output", code: read.code, usage, model: answer.model };
}

function healthOf(answer: Health): Health {
  if (typeof answer === "object" && answer !== null) {
    if (answer.ok === true) {
      return { ok: true };
    }
    if (
      answer.ok === false &&
      (answer.failure === "timeout" || answer.failure === "provider-error")
    ) {
      return { ok: false, failure: answer.failure };
    }
  }
  throw new AdapterFault("returned a health that is neither ok nor one of the two failures");
}

/** What is wrong with a request, as its caller made it: a caller's mistake, found before any call. */
function requestFault(request: LlmRequest): Error | undefined {
  if (typeof request !== "object" || request === null) {
    return new TypeError("a request is an object");
  }
  if (!whole(request.timeoutMs, MODEL_CALL_TIMEOUT_CEILING_MS)) {
    return new RangeError(`timeoutMs is a whole number from 1 to ${MODEL_CALL_TIMEOUT_CEILING_MS}`);
  }
  if (!whole(request.maxOutputTokens, MODEL_OUTPUT_TOKENS_CEILING)) {
    return new RangeError(
      `maxOutputTokens is a whole number from 1 to ${MODEL_OUTPUT_TOKENS_CEILING}`,
    );
  }
  if (
    typeof request.system !== "string" ||
    !Array.isArray(request.prompts) ||
    !Array.isArray(request.messages) ||
    !Array.isArray(request.tools) ||
    !request.tools.every(
      (tool: unknown) =>
        typeof tool === "object" &&
        tool !== null &&
        typeof (tool as { name: unknown }).name === "string",
    ) ||
    !Array.isArray(request.claimKinds) ||
    !request.claimKinds.every((kind: unknown) => typeof kind === "string")
  ) {
    return new TypeError(
      "a request has its system text, its prompts, its messages, its tools by name and its claim kinds",
    );
  }
  // What a trace stores of a request is checked here, before the call:
  // a record the table would refuse must not be found out after the
  // provider has been paid (design note M3 U6, T6).
  if (request.prompts.length < 1 || request.prompts.length > PROMPTS_PER_REQUEST_MAX) {
    return new RangeError(`a request names from 1 to ${PROMPTS_PER_REQUEST_MAX} prompts`);
  }
  for (const prompt of request.prompts as readonly unknown[]) {
    const { name, version } = (prompt ?? {}) as { name?: unknown; version?: unknown };
    if (
      typeof name !== "string" ||
      !PROMPT_NAME.test(name) ||
      !whole(version, PROMPT_VERSION_MAX)
    ) {
      return new TypeError("a prompt is named by its folder's name and a version");
    }
  }
  if (!request.tools.every((tool) => TOOL_NAME.test(tool.name))) {
    return new TypeError(
      "a tool's name is a small letter, then small letters, digits, _ or -, 64 at most",
    );
  }
  return undefined;
}

/** The most a trace's latency can say: the largest value its column holds. */
const LATENCY_MAX_MS = 2_147_483_647;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A copy of the place, or undefined if it is not one. */
function placeOf(place: CallPlace): CallPlace | undefined {
  if (typeof place !== "object" || place === null) {
    return undefined;
  }
  const { tenantId, sessionId, turnId, turnStartedAt } = place;
  if (
    ![tenantId, sessionId, turnId].every((id) => typeof id === "string" && UUID.test(id)) ||
    !(turnStartedAt instanceof Date) ||
    Number.isNaN(turnStartedAt.getTime())
  ) {
    return undefined;
  }
  return { tenantId, sessionId, turnId, turnStartedAt: new Date(turnStartedAt.getTime()) };
}

/** A call that left no record: its result is not handed on (design note M3 U6, T8). */
export class TraceNotStored extends Error {
  readonly code = "trace-not-stored";
  constructor(cause: unknown) {
    super("the trace of a model call could not be stored", { cause });
    this.name = "TraceNotStored";
  }
}

/** What a trace says of how a call ended. Nothing of the answer's text is read. */
function traced(
  result: LlmResult | undefined,
  prices: ModelPrices,
): Pick<
  TraceRecord,
  | "model"
  | "inputTokens"
  | "outputTokens"
  | "costMicros"
  | "priceInput"
  | "priceOutput"
  | "toolNames"
  | "outcome"
  | "outcomeCode"
> {
  const none = {
    model: null,
    inputTokens: null,
    outputTokens: null,
    costMicros: null,
    priceInput: null,
    priceOutput: null,
    toolNames: [],
  };
  if (result === undefined) {
    return { ...none, outcome: "fault", outcomeCode: null };
  }
  if (result.kind === "timeout") {
    return { ...none, outcome: "timeout", outcomeCode: null };
  }
  if (result.kind === "provider-error") {
    return { ...none, outcome: "provider-error", outcomeCode: result.code };
  }
  const known = TRACE_MODEL_NAME.test(result.model) && result.model !== TRACE_MODEL_OTHER;
  const price = known && Object.hasOwn(prices, result.model) ? prices[result.model] : undefined;
  const cost = price === undefined ? null : modelCostMicros(result.usage, price);
  return {
    model: known ? result.model : TRACE_MODEL_OTHER,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costMicros: cost,
    priceInput: cost === null || price === undefined ? null : price.input,
    priceOutput: cost === null || price === undefined ? null : price.output,
    toolNames: result.kind === "ok" ? result.output.toolCalls.map((call) => call.name) : [],
    outcome: result.kind,
    outcomeCode: result.kind === "invalid-output" ? result.code : null,
  };
}

/**
 * Runs `start` and gives up after `afterMs`. An answer or a rejection that
 * comes after that is dropped. A throw or a rejection in time is passed on.
 */
function within<Answer, Result>(
  timers: Timers,
  afterMs: number,
  start: (signal: AbortSignal) => Promise<Answer>,
  finish: (answer: Answer) => Result,
  late: Result,
  /** If given, running out of time rejects with this and does not resolve with `late`. */
  lateError?: () => Error,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const controller = new AbortController();
    let over = false;
    const handle = timers.set(() => {
      if (!over) {
        over = true;
        controller.abort();
        if (lateError === undefined) {
          resolve(late);
        } else {
          reject(lateError());
        }
      }
    }, afterMs);
    const settle = (act: () => void): void => {
      if (!over) {
        over = true;
        timers.clear(handle);
        act();
      }
    };
    let pending: Promise<Answer>;
    try {
      // An adapter that answers at once, with no promise, has still answered.
      pending = Promise.resolve(start(controller.signal));
    } catch (error) {
      settle(() => reject(error));
      return;
    }
    pending.then(
      (answer) =>
        settle(() => {
          try {
            resolve(finish(answer));
          } catch (error) {
            reject(error);
          }
        }),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/**
 * What the rest of the code calls a model through. Nothing else can be
 * one, and one cannot be changed:
 *
 * - it is a class with a private part, so an adapter, an object written by
 *   hand and a copy of a client with a method replaced are not clients;
 * - its two calls are its own, read-only, and it is frozen, as is the
 *   class's prototype, so neither call can be replaced in place.
 *
 * Only `bounded` makes one. Whatever is added around a call later, the
 * trace of M3 unit U6 for one, is added in this file.
 */
export interface BoundedOptions {
  /** Stores the trace of each call. A client cannot be built without one. */
  readonly record: TraceRecorder;
  /** Prices by the model's exact name. A model with none has no cost. */
  readonly prices?: ModelPrices;
  readonly timers?: Timers;
  /** The clock latency is measured by. */
  readonly now?: () => Date;
}

export class LlmClient {
  readonly #adapter: LlmAdapter;
  readonly #timers: Timers;
  readonly #record: TraceRecorder;
  readonly #prices: ModelPrices;
  readonly #now: () => Date;

  /**
   * One attempt, bounded in time, its answer checked against the
   * structure, and its trace stored before the result is handed on. Not
   * to be called inside an open tenant transaction: the trace is stored
   * on a connection of its own, and the session must be committed.
   */
  readonly generate: (request: LlmRequest, place: CallPlace) => Promise<LlmResult>;
  /** Whether the provider can be reached. Bounded like a call. */
  readonly health: () => Promise<Health>;

  private constructor(adapter: LlmAdapter, options: BoundedOptions) {
    if (typeof options?.record !== "function") {
      throw new TypeError("a client is built with a recorder of traces");
    }
    this.#adapter = adapter;
    this.#timers = options.timers ?? REAL_TIMERS;
    this.#record = options.record;
    this.#prices = options.prices ?? {};
    this.#now = options.now ?? (() => new Date());
    /** Stores a trace, within its own time limit. */
    const store = (record: TraceRecord): Promise<void> =>
      within<void, void>(
        this.#timers,
        TRACE_WRITE_TIMEOUT_MS,
        () => this.#record(record),
        () => undefined,
        undefined,
        () => new Error("storing the trace took too long"),
      );
    this.generate = async (request, place) => {
      let fault: Error | undefined;
      let prompts: PromptIdentity[] = [];
      let timeoutMs = 0;
      let offered: { claimKinds: string[]; tools: string[] } = { claimKinds: [], tools: [] };
      try {
        fault = requestFault(request);
        if (fault === undefined) {
          // Read here and not again: what was checked is what is used, and
          // what the caller does to its request while the call waits changes
          // nothing of how the answer is checked.
          timeoutMs = request.timeoutMs;
          offered = {
            claimKinds: [...request.claimKinds],
            tools: request.tools.map((tool) => tool.name),
          };
          prompts = request.prompts.map(({ name, version }) => ({ name, version }));
        }
      } catch (error) {
        return Promise.reject(error);
      }
      if (fault !== undefined || !whole(timeoutMs, MODEL_CALL_TIMEOUT_CEILING_MS)) {
        return Promise.reject(fault ?? new RangeError("timeoutMs changed while it was read"));
      }
      // Read twice, the request's own names may have changed between the
      // check and the copy; what is stored is what is checked here.
      if (
        !prompts.every(
          ({ name, version }) => PROMPT_NAME.test(name) && whole(version, PROMPT_VERSION_MAX),
        ) ||
        !offered.tools.every((name) => TOOL_NAME.test(name))
      ) {
        throw new TypeError("the request changed while it was read");
      }
      const where = placeOf(place);
      if (where === undefined) {
        throw new TypeError(
          "a call is made for a tenant, a session and a turn, each a UUID, and the time the turn began",
        );
      }
      const startedAt = this.#now();
      if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
        // Found before the call: a trace with no time could not be stored.
        throw new TypeError("the client's clock gave no time");
      }
      let result: LlmResult | undefined;
      let thrown: { readonly error: unknown } | undefined;
      try {
        result = await within<AdapterAnswer, LlmResult>(
          this.#timers,
          timeoutMs,
          (signal) => this.#adapter.generate(request, signal),
          (answer) => resultOf(answer, offered),
          { kind: "timeout" },
        );
      } catch (error) {
        thrown = { error };
      }
      const elapsed = this.#now().getTime() - startedAt.getTime();
      const record: TraceRecord = {
        ...where,
        startedAt,
        // 0 if the clock went back; never more than the column holds.
        latencyMs:
          Number.isFinite(elapsed) && elapsed > 0
            ? Math.min(Math.round(elapsed), LATENCY_MAX_MS)
            : 0,
        prompts,
        ...traced(result, this.#prices),
      };
      try {
        await store(record);
      } catch (error) {
        if (thrown === undefined) {
          // A reply made from a call that left no record is not sent.
          throw new TraceNotStored(error);
        }
        // The first fault is the one to see.
      }
      if (thrown !== undefined || result === undefined) {
        throw thrown?.error;
      }
      return result;
    };
    this.health = () =>
      within<Health, Health>(
        this.#timers,
        MODEL_HEALTH_TIMEOUT_MS,
        (signal) => this.#adapter.health(signal),
        healthOf,
        { ok: false, failure: "timeout" },
      );
    Object.freeze(this);
  }

  /** @internal Use `bounded`. */
  static around(adapter: LlmAdapter, options: BoundedOptions): LlmClient {
    return new LlmClient(adapter, options);
  }
}
Object.freeze(LlmClient.prototype);

/**
 * Makes a client of an adapter. Every call is bounded in time, and every
 * answer is checked against the structure before anything else sees it.
 */
export function bounded(adapter: LlmAdapter, options: BoundedOptions): LlmClient {
  return LlmClient.around(adapter, options);
}
