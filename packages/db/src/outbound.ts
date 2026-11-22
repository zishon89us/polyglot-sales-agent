// What the worker does in the database to answer a conversation and to send
// what is waiting (M2 unit U8; architecture, "Processing one turn" and
// "Sending a message once"). Every function takes the application role's
// handle and runs in the tenant's scope. The channel is never called here:
// the worker calls it between `claimNextSend` and `recordSend`, outside any
// transaction.

import {
  batchWindowClosesAt,
  decideAfterSend,
  EXPIRED,
  HELD_BACK_WAIT_MS,
  type MessageClass,
  REPLY_DISCARDS_MAX,
  REPLY_WINDOW_MS,
  SEND_EXPIRES_MS,
  SENDING_STALE_MS,
  type SendDecision,
  type SendOutcome,
  UNCONFIRMED,
} from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import { enqueueJob } from "./jobs.ts";
import { holdsLease, releaseLease, takeLease } from "./lease.ts";
import { lockConversation, noteAccepted, openSession, sessionFor, stamp } from "./sessions.ts";
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
  | { readonly kind: "busy" }
  /** The batching window is still open: come back after this long. No lease was taken. */
  | { readonly kind: "wait"; readonly ms: number }
  /** The open session has no message to deal with, or the conversation has no open session. */
  | { readonly kind: "idle" }
  /**
   * The batch was marked as dealt with and nothing is to be answered: the
   * reply window had closed (design note, W2). `messages` is how many.
   */
  | { readonly kind: "skipped"; readonly reason: "window-closed"; readonly messages: number }
  | {
      readonly kind: "turn";
      /** The lease token, to present when the turn's result is stored. */
      readonly token: string;
      readonly sessionId: string;
      /** The customer's messages of the open session no turn has dealt with, oldest first. */
      readonly messages: readonly UnhandledMessage[];
    };

const UNHANDLED = "session_id = $1 AND direction = 'inbound' AND handled_at IS NULL";

function noConversation(where: string): Error {
  return Object.assign(new Error(`${where}: no such conversation in this tenant`), {
    code: "conversation-not-found",
  });
}

/**
 * Starts a turn, if one may start (design note, sections 0 to 3). In one
 * transaction, under the conversation's lock:
 *
 * - a session that is over is ended, with its effects;
 * - if the batching window is still open, nothing is taken and the caller
 *   is told how long to wait;
 * - the lease is taken;
 * - if the reply window has closed, the batch is marked as dealt with and
 *   no turn starts;
 * - replies of the session that wait unsent are discarded and the messages
 *   they answered count as not dealt with again, unless that has already
 *   happened twice in a row;
 * - the batch is read.
 *
 * `now` is for tests.
 */
