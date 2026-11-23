// The one way from an adapter to a client (design note, section 2). It
// keeps the time and checks the answer, so neither can be left out.

import {
  MODEL_CALL_TIMEOUT_CEILING_MS,
  MODEL_HEALTH_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_CEILING,
} from "@polyglot-sales-agent/core";
import { readOutput } from "./output.ts";
import {
  type AdapterAnswer,
  type Health,
  type LlmAdapter,
  type LlmClient,
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

function whole(value: unknown, ceiling: number): boolean {
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
    !count(answer.usage.outputTokens) ||
    typeof answer.model !== "string" ||
    answer.model === ""
  ) {
    throw new AdapterFault("returned no token counts or no model name");
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
      pending = start(controller.signal);
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
 * Makes a client of an adapter. Every call is bounded in time, and every
 * answer is checked against the structure before anything else sees it.
 */
export function bounded(adapter: LlmAdapter, timers: Timers = REAL_TIMERS): LlmClient {
  const client = {
    generate(request: LlmRequest): Promise<LlmResult> {
      // A caller's mistake, not the provider's: refused before any call.
      if (!whole(request.timeoutMs, MODEL_CALL_TIMEOUT_CEILING_MS)) {
        return Promise.reject(
          new RangeError(`timeoutMs is a whole number from 1 to ${MODEL_CALL_TIMEOUT_CEILING_MS}`),
        );
      }
      if (!whole(request.maxOutputTokens, MODEL_OUTPUT_TOKENS_CEILING)) {
        return Promise.reject(
          new RangeError(
            `maxOutputTokens is a whole number from 1 to ${MODEL_OUTPUT_TOKENS_CEILING}`,
          ),
        );
      }
      return within<AdapterAnswer, LlmResult>(
        timers,
        request.timeoutMs,
        (signal) => adapter.generate(request, signal),
        (answer) => resultOf(answer, request),
        { kind: "timeout" },
      );
    },
    health(): Promise<Health> {
      return within<Health, Health>(
        timers,
        MODEL_HEALTH_TIMEOUT_MS,
        (signal) => adapter.health(signal),
        (answer) =>
          answer.ok === true
            ? { ok: true }
            : {
                ok: false,
                failure: answer.failure === "timeout" ? "timeout" : "provider-error",
              },
        { ok: false, failure: "timeout" },
      );
    },
  };
  return client as unknown as LlmClient;
}
