// The checks on a reply (M3 unit U9; design note
// docs/design/notes/m3-u9-output-checks.md). The tables of sections 4.5
// and 6 are tested row by row, by their numbers.

import { describe, expect, test } from "vitest";
import { CURRENCY_NAMES, DAY_HALVES, MONTHS, OCLOCK_WORDS, PERCENT_WORDS } from "./markers.ts";
import type { BusinessProfile } from "./profile.ts";
import {
  checkReply,
  packClaimCheckers,
  plainText,
  REPLY_CHECK_CODES,
  type ReplyCheckInput,
  scaledNumber,
} from "./reply-checks.ts";

const at = (codePoint: number): string => String.fromCodePoint(codePoint);
const S = "service-s";
const P = "policy-p";
const SALON: BusinessProfile = {
  name: "Salon Noor",
  timeZone: "Asia/Riyadh",
  currency: { code: "SAR", decimals: 2 },
  supportContact: "+966555550100",
  services: [
    { id: S, name: "Haircut", description: "45 minutes, 10% off on Mondays", priceMinor: 15_000 },
  ],
  policies: [
    {
      id: P,
      title: "Cancelling",
      body: "Cancel before 17:00 the day before; a 50 SAR fee applies after. Book at salon.example/book",
    },
  ],
  openingHours: [
    {
      weekday: 1,
      periods: [
        { opens: "09:00", closes: "13:00" },
        { opens: "16:00", closes: "21:00" },
      ],
    },
    ...[2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, periods: [] })),
  ],
};
type Claim = readonly [kind: string, item: string, value: string];
const input = (
  reply: string,
  claims: readonly Claim[] = [],
  more: Partial<ReplyCheckInput> = {},
): ReplyCheckInput => ({
  reply,
  claims: claims.map(([kind, item, value]) => ({ kind, item, value })),
  profile: SALON,
  batch: [],
  canary: "canary0000000000abcd",
  instructions: "",
  today: { year: 2026, month: 11, day: 26 },
  ...more,
});
/** "passes", or the check and code the reply failed under. */
const verdict = (
  reply: string,
  claims: readonly Claim[] = [],
  more: Partial<ReplyCheckInput> = {},
): string => {
  const result = checkReply(input(reply, claims, more));
  return result.failed === undefined ? "passes" : `${result.failed.check} ${result.failed.code}`;
};
const price = (value: string, item = S): Claim => ["price", item, value];

