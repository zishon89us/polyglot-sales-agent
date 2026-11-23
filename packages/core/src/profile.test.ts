// The rules a profile file must keep (design note
// docs/design/notes/m3-u3-profile.md, sections 1, 3 and 5), on the pure
// function that reads one. Each refusal is checked to name its place and to
// repeat nothing that was typed.

import { describe, expect, test } from "vitest";
import {
  BODY_MAX,
  contactLike,
  currencyDecimals,
  DESCRIPTION_MAX,
  NAME_MAX,
  nameKey,
  normaliseName,
  PROFILE_BUDGET,
  PROFILE_FILE_MAX_BYTES,
  PROFILE_MAX_POLICIES,
  PROFILE_MAX_SERVICES,
  priceText,
  profileSize,
  readProfileFile,
} from "./profile.ts";

const SETTINGS = {
  currency: "SAR",
  support_contact: "+15550100",
  notification_email: "owner@example.com",
  business_hours: [{ weekday: 7, opens: "09:00", closes: "17:00" }],
};
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const read = (value: unknown) => readProfileFile(bytes(value));
/** The problems of a file that is the good one but for `change`. */
function problems(change: (file: Record<string, unknown>) => void): readonly string[] {
  const file: Record<string, unknown> = {
    settings: { ...SETTINGS },
    services: [{ name: "Consultation", description: "30 minutes", price_minor: 15000 }],
    policies: [{ title: "Cancellation", body: "Free up to 24 hours before." }],
  };
  change(file);
  const result = read(file);
  return result.ok ? [] : result.problems;
}
const settings = (change: Record<string, unknown>) =>
  problems((file) => {
    file["settings"] = { ...SETTINGS, ...change };
  });
const service = (change: Record<string, unknown>) =>
  problems((file) => {
    file["services"] = [{ name: "Consultation", price_minor: 1, ...change }];
  });
const policy = (change: Record<string, unknown>) =>
  problems((file) => {
    file["policies"] = [{ title: "Cancellation", body: "Text.", ...change }];
  });

describe("a profile file that keeps every rule", () => {
  test("is read into settings, services and policies, with its size", () => {
    const result = read({
      settings: {
        ...SETTINGS,
        opening_hours: [
          { weekday: 7, opens: "16:00", closes: "24:00" },
          { weekday: 7, opens: "09:00", closes: "13:00" },
          { weekday: 1, opens: "09:00", closes: "21:00" },
        ],
      },
      services: [
        { name: "Consultation", description: "30 minutes", price_minor: 15000 },
        { name: "Follow-up", price_minor: 0, active: false },
      ],
      policies: [{ title: "Cancellation", body: "Free up to 24 hours before." }],
    });
    expect(result).toEqual({
      ok: true,
      // Of the active service and the policy: 12 + 10, and 12 + 27.
      size: 61,
      profile: {
        settings: {
          currency: "SAR",
          supportContact: "+15550100",
          notificationEmail: "owner@example.com",
          businessHours: [{ weekday: 7, opens: "09:00", closes: "17:00" }],
          // In order of weekday and time, whatever the file's order.
          openingHours: [
            { weekday: 1, opens: "09:00", closes: "21:00" },
            { weekday: 7, opens: "09:00", closes: "13:00" },
            { weekday: 7, opens: "16:00", closes: "24:00" },
          ],
        },
        services: [
          { name: "Consultation", description: "30 minutes", priceMinor: 15000, active: true },
          { name: "Follow-up", description: "", priceMinor: 0, active: false },
        ],
        policies: [{ title: "Cancellation", body: "Free up to 24 hours before." }],
      },
    });
  });

  test("may have no services, no policies and no opening hours, which are then cleared", () => {
    const result = read({ settings: SETTINGS });
    expect(result).toMatchObject({
      ok: true,
      size: 0,
      profile: { services: [], policies: [], settings: { openingHours: null } },
    });
  });

  test("an email address is a support contact too", () => {
    expect(settings({ support_contact: "desk@example.com" })).toEqual([]);
  });

  test("text in Urdu, Hindi and Bengali keeps its joiners and its direction marks, and a body keeps its line breaks", () => {
    const result = read({
      settings: SETTINGS,
      services: [
        // A zero-width non-joiner, a zero-width joiner, a right-to-left mark.
        { name: "می\u200Cخواہم", description: "क्\u200Dष", price_minor: 1 },
        { name: "বাংলা\u200F pack", price_minor: 1 },
      ],
      policies: [{ title: "Hours", body: "line one\r\nline two\n\nline four" }],
    });
    expect(result).toMatchObject({
      ok: true,
      profile: {
        services: [{ name: "می\u200Cخواہم", description: "क्\u200Dष" }, { name: "বাংলা\u200F pack" }],
        policies: [{ body: "line one\nline two\n\nline four" }],
      },
    });
  });
});

