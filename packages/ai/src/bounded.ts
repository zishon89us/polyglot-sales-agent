// The one way from an adapter to a client (design note, section 2). It
// keeps the time and checks the answer, so neither can be left out.

import { randomBytes } from "node:crypto";
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
  type LlmMessage,
  type LlmRequest,
  type LlmResult,
  PROVIDER_ERROR_CODES,
  type PromptIdentity,
  type TokenUse,
  type ToolCall,
  type ToolOffer,
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

/** Whether a value is what JSON carries and nothing else: no date, map, function or other object. */
function plainData(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || depth > 32) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item) => plainData(item, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item) => plainData(item, depth + 1))
  );
}

/** A mark is 32 hexadecimal characters, drawn for one call. */
const MARK = /^[0-9a-f]{32}$/;
/** How many marks are drawn before the source is taken to be broken. */
const MARK_DRAWS = 8;

/** The two lines a text is put between (design note M3 U7, section 5). */
export function markText(text: string, mark: string): string {
  return `[[data:${mark}]]\n${text}\n[[end:${mark}]]`;
}

/**
 * A copy of the request for the adapter in which every message's text is
 * marked as data, the assistant's earlier replies included: only the
 * system text is instruction. Nothing is removed from any text: a mark
 * that some text already holds is thrown away and another is drawn.
 */
function markedCopy(
  request: Pick<LlmRequest, "messages" | "maxOutputTokens" | "timeoutMs">,
  /** Read once, by the caller: what the answer is checked against is what is sent. */
  read: {
    readonly system: string;
    readonly prompts: readonly PromptIdentity[];
    readonly tools: readonly ToolOffer[];
    readonly claimKinds: readonly string[];
  },
  draw: () => string,
): LlmRequest {
  const messages: LlmMessage[] = [];
  const texts: string[] = [];
  for (const given of [...request.messages] as readonly unknown[]) {
    const message = (given ?? {}) as Record<string, unknown>;
    const { role, text, toolCallId, toolCalls } = message;
    if (role === "tool-calls" && Array.isArray(toolCalls)) {
      // Structure, not text: a name and arguments, as the model wrote them.
      const calls = structuredClone(toolCalls) as ToolCall[];
      texts.push(JSON.stringify(calls));
      messages.push({ role, toolCalls: calls });
    } else if (
      role === "tool-result" &&
      typeof text === "string" &&
      typeof toolCallId === "string"
    ) {
      texts.push(text, toolCallId);
      messages.push({ role, toolCallId, text });
    } else if (
      (role === "data" || role === "customer" || role === "assistant") &&
      typeof text === "string"
    ) {
      texts.push(text);
      messages.push({ role, text });
    } else {
      throw new TypeError("a message is a text of a known kind, or the calls an answer made");
    }
  }
  let mark = "";
  for (let draws = 0; ; draws += 1) {
    if (draws >= MARK_DRAWS) {
      throw new Error("no mark for the request's data could be drawn");
    }
    const drawn = draw();
    if (
      typeof drawn === "string" &&
      MARK.test(drawn) &&
      !texts.some((text) => text.includes(drawn))
    ) {
      mark = drawn;
      break;
    }
  }
  return {
    system: read.system,
    prompts: read.prompts.map(({ name, version }) => ({ name, version })),
    messages: messages.map((message) =>
      "text" in message ? { ...message, text: markText(message.text, mark) } : message,
    ),
    tools: read.tools,
    claimKinds: [...read.claimKinds],
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutMs,
  };
}

/** The last millisecond of the year 9999. */
const TIME_MAX_MS = 253_402_300_799_999;

/**
 * A copy of a time a trace can store, a date from 1970 to 9999, or
 * undefined. A date outside what the database holds would be found out
 * only after the call was paid for. The time is read once, by the
 * built-in reading and not the object's own, and what is kept is a plain
 * date of that reading: nothing done to the original afterwards, and no
 * object that only says it is a date, changes it.
 */
function storable(time: unknown): Date | undefined {
  if (!(time instanceof Date)) {
    return undefined;
  }
  let ms: number;
  try {
    ms = Date.prototype.getTime.call(time);
  } catch {
    return undefined;
  }
  return !Number.isNaN(ms) && ms >= 0 && ms <= TIME_MAX_MS ? new Date(ms) : undefined;
}

/** A copy of the price list that nothing outside can change, or an error if an entry is not a price. */
function pricesOf(given_: ModelPrices | undefined): ModelPrices {
  const copy: Record<string, { input: number; output: number }> = Object.create(null);
  for (const [name, given] of Object.entries(given_ ?? {})) {
    // Each number is read once: what is checked is what is kept.
    const price =
      typeof given === "object" && given !== null
        ? Object.freeze({ input: given.input, output: given.output })
        : undefined;
    if (
      price === undefined ||
      modelCostMicros({ inputTokens: 0, outputTokens: 0 }, price) === null
    ) {
      throw new TypeError("a model's price is two whole numbers within the limits");
    }
    copy[name] = price;
  }
  return Object.freeze(copy);
}

