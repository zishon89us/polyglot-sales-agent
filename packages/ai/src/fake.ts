// The scripted adapter (ADR 0005; design note, section 5). A test states
// what each call returns. Used through `bounded`, like any adapter, it is
// the only model in unit, integration and end-to-end tests. No clock and
// no randomness: the same script gives the same results.

import type {
  AdapterAnswer,
  CallPlace,
  Health,
  LlmAdapter,
  LlmRequest,
  ProviderErrorCode,
  ProviderFailure,
  TokenUse,
  TraceRecord,
  TraceRecorder,
} from "./types.ts";

/** What one call returns. */
export type FakeStep =
  /** Any value, for the client to check: a valid output, or whatever malformed thing a test states. */
  | { readonly kind: "answer"; readonly value: unknown; readonly usage?: TokenUse }
  /** An answer the provider cut at the output limit. */
  | { readonly kind: "truncated"; readonly value?: unknown; readonly usage?: TokenUse }
  | { readonly kind: "provider-error"; readonly code: ProviderErrorCode }
  /** Nothing until the call is told to stop; then a late answer (the default), or a late rejection. */
  | { readonly kind: "hang"; readonly then?: "answer" | "reject"; readonly value?: unknown }
  /** A fault in the adapter's own code. */
  | { readonly kind: "throw"; readonly error?: Error };

export type FakeHealthStep =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly failure: ProviderFailure }
  | { readonly kind: "hang" }
  | { readonly kind: "throw"; readonly error?: Error };

/** A call the script has no step for. Thrown, so that the test which did not expect the call fails. */
export class FakeScriptOver extends Error {
  constructor(what: string) {
    super(`the scripted model was asked for ${what} and its script has no step left`);
    this.name = "FakeScriptOver";
  }
}

export const FAKE_MODEL = "scripted";
const NO_USE: TokenUse = { inputTokens: 0, outputTokens: 0 };

function stopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });
}

export class FakeLlmAdapter implements LlmAdapter {
  /** A copy of every request made, in order: what the model was given, as it was at the call. */
  readonly calls: LlmRequest[] = [];
  healthCalls = 0;
  /** How many calls the script had no step for. */
  overran = 0;
  /** How each call that was made to hang has since ended, after it was told to stop. */
  readonly endedLate: ("answer" | "reject")[] = [];
  readonly #script: FakeStep[];
  readonly #health: FakeHealthStep[];

  constructor(script: readonly FakeStep[], health: readonly FakeHealthStep[] = []) {
    this.#script = [...script];
    this.#health = [...health];
  }

  /** How many steps no call has taken. */
  remaining(): number {
    return this.#script.length;
  }

  /** How many scripted answers about health no call has taken. An unscripted one is answered ok. */
  healthRemaining(): number {
    return this.#health.length;
  }

  /**
   * Fails unless the script was used exactly: every step taken, and no call
   * beyond it. A test ends with this. `remaining()` alone cannot tell a
   * script used up from one that was overrun and the error swallowed.
   */
  assertDone(): void {
    if (this.#script.length > 0 || this.#health.length > 0 || this.overran > 0) {
      throw new Error(
        `the scripted model: ${this.#script.length} steps and ${this.#health.length} health steps were not used, and ${this.overran} calls had no step`,
      );
    }
  }

  async generate(request: LlmRequest, signal: AbortSignal): Promise<AdapterAnswer> {
    // A copy: what the caller does to its request afterwards is not what was asked.
    let asked: LlmRequest;
    try {
      // A copy of plain data: it has no class, and it cannot hold a function.
      asked = structuredClone(request);
    } catch {
      throw new Error(
        "the scripted model was given a request that is not plain data and cannot be kept",
      );
    }
    this.calls.push(asked);
    const step = this.#script.shift();
    if (step === undefined) {
      this.overran += 1;
      throw new FakeScriptOver(`call ${this.calls.length}`);
    }
    switch (step.kind) {
      case "answer":
        return {
          kind: "answer",
          value: step.value,
          truncated: false,
          usage: step.usage ?? NO_USE,
          model: FAKE_MODEL,
        };
      case "truncated":
        return {
          kind: "answer",
          value: step.value,
          truncated: true,
          usage: step.usage ?? NO_USE,
          model: FAKE_MODEL,
        };
      case "provider-error":
        return { kind: "provider-error", code: step.code };
      case "hang":
        await stopped(signal);
        this.endedLate.push(step.then === "reject" ? "reject" : "answer");
        if (step.then === "reject") {
          throw new Error("the scripted model was stopped");
        }
        return {
          kind: "answer",
          value: step.value,
          truncated: false,
          usage: NO_USE,
          model: FAKE_MODEL,
        };
      case "throw":
        throw step.error ?? new Error("the scripted model threw");
    }
  }

  async health(signal: AbortSignal): Promise<Health> {
    this.healthCalls += 1;
    const step = this.#health.shift();
    if (step === undefined || step.kind === "ok") {
      return { ok: true };
    }
    switch (step.kind) {
      case "failed":
        return { ok: false, failure: step.failure };
      case "hang":
        await stopped(signal);
        return { ok: false, failure: "provider-error" };
      case "throw":
        throw step.error ?? new Error("the scripted model threw");
    }
  }
}

/** A recorder for tests: it keeps each trace in a list. */
export function keptTraces(): { readonly record: TraceRecorder; readonly traces: TraceRecord[] } {
  const traces: TraceRecord[] = [];
  return {
    traces,
    record: async (trace) => {
      traces.push(trace);
    },
  };
}

/** A place for tests: made-up identifiers, the same every time. */
export const FAKE_PLACE: CallPlace = Object.freeze({
  tenantId: "00000000-0000-4000-8000-00000000000a",
  sessionId: "00000000-0000-4000-8000-00000000000b",
  turnId: "00000000-0000-4000-8000-00000000000c",
  turnStartedAt: new Date(0),
});
