// The fixed texts: what code sends to a customer in the business's name,
// never written by the model (guardrail policy, section 7; M3 unit U8;
// design note docs/design/notes/m3-u8-fixed-texts.md). One file for one
// language holds every text and every button's title; this reads one and
// refuses a file that is not complete.

import { CORE_BUTTONS, type CoreButton, LANGUAGE_CODE, languageSupported } from "./names.ts";

/** Every fixed text M3 sends, with the buttons it carries and the places code fills in. */
export const FIXED_TEXTS = {
  disclosure: { buttons: [], places: [] },
  "automated-assistant": { buttons: [], places: [] },
  fallback: { buttons: ["person"], places: [] },
  "unsupported-type": { buttons: ["person"], places: [] },
  "handover-in-hours": { buttons: [], places: [] },
  "handover-out-of-hours": { buttons: [], places: ["opening", "contact"] },
  emergency: { buttons: [], places: [] },
  "opt-out-confirmation": { buttons: ["start"], places: [] },
  "opt-in-confirmation": { buttons: ["stop"], places: [] },
  "rate-notice": { buttons: [], places: [] },
  "opt-in-question": { buttons: ["start"], places: [] },
} as const satisfies Record<
  string,
  { readonly buttons: readonly CoreButton[]; readonly places: readonly string[] }
>;
export type FixedTextName = keyof typeof FIXED_TEXTS;
export const FIXED_TEXT_NAMES = Object.keys(FIXED_TEXTS) as FixedTextName[];

/** The version of the texts the code sends: the directory under `texts/fixed/`. */
export const FIXED_TEXTS_VERSION = 1;

/** The language every deployment has: the last resort of `fixedTextLanguage`. */
export const FIXED_TEXT_LAST_RESORT = "en";

/** Lengths are UTF-16 units, as the channels count them. */
export const FIXED_TEXT_MAX = 300;
export const DISCLOSURE_MAX = 150;
export const BUTTON_TITLE_MAX = 16;
/** A value code fills into a text, and the text once filled. */
export const FILLED_VALUE_MAX = 254;
export const FILLED_TEXT_MAX = 700;
/** The most buttons a message is stored with: what the smallest channel carries. */
export const MESSAGE_BUTTONS_MAX = 2;
/**
 * What the smallest channel carries: a text, and a text with buttons. The
 * texts are bounded so that a session's first message always fits. A test
 * fails if a channel's own limits are under these.
 */
export const SMALLEST_TEXT_MAX = 2_000;
export const SMALLEST_BUTTON_BODY_MAX = 500;
/** What separates the parts of a message that is sent: a blank line. */
export const PART_SEPARATOR = "\n\n";

/** One language's texts, as read. */
export interface FixedTexts {
  readonly language: string;
  readonly texts: Readonly<Record<FixedTextName, string>>;
  readonly buttons: Readonly<Record<CoreButton, string>>;
}

