// The two jobs of the walking skeleton (M2 unit U8).
//
// `process-conversation` answers what a customer wrote, one batch at a time
// (M3 unit U2: sessions, the reply window and the batching window; design
// note docs/design/notes/m3-u2-sessions.md). The answer is still an echo:
// steps 4a to 11 and 13 to 15 of the order of checks (state machines,
// section 1) are not built, and no model is called.
//
// `send-messages` sends what waits in one conversation, oldest first, one
// at a time. The channel is called outside any transaction, between a
// claim and a record, so the worker can stop at any point and the send
// policy still holds (architecture, "Sending a message once").

import { type Channel, checkButtonMessage } from "@polyglot-sales-agent/channel";
import { composeMessage, type FixedTextSet, JOB_MAX_DEFER_MS } from "@polyglot-sales-agent/core";
import {
  beginTurn,
  type CallResult,
  claimNextSend,
  type Database,
  type Job,
  type JobHandler,
  type MessageToSend,
  PROCESS_CONVERSATION_JOB,
  recordSend,
  SEND_MESSAGES_JOB,
} from "@polyglot-sales-agent/db";
import { runTurn, type TurnModel } from "./turn.ts";

/** How long to wait for a conversation another worker holds. */
export const BUSY_WAIT_MS = 1_000;

/**
 * The most messages one run of `send-messages` sends before it gives other
 * jobs a turn. A run also ends at the first call that is not accepted, so
 * one run costs at most this many quick calls and one slow one.
 */
export const SENDS_PER_RUN = 20;

/**
 * Told of each message that ends `failed`, with its code, and of each batch
 * that was not answered, with the reason. For a log: never anything of a
 * message.
 */
export type SendReport = (
  event: "send-failed" | "turn-skipped" | "reply-blocked",
  code: string,
) => void;

export interface HandlerOptions {
  /** The application role's. */
  readonly app: Database;
  /** The channels this worker can send on, by the name in `channel_accounts.channel`. */
  readonly channels: Readonly<Record<string, Channel>>;
  /**
   * The credential to send with. One for every tenant, from the worker's
   * settings: per-tenant credentials, encrypted in the database (NFR-S5),
   * are not built.
   */
  readonly accessToken: string;
  /** The model, the prompt and the packs a turn answers with. */
  readonly model: TurnModel;
  readonly report?: SendReport;
  /**
   * The fixed texts. Without them no disclosure is sent: only a test that
   * is not about them leaves them out.
   */
  readonly texts?: FixedTextSet;
  /** For tests: the time, in place of the database's clock. */
  readonly clock?: () => Date;
}

function ids(job: Job): { tenantId: string; conversationId: string } {
  const conversationId = job.payload["conversationId"];
  if (job.tenantId === null || conversationId === undefined) {
    throw Object.assign(new Error("the job names no tenant or no conversation"), {
      code: "bad-job",
    });
  }
  return { tenantId: job.tenantId, conversationId };
}

/** Something a reader would see: not a space, a line break or a zero-width character. */
const SEEN = /[^\s\u200b\u2060\ufeff]/;

/** The call's result, and whether a message stored with buttons went without them. */
async function call(
  options: HandlerOptions,
  message: MessageToSend,
): Promise<{ result: CallResult; buttonsDropped: boolean }> {
  const refused = (code: string) =>
    ({ result: { kind: "refused", retryable: false, code }, buttonsDropped: false }) as const;
  // Not `channels[name]`: that would find what the object inherits.
  const channel = Object.hasOwn(options.channels, message.channel)
    ? options.channels[message.channel]
    : undefined;
  if (channel === undefined) {
    return refused("no-channel");
  }
  // What the customer reads: the disclosure, a fixed text put before the
  // reply, and the reply, each that is present, a blank line between.
  const text = composeMessage([message.disclosure, message.lead, message.body]);
  // Only a free-form text can be sent so far; a template is a later unit's.
  // The disclosure alone is no message: there must be a lead or a body to carry it.
  if (message.kind !== "text" || !SEEN.test(composeMessage([message.lead, message.body]))) {
    return refused("unsupported-kind");
  }
  const from = { receivingNumberId: message.receivingNumberId, accessToken: options.accessToken };
  const buttons = message.buttons ?? [];
  // Buttons the channel would refuse are left off, and the record then
  // says so: every text that has a button also says in words what to do.
  const withButtons =
    buttons.length > 0 && checkButtonMessage(channel.limits, text, buttons) === undefined;
  const result = withButtons
    ? await channel.sendButtons(from, message.to, text, buttons)
    : await channel.sendText(from, message.to, text);
  const buttonsDropped = buttons.length > 0 && !withButtons;
  if (result.accepted) {
    return {
      result: { kind: "accepted", channelMessageId: result.channelMessageId },
      buttonsDropped,
    };
  }
  return {
    result: result.mayHaveArrived
      ? { kind: "unknown" }
      : { kind: "refused", retryable: result.retryable, code: result.code },
    buttonsDropped,
  };
}