describe("O3: the cases of section 4.5", () => {
  test("V1: a price with its claim", () => {
    expect(verdict("It costs 150 SAR.", [price("150 SAR")])).toBe("passes");
  });
  test("V2: the same in Arabic-Indic digits with the Arabic word", () => {
    expect(verdict("السعر ١٥٠ ريال.", [price("١٥٠ ريال")])).toBe("passes");
  });
  test("V3: a price claim's value needs no marker", () => {
    expect(verdict("It costs SAR 150.00.", [price("150")])).toBe("passes");
  });
  test("V4: an amount with no claim", () => {
    expect(verdict("It costs 150 SAR.")).toBe("O3 amount-unclaimed");
  });
  test("V5: a wrong price, claimed as it was said", () => {
    expect(verdict("It costs 200 SAR.", [price("200 SAR")])).toBe("O3 claim-failed");
  });
  test("V6: a sign that cannot mean the tenant's currency", () => {
    expect(verdict("It costs $150.", [price("150")])).toBe("O3 amount-unclaimed");
  });
  test("V7: a total (O4)", () => {
    expect(verdict("150 SAR each, 300 SAR for two.", [price("150 SAR")])).toBe(
      "O3 amount-unclaimed",
    );
  });
  test("V8: an amount never passes because the customer wrote it", () => {
    expect(
      verdict("Not 100 SAR, it is 150 SAR.", [price("150 SAR")], { batch: ["is it 100 SAR?"] }),
    ).toBe("O3 amount-unclaimed");
  });
  test("V9: an amount from a policy's text", () => {
    expect(verdict("A 50 SAR fee applies.", [["policy", P, "50 SAR"]])).toBe("passes");
  });
  test("V10: that amount claimed as the service's price", () => {
    expect(verdict("It costs 50 SAR.", [price("50 SAR")])).toBe("O3 claim-failed");
  });
  test("V11: a percentage from a service's description", () => {
    expect(verdict("10% off on Mondays.", [["service-detail", S, "10%"]])).toBe("passes");
    expect(verdict("15% off on Mondays.", [["service-detail", S, "15%"]])).toBe("O3 claim-failed");
    expect(verdict("10% off.", [["policy", P, "10%"]])).toBe("O3 claim-failed");
  });
  test("V12: a percentage with no claim, though nothing is wrong with it", () => {
    expect(verdict("I am 100% sure.")).toBe("O3 percentage-unclaimed");
  });
  test("V13: an opening time", () => {
    expect(verdict("We open at 9:00.", [["opening-hours", "1", "9:00"]])).toBe("passes");
  });
  test("V14: one claim holds four times, each stored for the day", () => {
    const hours = "9 am to 1 pm and 4 pm to 9 pm";
    expect(verdict(`Monday: ${hours}.`, [["opening-hours", "1", hours]])).toBe("passes");
    expect(verdict("Monday: 9 am to 2 pm.", [["opening-hours", "1", "9 am to 2 pm"]])).toBe(
      "O3 claim-failed",
    );
  });
  test("V15: a time claimed for a day that has no such period", () => {
    expect(verdict("We open at 16:00.", [["opening-hours", "2", "16:00"]])).toBe("O3 claim-failed");
    expect(verdict("We open at 16:00.", [["opening-hours", "8", "16:00"]])).toBe("O3 claim-failed");
    expect(verdict("We open at 16:00.", [["opening-hours", "Monday", "16:00"]])).toBe(
      "O3 claim-failed",
    );
  });
  test("V16: a time the customer wrote passes with no claim", () => {
    expect(verdict("Let me check 5 pm.", [], { batch: ["can I come at 5pm?"] })).toBe("passes");
    expect(verdict("Let me check 17:00.", [], { batch: ["hello", "at 5 PM?"] })).toBe("passes");
  });
  test("V17: but not when the customer wrote only a number", () => {
    expect(verdict("Let me check 5 pm.", [], { batch: ["can I come at 5?"] })).toBe(
      "O3 time-unclaimed",
    );
    expect(verdict("Let me check 5 pm.", [], { batch: ["can I come at 6 pm?"] })).toBe(
      "O3 time-unclaimed",
    );
  });
  test("V18: a time from a policy's text", () => {
    expect(verdict("Cancel before 17:00.", [["policy", P, "17:00"]])).toBe("passes");
    expect(verdict("Cancel before 5 pm.", [["policy", P, "5 pm"]])).toBe("passes");
  });
  test("V19: a date the customer wrote, in another form", () => {
    expect(verdict("On 12 March then.", [], { batch: ["12/3?"] })).toBe("passes");
    expect(verdict("On 12/3/2027 then.", [], { batch: ["12 March?"] })).toBe("passes");
    expect(verdict("On 12 March then.", [], { batch: ["13 March?"] })).toBe("O3 date-unclaimed");
    // Two numbers and a slash are also a fraction: never by the exception.
    expect(verdict("On 12/3 then.", [], { batch: ["12/3?"] })).toBe("O3 date-unclaimed");
    expect(verdict("Yes, 1/2 price!", [], { batch: ["do students get 1/2 price?"] })).toBe(
      "O3 date-unclaimed",
    );
  });
  test("V20: a date with no claim, with an ordinal", () => {
    expect(verdict("See you on March 12th.")).toBe("O3 date-unclaimed");
    expect(verdict("See you on the 12th of March.")).toBe("O3 date-unclaimed");
    expect(verdict("See you on 12 March, 2027.")).toBe("O3 date-unclaimed");
    expect(verdict("See you on 2027-03-12.")).toBe("O3 date-unclaimed");
  });
  test("V21: 24/7 is not a date", () => {
    expect(verdict("Our chat is open 24/7.")).toBe("passes");
  });
  test("V22: a number the business's data holds", () => {
    expect(verdict("It takes 45 minutes.")).toBe("passes");
  });
  test("V23: a bare number passes only if the business's data holds it", () => {
    expect(verdict("It is 150.")).toBe("passes");
    expect(verdict("It is 140.")).toBe("O3 number-unknown");
  });
  test("V24: three digits after the separator group", () => {
    expect(verdict("1.500 SAR", [price("1.500 SAR")])).toBe("O3 claim-failed");
  });
  test("V25: one decimal digit is a decimal", () => {
    expect(verdict("150.5 SAR", [price("150.5 SAR")])).toBe("O3 claim-failed");
    expect(verdict("150.0 SAR", [price("150.0 SAR")])).toBe("passes");
    expect(verdict("150,00 SAR", [price("150,00 SAR")])).toBe("passes");
  });
  test("V26: 150.005 is a hundred and fifty thousand and five", () => {
    expect(verdict("150.005 SAR", [price("150.005 SAR")])).toBe("O3 claim-failed");
  });
  test("V27: a claim that names no service", () => {
    expect(verdict("150 SAR", [price("150 SAR", "no-such-id")])).toBe("O3 claim-failed");
  });
  test("V28: one claim that does not pass fails the reply, beside one that does", () => {
    expect(verdict("150 SAR", [price("150 SAR"), price("999 SAR")])).toBe("O3 claim-failed");
  });
  test("V29: digits spaced out are separate numbers", () => {
    expect(verdict("1 5 0 SAR", [price("150 SAR")])).toBe("O3 amount-unclaimed");
  });
  test("V30: something unseen inside a number is removed", () => {
    expect(verdict(`It costs 1${at(0x200b)}50 SAR.`, [price("150 SAR")])).toBe("passes");
    expect(verdict(`It costs 2${at(0x200b)}00 SAR.`, [price("150 SAR")])).toBe(
      "O3 amount-unclaimed",
    );
    expect(verdict(`It costs 2${at(0x308)}00 SAR.`, [price("150 SAR")])).toBe(
      "O3 amount-unclaimed",
    );
  });
  test("V31: one word may stand between a number and a currency's name", () => {
    expect(verdict("It costs 200 Saudi riyals.", [price("150 SAR")])).toBe("O3 amount-unclaimed");
    expect(verdict("It costs 150 Saudi riyals.", [price("150 SAR")])).toBe("passes");
  });
  test("V32: a number with a marker no list knows is still a number nobody stored", () => {
    expect(verdict("It costs 200 zorkmids.", [price("150")])).toBe("O3 number-unknown");
  });
  test("V33: the other end of a range", () => {
    expect(verdict("100-150 SAR", [price("150 SAR")])).toBe("O3 number-unknown");
    expect(verdict(`100${at(0x2013)}150 SAR`, [price("150 SAR")])).toBe("O3 number-unknown");
  });
  test("V34: the other end of a range of hours", () => {
    expect(verdict("Open 3 to 9 pm.", [["opening-hours", "1", "9 pm"]])).toBe("O3 number-unknown");
  });
  test("V35: hours written as bare numbers pass only as hours that are stored", () => {
    expect(verdict("Open 9-5.")).toBe("O3 number-unknown");
    expect(verdict("Open 9-1.")).toBe("passes");
  });
  test("V36: 24:00 is detected, as midnight", () => {
    expect(verdict("Open until 24:00.", [["opening-hours", "1", "24:00"]])).toBe("O3 claim-failed");
    expect(verdict("Open until 24:00.")).toBe("O3 time-unclaimed");
  });
  test("V37: a list's numbering is not a number of the reply", () => {
    expect(verdict("We offer:\n1. Haircut\n2. Colour\n3) Styling")).toBe("passes");
    expect(verdict("We offer 3. Haircut")).toBe("O3 number-unknown");
  });
  test("V38: a count the business's data does not hold", () => {
    expect(verdict("We have 3 stylists.")).toBe("O3 number-unknown");
  });
  test("V39: a number before a currency marker is the amount, not the year", () => {
    expect(verdict("On 5 May 2027 SAR.", [["policy", P, "50 SAR"]])).toBe("O3 date-unclaimed");
    expect(verdict("On 5 May, 50 SAR.", [["policy", P, "50 SAR"]], { batch: ["5 May?"] })).toBe(
      "passes",
    );
  });
});

