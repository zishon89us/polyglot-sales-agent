// What a business says about itself, and the rules a profile file must
// keep (M3 unit U3; design note docs/design/notes/m3-u3-profile.md).
// Everything here is pure: no database, no clock, no file.

/** The most text a profile may hold, in code points (provisional; decisions row 41). */
export const PROFILE_BUDGET = 40_000;
export const PROFILE_MAX_SERVICES = 100;
export const PROFILE_MAX_POLICIES = 30;
/** The largest file that is read at all. */
export const PROFILE_FILE_MAX_BYTES = 1_000_000;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2_000;
export const BODY_MAX = 4_000;
export const EMAIL_MAX = 254;
export const PERIODS_PER_WEEKDAY_MAX = 4;

/** One opening or answering period: wall-clock times in the tenant's time zone. Weekday 1 is Monday. */
export interface HoursPeriod {
  readonly weekday: number;
  readonly opens: string;
  readonly closes: string;
}

export interface ProfileSettings {
  readonly currency: string;
  readonly supportContact: string;
  readonly notificationEmail: string;
  readonly businessHours: readonly HoursPeriod[];
  /** Null when the file gives none. */
  readonly openingHours: readonly HoursPeriod[] | null;
}

export interface ServiceEntry {
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly active: boolean;
}

export interface PolicyEntry {
  readonly title: string;
  readonly body: string;
}

/** A profile as an operator's file gives it: the whole of what a tenant stores. */
export interface ProfileFile {
  readonly settings: ProfileSettings;
  readonly services: readonly ServiceEntry[];
  readonly policies: readonly PolicyEntry[];
}

/**
 * A profile as the model is given it (design note, section 2). It holds
 * nothing from a contact's record, and is the same for every customer of a
 * tenant. Texts are the owner's own words: data, never instructions.
 */
export interface BusinessProfile {
  readonly name: string;
  readonly timeZone: string;
  /** Null until a profile is loaded. `decimals` is how many of a price's digits are after the point. */
  readonly currency: { readonly code: string; readonly decimals: number } | null;
  readonly supportContact: string | null;
  /** Active services only. */
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** In the currency's smallest unit. */
    readonly priceMinor: number;
  }[];
  readonly policies: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }[];
  /** Null until set. Then all seven weekdays, 1 to 7; one with no period is closed. */
  readonly openingHours:
    | readonly {
        readonly weekday: number;
        readonly periods: readonly { readonly opens: string; readonly closes: string }[];
      }[]
    | null;
}

/**
 * A name or a title as it is compared and stored: Unicode's composed form,
 * trimmed, runs of spaces made one. Letters that only look alike are not
 * folded.
 */
export function normaliseName(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** The form two names are compared in: normalised, whatever the case. */
export function nameKey(text: string): string {
  return normaliseName(text).toLowerCase();
}

// Control characters, the characters that override the direction of text,
// the line and paragraph separators, the byte-order mark and half of a
// surrogate pair. The joiners (U+200C, U+200D) and
// the direction marks (U+200E, U+200F, U+061C) are not here: correct Urdu,
// Persian, Hindi, Bengali and mixed Arabic and Latin text need them.
const REFUSED = /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069\u2028\u2029\uFEFF]/u;
// A name or a title has something to read in it.
const READABLE = /[\p{L}\p{N}]/u;

const length = (text: string): number => [...text].length;

/**
 * The currencies a profile may be in, each with how many of an amount's
 * digits are after the point. A fixed list, not the runtime's: the
 * runtime's figures are for display, differ from the standard's for
 * several currencies (it gives the Pakistani rupee none), and can change
 * with an upgrade, which would move every stored price by a factor of a
 * hundred. The figures are ISO 4217's minor units as payment providers'
 * published tables give them (read 2026-11-23; the standard itself was not
 * read). A currency is added here, with its figure checked, when a
 * business needs it.
 */
export const CURRENCIES: Readonly<Record<string, number>> = {
  AED: 2,
  BDT: 2,
  BHD: 3,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  IDR: 2,
  INR: 2,
  IQD: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  LBP: 2,
  LKR: 2,
  LYD: 3,
  MAD: 2,
  MYR: 2,
  OMR: 3,
  PKR: 2,
  QAR: 2,
  SAR: 2,
  TND: 3,
  TRY: 2,
  USD: 2,
};

