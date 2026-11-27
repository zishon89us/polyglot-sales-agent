// The handover record (M3 unit U11; design note
// docs/design/notes/m3-u11-handover.md). One function applies a trigger:
// it makes a handover, or adds to the open one, or attaches a detached one
// again, and stores the message that tells the customer. Every caller
// holds the conversation's lock, which is what keeps one open handover for
// a contact.

import type { HandoverReason, HoursPeriod } from "@polyglot-sales-agent/core";
import { enqueueJob } from "./jobs.ts";
import { SEND_MESSAGES_JOB } from "./outbound.ts";
import type { Tx } from "./tenant.ts";

/** After this long with nobody acting, a detached handover is closed when a trigger next finds it. */
export const HANDOVER_DETACHED_DAYS = 14;
/**
 * In M3 nobody can reply, so a handover is detached this long after it was
 * attached, whether or not the customer went on writing. M4 takes this out.
 */
export const HANDOVER_SILENCE_HOURS = 24;
/** The emergency text is sent to a contact at most once in this long. */
export const EMERGENCY_TEXT_MINUTES = 60;

/** What the text of a telling is chosen from. */
export interface HandoverTellFor {
  /** The session's language, the contact's last. */
  readonly preferred: readonly (string | null)[];
  readonly tenantDefault: string;
  readonly emergency: boolean;
  /** The customer asked whether a person is replying: the fixed answer goes first. */
  readonly answerIsAutomated: boolean;
  readonly timeZone: string;
  readonly businessHours: readonly HoursPeriod[];
  readonly supportContact: string | null;
  readonly at: Date;
}
export type HandoverTell = (given: HandoverTellFor) => string;

export interface HandoverTrigger {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly reasons: readonly HandoverReason[];
  /** The transaction's moment, as `stamp` gives it. */
  readonly at: string;
  readonly tell: HandoverTell;
  readonly answerIsAutomated?: boolean;
}

export interface HandoverResult {
  readonly handoverId: string;
  /** Whether the session became handed over by this trigger, or already was. */
  readonly made: "created" | "attached" | "added";
  /** The reasons the handover now has. */
  readonly reasons: readonly string[];
  readonly told: "handover" | "emergency" | null;
}

interface Open {
  id: string;
  state: string;
  session_id: string | null;
  reasons: string[];
  urgent: boolean;
  expired: boolean;
}

const merged = (have: readonly string[], more: readonly string[]): string[] => [
  ...have,
  ...more.filter((reason, index) => !have.includes(reason) && more.indexOf(reason) === index),
];

/** Stores the message that tells the customer, and queues its sending. */
export async function tellCustomer(
  tx: Tx,
  trigger: Omit<HandoverTrigger, "reasons">,
  handoverId: string,
  emergency: boolean,
): Promise<void> {
  const known = await tx.query<{
    session: string | null;
    contact: string | null;
    tenant: string;
    time_zone: string;
    business_hours: HoursPeriod[] | null;
    support_contact: string | null;
  }>(
    `SELECT s.language AS session, p.last_language AS contact, t.default_language AS tenant,
            t.time_zone, t.business_hours, t.support_contact
     FROM conversations c
     JOIN contacts p ON p.id = c.contact_id
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN sessions s ON s.id = $2
     WHERE c.id = $1`,
    [trigger.conversationId, trigger.sessionId],
  );
  const row = known.rows[0];
  if (row === undefined) {
    throw new Error("a handover for a conversation that is not there");
  }
  const body = trigger.tell({
    preferred: [row.session, row.contact],
    tenantDefault: row.tenant,
    emergency,
    answerIsAutomated: trigger.answerIsAutomated === true,
    timeZone: row.time_zone,
    businessHours: row.business_hours ?? [],
    supportContact: row.support_contact,
    at: new Date(trigger.at),
  });
  await tx.query(
    `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                           status, created_at, handover_id, tells)
     VALUES ($1, $2, $3, 'outbound', 'system-reply', 'text', $4, 'pending', $5::timestamptz, $6, $7)`,
    [
      trigger.tenantId,
      trigger.conversationId,
      trigger.sessionId,
      body,
      trigger.at,
      handoverId,
      emergency ? "emergency" : "handover",
    ],
  );
  await enqueueJob(tx, {
    type: SEND_MESSAGES_JOB,
    tenantId: trigger.tenantId,
    subjectId: trigger.conversationId,
    payload: { conversationId: trigger.conversationId },
    runAt: new Date(trigger.at),
  });
}

/** Whether the contact has an emergency telling that is waiting, or one accepted in the last hour. */
export async function emergencyToldLately(
  tx: Tx,
  trigger: Pick<HandoverTrigger, "conversationId" | "at">,
): Promise<boolean> {
  const found = await tx.query(
    `SELECT 1 FROM messages
     WHERE conversation_id = $1 AND tells = 'emergency'
       AND (status IN ('pending', 'sending')
            OR (status IN ('sent', 'delivered', 'read')
                AND created_at > $2::timestamptz - $3::integer * interval '1 minute'))
     LIMIT 1`,
    [trigger.conversationId, trigger.at, EMERGENCY_TEXT_MINUTES],
  );
  return found.rowCount > 0;
}

