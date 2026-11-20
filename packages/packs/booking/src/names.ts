// The names that belong to the booking pack (ADR 0012). The pack keeps the
// list, and a test beside this file fails if the core uses any of them: a
// product that claims its core knows nothing of appointments has to be
// able to show it.
//
// The pack itself, its tables, tools and routes, is built in M5. Until then
// this list and that test are all there is of it.

/**
 * Words the core's code and migrations may not contain. Each is compared in
 * lower case with `_` and `-` taken out, against lines treated the same
 * way, so `blocked_periods`, `blockedPeriod` and `/blocked-periods` are one
 * word here, and a word is found inside a longer name: `booking` also
 * catches `bookings`, `bookingId` and `booking_service_settings`.
 */
export const BOOKING_WORDS = [
  // The pack's tables and routes.
  "booking",
  "reminder",
  "blockedperiod",
  "slot",
  // Its settings: slot interval, minimum notice, change cut-off, horizon, capacity.
  "minnotice",
  "changecutoff",
  "horizon",
  "capacity",
  // Its buttons and the things it deals in.
  "reschedul",
  "appointment",
  "noshow",
] as const;

/** A line or a word as it is compared: lower case, with `_` and `-` taken out. */
export function comparable(text: string): string {
  return text.toLowerCase().replace(/[_-]/g, "");
}

/**
 * The one name of the pack's that the core does hold: the handover reason
 * `late-change`, a member of the core's closed list of reasons, so that a
 * pack cannot yet add a reason of its own (ADR 0012, "Known exceptions";
 * issue #278).
 */
export const KNOWN_EXCEPTION = "late-change";