describe("what the file itself must be (L6)", () => {
  test("not larger than a megabyte", () => {
    expect(readProfileFile(new Uint8Array(PROFILE_FILE_MAX_BYTES + 1))).toEqual({
      ok: false,
      problems: [`the file is larger than ${PROFILE_FILE_MAX_BYTES} bytes`],
    });
  });

  test("UTF-8, with no byte-order mark", () => {
    expect(readProfileFile(new Uint8Array([0x7b, 0xff, 0x7d]))).toEqual({
      ok: false,
      problems: ["the file is not UTF-8"],
    });
    const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes({ settings: SETTINGS })]);
    expect(readProfileFile(marked)).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("byte-order mark")],
    });
  });

  test("JSON, and an object", () => {
    expect(readProfileFile(new TextEncoder().encode("{ settings: 1 }"))).toEqual({
      ok: false,
      problems: ["the file is not JSON"],
    });
    expect(read([1, 2])).toEqual({ ok: false, problems: ["the file is not a JSON object"] });
  });

  test("a key given twice in one object is refused: JSON would keep the last and say nothing", () => {
    const twice =
      '{"settings":' +
      JSON.stringify(SETTINGS) +
      ',"services":[{"name":"A","price_minor":1,"price_minor":2}]}';
    expect(readProfileFile(new TextEncoder().encode(twice))).toEqual({
      ok: false,
      problems: ["a key is given twice in one object"],
    });
    // The same words inside a text are not a key.
    expect(policy({ body: 'say "price_minor": twice, "price_minor": again' })).toEqual([]);
  });

  test("an unknown key is refused wherever it is, and is not repeated", () => {
    const where = [
      problems((file) => {
        file["extra-secret"] = 1;
      }),
      settings({ "extra-secret": 1 }),
      service({ "extra-secret": 1 }),
      policy({ "extra-secret": 1 }),
      settings({
        business_hours: [{ weekday: 1, opens: "09:00", closes: "10:00", "extra-secret": 1 }],
      }),
    ].map((found) => found[0]);
    expect(where.map((problem) => problem?.split(":")[0])).toEqual([
      "the file",
      "settings",
      "services[0]",
      "policies[0]",
      "settings.business_hours[0]",
    ]);
    expect(where.join(" ")).not.toContain("extra-secret");
  });
});

