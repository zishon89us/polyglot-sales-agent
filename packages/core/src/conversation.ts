// The fixed values of a conversation's timing (glossary, "Fixed values";
// design note docs/design/notes/m3-u2-sessions.md). They are not settings.

/** A session ends when this long passes with no message in either direction. */
export const SESSION_INACTIVITY_MS = 24 * 60 * 60_000;

/** The channel allows a free-form message for this long after the contact's latest message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60_000;

/** A turn waits this long after the customer's latest message (NFR-P5). */
export const BATCH_QUIET_MS = 3_000;

/** But never longer than this after the first message of the burst (NFR-P5). */
export const BATCH_MAX_MS = 10_000;

/**
 * How many replies in a row may be dropped in one session because the
 * customer wrote again. The next is sent although a newer message exists
 * (design note, D6; decisions row 38).
 */
export const REPLY_DISCARDS_MAX = 2;

/** How long the send job waits before it looks again at a reply it holds back. */
export const HELD_BACK_WAIT_MS = 5_000;

/**
 * When the batching window closes, in milliseconds since the epoch.
 * `latest` is the stored time of the newest message of the batch, and
 * `first` that of the oldest one stored since the conversation's last turn
 * started. With no such message the batch has already waited: the window is
 * closed.
 */
export function batchWindowClosesAt(latest: number, first: number | undefined): number {
  if (first === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.min(latest + BATCH_QUIET_MS, first + BATCH_MAX_MS);
}
