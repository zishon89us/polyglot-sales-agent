// The one way from an adapter to a client (design note, section 2). It
// keeps the time and checks the answer, so neither can be left out.

import {
  MODEL_CALL_TIMEOUT_CEILING_MS,
  MODEL_HEALTH_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_CEILING,
} from "@polyglot-sales-agent/core";
import { keepable, readOutput } from "./output.ts";
import {
  type AdapterAnswer,
  type Health,
  type LlmAdapter,
  type LlmRequest,
  type LlmResult,
  PROVIDER_ERROR_CODES,
  type TokenUse,
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

function resultOf(answer: AdapterAnswer, request: LlmRequest): LlmResult {
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
  const read = readOutput(answer.value, {
    claimKinds: request.claimKinds,
    tools: request.tools.map((tool) => tool.name),
  });
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
  return undefined;
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
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const controller = new AbortController();
    let over = false;
    const handle = timers.set(() => {
      if (!over) {
        over = true;
        controller.abort();
        resolve(late);
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
 * What the rest of the code calls a model through. It is a class with a
 * private part so that nothing else can be one: not an adapter, not an
 * object written by hand, and not a copy of a client with a method
 * replaced (a copy by `{...client}` has none of its methods). Only
 * `bounded` makes one. Whatever is added around a call later, the trace
 * of M3 unit U6 for one, is added in this file.
 */
export class LlmClient {
  readonly #adapter: LlmAdapter;
  readonly #timers: Timers;

  private constructor(adapter: LlmAdapter, timers: Timers) {
    this.#adapter = adapter;
    this.#timers = timers;
  }

  /** @internal Use `bounded`. */
  static around(adapter: LlmAdapter, timers: Timers): LlmClient {
    return new LlmClient(adapter, timers);
  }

  /** One attempt, bounded in time, its answer checked against the structure. */
  generate(request: LlmRequest): Promise<LlmResult> {
    let fault: Error | undefined;
    let timeoutMs = 0;
    try {
      fault = requestFault(request);
      // Read once: what was checked is what is used.
      timeoutMs = fault === undefined ? request.timeoutMs : 0;
    } catch (error) {
      return Promise.reject(error);
    }
    if (fault !== undefined || !whole(timeoutMs, MODEL_CALL_TIMEOUT_CEILING_MS)) {
      return Promise.reject(fault ?? new RangeError("timeoutMs changed while it was read"));
    }
    return within<AdapterAnswer, LlmResult>(
      this.#timers,
      timeoutMs,
      (signal) => this.#adapter.generate(request, signal),
      (answer) => resultOf(answer, request),
      { kind: "timeout" },
    );
  }

  /** Whether the provider can be reached. Bounded like a call. */
  health(): Promise<Health> {
    return within<Health, Health>(
      this.#timers,
      MODEL_HEALTH_TIMEOUT_MS,
      (signal) => this.#adapter.health(signal),
      healthOf,
      { ok: false, failure: "timeout" },
    );
  }
}

/**
 * Makes a client of an adapter. Every call is bounded in time, and every
 * answer is checked against the structure before anything else sees it.
 */
export function bounded(adapter: LlmAdapter, timers: Timers = REAL_TIMERS): LlmClient {
  return LlmClient.around(adapter, timers);
}
