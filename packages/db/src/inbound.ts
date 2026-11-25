// What the channel webhook writes (`docs/design/api.md`, section 3; the
// table of event kinds is in `docs/design/architecture.md`, "What the
// webhook does with each kind of event"). Everything here is safe to run
// again for the same webhook: the channel sends a webhook again whenever it
// was not answered 200, and may do so after a run that did commit.

import { BATCH_QUIET_MS, OPERATOR_ALERT_JOB } from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import { enqueueJob } from "./jobs.ts";
import { lockConversation, sessionFor, stamp } from "./sessions.ts";
import { type Tx, withTenant } from "./tenant.ts";

/** The job that makes a worker look at a conversation. */
export const PROCESS_CONVERSATION_JOB = "process-conversation";

export interface IncomingMessage {
  readonly channelMessageId: string;
  /** E.164, or null when the channel gave none. */
  readonly phone: string | null;
  /** The channel's own identifier for the customer, or null. One of the two is set. */
  readonly userId: string | null;
  /**
   * `text`, `button` for a tap that was read, or the channel's name for a
   * type this version does not read.
   */
  readonly kind: string;
  /**
   * The text, for a text message; null otherwise. Untrusted. Only a text's
   * body is the customer's words: a tap has none.
   */
  readonly body: string | null;
  /** For a tap: what the button carried. Untrusted. Set exactly when `kind` is `button`. */
  readonly buttonPayload?: string | null;
  /** For a tap: the channel's identifier of the message it answers, if it named one. */
  readonly inReplyTo?: string | null;
  /** For a text typed under a picture or a video: which. */
  readonly captionOf?: "image" | "video" | null;
  /** When the channel says it was sent. */
  readonly sentAt: Date;
}

export interface IncomingStatus {
  readonly channelMessageId: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
  /** The channel's code for a failed message, or null. */
  readonly errorCode: string | null;
}

export interface StoredBatch {
  /** Messages stored now. */
  readonly stored: number;
  /** Messages that were already stored: a redelivery. */
  readonly duplicates: number;
  /** Statuses that moved one of this tenant's messages forward. */
  readonly statusesApplied: number;
}

/** The tenant a receiving number belongs to, if any. The handle is the cross-tenant role's. */
export async function tenantOfReceivingNumber(
  cross: Database,
  receivingNumberId: string,
): Promise<string | undefined> {
  const result = await poolOf(cross).query<{ tenant_id: string }>(
    "SELECT tenant_id FROM channel_routes WHERE receiving_number_id = $1",
    [receivingNumberId],
  );
  return result.rows[0]?.tenant_id;
}

/**
 * Finds the contact for a customer, or makes one. The rules, each of which
 * has a row in `docs/design/data-model.md`, "Which contact a message
 * belongs to":
 *
 * - The channel's identifier is the person. A contact with the identifier
 *   is the contact, whatever number comes with it.
 * - A number belongs to the identifier the channel last sent it with. When
 *   it arrives with an identifier, a contact with another identifier that
 *   holds it loses it, and this person's contact takes it. A contact that
 *   holds it with no identifier keeps it.
 * - With no contact for the identifier, a contact that holds the number
 *   with no identifier is the person, and takes the identifier.
 * - With no identifier, the number alone decides.
 * - An identifier is never changed, and no contact is ever given another's
 *   conversation.
 *
 * Two webhooks for one new customer at the same moment end with one contact.
 */
