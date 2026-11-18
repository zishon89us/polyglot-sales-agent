// What the channel webhook writes (`docs/design/api.md`, section 3; the
// table of event kinds is in `docs/design/architecture.md`, "Receiving an
// event"). Everything here is safe to run again for the same webhook: the
// channel sends a webhook again whenever it was not answered 200, and may
// do so after a run that did commit.

import { OPERATOR_ALERT_JOB } from "@polyglot-sales-agent/core";
import type pg from "pg";
import { enqueueJob, type Queryable } from "./jobs.ts";
import { type Tx, withTenant } from "./tenant.ts";

/** The job that makes a worker look at a conversation. */
export const PROCESS_CONVERSATION_JOB = "process-conversation";

export interface IncomingMessage {
  readonly channelMessageId: string;
  /** E.164, or null when the channel gave none. */
  readonly phone: string | null;
  /** The channel's own identifier for the customer, or null. One of the two is set. */
  readonly userId: string | null;
  /** `text`, or `unsupported` for anything this version does not read. */
  readonly kind: "text" | "unsupported";
  /** The text, for a text message; null otherwise. Untrusted. */
  readonly body: string | null;
}

export interface IncomingStatus {
  readonly channelMessageId: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
}

export interface StoredBatch {
  /** Messages stored now. */
  readonly stored: number;
  /** Messages that were already stored: a redelivery. */
  readonly duplicates: number;
  /** Statuses that moved one of this tenant's messages forward. */
  readonly statusesApplied: number;
}

/** The tenant a receiving number belongs to, if any. Run as the cross-tenant role. */
export async function tenantOfReceivingNumber(
  cross: Queryable,
  receivingNumberId: string,
): Promise<string | undefined> {
  const result = await cross.query(
    "SELECT tenant_id FROM channel_routes WHERE receiving_number_id = $1",
    [receivingNumberId],
  );
  return result.rows[0]?.tenant_id;
}

/**
 * Finds the contact for a customer, or makes one. Matched on the channel's
 * identifier first, then on the number; whichever of the two the contact
 * lacked is filled in. Two webhooks for one new customer at the same moment
 * end with one contact.
 */
async function contactFor(
  tx: Tx,
  tenantId: string,
  who: { phone: string | null; userId: string | null },
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (who.userId !== null) {
      const known = await tx.query<{ id: string }>(
        `UPDATE contacts SET phone = coalesce(phone, (
           SELECT $2::text WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE phone = $2)))
         WHERE channel_user_id = $1 RETURNING id`,
        [who.userId, who.phone],
      );
      if (known.rows[0] !== undefined) {
        return known.rows[0].id;
      }
    }
    if (who.phone !== null) {
      // The identifier is taken as given even if the contact had another:
      // the channel makes a new one when it must (issue #284).
      const known = await tx.query<{ id: string }>(
        `UPDATE contacts SET channel_user_id = coalesce($2, channel_user_id)
         WHERE phone = $1 RETURNING id`,
        [who.phone, who.userId],
      );
      if (known.rows[0] !== undefined) {
        return known.rows[0].id;
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
  await tx.query(
    `INSERT INTO conversations (tenant_id, contact_id, channel_account_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, contact_id) DO NOTHING`,
    [tenantId, contactId, channelAccountId],
  );
  const found = await tx.query<{ id: string }>(
    "SELECT id FROM conversations WHERE contact_id = $1",
    [contactId],
  );
  return found.rows[0]?.id as string;
}

// A status only ever moves a message forward. `read` may arrive before
// `delivered`, and `sent` may arrive while the send is still being recorded.
const FORWARD = `
  UPDATE messages SET status = $2
  WHERE channel_message_id = $1 AND direction = 'outbound' AND (
       ($2 = 'sent' AND status = 'sending')
    OR ($2 = 'delivered' AND status IN ('sending', 'sent'))
    OR ($2 = 'read' AND status IN ('sending', 'sent', 'delivered'))
    OR ($2 = 'failed' AND status IN ('sending', 'sent')))`;

/**
 * Stores one tenant's events from one webhook, in one transaction: each new
 * message with its contact and conversation, and one job per conversation
 * that got a new message. A message already stored is skipped, and queues
 * nothing. The pool is the application role's.
 */
export function storeInbound(
  app: pg.Pool,
  tenantId: string,
  receivingNumberId: string,
  messages: readonly IncomingMessage[],
  statuses: readonly IncomingStatus[],
): Promise<StoredBatch> {
  return withTenant(app, tenantId, async (tx) => {
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
    let stored = 0;
    let duplicates = 0;
    const touched = new Set<string>();
    for (const message of messages) {
      const contactId = await contactFor(tx, tenantId, message);
      const conversationId = await conversationFor(tx, tenantId, contactId, channelAccountId);
      const inserted = await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, kind, channel_message_id, body)
         VALUES ($1, $2, 'inbound', $3, $4, $5)
         ON CONFLICT (tenant_id, channel_message_id) DO NOTHING`,
        [tenantId, conversationId, message.kind, message.channelMessageId, message.body],
      );
      if (inserted.rowCount === 1) {
        stored += 1;
        touched.add(conversationId);
      } else {
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
      const moved = await tx.query(FORWARD, [status.channelMessageId, status.status]);
      statusesApplied += moved.rowCount;
    }
    return { stored, duplicates, statusesApplied };
  });
}

/**
 * Records that an event arrived for a receiving number no tenant has. The
 * same event twice is one row. Run as the cross-tenant role.
 */
export async function recordUnroutable(
  cross: Queryable,
  event: {
    channel: string;
    receivingNumberId: string;
    channelMessageId: string;
    kind: "message" | "status";
  },
): Promise<void> {
  await cross.query(
    `INSERT INTO unroutable_events (channel, receiving_number_id, channel_message_id, kind)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [event.channel, event.receivingNumberId, event.channelMessageId, event.kind],
  );
}

/**
 * Records a body, or part of one, that could not be read, and queues an
 * operator alert for it, as one statement. The same body twice is one row
 * and one alert. Returns whether it was new. Run as the cross-tenant role.
 */
export async function recordUnparsed(
  cross: Queryable,
  event: {
    channel: string;
    payloadHash: string;
    sizeBytes: number;
    errorCode: string;
    /** How many messages or statuses were left out; null when the whole body was unreadable. */
    itemsLeftOut: number | null;
  },
): Promise<boolean> {
  const result = await cross.query(
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

/** True if the database answers. For the readiness endpoint; any pool. */
export async function databaseAnswers(pool: Queryable): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
