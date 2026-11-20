// The names that belong to the booking pack (ADR 0012). The pack keeps the
// list, and a test beside this file fails if the core uses any of them: a
// product that claims its core knows nothing of appointments has to be
// able to show it.
//
// The pack itself, its tables, tools and routes, is built in M5. Until then
// this list and that test are all there is of it.

/**
 * Words the core's code and migrations may not contain, matched without
 * regard to case and as parts of longer names too: `booking` also catches
 * `bookings`, `booking_service_settings` and `rebooking`.
 */
export const BOOKING_WORDS = [
  // The pack's tables: bookings, reminders, blocked_periods, booking_service_settings.
  "booking",
  "reminder",
  "blocked_period",
  // Its routes: /bookings, /slots, /blocked-periods.
  "blocked-period",
  "/slots",
  // Its settings.
  "slot_interval",
  "min_notice",
  "change_cutoff",
  // Its buttons and the things it deals in.
  "reschedul",
  "appointment",
  "no-show",
  "no_show",
] as const;

/**
 * The one name of the pack's that the core does hold: the handover reason
 * `late-change`, a member of the core's closed list of reasons, so that a
 * pack cannot yet add a reason of its own (ADR 0012, "Known exceptions";
 * issue #278).
 */
export const KNOWN_EXCEPTION = "late-change";