export function beginTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  now?: Date,
): Promise<TurnStart> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await lockConversation(tx, conversationId))) {
      throw noConversation("beginTurn");
    }
    const at = await stamp(tx, now);
    const session = await openSession(tx, conversationId, at);
    if (session === undefined) {
      return { kind: "idle" };
    }
    const window = await tx.query<{
      waiting: string;
      latest: string | null;
      first: string | null;
      now: string;
    }>(
      `SELECT count(*) AS waiting,
              extract(epoch FROM max(m.created_at)) * 1000 AS latest,
              extract(epoch FROM min(m.created_at) FILTER (
                WHERE c.turn_started_at IS NULL OR m.created_at > c.turn_started_at
              )) * 1000 AS first,
              extract(epoch FROM $2::timestamptz) * 1000 AS now
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.session_id = $1 AND m.direction = 'inbound' AND m.handled_at IS NULL`,
      [session.id, at],
    );
    const batch = window.rows[0];
    const waiting = Number(batch?.waiting ?? 0);
    if (batch === undefined || waiting === 0) {
      return { kind: "idle" };
    }
    // With no message stored since the last turn started, the batch has
    // already waited and the window is closed.
    const closes = batchWindowClosesAt(
      Number(batch.latest),
      batch.first === null ? undefined : Number(batch.first),
    );
    if (Number(batch.now) < closes) {
      return { kind: "wait", ms: Math.ceil(closes - Number(batch.now)) };
    }
    const token = await takeLease(tx, conversationId, now);
    if (token === undefined) {
      return { kind: "busy" };
    }
    const closed = await tx.query(
      `SELECT 1 FROM conversations c JOIN contacts p ON p.id = c.contact_id
       WHERE c.id = $1 AND (p.last_inbound_at IS NULL
         OR p.last_inbound_at + $3::double precision * interval '1 millisecond' <= $2::timestamptz)`,
      [conversationId, at, REPLY_WINDOW_MS],
    );
    if (closed.rowCount > 0) {
      await tx.query(`UPDATE messages SET handled_at = $2::timestamptz WHERE ${UNHANDLED}`, [
        session.id,
        at,
      ]);
      await releaseLease(tx, conversationId, token);
      return { kind: "skipped", reason: "window-closed", messages: waiting };
    }
    await tx.query("UPDATE conversations SET turn_started_at = $2::timestamptz WHERE id = $1", [
      conversationId,
      at,
    ]);
    if (session.replyDiscards < REPLY_DISCARDS_MAX) {
      // A reply that has waited its 15 minutes is left to expire as it
      // always did, with nothing reopened (design note, D8).
      const dropped = await tx.query<{ id: string }>(
        `UPDATE messages SET status = 'discarded', send_not_before = NULL
         WHERE session_id = $1 AND class = 'assistant-reply' AND status = 'pending'
           AND unknown_outcomes = 0
           AND $2::timestamptz - greatest(created_at, send_not_before)
               <= $3::double precision * interval '1 millisecond'
         RETURNING id`,
        [session.id, at, SEND_EXPIRES_MS],
      );
      if (dropped.rowCount > 0) {
        await tx.query(
          "UPDATE messages SET handled_at = NULL, answered_by = NULL WHERE answered_by = ANY($1::uuid[])",
          [dropped.rows.map((row) => row.id)],
        );
        await tx.query("UPDATE sessions SET reply_discards = reply_discards + 1 WHERE id = $1", [
          session.id,
        ]);
      }
    }
    const unhandled = await tx.query<UnhandledMessage>(
      `SELECT id, kind, body FROM messages WHERE ${UNHANDLED} ORDER BY created_at, id`,
      [session.id],
    );
    return { kind: "turn", token, sessionId: session.id, messages: unhandled.rows };
  });
}

export type TurnEnd =
  /** The messages are marked as dealt with and the reply, if any, waits to be sent. */
  | "stored"
  /** Another worker has the conversation now. Nothing was stored. */
  | "lost-lease"
  /** The customer wrote again meanwhile. Nothing was stored; the newer message's job runs the next turn. */
  | "newer-message";

/**
 * Ends a turn in one transaction: checks that the lease is still this
 * worker's, which also locks the conversation; marks the messages as dealt
 * with, each pointing at the reply; stores the reply as an assistant reply
 * waiting to be sent; queues the job that sends it; and gives the lease
 * back. With no reply the messages are only marked.
 *
 * If the customer wrote again since `beginTurn`, the reply is dropped and
 * nothing is marked, unless a reply has already been dropped twice in a row
 * in this session: then this one is stored, and the newer message is left
 * for the next turn (design note, D1, D6).
 *
 * `now` is for tests.
 */
