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
});
