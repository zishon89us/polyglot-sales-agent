// The model client in this project's own types (ADR 0005; design note
// docs/design/notes/m3-u4-llm-client.md, sections 2 and 3). No provider's
// type appears here or anywhere outside an adapter.

import type { ModelFlag, TraceOutcome } from "@polyglot-sales-agent/core";

/** A prompt a request's system text was assembled from. Written to the trace. */
export interface PromptIdentity {
  readonly name: string;
  readonly version: number;
}

/**
 * One message of a request. `data` is what code gives the model: the
 * business's profile, facts of the turn. **No message is instruction;**
 * only the system text is. An assistant's earlier reply can repeat a
 * customer's words, so it is information like the rest. The client marks
 * every text before an adapter sees it (design note M3 U7, section 5).
 *
 * `tool-calls` is what an earlier answer of the same turn asked for; the
 * `tool-result` messages that follow it answer its calls, by identifier.
 */
export type LlmMessage =
  | { readonly role: "data"; readonly text: string }
  | { readonly role: "customer"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string }
  | { readonly role: "tool-calls"; readonly toolCalls: readonly ToolCall[] }
  | { readonly role: "tool-result"; readonly toolCallId: string; readonly text: string };

/** A tool as the model is told of it. Its arguments are checked where it is run. */
export interface ToolOffer {
  readonly name: string;
  readonly description: string;
  /** A JSON Schema for the arguments, passed to the provider as it is. */
  readonly argumentsSchema: Readonly<Record<string, unknown>>;
}

/**
 * One call. Nothing here is named for a contact: no phone number and no
 * person's name has a field (NFR-V7).
 */
export interface LlmRequest {
  readonly system: string;
  readonly prompts: readonly PromptIdentity[];
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly ToolOffer[];
  /** The claim kinds this tenant's answers may use: the core's and its pack's. */
  readonly claimKinds: readonly string[];
  /** Required: a call with no bound on its output is not made. */
  readonly maxOutputTokens: number;
  /** Required: a call with no bound on its wait is not made. */
  readonly timeoutMs: number;
}

export interface Claim {
  readonly kind: string;
  /** What the claim is about: an item the model was given. */
  readonly item: string;
  /** The value as the reply states it. */
  readonly value: string;
}

/** Plain data: what JSON can carry. */
export type Plain =
  | null
  | boolean
  | number
  | string
  | readonly Plain[]
  | { readonly [key: string]: Plain };

export interface ToolCall {
  /** Pairs a result with its call inside one reply's loop. Used for nothing else. */
  readonly id: string;
  readonly name: string;
  readonly arguments: { readonly [key: string]: Plain };
}

/** What a model answers, checked. An answer asks for tools or it replies, not both. */
export interface LlmOutput {
  readonly reply: string;
  readonly claims: readonly Claim[];
  readonly flags: readonly ModelFlag[];
  readonly toolCalls: readonly ToolCall[];
  /**
   * The language the customer wrote in, as the model says: two small
   * letters, or `und`. The model's word, not a fact.
   */
  readonly language: string;
}

export interface TokenUse {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Why an answer was not accepted. Never the answer's text. */
export const INVALID_OUTPUT_CODES = ["shape", "flag", "claim", "tool-call", "truncated"] as const;
export type InvalidOutputCode = (typeof INVALID_OUTPUT_CODES)[number];

/** How a provider failed. Never the provider's message. Which are tried again is the caller's rule. */
export const PROVIDER_ERROR_CODES = [
  "unavailable",
  "rate-limited",
  "refused",
  "bad-request",
  "not-authorised",
  "other",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/**
 * The result of one call. Only `timeout` and `provider-error` are the
 * provider's failing (state machines, section 8); `invalid-output` is a
 * failed output check (guardrail policy, O1).
 */
export type LlmResult =
  | {
      readonly kind: "ok";
      readonly output: LlmOutput;
      readonly usage: TokenUse;
      readonly model: string;
    }
  | {
      readonly kind: "invalid-output";
      readonly code: InvalidOutputCode;
      readonly usage: TokenUse;
      readonly model: string;
    }
  | { readonly kind: "timeout" }
  | { readonly kind: "provider-error"; readonly code: ProviderErrorCode };

export type ProviderFailure = "timeout" | "provider-error";
export type Health =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ProviderFailure };

/** What an adapter returns: what its provider said, unchecked, or how the provider failed. */
export type AdapterAnswer =
  | {
      readonly kind: "answer";
      /** As the provider gave it, parsed and not checked. */
      readonly value: unknown;
      /** The provider stopped because the output limit was reached. */
      readonly truncated: boolean;
      readonly usage: TokenUse;
      readonly model: string;
    }
  | { readonly kind: "provider-error"; readonly code: ProviderErrorCode };

/**
 * What a provider's adapter implements. One attempt, no retry. It turns
 * its provider's errors into `provider-error`; anything it throws is a
 * fault in this repository's code and is thrown on to the caller.
 */
export interface LlmAdapter {
  generate(request: LlmRequest, signal: AbortSignal): Promise<AdapterAnswer>;
  health(signal: AbortSignal): Promise<Health>;
}

/**
 * Where a call belongs: whose it is, the session it is for, and the turn
 * that makes it. A turn's identifier is made each time its job's handler
 * runs. (M3 unit U6; design note docs/design/notes/m3-u6-traces.md.)
 */
export interface CallPlace {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnId: string;
  /** When the turn began. */
  readonly turnStartedAt: Date;
}

/**
 * The record of one call. It has no field for free text: every text in it
 * is an identifier, a name from this repository's own lists, or the
 * model's name. The request, the reply, the claims, a tool's arguments and
 * a provider's message are never put in one.
 */
export interface TraceRecord extends CallPlace {
  /** When the adapter was called. */
  readonly startedAt: Date;
  /** Until it answered, failed, or the limit ran out. */
  readonly latencyMs: number;
  readonly prompts: readonly PromptIdentity[];
  /** Null when the call gave no answer. `other` for a name the table would not take. */
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Millionths of a US dollar; null when unknown, which is not nothing. */
  readonly costMicros: number | null;
  /** The two prices the cost was worked out from; null exactly when the cost is. */
  readonly priceInput: number | null;
  readonly priceOutput: number | null;
  /** The tools an `ok` answer asked for, in order. */
  readonly toolNames: readonly string[];
  readonly outcome: TraceOutcome;
  /** The code of an `invalid-output` or a `provider-error`. */
  readonly outcomeCode: InvalidOutputCode | ProviderErrorCode | null;
}

/** Stores one trace, in a transaction of its own. Rejects if it could not. */
export type TraceRecorder = (record: TraceRecord) => Promise<void>;
