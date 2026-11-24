// The prompt loader (AGENTS.md, section 6; design note, section 6). A
// prompt is a file under `prompts/<name>/<version>/`, loaded by name and
// version. Nothing is filled into a prompt but the deployment's canary, so
// no customer's or owner's text can enter the instructions (T13).

import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { PROMPT_FILE_MAX, PROMPT_NAME, PROMPT_VERSION_MAX } from "@polyglot-sales-agent/core";
import { isAlias, isMap, isNode, isScalar, parseAllDocuments, Scalar, visit } from "yaml";
import type { PromptIdentity } from "./types.ts";

/** A prompt that is not there or not well formed. Its message names the file and what is wrong. */
export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptError";
  }
}

/** The record kept beside a prompt. `model` and `parameters` say what it was evaluated with; configuration decides what runs. */
export interface PromptMeta {
  readonly name: string;
  readonly version: number;
  readonly owner: string;
  readonly model: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly intendedUse: string;
}

export interface LoadedPrompt extends PromptIdentity {
  /** The file's text, with the canary's placeholder still in it. */
  readonly text: string;
  readonly meta: PromptMeta;
}

/** The value a prompt's `model` has before any model was measured with it. */
export const NOT_EVALUATED = "not-evaluated";

/** Where the canary goes, written exactly so. */
export const CANARY_PLACEHOLDER = "{{canary}}";

const NAME = PROMPT_NAME;
const VERSION_MAX = PROMPT_VERSION_MAX;
const CANARY = /^[A-Za-z0-9]{16,64}$/;
const CONTROL = /\p{Cc}/u;
const length = (text: string): number => [...text].length;

const META_KEYS = ["name", "version", "owner", "model", "parameters", "intended_use"];

function utf8(bytes: Uint8Array, file: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new PromptError(`${file}: is not UTF-8`);
  }
  if (text.startsWith("\uFEFF")) {
    throw new PromptError(`${file}: begins with a byte-order mark`);
  }
  return text;
}

function text(value: unknown, file: string, key: string, max: number): string {
  if (typeof value !== "string" || length(value.trim()) < 1 || length(value) > max) {
    throw new PromptError(`${file}: ${key} is text of 1 to ${max} characters`);
  }
  if (CONTROL.test(value)) {
    throw new PromptError(
      `${file}: ${key} is one line of text, with no line break and no other control character`,
    );
  }
  return value;
}

function readMeta(source: string, file: string, name: string, version: number): PromptMeta {
  const documents = parseAllDocuments(source, { uniqueKeys: true, merge: false });
  if (!Array.isArray(documents) || documents.length !== 1) {
    throw new PromptError(`${file}: is not one YAML document`);
  }
  const document = documents[0];
  if (document === undefined || document.errors.length > 0 || document.warnings.length > 0) {
    throw new PromptError(`${file}: is not YAML, or has a key twice or a tag it does not know`);
  }
  let shared = false;
  let tagged = false;
  visit(document, {
    Alias() {
      shared = true;
    },
    Node(_key, node) {
      if (isNode(node) && !isAlias(node)) {
        if (node.anchor !== undefined) {
          shared = true;
        }
        // A value says what it is by how it is written, never by a tag such as `!!str`.
        if (node.tag !== undefined) {
          tagged = true;
        }
      }
    },
  });
  if (shared) {
    throw new PromptError(`${file}: has an anchor or an alias`);
  }
  if (tagged) {
    throw new PromptError(`${file}: has a tag; each value is written plainly`);
  }
  const root = document.contents;
  if (!isMap(root)) {
    throw new PromptError(`${file}: is not a map of keys`);
  }
  const keys = root.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ""));
  for (const key of META_KEYS) {
    if (!keys.includes(key)) {
      throw new PromptError(`${file}: ${key} is missing`);
    }
  }
  const other = keys.find((key) => !META_KEYS.includes(key));
  if (other !== undefined || keys.length !== META_KEYS.length) {
    throw new PromptError(`${file}: has a key that is not one of ${META_KEYS.join(", ")}`);
  }

  const scalar = (key: string): unknown => {
    const node = root.get(key, true);
    return isScalar(node) ? node.value : undefined;
  };

  // Plain digits, as written: not "1", 01, 1.0, 1e0 or 0x1.
  const written = root.get("version", true);
  if (
    !isScalar(written) ||
    written.type !== Scalar.PLAIN ||
    typeof written.source !== "string" ||
    !/^[1-9][0-9]*$/.test(written.source) ||
    Number(written.source) !== version
  ) {
    throw new PromptError(`${file}: version is not ${version}, written as plain digits`);
  }
  if (scalar("name") !== name) {
    throw new PromptError(`${file}: name is not ${name}`);
  }
  const owner = text(scalar("owner"), file, "owner", 100);
  if (/\S+@\S+\.\S+/.test(owner)) {
    throw new PromptError(`${file}: owner is a name or a handle, not an address`);
  }
  const parameters = root.get("parameters", true);
  if (!isMap(parameters)) {
    throw new PromptError(`${file}: parameters is a map, which may be empty`);
  }
  const held: Record<string, string | number | boolean> = {};
  for (const pair of parameters.items) {
    const key = isScalar(pair.key) ? pair.key.value : undefined;
    const value = isScalar(pair.value) ? pair.value.value : undefined;
    if (
      typeof key !== "string" ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(key) ||
      !(
        (typeof value === "string" && length(value) <= 100 && !CONTROL.test(value)) ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
      )
    ) {
      throw new PromptError(
        `${file}: parameters holds names with numbers, short texts or true and false`,
      );
    }
    held[key] = value;
  }
  return {
    name,
    version,
    owner,
    model: text(scalar("model"), file, "model", 100),
    parameters: Object.freeze(held),
    intendedUse: text(scalar("intended_use"), file, "intended_use", 500),
  };
}

