// The fixed texts' reader, the language rule and the filling of places
// (M3 unit U8; design note docs/design/notes/m3-u8-fixed-texts.md,
// sections 2 and 3).

import { describe, expect, test } from "vitest";
import { CORE_BUTTONS, SUPPORTED_LANGUAGES } from "./names.ts";
import {
  BUTTON_TITLE_MAX,
  composeMessage,
  DISCLOSURE_MAX,
  FILLED_TEXT_MAX,
  FILLED_VALUE_MAX,
  FIXED_TEXT_MAX,
  FIXED_TEXT_NAMES,
  FIXED_TEXTS,
  type FixedTextName,
  fillFixedText,
  fixedTextLanguage,
  fixedTextSet,
  PART_SEPARATOR,
  readFixedTexts,
  SMALLEST_BUTTON_BODY_MAX,
  SMALLEST_TEXT_MAX,
} from "./texts.ts";

interface File {
  language: unknown;
  texts: Record<string, Record<string, unknown>>;
  buttons: Record<string, unknown>;
  [extra: string]: unknown;
}
/** A file that passes: every text short, every place and button present. */
function good(language = "en"): File {
  const texts: File["texts"] = {};
  for (const name of FIXED_TEXT_NAMES) {
    const places = FIXED_TEXTS[name].places.map((place) => `{{${place}}}`).join(" ");
    const buttons = FIXED_TEXTS[name].buttons;
    texts[name] = {
      body: `The ${name} text${places === "" ? "" : ` ${places}`}.`,
      ...(buttons.length > 0 ? { buttons: [...buttons] } : {}),
    };
  }
  return { language, texts, buttons: { stop: "Stop", start: "Start", person: "A person" } };
}
const read = (file: unknown, language = "en") =>
  readFixedTexts(language, typeof file === "string" ? file : JSON.stringify(file));
const problem = (file: unknown, language = "en"): string => {
  const result = read(file, language);
  return result.ok ? "accepted" : result.problem;
};
const change = (name: FixedTextName, body: unknown): File => {
  const file = good();
  (file.texts[name] as Record<string, unknown>)["body"] = body;
  return file;
};