export function finishTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  turn: { readonly token: string; readonly sessionId: string },
  handled: readonly string[],
  reply: string | undefined,
  now?: Date,
): Promise<TurnEnd> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, turn.token))) {
      return "lost-lease";
    }
    const newer = await tx.query(
      `SELECT 1 FROM messages WHERE ${UNHANDLED} AND NOT (id = ANY($2::uuid[])) LIMIT 1`,
      [turn.sessionId, handled],
    );
    if (newer.rowCount > 0) {
      const counted = await tx.query(
        `UPDATE sessions SET reply_discards = reply_discards + 1
         WHERE id = $1 AND reply_discards < $2 AND $3::boolean`,
        [turn.sessionId, REPLY_DISCARDS_MAX, reply !== undefined],
      );
      // With no reply there is nothing to drop, and nothing is counted.
      if (reply === undefined || counted.rowCount === 1) {
        await releaseLease(tx, conversationId, turn.token);
        return "newer-message";
      }
    }
    const at = await stamp(tx, now);
    let replyId: string | null = null;
    if (reply !== undefined) {
      const sessionId = await sessionFor(tx, tenantId, conversationId, at, "outbound");
      const stored = await tx.query<{ id: string }>(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                               status, created_at)
         VALUES ($1, $2, $3, 'outbound', 'assistant-reply', 'text', $4, 'pending', $5::timestamptz)
         RETURNING id`,
        [tenantId, conversationId, sessionId, reply, at],
      );
      replyId = stored.rows[0]?.id as string;
      await enqueueJob(tx, {
        type: SEND_MESSAGES_JOB,
        tenantId,
        subjectId: conversationId,
        payload: { conversationId },
        ...(now === undefined ? {} : { runAt: now }),
      });
    }
    await tx.query(
      `UPDATE messages SET handled_at = $2::timestamptz, answered_by = $3
       WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
      [handled, at, replyId],
    );
    await releaseLease(tx, conversationId, turn.token);
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

// An assistant reply that never reached the channel is held back while its
// session has a newer customer message no turn has dealt with: the turn for
// that message decides whether it is still wanted (design note, D2). Not
// held back: a reply whose call ended unknown, which the customer may have
// (D4); one that has waited its 15 minutes, which must be let expire (D8);
// and any reply once two in a row have been dropped (D6).
const HELD_BACK = (now: number) => `(
  m.class = 'assistant-reply' AND m.status = 'pending' AND m.unknown_outcomes = 0
  AND ${NOW(now)} - greatest(m.created_at, m.send_not_before)
      <= ${SEND_EXPIRES_MS} * interval '1 millisecond'
  AND EXISTS (
    SELECT 1 FROM sessions s WHERE s.id = m.session_id AND s.reply_discards < ${REPLY_DISCARDS_MAX})
  AND EXISTS (
    SELECT 1 FROM messages newer
    WHERE newer.session_id = m.session_id AND newer.direction = 'inbound'
      AND newer.handled_at IS NULL AND newer.created_at > m.created_at))`;

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
  WHERE m.conversation_id = $1 AND m.status IN ('pending', 'sending') AND NOT ${HELD_BACK(now)}
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
    // Throws for a conversation the tenant does not have, which is a fault
    // in the job and must not look like "nothing to send".
    if (!(await lockConversation(tx, conversationId))) {
      throw noConversation("claimNextSend");
    }
    const ended: string[] = [];
    const also = (): { ended?: readonly string[] } => (ended.length > 0 ? { ended } : {});
    // Each pass either returns or ends one message for good, so this ends.
    for (;;) {
      const found = await tx.query<Waiting>(OLDEST_WAITING(2), [conversationId, now ?? null]);
      const waiting = found.rows[0];
      if (waiting === undefined) {
        // What is left, if anything, is held back: look again later, so that
        // it is sent if the newer message is dealt with some other way, and
        // expires if nothing comes of it.
        const held = await tx.query(
          "SELECT 1 FROM messages WHERE conversation_id = $1 AND status = 'pending' LIMIT 1",
          [conversationId],
        );
        return held.rowCount > 0
          ? { kind: "wait", ms: HELD_BACK_WAIT_MS, ...also() }
          : { kind: "none", ...also() };
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
    // The conversation first, then the message: one order of locks everywhere.
    const whose = await tx.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM messages WHERE id = $1",
      [message.id],
    );
    const conversationId = whose.rows[0]?.conversation_id;
    if (conversationId === undefined || !(await lockConversation(tx, conversationId))) {
      return "superseded";
    }
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
    if (decision.next === "sent") {
      await noteAccepted(tx, message.id, await stamp(tx, now));
    }
    return decision;
  });
}