/** How many decimals a currency's amounts have, or undefined for a code that is not in the list. */
export function currencyDecimals(code: string): number | undefined {
  return Object.hasOwn(CURRENCIES, code) ? CURRENCIES[code] : undefined;
}

/** A price written out, such as `150.00 SAR`, from its smallest unit. Digits are exact: no floating point. */
export function priceText(
  priceMinor: number,
  currency: { code: string; decimals: number },
): string {
  const digits = String(priceMinor).padStart(currency.decimals + 1, "0");
  const whole = digits.slice(0, digits.length - currency.decimals);
  const part = currency.decimals === 0 ? "" : `.${digits.slice(-currency.decimals)}`;
  return `${whole}${part} ${currency.code}`;
}

const PHONE = /^\+[0-9]{8,15}$/;
// Letters of the Latin alphabet, digits and the usual signs only: an address
// in another script is refused (design note, "As built").
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const isEmail = (text: string): boolean => EMAIL.test(text) && length(text) <= EMAIL_MAX;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function minutes(clock: unknown, closing: boolean): number | undefined {
  if (typeof clock !== "string") {
    return undefined;
  }
  if (closing && clock === "24:00") {
    return 24 * 60;
  }
  if (!CLOCK.test(clock)) {
    return undefined;
  }
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** How many keys the parsed value holds, in all its objects. */
function keysIn(value: Json): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + keysIn(item), 0);
  }
  if (isObject(value)) {
    return Object.values(value).reduce<number>((sum, item) => sum + 1 + keysIn(item), 0);
  }
  return 0;
}

/** How many keys the text writes: strings that a colon follows. */
function keysWritten(text: string): number {
  let count = 0;
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
    const after = text.slice(token.index + token[0].length).match(/^\s*(.)/u);
    if (after?.[1] === ":") {
      count += 1;
    }
  }
  return count;
}

export type ProfileRead =
  | { readonly ok: true; readonly profile: ProfileFile; readonly size: number }
  /** Each problem names its place in the file and never repeats what was typed. */
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Reads a profile file. Every rule of the design note's sections 1, 3 and 5
 * (L5 to L7) is checked here, before any database is reached.
 */