describe("reading a file (rules F1 to F8)", () => {
  test("a complete file is read: every text by name, every button's title, and the language", () => {
    const result = read(good());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.texts.language).toBe("en");
      expect(Object.keys(result.texts.texts).sort()).toEqual([...FIXED_TEXT_NAMES].sort());
      expect(result.texts.texts.disclosure).toBe("The disclosure text.");
      expect(result.texts.buttons).toEqual({ stop: "Stop", start: "Start", person: "A person" });
      expect(Object.isFrozen(result.texts.texts)).toBe(true);
    }
  });

  test("there are eleven texts, and each button a text carries is one of the core's", () => {
    expect(FIXED_TEXT_NAMES).toHaveLength(11);
    for (const name of FIXED_TEXT_NAMES) {
      for (const button of FIXED_TEXTS[name].buttons) {
        expect(CORE_BUTTONS).toContain(button);
      }
    }
  });

  test("F1: not JSON, not an object, a key too many or too few", () => {
    expect(problem("{")).toBe("is not JSON");
    expect(problem([])).toMatch(/exactly a language/);
    expect(problem(null)).toMatch(/exactly a language/);
    expect(problem({ ...good(), note: "x" })).toMatch(/exactly a language/);
    const { buttons: _dropped, ...rest } = good();
    expect(problem(rest)).toMatch(/exactly a language/);
  });

  test("F2: the language is the file's own, and a code of two letters", () => {
    expect(problem(good("ar"))).toMatch(/language of its file/);
    expect(problem(good("ar"), "ar")).toBe("accepted");
    expect(problem(good("EN"), "EN")).toMatch(/language of its file/);
    expect(problem({ ...good(), language: 5 })).toMatch(/language of its file/);
  });

  test("F4: a text missing, or one the code does not know", () => {
    const missing = good();
    delete missing.texts["emergency"];
    expect(problem(missing)).toMatch(/exactly the fixed texts/);
    const extra = good();
    extra.texts["welcome"] = { body: "Hello." };
    expect(problem(extra)).toMatch(/exactly the fixed texts/);
    expect(problem({ ...good(), texts: [] })).toMatch(/exactly the fixed texts/);
  });

  test("F3: a body is 1 to 300 units, the disclosure 1 to 150, with no blank end and no control character but a line break", () => {
    expect(problem(change("fallback", "a".repeat(FIXED_TEXT_MAX)))).toBe("accepted");
    expect(problem(change("fallback", "a".repeat(FIXED_TEXT_MAX + 1)))).toMatch(/^fallback is not/);
    expect(problem(change("disclosure", "a".repeat(DISCLOSURE_MAX)))).toBe("accepted");
    expect(problem(change("disclosure", "a".repeat(DISCLOSURE_MAX + 1)))).toMatch(
      /^disclosure is not/,
    );
    expect(problem(change("fallback", ""))).toMatch(/^fallback is not/);
    expect(problem(change("fallback", 7))).toMatch(/^fallback is not/);
    expect(problem(change("fallback", " Sorry."))).toMatch(/blank end/);
    expect(problem(change("fallback", "Sorry.\n"))).toMatch(/blank end/);
    expect(problem(change("fallback", "Sorry.\u0007 Really."))).toMatch(/control character/);
    expect(problem(change("fallback", "Sorry.\tReally."))).toMatch(/control character/);
    expect(problem(change("fallback", "Sorry.\n\nReally."))).toBe("accepted");
  });

  test("a body holds nothing unseen that changes how it reads, and no half of a pair; the joiners a script needs are allowed", () => {
    for (const unseen of ["\u2028", "\u2029", "\u200b", "\u2060", "\ufeff", "\u202e", "\u2066"]) {
      expect(problem(change("fallback", `Sorry.${unseen}Really.`)), unseen).toMatch(
        /control character/,
      );
    }
    expect(problem(change("fallback", "Sorry\ud800."))).toMatch(/control character/);
    expect(problem(change("fallback", "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"))).toBe(
      "accepted",
    );
    expect(problem(change("fallback", "\u0915\u094d\u200d\u0937"))).toBe("accepted");
    expect(problem(change("fallback", "Sorry \u{1F600}."))).toBe("accepted");
  });

  test("F3: lengths are UTF-16 units, as the channels count", () => {
    // 150 emoji are 300 units.
    expect(problem(change("fallback", "\u{1F600}".repeat(150)))).toBe("accepted");
    expect(problem(change("fallback", "\u{1F600}".repeat(151)))).toMatch(/^fallback is not/);
  });

  test("F5: a text holds exactly the places it is given, each once, and nothing else in braces", () => {
    expect(problem(change("handover-out-of-hours", "Closed until {{opening}}."))).toMatch(/places/);
    expect(problem(change("handover-out-of-hours", "{{opening}} {{opening}} {{contact}}"))).toMatch(
      /places/,
    );
    expect(problem(change("handover-out-of-hours", "{{opening}} {{opening}}"))).toMatch(/places/);
    expect(problem(change("fallback", "Sorry, {{contact}}."))).toMatch(/places/);
    expect(problem(change("fallback", "Sorry, {{Contact}}."))).toMatch(/places/);
    expect(problem(change("fallback", "Sorry, {{ contact }}."))).toMatch(/places/);
    expect(problem(change("fallback", "Sorry, {{."))).toMatch(/places/);
    // A brace beside a place could make a place of whatever is filled in.
    expect(problem(change("handover-out-of-hours", "{{opening}}{x}} {{contact}}"))).toMatch(
      /places/,
    );
    expect(problem(change("handover-out-of-hours", "{{{opening}}} {{contact}}"))).toMatch(/places/);
    expect(problem(change("fallback", "Sorry {really}."))).toMatch(/places/);
    expect(problem(change("handover-out-of-hours", "{{contact}}, then {{opening}}."))).toBe(
      "accepted",
    );
  });

  test("F7: the emergency text holds no number, in any script", () => {
    expect(problem(change("emergency", "Call 911."))).toMatch(/number/);
    expect(problem(change("emergency", "Call ٩٩٩."))).toMatch(/number/);
    expect(problem(change("emergency", "Call ९९९."))).toMatch(/number/);
    expect(problem(change("emergency", "Call ①."))).toMatch(/number/);
    expect(problem(change("emergency", "Call your local emergency services."))).toBe("accepted");
    // Only that text: another may hold a number.
    expect(problem(change("fallback", "Sorry. Try again in 5 minutes."))).toBe("accepted");
  });

  test("a text carries exactly its buttons, in their order, and a text with none has no such key", () => {
    const none = good();
    delete (none.texts["fallback"] as Record<string, unknown>)["buttons"];
    expect(problem(none)).toMatch(/^fallback is not a body with exactly its buttons/);
    const other = good();
    (other.texts["fallback"] as Record<string, unknown>)["buttons"] = ["stop"];
    expect(problem(other)).toMatch(/^fallback is not a body/);
    const extra = good();
    (extra.texts["disclosure"] as Record<string, unknown>)["buttons"] = ["stop"];
    expect(problem(extra)).toMatch(/^disclosure is not a body/);
    const more = good();
    (more.texts["disclosure"] as Record<string, unknown>)["note"] = "x";
    expect(problem(more)).toMatch(/^disclosure is not a body/);
    expect(problem({ ...good(), texts: { ...good().texts, fallback: "Sorry." } })).toMatch(
      /^fallback is not a body/,
    );
  });

  test("F6: every button has a title of 1 to 16 units, no two the same to the eye", () => {
    const titled = (buttons: Record<string, unknown>): File => ({ ...good(), buttons });
    expect(problem(titled({ stop: "Stop", start: "Start" }))).toMatch(/exactly the buttons/);
    expect(problem(titled({ stop: "Stop", start: "Start", person: "P", more: "M" }))).toMatch(
      /exactly the buttons/,
    );
    expect(
      problem(titled({ stop: "Stop", start: "Start", person: "a".repeat(BUTTON_TITLE_MAX) })),
    ).toBe("accepted");
    expect(
      problem(titled({ stop: "Stop", start: "Start", person: "a".repeat(BUTTON_TITLE_MAX + 1) })),
    ).toMatch(/title of person/);
    expect(problem(titled({ stop: "", start: "Start", person: "P" }))).toMatch(/title of stop/);
    expect(problem(titled({ stop: " Stop", start: "Start", person: "P" }))).toMatch(
      /title of stop/,
    );
    expect(problem(titled({ stop: "St\nop", start: "Start", person: "P" }))).toMatch(
      /title of stop/,
    );
    expect(problem(titled({ stop: 4, start: "Start", person: "P" }))).toMatch(/title of stop/);
    expect(problem(titled({ stop: "\u200b", start: "Start", person: "P" }))).toMatch(
      /title of stop/,
    );
    expect(problem(titled({ stop: "Stop\u202e", start: "Start", person: "P" }))).toMatch(
      /title of stop/,
    );
    expect(problem(titled({ stop: "Stop\ud800", start: "Start", person: "P" }))).toMatch(
      /title of stop/,
    );
    expect(problem(titled({ stop: "Start", start: "start", person: "P" }))).toMatch(/same title/);
    // Full-width letters read the same.
    expect(problem(titled({ stop: "Ｓtop", start: "Stop", person: "P" }))).toMatch(/same title/);
  });

  test("F3a: the disclosure and a text with buttons fit the smallest channel together", () => {
    const fits = change("disclosure", "d".repeat(DISCLOSURE_MAX));
    (fits.texts["fallback"] as Record<string, unknown>)["body"] = "f".repeat(FIXED_TEXT_MAX);
    expect(problem(fits)).toBe("accepted");
    // With today's limits the rule cannot be broken by a file that passes F3:
    expect(DISCLOSURE_MAX + PART_SEPARATOR.length + FIXED_TEXT_MAX).toBeLessThanOrEqual(
      SMALLEST_BUTTON_BODY_MAX,
    );
    // and the longest first message of a session fits as a text: the
    // disclosure, the answer to "a person?", and a reply of 1,200.
    expect(
      DISCLOSURE_MAX + PART_SEPARATOR.length + FIXED_TEXT_MAX + PART_SEPARATOR.length + 1_200,
    ).toBe(1_654);
    expect(1_654).toBeLessThanOrEqual(SMALLEST_TEXT_MAX);
  });

  test("a problem names the text and the rule, and repeats nothing of the file", () => {
    const secret = "A sentence nobody should find in a log.";
    for (const file of [
      change("fallback", ` ${secret}`),
      change("emergency", `${secret} 911`),
      change("fallback", `${secret} {{contact}}`),
      { ...good(), buttons: { stop: ` ${secret}`, start: "Start", person: "P" } },
    ]) {
      const found = problem(file);
      expect(found).not.toBe("accepted");
      expect(found).not.toContain("sentence");
    }
  });
});

