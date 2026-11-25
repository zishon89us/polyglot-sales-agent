// The fixed texts, read from the files under `texts/fixed/` when the
// worker starts (M3 unit U8). A worker that cannot read them, or finds one
// that breaks a rule, does not start: no customer is sent half a text.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChannelLimits, checkButtonMessage } from "@polyglot-sales-agent/channel";
import {
  BUTTON_TITLE_MAX,
  CORE_BUTTONS,
  composeMessage,
  coreButton,
  FIXED_TEXT_NAMES,
  FIXED_TEXTS,
  type FixedTextSet,
  type FixedTexts,
  fixedTextSet,
  MESSAGE_BUTTONS_MAX,
  readFixedTexts,
  SMALLEST_BUTTON_BODY_MAX,
  SMALLEST_TEXT_MAX,
} from "@polyglot-sales-agent/core";

/** The least any channel carries (a test holds these to the channels' own limits). */
const SMALLEST: ChannelLimits = {
  textMax: SMALLEST_TEXT_MAX,
  buttons: {
    max: MESSAGE_BUTTONS_MAX,
    bodyMax: SMALLEST_BUTTON_BODY_MAX,
    titleMax: BUTTON_TITLE_MAX,
    payloadMax: 100,
  },
};

/** Throws, naming the file and the rule and nothing of the file's content. */
export function loadFixedTexts(directory: string, version: number): FixedTextSet {
  const from = join(directory, "fixed", String(version));
  const all: FixedTexts[] = [];
  for (const file of readdirSync(from).sort()) {
    const language = /^([a-z]{2})\.json$/.exec(file)?.[1];
    if (language === undefined) {
      throw new Error(`fixed texts: ${file} is not named for a language`);
    }
    const read = readFixedTexts(language, readFileSync(join(from, file), "utf8"));
    if (!read.ok) {
      throw new Error(`fixed texts: ${file} ${read.problem}`);
    }
    // What the reader passed must also be what a channel would send: each
    // text with its buttons, as the first message of a session.
    for (const name of FIXED_TEXT_NAMES) {
      const buttons = FIXED_TEXTS[name].buttons.map((button) => ({
        payload: coreButton(button),
        title: read.texts.buttons[button],
      }));
      const first = composeMessage([read.texts.texts.disclosure, read.texts.texts[name]]);
      if (buttons.length > 0 && checkButtonMessage(SMALLEST, first, buttons) !== undefined) {
        throw new Error(`fixed texts: ${file} ${name} would not be sent with its buttons`);
      }
    }
    const titles = CORE_BUTTONS.map((button) => ({
      payload: coreButton(button),
      title: read.texts.buttons[button],
    }));
    for (const pair of [titles.slice(0, 2), titles.slice(1), [titles[0], titles[2]]]) {
      if (checkButtonMessage(SMALLEST, "Text.", pair as typeof titles) !== undefined) {
        throw new Error(`fixed texts: ${file} has a title no channel would show`);
      }
    }
    all.push(read.texts);
  }
  const set = fixedTextSet(all);
  if (set === undefined) {
    throw new Error("fixed texts: the last resort's language has no file");
  }
  return set;
}