export function createHandlers(options: HandlerOptions): Record<string, JobHandler> {
  return {
    async [PROCESS_CONVERSATION_JOB](job) {
      const { tenantId, conversationId } = ids(job);
      const turn = await beginTurn(options.app, tenantId, conversationId, options.clock?.());
      if (turn.kind === "busy") {
        return { deferMs: BUSY_WAIT_MS };
      }
      if (turn.kind === "wait") {
        // The batching window is open: the customer may still be writing.
        return { deferMs: Math.min(turn.ms, JOB_MAX_DEFER_MS) };
      }
      if (turn.kind === "idle") {
        return undefined;
      }
      if (turn.kind === "skipped") {
        options.report?.("turn-skipped", turn.reason);
        return undefined;
      }
      // The customer's text is data: it is given to the model as data, never acted on.
      const outcome = await runTurn(
        options.app,
        options.model,
        { tenantId, conversationId, ...turn },
        options.clock,
      );
      if (outcome.kind === "not-answering" || outcome.kind === "lost-lease") {
        options.report?.("turn-skipped", outcome.kind);
        return undefined;
      }
      if (outcome.kind === "no-reply" && outcome.code !== "no-text") {
        // The customer gets nothing.
        options.report?.("turn-skipped", outcome.code);
      }
      if (outcome.kind === "ended" && outcome.blocked !== undefined && outcome.end === "stored") {
        // The model's answer failed a check and the fallback is stored in
        // its place. The check and its code; nothing of the answer.
        options.report?.("reply-blocked", outcome.blocked);
      }
      if (outcome.end === "session-over") {
        // The session's 24 hours passed while the reply was being made.
        // "newer-message" needs no line: the customer wrote again, and that
        // message queued a job of its own, which answers everything together.
        options.report?.("turn-skipped", outcome.end);
      }
      return undefined;
    },

    async [SEND_MESSAGES_JOB](job) {
      const { tenantId, conversationId } = ids(job);
      for (let sent = 0; sent < SENDS_PER_RUN; sent += 1) {
        const texts = options.texts;
        const next = await claimNextSend(
          options.app,
          tenantId,
          conversationId,
          options.clock?.(),
          texts === undefined
            ? undefined
            : (given) => texts.pick(given.preferred, given.tenantDefault).texts.disclosure,
        );
        for (const code of next.ended ?? []) {
          options.report?.("send-failed", code);
        }
        if (next.kind === "none") {
          return undefined;
        }
        if (next.kind === "wait") {
          return { deferMs: Math.min(next.ms, JOB_MAX_DEFER_MS) };
        }
        const { result, buttonsDropped } = await call(options, next.message);
        const decision = await recordSend(
          options.app,
          tenantId,
          next.message,
          result,
          options.clock?.(),
          buttonsDropped,
        );
        if (decision !== "superseded" && decision.next === "failed") {
          options.report?.("send-failed", decision.code);
        }
        if (decision !== "superseded" && decision.next === "retry") {
          return { deferMs: decision.waitMs };
        }
        // A call that was not accepted may have been slow: let other jobs run before the next.
        if (result.kind !== "accepted") {
          return { deferMs: 0 };
        }
      }
      return { deferMs: 0 };
    },
  };
}
