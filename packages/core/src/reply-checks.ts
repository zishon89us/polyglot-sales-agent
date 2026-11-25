// The checks on a reply before it may be sent (guardrail policy, section
// 4: O3, O5, O6 and O7; M3 unit U9; design note
// docs/design/notes/m3-u9-output-checks.md). One pure function: given a
// reply, its claims and the business's data, it says whether the reply
// passes each check, and under which code it does not. A code never holds
// a word of the reply, of the customer or of the business's data.

import {
  CURRENCY_CODES,
  CURRENCY_NAMES,
  CURRENCY_SIGNS,
  DAY_HALVES,
  DAY_PARTS,
  MONTHS,
  OCLOCK_WORDS,
  PERCENT_WORDS,
  SPOKEN_ENDINGS,
} from "./markers.ts";
import { REPLY_MAX } from "./model.ts";
import { CORE_CLAIM_KINDS } from "./names.ts";
import type { BusinessProfile } from "./profile.ts";

export const REPLY_CHECKS = ["O7", "O6", "O3", "O5"] as const;
export type ReplyCheck = (typeof REPLY_CHECKS)[number];

export const REPLY_CHECK_CODES = [
  "empty",
  "too-long",
  "canary",
  "instructions",
  "value-unreadable",
  "claim-failed",
  "amount-unclaimed",
  "percentage-unclaimed",
  "time-unclaimed",
  "date-unclaimed",
  "number-unknown",
  "link",
  "email",
  "handle",
  "number",
  "bank-account",
] as const;
export type ReplyCheckCode = (typeof REPLY_CHECK_CODES)[number];

/** How many words of the instructions in a row a reply may not repeat. */
export const INSTRUCTION_RUN = 12;
/** The fewest digits that make a long number. */
export const LONG_NUMBER_DIGITS = 7;

/** A clock time or a date as a pack's checker is given it. */
export type PackValue =
  | { readonly kind: "time"; readonly minutes: readonly number[] }
  | { readonly kind: "date"; readonly year: number; readonly month: number; readonly day: number };
/** Says whether a claim of a pack's kind holds for one time or date. Synchronous. */
export type PackClaimChecker = (item: string, value: PackValue) => boolean;

/**
 * The checkers packs registered, by claim kind. Throws on a kind of the
 * core's and on a kind given twice: a pack cannot replace a check.
 */
export function packClaimCheckers(
  registered: readonly (readonly [string, PackClaimChecker])[],
): ReadonlyMap<string, PackClaimChecker> {
  const by = new Map<string, PackClaimChecker>();
  for (const [kind, checker] of registered) {
    if ((CORE_CLAIM_KINDS as readonly string[]).includes(kind) || by.has(kind)) {
      throw new Error("a claim kind is registered once, and never one of the core's");
    }
    by.set(kind, checker);
  }
  return by;
}

export interface ReplyCheckInput {
  readonly reply: string;
  readonly claims: readonly {
    readonly kind: string;
    readonly item: string;
    readonly value: string;
  }[];
  /** As the turn read it and gave it to the model. */
  readonly profile: BusinessProfile;
  /** The texts of the customer's latest batch. */
  readonly batch: readonly string[];
  readonly canary: string;
  /** The prompt's instruction text: not the business's data, not the session. */
  readonly instructions: string;
  /** Today in the tenant's time zone. */
  readonly today: { readonly year: number; readonly month: number; readonly day: number };
  readonly packCheckers?: ReadonlyMap<string, PackClaimChecker>;
}

export type CheckOutcome =
  | { readonly passed: true }
  | { readonly passed: false; readonly code: ReplyCheckCode };

export interface ReplyCheckResult {
  readonly passed: boolean;
  /** The first check that failed, in the order of `REPLY_CHECKS`. */
  readonly failed?: { readonly check: ReplyCheck; readonly code: ReplyCheckCode };
  readonly checks: Readonly<Record<ReplyCheck, CheckOutcome>>;
}

// ---------------------------------------------------------------------
// Reading the text (section 3)

const at = (codePoint: number): string => String.fromCodePoint(codePoint);
/** Replaces text that has been taken: a private character that no pattern matches. */
const BLANK = at(0xe0fe);
/** A currency sign that the list does not know. */
const UNKNOWN_SIGN = at(0xe0fd);
const SIGNS = Object.keys(CURRENCY_SIGNS);
const signMark = (index: number): string => at(0xe000 + index);
const SIGN_CLASS = `[${signMark(0)}-${signMark(SIGNS.length - 1)}${UNKNOWN_SIGN}]`;