describe("O3: the rules alone", () => {
  test("the Unicode facts the rules rest on", () => {
    // The compatibility form would turn these signs into letters: they are marked first.
    expect(at(0x20a8).normalize("NFKC")).toBe("Rs");
    expect(/\p{Sc}/u.test(at(0xfdfc).normalize("NFKC"))).toBe(false);
    expect(/\p{Default_Ignorable_Code_Point}/u.test(at(0x200b))).toBe(true);
    expect(/\p{Default_Ignorable_Code_Point}/u.test(at(0x3164))).toBe(true);
    expect(/\p{Pd}/u.test(at(0x2013))).toBe(true);
  });

  test("digits of four scripts and full-width digits read as Latin ones", () => {
    expect(plainText("١٥٠ ۱۵۰ १५० ১৫০ １５０")).toBe("150 150 150 150 150");
    expect(plainText(`1${at(0x66b)}5 1${at(0x66c)}500 10${at(0x66a)}`)).toBe("1.5 1,500 10%");
  });

  test("a number as a count of the smallest unit", () => {
    expect(scaledNumber("150", 2)).toBe(15_000);
    expect(scaledNumber("150.00", 2)).toBe(15_000);
    expect(scaledNumber("1,500", 2)).toBe(150_000);
    expect(scaledNumber("1.500,50", 2)).toBe(150_050);
    expect(scaledNumber("1 500", 2)).toBe(150_000);
    expect(scaledNumber("1'500.5", 2)).toBe(150_050);
    expect(scaledNumber("1.500", 3)).toBe(1_500);
    expect(scaledNumber("150", 0)).toBe(150);
    expect(scaledNumber("150.00", 0)).toBe(150);
    expect(scaledNumber("150.50", 0)).toBeNull();
    expect(scaledNumber("99999999999999999999", 2)).toBeNull();
  });

  test("a value that cannot be read fails the reply", () => {
    const yen: BusinessProfile = { ...SALON, currency: { code: "JPY", decimals: 0 } };
    expect(verdict("150.50 JPY", [], { profile: yen })).toBe("O3 value-unreadable");
    expect(verdict("At 17:30 am.")).toBe("O3 value-unreadable");
    expect(verdict("On 31/2.")).toBe("O3 value-unreadable");
    expect(verdict("On 30/2/2027.")).toBe("O3 value-unreadable");
  });

  test("the rupee and rial signs are found though the compatibility form would hide them", () => {
    const rupees: BusinessProfile = { ...SALON, currency: { code: "PKR", decimals: 2 } };
    expect(verdict(`${at(0x20a8)} 500`, [], { profile: rupees })).toBe("O3 amount-unclaimed");
    expect(verdict(`${at(0x20a8)} 150`, [price("150")], { profile: rupees })).toBe("passes");
    expect(verdict(`500 ${at(0xfdfc)}`)).toBe("O3 amount-unclaimed");
    expect(verdict(`150 ${at(0xfdfc)}`, [price("150")])).toBe("passes");
  });

  test("the usual written forms of a currency are markers", () => {
    const rupees: BusinessProfile = { ...SALON, currency: { code: "PKR", decimals: 2 } };
    for (const form of [
      "Rs. 500",
      "Rs 500",
      "500 Rs",
      "500/-",
      "PKR 500",
      "500 rupees",
      "500 روپے",
    ]) {
      expect(verdict(form, [], { profile: rupees }), form).toBe("O3 amount-unclaimed");
    }
    for (const form of [
      "SR 200",
      "200 SR",
      "200 ر.س",
      "200 ريال",
      "SAR200",
      "200SAR",
      "200 riyals",
    ]) {
      expect(verdict(form), form).toBe("O3 amount-unclaimed");
    }
    // The Persian spelling of the same word.
    expect(verdict(`200 ر${at(0x6cc)}ال`)).toBe("O3 amount-unclaimed");
  });

  test("an amount in another currency never passes, and a marker on each side needs both", () => {
    expect(verdict("150 rupees", [price("150")])).toBe("O3 amount-unclaimed");
    expect(verdict("USD 150 SAR", [price("150")])).toBe("O3 amount-unclaimed");
    expect(verdict("A$150", [price("150")])).toBe("O3 amount-unclaimed");
    expect(verdict("150 ₿", [price("150")])).toBe("O3 amount-unclaimed");
    // The tenant's own code is read in any case; another's in capitals only.
    expect(verdict("45 sar")).toBe("O3 amount-unclaimed");
    expect(verdict("45 Sar")).toBe("O3 amount-unclaimed");
  });

  test("a tenant with no currency has no amount that passes", () => {
    const none: BusinessProfile = { ...SALON, currency: null };
    expect(verdict("150 SAR", [price("150 SAR")], { profile: none })).toBe("O3 claim-failed");
    expect(verdict("150 SAR", [], { profile: none })).toBe("O3 amount-unclaimed");
  });

  test("a clock time in its forms", () => {
    const claim: Claim = ["opening-hours", "1", "16:00"];
    for (const form of [
      "16:00",
      "4 pm",
      "4pm",
      "4:00 PM",
      "4.00 pm",
      "4 p.m.",
      "4 p. m.",
      "٤ م",
      "4 ng hapon",
    ]) {
      expect(verdict(`From ${form} on.`, [claim]), form).toBe("passes");
    }
    expect(verdict("From 4 am on.", [claim])).toBe("O3 time-unclaimed");
    // An hour with a word for "o'clock" needs a word for the part of the day, before or after.
    expect(verdict("4 बजे", [claim])).toBe("O3 value-unreadable");
    expect(verdict("शाम 4 बजे", [claim])).toBe("passes");
    expect(verdict("4 बजे शाम", [claim])).toBe("passes");
    expect(verdict("सुबह 4 बजे", [claim])).toBe("O3 time-unclaimed");
    expect(verdict("4 बजे सुबह", [claim])).toBe("O3 time-unclaimed");
    // With a dot and no marker it is a number, since "9.50" is also a price.
    expect(verdict("Yes, 9.50", [], { batch: ["is the trim 9.50?"] })).toBe("O3 number-unknown");
    expect(verdict("From 16.00 on.", [claim])).toBe("passes");
    expect(verdict("From 16.30 on.", [claim])).toBe("O3 number-unknown");
    // The Arabic marker is not found at the start of a longer word.
    expect(verdict("4 مرات")).toBe("passes");
  });

  test("a date in its forms, day before month", () => {
    const asked = { batch: ["on 2027-03-12?"] };
    for (const form of [
      "12/03/2027",
      "12-3-27",
      "12.3.2027",
      "12 March",
      "March 12",
      "12 मार्च",
      "12 مارس",
      "Mar 12th, 2027",
      "March the 12th",
      "March, 12",
      "March  12",
      "12-March",
      "12 de March",
      "the 12th of March",
    ]) {
      expect(verdict(`On ${form}.`, [], asked), form).toBe("passes");
    }
    expect(verdict("On 3/12/2027.", [], asked)).toBe("O3 date-unclaimed");
    // A date with no year is the next such date on or after today.
    expect(verdict("On 26 November.", [], { batch: ["2026-11-26"] })).toBe("passes");
    expect(verdict("On 25 November.", [], { batch: ["2027-11-25"] })).toBe("passes");
  });

  test("a claim whose value holds nothing its kind can read fails", () => {
    expect(verdict("Hello.", [price("the usual")])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [price("150 SAR and 150 SAR")])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [["opening-hours", "1", "morning"]])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [["opening-hours", "1", "9:00 and 10%"]])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [["service-detail", S, "soon"]])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [["policy", "no-such-id", "17:00"]])).toBe("O3 claim-failed");
    expect(verdict("Hello.", [["slot", "x", "17:00"]])).toBe("O3 claim-failed");
  });

  test("a claim that passes with nothing of it in the reply does not fail the reply", () => {
    expect(verdict("Hello.", [price("150 SAR")])).toBe("passes");
  });

  test("a number from the customer's messages does not pass as a number", () => {
    expect(verdict("Yes, 100.", [], { batch: ["is it 100?"] })).toBe("O3 number-unknown");
  });

  test("the business's own numbers: prices, hours on both clocks, and its texts", () => {
    for (const known of [
      "150",
      "150.00",
      "9",
      "13",
      "1",
      "16",
      "4",
      "21",
      "45",
      "10",
      "17",
      "50",
      "09",
    ]) {
      expect(verdict(`The number ${known}.`), known).toBe("passes");
    }
    for (const unknown of ["2", "3", "5", "8", "15", "100", "2015", "1.5"]) {
      expect(verdict(`The number ${unknown}.`), unknown).toBe("O3 number-unknown");
    }
  });

  test("the business's name is not read as a value", () => {
    const named: BusinessProfile = { ...SALON, name: "5 pm Cafe 24" };
    expect(verdict("Welcome to 5 pm Cafe 24!", [], { profile: named })).toBe("passes");
    expect(verdict("Welcome to 5 PM cafe 24!", [], { profile: named })).toBe("passes");
    expect(verdict("Come at 5 pm.", [], { profile: named })).toBe("O3 time-unclaimed");
  });

  test("every entry of the marker data is detected", () => {
    const rupees: BusinessProfile = { ...SALON, currency: { code: "XTS", decimals: 2 } };
    for (const [names] of CURRENCY_NAMES) {
      for (const name of names) {
        expect(verdict(`8888 ${name}`, [], { profile: rupees }), name).toBe("O3 amount-unclaimed");
      }
    }
    for (const word of PERCENT_WORDS) {
      expect(verdict(`88 ${word}`), word).toBe("O3 percentage-unclaimed");
    }
    for (const [markers] of DAY_HALVES) {
      for (const marker of markers) {
        expect(verdict(`7 ${marker}`), marker).toBe("O3 time-unclaimed");
      }
    }
    for (const word of OCLOCK_WORDS) {
      expect(verdict(`7 ${word}`), word).toBe("O3 value-unreadable");
    }
    for (const names of MONTHS) {
      for (const name of names) {
        expect(verdict(`28 ${name}`), name).toBe("O3 date-unclaimed");
        expect(verdict(`${name} 28`), name).toBe("O3 date-unclaimed");
      }
    }
  });
});