describe("settings", () => {
  test("each of the four a tenant needs to answer is required (L5)", () => {
    for (const key of ["currency", "support_contact", "notification_email", "business_hours"]) {
      const without: Record<string, unknown> = { ...SETTINGS };
      delete without[key];
      expect(
        problems((file) => {
          file["settings"] = without;
        }),
      ).toEqual([`settings.${key}: is required`]);
    }
    expect(
      problems((file) => {
        delete file["settings"];
      }),
    ).toEqual(["settings: is not an object"]);
  });

  test("a currency is one the platform's list holds", () => {
    for (const currency of ["sar", "SARX", "XXQ", 1, ""]) {
      expect(settings({ currency })).toEqual([
        "settings.currency: is not a currency code this platform knows, such as SAR",
      ]);
    }
    expect(settings({ currency: "KWD" })).toEqual([]);
  });

  test("a currency's decimals come from the same list: three for one, none for another", () => {
    expect(currencyDecimals("SAR")).toBe(2);
    expect(currencyDecimals("KWD")).toBe(3);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("XXQ")).toBeUndefined();
    expect(priceText(15000, { code: "SAR", decimals: 2 })).toBe("150.00 SAR");
    expect(priceText(15000, { code: "KWD", decimals: 3 })).toBe("15.000 KWD");
    expect(priceText(15000, { code: "JPY", decimals: 0 })).toBe("15000 JPY");
    expect(priceText(5, { code: "SAR", decimals: 2 })).toBe("0.05 SAR");
    expect(priceText(0, { code: "KWD", decimals: 3 })).toBe("0.000 KWD");
    // Exact where a floating-point division would not be.
    expect(priceText(9007199254740991, { code: "SAR", decimals: 2 })).toBe("90071992547409.91 SAR");
  });

  test("a support contact is a phone number in international form or an email address, and nothing else", () => {
    for (const contact of [
      "front desk",
      "5550100",
      "+1555",
      "+1 555 0100",
      "+15550100123456789",
      "a@b",
      7,
    ]) {
      expect(settings({ support_contact: contact })).toHaveLength(1);
    }
    expect(settings({ support_contact: "+15550100" })).toEqual([]);
  });

  test("a notification email is an email address of at most 254 characters", () => {
    expect(settings({ notification_email: "owner" })).toEqual([
      "settings.notification_email: is not an email address",
    ]);
    expect(settings({ notification_email: `${"a".repeat(244)}@example.com` })).toHaveLength(1);
    expect(settings({ notification_email: `${"a".repeat(242)}@example.com` })).toEqual([]);
  });
});

describe("hours", () => {
  const hours = (periods: unknown) => settings({ opening_hours: periods });
  const period = (weekday: unknown, opens: unknown, closes: unknown) => ({
    weekday,
    opens,
    closes,
  });

  test("a weekday is a whole number from 1 to 7", () => {
    for (const weekday of [0, 8, 1.5, "1", null]) {
      expect(hours([period(weekday, "09:00", "10:00")])).toEqual([
        "settings.opening_hours[0].weekday: is a whole number from 1, Monday, to 7",
      ]);
    }
  });

  test("times are of the 24-hour clock; 24:00 only as a close", () => {
    for (const [opens, closes] of [
      ["9:00", "10:00"],
      ["09:00", "25:00"],
      ["09:60", "10:00"],
      ["24:00", "24:00"],
      [900, "10:00"],
    ]) {
      expect(hours([period(1, opens, closes)])).toHaveLength(1);
    }
    expect(hours([period(1, "00:00", "24:00")])).toEqual([]);
  });

  test("a period closes later than it opens; one past midnight is written as two", () => {
    expect(hours([period(5, "22:00", "02:00")])).toEqual([
      "settings.opening_hours[0]: closes is later than opens; write a period past midnight as two",
    ]);
    expect(hours([period(5, "09:00", "09:00")])).toHaveLength(1);
    expect(hours([period(5, "22:00", "24:00"), period(6, "00:00", "02:00")])).toEqual([]);
  });

  test("periods of one weekday do not overlap, though they may touch, and there are at most four", () => {
    expect(hours([period(1, "09:00", "13:00"), period(1, "12:59", "15:00")])).toEqual([
      "settings.opening_hours: two periods of weekday 1 overlap",
    ]);
    expect(hours([period(1, "09:00", "13:00"), period(1, "13:00", "15:00")])).toEqual([]);
    const five = [9, 11, 13, 15, 17].map((hour) =>
      period(2, `${String(hour).padStart(2, "0")}:00`, `${String(hour + 1).padStart(2, "0")}:00`),
    );
    expect(hours(five)).toEqual(["settings.opening_hours: weekday 2 has more than 4 periods"]);
    expect(hours(five.slice(1))).toEqual([]);
  });

  test("hours that are not a list are refused; business hours with no period at all are allowed", () => {
    expect(hours({ mon: [] })).toEqual(["settings.opening_hours: is not a list of periods"]);
    expect(settings({ business_hours: [] })).toEqual([]);
  });
});