async function contactFor(
  tx: Tx,
  tenantId: string,
  who: { phone: string | null; userId: string | null },
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (who.userId !== null && who.phone !== null) {
      // The channel says this number is this person's now: nobody else's.
      // (`IS NOT NULL` changes nothing, since NULL <> $2 is never true; it is there for the reader.)
      await tx.query(
        `UPDATE contacts SET phone = NULL
         WHERE phone = $1 AND channel_user_id IS NOT NULL AND channel_user_id <> $2`,
        [who.phone, who.userId],
      );
    }
    if (who.userId !== null) {
      const byIdentifier = await tx.query<{ id: string; phone: string | null }>(
        "SELECT id, phone FROM contacts WHERE channel_user_id = $1",
        [who.userId],
      );
      const known = byIdentifier.rows[0];
      if (known !== undefined) {
        if (who.phone !== null && who.phone !== known.phone) {
          // Not taken from a contact with no identifier: the two may be one person, and nothing merges them.
          await tx.query(
            `UPDATE contacts SET phone = $2
             WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM contacts WHERE phone = $2)`,
            [known.id, who.phone],
          );
        }
        return known.id;
      }
    }
    if (who.phone !== null) {
      const byNumber = await tx.query<{ id: string }>("SELECT id FROM contacts WHERE phone = $1", [
        who.phone,
      ]);
      const known = byNumber.rows[0];
      if (known !== undefined) {
        if (who.userId === null) {
          return known.id;
        }
        // It has no identifier, or it would have lost the number above.
        const taken = await tx.query(
          "UPDATE contacts SET channel_user_id = $2 WHERE id = $1 AND channel_user_id IS NULL",
          [known.id, who.userId],
        );
        if (taken.rowCount === 1) {
          return known.id;
        }
        // Another transaction gave it an identifier first: look again.
        continue;
      }
    }
    const made = await tx.query<{ id: string }>(
      `INSERT INTO contacts (tenant_id, phone, channel_user_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId, who.phone, who.userId],
    );
    if (made.rows[0] !== undefined) {
      return made.rows[0].id;
    }
    // Another transaction made it between the look and the insert: look again.
  }
  throw Object.assign(new Error("contactFor: the contact could not be found or made"), {
    code: "contact-conflict",
  });
}

async function conversationFor(
  tx: Tx,
  tenantId: string,
  contactId: string,
  channelAccountId: string,
): Promise<string> {
  const found = await tx.query<{ id: string }>(
    `WITH made AS (
       INSERT INTO conversations (tenant_id, contact_id, channel_account_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, contact_id) DO NOTHING RETURNING id
     )
     SELECT id FROM made UNION ALL SELECT id FROM conversations WHERE contact_id = $2 LIMIT 1`,
    [tenantId, contactId, channelAccountId],
  );
  return found.rows[0]?.id as string;
}

// A status only ever moves a message forward. `read` may arrive before
// `delivered`. A status is matched on the channel's identifier, which a
// message has only once the worker has recorded that its call was accepted,
// so the `sending` cases below cannot match today (#290: a status that
// arrives before that record is lost).
// A failure's code is kept with it.
/**
 * Taken, for the transaction, by whoever applies a receipt and by whoever
 * records the send it is about: so that a receipt either finds the
 * message or is kept before the record looks for it.
 */
export const RECEIPT_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";

export const FORWARD = `
  UPDATE messages SET status = $2, sending_at = NULL,
                      error_code = CASE WHEN $2 = 'failed' THEN $3 ELSE error_code END
  WHERE channel_message_id = $1 AND direction = 'outbound' AND (
       ($2 = 'sent' AND status = 'sending')
    OR ($2 = 'delivered' AND status IN ('sending', 'sent'))
    OR ($2 = 'read' AND status IN ('sending', 'sent', 'delivered'))
    OR ($2 = 'failed' AND status IN ('sending', 'sent')))`;

/**
 * Stores one tenant's events from one webhook, in one transaction: each new
 * message with its contact and conversation, and one job per conversation
 * that got a new message. A message already stored is skipped, and queues
 * nothing. The handle is the application role's.
 *
 * Messages already stored are found with one query before anything else,
 * so that a webhook sent again costs little however large it is.
 */
export function storeInbound(
  app: Database,
  tenantId: string,
  receivingNumberId: string,
  messages: readonly IncomingMessage[],
  statuses: readonly IncomingStatus[],
  now?: Date,
): Promise<StoredBatch> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const account = await tx.query<{ id: string }>(
      "SELECT id FROM channel_accounts WHERE receiving_number_id = $1",
      [receivingNumberId],
    );
    const channelAccountId = account.rows[0]?.id;
    if (channelAccountId === undefined) {
      throw Object.assign(new Error("storeInbound: the tenant has no such receiving number"), {
        code: "no-channel-account",
      });
    }
    const already = await tx.query<{ channel_message_id: string }>(
      `SELECT channel_message_id FROM messages
       WHERE direction = 'inbound' AND channel_message_id = ANY($1)`,
      [messages.map((message) => message.channelMessageId)],
    );
    const seen = new Set(already.rows.map((row) => row.channel_message_id));
    let stored = 0;
    let duplicates = 0;
    const touched = new Set<string>();
    for (const message of messages) {
      if (seen.has(message.channelMessageId)) {
        duplicates += 1;
        continue;
      }
      seen.add(message.channelMessageId);
      const contactId = await contactFor(tx, tenantId, message);
      // Locks are taken in one order everywhere: contact, conversation, session, message.
      await tx.query("SELECT 1 FROM contacts WHERE id = $1 FOR NO KEY UPDATE", [contactId]);
      const conversationId = await conversationFor(tx, tenantId, contactId, channelAccountId);
      // From here to the end of the transaction nothing else stores a
      // message, starts or ends a turn, or claims a send for this
      // conversation (design note, section 0).
      await lockConversation(tx, conversationId);
      // Looked for again under the lock, so that a webhook delivered twice at
      // the same moment starts no session and opens no window the second time.
      const again = await tx.query(
        "SELECT 1 FROM messages WHERE direction = 'inbound' AND channel_message_id = $1",
        [message.channelMessageId],
      );
      if (again.rowCount > 0) {
        duplicates += 1;
        continue;
      }
      // The clock is read for each row, so that messages of one webhook keep their order.
      const at = await stamp(tx, now, stored);
      const sessionId = await sessionFor(tx, tenantId, conversationId, at);
      await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, kind,
                               channel_message_id, body, channel_sent_at, created_at,
                               button_payload, in_reply_to, caption_of)
         VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7, $8::timestamptz, $9, $10, $11)`,
        [
          tenantId,
          conversationId,
          sessionId,
          message.kind,
          message.channelMessageId,
          message.body,
          message.sentAt,
          at,
          message.buttonPayload ?? null,
          message.inReplyTo ?? null,
          message.captionOf ?? null,
        ],
      );
      // The reply window opens from the earlier of the channel's time for
      // the message and ours, and never moves back (design note, W1).
      await tx.query(
        `UPDATE contacts
         SET last_inbound_at = greatest(
               last_inbound_at,
               least(coalesce($2::timestamptz, $3::timestamptz), $3::timestamptz))
         WHERE id = $1`,
        [contactId, message.sentAt, at],
      );
      stored += 1;
      touched.add(conversationId);
    }
    // Each conversation that got a message gets a job, due when its batching
    // window can first close. The turn checks the window itself, so a job
    // that is early, late or doubled does no harm; none is ever left out
    // because another exists (design note, section 3).
    for (const conversationId of touched) {
      await enqueueJob(tx, {
        type: PROCESS_CONVERSATION_JOB,
        tenantId,
        subjectId: conversationId,
        payload: { conversationId },
        ...(now === undefined ? {} : { runAt: now }),
        runInMs: BATCH_QUIET_MS,
      });
    }
    let statusesApplied = 0;
    // Every identifier's lock first, in one order, before any row a status
    // changes: two webhooks, or a webhook and the record of a send, then
    // never wait for each other in a ring.
    for (const id of [...new Set(statuses.map((status) => status.channelMessageId))].sort()) {
      await tx.query(RECEIPT_LOCK, [id]);
    }
    for (const status of statuses) {
      // A status never moves a session's time or ends a run of dropped
      // replies: a receipt is not a message, and the acceptance itself is
      // recorded by the worker that made the call (`recordSend`).
      const moved = await tx.query(FORWARD, [
        status.channelMessageId,
        status.status,
        status.errorCode,
      ]);
      statusesApplied += moved.rowCount;
      if (moved.rowCount === 0) {
        // No message of ours has this identifier yet: the send may not be
        // recorded. Kept, and applied when it is.
        const kept = await tx.query(
          `INSERT INTO early_receipts (tenant_id, channel_message_id, status, error_code)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM messages WHERE channel_message_id = $2 AND direction = 'outbound')
           ON CONFLICT DO NOTHING`,
          [tenantId, status.channelMessageId, status.status, status.errorCode],
        );
        if (kept.rowCount > 0) {
          await tx.query("DELETE FROM early_receipts WHERE created_at < now() - interval '1 day'");
        }
      }
      if (status.status === "failed" && moved.rowCount > 0) {
        // A message the channel accepted and now reports failed told
        // nobody. If it carried the disclosure, the session's mark comes
        // off, unless another message that carried it reached the customer:
        // the next message sent then carries it (design note M3 U8, D2a).
        await tx.query(
          `UPDATE sessions s SET disclosed_at = NULL
           FROM messages failed
           WHERE failed.channel_message_id = $1 AND failed.direction = 'outbound'
             AND failed.tenant_id = $2
             AND failed.status = 'failed' AND failed.disclosure IS NOT NULL
             AND s.id = failed.session_id
             AND NOT EXISTS (
               SELECT 1 FROM messages other
               WHERE other.session_id = s.id AND other.disclosure IS NOT NULL
                 AND other.status IN ('sent', 'delivered', 'read'))`,
          [status.channelMessageId, tenantId],
        );
      }
    }
    return { stored, duplicates, statusesApplied };
  });
}