describe("a pack's claim kind (section 5)", () => {
  const slots = packClaimCheckers([
    [
      "slot",
      (item, value) => item === "slot-1" && value.kind === "time" && value.minutes.includes(600),
    ],
  ]);

  test("a registered checker is asked about a time of its kind", () => {
    expect(verdict("At 10:00.", [["slot", "slot-1", "10:00"]], { packCheckers: slots })).toBe(
      "passes",
    );
    expect(verdict("At 11:00.", [["slot", "slot-1", "11:00"]], { packCheckers: slots })).toBe(
      "O3 claim-failed",
    );
    expect(verdict("At 10:00.", [["slot", "slot-2", "10:00"]], { packCheckers: slots })).toBe(
      "O3 claim-failed",
    );
  });

  test("it is given a date as a year, a month and a day", () => {
    const seen: unknown[] = [];
    const dates = packClaimCheckers([
      [
        "day",
        (_item, value) => {
          seen.push(value);
          return true;
        },
      ],
    ]);
    expect(verdict("On 12/3.", [["day", "x", "12/3"]], { packCheckers: dates })).toBe("passes");
    expect(seen).toEqual([{ kind: "date", year: 2027, month: 3, day: 12 }]);
  });

  test("it is never asked about an amount or a percentage, nor for a kind of the core's", () => {
    let asked = 0;
    const yes = packClaimCheckers([
      [
        "offer",
        () => {
          asked += 1;
          return true;
        },
      ],
    ]);
    expect(verdict("200 SAR", [["offer", "x", "200 SAR"]], { packCheckers: yes })).toBe(
      "O3 claim-failed",
    );
    expect(verdict("20%", [["offer", "x", "20%"]], { packCheckers: yes })).toBe("O3 claim-failed");
    expect(verdict("200 SAR", [price("200 SAR")], { packCheckers: yes })).toBe("O3 claim-failed");
    expect(asked).toBe(0);
  });

  test("a checker that throws, or answers something other than true, fails the claim", () => {
    const broken = packClaimCheckers([
      [
        "slot",
        () => {
          throw new Error("no");
        },
      ],
      ["soft", () => "yes" as unknown as boolean],
    ]);
    expect(verdict("At 10:00.", [["slot", "s", "10:00"]], { packCheckers: broken })).toBe(
      "O3 claim-failed",
    );
    expect(verdict("At 10:00.", [["soft", "s", "10:00"]], { packCheckers: broken })).toBe(
      "O3 claim-failed",
    );
  });

  test("a kind is registered once, and never one of the core's", () => {
    expect(() => packClaimCheckers([["price", () => true]])).toThrow();
    expect(() =>
      packClaimCheckers([
        ["slot", () => true],
        ["slot", () => true],
      ]),
    ).toThrow();
  });
});