describe("the language a fixed text is sent in (section 3)", () => {
  const has =
    (...languages: string[]) =>
    (language: string) =>
      languages.includes(language);

  test("G1: the first preferred language that is supported and has texts", () => {
    expect(fixedTextLanguage(["ur", "ar", "hi"], "en", has("en", "ar", "ur"))).toBe("ur");
    expect(fixedTextLanguage(["ur", "ar", "hi"], "en", has("en", "ar"))).toBe("ar");
    expect(fixedTextLanguage([null, undefined, "hi"], "en", has("en", "hi"))).toBe("hi");
  });

  test("G2: a language that is not supported is passed over, even with a file", () => {
    expect(SUPPORTED_LANGUAGES).not.toContain("fr");
    expect(fixedTextLanguage(["fr", "ar"], "en", has("en", "ar", "fr"))).toBe("ar");
    expect(fixedTextLanguage(["und"], "ar", has("en", "ar"))).toBe("ar");
  });

  test("G3: none of them: the tenant's default, if it has texts", () => {
    expect(fixedTextLanguage(["ur"], "ar", has("en", "ar"))).toBe("ar");
    expect(fixedTextLanguage([], "ar", has("en", "ar"))).toBe("ar");
  });

  test("G4: nor that: English", () => {
    expect(fixedTextLanguage(["ur"], "ar", has("en"))).toBe("en");
    expect(fixedTextLanguage([null], null, has("en"))).toBe("en");
    expect(fixedTextLanguage([], undefined, has("en"))).toBe("en");
  });

  test("G5: a set of texts picks by that rule, and there is no set without English", () => {
    const one = (language: string) => {
      const result = read(good(language), language);
      if (!result.ok) {
        throw new Error(result.problem);
      }
      return result.texts;
    };
    const set = fixedTextSet([one("ar"), one("en")]);
    expect(set?.languages).toEqual(["ar", "en"]);
    expect(set?.pick(["ar"], "en").language).toBe("ar");
    expect(set?.pick(["ur", null], "ar").language).toBe("ar");
    expect(set?.pick(["ur"], "hi").language).toBe("en");
    expect(fixedTextSet([one("ar")])).toBeUndefined();
    expect(fixedTextSet([])).toBeUndefined();
    expect(fixedTextSet([one("en"), one("en")])).toBeUndefined();
  });
});