/**
 * Records that an event arrived for a receiving number no tenant has. The
 * same event twice is one row. The handle is the cross-tenant role's.
 */
export async function recordUnroutable(
  cross: Database,
  event: {
    channel: string;
    receivingNumberId: string;
    channelMessageId: string;
    kind: "message" | "status";
  },
): Promise<void> {
  await poolOf(cross).query(
    `INSERT INTO unroutable_events (channel, receiving_number_id, channel_message_id, kind)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [event.channel, event.receivingNumberId, event.channelMessageId, event.kind],
  );
}

/**
 * Records a body, or part of one, that could not be read, and queues an
 * operator alert for it, as one statement. The same body twice is one row
 * and one alert. Returns whether it was new. The handle is the cross-tenant
 * role's.
 */
export async function recordUnparsed(
  cross: Database,
  event: {
    channel: string;
    payloadHash: string;
    sizeBytes: number;
    errorCode: string;
    /** How many messages or statuses were left out; null when the whole body was unreadable. */
    itemsLeftOut: number | null;
  },
): Promise<boolean> {
  const result = await poolOf(cross).query(
    `WITH recorded AS (
       INSERT INTO unparsed_events (channel, payload_hash, size_bytes, error_code, items_left_out)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id
     ), alerts AS (
       INSERT INTO jobs (type, payload, run_at)
       SELECT $6, jsonb_build_object('unparsedEventId', id), clock_timestamp() FROM recorded
     )
     SELECT id FROM recorded`,
    [
      event.channel,
      event.payloadHash,
      event.sizeBytes,
      event.errorCode,
      event.itemsLeftOut,
      OPERATOR_ALERT_JOB,
    ],
  );
  return result.rows.length === 1;
}

/**
 * The message a tap answers: the one sent in the tap's own conversation
 * under the identifier the tap named. Looked for when asked, not when the
 * tap was stored, so a message whose identifier was recorded later is
 * found. Null means "not matched", never "forged": a message whose send
 * ended with nobody knowing whether it arrived has no identifier, though
 * the customer may hold it. For the core's own buttons this is a record
 * and not a condition (design note, M3 unit U5, section 3).
 */
export function messageAnswered(
  app: Database,
  tenantId: string,
  tapMessageId: string,
): Promise<string | null> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const found = await tx.query<{ id: string }>(
      `SELECT sent.id
       FROM messages tap
       JOIN messages sent
         ON sent.conversation_id = tap.conversation_id
        AND sent.direction = 'outbound'
        AND sent.channel_message_id = tap.in_reply_to
       WHERE tap.id = $1 AND tap.direction = 'inbound' AND tap.kind = 'button'`,
      [tapMessageId],
    );
    return found.rows[0]?.id ?? null;
  });
}
