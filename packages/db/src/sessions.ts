// Sessions (state machines, section 3; design note
// docs/design/notes/m3-u2-sessions.md, sections 0 and 1).
//
// Every function runs inside `withTenant`, after the caller has locked the
// conversation's row with `lockConversation`. That lock is what puts
// storing a message, starting a turn, ending a turn and claiming a message
// to send one after another for one conversation.
//
// A time is passed as text, as the database printed it, so that it keeps
// its microseconds: a JavaScript date has only milliseconds, and two rows
// of one webhook are a microsecond apart.

import { SESSION_INACTIVITY_MS } from "@polyglot-sales-agent/core";
import type { Tx } from "./tenant.ts";

const DAY = `${SESSION_INACTIVITY_MS} * interval '1 millisecond'`;

/**
 * Locks the conversation's row to the end of the transaction. Returns false
 * if the tenant has no such conversation.
 */
export async function lockConversation(tx: Tx, conversationId: string): Promise<boolean> {
  const found = await tx.query("SELECT 1 FROM conversations WHERE id = $1 FOR NO KEY UPDATE", [
    conversationId,
  ]);
  return found.rowCount === 1;
}

/**
 * The time to stamp on a row: the database's clock, or for a test the time
 * given plus `offset` microseconds, so that the rows of one webhook keep
 * their order.
 */
export async function stamp(tx: Tx, now: Date | undefined, offset = 0): Promise<string> {
  const read = await tx.query<{ at: string }>(
    `SELECT coalesce($1::timestamptz + $2::integer * interval '1 microsecond',
                     clock_timestamp())::text AS at`,
    [now ?? null, offset],
  );
  return read.rows[0]?.at as string;
}

export interface OpenSession {
  readonly id: string;
  readonly replyDiscards: number;
}

/**
 * The conversation's open session at `at`, or undefined. This is the only
 * place that decides whether a session is open: one whose last message is
 * 24 hours old or more is ended here, with its effects, and is not
 * returned (design note, S3, S4, S10).
 */
export async function openSession(
  tx: Tx,
  conversationId: string,
  at: string,
): Promise<OpenSession | undefined> {
  const found = await tx.query<{ id: string; reply_discards: number; over: boolean }>(
    `SELECT id, reply_discards, last_message_at + ${DAY} <= $2::timestamptz AS over
     FROM sessions WHERE conversation_id = $1 AND ended_at IS NULL FOR UPDATE`,
    [conversationId, at],
  );
  const session = found.rows[0];
  if (session === undefined) {
    return undefined;
  }
  if (!session.over) {
    return { id: session.id, replyDiscards: session.reply_discards };
  }
  await tx.query(`UPDATE sessions SET ended_at = last_message_at + ${DAY} WHERE id = $1`, [
    session.id,
  ]);
  // What ending a session does. Later units add to this one place.
  // A handover attached to it is detached: the assistant answers the
  // customer's next message, in a new session (US-C6, 8).
  await tx.query(
    `UPDATE handovers h SET state = 'detached', session_id = NULL, detached_at = s.ended_at
     FROM sessions s WHERE s.id = $1 AND h.session_id = s.id AND h.state = 'waiting'`,
    [session.id],
  );
  // Its customer messages nobody dealt with are over 24 hours old: the
  // assistant does not answer them (design note, W2; decisions row 40).
  await tx.query(
    `UPDATE messages SET handled_at = $2::timestamptz
     WHERE session_id = $1 AND direction = 'inbound' AND handled_at IS NULL`,
    [session.id, at],
  );
  // Its replies that never reached the channel are not sent into a new session.
  await tx.query(
    `UPDATE messages SET status = 'discarded', send_not_before = NULL
     WHERE session_id = $1 AND class = 'assistant-reply' AND status = 'pending'
       AND unknown_outcomes = 0`,
    [session.id],
  );
  return undefined;
}

/**
 * The session a customer's message stored at `at` belongs to: the open one,
 * whose last-message time it moves, or a new one (design note, S1 to S3).
 * A message of ours is stored in the session its turn read, and moves that
 * time only when the channel accepts it (`noteAccepted`).
 */
export async function sessionFor(
  tx: Tx,
  tenantId: string,
  conversationId: string,
  at: string,
): Promise<string> {
  const open = await openSession(tx, conversationId, at);
  if (open !== undefined) {
    await tx.query(
      `UPDATE sessions SET last_message_at = greatest(last_message_at, $2::timestamptz)
       WHERE id = $1`,
      [open.id, at],
    );
    return open.id;
  }
  const made = await tx.query<{ id: string }>(
    `INSERT INTO sessions (tenant_id, conversation_id, started_at, last_message_at)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz) RETURNING id`,
    [tenantId, conversationId, at],
  );
  return made.rows[0]?.id as string;
}

/**
 * The channel accepted a message of ours at `at`: its session's
 * last-message time moves, and an accepted assistant reply ends a run of
 * dropped replies. A session that is ended, or over by time, is never moved
 * (design note, S8, D6). Called only when the worker records that its own
 * call was accepted. A delivery or read receipt is not an acceptance and
 * does neither.
 */
export async function noteAccepted(tx: Tx, messageId: string, at: string): Promise<void> {
  await tx.query(
    `UPDATE sessions s
     SET last_message_at = greatest(s.last_message_at, $2::timestamptz),
         reply_discards = CASE WHEN m.class = 'assistant-reply' THEN 0 ELSE s.reply_discards END
     FROM messages m
     WHERE m.id = $1 AND m.direction = 'outbound' AND s.id = m.session_id
       AND s.ended_at IS NULL AND s.last_message_at + ${DAY} > $2::timestamptz`,
    [messageId, at],
  );
}