export function readProfileFile(bytes: Uint8Array): ProfileRead {
  if (bytes.length > PROFILE_FILE_MAX_BYTES) {
    return { ok: false, problems: [`the file is larger than ${PROFILE_FILE_MAX_BYTES} bytes`] };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, problems: ["the file is not UTF-8"] };
  }
  if (text.startsWith("\uFEFF")) {
    return { ok: false, problems: ["the file begins with a byte-order mark; save it without one"] };
  }
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    return { ok: false, problems: ["the file is not JSON"] };
  }
  const problems: string[] = [];
  try {
    if (keysWritten(text) !== keysIn(parsed)) {
      // JSON keeps the last of two and says nothing. Which key is not known:
      // only that the file writes more keys than it holds.
      problems.push("a key is given twice in one object");
    }
  } catch {
    return { ok: false, problems: ["the file is nested too deeply"] };
  }
  if (!isObject(parsed)) {
    return { ok: false, problems: ["the file is not a JSON object"] };
  }

  const only = (value: { [key: string]: Json }, where: string, allowed: readonly string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
      problems.push(`${where}: an unknown key; the keys are ${allowed.join(", ")}`);
    }
  };
  const line = (value: Json | undefined, where: string, max: number): string => {
    if (typeof value !== "string") {
      problems.push(`${where}: is not text`);
      return "";
    }
    // Before the spaces are made one: a tab, a line break or a separator in
    // a name is refused, not quietly made a space.
    if (REFUSED.test(value)) {
      problems.push(
        `${where}: has a control character, a line break or a character that overrides the direction of text`,
      );
      return "";
    }
    const text = normaliseName(value);
    if (length(text) < 1 || length(text) > max) {
      problems.push(`${where}: is 1 to ${max} characters`);
    } else if (!READABLE.test(text)) {
      problems.push(`${where}: has no letter and no digit`);
    }
    return text;
  };
  const lines = (value: Json | undefined, where: string, min: number, max: number): string => {
    if (typeof value !== "string") {
      problems.push(`${where}: is not text`);
      return "";
    }
    const text = value.normalize("NFC").replace(/\r\n/gu, "\n").trim();
    // A line break is the one control character a long text may hold.
    if (REFUSED.test(text.replaceAll("\n", ""))) {
      problems.push(
        `${where}: has a control character or a character that overrides the direction of text`,
      );
    } else if (length(text) < min || length(text) > max) {
      problems.push(`${where}: is ${min} to ${max} characters`);
    }
    return text;
  };
  const hours = (value: Json | undefined, where: string): HoursPeriod[] => {
    if (!Array.isArray(value)) {
      problems.push(`${where}: is not a list of periods`);
      return [];
    }
    const periods: (HoursPeriod & { from: number; to: number })[] = [];
    value.forEach((item, index) => {
      const at = `${where}[${index}]`;
      if (!isObject(item)) {
        problems.push(`${at}: is not an object`);
        return;
      }
      only(item, at, ["weekday", "opens", "closes"]);
      const weekday = item["weekday"];
      const opens = item["opens"];
      const closes = item["closes"];
      if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        problems.push(`${at}.weekday: is a whole number from 1, Monday, to 7`);
        return;
      }
      const from = typeof opens === "string" ? minutes(opens, false) : undefined;
      const to = typeof closes === "string" ? minutes(closes, true) : undefined;
      if (from === undefined || to === undefined) {
        problems.push(`${at}: opens and closes are times such as 09:00; 24:00 only as a close`);
        return;
      }
      if (to <= from) {
        problems.push(`${at}: closes is later than opens; write a period past midnight as two`);
        return;
      }
      periods.push({ weekday, opens: opens as string, closes: closes as string, from, to });
    });
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const day = periods
        .filter((period) => period.weekday === weekday)
        .sort((a, b) => a.from - b.from);
      if (day.length > PERIODS_PER_WEEKDAY_MAX) {
        problems.push(
          `${where}: weekday ${weekday} has more than ${PERIODS_PER_WEEKDAY_MAX} periods`,
        );
      }
      if (day.some((period, index) => index > 0 && period.from < (day[index - 1]?.to ?? 0))) {
        problems.push(`${where}: two periods of weekday ${weekday} overlap`);
      }
    }
    return periods
      .sort((a, b) => a.weekday - b.weekday || a.from - b.from)
      .map(({ weekday, opens, closes }) => ({ weekday, opens, closes }));
  };

  only(parsed, "the file", ["settings", "services", "policies"]);

  const given = parsed["settings"];
  let settings: ProfileSettings = {
    currency: "",
    supportContact: "",
    notificationEmail: "",
    businessHours: [],
    openingHours: null,
  };
  if (!isObject(given)) {
    problems.push("settings: is not an object");
  } else {
    only(given, "settings", [
      "currency",
      "support_contact",
      "notification_email",
      "business_hours",
      "opening_hours",
    ]);
    // A load never leaves a tenant with less than it needs to answer.
    for (const key of ["currency", "support_contact", "notification_email", "business_hours"]) {
      if (!(key in given)) {
        problems.push(`settings.${key}: is required`);
      }
    }
    const currency = given["currency"];
    if (
      "currency" in given &&
      (typeof currency !== "string" || currencyDecimals(currency) === undefined)
    ) {
      problems.push(`settings.currency: is not one of ${Object.keys(CURRENCIES).join(", ")}`);
    }
    const contact = given["support_contact"];
    if (
      "support_contact" in given &&
      (typeof contact !== "string" || !(PHONE.test(contact) || isEmail(contact)))
    ) {
      problems.push(
        "settings.support_contact: is a phone number in international form, a plus and 8 to 15 digits, or an email address",
      );
    }
    const email = given["notification_email"];
    if ("notification_email" in given && (typeof email !== "string" || !isEmail(email))) {
      problems.push("settings.notification_email: is not an email address");
    }
    settings = {
      currency: typeof currency === "string" ? currency : "",
      supportContact: typeof contact === "string" ? contact : "",
      notificationEmail: typeof email === "string" ? email : "",
      businessHours:
        "business_hours" in given ? hours(given["business_hours"], "settings.business_hours") : [],
      openingHours:
        "opening_hours" in given ? hours(given["opening_hours"], "settings.opening_hours") : null,
    };
  }

  const services: ServiceEntry[] = [];
  // A list is written even when it is empty: a file cut short does not
  // delete a business's services by leaving them out.
  const serviceList = parsed["services"];
  if (!Array.isArray(serviceList)) {
    problems.push("services: is required, and is a list; write [] for none");
  } else {
    if (serviceList.length > PROFILE_MAX_SERVICES) {
      problems.push(`services: more than ${PROFILE_MAX_SERVICES}`);
    }
    serviceList.forEach((item, index) => {
      const at = `services[${index}]`;
      if (!isObject(item)) {
        problems.push(`${at}: is not an object`);
        return;
      }
      only(item, at, ["name", "description", "price_minor", "active"]);
      const price = item["price_minor"];
      if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) {
        problems.push(
          `${at}.price_minor: is a whole number of the currency's smallest unit, 0 or more`,
        );
      }
      const active = "active" in item ? item["active"] : true;
      if (typeof active !== "boolean") {
        problems.push(`${at}.active: is true or false`);
      }
      services.push({
        name: line(item["name"], `${at}.name`, NAME_MAX),
        description: lines(
          "description" in item ? item["description"] : "",
          `${at}.description`,
          0,
          DESCRIPTION_MAX,
        ),
        priceMinor: typeof price === "number" ? price : 0,
        active: active === true,
      });
    });
  }

  const policies: PolicyEntry[] = [];
  const policyList = parsed["policies"];
  if (!Array.isArray(policyList)) {
    problems.push("policies: is required, and is a list; write [] for none");
  } else {
    if (policyList.length > PROFILE_MAX_POLICIES) {
      problems.push(`policies: more than ${PROFILE_MAX_POLICIES}`);
    }
    policyList.forEach((item, index) => {
      const at = `policies[${index}]`;
      if (!isObject(item)) {
        problems.push(`${at}: is not an object`);
        return;
      }
      only(item, at, ["title", "body"]);
      policies.push({
        title: line(item["title"], `${at}.title`, NAME_MAX),
        body: lines(item["body"], `${at}.body`, 1, BODY_MAX),
      });
    });
  }

  const twice = (keys: readonly string[], what: string) => {
    const seen = new Map<string, number>();
    keys.forEach((key, index) => {
      const first = seen.get(key);
      if (key !== "" && first !== undefined) {
        problems.push(
          `${what}[${index}]: has the same name as ${what}[${first}], but for case or spaces`,
        );
      } else {
        seen.set(key, index);
      }
    });
  };
  twice(
    services.map((service) => nameKey(service.name)),
    "services",
  );
  twice(
    policies.map((policy) => nameKey(policy.title)),
    "policies",
  );

  const profile: ProfileFile = { settings, services, policies };
  const size = profileSize({
    services: services.filter((service) => service.active),
    policies,
  });
  if (size > PROFILE_BUDGET) {
    problems.push(`the profile's text is ${size} characters; the budget is ${PROFILE_BUDGET}`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, profile, size };
}

