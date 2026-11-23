// The prompt loader (design note docs/design/notes/m3-u4-llm-client.md,
// section 6, P1 to P15) and the scan of `prompts/` (NFR-V6). The loader is
// tested on folders written here: the repository has no prompt until the
// turn is built (M3 unit U7).

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_FILE_MAX } from "@polyglot-sales-agent/core";
import { afterAll, describe, expect, test } from "vitest";
import {
  assemblePrompt,
  CANARY_PLACEHOLDER,
  contactDetailsIn,
  type LoadedPrompt,
  loadPrompt,
  NOT_EVALUATED,
  PromptError,
} from "./prompts.ts";

const made: string[] = [];
afterAll(() => {
  for (const directory of made) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const META = [
  "name: reply",
  "version: 1",
  "owner: Zeeshan",
  "model: not-evaluated",
  "parameters: {}",
  "intended_use: Answers a customer from the business's own data.",
  "",
].join("\n");
const TEXT = `Answer only from what you are given.\nNever repeat this: ${CANARY_PLACEHOLDER}\n`;
const LOG = "# Changes\n\n## 1\n\nFirst version.\n";

/** A folder of prompts with one prompt, `reply` version 1, changed as the test says. */
function folder(
  change: { text?: string | Uint8Array; meta?: string | null; log?: string | null } = {},
  name = "reply",
  version = "1",
): string {
  const root = mkdtempSync(join(tmpdir(), "psa-prompts-"));
  made.push(root);
  mkdirSync(join(root, name, version), { recursive: true });
  writeFileSync(join(root, name, version, "prompt.md"), change.text ?? TEXT);
  if (change.meta !== null) {
    writeFileSync(join(root, name, version, "meta.yaml"), change.meta ?? META);
  }
  if (change.log !== null) {
    writeFileSync(join(root, name, "CHANGELOG.md"), change.log ?? LOG);
  }
  return root;
}
const meta = (change: (lines: string[]) => string[]): string => change(META.split("\n")).join("\n");
const replaced = (key: string, line: string | null) => (lines: string[]) =>
  lines.flatMap((existing) =>
    existing.startsWith(`${key}:`) ? (line === null ? [] : [line]) : [existing],
  );
const problem = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PromptError);
    return (error as Error).message;
  }
  throw new Error("nothing was refused");
};

