import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkAll, checkDecisionRecords, checkLinks, checkTraceability } from "./docs-checks.ts";

let root: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const ADR =
  "# Title\n\n## Context and Problem Statement\n\n## Considered Options\n\n## Decision Outcome\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "docs-checks-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkTraceability", () => {
  test("passes when every story has a row", () => {
    write("docs/requirements/user-stories.md", "### US-C1 — One\n\n### US-B2 — Two\n");
    write("docs/requirements/traceability.md", "| US-C1 One | x |\n| US-B2 Two | x |\n");
    expect(checkTraceability(root)).toEqual([]);
  });

  test("reports a story with no row", () => {
    write("docs/requirements/user-stories.md", "### US-C1 — One\n\n### US-B2 — Two\n");
    write("docs/requirements/traceability.md", "| US-C1 One | x |\n");
    expect(checkTraceability(root)).toEqual([
      "docs/requirements/traceability.md: no row for US-B2",
    ]);
  });

  test("reports a row for a story that does not exist", () => {
    write("docs/requirements/user-stories.md", "### US-C1 — One\n");
    write("docs/requirements/traceability.md", "| US-C1 One | x |\n| US-D9 Gone | x |\n");
    expect(checkTraceability(root)).toEqual([
      "docs/requirements/traceability.md: row for US-D9, which is not a story",
    ]);
  });

  test("does not pass on a stories file with no stories", () => {
    write("docs/requirements/user-stories.md", "Nothing here.\n");
    write("docs/requirements/traceability.md", "");
    expect(checkTraceability(root)).toHaveLength(1);
  });
});

describe("checkDecisionRecords", () => {
  test("passes on a complete, indexed record", () => {
    write("docs/adr/0001-a.md", ADR);
    write("docs/adr/README.md", "| [0001](0001-a.md) | A |\n");
    expect(checkDecisionRecords(root)).toEqual([]);
  });

  test("accepts the older headings of ADR 0001", () => {
    write("docs/adr/0001-a.md", "# T\n\n## Context\n\n## Options considered\n\n## Decision\n");
    write("docs/adr/README.md", "(0001-a.md)\n");
    expect(checkDecisionRecords(root)).toEqual([]);
  });

  test("reports a missing section and a record missing from the index", () => {
    write("docs/adr/0002-b.md", "# T\n\n## Context and Problem Statement\n\n## Decision Outcome\n");
    write("docs/adr/README.md", "nothing\n");
    expect(checkDecisionRecords(root)).toEqual([
      'docs/adr/0002-b.md: no options section (expected "## Considered Options")',
      "docs/adr/README.md: 0002-b.md is not in the index",
    ]);
  });

  test("ignores the template and the index themselves", () => {
    write("docs/adr/template.md", "# empty\n");
    write("docs/adr/0001-a.md", ADR);
    write("docs/adr/README.md", "(0001-a.md)\n");
    expect(checkDecisionRecords(root)).toEqual([]);
  });
});

describe("checkLinks", () => {
  test("passes on links that resolve, web links and anchors", () => {
    write("README.md", "[a](docs/a.md) [b](https://example.com) [c](#top) [d](docs/a.md#part)\n");
    write("docs/a.md", "[up](../README.md)\n");
    expect(checkLinks(root)).toEqual([]);
  });

  test("reports a link to a file that does not exist", () => {
    write("README.md", "[a](docs/missing.md)\n");
    expect(checkLinks(root)).toEqual(['README.md: link to "docs/missing.md" does not resolve']);
  });

  test("reports a link that leaves the repository, even to a file that exists", () => {
    const outside = `${root}-outside.md`;
    writeFileSync(outside, "x\n");
    try {
      write("docs/a.md", `[out](../../${outside.split("/").pop()})\n`);
      expect(checkLinks(root)).toHaveLength(1);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test("reports broken links written with a title, in angle brackets, or as a reference", () => {
    write(
      "README.md",
      '[a](missing.md "title") [b](<missing file.md>)\n\n[ref]: also-missing.md\n[c](missing.md:5)\n',
    );
    expect(checkLinks(root)).toEqual([
      'README.md: link to "missing.md" does not resolve',
      'README.md: link to "missing file.md" does not resolve',
      'README.md: link to "missing.md:5" does not resolve',
      'README.md: link to "also-missing.md" does not resolve',
    ]);
  });

  test("accepts a query string and checks files under .github", () => {
    write("README.md", "[a](docs/a.md?plain=1)\n");
    write("docs/a.md", "x\n");
    write(".github/pull_request_template.md", "[gone](../docs/gone.md)\n");
    expect(checkLinks(root)).toEqual([
      '.github/pull_request_template.md: link to "../docs/gone.md" does not resolve',
    ]);
  });

  test("skips node_modules", () => {
    write("node_modules/pkg/README.md", "[a](missing.md)\n");
    expect(checkLinks(root)).toEqual([]);
  });

  test("ignores links inside code blocks and in review reports", () => {
    write("README.md", "```\n[a](nowhere.md)\n```\n");
    write("docs/reviews/r.md", "[a](nowhere.md)\n");
    expect(checkLinks(root)).toEqual([]);
  });
});

describe("checkAll", () => {
  test("runs all three checks", () => {
    write("docs/requirements/user-stories.md", "### US-C1 — One\n");
    write("docs/requirements/traceability.md", "");
    write("docs/adr/0001-a.md", "# no sections\n");
    write("docs/adr/README.md", "(0001-a.md) [a](missing.md)\n");
    const problems = checkAll(root).join("\n");
    expect(problems).toContain("no row for US-C1");
    expect(problems).toContain("no context section");
    expect(problems).toContain('link to "missing.md" does not resolve');
  });
});
