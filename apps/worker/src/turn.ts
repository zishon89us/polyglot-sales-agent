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
  checkReply,
  composeMessage,
  coreButton,
  type FixedTextName,
  type FixedTextSet,
  type HandoverReason,
  LANGUAGE_UNKNOWN,
  MODEL_CALL_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_MAX,
  priceText,
  type ReplyCheck,
  TOOL_ROUNDS_MAX,
} from "@polyglot-sales-agent/core";
import {
  abandonTurn,
  answering,
  type Database,
  type DisclosureFor,
  finishTurn,
  type HandoverTell,
  type HistoryMessage,
  joinHandover,
  loadBusinessProfile,
  packOf,
  type ReplyChecksRecord,
  renewTurn,
  runTool,
  sessionHistory,
  type ToolReturn,
  type Tx,
  type UnhandledMessage,
} from "@polyglot-sales-agent/db";
import { type PackRegistry, packNamed } from "@polyglot-sales-agent/pack-interface";
import { handoverTeller } from "./handover.ts";

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
  /**
   * The fixed texts: the answer to "am I talking to a person?" is code's.
   * Without them that flag is dropped like the others; for tests.
   */
  readonly texts?: FixedTextSet;
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

const textsOf = (batch: readonly Pick<UnhandledMessage, "kind" | "body">[]): string[] =>
  batch.flatMap((message) =>
    message.kind === "text" && typeof message.body === "string" && message.body !== ""
      ? [message.body]
      : [],
  );

/**
 * The customer's texts exactly as the request gives them to the model:
 * after the batch is bounded, so a text that was cut or left out is cut
 * or left out here too. The checks on the reply are given these.
 */
export function givenTexts(batch: readonly Pick<UnhandledMessage, "kind" | "body">[]): string[] {
  const texts = textsOf(batch);
  return texts.length === 0 ? [] : [...boundBatch(texts).texts];
}

/**
 * What the turn does with the flags of an answer: the one place they are
 * read (guardrail policy, O2). Only the question "am I talking to a
 * person?" is acted on. The others are named with the unit that will act
 * on them, and until then are dropped.
 */
export const FLAGS_FOR_LATER = {
  "asks-to-stop": "U10",
  "asks-to-resume": "U10",
} as const;
/** The flags that hand the session over, with the reason each gives, in the order the reasons are added. */
export const HANDOVER_FLAGS = [
  ["asks-for-person", "requested"],
  ["sensitive-topic", "sensitive-topic"],
  ["data-request", "data-request"],
  ["emergency", "emergency"],
] as const satisfies readonly (readonly [string, HandoverReason])[];
export function readFlags(flags: readonly string[]): {
  readonly answerIsAutomated: boolean;
  /** The reasons to hand over for, without repeats. */
  readonly handover: readonly HandoverReason[];
  readonly dropped: readonly string[];
} {
  return {
    answerIsAutomated: flags.includes("asks-if-person"),
    handover: HANDOVER_FLAGS.filter(([flag]) => flags.includes(flag)).map(([, reason]) => reason),
    dropped: flags.filter((flag) => Object.hasOwn(FLAGS_FOR_LATER, flag)),
  };
}

/** The checks by name, for a line of the log: a code there holds letters and hyphens only. */
export const CHECK_NAMES = { O7: "length", O6: "leak", O3: "values", O5: "contacts" } as const;