describe("services and policies", () => {
  test("lengths are counted in code points, at each edge", () => {
    // An astral character is one code point and two UTF-16 units.
    const one = "😀";
    expect(service({ name: one.repeat(NAME_MAX) })).toEqual([]);
    expect(service({ name: one.repeat(NAME_MAX + 1) })).toEqual([
      `services[0].name: is 1 to ${NAME_MAX} characters`,
    ]);
    expect(service({ name: "   " })).toEqual([`services[0].name: is 1 to ${NAME_MAX} characters`]);
    expect(service({ description: "d".repeat(DESCRIPTION_MAX) })).toEqual([]);
    expect(service({ description: "d".repeat(DESCRIPTION_MAX + 1) })).toEqual([
      `services[0].description: is 0 to ${DESCRIPTION_MAX} characters`,
    ]);
    expect(policy({ title: "t".repeat(NAME_MAX + 1) })).toEqual([
      `policies[0].title: is 1 to ${NAME_MAX} characters`,
    ]);
    expect(policy({ body: "b".repeat(BODY_MAX) })).toEqual([]);
    expect(policy({ body: "b".repeat(BODY_MAX + 1) })).toEqual([
      `policies[0].body: is 1 to ${BODY_MAX} characters`,
    ]);
    expect(policy({ body: "" })).toEqual([`policies[0].body: is 1 to ${BODY_MAX} characters`]);
  });

  test("a price is a whole number of the smallest unit, 0 or more, that JSON carries exactly", () => {
    for (const price of [-1, 150.5, "15000", null, 2 ** 53]) {
      expect(service({ price_minor: price })).toHaveLength(1);
    }
    expect(service({ price_minor: 0 })).toEqual([]);
    expect(service({ price_minor: 2 ** 53 - 1 })).toEqual([]);
    expect(
      problems((file) => {
        file["services"] = [{ name: "No price" }];
      }),
    ).toHaveLength(1);
  });

  test("a control character or one that overrides the direction of text is refused; a line break only in a long text", () => {
    const refused = "has a control character or a character that overrides the direction of text";
    // A right-to-left override, an isolate, an escape, a null.
    for (const bad of ["a\u202Eb", "a\u2066b", "a\u001Bb", "a\u0000b"]) {
      expect(service({ name: bad })).toEqual([`services[0].name: ${refused}`]);
      expect(policy({ body: bad })).toEqual([`policies[0].body: ${refused}`]);
    }
    // A line separator is refused in a body. In a name it is white space, and becomes a space.
    expect(policy({ body: "a\u2028b" })).toEqual([`policies[0].body: ${refused}`]);
    expect(service({ name: "a\u2028b" })).toEqual([]);
    // In a name a line break is a space; in a body it stays.
    expect(service({ name: "two\nwords" })).toEqual([]);
    expect(policy({ body: "a\tb" })).toEqual([`policies[0].body: ${refused}`]);
  });

  test("two names that differ only in case, in composed form or in spaces are the same name", () => {
    const composed = "Caf\u00E9";
    const decomposed = "Cafe\u0301";
    expect(normaliseName(`  ${decomposed}   bar `)).toBe(`${composed} bar`);
    expect(nameKey("HAIR  Cut")).toBe(nameKey("hair cut"));
    for (const [first, second] of [
      ["Hair cut", "HAIR CUT"],
      [composed, decomposed],
      ["Hair cut", " Hair   cut "],
    ]) {
      expect(
        problems((file) => {
          file["services"] = [
            { name: first, price_minor: 1 },
            { name: second, price_minor: 2 },
          ];
        }),
      ).toEqual(["services[1]: has the same name as services[0], but for case or spaces"]);
    }
    expect(
      problems((file) => {
        file["policies"] = [
          { title: "Refunds", body: "a" },
          { title: "refunds", body: "b" },
        ];
      }),
    ).toEqual(["policies[1]: has the same name as policies[0], but for case or spaces"]);
    // Letters that only look alike are different names: an Arabic and a Farsi yeh.
    expect(
      problems((file) => {
        file["services"] = [
          { name: "\u064A", price_minor: 1 },
          { name: "\u06CC", price_minor: 2 },
        ];
      }),
    ).toEqual([]);
  });

  test("at most 100 services and 30 policies (L7)", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `s${index}`, price_minor: 1 }));
    expect(
      problems((file) => {
        file["services"] = many(PROFILE_MAX_SERVICES);
      }),
    ).toEqual([]);
    expect(
      problems((file) => {
        file["services"] = many(PROFILE_MAX_SERVICES + 1);
      }),
    ).toEqual([`services: more than ${PROFILE_MAX_SERVICES}`]);
    expect(
      problems((file) => {
        file["policies"] = Array.from({ length: PROFILE_MAX_POLICIES + 1 }, (_, index) => ({
          title: `p${index}`,
          body: "b",
        }));
      }),
    ).toEqual([`policies: more than ${PROFILE_MAX_POLICIES}`]);
  });

  test("every problem of a file is reported at once, each with its place, and nothing typed is repeated", () => {
    const found = problems((file) => {
      file["settings"] = { ...SETTINGS, currency: "private-currency" };
      file["services"] = [{ name: "", price_minor: "private-price" }, "private-item"];
      file["policies"] = [{ title: "private-title", body: 5 }];
    });
    expect(found.map((problem) => problem.split(":")[0])).toEqual([
      "settings.currency",
      "services[0].price_minor",
      "services[0].name",
      "services[1]",
      "policies[0].body",
    ]);
    expect(found.join(" ")).not.toContain("private");
  });
});