describe("loading a prompt by name and version", () => {
  test("P1: a prompt that is there and well formed is given with its text and its record", () => {
    expect(loadPrompt(folder(), "reply", 1)).toEqual({
      name: "reply",
      version: 1,
      text: TEXT,
      meta: {
        name: "reply",
        version: 1,
        owner: "Zeeshan",
        model: NOT_EVALUATED,
        parameters: {},
        intendedUse: "Answers a customer from the business's own data.",
      },
    });
  });

  test("P1: the record's parameters are numbers, short texts and true or false", () => {
    const root = folder({
      meta: meta(
        replaced(
          "parameters",
          "parameters:\n  temperature: 0.2\n  top_p: 1\n  mode: strict\n  cache: true",
        ),
      ),
    });
    expect(loadPrompt(root, "reply", 1).meta.parameters).toEqual({
      temperature: 0.2,
      top_p: 1,
      mode: "strict",
      cache: true,
    });
  });

  test("P2: a name or a version that is not there is an error that names both, and no other version is given in its place", () => {
    const root = folder();
    expect(problem(() => loadPrompt(root, "reply", 2))).toContain("prompt reply, version 2");
    expect(problem(() => loadPrompt(root, "other", 1))).toContain("prompt other, version 1");
    expect(problem(() => loadPrompt(join(root, "nowhere"), "reply", 1))).toBe(
      "the folder of prompts is not there",
    );
  });

  test("P3: a name that could be a path, or a version that is not a whole number from 1 to 9,999, is refused before the disk is touched", () => {
    // The root does not exist: were the disk read, the error would be another.
    const nowhere = join(tmpdir(), "psa-no-such-folder");
    for (const name of [
      "",
      "..",
      "../reply",
      "reply/1",
      "reply/../reply",
      "Reply",
      "1reply",
      "-reply",
      "re ply",
      "reply\u0000",
      "réply",
      `a${"b".repeat(40)}`,
      undefined,
      1,
    ]) {
      expect(
        problem(() => loadPrompt(nowhere, name as string, 1)),
        String(name),
      ).toMatch(/^a prompt's name is/);
    }
    for (const version of [
      0,
      -1,
      1.5,
      10_000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      undefined,
    ]) {
      expect(
        problem(() => loadPrompt(nowhere, "reply", version as number)),
        String(version),
      ).toMatch(/^a prompt's version is/);
    }
  });

  test("P4: a link is refused, whether it leads out of the folder of prompts or stays inside it", () => {
    const refusal = "is a link, or is reached through one";
    const outside = folder();
    // The whole prompt is a link to a folder elsewhere.
    const root = mkdtempSync(join(tmpdir(), "psa-prompts-"));
    made.push(root);
    symlinkSync(join(outside, "reply"), join(root, "reply"), "dir");
    expect(problem(() => loadPrompt(root, "reply", 1))).toContain(refusal);
    // Only the text is a link.
    const other = folder();
    rmSync(join(other, "reply", "1", "prompt.md"));
    symlinkSync(join(outside, "reply", "1", "prompt.md"), join(other, "reply", "1", "prompt.md"));
    expect(problem(() => loadPrompt(other, "reply", 1))).toContain(refusal);
    // Only the record, or only the changelog.
    for (const file of [
      ["reply", "1", "meta.yaml"],
      ["reply", "CHANGELOG.md"],
    ]) {
      const linked = folder();
      rmSync(join(linked, ...file));
      symlinkSync(join(outside, ...file), join(linked, ...file));
      expect(
        problem(() => loadPrompt(linked, "reply", 1)),
        file.join("/"),
      ).toContain(refusal);
    }
    // A link that stays inside would give one version's text under another's name.
    const inside = folder();
    mkdirSync(join(inside, "reply", "2"));
    symlinkSync(join(inside, "reply", "1", "prompt.md"), join(inside, "reply", "2", "prompt.md"));
    writeFileSync(
      join(inside, "reply", "2", "meta.yaml"),
      META.replace("version: 1", "version: 2"),
    );
    writeFileSync(join(inside, "reply", "CHANGELOG.md"), `${LOG}\n## 2\n\nSecond.\n`);
    expect(problem(() => loadPrompt(inside, "reply", 2))).toContain(refusal);
    // A whole version that is a link to another version.
    const version = folder();
    symlinkSync(join(version, "reply", "1"), join(version, "reply", "7"), "dir");
    expect(problem(() => loadPrompt(version, "reply", 7))).toContain(refusal);
    // A folder beside the root whose name begins like the root's is not inside it.
    const sibling = `${inside}-other`;
    mkdirSync(join(sibling, "reply", "1"), { recursive: true });
    made.push(sibling);
    writeFileSync(join(sibling, "reply", "1", "prompt.md"), TEXT);
    const prefix = folder();
    rmSync(join(prefix, "reply", "1", "prompt.md"));
    symlinkSync(join(sibling, "reply", "1", "prompt.md"), join(prefix, "reply", "1", "prompt.md"));
    expect(problem(() => loadPrompt(prefix, "reply", 1))).toContain(refusal);
    // The folder of prompts itself may be reached through a link: it is where the files are.
    const real = folder();
    const viaLink = `${real}-link`;
    symlinkSync(real, viaLink, "dir");
    made.push(viaLink);
    expect(loadPrompt(viaLink, "reply", 1).text).toBe(TEXT);
  });

  test("P5: a record that is missing, not YAML, or not one plain map is refused, and the error names the file", () => {
    for (const [what, source] of [
      ["missing", null],
      ["not YAML", "name: [reply\n"],
      ["a key twice", `${META}owner: Another\n`],
      ["a second document", `${META}---\nname: reply\n`],
      ["an anchor", META.replace("owner: Zeeshan", "owner: &o Zeeshan")],
      [
        "an alias",
        META.replace("owner: Zeeshan", "owner: &o Zeeshan").replace(
          "model: not-evaluated",
          "model: *o",
        ),
      ],
      ["a tag on the version", META.replace("version: 1", "version: !!str 1")],
      ["a tag that makes a number of it", META.replace("version: 1", "version: !!float 1")],
      ["a tag nothing knows", META.replace("owner: Zeeshan", "owner: !custom Zeeshan")],
      ["a tag on a text", META.replace("owner: Zeeshan", "owner: !!js/function 'function(){}'")],
      [
        "a key twice inside the parameters",
        META.replace("parameters: {}", "parameters:\n  a: 1\n  a: 2"),
      ],
      ["a list", "- name: reply\n"],
      ["a text", "reply\n"],
      ["empty", ""],
    ] as const) {
      const message = problem(() => loadPrompt(folder({ meta: source }), "reply", 1));
      expect(message, what).toContain("prompts/reply/1/meta.yaml");
    }
  });

  test("P5: each key is required, and no other is allowed", () => {
    for (const key of ["name", "version", "owner", "model", "parameters", "intended_use"]) {
      expect(
        problem(() => loadPrompt(folder({ meta: meta(replaced(key, null)) }), "reply", 1)),
      ).toBe(`prompts/reply/1/meta.yaml: ${key} is missing`);
    }
    for (const extra of ["temperature: 0.2", "__proto__: {}", "constructor: x", "Name: reply"]) {
      expect(
        problem(() => loadPrompt(folder({ meta: `${META}${extra}\n` }), "reply", 1)),
        extra,
      ).toContain("has a key that is not one of");
    }
  });

  test("P5: the version is the folder's, written as plain digits and in no other way", () => {
    for (const written of [
      '"1"',
      "'1'",
      "01",
      "1.0",
      "1e0",
      "0x1",
      "+1",
      "2",
      "one",
      "",
      "~",
      "[1]",
      "1 # one",
    ]) {
      const root = folder({ meta: meta(replaced("version", `version: ${written}`)) });
      if (written === "1 # one") {
        // A comment after it is not part of the value.
        expect(loadPrompt(root, "reply", 1).version).toBe(1);
      } else {
        expect(
          problem(() => loadPrompt(root, "reply", 1)),
          written,
        ).toBe("prompts/reply/1/meta.yaml: version is not 1, written as plain digits");
      }
    }
    // A folder named 01 is not version 1's: there is no version 1 there.
    expect(problem(() => loadPrompt(folder({}, "reply", "01"), "reply", 1))).toContain(
      "is not there",
    );
  });

  test("P5: the name is the folder's, and each text is of its kind and length", () => {
    const refusedWith = (key: string, line: string) =>
      problem(() => loadPrompt(folder({ meta: meta(replaced(key, line)) }), "reply", 1));
    expect(refusedWith("name", "name: other")).toBe("prompts/reply/1/meta.yaml: name is not reply");
    expect(refusedWith("name", "name: 1")).toContain("name is not reply");
    expect(refusedWith("owner", "owner: 7")).toContain("owner is text of 1 to 100");
    expect(refusedWith("owner", 'owner: ""')).toContain("owner is text of 1 to 100");
    expect(refusedWith("owner", 'owner: "  "')).toContain("owner is text of 1 to 100");
    expect(refusedWith("owner", `owner: ${"x".repeat(101)}`)).toContain(
      "owner is text of 1 to 100",
    );
    expect(refusedWith("owner", "owner: [a, b]")).toContain("owner is text of 1 to 100");
    expect(refusedWith("owner", "owner: owner@example.com")).toContain("not an address");
    expect(refusedWith("owner", 'owner: "a\\tb"')).toContain("owner is one line of text");
    // A text folded over lines keeps a line break at its end; one line is one line.
    expect(
      refusedWith("intended_use", "intended_use: >\n  Answers a customer\n  from the data."),
    ).toContain("intended_use is one line of text");
    expect(
      loadPrompt(
        folder({
          meta: meta(
            replaced("intended_use", "intended_use: >-\n  Answers a customer\n  from the data."),
          ),
        }),
        "reply",
        1,
      ).meta.intendedUse,
    ).toBe("Answers a customer from the data.");
    expect(refusedWith("model", "model: null")).toContain("model is text of 1 to 100");
    expect(refusedWith("model", "model: true")).toContain("model is text of 1 to 100");
    expect(refusedWith("intended_use", `intended_use: ${"x".repeat(501)}`)).toContain(
      "intended_use is text of 1 to 500",
    );
    for (const parameters of [
      "parameters: none",
      "parameters: [1]",
      "parameters:\n  temperature: [0.2]",
      "parameters:\n  temperature: {a: 1}",
      "parameters:\n  temperature: null",
      "parameters:\n  temperature: .nan",
      "parameters:\n  Temperature: 0.2",
      "parameters:\n  __proto__: 1",
      `parameters:\n  note: ${"x".repeat(101)}`,
    ]) {
      expect(refusedWith("parameters", parameters), parameters).toContain("parameters");
    }
    // A handle is an owner; so is a name in another script.
    expect(
      loadPrompt(folder({ meta: meta(replaced("owner", 'owner: "@zishon89us"')) }), "reply", 1).meta
        .owner,
    ).toBe("@zishon89us");
  });

  test("P6: the prompt's changelog is there and has a heading for this version", () => {
    expect(problem(() => loadPrompt(folder({ log: null }), "reply", 1))).toContain(
      "prompts/reply/CHANGELOG.md: is not there",
    );
    for (const log of [
      "# Changes\n",
      "## 10\n",
      "## 2\n",
      "# 1\n",
      "### 1\n",
      " ## 1\n",
      "##1\n",
      "## 1.5\n",
      "## 1abc\n",
      "## 1-rc\n",
    ]) {
      expect(
        problem(() => loadPrompt(folder({ log }), "reply", 1)),
        log,
      ).toBe('prompts/reply/CHANGELOG.md: has no heading "## 1"');
    }
    expect(loadPrompt(folder({ log: "## 1 (2026-11-23)\n" }), "reply", 1).version).toBe(1);
    expect(loadPrompt(folder({ log: "# Log\r\n\r\n## 1\r\n" }), "reply", 1).version).toBe(1);
  });

  test("P7: a prompt file that is empty, not UTF-8, too long or with a control character is refused", () => {
    const refused = (text: string | Uint8Array) =>
      problem(() => loadPrompt(folder({ text }), "reply", 1));
    expect(refused("")).toBe("prompts/reply/1/prompt.md: is empty");
    expect(refused(" \n\n ")).toBe("prompts/reply/1/prompt.md: is empty");
    expect(refused(new Uint8Array([0x41, 0xff, 0x42]))).toBe(
      "prompts/reply/1/prompt.md: is not UTF-8",
    );
    expect(refused(`﻿${TEXT}`)).toContain("byte-order mark");
    expect(refused("x".repeat(PROMPT_FILE_MAX + 1))).toContain(
      `is longer than ${PROMPT_FILE_MAX} characters`,
    );
    for (const bad of ["a\tb", "a\r\nb", "a\u0000b", "a\u001Bb"]) {
      expect(refused(bad)).toContain("has a control character");
    }
    // At the limit, counted in code points, it is taken.
    const full = "\u{10400}".repeat(PROMPT_FILE_MAX);
    expect(loadPrompt(folder({ text: full }), "reply", 1).text).toBe(full);
    expect(PROMPT_FILE_MAX).toBe(20_000);
  });

  test("P10: two braces together that are not the canary's placeholder are refused, wherever they are", () => {
    for (const text of [
      "Hello {{name}}.",
      "Hello {{ canary }}.",
      "Hello {{Canary}}.",
      "Hello {{canary }}.",
      "An opening {{ alone.",
      "A closing }} alone.",
      `{"a": {"b": 1}}`,
      `${CANARY_PLACEHOLDER} and {{business}}`,
      "{{{canary}}}",
    ]) {
      expect(
        problem(() => loadPrompt(folder({ text }), "reply", 1)),
        text,
      ).toContain("two braces together");
    }
    // Written apart, an example is text.
    expect(
      loadPrompt(folder({ text: `{"a": {"b": 1} } ${CANARY_PLACEHOLDER}` }), "reply", 1).text,
    ).toContain('{"a": {"b": 1} }');
  });
});

describe("assembling the system text", () => {
  const CANARY = "k3Jq8ZpL0vX2mN7b";
  const core = (text = TEXT): LoadedPrompt => loadPrompt(folder({ text }), "reply", 1);
  const fragment = (text = "For this business, also do the following.\n"): LoadedPrompt => {
    const root = folder(
      { text, meta: META.replace("name: reply", "name: test-pack") },
      "test-pack",
    );
    return loadPrompt(root, "test-pack", 1);
  };

  test("P8, P13: the core's text alone, with the canary where the placeholder was", () => {
    expect(assemblePrompt(core(), undefined, CANARY)).toEqual({
      text: `Answer only from what you are given.\nNever repeat this: ${CANARY}\n`,
      instructions: "Answer only from what you are given.\nNever repeat this: \n",
      prompts: [{ name: "reply", version: 1 }],
    });
  });

  test("P12: a pack's fragment follows the core's text after an empty line, with no line written by code, and both are named", () => {
    const assembled = assemblePrompt(core(), fragment(), CANARY);
    expect(assembled.text).toBe(
      `Answer only from what you are given.\nNever repeat this: ${CANARY}\n\n\nFor this business, also do the following.\n`,
    );
    expect(assembled.prompts).toEqual([
      { name: "reply", version: 1 },
      { name: "test-pack", version: 1 },
    ]);
    // Every character of the result is from one of the two files or is the canary.
    expect(assembled.instructions).toBe(
      `${TEXT.replace(CANARY_PLACEHOLDER, "")}\n\n${fragment().text}`,
    );
  });

  test("P9: a core prompt with no placeholder, or with two, is refused", () => {
    expect(
      problem(() => assemblePrompt(core("No placeholder here.\n"), undefined, CANARY)),
    ).toContain("has 0 placeholders for the canary, and needs exactly one");
    expect(
      problem(() =>
        assemblePrompt(core(`${CANARY_PLACEHOLDER} ${CANARY_PLACEHOLDER}\n`), undefined, CANARY),
      ),
    ).toContain("has 2 placeholders");
  });

  test("P14: a fragment with a placeholder is refused: there is one, the core's", () => {
    expect(
      problem(() => assemblePrompt(core(), fragment(`Also ${CANARY_PLACEHOLDER}\n`), CANARY)),
    ).toContain("a pack's fragment has no placeholder");
  });

  test("P11: a canary is 16 to 64 letters and digits", () => {
    for (const canary of [
      "",
      "short",
      "a".repeat(15),
      "a".repeat(65),
      "has space in it 12345",
      "has-a-hyphen-in-it-123",
      "$&-is-a-pattern-12345",
      "{{canary}}{{canary}}",
      "س".repeat(20),
      undefined,
      1234567890123456,
    ]) {
      expect(
        problem(() => assemblePrompt(core(), undefined, canary as string)),
        String(canary),
      ).toBe("the canary is 16 to 64 letters and digits");
    }
    expect(assemblePrompt(core(), undefined, "a".repeat(16)).text).toContain("a".repeat(16));
    expect(assemblePrompt(core(), undefined, "Z9".repeat(32)).text).toContain("Z9".repeat(32));
  });

  test("a prompt that did not come from the loader keeps the loader's rules, or is refused", () => {
    const loaded = core();
    for (const text of [
      `{{user_name}} ${CANARY_PLACEHOLDER}`,
      `a${String.fromCharCode(9)}b ${CANARY_PLACEHOLDER}`,
      `${"x".repeat(PROMPT_FILE_MAX)} ${CANARY_PLACEHOLDER}`,
      "",
    ]) {
      expect(problem(() => assemblePrompt({ ...loaded, text }, undefined, CANARY))).toContain(
        "prompts/reply/1/prompt.md",
      );
      expect(
        problem(() => assemblePrompt(loaded, { ...fragment(), text: text || " " }, CANARY)),
      ).toContain("prompts/test-pack/1/prompt.md");
    }
  });

  test("a canary that the prompt's own text already holds is refused: a reply could repeat it without leaking anything", () => {
    expect(
      problem(() =>
        assemblePrompt(core(`Say ${CANARY} never. ${CANARY_PLACEHOLDER}\n`), undefined, CANARY),
      ),
    ).toBe("the canary is already in the prompt's own text");
    expect(problem(() => assemblePrompt(core(), fragment(`Also ${CANARY}.\n`), CANARY))).toBe(
      "the canary is already in the prompt's own text",
    );
  });

  test("P15: the same inputs give the same text, byte for byte", () => {
    const first = assemblePrompt(core(), fragment(), CANARY);
    const second = assemblePrompt(core(), fragment(), CANARY);
    expect(Buffer.from(second.text).equals(Buffer.from(first.text))).toBe(true);
    expect(second).toEqual(first);
  });
});

describe("the scan of prompts/ for a contact's details (NFR-V6)", () => {
  test("it finds an email address, and seven or more digits whatever is between them and in any script", () => {
    for (const text of [
      "write to someone@example.com today",
      "call 5550100",
      "call 555-0100",
      "call +1 (555) 010-0123",
      "call 0300 123 4567",
      "call ٠٥٥٥٠١٠٠",
      "call ۰۵۵۵ ۰۱۰۰",
      "account 12.34.56.78",
      "call 555\t0100",
      "version 1.2.3.4.5.6.7",
    ]) {
      expect(contactDetailsIn(text), text).toHaveLength(1);
    }
  });

  test("it leaves alone what a prompt and its changelog need: a date, a time, a price, a limit, a version", () => {
    for (const text of [
      "## 1 (2026-11-23)",
      "open from 09:00 to 17:30",
      "a price such as 150.00 SAR",
      "at most 20,000 characters",
      "at most 1,200 code points and 30 claims",
      "version 12 of 9,999",
      "write @zishon89us",
      "six digits: 555 010",
      "open 10:30-11:30 and 14:00-18:00",
      "open 09:00\u201317:00",
      "prices such as 150.00, 200.00 and 15.000",
      "about 1,200,000 code points",
      "open \u0660\u0669:\u0660\u0660-\u0661\u0667:\u0660\u0660",
    ]) {
      expect(contactDetailsIn(text), text).toEqual([]);
    }
    // Two dates side by side are still dates; a date glued to more digits is not one.
    expect(contactDetailsIn("from 2026-11-23 to 2026-12-01")).toEqual([]);
    expect(contactDetailsIn("2026-11-231")).toHaveLength(1);
  });

  test("no file under prompts/ holds one", () => {
    const root = fileURLToPath(new URL("../../../prompts/", import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: "utf8", withFileTypes: true })
      // A link is read too: the loader refuses one, and the scan does not look away from one.
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => join(entry.parentPath, entry.name));
    // At least the README: the scan has something to read.
    expect(files.some((file) => file.endsWith("README.md"))).toBe(true);
    for (const file of files) {
      expect(contactDetailsIn(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });
});
