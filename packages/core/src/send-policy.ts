// What to do after a call to the channel, decided by the message's class
// (architecture, "Sending a message once"; state machines, section 7).
//
// The channel is called outside any transaction and offers no way to ask
// whether it has a message. So a call can end in three ways: accepted,
// refused, or unknown. Unknown is a timeout, a broken connection, a fault
// on the channel's side, an answer that could not be read, and a worker
// that stopped between starting the call and recording its result.
//
// - Refused is safe to try again, since the customer has nothing.
// - Unknown is not: the customer may have the message. Whether to risk a
//   second copy depends on what the message is.

import type { MessageClass } from "./names.ts";

/** How many times the channel is called for one message, at most. */
export const SEND_MAX_ATTEMPTS = 3;

/** The waits before the second and the third call. */
export const SEND_RETRY_WAITS_MS = [2_000, 8_000] as const;

/** A call that started this long ago and has no recorded result is taken as unknown. */
export const SENDING_STALE_MS = 2 * 60_000;

/**
 * The code stored with a message that is `failed` after a call for it ended
 * with nobody knowing whether the channel accepted it. The customer may
 * have it. It is stored whenever any call for the message ended that way,
 * even if a later call was refused: the channel's code for that refusal
 * would say the customer has nothing, which is not known.
 */
export const UNCONFIRMED = "unconfirmed";

/**
 * A message that could have been sent this long ago and was not is not
 * sent: an answer that arrives hours late, out of nowhere, is worse than
 * none. It waits so long when the job that sends its conversation's
 * messages has died, and also when no worker ran or the queue was this far
 * behind; the rule does not tell these apart. Counted from when the message
 * was stored, or from the time it was last put off to. The agent's number.
 */
export const SEND_EXPIRES_MS = 15 * 60_000;

/** The code stored with a message that waited too long, when no call for it ever ended unknown. It may have been called for and refused. */
export const EXPIRED = "expired";

/**
 * The classes sent once more after an unknown outcome. Someone is waiting
 * for these, and is worse off with no answer than with two. The others are
 * messages the business starts or that can cost money, where a second copy
 * is worse than a missing one; they are never sent again.
 */
export const RESENT_AFTER_UNKNOWN: Readonly<Record<MessageClass, boolean>> = {
  "assistant-reply": true,
  "system-reply": true,
  "staff-message": true,
  "service-notice": false,
  "business-initiated": false,
};

export type SendOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused"; readonly retryable: boolean; readonly code: string }
  | { readonly kind: "unknown" };

export type SendDecision =
  | { readonly next: "sent" }
  /** Call the channel again, no sooner than this. */
  | { readonly next: "retry"; readonly waitMs: number }
  | { readonly next: "failed"; readonly code: string };

export interface SendHistory {
  /** Calls started for this message, the one just ended included. At least 1. */
  readonly attempts: number;
  /** Calls before this one that ended unknown. */
  readonly unknownBefore: number;
}

/**
 * Decides what happens to a message after a call for it has ended.
 *
 * At most one unknown outcome is ever followed by another call, and only
 * for the classes of `RESENT_AFTER_UNKNOWN`. So a customer can receive at
 * most two copies of a reply and at most one of anything else (NFR-R2).
 */
export function decideAfterSend(
  messageClass: MessageClass,
  history: SendHistory,
  outcome: SendOutcome,
): SendDecision {
  if (outcome.kind === "accepted") {
    return { next: "sent" };
  }
  const wait = SEND_RETRY_WAITS_MS[history.attempts - 1];
  const mayCallAgain = history.attempts < SEND_MAX_ATTEMPTS && wait !== undefined;
  if (outcome.kind === "refused") {
    if (outcome.retryable && mayCallAgain) {
      return { next: "retry", waitMs: wait };
    }
    return { next: "failed", code: history.unknownBefore > 0 ? UNCONFIRMED : outcome.code };
  }
  return RESENT_AFTER_UNKNOWN[messageClass] && history.unknownBefore === 0 && mayCallAgain
    ? { next: "retry", waitMs: wait }
    : { next: "failed", code: UNCONFIRMED };
}

/** The longest reply the echo makes; a longer one is cut. The agent's number, under the channel's limit for a text. */
export const ECHO_MAX_CHARS = 1_000;

/**
 * The reply that stands in for the model until M3: the customer's own text,
 * back again. Undefined when the batch holds no text, and then nothing is
 * sent (the reply for unsupported content is step 13 of the order of
 * checks, and M3's).
 */
export function echoReply(texts: readonly (string | null)[]): string | undefined {
  const said = texts.filter((text): text is string => text !== null && text.trim() !== "");
  if (said.length === 0) {
    return undefined;
  }
  const reply = `Echo: ${said.join("\n")}`;
  return [...reply].slice(0, ECHO_MAX_CHARS).join("");
}
