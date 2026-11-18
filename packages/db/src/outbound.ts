// What the worker does in the database to answer a conversation and to send
// what is waiting (M2 unit U8; architecture, "Processing one turn" and
// "Sending a message once"). Every function takes the application role's
// handle and runs in the tenant's scope. The channel is never called here:
// the worker calls it between `claimNextSend` and `recordSend`, outside any
// transaction.

import {
  decideAfterSend,
  EXPIRED,
  type MessageClass,
  SEND_EXPIRES_MS,
  SENDING_STALE_MS,
  type SendDecision,
  type SendOutcome,
  UNCONFIRMED,
} from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import { enqueueJob } from "./jobs.ts";
import { holdsLease, releaseLease, takeLease } from "./lease.ts";
import { type Tx, withTenant } from "./tenant.ts";

/** Sends what is waiting in one conversation, oldest first. Its subject is the conversation. */
export const SEND_MESSAGES_JOB = "send-messages";

const NOW = (n: number) => `coalesce($${n}::timestamptz, clock_timestamp())`;

export interface UnhandledMessage {
  readonly id: string;
  /** `text`, or the channel's name for a type that is not read. */
  readonly kind: string;
  /** Written by the customer. Untrusted: never an instruction. */
  readonly body: string | null;
}

export type TurnStart =
  /** Another worker holds the conversation. */
  | { readonly busy: true }
  | {
      readonly busy: false;
      /** The lease token, to present when the turn's result is stored. */
      readonly token: string;
      /** The customer's messages no turn has dealt with, oldest first. */
      readonly messages: readonly UnhandledMessage[];
    };

/**
 * Takes the conversation's lease and reads the customer's messages that no
 * turn has dealt with. `now` is for tests.
 */
export function beginTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  now?: Date,
): Promise<TurnStart> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const token = await takeLease(tx, conversationId, now);
    if (token === undefined) {
      return { busy: true };
    }
    const unhandled = await tx.query<UnhandledMessage>(
      `SELECT id, kind, body FROM messages
       WHERE conversation_id = $1 AND direction = 'inbound' AND handled_at IS NULL
       ORDER BY created_at, id`,
      [conversationId],
    );
    return { busy: false, token, messages: unhandled.rows };
  });
}

export type TurnEnd =
  /** The messages are marked as dealt with and the reply, if any, waits to be sent. */
  | "stored"
  /** Another worker has the conversation now. Nothing was stored. */
  | "lost-lease"
  /** The customer wrote again meanwhile. Nothing was stored; the turn is to be run again. */
  | "newer-message";

/**
 * Ends a turn in one transaction: checks that the lease is still this
 * worker's, marks the messages as dealt with, stores the reply as an
 * assistant reply waiting to be sent, queues the job that sends it, and
 * gives the lease back. If the customer wrote again since `beginTurn`, the
 * reply is dropped and nothing is marked (architecture, "Processing one
 * turn", step 7). With no reply the messages are only marked.
 */
export function finishTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  token: string,
  handled: readonly string[],
  reply: string | undefined,
): Promise<TurnEnd> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, token))) {
      return "lost-lease";
    }
    const newer = await tx.query(
      `SELECT 1 FROM messages
       WHERE conversation_id = $1 AND direction = 'inbound' AND handled_at IS NULL
         AND NOT (id = ANY($2::uuid[]))
       LIMIT 1`,
      [conversationId, handled],
    );
    if (newer.rowCount > 0) {
      await releaseLease(tx, conversationId, token);
      return "newer-message";
    }
    await tx.query(
      `UPDATE messages SET handled_at = clock_timestamp()
       WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
      [handled],
    );
    if (reply !== undefined) {
      await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, body, status,
                               created_at)
         VALUES ($1, $2, 'outbound', 'assistant-reply', 'text', $3, 'pending', clock_timestamp())`,
        [tenantId, conversationId, reply],
      );
      await enqueueJob(tx, {
        type: SEND_MESSAGES_JOB,
        tenantId,
        subjectId: conversationId,
        payload: { conversationId },
      });
    }
    await releaseLease(tx, conversationId, token);
    return "stored";
  });
}

/**
 * Gives the lease back without storing anything, for a turn that failed.
 * Without it the conversation would stay held until the lease ran out.
 */
export function abandonTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  token: string,
): Promise<void> {
  return withTenant(poolOf(app), tenantId, (tx) => releaseLease(tx, conversationId, token));
}

/** A message whose call to the channel this worker must now make. */
export interface MessageToSend {
  readonly id: string;
  /** Which call this is, from 1. Presented again when the result is recorded. */
  readonly attempt: number;
  readonly class: MessageClass;
  readonly kind: string;
  readonly body: string | null;
  readonly to: { readonly phone: string | null; readonly userId: string | null };
  /** The name of the channel the conversation is on. */
  readonly channel: string;
  readonly receivingNumberId: string;
}

