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
  type HandoverReason,
  HELD_BACK_WAIT_MS,
  HISTORY_MESSAGES_MAX,
  HISTORY_TEXT_MAX,
  LANGUAGE_UNKNOWN,
  languageSupported,
  type MessageClass,
  REPLY_DISCARDS_MAX,
  REPLY_WINDOW_MS,
  SEND_EXPIRES_MS,
  SENDING_STALE_MS,
  type SendDecision,
  type SendOutcome,
  TOOL_RESULT_MAX,
  TOOL_RUN_TIMEOUT_MS,
  TOOL_STATEMENT_TIMEOUT_MS,
  type ToolOutcome,
  UNCONFIRMED,
} from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import {
  applyHandoverTrigger,
  detachHandover,
  emergencyToldLately,
  HANDOVER_SILENCE_HOURS,
  type HandoverResult,
  type HandoverTell,
  tellCustomer,
  waitingHandover,
} from "./handover.ts";
import { FORWARD, RECEIPT_LOCK } from "./inbound.ts";
import { enqueueJob } from "./jobs.ts";
import { holdsLease, releaseLease, renewLease, takeLease } from "./lease.ts";
import { lockConversation, noteAccepted, openSession, stamp } from "./sessions.ts";
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
  /** For a tap on a button: what the button carried. */
  readonly buttonPayload: string | null;
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
      `SELECT id, kind, body, button_payload AS "buttonPayload"
       FROM messages WHERE ${UNHANDLED} ORDER BY created_at, id`,
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
  | "newer-message"
  /**
   * The session the turn read has ended meanwhile: its 24 hours passed.
   * Nothing was stored; its messages were closed when it ended.
   */
  | "session-over"
  /**
   * The session was handed over while the turn ran: its reply is not
   * stored, and its messages are marked as dealt with.
   */
  | "handed-over";

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
export async function finishTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  turn: { readonly token: string; readonly sessionId: string },
  handled: readonly string[],
  reply: string | undefined,
  now?: Date,
  /**
   * For a reply a turn with the model made: the turn, and the language
   * the model said the customer wrote in (two small letters, or `und`).
   * Stored on the reply; a language that is not `und` becomes the
   * session's, and one that is not supported marks the session for good
   * (design note M3 U7, section 7).
   */
  made?: {
    readonly turnId: string;
    readonly language: string;
    /**
     * A fixed text code puts before the reply (the answer to "am I talking
     * to a person?"). With one, the reply itself may be empty.
     */
    readonly lead?: (given: DisclosureFor) => string;
    /**
     * The reply is the fallback: the model's answer failed a check. The
     * reply is then empty and `lead` is the fallback's text. The language
     * the refused answer reported is neither stored nor used.
     */
    readonly fallback?: boolean;
    /** What the checks said, stored with the reply (`reply_checks`). */
    readonly checks?: ReplyChecksRecord;
    /** The buttons the reply is stored with (the fallback's), in the language of its fixed part. */
    readonly buttons?: (given: DisclosureFor) => readonly StoredButton[];
    /**
     * The turn hands the session over: there is no reply, and the telling
     * is stored in this transaction (design note M3 U11, section 4).
     */
    readonly handover?: {
      readonly reasons: readonly HandoverReason[];
      readonly tell: HandoverTell;
      readonly answerIsAutomated?: boolean;
      readonly done?: (result: HandoverResult) => void;
    };
  },
): Promise<TurnEnd> {
  let madeHandover: HandoverResult | undefined;
  const ended = await withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, turn.token))) {
      return "lost-lease";
    }
    const at = await stamp(tx, now);
    // A reply is stored only in the session its turn read, and only while
    // that session is open (design note, S7).
    const open = await openSession(tx, conversationId, at);
    if (open?.id !== turn.sessionId) {
      await releaseLease(tx, conversationId, turn.token);
      return "session-over";
    }
    const handover = made?.handover;
    if (handover !== undefined && reply !== undefined) {
      throw Object.assign(new Error("a turn that hands over has no reply"), {
        code: "handover-with-reply",
      });
    }
    const markHandled = () =>
      tx.query(
        `UPDATE messages SET handled_at = $2::timestamptz
         WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
        [handled, at],
      );
    if (handover === undefined && (await waitingHandover(tx, turn.sessionId)) !== undefined) {
      // The session was handed over while the turn ran (S3): the
      // assistant does not answer it.
      await markHandled();
      await releaseLease(tx, conversationId, turn.token);
      return "handed-over";
    }
    if (handover !== undefined) {
      // A newer message of the customer does not stop a handover: it is
      // then a message in a handed-over session.
      const result = await applyHandoverTrigger(tx, {
        tenantId,
        conversationId,
        sessionId: turn.sessionId,
        reasons: handover.reasons,
        at,
        tell: handover.tell,
        ...(handover.answerIsAutomated === undefined
          ? {}
          : { answerIsAutomated: handover.answerIsAutomated }),
      });
      if (made?.checks !== undefined) {
        await insertChecks(tx, tenantId, turn.sessionId, made.turnId, at, made.checks);
      }
      await markHandled();
      await releaseLease(tx, conversationId, turn.token);
      madeHandover = result;
      return "stored";
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
    let replyId: string | null = null;
    let lead: string | null = null;
    let buttons: readonly StoredButton[] = [];
    const fallback = made?.fallback === true;
    if (fallback && (reply !== "" || made?.lead === undefined)) {
      throw Object.assign(new Error("a fallback is a fixed text and no reply"), {
        code: "fallback-with-reply",
      });
    }
    if (reply === "" && made?.lead === undefined) {
      // An empty reply is stored only beside a fixed text: alone it is nothing to send.
      throw Object.assign(new Error("an empty reply with nothing before it"), {
        code: "empty-reply",
      });
    }
    if (reply !== undefined && made?.lead !== undefined) {
      const known = await tx.query<{
        session: string | null;
        contact: string | null;
        tenant: string;
      }>(
        `SELECT s.language AS session, p.last_language AS contact, t.default_language AS tenant
         FROM conversations c
         JOIN contacts p ON p.id = c.contact_id
         JOIN tenants t ON t.id = c.tenant_id
         LEFT JOIN sessions s ON s.id = $2
         WHERE c.id = $1`,
        [conversationId, turn.sessionId],
      );
      const row = known.rows[0];
      if (row !== undefined) {
        const given = {
          preferred: [fallback ? null : made.language, row.session, row.contact],
          tenantDefault: row.tenant,
        };
        lead = made.lead(given);
        buttons = made.buttons?.(given) ?? [];
      }
    }
    if (reply !== undefined) {
      const stored = await tx.query<{ id: string }>(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                               status, created_at, turn_id, language, lead, fallback, buttons)
         VALUES ($1, $2, $3, 'outbound', 'assistant-reply', 'text', $4, 'pending', $5::timestamptz,
                 $6, $7, $8, $9, $10::jsonb)
         RETURNING id`,
        [
          tenantId,
          conversationId,
          turn.sessionId,
          // A lead alone: the model wrote nothing beside the fixed text.
          reply === "" ? null : reply,
          at,
          made?.turnId ?? null,
          // A refused answer's word on the language is not stored: unknown.
          fallback ? LANGUAGE_UNKNOWN : (made?.language ?? null),
          lead,
          fallback,
          buttons.length === 0 ? null : JSON.stringify(buttons),
        ],
      );
      replyId = stored.rows[0]?.id as string;
      if (made?.checks !== undefined) {
        await insertChecks(tx, tenantId, turn.sessionId, made.turnId, at, made.checks);
      }
      if (made !== undefined && !fallback && made.language !== LANGUAGE_UNKNOWN) {
        await tx.query(
          `UPDATE sessions SET language = $2, unsupported_language = unsupported_language OR $3
           WHERE id = $1`,
          [turn.sessionId, made.language, !languageSupported(made.language)],
        );
        if (languageSupported(made.language)) {
          // What a fixed text is sent in when nothing newer is known. An
          // unsupported language does not replace a supported one.
          await tx.query(
            `UPDATE contacts SET last_language = $2
             WHERE id = (SELECT contact_id FROM conversations WHERE id = $1)`,
            [conversationId, made.language],
          );
        }
      }
      await enqueueJob(tx, {
        type: SEND_MESSAGES_JOB,
        tenantId,
        subjectId: conversationId,
        payload: { conversationId },
        ...(now === undefined ? {} : { runAt: now }),
      });
    }
    // A batch with text ends a run of batches that could not be read (U10a, N3).
    await tx.query(
      `UPDATE sessions SET unreadable_batches = 0
       WHERE id = $1 AND unreadable_batches <> 0
         AND EXISTS (SELECT 1 FROM messages
                     WHERE id = ANY($2::uuid[]) AND direction = 'inbound' AND kind = 'text')`,
      [turn.sessionId, handled],
    );
    await tx.query(
      `UPDATE messages SET handled_at = $2::timestamptz, answered_by = $3
       WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
      [handled, at, replyId],
    );
    await releaseLease(tx, conversationId, turn.token);
    return "stored";
  });
  if (madeHandover !== undefined) {
    made?.handover?.done?.(madeHandover);
  }
  return ended;
}

async function insertChecks(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  turnId: string,
  at: string,
  checks: ReplyChecksRecord,
): Promise<void> {
  await tx.query(
    `INSERT INTO reply_checks (tenant_id, session_id, turn_id, created_at, outcome,
                               o1, o7, o6, o3, o5)
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)`,
    [
      tenantId,
      sessionId,
      turnId,
      at,
      checks.outcome,
      checks.o1,
      checks.o7 ?? null,
      checks.o6 ?? null,
      checks.o3 ?? null,
      checks.o5 ?? null,
    ],
  );
}

/**
 * Step 10 of the order of checks: what a turn does first with a session
 * that is handed over. The batch is marked as dealt with and the assistant
 * does not answer. Returns "none" when the session is not handed over, or
 * when its 24 hours of silence have run out and the handover is detached
 * here (design note M3 U11, section 5).
 */
export function joinHandover(
  app: Database,
  tenantId: string,
  conversationId: string,
  turn: { readonly token: string; readonly sessionId: string },
  handled: readonly string[],
  given: {
    /** The batch holds a tap on the person button. */
    readonly tapped: boolean;
    readonly tell: HandoverTell;
    readonly now?: Date;
  },
): Promise<"none" | "handed-over" | "lost-lease"> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, turn.token))) {
      return "lost-lease";
    }
    const at = await stamp(tx, given.now);
    const waiting = await waitingHandover(tx, turn.sessionId);
    if (waiting === undefined) {
      return "none";
    }
    const over = await tx.query<{ at: string }>(
      `SELECT ($1::timestamptz + $2::integer * interval '1 hour')::text AS at
       WHERE $1::timestamptz + $2::integer * interval '1 hour' <= $3::timestamptz`,
      [waiting.attachedAt, HANDOVER_SILENCE_HOURS, at],
    );
    if (over.rows[0] !== undefined) {
      await detachHandover(tx, turn.sessionId, over.rows[0].at);
      return "none";
    }
    const trigger = { tenantId, conversationId, sessionId: turn.sessionId, at, tell: given.tell };
    if (given.tapped) {
      // S2: the tap adds its reason to the handover the session already has.
      await applyHandoverTrigger(tx, { ...trigger, reasons: ["requested"] });
    }
    // Told again only if every telling of **this attachment** failed or
    // expired: a telling of an earlier time the same record was attached
    // does not count. An urgent handover needs the emergency text among
    // them, unless the contact was sent it within the hour.
    const live = await tx.query<{ tells: string }>(
      `SELECT m.tells FROM messages m JOIN handovers h ON h.id = m.handover_id
       WHERE h.id = $1 AND m.created_at >= h.attached_at
         AND m.status IN ('pending', 'sending', 'sent', 'delivered', 'read')`,
      [waiting.id],
    );
    const lately = waiting.urgent && (await emergencyToldLately(tx, trigger));
    const needsEmergency =
      waiting.urgent && !lately && !live.rows.some((row) => row.tells === "emergency");
    if (live.rowCount === 0 || needsEmergency) {
      await tellCustomer(tx, trigger, waiting.id, needsEmergency);
    }
    await tx.query(
      `UPDATE messages SET handled_at = $2::timestamptz
       WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
      [handled, at],
    );
    await releaseLease(tx, conversationId, turn.token);
    return "handed-over";
  });
}