const CURRENCY_SIGN = /\p{Sc}/u;
const DECIMAL_DIGIT = /\p{Nd}/u;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARK_AFTER_DIGIT = /(?<=[0-9])\p{M}+/gu;
const DASHES = new RegExp(`\\p{Pd}|${at(0x2212)}`, "gu");

/** The value of a decimal digit of any script: its place in its run of ten. */
function digitValue(character: string): number {
  const codePoint = character.codePointAt(0) as number;
  let below = 0;
  while (below < 9 && DECIMAL_DIGIT.test(at(codePoint - below - 1))) {
    below += 1;
  }
  return below;
}

/** Lower case and the Arabic forms of two Persian letters, a character for a character. */
function folded(text: string): string {
  let out = "";
  for (const character of text) {
    const lower = character.toLowerCase();
    const one = lower.length === character.length ? lower : character;
    out += one === at(0x6cc) ? at(0x64a) : one === at(0x6a9) ? at(0x643) : one;
  }
  return out;
}

/** The text made plain. Case is kept; `folded` gives the copy words are matched in. */
export function plainText(text: string): string {
  let marked = "";
  for (const character of text) {
    if (CURRENCY_SIGN.test(character)) {
      const narrow = character.normalize("NFKC");
      const index = SIGNS.indexOf(SIGNS.includes(narrow) ? narrow : character);
      marked += index === -1 ? UNKNOWN_SIGN : signMark(index);
    } else {
      marked += character;
    }
  }
  let plain = "";
  for (const character of marked.normalize("NFKC")) {
    plain += DECIMAL_DIGIT.test(character) ? String(digitValue(character)) : character;
  }
  return plain
    .replaceAll(at(0x66b), ".")
    .replaceAll(at(0x66c), ",")
    .replaceAll(at(0x66a), "%")
    .replace(DASHES, "-")
    .replace(IGNORABLE, "")
    .replace(MARK_AFTER_DIGIT, "")
    .replaceAll(at(0x640), "");
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
/** An alternation of words, longest first, each as it reads once made plain and folded. */
const words = (list: readonly string[]): string =>
  [...new Set(list.map((word) => folded(plainText(word))))]
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join("|");

/** Not directly before or after a letter or a mark of one: where a word ends. */
const NOT_AFTER_WORD = "(?<![\\p{L}\\p{M}\\p{N}])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{M}])";

/** A number: digits, `,` or `.` between two digits, a space or `'` only before exactly three. */
const NUMBER = "[0-9]+(?:(?:[.,]|[ '](?=[0-9]{3}(?![0-9])))[0-9]+)*";

// ---------------------------------------------------------------------
// Values (sections 4.1 and 4.2)

type Value =
  | { readonly kind: "amount"; readonly minor: number | null; readonly tenant: boolean }
  | { readonly kind: "percentage"; readonly scaled: number | null }
  | { readonly kind: "time"; readonly minutes: readonly number[] | null }
  | { readonly kind: "date"; readonly ymd: number | null };

const unreadable = (value: Value): boolean =>
  (value.kind === "amount" && value.minor === null) ||
  (value.kind === "percentage" && value.scaled === null) ||
  (value.kind === "time" && value.minutes === null) ||
  (value.kind === "date" && value.ymd === null);

function equal(a: Value, b: Value): boolean {
  if (unreadable(a) || unreadable(b)) {
    return false;
  }
  if (a.kind === "amount" && b.kind === "amount") {
    return a.tenant && b.tenant && a.minor === b.minor;
  }
  if (a.kind === "percentage" && b.kind === "percentage") {
    return a.scaled === b.scaled;
  }
  if (a.kind === "time" && b.kind === "time") {
    return (a.minutes ?? []).some((minute) => (b.minutes ?? []).includes(minute));
  }
  return a.kind === "date" && b.kind === "date" && a.ymd === b.ymd;
}

interface Context {
  /** The tenant's currency, or null: then no amount is in it. */
  readonly currency: { readonly code: string; readonly decimals: number } | null;
  readonly today: { readonly year: number; readonly month: number; readonly day: number };
}

/**
 * A number as a count of a unit with `decimals` places, or null if it
 * cannot be read. The last `,` or `.` is the decimal point if 1 or 2
 * digits follow it, or exactly 3 when `decimals` is 3; otherwise every
 * separator groups. Digits beyond `decimals` must be zeros.
 */
export function scaledNumber(text: string, decimals: number): number | null {
  const compact = text.replace(/[ ']/g, "");
  const last = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  const after = last === -1 ? 0 : compact.length - last - 1;
  const point = last !== -1 && (after <= 2 || (after === 3 && decimals === 3));
  const whole = (point ? compact.slice(0, last) : compact).replace(/[.,]/g, "");
  let fraction = point ? compact.slice(last + 1) : "";
  if (fraction.length > decimals) {
    if (/[1-9]/.test(fraction.slice(decimals))) {
      return null;
    }
    fraction = fraction.slice(0, decimals);
  }
  const value = Number(`${whole}${fraction.padEnd(decimals, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
}

const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const ymd = (year: number, month: number, day: number): number | null =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
    ? year * 10_000 + month * 100 + day
    : null;
/** A day and a month with no year: the next such date on or after today. */
function nextDate(context: Context, month: number, day: number): number | null {
  const { today } = context;
  for (let year = today.year; year <= today.year + 8; year += 1) {
    const candidate = ymd(year, month, day);
    if (candidate !== null && candidate >= today.year * 10_000 + today.month * 100 + today.day) {
      return candidate;
    }
  }
  return null;
}
const fullYear = (text: string): number => (text.length === 2 ? 2000 + Number(text) : Number(text));

const MONTH_OF = new Map<string, number>(
  MONTHS.flatMap((names, index) => names.map((name) => [folded(plainText(name)), index + 1])),
);
const MONTH = words(MONTHS.flat());
const ORDINAL = "(?:st|nd|rd|th)?";
const SIGN_OR_NAME_AHEAD = new RegExp(
  `^ ?(?:${SIGN_CLASS}|(?:${words(CURRENCY_NAMES.flatMap(([names]) => names))})${NOT_BEFORE_WORD}|[A-Z]{3}(?![\\p{L}]))`,
  "u",
);

const NAME_SETS = new Map<string, readonly string[]>(
  CURRENCY_NAMES.flatMap(([names, currencies]) =>
    names.map((name) => [folded(plainText(name)), currencies] as const),
  ),
);
const NAME = words(CURRENCY_NAMES.flatMap(([names]) => names));
const HALF_OF = new Map<string, "am" | "pm">(
  DAY_HALVES.flatMap(([markers, half]) =>
    markers.map((marker) => [folded(plainText(marker)), half] as const),
  ),
);
const HALF = words(DAY_HALVES.flatMap(([markers]) => markers));
const PART_OF = new Map<string, "am" | "pm">(
  DAY_PARTS.flatMap(([parts, half]) =>
    parts.map((part) => [folded(plainText(part)), half] as const),
  ),
);
const PART = words(DAY_PARTS.flatMap(([parts]) => parts));
const OCLOCK = words(OCLOCK_WORDS);
const PERCENT = words(PERCENT_WORDS);

interface Found {
  readonly start: number;
  readonly end: number;
  readonly value: Value;
}

interface Scan {
  /** The plain text, with every value found replaced by `BLANK`. */
  readonly rest: string;
  readonly values: readonly Value[];
}

/** Finds every value of the four kinds, in the order of section 4.1. */
function scanValues(plain: string, context: Context): Scan {
  let text = plain;
  const found: Found[] = [];
  const take = (start: number, end: number, value: Value | undefined): void => {
    if (value !== undefined) {
      found.push({ start, end, value });
    }
    text = text.slice(0, start) + BLANK.repeat(end - start) + text.slice(end);
  };
  /** Runs a pattern over the folded text; `read` says what a match is, and how much of it. */
  const each = (
    pattern: string,
    read: (match: RegExpExecArray, lower: string) => { value?: Value; length?: number } | undefined,
  ): void => {
    const expression = new RegExp(pattern, "gu");
    for (;;) {
      const lower = folded(text);
      const match = expression.exec(lower);
      if (match === null) {
        return;
      }
      const result = read(match, lower);
      if (result === undefined) {
        expression.lastIndex = match.index + 1;
      } else {
        const end = match.index + (result.length ?? match[0].length);
        take(match.index, end, result.value);
        expression.lastIndex = end;
      }
    }
  };
  const date = (year: string | undefined, month: number, day: number): Value => ({
    kind: "date",
    ymd: year === undefined ? nextDate(context, month, day) : ymd(fullYear(year), month, day),
  });

  // Dates.
  each("(?<![0-9])([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?![0-9])", (match) => ({
    value: date(match[1], Number(match[2]), Number(match[3])),
  }));
  each(
    "(?<![0-9]|[0-9][/.-])([0-9]{1,2})(?:/([0-9]{1,2})(?:/([0-9]{4}|[0-9]{2}))?|([.-])([0-9]{1,2})\\4([0-9]{4}|[0-9]{2}))(?![0-9]|[/.-][0-9])",
    (match) => {
      const day = Number(match[1]);
      const month = Number(match[2] ?? match[5]);
      const year = match[3] ?? match[6];
      if (day < 1 || day > 31 || month < 1 || month > 12) {
        return undefined;
      }
      // "24/7": always open, not the 24th of July.
      if (match[0] === "24/7") {
        return {};
      }
      return { value: date(year, month, day) };
    },
  );
  const named = (match: RegExpExecArray, day: string, month: string) => {
    const number = Number(day);
    if (number < 1 || number > 31) {
      return undefined;
    }
    // A number directly before a currency marker is an amount, never the year.
    const year = match.groups?.["year"];
    const yearIsAmount =
      year !== undefined && SIGN_OR_NAME_AHEAD.test(text.slice(match.index + match[0].length));
    const kept = yearIsAmount ? match[0].replace(/,? [0-9]{4}$/, "") : match[0];
    return {
      value: date(yearIsAmount ? undefined : year, MONTH_OF.get(month) as number, number),
      length: kept.length,
    };
  };
  each(
    `(?<![0-9]|[0-9][.,:/-])(?<day>[0-9]{1,2})${ORDINAL} ?(?:of )?(?<month>${MONTH})${NOT_BEFORE_WORD}(?:,? (?<year>[0-9]{4})(?![0-9]))?`,
    (match, lower) =>
      /[\p{L}\p{M}]/u.test(lower[match.index - 1] ?? "")
        ? undefined
        : named(match, match.groups?.["day"] as string, match.groups?.["month"] as string),
  );
  each(
    `${NOT_AFTER_WORD}(?<month>${MONTH}) ?(?<day>[0-9]{1,2})${ORDINAL}(?![0-9]|[.,:/-][0-9])(?:,? (?<year>[0-9]{4})(?![0-9]))?`,
    (match) => named(match, match.groups?.["day"] as string, match.groups?.["month"] as string),
  );

  // Amounts: a number with a currency marker on either side.
  const tenant = context.currency;
  const codes = [...new Set([...CURRENCY_CODES, ...(tenant === null ? [] : [tenant.code])])];
  const CODE = codes.map(escaped).join("|");
  // A sign or a code is looked for in the text as written (a code is read in
  // capitals only); a name in the folded text.
  const before = new RegExp(
    `(?:(?<letter>[\\p{L}])?(?<sign>${SIGN_CLASS})|(?<![\\p{L}])(?<code>${CODE})) ?$`,
    "u",
  );
  const beforeName = new RegExp(`${NOT_AFTER_WORD}(?<name>${NAME}) ?$`, "u");
  const after = new RegExp(
    `^(?:(?<slash>/-)| ?(?:(?<sign>${SIGN_CLASS})|(?<code>${CODE})(?![\\p{L}])))`,
    "u",
  );
  const afterName = new RegExp(`^ ?(?:[\\p{L}\\p{M}]+ )?(?<name>${NAME})${NOT_BEFORE_WORD}`, "u");
  const currenciesOf = (groups: Record<string, string | undefined>): readonly string[] => {
    if (groups["slash"] !== undefined) {
      return tenant === null ? [] : [tenant.code];
    }
    if (groups["sign"] !== undefined) {
      if (groups["letter"] !== undefined || groups["sign"] === UNKNOWN_SIGN) {
        return [];
      }
      const sign = SIGNS[(groups["sign"].codePointAt(0) as number) - 0xe000] as string;
      return CURRENCY_SIGNS[sign] ?? [];
    }
    if (groups["code"] !== undefined) {
      return [groups["code"]];
    }
    return NAME_SETS.get(groups["name"] as string) ?? [];
  };
  {
    const expression = new RegExp(`(?<![0-9]|[0-9][.,])${NUMBER}`, "gu");
    for (;;) {
      const match = expression.exec(text);
      if (match === null) {
        break;
      }
      const start = match.index;
      const end = start + match[0].length;
      const lower = folded(text);
      const left = before.exec(text.slice(0, start)) ?? beforeName.exec(lower.slice(0, start));
      const right = after.exec(text.slice(end)) ?? afterName.exec(lower.slice(end));
      if (left === null && right === null) {
        continue;
      }
      const sets = [
        ...(left === null ? [] : [currenciesOf(left.groups ?? {})]),
        ...(right === null ? [] : [currenciesOf(right.groups ?? {})]),
      ];
      const inTenant = tenant !== null && sets.every((set) => set.includes(tenant.code));
      const from =
        left === null ? start : start - left[0].length + (left.groups?.["letter"]?.length ?? 0);
      const to = right === null ? end : end + right[0].length;
      take(from, to, {
        kind: "amount",
        minor: scaledNumber(match[0], tenant?.decimals ?? 2),
        tenant: inTenant,
      });
      expression.lastIndex = to;
    }
  }

  // Percentages.
  each(`(?<![0-9]|[0-9][.,])(${NUMBER}) ?(?:%|(?:${PERCENT})${NOT_BEFORE_WORD})`, (match) => ({
    value: { kind: "percentage", scaled: scaledNumber(match[1] as string, 4) },
  }));

  // Clock times.
  const minutesOf = (hour: number, minute: number, half: "am" | "pm" | undefined) => {
    if (half === undefined) {
      return hour === 24 ? [0] : [hour * 60 + minute];
    }
    if (hour < 1 || hour > 12) {
      return null;
    }
    return [((hour % 12) + (half === "pm" ? 12 : 0)) * 60 + minute];
  };
  each(
    `(?<![0-9]|[0-9][.,:])([0-9]{1,2})[:.]([0-9]{2})(?![0-9]|[.,:][0-9])(?: ?(${HALF})${NOT_BEFORE_WORD})?`,
    (match) => {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!((hour <= 23 && minute <= 59) || (hour === 24 && minute === 0))) {
        return undefined;
      }
      const half = match[3] === undefined ? undefined : HALF_OF.get(match[3]);
      return { value: { kind: "time", minutes: minutesOf(hour, minute, half) } };
    },
  );
  each(`(?<![0-9]|[0-9][.,:/-])([0-9]{1,2}) ?(${HALF})${NOT_BEFORE_WORD}`, (match) => {
    const hour = Number(match[1]);
    if (hour < 1 || hour > 12) {
      return undefined;
    }
    return {
      value: { kind: "time", minutes: minutesOf(hour, 0, HALF_OF.get(match[2] as string)) },
    };
  });
  each(
    `(?:${NOT_AFTER_WORD}(?<part>${PART}) )?(?<![0-9]|[0-9][.,:/-])(?<hour>[0-9]{1,2}) ?(?:${OCLOCK})${NOT_BEFORE_WORD}`,
    (match) => {
      const hour = Number(match.groups?.["hour"]);
      if (hour < 1 || hour > 12) {
        return undefined;
      }
      const part = match.groups?.["part"];
      const half = part === undefined ? undefined : PART_OF.get(part);
      // With no word for the part of the day, either half.
      const minutes =
        half === undefined ? [(hour % 12) * 60, ((hour % 12) + 12) * 60] : minutesOf(hour, 0, half);
      return { value: { kind: "time", minutes } };
    },
  );

  found.sort((a, b) => a.start - b.start);
  return { rest: text, values: found.map((one) => one.value) };
}

/** Every number in a text, as a number. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(new RegExp(NUMBER, "gu"))].flatMap((match) => {
    const value = scaledNumber(match[0], 4);
    return value === null ? [Number.NaN] : [value / 10_000];
  });
}

// ---------------------------------------------------------------------
// Contact details and links (section 6, O5)

type ContactKind = "link" | "email" | "handle" | "number" | "bank-account";
interface Contact {
  readonly kind: ContactKind;
  /** As it is compared. */
  readonly form: string;
}

const SOLID = `[^\\s${BLANK}]`;
const LABEL = "[\\p{L}\\p{N}-]+";
const DOMAIN = `${LABEL}(?:\\.${LABEL})*\\.\\p{L}{2,24}(?![\\p{L}\\p{N}-])`;
const CLOSING = /[.,;:!?)\]}'"]+$/;

function ibanValid(compact: string): boolean {
  const moved = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of moved) {
    const digits = /[0-9]/.test(character)
      ? character
      : String((character.codePointAt(0) as number) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function linkForm(text: string): string {
  const bare = text
    .replace(CLOSING, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "");
  const slash = bare.search(/[/?#]/);
  const host = slash === -1 ? bare : bare.slice(0, slash);
  const path = slash === -1 ? "" : bare.slice(slash).replace(/\/$/, "");
  return host.toLowerCase() + path;
}

/** Finds every contact detail and link; returns them and the text without them. */
function scanContacts(input: string): { rest: string; contacts: Contact[] } {
  let text = input;
  const contacts: Contact[] = [];
  const each = (
    pattern: RegExp,
    read: (match: RegExpExecArray) => { contact: Contact; length?: number } | undefined,
  ): void => {
    for (;;) {
      const match = pattern.exec(text);
      if (match === null) {
        return;
      }
      const result = read(match);
      if (result === undefined) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      const end = match.index + (result.length ?? match[0].length);
      contacts.push(result.contact);
      text = text.slice(0, match.index) + BLANK.repeat(end - match.index) + text.slice(end);
      pattern.lastIndex = end;
    }
  };
  each(/(?<![A-Z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}(?![A-Z0-9])/gu, (match) => {
    // The longest stretch whose check digits are right.
    for (let length = match[0].length; length >= 15; length -= 1) {
      const candidate = match[0].slice(0, length);
      const compact = candidate.replaceAll(" ", "");
      if (!candidate.endsWith(" ") && compact.length >= 15 && ibanValid(compact)) {
        return { contact: { kind: "bank-account", form: compact }, length };
      }
    }
    return undefined;
  });
  each(new RegExp(`[\\p{L}\\p{N}._%+-]+@${DOMAIN}`, "gu"), (match) => ({
    contact: { kind: "email", form: match[0].toLowerCase() },
  }));
  each(new RegExp(`[a-z][a-z0-9+.-]*://${SOLID}+`, "giu"), (match) => {
    const kept = match[0].replace(CLOSING, "");
    return { contact: { kind: "link", form: linkForm(kept) }, length: kept.length };
  });
  each(new RegExp(`(?<![\\p{L}\\p{N}])www\\.${SOLID}+`, "giu"), (match) => {
    const kept = match[0].replace(CLOSING, "");
    return { contact: { kind: "link", form: linkForm(kept) }, length: kept.length };
  });
  each(new RegExp(`(?<![\\p{L}\\p{N}@.-])${DOMAIN}(?:[/?#]${SOLID}*)?`, "gu"), (match) => {
    const kept = match[0].replace(CLOSING, "");
    return { contact: { kind: "link", form: linkForm(kept) }, length: kept.length };
  });
  each(
    new RegExp(
      `(?<![\\p{L}\\p{N}])(${LABEL}) ?(?:dot|\\(dot\\)|\\[dot\\]) ?(${SPOKEN_ENDINGS.join("|")})(?![\\p{L}\\p{N}])`,
      "giu",
    ),
    (match) => ({
      contact: { kind: "link", form: `${match[1]}.${match[2]}`.toLowerCase() },
    }),
  );
  each(/(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}._]{2,}/gu, (match) => ({
    contact: { kind: "handle", form: match[0].toLowerCase().replace(/\.+$/, "") },
  }));
  each(new RegExp(`[0-9](?:[^\\p{L}${BLANK}]*[0-9])+`, "gu"), (match) => {
    const digits = match[0].replace(/[^0-9]/g, "");
    return digits.length >= LONG_NUMBER_DIGITS
      ? { contact: { kind: "number", form: digits } }
      : undefined;
  });
  return { rest: text, contacts };
}

// ---------------------------------------------------------------------
// The four checks

/** A list's numbering at the start of a line is not a number of the reply. */
const LIST_MARKER = /^([ \t]*)([0-9]{1,3})(?=[.)] )/gmu;

