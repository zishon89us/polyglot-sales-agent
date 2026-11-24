// One turn with the model (M3 unit U7; design note
// docs/design/notes/m3-u7-turn.md). What a request holds is decided here,
// by a function that is given no contact: it has no parameter through
// which a phone number or a contact's name could arrive (NFR-V7).
//
// No sentence for the model is written in this file. Instructions are
// files under `prompts/`; what code adds is data.

import { randomUUID } from "node:crypto";
import {
  type AssembledPrompt,
  assemblePrompt,
  boundBatch,
  type LlmClient,
  type LlmMessage,
  type LlmRequest,
  type LoadedPrompt,
  type ToolOffer,
} from "@polyglot-sales-agent/ai";
import {
  type BusinessProfile,
  CORE_CLAIM_KINDS,
  MODEL_CALL_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_MAX,
  priceText,
  TOOL_ROUNDS_MAX,
} from "@polyglot-sales-agent/core";
import {
  abandonTurn,
  answering,
  type Database,
  finishTurn,
  type HistoryMessage,
  loadBusinessProfile,
  packOf,
  renewTurn,
  runTool,
  sessionHistory,
  type ToolReturn,
  type Tx,
  type UnhandledMessage,
} from "@polyglot-sales-agent/db";
import { type PackRegistry, packNamed } from "@polyglot-sales-agent/pack-interface";

/** The prompt a reply is made with. Which version runs is named here and changed by pull request. */
export const REPLY_PROMPT = { name: "reply", version: 1 } as const;

/** A tool the model may ask for. None exists in a deployment until M5. */
export interface TurnTool {
  readonly offer: ToolOffer;
  /**
   * Runs in a transaction that has already checked the turn's lease. The
   * arguments are as the model wrote them: unchecked, and to be treated as
   * a customer's text. **A tool must change nothing** until a later turn
   * can see what an earlier one did: a turn that is tried again runs its
   * tools again.
   */
  run(tx: Tx, args: Readonly<Record<string, unknown>>): Promise<ToolReturn>;
}

/** What a turn needs of the model. */
export interface TurnModel {
  readonly client: LlmClient;
  /** The core prompt, loaded when the worker started. */
  readonly prompt: LoadedPrompt;
  /** Each pack's own prompt, by the pack's name, for the packs that have one. */
  readonly fragments: Readonly<Record<string, LoadedPrompt>>;
  readonly canary: string;
  readonly packs: PackRegistry;
  /** By name. For tests until M5. */
  readonly tools?: Readonly<Record<string, TurnTool>>;
}

/** The business, as the model is given it: the profile, with each price written out. */
export function businessData(profile: BusinessProfile): unknown {
  const currency = profile.currency;
  return {
    name: profile.name,
    timeZone: profile.timeZone,
    currency: currency?.code ?? null,
    supportContact: profile.supportContact,
    services: profile.services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: currency === null ? null : priceText(service.priceMinor, currency),
    })),
    policies: profile.policies.map(({ id, title, body }) => ({ id, title, body })),
    openingHours: profile.openingHours,
  };
}

/**
 * The request for a batch, or undefined if the batch holds no text. The
 * order is the one the prompt describes: the business, the session so far,
 * the facts of the turn, the batch.
 */
export function buildRequest(parts: {
  readonly system: AssembledPrompt;
  readonly profile: BusinessProfile;
  readonly history: readonly HistoryMessage[];
  readonly batch: readonly Pick<UnhandledMessage, "kind" | "body">[];
  readonly tools: readonly ToolOffer[];
}): LlmRequest | undefined {
  const texts = parts.batch.flatMap((message) =>
    message.kind === "text" && typeof message.body === "string" && message.body !== ""
      ? [message.body]
      : [],
  );
  if (texts.length === 0) {
    return undefined;
  }
  // A tap is not text and is not content that could not be read: what a
  // button does is decided before the model, by a later unit.
  const unread = parts.batch.filter(
    (message) => message.kind !== "text" && message.kind !== "button",
  ).length;
  const bounded = boundBatch(texts);
  const messages: LlmMessage[] = [
    { role: "data", text: JSON.stringify({ business: businessData(parts.profile) }) },
    ...parts.history.map(({ role, text }) => ({ role, text })),
    {
      role: "data",
      text: JSON.stringify({ unread, truncated: bounded.leftOut > 0 || bounded.cut }),
    },
    ...bounded.texts.map((text) => ({ role: "customer" as const, text })),
  ];
  return {
    system: parts.system.text,
    prompts: parts.system.prompts,
    messages,
    tools: parts.tools,
    claimKinds: CORE_CLAIM_KINDS,
    maxOutputTokens: MODEL_OUTPUT_TOKENS_MAX,
    timeoutMs: MODEL_CALL_TIMEOUT_MS,
  };
}

