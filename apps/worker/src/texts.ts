// The fixed texts, read from the files under `texts/fixed/` when the
// worker starts (M3 unit U8). A worker that cannot read them, or finds one
// that breaks a rule, does not start: no customer is sent half a text.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FixedTextSet,
  type FixedTexts,
  fixedTextSet,
  readFixedTexts,
} from "@polyglot-sales-agent/core";

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
    all.push(read.texts);
  }
  const set = fixedTextSet(all);
  if (set === undefined) {
    throw new Error("fixed texts: the last resort's language has no file");
  }
  return set;
}