interface Reading {
  readonly values: readonly Value[];
  readonly contacts: readonly Contact[];
  readonly numbers: readonly number[];
}

function read(text: string, context: Context, name: string | null): Reading {
  let plain = plainText(text);
  if (name !== null) {
    const plainName = plainText(name);
    if (plainName.trim() !== "") {
      // Not as a part of something longer: an address that begins with the name is read.
      plain = plain.replace(
        new RegExp(
          `(?<![\\p{L}\\p{N}@.])${escaped(plainName)}(?![\\p{L}\\p{N}/]|\\.[\\p{L}\\p{N}])`,
          "giu",
        ),
        (found) => BLANK.repeat(found.length),
      );
    }
  }
  const scanned = scanValues(plain, context);
  const contacts = scanContacts(scanned.rest);
  const rest = contacts.rest.replace(
    LIST_MARKER,
    (_whole, space: string, digits: string) => space + BLANK.repeat(digits.length),
  );
  return { values: scanned.values, contacts: contacts.contacts, numbers: numbersIn(rest) };
}

function checkLength(input: ReplyCheckInput): CheckOutcome {
  if ([...input.reply].length > REPLY_MAX) {
    return { passed: false, code: "too-long" };
  }
  return /[^\s]/u.test(plainText(input.reply).replaceAll(BLANK, ""))
    ? { passed: true }
    : { passed: false, code: "empty" };
}