/**
 * Applies a trigger (the note's section 3). The caller holds the
 * conversation's lock, in a transaction for the tenant.
 */
export async function applyHandoverTrigger(
  tx: Tx,
  trigger: HandoverTrigger,
): Promise<HandoverResult> {
  if (trigger.reasons.length === 0) {
    throw new Error("a handover needs a reason");
  }
  const emergency = trigger.reasons.includes("emergency");
  const found = await tx.query<Open>(
    `SELECT h.id, h.state, h.session_id, h.reasons, h.urgent,
            h.state = 'detached'
              AND h.detached_at + $2::integer * interval '1 day' <= $3::timestamptz AS expired
     FROM handovers h
     JOIN conversations c ON c.contact_id = h.contact_id AND c.id = $1
     WHERE h.state IN ('waiting', 'in-progress', 'detached', 'followed-up')
     FOR UPDATE OF h`,
    [trigger.conversationId, HANDOVER_DETACHED_DAYS, trigger.at],
  );
  let open = found.rows[0];
  if (open?.expired === true) {
    // H-d: nobody acted for fourteen days. Closed, and a new one is made.
    await tx.query(
      `UPDATE handovers SET state = 'closed-unanswered', closed_reason = 'expired',
                            ended_at = $2::timestamptz
       WHERE id = $1`,
      [open.id, trigger.at],
    );
    open = undefined;
  }
  let made: HandoverResult["made"];
  let id: string;
  let reasons: string[];
  if (open === undefined) {
    // H-a.
    reasons = merged([], trigger.reasons);
    const created = await tx.query<{ id: string }>(
      `INSERT INTO handovers (tenant_id, contact_id, session_id, state, reasons, urgent,
                              created_at, attached_at)
       SELECT $1, c.contact_id, $3, 'waiting', $4::text[], $5, $6::timestamptz, $6::timestamptz
       FROM conversations c WHERE c.id = $2
       RETURNING id`,
      [trigger.tenantId, trigger.conversationId, trigger.sessionId, reasons, emergency, trigger.at],
    );
    id = created.rows[0]?.id as string;
    made = "created";
  } else {
    id = open.id;
    reasons = merged(open.reasons, trigger.reasons);
    // H-b when it is attached to this session; otherwise it is attached now (H-c).
    made = open.session_id === trigger.sessionId ? "added" : "attached";
    await tx.query(
      `UPDATE handovers
       SET reasons = $2::text[], urgent = urgent OR $3,
           state = CASE WHEN $4 THEN 'waiting' ELSE state END,
           session_id = $5,
           attached_at = CASE WHEN $4 THEN $6::timestamptz ELSE attached_at END,
           detached_at = CASE WHEN $4 THEN NULL ELSE detached_at END
       WHERE id = $1`,
      [id, reasons, emergency, made === "attached", trigger.sessionId, trigger.at],
    );
  }
  if (made !== "added") {
    // The session is now handed over. Its counts of fallbacks and of
    // unreadable batches in a row start again, and a reply of the assistant that was still waiting is
    // not sent after "a person will reply".
    await tx.query(
      "UPDATE sessions SET guardrail_fallbacks = 0, unreadable_batches = 0 WHERE id = $1",
      [trigger.sessionId],
    );
    await tx.query(
      `UPDATE messages SET status = 'discarded', send_not_before = NULL
       WHERE session_id = $1 AND class = 'assistant-reply' AND status = 'pending'
         AND unknown_outcomes = 0`,
      [trigger.sessionId],
    );
  }
  let told: HandoverResult["told"] = null;
  if (emergency && !(await emergencyToldLately(tx, trigger))) {
    told = "emergency";
  } else if (made !== "added") {
    told = "handover";
  }
  if (told !== null) {
    await tellCustomer(tx, trigger, id, told === "emergency");
  }
  return { handoverId: id, made, reasons, told };
}

/** The handover a session is handed over by, if it is. */
export async function waitingHandover(
  tx: Tx,
  sessionId: string,
): Promise<{ id: string; reasons: string[]; attachedAt: string; urgent: boolean } | undefined> {
  const found = await tx.query<{
    id: string;
    reasons: string[];
    attached_at: string;
    urgent: boolean;
  }>(
    `SELECT id, reasons, attached_at::text, urgent FROM handovers
     WHERE session_id = $1 AND state IN ('waiting', 'in-progress') FOR UPDATE`,
    [sessionId],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : { id: row.id, reasons: row.reasons, attachedAt: row.attached_at, urgent: row.urgent };
}

/**
 * Detaches the handover of a session that has ended, or whose 24 hours of
 * silence have run out (S5, S5a). `detachedAt` is when that was, not when
 * it was noticed.
 */
export async function detachHandover(tx: Tx, sessionId: string, detachedAt: string): Promise<void> {
  await tx.query(
    `UPDATE handovers SET state = 'detached', session_id = NULL, detached_at = $2::timestamptz
     WHERE session_id = $1 AND state = 'waiting'`,
    [sessionId, detachedAt],
  );
}