describe("O5: the cases of section 6", () => {
  test("L1: a stored address, with a scheme and a full stop after it", () => {
    expect(verdict("Book at https://salon.example/book.")).toBe("passes");
    expect(verdict("Book at www.Salon.Example/book/")).toBe("passes");
  });
  test("L2: another path on the same host", () => {
    expect(verdict("Pay at salon.example/pay")).toBe("O5 link");
  });
  test("L3: an address in words", () => {
    expect(verdict("Go to evil dot com")).toBe("O5 link");
    expect(verdict("Go to evil (dot) com")).toBe("O5 link");
    expect(verdict("Go to evil[dot]net")).toBe("O5 link");
  });
  test("L4: a handle", () => {
    expect(verdict("Pay to @salon_pay on the app")).toBe("O5 handle");
  });
  test("L5: the stored number, spaced otherwise", () => {
    expect(verdict("Call +966 55 555 0100.")).toBe("passes");
    expect(verdict("Call +966-55-555-0100.")).toBe("passes");
  });
  test("L6: its national form, in Arabic-Indic digits", () => {
    expect(verdict("Call ٠٥٥ ٥٥٥ ٠١٠٠.")).toBe("O5 number");
  });
  test("L7: digits split by words are not a long number, and are numbers nobody stored", () => {
    const result = checkReply(input("055, then 1234, then 567"));
    expect(result.checks.O5).toEqual({ passed: true });
    expect(result.checks.O3).toEqual({ passed: false, code: "value-unreadable" });
    // Also when every piece is a number the business stored.
    expect(verdict("call 0 then 50 then 150 then 45 then 10")).toBe("O3 value-unreadable");
  });
  test("L8: a long number", () => {
    expect(verdict("Your order is 1234567.")).toBe("O5 number");
    expect(verdict("Your order is 123456.")).toBe("O3 number-unknown");
  });
  test("L9: a time and a date that passed O3 are not a long number", () => {
    expect(verdict("At 17:30 on 12/03/2027.", [], { batch: ["17:30 on 12 March 2027?"] })).toBe(
      "passes",
    );
  });
  test("L10: a missing space after a full stop reads as an address", () => {
    expect(verdict("See you.Then we talk")).toBe("O5 link");
  });
  test("L11: a number split by other dashes, or by lines", () => {
    expect(verdict(`055${at(0x2013)}555${at(0x2013)}0100`)).toBe("O5 number");
    expect(verdict("055\n555\n0100")).toBe("O5 number");
    expect(verdict("055*555*0100")).toBe("O5 number");
  });
  test("L12: the word 'dot' before a word that is no ending", () => {
    expect(verdict("See the red dot on the map")).toBe("passes");
  });
  test("L13: a sentence is not a bank account", () => {
    expect(verdict("It is 45 minutes long, at 10 minutes before your appointment")).toBe("passes");
  });
  test("L14: the path is compared as written, the host without regard to case", () => {
    expect(verdict("Book at salon.example/Book")).toBe("O5 link");
    expect(verdict("Book at SALON.example/book")).toBe("passes");
  });

  test("an email address", () => {
    expect(verdict("Write to pay@evil.example")).toBe("O5 email");
    const withEmail: BusinessProfile = { ...SALON, supportContact: "Help@salon.example" };
    expect(verdict("Write to help@salon.example.", [], { profile: withEmail })).toBe("passes");
  });

  test("a bank account, with its check digits right, in capitals", () => {
    // The example account of the standard.
    expect(verdict("Pay to GB82 WEST 1234 5698 7654 32")).toBe("O5 bank-account");
    expect(verdict("Pay to GB82WEST12345698765432 today")).toBe("O5 bank-account");
    const stored: BusinessProfile = {
      ...SALON,
      policies: [{ id: P, title: "Paying", body: "Our account: GB82 WEST 1234 5698 7654 32" }],
    };
    expect(verdict("Pay to GB82WEST12345698765432.", [], { profile: stored })).toBe("passes");
  });

  test("the business's name may look like an address", () => {
    const named: BusinessProfile = { ...SALON, name: "Glow.studio" };
    expect(verdict("Welcome to Glow.studio!", [], { profile: named })).toBe("passes");
    expect(verdict("Welcome to glow.studio/pay", [], { profile: named })).toBe("O5 link");
  });
});