const lettersAndDigits = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const wordsOf = (text: string): string[] =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

function checkLeak(input: ReplyCheckInput): CheckOutcome {
  const canary = lettersAndDigits(input.canary);
  const said = [input.reply, ...input.claims.flatMap((claim) => [claim.item, claim.value])];
  if (canary !== "" && said.some((text) => lettersAndDigits(text).includes(canary))) {
    return { passed: false, code: "canary" };
  }
  const instructions = wordsOf(input.instructions);
  const runs = new Set<string>();
  for (let start = 0; start + INSTRUCTION_RUN <= instructions.length; start += 1) {
    runs.add(instructions.slice(start, start + INSTRUCTION_RUN).join(" "));
  }
  const reply = wordsOf(input.reply);
  for (let start = 0; start + INSTRUCTION_RUN <= reply.length; start += 1) {
    if (runs.has(reply.slice(start, start + INSTRUCTION_RUN).join(" "))) {
      return { passed: false, code: "instructions" };
    }
  }
  return { passed: true };
}

const UNCLAIMED = {
  amount: "amount-unclaimed",
  percentage: "percentage-unclaimed",
  time: "time-unclaimed",
  date: "date-unclaimed",
} as const;

/** Reads one claim: the values it covers, or undefined if it does not pass. */
function claimValues(
  claim: ReplyCheckInput["claims"][number],
  input: ReplyCheckInput,
  context: Context,
): readonly Value[] | undefined {
  const { profile } = input;
  const made = read(claim.value, context, null);
  if (made.values.some(unreadable)) {
    return undefined;
  }
  const stored = (texts: readonly string[]): readonly Value[] =>
    texts.flatMap((text) => read(text, context, null).values);
  const allIn = (texts: readonly string[]): readonly Value[] | undefined => {
    const known = stored(texts);
    return made.values.length > 0 &&
      made.values.every((value) => known.some((other) => equal(value, other)))
      ? made.values
      : undefined;
  };
  switch (claim.kind) {
    case "price": {
      const service = profile.services.find((one) => one.id === claim.item);
      const currency = profile.currency;
      if (service === undefined || currency === null) {
        return undefined;
      }
      let amount: Value | undefined;
      if (made.values.length === 1 && made.numbers.length === 0) {
        amount = made.values[0];
      } else if (made.values.length === 0 && made.contacts.length === 0) {
        // A price claim's value needs no marker: one number, in the tenant's currency.
        const numbers = [...plainText(claim.value).matchAll(new RegExp(NUMBER, "gu"))];
        if (numbers.length === 1) {
          amount = {
            kind: "amount",
            minor: scaledNumber((numbers[0] as RegExpExecArray)[0], currency.decimals),
            tenant: true,
          };
        }
      }
      return amount !== undefined &&
        amount.kind === "amount" &&
        amount.tenant &&
        amount.minor === service.priceMinor
        ? [amount]
        : undefined;
    }
    case "opening-hours": {
      const day = profile.openingHours?.find((one) => String(one.weekday) === claim.item);
      if (day === undefined || made.values.length === 0) {
        return undefined;
      }
      const minutes = day.periods.flatMap((period) =>
        [period.opens, period.closes].map((time) => {
          const [hour, minute] = time.split(":").map(Number) as [number, number];
          return (hour % 24) * 60 + minute;
        }),
      );
      return made.values.every(
        (value) =>
          value.kind === "time" && (value.minutes ?? []).some((minute) => minutes.includes(minute)),
      )
        ? made.values
        : undefined;
    }
    case "service-detail": {
      const service = profile.services.find((one) => one.id === claim.item);
      return service === undefined ? undefined : allIn([service.name, service.description]);
    }
    case "policy": {
      const policy = profile.policies.find((one) => one.id === claim.item);
      return policy === undefined ? undefined : allIn([policy.title, policy.body]);
    }
    default: {
      const checker = input.packCheckers?.get(claim.kind);
      if (checker === undefined || made.values.length === 0) {
        return undefined;
      }
      for (const value of made.values) {
        // A pack is asked about times and dates only.
        if (value.kind !== "time" && value.kind !== "date") {
          return undefined;
        }
        const given: PackValue =
          value.kind === "time"
            ? { kind: "time", minutes: value.minutes ?? [] }
            : {
                kind: "date",
                year: Math.floor((value.ymd ?? 0) / 10_000),
                month: Math.floor(((value.ymd ?? 0) % 10_000) / 100),
                day: (value.ymd ?? 0) % 100,
              };
        try {
          if (checker(claim.item, given) !== true) {
            return undefined;
          }
        } catch {
          return undefined;
        }
      }
      return made.values;
    }
  }
}