/**
 * A profile's size: the code points of its texts and nothing else (design
 * note, section 3). Not a count of tokens.
 */
export function profileSize(profile: {
  readonly services: readonly { readonly name: string; readonly description: string }[];
  readonly policies: readonly { readonly title: string; readonly body: string }[];
}): number {
  return (
    profile.services.reduce(
      (sum, service) => sum + length(service.name) + length(service.description),
      0,
    ) +
    profile.policies.reduce((sum, policy) => sum + length(policy.title) + length(policy.body), 0)
  );
}

// An address with a scheme, an email address, or a name with a dot and a
// known-looking ending, with or without a path. Digits are any script's.
const LINK =
  /[a-z][a-z0-9+.-]*:\/\/[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/giu;
const TRAILING = /[.,;:!?)\]}\u060C\u061B\u061F\u06D4\u0964]+$/u;
const NUMBER = /\+?\p{Nd}[\p{Nd} ().-]{5,}\p{Nd}/gu;
const NOT_DIGIT = /\P{Nd}/gu;

/**
 * Every link, email address and run of seven or more digits in a profile's
 * texts: what the assistant will be allowed to send, since it is the
 * business's own (design note, M10). For an operator to read, not a check:
 * it finds the usual forms, in any script's digits, and can miss others.
 */