/** How many batches in a row may go unread before the session is handed over. */
export const UNREADABLE_BATCHES_MAX = 3;

/**
 * An emergency (order of checks, step 4a; design note M3 U10a, section
 * 2.3): ends the turn in one transaction. A handover whose 24 hours are
 * over is detached first, so that the trigger attaches it again with a
 * new time and the session stays handed over; the trigger is applied; the
 * batch is marked as dealt with. The model is not called.
 */
export function raiseEmergency(
  app: Database,
  tenantId: string,
  conversationId: string,
  turn: { readonly token: string; readonly sessionId: string },
  handled: readonly string[],
  given: {
    /** The batch holds a tap on the person button too: its reason is not lost. */
    readonly tapped: boolean;
    readonly tell: HandoverTell;
    readonly now?: Date;
  },
): Promise<HandoverResult | "lost-lease" | "session-over"> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, turn.token))) {
      return "lost-lease";
    }
    const at = await stamp(tx, given.now);
    const open = await openSession(tx, conversationId, at);
    if (open?.id !== turn.sessionId) {
      // The session ended while the turn waited: its messages were marked
      // as dealt with when it was ended, and nothing is stored in it. An
      // emergency in that batch gets nothing (the note, 2.4; #341).
      await releaseLease(tx, conversationId, turn.token);
      return "session-over";
    }
    const waiting = await waitingHandover(tx, turn.sessionId);
    if (waiting !== undefined) {
      const over = await tx.query<{ at: string }>(
        `SELECT ($1::timestamptz + $2::integer * interval '1 hour')::text AS at
         WHERE $1::timestamptz + $2::integer * interval '1 hour' <= $3::timestamptz`,
        [waiting.attachedAt, HANDOVER_SILENCE_HOURS, at],
      );
      if (over.rows[0] !== undefined) {
        await detachHandover(tx, turn.sessionId, over.rows[0].at);
      }
    }
    const result = await applyHandoverTrigger(tx, {
      tenantId,
      conversationId,
      sessionId: turn.sessionId,
      reasons: given.tapped ? ["emergency", "requested"] : ["emergency"],
      at,
      tell: given.tell,
    });
    await tx.query(
      `UPDATE messages SET handled_at = $2::timestamptz
       WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
      [handled, at],
    );
    await releaseLease(tx, conversationId, turn.token);
    return result;
  });
}

/** What the unsupported-type reply is made from: the session's language, the contact's last. */
export type UnreadableReply = (given: DisclosureFor) => {
  readonly body: string;
  readonly buttons: readonly StoredButton[];
};

/**
 * A batch that cannot be read (order of checks, step 13; design note M3
 * U10a, section 3): the fixed reply is stored to be sent and the session's
 * count goes up; the third such batch in a row hands the session over
 * instead, and the customer is told that and not the reply.
 */
export function answerUnreadable(
  app: Database,
  tenantId: string,
  conversationId: string,
  turn: { readonly token: string; readonly sessionId: string },
  handled: readonly string[],
  given: { readonly reply: UnreadableReply; readonly tell: HandoverTell; readonly now?: Date },
): Promise<
  | { readonly kind: "replied"; readonly count: number }
  | { readonly kind: "handed-over"; readonly result: HandoverResult }
  | { readonly kind: "already-handed-over" | "lost-lease" | "session-over" }
> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    if (!(await holdsLease(tx, conversationId, turn.token))) {
      return { kind: "lost-lease" } as const;
    }
    const at = await stamp(tx, given.now);
    const open = await openSession(tx, conversationId, at);
    if (open?.id !== turn.sessionId) {
      await releaseLease(tx, conversationId, turn.token);
      return { kind: "session-over" } as const;
    }
    const markHandled = (answeredBy: string | null) =>
      tx.query(
        `UPDATE messages SET handled_at = $2::timestamptz, answered_by = $3
         WHERE id = ANY($1::uuid[]) AND direction = 'inbound' AND handled_at IS NULL`,
        [handled, at, answeredBy],
      );
    if ((await waitingHandover(tx, turn.sessionId)) !== undefined) {
      // Handed over since the turn looked (step 10): nothing is sent, nothing counted.
      await markHandled(null);
      await releaseLease(tx, conversationId, turn.token);
      return { kind: "already-handed-over" } as const;
    }
    const known = await tx.query<{
      count: number;
      session: string | null;
      contact: string | null;
      tenant: string;
    }>(
      `SELECT s.unreadable_batches AS count, s.language AS session, p.last_language AS contact,
              t.default_language AS tenant
       FROM sessions s
       JOIN conversations c ON c.id = s.conversation_id
       JOIN contacts p ON p.id = c.contact_id
       JOIN tenants t ON t.id = c.tenant_id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [turn.sessionId],
    );
    const row = known.rows[0];
    if (row === undefined) {
      throw new Error("a turn for a session that is not there");
    }
    if (row.count + 1 >= UNREADABLE_BATCHES_MAX) {
      // The trigger sets the count to 0: the session is handed over now.
      const result = await applyHandoverTrigger(tx, {
        tenantId,
        conversationId,
        sessionId: turn.sessionId,
        reasons: ["unsupported-content"],
        at,
        tell: given.tell,
      });
      await markHandled(null);
      await releaseLease(tx, conversationId, turn.token);
      return { kind: "handed-over", result } as const;
    }
    const reply = given.reply({ preferred: [row.session, row.contact], tenantDefault: row.tenant });
    const stored = await tx.query<{ id: string }>(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                             status, created_at, buttons)
       VALUES ($1, $2, $3, 'outbound', 'system-reply', 'text', $4, 'pending', $5::timestamptz,
               $6::jsonb)
       RETURNING id`,
      [
        tenantId,
        conversationId,
        turn.sessionId,
        reply.body,
        at,
        reply.buttons.length === 0 ? null : JSON.stringify(reply.buttons),
      ],
    );
    await tx.query("UPDATE sessions SET unreadable_batches = $2 WHERE id = $1", [
      turn.sessionId,
      row.count + 1,
    ]);
    await enqueueJob(tx, {
      type: SEND_MESSAGES_JOB,
      tenantId,
      subjectId: conversationId,
      payload: { conversationId },
      ...(given.now === undefined ? {} : { runAt: given.now }),
    });
    await markHandled(stored.rows[0]?.id as string);
    await releaseLease(tx, conversationId, turn.token);
    return { kind: "replied", count: row.count + 1 } as const;
  });
}

/**
 * Extends a turn's lease, before each call to the model. False if the
 * conversation is no longer this worker's: the turn must then stop.
 */
export function renewTurn(
  app: Database,
  tenantId: string,
  conversationId: string,
  token: string,
  now?: Date,
): Promise<boolean> {
  return withTenant(poolOf(app), tenantId, (tx) => renewLease(tx, conversationId, token, now));
}

/** An earlier message of a session, as a request holds it. */
export interface HistoryMessage {
  readonly role: "customer" | "assistant";
  /** Written by the customer, or by a model answering one. Untrusted either way. */
  readonly text: string;
}

/**
 * The session so far, oldest first, for a request to the model (design
 * note M3 U7, section 4): the customer's texts a turn has dealt with, and
 * the assistant's replies the customer has or may have. Never a staff
 * member's message, a fixed text, a notice or a message the business
 * began; never a row whose text is gone. The newest that fit both bounds.
 */
export function sessionHistory(
  app: Database,
  tenantId: string,
  sessionId: string,
): Promise<HistoryMessage[]> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const found = await tx.query<{ direction: string; body: string }>(
      `SELECT direction, body FROM messages
       WHERE session_id = $1 AND kind = 'text' AND body IS NOT NULL AND body <> ''
         AND ((direction = 'inbound' AND handled_at IS NOT NULL)
           OR (direction = 'outbound' AND class = 'assistant-reply'
               AND (status IN ('sent', 'delivered', 'read')
                    OR (status = 'failed' AND error_code = $3))))
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [sessionId, HISTORY_MESSAGES_MAX, UNCONFIRMED],
    );
    const kept: HistoryMessage[] = [];
    let size = 0;
    for (const row of found.rows) {
      size += row.body.length;
      // Stop at the first that does not fit: a history with a hole in it
      // would put a reply beside a question it did not answer.
      if (size > HISTORY_TEXT_MAX) {
        break;
      }
      kept.push({ role: row.direction === "inbound" ? "customer" : "assistant", text: row.body });
    }
    return kept.reverse();
  });
}