/** The numbers the business's own data holds (section 4.4). */
function knownNumbers(profile: BusinessProfile): Set<number> {
  const known = new Set<number>();
  const texts = [
    profile.name,
    ...profile.services.flatMap((service) => [service.name, service.description]),
    ...profile.policies.flatMap((policy) => [policy.title, policy.body]),
  ];
  for (const text of texts) {
    for (const number of numbersIn(plainText(text))) {
      known.add(number);
    }
  }
  if (profile.currency !== null) {
    for (const service of profile.services) {
      known.add(service.priceMinor / 10 ** profile.currency.decimals);
    }
  }
  for (const day of profile.openingHours ?? []) {
    for (const period of day.periods) {
      for (const time of [period.opens, period.closes]) {
        const [hour, minute] = time.split(":").map(Number) as [number, number];
        known.add(hour);
        known.add(minute);
        known.add(hour % 12 === 0 ? 12 : hour % 12);
      }
    }
  }
  return known;
}

function checkValues(input: ReplyCheckInput, context: Context, reply: Reading): CheckOutcome {
  const covered: Value[] = [];
  for (const claim of input.claims) {
    const values = claimValues(claim, input, context);
    if (values === undefined) {
      return { passed: false, code: "claim-failed" };
    }
    covered.push(...values);
  }
  const asked = input.batch.flatMap((text) => read(text, context, null).values);
  for (const value of reply.values) {
    if (unreadable(value)) {
      return { passed: false, code: "value-unreadable" };
    }
    const claimed = covered.some((other) => equal(value, other));
    const echoed =
      (value.kind === "time" || value.kind === "date") &&
      asked.some((other) => equal(value, other));
    if (!claimed && !echoed) {
      return { passed: false, code: UNCLAIMED[value.kind] };
    }
  }
  const known = knownNumbers(input.profile);
  return reply.numbers.every((number) => known.has(number))
    ? { passed: true }
    : { passed: false, code: "number-unknown" };
}

