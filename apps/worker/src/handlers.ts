// The two jobs of the walking skeleton (M2 unit U8).
//
// `process-conversation` answers what a customer wrote. Until M3 the answer
// is an echo: steps 5 to 15 of the order of checks (state machines, section
// 1) are not built, and no model is called.
//
// `send-messages` sends what waits in one conversation, oldest first, one
// at a time. The channel is called outside any transaction, between a
// claim and a record, so the worker can stop at any point and the send
// policy still holds (architecture, "Sending a message once").

import type { Channel } from "@polyglot-sales-agent/channel";
import { echoReply, JOB_MAX_DEFER_MS } from "@polyglot-sales-agent/core";
import {
  abandonTurn,
  beginTurn,
  type CallResult,
  claimNextSend,
  type Database,
  finishTurn,
  type Job,
  type JobHandler,
  type MessageToSend,
  PROCESS_CONVERSATION_JOB,
  recordSend,
  SEND_MESSAGES_JOB,
} from "@polyglot-sales-agent/db";

/** How long to wait for a conversation another worker holds. */
export const BUSY_WAIT_MS = 1_000;

/**
 * The most messages one run of `send-messages` sends before it gives other
 * jobs a turn. A run also ends at the first call that is not accepted, so
 * one run costs at most this many quick calls and one slow one.
 */
export const SENDS_PER_RUN = 20;

/** Told of each message that ends `failed`, with its code. For a log: never anything of the message. */
export type SendReport = (event: "send-failed", code: string) => void;

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
  readonly report?: SendReport;
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

async function call(options: HandlerOptions, message: MessageToSend): Promise<CallResult> {
  // Not `channels[name]`: that would find what the object inherits.
  const channel = Object.hasOwn(options.channels, message.channel)
    ? options.channels[message.channel]
    : undefined;
  if (channel === undefined) {
    return { kind: "refused", retryable: false, code: "no-channel" };
  }
  // Only a free-form text can be sent so far; a template is a later unit's.
  if (message.kind !== "text" || message.body === null) {
    return { kind: "refused", retryable: false, code: "unsupported-kind" };
  }
  const result = await channel.sendText(
    { receivingNumberId: message.receivingNumberId, accessToken: options.accessToken },
    message.to,
    message.body,
  );
  if (result.accepted) {
    return { kind: "accepted", channelMessageId: result.channelMessageId };
  }
  return result.mayHaveArrived
    ? { kind: "unknown" }
    : { kind: "refused", retryable: result.retryable, code: result.code };
}

export function createHandlers(options: HandlerOptions): Record<string, JobHandler> {
  return {
    async [PROCESS_CONVERSATION_JOB](job) {
      const { tenantId, conversationId } = ids(job);
      const turn = await beginTurn(options.app, tenantId, conversationId);
      if (turn.busy) {
        return { deferMs: BUSY_WAIT_MS };
      }
      // The customer's text is data: it is echoed, never acted on.
      const reply = echoReply(
        turn.messages.map((message) => (message.kind === "text" ? message.body : null)),
      );
      try {
        const end = await finishTurn(
          options.app,
          tenantId,
          conversationId,
          turn.token,
          turn.messages.map((message) => message.id),
          reply,
        );
        // The customer wrote again meanwhile: answer everything together.
        return end === "newer-message" ? { deferMs: 0 } : undefined;
      } catch (error) {
        // Nothing was stored. Free the conversation, so that the retry need not wait for the lease to run out.
        await abandonTurn(options.app, tenantId, conversationId, turn.token).catch(() => undefined);
        throw error;
      }
    },

    async [SEND_MESSAGES_JOB](job) {
      const { tenantId, conversationId } = ids(job);
      for (let sent = 0; sent < SENDS_PER_RUN; sent += 1) {
        const next = await claimNextSend(options.app, tenantId, conversationId);
        for (const code of next.ended ?? []) {
          options.report?.("send-failed", code);
        }
        if (next.kind === "none") {
          return undefined;
        }
        if (next.kind === "wait") {
          return { deferMs: Math.min(next.ms, JOB_MAX_DEFER_MS) };
        }
        const result = await call(options, next.message);
        const decision = await recordSend(options.app, tenantId, next.message, result);
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
