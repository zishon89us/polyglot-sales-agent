// What the channel webhook writes (`docs/design/api.md`, section 3; the
// table of event kinds is in `docs/design/architecture.md`, "What the
// webhook does with each kind of event"). Everything here is safe to run
// again for the same webhook: the channel sends a webhook again whenever it
// was not answered 200, and may do so after a run that did commit.

import { OPERATOR_ALERT_JOB } from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import { enqueueJob } from "./jobs.ts";
import { type Tx, withTenant } from "./tenant.ts";

/** The job that makes a worker look at a conversation. */
export const PROCESS_CONVERSATION_JOB = "process-conversation";

export interface IncomingMessage {
  readonly channelMessageId: string;
  /** E.164, or null when the channel gave none. */
  readonly phone: string | null;
  /** The channel's own identifier for the customer, or null. One of the two is set. */
  readonly userId: string | null;
  /** `text`, or the channel's name for a type this version does not read. */
  readonly kind: string;
  /** The text, for a text message; null otherwise. Untrusted. */
  readonly body: string | null;
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
// `delivered`, and `sent` may arrive while the send is still being recorded.
// A failure's code is kept with it.
const FORWARD = `
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
      const conversationId = await conversationFor(tx, tenantId, contactId, channelAccountId);
      // The clock is read for each row, so that messages of one webhook keep their order.
      const inserted = await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, kind, channel_message_id,
                               body, channel_sent_at, created_at)
         VALUES ($1, $2, 'inbound', $3, $4, $5, $6, clock_timestamp())
         ON CONFLICT (tenant_id, direction, channel_message_id) DO NOTHING`,
        [
          tenantId,
          conversationId,
          message.kind,
          message.channelMessageId,
          message.body,
          message.sentAt,
        ],
      );
      if (inserted.rowCount === 1) {
        stored += 1;
        touched.add(conversationId);
      } else {
        // Stored by another transaction since the look above.
        duplicates += 1;
      }
    }
    for (const conversationId of touched) {
      await enqueueJob(tx, {
        type: PROCESS_CONVERSATION_JOB,
        tenantId,
        subjectId: conversationId,
        payload: { conversationId },
      });
    }
    let statusesApplied = 0;
    for (const status of statuses) {
      const moved = await tx.query(FORWARD, [
        status.channelMessageId,
        status.status,
        status.errorCode,
      ]);
      statusesApplied += moved.rowCount;
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