/** What a tool gives back: plain data, or that the arguments are not ones it takes. */
export type ToolReturn =
  | { readonly outcome: "done"; readonly result: unknown }
  | { readonly outcome: "refused" };

export type ToolRun =
  /** The conversation is no longer this worker's. The tool was not run and nothing was stored. */
  | { readonly kind: "lost-lease" }
  | { readonly kind: "ran"; readonly outcome: ToolOutcome; readonly result: unknown };

/**
 * Runs one tool for a turn and records it (design note M3 U7, section 6).
 * The transaction first checks the turn's lease, then runs the tool and
 * stores its row. A tool that throws, takes too long, or returns what is
 * not plain data of a bounded size has its whole transaction undone; its
 * row is then stored as `failed` in a second transaction that checks the
 * lease again. A tool's own message is never stored.
 */
export async function runTool(
  app: Database,
  tenantId: string,
  call: {
    readonly conversationId: string;
    readonly token: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly tool: string;
    /** As the model wrote them. Treated as the customer's text. */
    readonly arguments: unknown;
  },
  run: (tx: Tx) => Promise<ToolReturn>,
  timeoutMs: number = TOOL_RUN_TIMEOUT_MS,
): Promise<ToolRun> {
  const store = (tx: Tx, outcome: ToolOutcome, result: string | null, began: string) =>
    tx.query(
      `INSERT INTO tool_calls (tenant_id, session_id, turn_id, tool, arguments, result, outcome,
                               created_at, ended_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::timestamptz,
               greatest(clock_timestamp(), $8::timestamptz))`,
      [tenantId, call.sessionId, call.turnId, call.tool, asked, result, outcome, began],
    );
  // What cannot be stored as JSON (a U+0000 in a text or a key) is not
  // stored: the row says the tool ran, without what it was asked.
  let asked: string | null = null;
  try {
    let nul = false;
    const text = JSON.stringify(call.arguments ?? null, (key, value) => {
      nul ||= key.includes("\u0000") || (typeof value === "string" && value.includes("\u0000"));
      return value;
    });
    asked = typeof text === "string" && !nul ? text : null;
  } catch {
    asked = null;
  }
  const lost = Symbol("lost");
  let began: string | undefined;
  try {
    const ran = await withTenant(poolOf(app), tenantId, async (tx) => {
      if (!(await holdsLease(tx, call.conversationId, call.token))) {
        return lost;
      }
      began = await stamp(tx, undefined);
      // The limit on the tool's wait does not stop a statement that is
      // already running; this does, so the conversation's row is not held
      // for longer than the two together.
      await tx.query(
        `SET LOCAL statement_timeout = ${Math.max(1, Math.min(TOOL_STATEMENT_TIMEOUT_MS, Math.floor(timeoutMs)))}`,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      // A tool that is still running after its time, or after its
      // transaction ended, can ask nothing more of the connection: the
      // connection goes back to the pool and may be another tenant's next.
      let over = false;
      const guarded = {
        query: ((...query: unknown[]) => {
          if (over) {
            return Promise.reject(new Error("the tool's transaction is over"));
          }
          return (tx.query as (...given: unknown[]) => unknown)(...query);
        }) as Tx["query"],
      } as Tx;
      const returned = await Promise.race([
        run(guarded),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("the tool took too long")), timeoutMs);
        }),
      ]).finally(() => {
        clearTimeout(timer);
        over = true;
      });
      if (returned?.outcome === "refused") {
        await store(tx, "refused", null, began);
        return { kind: "ran", outcome: "refused", result: null } as const;
      }
      if (returned?.outcome !== "done") {
        throw new Error("a tool returns done with a result, or refused");
      }
      const text = JSON.stringify(returned.result);
      if (typeof text !== "string" || text.length > TOOL_RESULT_MAX) {
        throw new Error("a tool's result is plain data of a bounded size");
      }
      await store(tx, "done", text, began);
      // What is given on is what was stored: the result as JSON reads it back.
      return { kind: "ran", outcome: "done", result: JSON.parse(text) } as const;
    });
    return ran === lost ? { kind: "lost-lease" } : (ran as ToolRun);
  } catch {
    // Everything the tool wrote is undone. What is recorded is that it failed.
    return withTenant(poolOf(app), tenantId, async (tx) => {
      if (!(await holdsLease(tx, call.conversationId, call.token))) {
        return { kind: "lost-lease" } as const;
      }
      await store(tx, "failed", null, began ?? (await stamp(tx, undefined)));
      return { kind: "ran", outcome: "failed", result: null } as const;
    });
  }
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
/**
 * What the checks said of a turn's answer: each `passed`, a code of the
 * checker's list, or left out when the check did not run.
 */