export type NextSend =
  /** Nothing in the conversation waits to be sent. */
  (
    | { readonly kind: "none" }
    /** The oldest waiting message cannot go yet: come back after this long. */
    | { readonly kind: "wait"; readonly ms: number }
    | { readonly kind: "send"; readonly message: MessageToSend }
  ) & {
    /** The codes of messages this look ended as `failed` without a call, if any. For a log. */
    readonly ended?: readonly string[];
  };

interface Waiting {
  id: string;
  class: MessageClass;
  kind: string;
  body: string | null;
  status: "pending" | "sending";
  send_attempts: number;
  unknown_outcomes: number;
  /** Milliseconds since the call under way started. */
  sending_for: number | null;
  /** Milliseconds until the next call may start; not positive when it may. */
  due_in: number | null;
  /** Milliseconds since the message could first have gone: since it was stored, or since the time it was put off to. */
  waiting_for: number;
  phone: string | null;
  channel_user_id: string | null;
  channel: string;
  receiving_number_id: string;
}

const OLDEST_WAITING = (now: number) => `
  SELECT m.id, m.class, m.kind, m.body, m.status, m.send_attempts, m.unknown_outcomes,
         extract(epoch FROM ${NOW(now)} - m.sending_at) * 1000 AS sending_for,
         extract(epoch FROM m.send_not_before - ${NOW(now)}) * 1000 AS due_in,
         extract(epoch FROM ${NOW(now)} - greatest(m.created_at, m.send_not_before)) * 1000
           AS waiting_for,
         p.phone, p.channel_user_id, a.channel, a.receiving_number_id
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  JOIN contacts p ON p.id = c.contact_id
  JOIN channel_accounts a ON a.id = c.channel_account_id
  WHERE m.conversation_id = $1 AND m.status IN ('pending', 'sending')
  ORDER BY m.created_at, m.id
  LIMIT 1
  FOR UPDATE OF m`;

async function apply(
  tx: Tx,
  message: { id: string; attempts: number },
  decision: SendDecision,
  more: { unknown: boolean; channelMessageId?: string; now: Date | undefined },
): Promise<boolean> {
  const guard = "id = $1 AND status = 'sending' AND send_attempts = $2";
  const count = "unknown_outcomes = unknown_outcomes + $3";
  const unknown = more.unknown ? 1 : 0;
  if (decision.next === "sent") {
    const done = await tx.query(
      `UPDATE messages SET status = 'sent', sending_at = NULL, ${count},
                           channel_message_id = $4, sent_at = ${NOW(5)}
       WHERE ${guard}`,
      [message.id, message.attempts, unknown, more.channelMessageId, more.now ?? null],
    );
    return done.rowCount === 1;
  }
  if (decision.next === "retry") {
    const done = await tx.query(
      `UPDATE messages SET status = 'pending', sending_at = NULL, ${count},
                           send_not_before = ${NOW(5)} + $4::double precision * interval '1 millisecond'
       WHERE ${guard}`,
      [message.id, message.attempts, unknown, decision.waitMs, more.now ?? null],
    );
    return done.rowCount === 1;
  }
  const done = await tx.query(
    `UPDATE messages SET status = 'failed', sending_at = NULL, ${count}, error_code = $4
     WHERE ${guard}`,
    [message.id, message.attempts, unknown, decision.code],
  );
  return done.rowCount === 1;
}

/**
 * Finds the oldest message of the conversation that waits to be sent and,
 * if it can go, marks it `sending` and returns it. The caller then calls
 * the channel and reports with `recordSend`.
 *
 * Messages of one conversation go one at a time and in order: while the
 * oldest is being sent or waits to be tried again, nothing behind it goes.
 *
 * A message found `sending` for longer than `SENDING_STALE_MS` belongs to a
 * worker that stopped. Nobody knows whether the channel has it, so the
 * send policy decides by its class: it is sent once more, or it becomes
 * `failed` with the code `unconfirmed` and the next message is looked at.
 *
 * A message that could have gone more than `SEND_EXPIRES_MS` ago is not
 * sent, whatever kept it: it becomes `failed`, with the code `expired` if
 * no call for it ever ended unknown and `unconfirmed` otherwise. A call
 * that is under way and not yet stale is left alone however old the
 * message is.
 *
 * Throws if the tenant has no such conversation, which is a fault in the
 * job and must not look like "nothing to send".
 *
 * `now` is for tests.
 */