/** A copy of the place, or undefined if it is not one. */
function placeOf(place: CallPlace): CallPlace | undefined {
  if (typeof place !== "object" || place === null) {
    return undefined;
  }
  const { tenantId, sessionId, turnId } = place;
  const turnStartedAt = storable(place.turnStartedAt);
  if (
    ![tenantId, sessionId, turnId].every((id) => typeof id === "string" && UUID.test(id)) ||
    turnStartedAt === undefined
  ) {
    return undefined;
  }
  return { tenantId, sessionId, turnId, turnStartedAt };
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
  /** The source of the marks data is put between: 32 hexadecimal characters each time. For tests. */
  readonly mark?: () => string;
}

export class LlmClient {
  readonly #adapter: LlmAdapter;
  readonly #timers: Timers;
  readonly #record: TraceRecorder;
  readonly #prices: ModelPrices;
  readonly #now: () => Date;
  readonly #mark: () => string;

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
    this.#prices = pricesOf(options.prices);
    this.#now = options.now ?? (() => new Date());
    this.#mark = options.mark ?? (() => randomBytes(16).toString("hex"));
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
      let system = "";
      let tools: ToolOffer[] = [];
      let timeoutMs = 0;
      let maxOutputTokens = 0;
      let offered: { claimKinds: string[]; tools: string[] } = { claimKinds: [], tools: [] };
      try {
        fault = requestFault(request);
        if (fault === undefined) {
          // Read here and not again: what was checked is what is used, and
          // what the caller does to its request while the call waits changes
          // nothing of how the answer is checked.
          timeoutMs = request.timeoutMs;
          system = request.system;
          // A copy all the way down: a schema the caller changes during the
          // call is not the one that was sent.
          tools = structuredClone([...request.tools]) as ToolOffer[];
          maxOutputTokens = request.maxOutputTokens;
          offered = {
            claimKinds: [...request.claimKinds],
            tools: tools.map((tool) => tool.name),
          };
          prompts = [...request.prompts].map(({ name, version }) => ({ name, version }));
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
        prompts.length < 1 ||
        prompts.length > PROMPTS_PER_REQUEST_MAX ||
        !prompts.every(
          ({ name, version }) =>
            typeof name === "string" &&
            PROMPT_NAME.test(name) &&
            whole(version, PROMPT_VERSION_MAX),
        ) ||
        !offered.tools.every((name) => typeof name === "string" && TOOL_NAME.test(name))
      ) {
        throw new TypeError("the request changed while it was read");
      }
      const where = placeOf(place);
      if (where === undefined) {
        throw new TypeError(
          "a call is made for a tenant, a session and a turn, each a UUID, and the time the turn began",
        );
      }
      // Built before the clock is read and the adapter called: a request
      // that cannot be marked is refused, and nothing is paid for.
      // The copies are what is sent, so the copies are what is checked.
      if (
        typeof system !== "string" ||
        !whole(maxOutputTokens, MODEL_OUTPUT_TOKENS_CEILING) ||
        !offered.claimKinds.every((kind) => typeof kind === "string") ||
        !tools.every(
          (tool) =>
            typeof tool?.name === "string" &&
            typeof tool.description === "string" &&
            plainData(tool.argumentsSchema) &&
            typeof tool.argumentsSchema === "object" &&
            tool.argumentsSchema !== null &&
            !Array.isArray(tool.argumentsSchema),
        )
      ) {
        throw new TypeError(
          "a request's limits are whole numbers, its claim kinds texts, and its tools plain data",
        );
      }
      const sent = markedCopy(
        { messages: request.messages, maxOutputTokens, timeoutMs },
        { system, prompts, tools, claimKinds: offered.claimKinds },
        this.#mark,
      );
      const startedAt = storable(this.#now());
      if (startedAt === undefined) {
        // Found before the call: a trace with no time could not be stored.
        throw new TypeError("the client's clock gave no time a trace can store");
      }
      let result: LlmResult | undefined;
      let thrown: { readonly error: unknown } | undefined;
      try {
        result = await within<AdapterAnswer, LlmResult>(
          this.#timers,
          timeoutMs,
          (signal) => this.#adapter.generate(sent, signal),
          (answer) => resultOf(answer, offered),
          { kind: "timeout" },
        );
      } catch (error) {
        thrown = { error };
      }
      let elapsed = 0;
      try {
        elapsed = Date.prototype.getTime.call(this.#now()) - startedAt.getTime();
      } catch {
        // A clock that fails now must not lose a call that was paid for: no latency is known.
      }
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
