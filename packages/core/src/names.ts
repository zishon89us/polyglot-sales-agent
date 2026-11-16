// The single source for names that the documents, the database and the API
// all use (M2 unit U3). `tools/names-check.ts` fails `make check` if the
// glossary, the data model, the state machines or the OpenAPI file disagree
// with this file. To add or rename a value, change it here and then in each
// place the check names.
//
// Only names that belong to the core are here. The booking pack's names live
// in the pack (ADR 0012).

/** The states of a handover (state machines, section 2). */
export const HANDOVER_STATES = [
  "waiting",
  "in-progress",
  "detached",
  "followed-up",
  "handed-back",
  "answered",
  "closed-unanswered",
] as const;
export type HandoverState = (typeof HANDOVER_STATES)[number];

/**
 * Why a session was handed over (glossary, "Handover reason").
 * `late-change` is raised by the booking pack and is a known exception to the
 * rule that the core names nothing about bookings (ADR 0012).
 */
export const HANDOVER_REASONS = [
  "requested",
  "repeated-failure",
  "sensitive-topic",
  "data-request",
  "emergency",
  "limit",
  "unsupported-content",
  "late-change",
  "provider-failure",
  "staff",
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

/** The states of an outbound message (state machines, section 7). */
export const MESSAGE_STATUSES = [
  "pending",
  "held",
  "discarded",
  "withheld",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** The five classes of outbound message, with the name the glossary uses. */
export const MESSAGE_CLASSES = {
  "assistant-reply": "Assistant reply",
  "system-reply": "System reply",
  "staff-message": "Staff message",
  "service-notice": "Service notice",
  "business-initiated": "Business-initiated message",
} as const;
export type MessageClass = keyof typeof MESSAGE_CLASSES;

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