describe("filling a text's places", () => {
  const BODY = "Closed. We open {{opening}}. Reach us at {{contact}}.";

  test("every place given: the text with the values", () => {
    expect(fillFixedText(BODY, { opening: "Monday 09:00", contact: "+1 555 0100" })).toBe(
      "Closed. We open Monday 09:00. Reach us at +1 555 0100.",
    );
    expect(fillFixedText("No places.", {})).toBe("No places.");
    // A value that is not asked for changes nothing.
    expect(fillFixedText("No places.", { contact: "x" })).toBe("No places.");
  });

  test("a place with no value is refused: nothing is sent with a place left open", () => {
    expect(fillFixedText(BODY, { opening: "Monday" })).toBeUndefined();
    expect(fillFixedText(BODY, {})).toBeUndefined();
    expect(fillFixedText(BODY, { opening: "Monday", contact: "" })).toBeUndefined();
    // A value the object only inherits is not a value.
    expect(fillFixedText("{{constructor}}", {})).toBeUndefined();
    // Braces that are not a place are never sent as they are.
    expect(fillFixedText("{{toString}}", {})).toBeUndefined();
    expect(fillFixedText("{{ contact }}", { contact: "x" })).toBeUndefined();
  });

  test("a value is short plain text: no line break, no control character, no place of its own, no blank end", () => {
    const fill = (contact: string) => fillFixedText(BODY, { opening: "Monday", contact });
    expect(fill("a".repeat(FILLED_VALUE_MAX))).toBeDefined();
    expect(fill("a".repeat(FILLED_VALUE_MAX + 1))).toBeUndefined();
    expect(fill("line\nbreak")).toBeUndefined();
    expect(fill("line break")).toBeUndefined();
    expect(fill("bell\u0007")).toBeUndefined();
    expect(fill("{{opening}}")).toBeUndefined();
    expect(fill(" padded")).toBeUndefined();
    expect(fill("a{b")).toBeUndefined();
    expect(fill("a}b")).toBeUndefined();
    expect(fill("a\u202eb")).toBeUndefined();
    expect(fill("a\ud800b")).toBeUndefined();
  });

  test("no value and no body can make a place that is sent open", () => {
    expect(fillFixedText("{{a}}{b}}", { a: "{" })).toBeUndefined();
    expect(fillFixedText("{{{a}}", { a: "{b}}" })).toBeUndefined();
    expect(fillFixedText("{{{a}}", { a: "b" })).toBeUndefined();
  });

  test("a value is put in as it is: what looks like a pattern of the replacement is plain text", () => {
    expect(fillFixedText("At {{contact}}.", { contact: "$& $1 $$" })).toBe("At $& $1 $$.");
  });

  test("the filled text is at most 700 units", () => {
    const body = `${"a".repeat(FIXED_TEXT_MAX - 23)}{{opening}}{{contact}}`;
    const long = "b".repeat(FILLED_VALUE_MAX);
    expect(fillFixedText(body, { opening: long, contact: "c".repeat(169) })).toHaveLength(
      FILLED_TEXT_MAX,
    );
    expect(fillFixedText(body, { opening: long, contact: "c".repeat(170) })).toBeUndefined();
  });
});

describe("the parts of a message as it is sent", () => {
  test("each part that is present, a blank line between", () => {
    expect(composeMessage(["Told.", "Fixed.", "Reply."])).toBe("Told.\n\nFixed.\n\nReply.");
    expect(composeMessage([null, "Fixed.", "Reply."])).toBe("Fixed.\n\nReply.");
    expect(composeMessage(["Told.", null, "Reply."])).toBe("Told.\n\nReply.");
    expect(composeMessage([null, null, "Reply."])).toBe("Reply.");
    expect(composeMessage(["Told.", "Fixed.", null])).toBe("Told.\n\nFixed.");
    expect(composeMessage([undefined, "", null])).toBe("");
  });
});