/** The rules a prompt's text keeps, wherever it came from. */
function checkText(body: string, promptFile: string): void {
  if (body.trim() === "") {
    throw new PromptError(`${promptFile}: is empty`);
  }
  if (length(body) > PROMPT_FILE_MAX) {
    throw new PromptError(`${promptFile}: is longer than ${PROMPT_FILE_MAX} characters`);
  }
  if (CONTROL.test(body.replaceAll("\n", ""))) {
    throw new PromptError(
      `${promptFile}: has a control character; a tab and a carriage return are two`,
    );
  }
  // Nothing is ever filled in but the canary.
  // Counted where they overlap too, so that a third brace beside the
  // placeholder's own is seen.
  const pairs = (two: string): number => {
    let found = 0;
    for (let at = body.indexOf(two); at >= 0; at = body.indexOf(two, at + 1)) {
      found += 1;
    }
    return found;
  };
  const holders = body.split(CANARY_PLACEHOLDER).length - 1;
  if (pairs("{{") !== holders || pairs("}}") !== holders) {
    throw new PromptError(
      `${promptFile}: has two braces together that are not the canary's placeholder`,
    );
  }
}

/**
 * Loads one version of one prompt from `root`, the folder that holds the
 * prompts. There is no fallback: a name or a version that is not there is
 * an error.
 */
export function loadPrompt(root: string, name: string, version: number): LoadedPrompt {
  // Before the disk is touched: a name is never a path.
  if (typeof name !== "string" || !NAME.test(name)) {
    throw new PromptError(
      "a prompt's name is 1 to 40 of the letters a to z, digits and hyphens, and starts with a letter",
    );
  }
  if (!Number.isInteger(version) || version < 1 || version > VERSION_MAX) {
    throw new PromptError(`a prompt's version is a whole number from 1 to ${VERSION_MAX}`);
  }
  const where = `prompts/${name}/${version}`;
  let home: string;
  try {
    home = realpathSync(root);
  } catch {
    throw new PromptError("the folder of prompts is not there");
  }
  const read = (path: string[], file: string): Uint8Array => {
    const expected = join(home, ...path);
    let real: string;
    try {
      real = realpathSync(expected);
    } catch {
      throw new PromptError(`${file}: is not there (prompt ${name}, version ${version})`);
    }
    // No link: a file is the one at its own place. A link out of the folder
    // of prompts would read anything; one inside it would give one version's
    // text under another's name.
    if (real !== expected) {
      throw new PromptError(`${file}: is a link, or is reached through one`);
    }
    try {
      return readFileSync(real);
    } catch {
      throw new PromptError(`${file}: cannot be read`);
    }
  };

  const promptFile = `${where}/prompt.md`;
  const body = utf8(read([name, String(version), "prompt.md"], promptFile), promptFile);
  checkText(body, promptFile);
  const metaFile = `${where}/meta.yaml`;
  const meta = readMeta(
    utf8(read([name, String(version), "meta.yaml"], metaFile), metaFile),
    metaFile,
    name,
    version,
  );

  const logFile = `prompts/${name}/CHANGELOG.md`;
  const log = utf8(read([name, "CHANGELOG.md"], logFile), logFile);
  if (!log.split(/\r?\n/).some((line) => new RegExp(`^## ${version}(\\s|$)`).test(line))) {
    throw new PromptError(`${logFile}: has no heading "## ${version}"`);
  }

  return { name, version, text: body, meta };
}

