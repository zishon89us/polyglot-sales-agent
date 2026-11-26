// A tenant's business hours (M3 unit U11; design note, section 4).

import { describe, expect, test } from "vitest";
import { localMoment, nextOpening, openAt } from "./hours.ts";

const WEEK = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "09:00", closes: "17:00" }));
const RIYADH = "Asia/Riyadh";
/** A moment by its wall-clock time in Riyadh, which is three hours ahead of UTC all year. */
const riyadh = (date: string, time: string): Date => new Date(`${date}T${time}:00+03:00`);

describe("the moment where the business is", () => {
  test("the date, the weekday from Monday as 1, and the minutes of the day", () => {
    // 2026-11-27 is a Friday.
    expect(localMoment(RIYADH, riyadh("2026-11-27", "09:30"))).toEqual({
      year: 2026,
      month: 11,
      day: 27,
      weekday: 5,
      minutes: 570,
    });
    expect(localMoment(RIYADH, riyadh("2026-11-29", "00:00")).weekday).toBe(7);
    expect(localMoment(RIYADH, riyadh("2026-11-30", "23:59"))).toMatchObject({
      weekday: 1,
      minutes: 1439,
    });
    // The same instant is another day elsewhere.
    expect(localMoment("America/Los_Angeles", riyadh("2026-11-27", "05:00"))).toMatchObject({
      day: 26,
      weekday: 4,
    });
    expect(() => localMoment("Not/AZone", new Date())).toThrow();
  });
});

describe("open now", () => {
  test("inside a period of its weekday, from its first minute to the one before it closes", () => {
    expect(openAt(WEEK, RIYADH, riyadh("2026-11-27", "09:00"))).toBe(true);
    expect(openAt(WEEK, RIYADH, riyadh("2026-11-27", "16:59"))).toBe(true);
    expect(openAt(WEEK, RIYADH, riyadh("2026-11-27", "08:59"))).toBe(false);
    expect(openAt(WEEK, RIYADH, riyadh("2026-11-27", "17:00"))).toBe(false);
    // Saturday has no period.
    expect(openAt(WEEK, RIYADH, riyadh("2026-11-28", "12:00"))).toBe(false);
    expect(openAt([], RIYADH, riyadh("2026-11-27", "12:00"))).toBe(false);
  });

  test("a period that closes at 24:00 runs to midnight, and a day may have two", () => {
    const late = [
      { weekday: 5, opens: "09:00", closes: "12:00" },
      { weekday: 5, opens: "18:00", closes: "24:00" },
    ];
    expect(openAt(late, RIYADH, riyadh("2026-11-27", "23:59"))).toBe(true);
    expect(openAt(late, RIYADH, riyadh("2026-11-27", "12:00"))).toBe(false);
    expect(openAt(late, RIYADH, riyadh("2026-11-27", "18:00"))).toBe(true);
    expect(openAt(late, RIYADH, riyadh("2026-11-28", "00:00"))).toBe(false);
  });

  test("by the tenant's clock, not the server's", () => {
    // 06:30 UTC is 09:30 in Riyadh and 22:30 the day before in Los Angeles.
    const at = new Date("2026-11-27T06:30:00Z");
    expect(openAt(WEEK, RIYADH, at)).toBe(true);
    expect(openAt(WEEK, "America/Los_Angeles", at)).toBe(false);
  });
});

describe("the next opening", () => {
  test("later the same day, the next day, and across a weekend", () => {
    expect(nextOpening(WEEK, RIYADH, riyadh("2026-11-27", "08:00"))).toBe("2026-11-27 09:00");
    // At the opening minute itself the next one is the next day's.
    expect(nextOpening(WEEK, RIYADH, riyadh("2026-11-26", "09:00"))).toBe("2026-11-27 09:00");
    // Friday evening: Monday.
    expect(nextOpening(WEEK, RIYADH, riyadh("2026-11-27", "18:00"))).toBe("2026-11-30 09:00");
  });

  test("the second period of a day, and a month's end", () => {
    const split = [
      { weekday: 1, opens: "09:00", closes: "12:00" },
      { weekday: 1, opens: "16:00", closes: "20:00" },
    ];
    expect(nextOpening(split, RIYADH, riyadh("2026-11-30", "13:00"))).toBe("2026-11-30 16:00");
    expect(nextOpening(split, RIYADH, riyadh("2026-11-30", "21:00"))).toBe("2026-12-07 09:00");
    expect(nextOpening(split, RIYADH, riyadh("2026-12-28", "21:00"))).toBe("2027-01-04 09:00");
  });

  test("a week later on the same weekday is found, and with no hours there is none", () => {
    const monday = [{ weekday: 1, opens: "09:00", closes: "10:00" }];
    expect(nextOpening(monday, RIYADH, riyadh("2026-11-30", "09:30"))).toBe("2026-12-07 09:00");
    expect(nextOpening([], RIYADH, riyadh("2026-11-30", "09:30"))).toBeUndefined();
  });

  test("it is a value a fixed text can be filled with: short, digits and three marks", () => {
    expect(nextOpening(WEEK, RIYADH, riyadh("2026-11-27", "18:00"))).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/,
    );
  });
});