/** How a turn with the model ended. */
export type TurnOutcome =
  /** The reply is stored, or was dropped for a newer message: what `finishTurn` said. */
  | { readonly kind: "ended"; readonly end: Awaited<ReturnType<typeof finishTurn>> }
  /** Nothing is answered and the batch is marked as dealt with; `code` says why. */
  | {
      readonly kind: "no-reply";
      readonly code: string;
      readonly end: Awaited<ReturnType<typeof finishTurn>>;
    }
  /** The tenant is not answering: the batch is left as it is. */
  | { readonly kind: "not-answering" }
  /** The conversation is no longer this worker's: nothing was stored. */
  | { readonly kind: "lost-lease" };

const failure = (code: string): Error =>
  Object.assign(new Error(`the turn failed: ${code}`), { code });

/**
 * Runs the turn `beginTurn` started. Throws, with the lease given back,
 * when the call may be worth making again: a timeout, a provider's
 * failure, a trace that could not be stored. The job is then tried again,
 * and each try calls the model again.
 */
export async function runTurn(
  app: Database,
  model: TurnModel,
  at: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly token: string;
    readonly sessionId: string;
    readonly messages: readonly UnhandledMessage[];
  },
  now?: Date,
): Promise<TurnOutcome> {
  const { tenantId, conversationId, token, sessionId } = at;
  const handled = at.messages.map((message) => message.id);
  const end = (reply?: string, made?: { turnId: string; language: string }) =>
    finishTurn(app, tenantId, conversationId, { token, sessionId }, handled, reply, now, made);
  try {
    const hasText = at.messages.some(
      (message) =>
        message.kind === "text" && typeof message.body === "string" && message.body !== "",
    );
    if (!hasText) {
      // Step 13 is a later unit's: for now the batch is only marked.
      return { kind: "no-reply", code: "no-text", end: await end() };
    }
    if ((await answering(app, tenantId)).settingsMissing.length > 0) {
      await abandonTurn(app, tenantId, conversationId, token);
      return { kind: "not-answering" };
    }
    const pack = packNamed(model.packs, await packOf(app, tenantId));
    if (pack === undefined) {
      throw failure("unknown-pack");
    }
    const fragment = Object.hasOwn(model.fragments, pack.name)
      ? model.fragments[pack.name]
      : undefined;
    if (pack.promptFragment !== undefined && fragment === undefined) {
      throw failure("unknown-pack");
    }
    const tools = model.tools ?? {};
    const request = buildRequest({
      system: assemblePrompt(model.prompt, fragment, model.canary),
      profile: await loadBusinessProfile(app, tenantId),
      history: await sessionHistory(app, tenantId, sessionId),
      batch: at.messages,
      tools: Object.values(tools).map((tool) => tool.offer),
    });
    if (request === undefined) {
      return { kind: "no-reply", code: "no-text", end: await end() };
    }
    const turnId = randomUUID();
    const place = { tenantId, sessionId, turnId, turnStartedAt: now ?? new Date() };
    const messages = [...request.messages];
    for (let round = 0; ; round += 1) {
      if (!(await renewTurn(app, tenantId, conversationId, token, now))) {
        return { kind: "lost-lease" };
      }
      // Outside any transaction: the trace is stored on a connection of its own.
      const result = await model.client.generate({ ...request, messages }, place);
      if (result.kind === "timeout" || result.kind === "provider-error") {
        throw failure(`model-${result.kind}`);
      }
      if (result.kind === "invalid-output") {
        // Not tried again: the same request would likely get the same answer.
        return { kind: "no-reply", code: "model-invalid-output", end: await end() };
      }
      const { reply, toolCalls, language } = result.output;
      if (toolCalls.length === 0) {
        if (reply.trim() === "") {
          return { kind: "no-reply", code: "empty-reply", end: await end() };
        }
        return { kind: "ended", end: await end(reply, { turnId, language }) };
      }
      if (round >= TOOL_ROUNDS_MAX) {
        return { kind: "no-reply", code: "tool-rounds", end: await end() };
      }
      messages.push({ role: "tool-calls", toolCalls });
      for (const call of toolCalls) {
        const tool = Object.hasOwn(tools, call.name) ? tools[call.name] : undefined;
        const ran = await runTool(
          app,
          tenantId,
          { conversationId, token, sessionId, turnId, tool: call.name, arguments: call.arguments },
          (tx) =>
            tool === undefined
              ? Promise.reject(new Error("no such tool"))
              : tool.run(tx, call.arguments),
        );
        if (ran.kind === "lost-lease") {
          return { kind: "lost-lease" };
        }
        messages.push({
          role: "tool-result",
          toolCallId: call.id,
          text: JSON.stringify(ran.outcome === "done" ? ran.result : { error: ran.outcome }),
        });
      }
    }
  } catch (error) {
    // Nothing was stored. Free the conversation, so that the retry need not wait for the lease to run out.
    await abandonTurn(app, tenantId, conversationId, token).catch(() => undefined);
    throw error;
  }
}
