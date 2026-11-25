// The fixed texts as they are in the repository (M3 unit U8): every file
// loads, every text would be sent by every channel there is, and the list
// of languages that have no texts is true.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadFixedTexts } from "../apps/worker/src/texts.ts";
import { checkButtonMessage, checkText } from "../packages/channel/src/index.ts";
import { MOCK_LIMITS } from "../packages/channel-mock/src/index.ts";
import { WHATSAPP_LIMITS } from "../packages/channel-whatsapp/src/index.ts";
import {
  BUTTON_TITLE_MAX,
  CORE_BUTTONS,
  coreButton,
  FIXED_TEXT_NAMES,
  FIXED_TEXTS,
  FIXED_TEXTS_VERSION,
  MESSAGE_BUTTONS_MAX,
  PART_SEPARATOR,
  REPLY_MAX,
  SMALLEST_BUTTON_BODY_MAX,
  SMALLEST_TEXT_MAX,
  SUPPORTED_LANGUAGES,
} from "../packages/core/src/index.ts";

const TEXTS = fileURLToPath(new URL("../texts/", import.meta.url));
const CHANNELS = { mock: MOCK_LIMITS, whatsapp: WHATSAPP_LIMITS };
const set = loadFixedTexts(TEXTS, FIXED_TEXTS_VERSION);
const each = set.languages.map((language) => set.pick([language], language));

describe("the fixed texts in the repository", () => {
  test("the version the code sends loads, with English in it", () => {
    expect(set.languages).toContain("en");
    expect(readdirSync(`${TEXTS}fixed`)).toContain(String(FIXED_TEXTS_VERSION));
  });

  test("the numbers the reader bounds texts by are no more than any channel carries", () => {
    for (const limits of Object.values(CHANNELS)) {
      expect(limits.textMax).toBeGreaterThanOrEqual(SMALLEST_TEXT_MAX);
      expect(limits.buttons?.bodyMax).toBeGreaterThanOrEqual(SMALLEST_BUTTON_BODY_MAX);
      expect(limits.buttons?.titleMax).toBeGreaterThanOrEqual(BUTTON_TITLE_MAX);
      expect(limits.buttons?.max).toBeGreaterThanOrEqual(MESSAGE_BUTTONS_MAX);
    }
    // And they are the smallest channel's own: a smaller channel must change them.
    expect(Math.min(...Object.values(CHANNELS).map((limits) => limits.textMax))).toBe(
      SMALLEST_TEXT_MAX,
    );
  });

  test("every text, in every language, would be sent by every channel: alone, and as the first of a session, with its buttons", () => {
    for (const texts of each) {
      for (const name of FIXED_TEXT_NAMES) {
        // Places filled with the longest values there can be are a later unit's to check.
        const body = texts.texts[name];
        const first = `${texts.texts.disclosure}${PART_SEPARATOR}${body}`;
        const buttons = FIXED_TEXTS[name].buttons.map((button) => ({
          payload: coreButton(button),
          title: texts.buttons[button],
        }));
        for (const [channel, limits] of Object.entries(CHANNELS)) {
          const where = `${texts.language} ${name} on ${channel}`;
          expect(checkText(limits, first), where).toBeUndefined();
          if (buttons.length > 0) {
            expect(checkButtonMessage(limits, body, buttons), where).toBeUndefined();
            expect(checkButtonMessage(limits, first, buttons), where).toBeUndefined();
          }
        }
      }
    }
  });

  test("the longest first message of a session fits every channel: the disclosure, the answer to 'a person?' and the longest reply", () => {
    for (const texts of each) {
      const longest = [
        texts.texts.disclosure,
        texts.texts["automated-assistant"],
        "r".repeat(REPLY_MAX),
      ].join(PART_SEPARATOR);
      for (const limits of Object.values(CHANNELS)) {
        expect(checkText(limits, longest)).toBeUndefined();
      }
    }
  });

  test("every button's title would be shown by every channel, all three together where a channel carries three", () => {
    for (const texts of each) {
      const all = CORE_BUTTONS.map((button) => ({
        payload: coreButton(button),
        title: texts.buttons[button],
      }));
      expect(checkButtonMessage(WHATSAPP_LIMITS, "Body.", all)).toBeUndefined();
      for (const pair of [all.slice(0, 2), all.slice(1), [all[0], all[2]]]) {
        expect(checkButtonMessage(MOCK_LIMITS, "Body.", pair as typeof all)).toBeUndefined();
      }
    }
  });

  test("a text that has a button also says in words what to do", () => {
    const english = set.pick(["en"], "en").texts;
    expect(english.fallback).toMatch(/ask for a person/);
    expect(english["unsupported-type"]).toMatch(/ask for a person/);
    expect(english["opt-out-confirmation"]).toMatch(/send START/);
    expect(english["opt-in-question"]).toMatch(/send START/);
    expect(english["opt-in-confirmation"]).toMatch(/send STOP/);
  });

  test("the README's table of languages is true: a file for each it says has one, none for each it says has none", () => {
    const readme = readFileSync(`${TEXTS}README.md`, "utf8");
    const rows = [...readme.matchAll(/^\| `([a-z]{2})` [^|]*\| (yes|\*\*no\*\*) \|/gm)].map(
      (row) => [row[1], row[2] === "yes"] as const,
    );
    expect(rows.map((row) => row[0]).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    expect(
      rows
        .filter((row) => row[1])
        .map((row) => row[0])
        .sort(),
    ).toEqual([...set.languages]);
  });
});
