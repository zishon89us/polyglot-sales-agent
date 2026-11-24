// The single source for names that the documents, the database and the API
// all use (M2 unit U3). `tools/names-check.ts` fails `make check` if one of
// the places it reads disagrees with this file: the glossary, the data model,
// the state machines, the OpenAPI file and the script that generates it, the
// handover model and the guardrail policy (the handover reasons, the model's
// flags and the core's claim kinds). To add or rename a value, change
// it here and then in each place the check names.
//
// Only names that belong to the core are here, with one known exception,
// `late-change`. The booking pack's names live in the pack (ADR 0012).

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

/**
 * What the model may flag about a customer's message (guardrail policy,
 * sections 4, 6 and 11). Code acts on each; the model only sets it. Three
 * are spelt as the handover reason they lead to (`sensitive-topic`,
 * `data-request`, `emergency`); `asks-for-person` leads to `requested`. A
 * search for one finds the other: they are two lists.
 */
export const MODEL_FLAGS = [
  "asks-for-person",
  "asks-to-stop",
  "sensitive-topic",
  "data-request",
  "emergency",
  "asks-to-resume",
  "asks-if-person",
] as const;
export type ModelFlag = (typeof MODEL_FLAGS)[number];

/**
 * The kinds of claim the core checks (guardrail policy, section 4; ADR
 * 0012). A pack registers its own beside these.
 */
export const CORE_CLAIM_KINDS = ["price", "opening-hours", "service-detail", "policy"] as const;
export type CoreClaimKind = (typeof CORE_CLAIM_KINDS)[number];

/**
 * The buttons the core itself puts on a message (state machines, steps 5
 * and 11; ADR 0014, "Buttons of a pack"). `start` is the opt-in button:
 * the two are one (decisions row 46). `stop` is defined here; whether any
 * text carries it is decided with the fixed texts.
 */
export const CORE_BUTTONS = ["stop", "start", "person"] as const;
export type CoreButton = (typeof CORE_BUTTONS)[number];

/**
 * The language a model says a customer wrote in: two small letters (ISO
 * 639-1), or `und` when it cannot tell (M3 unit U7; design note
 * docs/design/notes/m3-u7-turn.md, section 7).
 */
export const LANGUAGE_CODE = /^[a-z]{2}$/;
export const LANGUAGE_UNKNOWN = "und";

/**
 * The supported languages at run time: Arabic, English, Urdu, Hindi,
 * Bengali, Tagalog. The agent's proposal; decisions row 4 is unanswered.
 */
export const SUPPORTED_LANGUAGES = ["ar", "en", "ur", "hi", "bn", "tl"] as const;

/** Whether a reported language is one of the supported ones. */
export function languageSupported(code: string): boolean {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}