describe("O6 and O7", () => {
  const instructions =
    "You are the assistant of a business. Never state a price that the data does not give. Write every amount in digits and return one claim for each.";

  test("the canary, also spaced out, in another case, or in a claim", () => {
    expect(verdict("The code is canary0000000000abcd.")).toBe("O6 canary");
    expect(verdict("C-A-N-A-R-Y 0000000000 ABCD")).toBe("O6 canary");
    expect(verdict("Hello.", [["policy", P, "canary0000000000abcd 17:00"]])).toBe("O6 canary");
    expect(verdict("Hello.", [["policy", "canary0000000000abcd", "17:00"]])).toBe("O6 canary");
    expect(verdict("Hello canary.")).toBe("passes");
  });

  test("twelve words of the instructions in a row, and not eleven", () => {
    const twelve = "never state a price that the data does not give write every";
    const eleven = "never state a price that the data does not give write";
    expect(verdict(`My rules say: ${twelve}`, [], { instructions })).toBe("O6 instructions");
    expect(
      verdict(`My rules say: ${twelve.toUpperCase().replaceAll(" ", ", ")}`, [], { instructions }),
    ).toBe("O6 instructions");
    expect(verdict(`My rules say: ${eleven}`, [], { instructions })).toBe("passes");
  });

  test("a policy quoted at length is not the instructions", () => {
    expect(
      verdict("Cancel before 17:00 the day before; a 50 SAR fee applies after.", [
        ["policy", P, "17:00"],
        ["policy", P, "50 SAR"],
      ]),
    ).toBe("passes");
  });

  test("empty, and too long", () => {
    expect(verdict("")).toBe("O7 empty");
    expect(verdict(" \n\t ")).toBe("O7 empty");
    expect(verdict(at(0x200b))).toBe("O7 empty");
    expect(verdict("a".repeat(1_200))).toBe("passes");
    expect(verdict("a".repeat(1_201))).toBe("O7 too-long");
    // Code points, not units: 1,200 emoji are 2,400 units.
    expect(verdict(at(0x1f600).repeat(1_200))).toBe("passes");
  });
});

describe("the answer", () => {
  test("all four checks run and each is reported; the first that failed is the one named", () => {
    const result = checkReply(input("canary0000000000abcd 200 SAR evil dot com"));
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual({ check: "O6", code: "canary" });
    expect(result.checks).toEqual({
      O7: { passed: true },
      O6: { passed: false, code: "canary" },
      O3: { passed: false, code: "amount-unclaimed" },
      O5: { passed: false, code: "link" },
    });
    const good = checkReply(input("Hello."));
    expect(good).toEqual({
      passed: true,
      checks: {
        O7: { passed: true },
        O6: { passed: true },
        O3: { passed: true },
        O5: { passed: true },
      },
    });
  });

  test("a code is one of the list and holds nothing of the reply", () => {
    const marked = "zebra";
    for (const reply of [
      `${marked} 200 SAR`,
      `${marked} 20%`,
      `${marked}@${marked}.example`,
      `@${marked}`,
      `${marked} 7654321`,
      `${marked} 99`,
    ]) {
      const result = checkReply(input(reply, [price(`${marked} 1`)]));
      expect(result.passed).toBe(false);
      expect(JSON.stringify(result)).not.toContain(marked);
      for (const outcome of Object.values(result.checks)) {
        if (!outcome.passed) {
          expect(REPLY_CHECK_CODES).toContain(outcome.code);
        }
      }
    }
  });

  test("the same input gives the same answer, and the input is not changed", () => {
    const given = input("It costs 150 SAR at 9:00.", [price("150 SAR")]);
    const before = JSON.stringify(given);
    expect(checkReply(given)).toEqual(checkReply(given));
    expect(JSON.stringify(given)).toBe(before);
  });
});