export interface ReplyChecksRecord {
  readonly outcome: "passed" | "blocked" | "error" | "handed-over";
  readonly o1: string;
  readonly o7?: string;
  readonly o6?: string;
  readonly o3?: string;
  readonly o5?: string;
}

/** A button as a message is stored with it and sent: what it carries, and the title shown. */
export interface StoredButton {
  readonly payload: string;
  readonly title: string;
}

/** What the disclosure is decided from (design note M3 U8, section 3). */
export interface DisclosureFor {
  /** The language the message's own turn reported, the session's, the contact's last. */
  readonly preferred: readonly (string | null)[];
  readonly tenantDefault: string;
}

export interface MessageToSend {
  readonly id: string;
  /** Which call this is, from 1. Presented again when the result is recorded. */
  readonly attempt: number;
  readonly class: MessageClass;
  readonly kind: string;
  readonly body: string | null;
  /** The disclosure, when this message is the one that tells the session's customer. */
  readonly disclosure: string | null;
  /** A fixed text put before the body by code. */
  readonly lead: string | null;
  readonly buttons: readonly StoredButton[] | null;
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
  lead: string | null;
  buttons: StoredButton[] | null;
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
  SELECT m.id, m.class, m.kind, m.body, m.lead, m.buttons, m.status, m.send_attempts,
         m.unknown_outcomes,
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
  /**
   * The disclosure's text for a message of a session whose customer has
   * not been told. Without it nothing is disclosed: only a caller that has
   * no fixed texts, in a test, leaves it out.
   */
  disclose?: (given: DisclosureFor) => string,
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
      // Decided afresh at each try, in the transaction that marks the
      // message as being sent: the disclosure if the session's customer
      // has not been told, none if another message told them meanwhile.
      const told = await tx.query<{
        message: string | null;
        session: string | null;
        contact: string | null;
        tenant: string;
      }>(
        `SELECT m.language AS message, s.language AS session, p.last_language AS contact,
                t.default_language AS tenant
         FROM messages m
         JOIN sessions s ON s.id = m.session_id AND s.disclosed_at IS NULL
         JOIN conversations c ON c.id = m.conversation_id
         JOIN contacts p ON p.id = c.contact_id
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.id = $1`,
        [waiting.id],
      );
      const untold = told.rows[0];
      const disclosure =
        untold === undefined || disclose === undefined
          ? null
          : disclose({
              preferred: [untold.message, untold.session, untold.contact],
              tenantDefault: untold.tenant,
            });
      await tx.query(
        `UPDATE messages SET status = 'sending', sending_at = ${NOW(2)},
                             send_attempts = send_attempts + 1, send_not_before = NULL,
                             disclosure = $3
         WHERE id = $1`,
        [waiting.id, now ?? null, disclosure],
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
          disclosure,
          lead: waiting.lead,
          buttons: waiting.buttons,
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
export async function recordSend(
  app: Database,
  tenantId: string,
  message: Pick<MessageToSend, "id" | "attempt">,
  result: CallResult,
  now?: Date,
  /** True when a message stored with buttons was sent without them: the record then has none. */
  buttonsDropped?: boolean,
  /** How the customer is told of a handover made here, and where that is reported. */
  handover?: { readonly tell: HandoverTell; readonly done?: (result: HandoverResult) => void },
): Promise<SendDecision | "superseded"> {
  let madeHandover: HandoverResult | undefined;
  const decided = await withTenant(poolOf(app), tenantId, async (tx) => {
    // The conversation first, then the message: one order of locks everywhere.
    const whose = await tx.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM messages WHERE id = $1",
      [message.id],
    );
    const conversationId = whose.rows[0]?.conversation_id;
    if (conversationId === undefined || !(await lockConversation(tx, conversationId))) {
      return "superseded";
    }
    // One order of locks everywhere: the conversation, the channel's
    // identifier, the message, the session. A receipt takes the last three.
    if (result.kind === "accepted") {
      await tx.query(RECEIPT_LOCK, [result.channelMessageId]);
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
      if (result.kind === "accepted") {
        // Receipts that arrived before this record: applied now, in the
        // order they arrived, as they would have been had the record been
        // first. Of two kept in one moment a failure goes first: a failure
        // can no longer be applied once the message counts as delivered.
        const early = await tx.query<{ status: string; error_code: string | null }>(
          `WITH kept AS (
             DELETE FROM early_receipts WHERE channel_message_id = $1
             RETURNING status, error_code, created_at)
           SELECT status, error_code FROM kept
           ORDER BY created_at, (status = 'failed') DESC, status`,
          [result.channelMessageId],
        );
        for (const receipt of early.rows) {
          await tx.query(FORWARD, [result.channelMessageId, receipt.status, receipt.error_code]);
        }
      }
      // The session's customer has been told once the channel has accepted
      // a message that carried the disclosure. A send that failed, or whose
      // outcome is not known, tells nobody: the next message carries it.
      await tx.query(
        `UPDATE sessions s SET disclosed_at = ${NOW(2)}
         FROM messages m
         WHERE m.id = $1 AND m.disclosure IS NOT NULL AND m.status <> 'failed'
           AND s.id = m.session_id AND s.disclosed_at IS NULL`,
        [message.id, now ?? null],
      );
      // The count of fallbacks in a row that the customer was sent: plus 1
      // for a fallback the channel accepted, 0 for any other reply of the
      // assistant. A message that is refused, discarded or expires is
      // never here, and changes nothing (design note M3 U9, fallback, 3).
      await tx.query(
        `UPDATE sessions s
         SET guardrail_fallbacks = CASE WHEN m.fallback THEN least(s.guardrail_fallbacks + 1, 100)
                                        ELSE 0 END
         FROM messages m
         WHERE m.id = $1 AND m.class = 'assistant-reply' AND m.status <> 'failed'
           AND s.id = m.session_id`,
        [message.id],
      );
      // Two fallbacks in a row that the customer was sent: the session is
      // handed over (US-C6, 2), here, under the conversation's lock, and
      // only while the fallback's session is still the open one.
      if (handover !== undefined) {
        const twice = await tx.query<{ session_id: string }>(
          `SELECT m.session_id FROM messages m JOIN sessions s ON s.id = m.session_id
           WHERE m.id = $1 AND m.fallback AND m.status <> 'failed'
             AND s.guardrail_fallbacks >= 2`,
          [message.id],
        );
        const sessionId = twice.rows[0]?.session_id;
        if (sessionId !== undefined) {
          const at = await stamp(tx, now);
          const open = await openSession(tx, conversationId, at);
          if (open?.id === sessionId) {
            madeHandover = await applyHandoverTrigger(tx, {
              tenantId,
              conversationId,
              sessionId,
              reasons: ["repeated-failure"],
              at,
              tell: handover.tell,
            });
          }
        }
      }
      // The text went without its buttons: the record says what was shown.
      if (buttonsDropped === true) {
        await tx.query("UPDATE messages SET buttons = NULL WHERE id = $1", [message.id]);
      }
    }
    return decision;
  });
  // Reported once the transaction has committed: a handover that was rolled back is not told of.
  if (madeHandover !== undefined) {
    handover?.done?.(madeHandover);
  }
  return decided;
}