/** Today's date where the business is. */
export function todayIn(timeZone: string, at: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string): number => Number(parts.find((one) => one.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
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
  const texts = textsOf(parts.batch);
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
  /**
   * The reply is stored, or was dropped for a newer message: what
   * `finishTurn` said. `blocked` when the model's answer failed a check and
   * the reply is the fallback: the check and its code, nothing of the answer.
   */
  | {
      readonly kind: "ended";
      readonly end: Awaited<ReturnType<typeof finishTurn>>;
      readonly blocked?: string;
      /** The session was handed over by this turn, or reasons were added: the reasons it now has. */
      readonly handedOver?: readonly string[];
    }
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
  /** The time, when it is asked; for tests. Each renewal of the lease asks again. */
  clock?: () => Date,
): Promise<TurnOutcome> {
  const { tenantId, conversationId, token, sessionId } = at;
  // When the turn began: read first, before anything is asked of the database.
  const turnStartedAt = clock?.() ?? new Date();
  const now = clock === undefined ? undefined : turnStartedAt;
  const handled = at.messages.map((message) => message.id);
  const end = (reply?: string, made?: Parameters<typeof finishTurn>[7]) =>
    finishTurn(app, tenantId, conversationId, { token, sessionId }, handled, reply, now, made);
  const turnId = randomUUID();
  // Without the fixed texts (a test of an earlier unit) nothing can be told, and nothing is handed over.
  const tell = model.texts === undefined ? undefined : handoverTeller(model.texts);
  /** Hands the session over: there is no reply, and the telling is stored with the turn's end. */
  const handOver = async (
    reasons: readonly HandoverReason[],
    with_: { checks?: ReplyChecksRecord; answerIsAutomated?: boolean } = {},
  ): Promise<TurnOutcome> => {
    let made: readonly string[] | undefined;
    const ended = await end(undefined, {
      turnId,
      language: LANGUAGE_UNKNOWN,
      ...(with_.checks === undefined ? {} : { checks: with_.checks }),
      handover: {
        reasons,
        tell: tell as HandoverTell,
        answerIsAutomated: with_.answerIsAutomated === true,
        done: (result) => {
          made = result.reasons;
        },
      },
    });
    return { kind: "ended", end: ended, ...(made === undefined ? {} : { handedOver: made }) };
  };
  try {
    // A tap on the person button (order of checks, step 11).
    const tapped =
      tell !== undefined &&
      at.messages.some(
        (message) => message.kind === "button" && message.buttonPayload === coreButton("person"),
      );
    if (tell !== undefined) {
      // Step 10: a session that is handed over is not answered by the assistant.
      const joined = await joinHandover(
        app,
        tenantId,
        conversationId,
        { token, sessionId },
        handled,
        { tapped, tell, ...(now === undefined ? {} : { now }) },
      );
      if (joined === "lost-lease") {
        return { kind: "lost-lease" };
      }
      if (joined === "handed-over") {
        return { kind: "no-reply", code: "handed-over", end: "stored" };
      }
    }
    const hasText = at.messages.some(
      (message) =>
        message.kind === "text" && typeof message.body === "string" && message.body !== "",
    );
    if (!hasText && !tapped) {
      // Step 13 is a later unit's: for now the batch is only marked.
      return { kind: "no-reply", code: "no-text", end: await end() };
    }
    if ((await answering(app, tenantId)).settingsMissing.length > 0) {
      await abandonTurn(app, tenantId, conversationId, token);
      return { kind: "not-answering" };
    }
    if (!hasText) {
      // The tap alone: handed over without the model.
      return handOver(["requested"]);
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
    const system = assemblePrompt(model.prompt, fragment, model.canary);
    const profile = await loadBusinessProfile(app, tenantId);
    const request = buildRequest({
      system,
      profile,
      history: await sessionHistory(app, tenantId, sessionId),
      batch: at.messages,
      tools: Object.values(tools).map((tool) => tool.offer),
    });
    if (request === undefined) {
      return { kind: "no-reply", code: "no-text", end: await end() };
    }
    const place = { tenantId, sessionId, turnId, turnStartedAt };
    const messages = [...request.messages];
    for (let round = 0; ; round += 1) {
      if (!(await renewTurn(app, tenantId, conversationId, token, clock?.()))) {
        return { kind: "lost-lease" };
      }
      // Outside any transaction: the trace is stored on a connection of its own.
      const result = await model.client.generate({ ...request, messages }, place);
      if (result.kind === "timeout" || result.kind === "provider-error") {
        if (tapped) {
          // The tap needs no model: the customer is handed over now, not
          // when the provider is back. The text beside it goes unread.
          return handOver(["requested"]);
        }
        throw failure(`model-${result.kind}`);
      }
      const texts = model.texts;
      /**
       * The answer failed a check: it is not sent, and the fallback is the
       * turn's reply (US-C4, 10). `before` is a fixed text that goes first.
       */
      const fallBack = async (
        checks: ReplyChecksRecord,
        blocked: string,
        before?: FixedTextName,
      ): Promise<TurnOutcome> => {
        if (texts === undefined) {
          // No fixed texts were given (a test): nothing is sent at all.
          return { kind: "no-reply", code: "reply-blocked", end: await end() };
        }
        const lead = (given: DisclosureFor): string => {
          const picked = texts.pick(given.preferred, given.tenantDefault).texts;
          return composeMessage([before === undefined ? null : picked[before], picked.fallback]);
        };
        // The fallback carries the person button, in the language of its text.
        const buttons = (given: DisclosureFor) => [
          {
            payload: coreButton("person"),
            title: texts.pick(given.preferred, given.tenantDefault).buttons.person,
          },
        ];
        return {
          kind: "ended",
          end: await end("", {
            turnId,
            language: LANGUAGE_UNKNOWN,
            lead,
            fallback: true,
            checks,
            buttons,
          }),
          blocked,
        };
      };
      if (result.kind === "invalid-output" && tapped) {
        // The tap hands over whatever the model answered to the text beside it.
        return handOver(["requested"], {
          checks: { outcome: "handed-over", o1: "invalid-output" },
        });
      }
      if (result.kind === "invalid-output") {
        // O1. Not tried again: the same request would likely get the same answer.
        return fallBack({ outcome: "blocked", o1: "invalid-output" }, "schema-invalid-output");
      }
      const { reply, toolCalls, language, flags, claims } = result.output;
      if (toolCalls.length === 0) {
        const { answerIsAutomated, handover } = readFlags(flags);
        const reasons: HandoverReason[] = [
          ...(tapped ? (["requested"] as const) : []),
          ...handover.filter((reason) => !(tapped && reason === "requested")),
        ];
        if (reasons.length > 0 && tell !== undefined) {
          // O2: the model's reply is discarded, unchecked, for the fixed
          // text of the event. No other answer is attempted (US-C11, 4).
          return handOver(reasons, {
            checks: { outcome: "handed-over", o1: "passed" },
            answerIsAutomated,
          });
        }
        // The customer asked whether a person is replying, and the model
        // wrote nothing else: the fixed answer alone. Not a failed reply.
        if (answerIsAutomated && reply.trim() === "" && texts !== undefined) {
          const lead = (given: DisclosureFor): string =>
            texts.pick(given.preferred, given.tenantDefault).texts["automated-assistant"];
          // There is no reply to check: the record says only that the answer matched the schema.
          const checks: ReplyChecksRecord = { outcome: "passed", o1: "passed" };
          return { kind: "ended", end: await end("", { turnId, language, lead, checks }) };
        }
        // The checks. Building what they are given is inside the guard: a
        // reply is never sent unchecked because the checker broke.
        let checked: ReturnType<typeof checkReply> | undefined;
        try {
          checked = checkReply({
            reply,
            claims,
            profile,
            batch: givenTexts(at.messages),
            canary: model.canary,
            instructions: system.instructions,
            today: todayIn(profile.timeZone, turnStartedAt),
          });
        } catch {
          checked = undefined;
        }
        const before = answerIsAutomated ? "automated-assistant" : undefined;
        if (checked === undefined) {
          return fallBack({ outcome: "error", o1: "passed" }, "check-error", before);
        }
        const code = (check: ReplyCheck): string => {
          const outcome = checked.checks[check];
          return outcome.passed ? "passed" : outcome.code;
        };
        const checks: ReplyChecksRecord = {
          outcome: checked.passed ? "passed" : "blocked",
          o1: "passed",
          o7: code("O7"),
          o6: code("O6"),
          o3: code("O3"),
          o5: code("O5"),
        };
        if (checked.failed !== undefined) {
          return fallBack(
            checks,
            `${CHECK_NAMES[checked.failed.check]}-${checked.failed.code}`,
            before,
          );
        }
        // The reply passed. The fixed answer to "am I talking to a person?"
        // goes before it (US-C5, 3).
        const lead =
          texts !== undefined && answerIsAutomated
            ? (given: DisclosureFor) =>
                texts.pick(given.preferred, given.tenantDefault).texts["automated-assistant"]
            : undefined;
        return {
          kind: "ended",
          end: await end(
            reply,
            lead === undefined ? { turnId, language, checks } : { turnId, language, lead, checks },
          ),
        };
      }
      if (round >= TOOL_ROUNDS_MAX) {
        if (tapped) {
          // The tap hands over whatever the model did with the text beside it.
          return handOver(["requested"]);
        }
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
