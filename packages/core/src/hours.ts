// A tenant's business hours: whether it is open at a moment, and when it
// next opens (M3 unit U11; design note
// docs/design/notes/m3-u11-handover.md, section 4). Pure: the clock is a
// parameter. Times are wall-clock times in the tenant's time zone.

import type { HoursPeriod } from "./profile.ts";

/** How many days ahead a next opening is looked for. */
export const NEXT_OPENING_DAYS = 8;

interface LocalMoment {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** 1 is Monday, 7 is Sunday. */
  readonly weekday: number;
  readonly minutes: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The date, the weekday and the time of day in a time zone. Throws on a zone that does not exist. */
export function localMoment(timeZone: string, at: Date): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string): string => parts.find((one) => one.type === type)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekday: WEEKDAYS.indexOf(part("weekday")) + 1,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

const minutesOf = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
};

/** Whether the moment falls in a period of its weekday. A period that closes at 24:00 runs to midnight. */
export function openAt(hours: readonly HoursPeriod[], timeZone: string, at: Date): boolean {
  const now = localMoment(timeZone, at);
  return hours.some(
    (period) =>
      period.weekday === now.weekday &&
      minutesOf(period.opens) <= now.minutes &&
      now.minutes < minutesOf(period.closes),
  );
}

const two = (value: number): string => String(value).padStart(2, "0");

/**
 * The first start of a period after the moment, within the next days, as
 * `YYYY-MM-DD HH:MM` in the tenant's time zone; or undefined. Digits only:
 * it reads the same in every language.
 */
export function nextOpening(
  hours: readonly HoursPeriod[],
  timeZone: string,
  at: Date,
): string | undefined {
  const now = localMoment(timeZone, at);
  for (let ahead = 0; ahead <= NEXT_OPENING_DAYS; ahead += 1) {
    // The calendar date `ahead` days on, by the calendar and not by 24-hour steps.
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + ahead));
    const weekday = ((now.weekday - 1 + ahead) % 7) + 1;
    const starts = hours
      .filter((period) => period.weekday === weekday)
      .map((period) => minutesOf(period.opens))
      .filter((start) => ahead > 0 || start > now.minutes)
      .sort((a, b) => a - b);
    const first = starts[0];
    if (first !== undefined) {
      return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ${two(
        Math.floor(first / 60),
      )}:${two(first % 60)}`;
    }
  }
  return undefined;
}