export function contactLike(profile: {
  readonly services: readonly { readonly name: string; readonly description: string }[];
  readonly policies: readonly { readonly title: string; readonly body: string }[];
}): string[] {
  const texts = [
    ...profile.services.flatMap((service) => [service.name, service.description]),
    ...profile.policies.flatMap((policy) => [policy.title, policy.body]),
  ];
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(LINK)) {
      found.add(match[0].replace(TRAILING, ""));
    }
    for (const match of text.matchAll(NUMBER)) {
      if (match[0].replace(NOT_DIGIT, "").length >= 7) {
        found.add(match[0]);
      }
    }
  }
  return [...found];
}

export const REQUIRED_SETTINGS = [
  "currency",
  "support_contact",
  "notification_email",
  "business_hours",
] as const;
export type RequiredSetting = (typeof REQUIRED_SETTINGS)[number];

/**
 * What a tenant still lacks to answer (design note, section 4). Two things,
 * because the order of checks reads them apart.
 */
export interface Answering {
  /** The required settings that are not set. Set is not the same as open: hours with no period count. */
  readonly settingsMissing: readonly RequiredSetting[];
  /** The tenant has a channel account, of any channel. Not that its credentials were verified. */
  readonly channelConnected: boolean;
}

/** A profile as the database's one query returns it. */
export interface ProfileRow {
  readonly name: string;
  readonly time_zone: string;
  readonly currency: string | null;
  readonly support_contact: string | null;
  readonly opening_hours: readonly HoursPeriod[] | null;
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** A whole number, as text: the database's integers are wider than JSON's. */
    readonly price_minor: string;
  }[];
  readonly policies: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }[];
}

/** Makes the profile the model is given from the stored rows (design note, M1 to M13). */
export function assembleBusinessProfile(row: ProfileRow): BusinessProfile {
  // What is stored is checked again, and a turn fails rather than tell a
  // customer a price or an hour that was misread.
  const stored = (what: string): Error =>
    Object.assign(new Error(`assembleBusinessProfile: the stored ${what} cannot be read`), {
      code: "profile-unreadable",
    });
  const decimals = row.currency === null ? undefined : currencyDecimals(row.currency);
  if (row.currency !== null && decimals === undefined) {
    throw stored("currency");
  }
  const periods: unknown = row.opening_hours;
  if (periods !== null) {
    const fine =
      Array.isArray(periods) &&
      periods.every(
        (period: unknown) =>
          typeof period === "object" &&
          period !== null &&
          Number.isInteger((period as HoursPeriod).weekday) &&
          minutes((period as HoursPeriod).opens, false) !== undefined &&
          minutes((period as HoursPeriod).closes, true) !== undefined,
      );
    if (!fine) {
      throw stored("opening hours");
    }
  }
  return {
    name: row.name,
    timeZone: row.time_zone,
    currency:
      row.currency === null || decimals === undefined ? null : { code: row.currency, decimals },
    supportContact: row.support_contact,
    services: row.services.map((service) => {
      const priceMinor = Number(service.price_minor);
      if (!Number.isSafeInteger(priceMinor) || String(priceMinor) !== service.price_minor) {
        throw stored("price");
      }
      return {
        id: service.id,
        name: service.name,
        description: service.description,
        priceMinor,
      };
    }),
    policies: row.policies.map((policy) => ({
      id: policy.id,
      title: policy.title,
      body: policy.body,
    })),
    // All seven weekdays once any is set, so that closed is told apart from unknown.
    openingHours:
      row.opening_hours === null
        ? null
        : [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            weekday,
            periods: (row.opening_hours ?? [])
              .filter((period) => period.weekday === weekday)
              .map((period) => ({ opens: period.opens, closes: period.closes })),
          })),
  };
}