describe("what the code's review found (docs/reviews/2026-11-26-gate4-u9-reply-checks.md)", () => {
  const P150: Claim = price("150 SAR");
  const fails = (reply: string, claims: readonly Claim[] = [], batch: string[] = []) =>
    expect(verdict(reply, claims, { batch }), reply).not.toBe("passes");

  test("R1: a business's name of any punctuation does not throw", () => {
    for (const name of [
      "Al-Noor Salon",
      "Noor - Beauty",
      `Al${at(0x2013)}Noor`,
      "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      "a",
      "5",
      "",
    ]) {
      const profile: BusinessProfile = { ...SALON, name };
      expect(() => checkReply(input("hello", [], { profile }))).not.toThrow();
      expect(verdict(`Welcome to ${name}, hello`, [], { profile }), name).toMatch(/^passes|^O/);
    }
    expect(
      verdict("Welcome to Al-Noor Salon!", [], { profile: { ...SALON, name: "Al-Noor Salon" } }),
    ).toBe("passes");
    const dashed: BusinessProfile = { ...SALON, currency: { code: "X-Y", decimals: 2 } };
    expect(() => checkReply(input("150 X-Y", [], { profile: dashed }))).not.toThrow();
  });

  test("R2: a value inside an address does not hide the address", () => {
    for (const reply of [
      "https://150SAR.evil.com/pay",
      "Pay at 150SAR.evil.example",
      "evil.150SAR.com",
    ]) {
      expect(verdict(reply, [P150]), reply).toBe("O5 link");
    }
    expect(verdict("9am.evil.com/pay", [["opening-hours", "1", "9 am"]])).toBe("O5 link");
    expect(verdict("pay.5pm.co", [], { batch: ["5pm?"] })).toBe("O5 link");
  });

  test("R3: addresses after dots and before dashes, with a coded ending, or with the dot disguised", () => {
    for (const reply of [
      "pay here...evil.com/pay",
      `pay here${at(0x2026)}evil.com/pay`,
      "Pay here: .evil.com",
      "..evil.com",
      "visit evil.com- now",
      `evil.com${at(0x2014)}great`,
      "evil.xn--p1ai",
      "evil . com",
      "evil .com",
      "evil. com",
      "evil[.]com",
      "evil(.)com",
      "evil dot cc",
      "evil  dot  com",
      `evil${at(0x3002)}com`,
    ]) {
      expect(verdict(reply), reply).toBe("O5 link");
    }
    // A sentence's end is not an address.
    expect(verdict("See you. Come early.")).toBe("passes");
    expect(verdict("Visit the store. Online booking is closed.")).toBe("passes");
  });

  test("R4: a name at a provider with no dot, as payment addresses are written", () => {
    for (const reply of ["pay to salonpay@okaxis", "UPI: evil@ybl", "send to evil@paytm please"]) {
      expect(verdict(reply), reply).toBe("O5 handle");
    }
  });

  test("R5: only a list numbered 1, 2, 3 in order is a list", () => {
    fails("200. Would you like to book?");
    fails("Prices:\n200) riyals for the haircut");
    fails("1. Haircut\n250. Colour");
    fails("Call:\n055. then\n555. then\n010. then\n0. done");
    fails("Prices:\r200. riyals");
    fails(`Prices:${at(0x2028)}200. riyals`);
    expect(verdict("1. Haircut\n2. Colour\n3. Styling\n\nAnything else?\n1. Yes\n2. No")).toBe(
      "passes",
    );
    // One line alone is not a list: its number is a number.
    expect(verdict("2. Colour")).toBe("O3 number-unknown");
    expect(verdict("1. Haircut\n3. Styling")).toBe("O3 number-unknown");
  });

  test("R6: a number made another number by a letter or a word after it", () => {
    for (const reply of ["150k SAR", "150K", "150 thousand SAR", "150 million", "150 lakh"]) {
      fails(reply);
    }
    for (const reply of [
      "150 thousand riyals",
      "150k riyals",
      "150 hundred riyals",
      "150 ألف ريال",
    ]) {
      fails(reply, [P150]);
    }
    fails("Hello.", [price("150 thousand riyals")]);
    fails("Hello.", [price("150k")]);
    fails("Open at 16h.");
  });

  test("R7: grouping that is no grouping cannot be read", () => {
    for (const reply of ["only 0.150 SAR", "0,150 SAR", "1.50,00 SAR", "1,50,000 SAR"]) {
      expect(verdict(reply, [P150]), reply).toBe("O3 value-unreadable");
    }
    expect(verdict("it costs 0.150")).toBe("O3 value-unreadable");
    expect(verdict("0.010% off", [["service-detail", S, "10%"]])).toBe("O3 value-unreadable");
    fails("Hello.", [price("0.150")]);
    expect(scaledNumber("0.150", 2)).toBeNull();
    expect(scaledNumber("1.50,00", 2)).toBeNull();
    expect(scaledNumber("12,34,567", 2)).toBeNull();
    expect(scaledNumber("1,234,567.5", 2)).toBe(123_456_750);
    expect(scaledNumber("0.15", 2)).toBe(15);
    expect(scaledNumber("007", 0)).toBe(7);
  });

  test("R8: a price shaped like a time or a date does not pass by the exception or a time claim", () => {
    fails("Yes, 9.50", [], ["is the trim 9.50?"]);
    fails("Yes, 20.00.", [], ["is it 20.00?"]);
    fails("Yes, 2.50 sar", [], ["2.50?"]);
    fails("Yes, 1/2 price for students!", [], ["do students get 1/2 price?"]);
    fails("costs 9.50", [["opening-hours", "1", "9:00"]]);
  });

  test("R9: a currency marker in a form the scanner joins, or left on the line", () => {
    for (const reply of [
      "The haircut costs 45 sar",
      "The haircut costs 9 Sar",
      "45  SAR",
      "*45* SAR",
      "45\nSAR",
      "45-SAR",
      "SAR: 45",
      "45 (SAR)",
      "45 for the trim, in SAR",
      "The price in riyals is 45",
    ]) {
      fails(reply);
    }
  });

  test("R10: a number beside a month, a percent word or a time word in a form the scanner does not read", () => {
    for (const reply of [
      "closed on March the 9th",
      "closed on March, 9",
      "closed March  9",
      "closed 9-March",
      "closed on 9 de marso",
      "closed in March, on the 9",
      "open until 9 o'clock",
      "open till 9 p. m.",
      "45 per-cent off",
      "45 off, percent",
    ]) {
      fails(reply);
    }
  });

  test("R11: the instructions repeated with something unseen, a mark or a hyphen inside the words", () => {
    const instructions =
      "You are the assistant of a business. Never state a price that the data does not give. Write every amount in digits and return one claim for each.";
    for (const inside of [at(0x200b), at(0xad), at(0x301), "'", "-"]) {
      const disguised = instructions
        .split(" ")
        .map((word, index) => (index % 6 === 0 ? `${word[0]}${inside}${word.slice(1)}` : word))
        .join(" ");
      expect(verdict(disguised, [], { instructions })).toBe("O6 instructions");
    }
  });

  test("R12: a claim's value holds values and nothing else that is checked", () => {
    fails("Hello.", [["opening-hours", "1", "9:00 evil.com 77"]]);
    fails("Hello.", [["opening-hours", "1", "9:00 and 77"]]);
    fails("Hello.", [price("150 SAR evil.com")]);
    fails("Hello.", [["policy", P, "17:00 and 3"]]);
  });

  test("R13: an address is compared with its scheme, unless that is the web's", () => {
    expect(verdict("evil.com://salon.example/book")).toBe("O5 link");
    expect(verdict("javascript://salon.example/book")).toBe("O5 link");
    expect(verdict("http://salon.example/book")).toBe("passes");
    expect(verdict("HTTPS://salon.example/book")).toBe("passes");
  });

  test("R14: a reply of nothing a reader sees is empty", () => {
    for (const reply of [at(1) + at(2), at(0x2800), at(0x301), at(0xa0), `${at(0x200b)} \n`]) {
      expect(verdict(reply)).toBe("O7 empty");
    }
    expect(verdict(at(0x1f44d))).toBe("passes");
  });

  test("R16: stored texts are read once for a call, however many claims ask", () => {
    const body = `Cancel before 17:00. ${"Please be on time. ".repeat(400)}`;
    const profile: BusinessProfile = { ...SALON, policies: [{ id: P, title: "T", body }] };
    const claims: Claim[] = Array.from({ length: 30 }, () => ["policy", P, "17:00"]);
    const started = performance.now();
    expect(verdict("Cancel before 17:00.", claims, { profile })).toBe("passes");
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("the review's surviving mutants: each rule now has a case that needs it", () => {
    // The minutes of the opening hours are numbers the business holds.
    const half: BusinessProfile = {
      ...SALON,
      openingHours: [{ weekday: 1, periods: [{ opens: "09:30", closes: "13:00" }] }],
    };
    expect(verdict("The number 30.", [], { profile: half })).toBe("passes");
    expect(verdict("The number 30.")).toBe("O3 number-unknown");
    // A bank account needs its check digits right; without them it is a long number.
    expect(checkReply(input("Pay to GB82 WEST 1234 5698 7654 33")).checks.O5).toEqual({
      passed: false,
      code: "number",
    });
    // Every dash reads as a hyphen.
    expect(
      verdict(`On 12${at(0x2013)}3${at(0x2013)}2027.`, [], { batch: ["12 March 2027?"] }),
    ).toBe("passes");
    // A mark after a digit is removed.
    expect(verdict(`It costs 1${at(0x308)}50 SAR.`, [price("150 SAR")])).toBe("passes");
    // A weekday is named exactly as the model was given it.
    for (const item of ["01", " 1", "1.0", "1 "]) {
      expect(verdict("At 9:00.", [["opening-hours", item, "9:00"]]), item).toBe("O3 claim-failed");
    }
    // A number before a currency marker is the amount, not the year.
    expect(verdict("On 5 May 2028 SAR.", [], { batch: ["5 May?"] })).toBe("O3 amount-unclaimed");
    // A contact equals a stored one of its own kind.
    const handle: BusinessProfile = { ...SALON, supportContact: "@salon.example" };
    expect(verdict("Visit salon.example", [], { profile: handle })).toBe("O5 link");
    // The tatweel is removed before a word is matched.
    expect(verdict(`200 ري${at(0x640)}ال`)).toBe("O3 amount-unclaimed");
    // A code ends where a word ends: "USDT" is no dollar, and 150 is then a number the
    // business stored, which passes whatever word follows it (the note, section 9).
    expect(verdict("150 USDT")).toBe("passes");
    expect(verdict("150 USD")).toBe("O3 amount-unclaimed");
  });
});