function checkContacts(input: ReplyCheckInput, context: Context, reply: Reading): CheckOutcome {
  const { profile } = input;
  const stored = [
    profile.name,
    profile.supportContact ?? "",
    ...profile.services.flatMap((service) => [service.name, service.description]),
    ...profile.policies.flatMap((policy) => [policy.title, policy.body]),
  ].flatMap((text) => read(text, context, null).contacts);
  const unknown = reply.contacts.find(
    (contact) =>
      !stored.some((other) => other.kind === contact.kind && other.form === contact.form),
  );
  return unknown === undefined ? { passed: true } : { passed: false, code: unknown.kind };
}

/** Runs the four checks. All run; the reply passes only if all do. */
export function checkReply(input: ReplyCheckInput): ReplyCheckResult {
  const context: Context = { currency: input.profile.currency, today: input.today };
  const reply = read(input.reply, context, input.profile.name);
  const checks: Record<ReplyCheck, CheckOutcome> = {
    O7: checkLength(input),
    O6: checkLeak(input),
    O3: checkValues(input, context, reply),
    O5: checkContacts(input, context, reply),
  };
  const first = REPLY_CHECKS.find((check) => !checks[check].passed);
  if (first === undefined) {
    return { passed: true, checks };
  }
  const outcome = checks[first];
  return {
    passed: false,
    checks,
    ...(outcome.passed ? {} : { failed: { check: first, code: outcome.code } }),
  };
}