const exactly = (value: object, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** A control character other than a line break. */
const CONTROL = /(?!\n)\p{Cc}/u;
/** A control character or a line or paragraph separator: nothing a filled-in value may hold. */
const UNPRINTABLE = /\p{Cc}|[\u2028\u2029]/u;
const PLACE = /\{\{([a-z]+)\}\}/g;

function bodyProblem(name: FixedTextName, body: unknown): string | undefined {
  const max = name === "disclosure" ? DISCLOSURE_MAX : FIXED_TEXT_MAX;
  if (typeof body !== "string" || body.length < 1 || body.length > max) {
    return `is not a text of 1 to ${max}`;
  }
  if (body !== body.trim() || CONTROL.test(body)) {
    return "has a blank end or a control character";
  }
  const places = [...body.matchAll(PLACE)].map((found) => found[1] as string);
  const wanted: readonly string[] = FIXED_TEXTS[name].places;
  if (
    body.replace(PLACE, "").includes("{{") ||
    places.length !== wanted.length ||
    !wanted.every((place) => places.filter((found) => found === place).length === 1)
  ) {
    return "does not hold exactly the places it is given, each once";
  }
  if (name === "emergency" && /\p{N}/u.test(body)) {
    return "holds a number, and must give no phone number";
  }
  return undefined;
}

/**
 * Reads one language's file. The problem, when there is one, names the
 * text and the rule and repeats nothing of the file.
 */
export function readFixedTexts(
  language: string,
  json: string,
):
  | { readonly ok: true; readonly texts: FixedTexts }
  | { readonly ok: false; readonly problem: string } {
  const no = (problem: string) => ({ ok: false, problem }) as const;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return no("is not JSON");
  }
  if (!record(parsed) || !exactly(parsed, ["language", "texts", "buttons"])) {
    return no("is not exactly a language, texts and buttons");
  }
  if (!LANGUAGE_CODE.test(language) || parsed["language"] !== language) {
    return no("does not name the language of its file");
  }
  const { texts, buttons } = parsed;
  if (!record(texts) || !exactly(texts, FIXED_TEXT_NAMES)) {
    return no("does not hold exactly the fixed texts");
  }
  if (!record(buttons) || !exactly(buttons, CORE_BUTTONS)) {
    return no("does not hold exactly the buttons");
  }
  const bodies: Partial<Record<FixedTextName, string>> = {};
  for (const name of FIXED_TEXT_NAMES) {
    const text = texts[name];
    const wanted: readonly string[] = FIXED_TEXTS[name].buttons;
    if (
      !record(text) ||
      !exactly(text, wanted.length > 0 ? ["body", "buttons"] : ["body"]) ||
      (wanted.length > 0 && JSON.stringify(text["buttons"]) !== JSON.stringify(wanted))
    ) {
      return no(`${name} is not a body with exactly its buttons`);
    }
    const problem = bodyProblem(name, text["body"]);
    if (problem !== undefined) {
      return no(`${name} ${problem}`);
    }
    bodies[name] = text["body"] as string;
  }
  const titles: Partial<Record<CoreButton, string>> = {};
  const seen = new Set<string>();
  for (const button of CORE_BUTTONS) {
    const title = buttons[button];
    if (
      typeof title !== "string" ||
      title.length < 1 ||
      title.length > BUTTON_TITLE_MAX ||
      title !== title.trim() ||
      /\p{Cc}/u.test(title)
    ) {
      return no(`the title of ${button} is not a text of 1 to ${BUTTON_TITLE_MAX}`);
    }
    const key = title.normalize("NFKC").toLowerCase();
    if (seen.has(key)) {
      return no("two buttons have the same title");
    }
    seen.add(key);
    titles[button] = title;
  }
  const all = bodies as Record<FixedTextName, string>;
  // A session's first message always fits the smallest channel (design note, F3a).
  for (const name of FIXED_TEXT_NAMES) {
    if (
      FIXED_TEXTS[name].buttons.length > 0 &&
      all.disclosure.length + PART_SEPARATOR.length + all[name].length > SMALLEST_BUTTON_BODY_MAX
    ) {
      return no(
        `${name} with the disclosure is over what the smallest channel carries with buttons`,
      );
    }
  }
  return {
    ok: true,
    texts: Object.freeze({
      language,
      texts: Object.freeze(all),
      buttons: Object.freeze(titles as Record<CoreButton, string>),
    }),
  };
}

/**
 * The language a fixed text is sent in: the first of the preferred ones
 * that is supported and has texts; else the tenant's default if it has
 * texts; else the last resort (US-C5, 2).
 */
export function fixedTextLanguage(
  preferred: readonly (string | null | undefined)[],
  tenantDefault: string | null | undefined,
  has: (language: string) => boolean,
): string {
  for (const language of preferred) {
    if (typeof language === "string" && languageSupported(language) && has(language)) {
      return language;
    }
  }
  return typeof tenantDefault === "string" && has(tenantDefault)
    ? tenantDefault
    : FIXED_TEXT_LAST_RESORT;
}

/**
 * A text with its places filled in, or undefined if it cannot be: a place
 * with no value, a value that is not plain short text, or a result that is
 * too long. Nothing is sent with a place left open.
 */
export function fillFixedText(
  body: string,
  values: Readonly<Record<string, string>>,
): string | undefined {
  // Braces that are no place of ours would be sent as they are.
  let open = body.replace(PLACE, "").includes("{{");
  const filled = body.replace(PLACE, (_whole, place: string): string => {
    const value = Object.hasOwn(values, place) ? values[place] : undefined;
    if (
      typeof value === "string" &&
      value.length >= 1 &&
      value.length <= FILLED_VALUE_MAX &&
      !UNPRINTABLE.test(value) &&
      !value.includes("{{") &&
      value === value.trim()
    ) {
      return value;
    }
    open = true;
    return "";
  });
  return open || filled.length > FILLED_TEXT_MAX ? undefined : filled;
}

/** The parts of a message as it is sent: each that is present, a blank line between. */
export function composeMessage(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(PART_SEPARATOR);
}

/** Every language's texts that a deployment has, and the rule that picks one. */
export interface FixedTextSet {
  readonly languages: readonly string[];
  /** The texts in the language of `fixedTextLanguage`. */
  pick(
    preferred: readonly (string | null | undefined)[],
    tenantDefault: string | null | undefined,
  ): FixedTexts;
}

/** Undefined when the last resort's language is not among them, or one is given twice. */
export function fixedTextSet(all: readonly FixedTexts[]): FixedTextSet | undefined {
  const by = new Map(all.map((texts) => [texts.language, texts]));
  const last = by.get(FIXED_TEXT_LAST_RESORT);
  if (last === undefined || by.size !== all.length) {
    return undefined;
  }
  return {
    languages: [...by.keys()].sort(),
    pick: (preferred, tenantDefault) =>
      by.get(fixedTextLanguage(preferred, tenantDefault, (language) => by.has(language))) ?? last,
  };
}