export function claimNextSend(
  app: Database,
  tenantId: string,
  conversationId: string,
  now?: Date,
): Promise<NextSend> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const ended: string[] = [];
    const also = (): { ended?: readonly string[] } => (ended.length > 0 ? { ended } : {});
    // Each pass either returns or ends one message for good, so this ends.
    for (;;) {
      const found = await tx.query<Waiting>(OLDEST_WAITING(2), [conversationId, now ?? null]);
      const waiting = found.rows[0];
      if (waiting === undefined) {
        const exists = await tx.query("SELECT 1 FROM conversations WHERE id = $1", [
          conversationId,
        ]);
        if (exists.rowCount === 0) {
          throw Object.assign(new Error("claimNextSend: no such conversation in this tenant"), {
            code: "conversation-not-found",
          });
        }
        return { kind: "none", ...also() };
      }
      const expired = Number(waiting.waiting_for) > SEND_EXPIRES_MS;
      if (waiting.status === "sending") {
        const age = Number(waiting.sending_for);
        if (age < SENDING_STALE_MS) {
          return { kind: "wait", ms: Math.ceil(SENDING_STALE_MS - age), ...also() };
        }
        if (expired) {
          await apply(
            tx,
            { id: waiting.id, attempts: waiting.send_attempts },
            { next: "failed", code: UNCONFIRMED },
            { unknown: true, now },
          );
          ended.push(UNCONFIRMED);
          continue;
        }
        const decision = decideAfterSend(
          waiting.class,
          { attempts: waiting.send_attempts, unknownBefore: waiting.unknown_outcomes },
          { kind: "unknown" },
        );
        // Sent once more at once: the wait of a retry has long passed.
        await apply(
          tx,
          { id: waiting.id, attempts: waiting.send_attempts },
          decision.next === "retry" ? { next: "retry", waitMs: 0 } : decision,
          { unknown: true, now },
        );
        if (decision.next === "failed") {
          ended.push(decision.code);
        }
        continue;
      }
      if (expired) {
        await tx.query(
          "UPDATE messages SET status = 'failed', error_code = $2, send_not_before = NULL WHERE id = $1",
          [waiting.id, waiting.unknown_outcomes > 0 ? UNCONFIRMED : EXPIRED],
        );
        ended.push(waiting.unknown_outcomes > 0 ? UNCONFIRMED : EXPIRED);
        continue;
      }
      if (waiting.due_in !== null && Number(waiting.due_in) > 0) {
        return { kind: "wait", ms: Math.ceil(Number(waiting.due_in)), ...also() };
      }
      await tx.query(
        `UPDATE messages SET status = 'sending', sending_at = ${NOW(2)},
                             send_attempts = send_attempts + 1, send_not_before = NULL
         WHERE id = $1`,
        [waiting.id, now ?? null],
      );
      return {
        ...also(),
        kind: "send",
        message: {
          id: waiting.id,
          attempt: waiting.send_attempts + 1,
          class: waiting.class,
          kind: waiting.kind,
          body: waiting.body,
          to: { phone: waiting.phone, userId: waiting.channel_user_id },
          channel: waiting.channel,
          receivingNumberId: waiting.receiving_number_id,
        },
      };
    }
  });
}

/** How a call to the channel ended, as the worker saw it. */
export type CallResult =
  | { readonly kind: "accepted"; readonly channelMessageId: string }
  | { readonly kind: "refused"; readonly retryable: boolean; readonly code: string }
  | { readonly kind: "unknown" };

/**
 * Records how the call for a message ended and returns what the send
 * policy decided. Returns `superseded`, and changes nothing, if the message
 * is no longer in the call this worker started: it took so long that the
 * call was taken as lost and dealt with by another.
 */
export function recordSend(
  app: Database,
  tenantId: string,
  message: Pick<MessageToSend, "id" | "attempt">,
  result: CallResult,
  now?: Date,
): Promise<SendDecision | "superseded"> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const found = await tx.query<{ class: MessageClass; unknown_outcomes: number }>(
      `SELECT class, unknown_outcomes FROM messages
       WHERE id = $1 AND status = 'sending' AND send_attempts = $2 FOR UPDATE`,
      [message.id, message.attempt],
    );
    const row = found.rows[0];
    if (row === undefined) {
      return "superseded";
    }
    const outcome: SendOutcome = result.kind === "accepted" ? { kind: "accepted" } : result;
    const decision = decideAfterSend(
      row.class,
      { attempts: message.attempt, unknownBefore: row.unknown_outcomes },
      outcome,
    );
    await apply(tx, { id: message.id, attempts: message.attempt }, decision, {
      unknown: result.kind === "unknown",
      now,
      ...(result.kind === "accepted" ? { channelMessageId: result.channelMessageId } : {}),
    });
    return decision;
  });
}