describe("the size budget (section 3)", () => {
  const sized = (characters: number) => {
    // 30 policies with bodies that add up to exactly `characters`, titles included.
    const titles = Array.from({ length: 10 }, (_, index) => `p${index}`);
    const each = Math.floor(characters / 10);
    return {
      settings: SETTINGS,
      policies: titles.map((title, index) => ({
        title,
        body: "b".repeat(each - title.length + (index === 0 ? characters - each * 10 : 0)),
      })),
    };
  };

  test("the size is the code points of the texts and nothing else", () => {
    expect(
      profileSize({
        services: [{ name: "ab", description: "😀😀😀" }],
        policies: [{ title: "c", body: "defg" }],
      }),
    ).toBe(10);
  });

  test("a profile at the budget is accepted; one character more is refused, and told both numbers", () => {
    expect(read(sized(PROFILE_BUDGET))).toMatchObject({ ok: true, size: PROFILE_BUDGET });
    expect(read(sized(PROFILE_BUDGET + 1))).toEqual({
      ok: false,
      problems: [
        `the profile's text is ${PROFILE_BUDGET + 1} characters; the budget is ${PROFILE_BUDGET}`,
      ],
    });
  });

  test("a service that is not active does not count: it is not given to the model", () => {
    const file = sized(PROFILE_BUDGET) as Record<string, unknown>;
    file["services"] = [
      { name: "hidden", description: "x".repeat(100), price_minor: 1, active: false },
    ];
    expect(read(file)).toMatchObject({ ok: true, size: PROFILE_BUDGET });
  });
});

describe("what in a profile's texts looks like a way to reach someone (M10)", () => {
  test("every link, email address and run of seven or more digits is listed, once", () => {
    expect(
      contactLike({
        services: [
          { name: "Call +1 (555) 0100 now", description: "or see https://example.com/pay?x=1" },
        ],
        policies: [
          {
            title: "Write to desk@example.com",
            body: "www.example.org, or 555-0100, or 12 34, or +1 (555) 0100",
          },
        ],
      }),
    ).toEqual([
      "+1 (555) 0100",
      "https://example.com/pay?x=1",
      "desk@example.com",
      "www.example.org,",
      "555-0100",
    ]);
  });
});
