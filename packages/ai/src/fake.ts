// The scripted adapter (ADR 0005; design note, section 5). A test states
// what each call returns. Used through `bounded`, like any adapter, it is
// the only model in unit, integration and end-to-end tests. No clock and
// no randomness: the same script gives the same results.

import type {
  AdapterAnswer,
  Health,
  LlmAdapter,
  LlmRequest,
  ProviderErrorCode,
  ProviderFailure,
  TokenUse,
} from "./types.ts";

/** What one call returns. */
export type FakeStep =
  /** Any value, for the client to check: a valid output, or whatever malformed thing a test states. */
  | { readonly kind: "answer"; readonly value: unknown; readonly usage?: TokenUse }
  /** An answer the provider cut at the output limit. */
  | { readonly kind: "truncated"; readonly value?: unknown; readonly usage?: TokenUse }
  | { readonly kind: "provider-error"; readonly code: ProviderErrorCode }
  /** Nothing until the call is told to stop; then an answer, or a rejection. */
  | { readonly kind: "hang"; readonly then?: "answer" | "reject" }
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
  /** Every request made, in order: what the model was given. */
  readonly calls: LlmRequest[] = [];
  healthCalls = 0;
  readonly #script: FakeStep[];
  readonly #health: FakeHealthStep[];

  constructor(script: readonly FakeStep[], health: readonly FakeHealthStep[] = []) {
    this.#script = [...script];
    this.#health = [...health];
  }

  /** How many steps no call has taken. A test asserts 0 at its end. */
  remaining(): number {
    return this.#script.length;
  }

  async generate(request: LlmRequest, signal: AbortSignal): Promise<AdapterAnswer> {
    this.calls.push(request);
    const step = this.#script.shift();
    if (step === undefined) {
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
        if (step.then === "reject") {
          throw new Error("the scripted model was stopped");
        }
        return { kind: "provider-error", code: "other" };
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