export interface AssembledPrompt {
  /** The system text: the core's, then the pack's fragment if it has one, with the canary in place. */
  readonly text: string;
  /** The same without the canary: what a reply is compared with for repeated instructions. */
  readonly instructions: string;
  /** What it was made of, for the trace. */
  readonly prompts: readonly PromptIdentity[];
}

function placeholders(prompt: LoadedPrompt): number {
  return prompt.text.split(CANARY_PLACEHOLDER).length - 1;
}

/**
 * Makes the system text. The core prompt has the one placeholder; a pack's
 * fragment has none. No line is written here: the result is the files'
 * text and the canary.
 */
export function assemblePrompt(
  core: LoadedPrompt,
  fragment: LoadedPrompt | undefined,
  canary: string,
): AssembledPrompt {
  if (typeof canary !== "string" || !CANARY.test(canary)) {
    throw new PromptError("the canary is 16 to 64 letters and digits");
  }
  // The same rules again: a prompt handed in may not have come from `loadPrompt`.
  checkText(core.text, `prompts/${core.name}/${core.version}/prompt.md`);
  if (fragment !== undefined) {
    checkText(fragment.text, `prompts/${fragment.name}/${fragment.version}/prompt.md`);
  }
  if (core.text.includes(canary) || fragment?.text.includes(canary) === true) {
    throw new PromptError("the canary is already in the prompt's own text");
  }
  if (placeholders(core) !== 1) {
    throw new PromptError(
      `prompts/${core.name}/${core.version}/prompt.md: has ${placeholders(core)} placeholders for the canary, and needs exactly one`,
    );
  }
  if (fragment !== undefined && placeholders(fragment) !== 0) {
    throw new PromptError(
      `prompts/${fragment.name}/${fragment.version}/prompt.md: a pack's fragment has no placeholder`,
    );
  }
  const whole = fragment === undefined ? core.text : `${core.text}\n\n${fragment.text}`;
  const identity = (prompt: LoadedPrompt): PromptIdentity => ({
    name: prompt.name,
    version: prompt.version,
  });
  return {
    text: whole.split(CANARY_PLACEHOLDER).join(canary),
    instructions: whole.split(CANARY_PLACEHOLDER).join(""),
    prompts: fragment === undefined ? [identity(core)] : [identity(core), identity(fragment)],
  };
}

const CLOCK = "\\p{Nd}{1,2}:\\p{Nd}{2}";
const AMOUNT = "\\p{Nd}{1,6}\\.\\p{Nd}{2,3}";
/**
 * A whole run of digits that is not a contact's detail: a clock time or a
 * span of two ("09:00-17:00"), an amount or a list of amounts ("150.00,
 * 200.00"), or a number with its thousands marked, of at most three
 * groups ("1,200,000").
 */
const ORDINARY = new RegExp(
  `^(?:${CLOCK}(?:[-\u2013\u2014]${CLOCK})?|${AMOUNT}(?:, ${AMOUNT})*|\\p{Nd}{1,3}(?:,\\p{Nd}{3}){1,2})$`,
  "u",
);

/**
 * What in a file under `prompts/` looks like a contact's detail: an email
 * address, or seven or more digits of any script when the spaces and
 * punctuation between them are ignored (NFR-V6). A date written as
 * 2026-11-23, a clock time, an amount such as 150.00 and a number such as
 * 20,000 are not counted. It cannot tell a conversation from an example
 * written for the prompt, and does not look for one.
 */
export function contactDetailsIn(source: string): string[] {
  const found: string[] = [];
  // A date is taken out first: it sits beside other numbers ("## 1 (2026-11-23)").
  const dated = source.replaceAll(
    /(?<![\p{Nd}-])\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}(?![\p{Nd}-])/gu,
    " ",
  );
  for (const match of dated.matchAll(/[^\s@]+@[^\s@]+\.[^\s@]+/gu)) {
    found.push(match[0]);
  }
  for (const match of dated.matchAll(/\p{Nd}(?:[\p{P}\p{Zs}\t]*\p{Nd}){6,}/gu)) {
    // A run of digits is left alone only if the whole of it is one of the
    // things a prompt's examples are made of. A part of it that looks like
    // one excuses nothing: "0300 123.45 67" is not an amount.
    if (!ORDINARY.test(match[0])) {
      found.push(match[0]);
    }
  }
  return found;
}
