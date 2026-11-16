// Checks on the documents, run by code so that nobody has to find these by
// reading (ADR 0013, "sensors"). Each function takes the repository root and
// returns a list of problems; an empty list means the check passed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** Every story heading in user-stories.md has a row in traceability.md, and the reverse. */
export function checkTraceability(root: string): string[] {
  const stories = new Set(
    [...read(root, "docs/requirements/user-stories.md").matchAll(/^### (US-[A-Z]\d+)\b/gm)].map(
      (m) => m[1] as string,
    ),
  );
  const rows = new Set(
    [...read(root, "docs/requirements/traceability.md").matchAll(/^\| (US-[A-Z]\d+)\b/gm)].map(
      (m) => m[1] as string,
    ),
  );
  const problems: string[] = [];
  if (stories.size === 0) {
    problems.push("docs/requirements/user-stories.md: no story headings found");
  }
  for (const id of stories) {
    if (!rows.has(id)) {
      problems.push(`docs/requirements/traceability.md: no row for ${id}`);
    }
  }
  for (const id of rows) {
    if (!stories.has(id)) {
      problems.push(`docs/requirements/traceability.md: row for ${id}, which is not a story`);
    }
  }
  return problems;
}

// Each entry is one required part and the headings that count as it. ADR 0001
// was written before the project adopted the MADR headings and keeps its own.
const ADR_PARTS: { part: string; headings: string[] }[] = [
  { part: "context", headings: ["## Context and Problem Statement", "## Context"] },
  { part: "options", headings: ["## Considered Options", "## Options considered"] },
  { part: "decision", headings: ["## Decision Outcome", "## Decision"] },
];

/** Every decision record has the sections its format requires and is listed in the index. */
export function checkDecisionRecords(root: string): string[] {
  const dir = "docs/adr";
  const index = read(root, `${dir}/README.md`);
  const problems: string[] = [];
  const records = readdirSync(join(root, dir)).filter((name) => /^\d{4}-.+\.md$/.test(name));
  if (records.length === 0) {
    problems.push(`${dir}: no decision records found`);
  }
  for (const name of records) {
    const text = read(root, `${dir}/${name}`);
    for (const { part, headings } of ADR_PARTS) {
      if (!headings.some((heading) => text.includes(`\n${heading}\n`))) {
        problems.push(`${dir}/${name}: no ${part} section (expected "${headings[0]}")`);
      }
    }
    if (!index.includes(`(${name})`)) {
      problems.push(`${dir}/README.md: ${name} is not in the index`);
    }
  }
  return problems;
}

function markdownFiles(root: string, dir: string, skip: string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = dir === "." ? name : `${dir}/${name}`;
    if (skip.includes(path) || name === "node_modules" || name === ".git") {
      continue;
    }
    if (statSync(join(root, path)).isDirectory()) {
      found.push(...markdownFiles(root, path, skip));
    } else if (name.endsWith(".md")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The destinations of inline links, `[text](dest)`, `[text](<dest with spaces>)`
 * and `[text](dest "title")`, and of reference definitions, `[label]: dest`.
 * Not handled: HTML anchors, and code spans or fences other than triple backticks.
 */
export function linkDestinations(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g)) {
    found.push((match[1] ?? match[2]) as string);
  }
  for (const match of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/gm)) {
    found.push((match[1] ?? match[2]) as string);
  }
  return found;
}

/**
 * Every relative link in a Markdown file points at a file that exists.
 * Review reports are skipped: they are kept as received and quote paths freely.
 */
export function checkLinks(root: string): string[] {
  const problems: string[] = [];
  for (const file of markdownFiles(root, ".", ["docs/reviews"])) {
    const text = read(root, file).replace(/```[\s\S]*?```/g, "");
    for (const destination of linkDestinations(text)) {
      const target = (destination.split("#")[0] as string).split("?")[0] as string;
      if (target === "" || /^([a-z][a-z0-9+.-]*:\/\/|mailto:)/i.test(target)) {
        continue;
      }
      const resolved = resolve(root, dirname(file), target);
      if (relative(root, resolved).startsWith("..") || !existsSync(resolved)) {
        problems.push(`${file}: link to "${target}" does not resolve`);
      }
    }
  }
  return problems;
}

export function checkAll(root: string): string[] {
  return [...checkTraceability(root), ...checkDecisionRecords(root), ...checkLinks(root)];
}
