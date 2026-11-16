import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkSharedNames } from "./names-check.ts";

// The four documents the check reads, copied from the repository so that each
// test can change one name in one place.
const FILES = [
  "docs/requirements/glossary.md",
  "docs/design/data-model.md",
  "docs/design/state-machines.md",
  "docs/design/openapi.yaml",
  "docs/design/tools/gen_openapi.py",
  "docs/design/models/handover_machine.py",
  "docs/ai/guardrail-policy.md",
];
const repo = join(import.meta.dirname, "..");
let root: string;

function change(path: string, from: string, to: string): void {
  const text = readFileSync(join(root, path), "utf8");
  expect(text, `${path} should contain ${from}`).toContain(from);
  writeFileSync(join(root, path), text.replace(from, to));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "names-check-"));
  for (const file of FILES) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(repo, file), join(root, file));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkSharedNames", () => {
  test("the repository's documents agree with the names in code", () => {
    expect(checkSharedNames(root)).toEqual([]);
  });

  test("a reason renamed in the glossary only", () => {
    change(
      "docs/requirements/glossary.md",
      "`data-request`, `emergency`",
      "`data-request`, `urgent`",
    );
    expect(checkSharedNames(root)).toEqual([
      'glossary, Handover reason: "emergency" is missing',
      'glossary, Handover reason: "urgent" is not in packages/core/src/names.ts',
    ]);
  });

  test("a message class renamed in the glossary only", () => {
    change("docs/requirements/glossary.md", "| Service notice |", "| Service note |");
    expect(checkSharedNames(root)).toEqual([
      'glossary, Message classes table: "Service notice" is missing',
      'glossary, Message classes table: "Service note" is not in packages/core/src/names.ts',
    ]);
  });

  test("a status dropped from the data model only", () => {
    change("docs/design/data-model.md", "`withheld`, `sending`, `sent`", "`withheld`, `sent`");
    expect(checkSharedNames(root)).toEqual(['data model, messages.status: "sending" is missing']);
  });

  test("a state renamed in the handover machine only", () => {
    change("docs/design/state-machines.md", "| `followed-up` |", "| `chased` |");
    expect(checkSharedNames(root)).toEqual([
      'state machines, section 2 states: "followed-up" is missing',
      'state machines, section 2 states: "chased" is not in packages/core/src/names.ts',
    ]);
  });

  test("a state dropped from the outbound message machine only", () => {
    change("docs/design/state-machines.md", "| `sending` |", "| sending |");
    expect(checkSharedNames(root)).toEqual([
      'state machines, section 7 states: "sending" is missing',
    ]);
  });

  test("a value renamed in the OpenAPI file only", () => {
    change("docs/design/openapi.yaml", "- closed-unanswered", "- closed");
    const problems = checkSharedNames(root);
    expect(problems).toContain('OpenAPI, Handover.state: "closed-unanswered" is missing');
    expect(problems).toContain(
      'OpenAPI, Handover.state: "closed" is not in packages/core/src/names.ts',
    );
  });

  test("a list that has moved is reported, not passed", () => {
    change("docs/requirements/glossary.md", "| Handover reason |", "| Reason for handover |");
    expect(checkSharedNames(root)).toEqual([
      "glossary, Handover reason: the list was not found where the check expects it",
    ]);
  });

  test.each([
    ["- repeated-failure", "- repeated-failures", "OpenAPI, Handover.reasons"],
    ["- discarded", "- dropped", "OpenAPI, Message.status"],
    ["- service-notice", "- notice", "OpenAPI, Message.class"],
    ["- inbound", "- incoming", "OpenAPI, Message.direction"],
  ])("a value renamed in the OpenAPI file only: %s", (from, to, where) => {
    change("docs/design/openapi.yaml", from, to);
    expect(checkSharedNames(root).filter((p) => p.startsWith(where))).toHaveLength(2);
  });

  test("a second enum branch added in the OpenAPI file", () => {
    change(
      "docs/design/openapi.yaml",
      "- business-initiated\n",
      "- business-initiated\n          - type: string\n            enum:\n            - marketing\n",
    );
    expect(checkSharedNames(root)).toContain(
      'OpenAPI, Message.class: "marketing" is not in packages/core/src/names.ts',
    );
  });

  test("a name renamed in the script that generates the OpenAPI file only", () => {
    change(
      "docs/design/tools/gen_openapi.py",
      '"followed-up", "handed-back"',
      '"chased", "handed-back"',
    );
    expect(checkSharedNames(root)).toEqual([
      'OpenAPI generator, Handover state: "followed-up" is missing',
      'OpenAPI generator, Handover state: "chased" is not in packages/core/src/names.ts',
    ]);
  });

  test("a state dropped from the executable handover model only", () => {
    change(
      "docs/design/models/handover_machine.py",
      '("handed-back", "answered", ',
      '("handed-back", ',
    );
    expect(checkSharedNames(root)).toEqual([
      'handover model, OPEN and TERMINAL: "answered" is missing',
    ]);
  });

  test("a reason renamed in the guardrail policy only", () => {
    change("docs/ai/guardrail-policy.md", "| `repeated-failure` |", "| `repeat-failure` |");
    expect(checkSharedNames(root).filter((p) => p.startsWith("guardrail policy"))).toHaveLength(2);
  });

  test("a name listed twice", () => {
    change("docs/design/data-model.md", "`pending`, `held`", "`pending`, `pending`, `held`");
    expect(checkSharedNames(root)).toEqual(["data model, messages.status: a name appears twice"]);
  });

  test("a reason added in a later sentence of the glossary row", () => {
    change(
      "docs/requirements/glossary.md",
      "A handover with the emergency reason is marked urgent.",
      "Staff may also use `other`.",
    );
    expect(checkSharedNames(root)).toEqual([
      'glossary, Handover reason: "other" is not in packages/core/src/names.ts',
    ]);
  });

  test("two tables with the same header make the list unreadable, not passed", () => {
    change(
      "docs/design/state-machines.md",
      "## 7. Outbound message\n",
      "## 7. Outbound message\n\n| State | Meaning |\n| --- | --- |\n| `pending` | x |\n",
    );
    expect(checkSharedNames(root)).toEqual([
      "state machines, section 7 states: the list was not found where the check expects it",
    ]);
  });
});
