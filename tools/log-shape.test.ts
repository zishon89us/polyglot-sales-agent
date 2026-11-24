// The api and the worker write a line only through the one shape (NFR-O2;
// design note docs/design/notes/m3-u6-traces.md, section 5). A direct
// write to the console or to a stream would be a line of any shape, with
// room for a sentence.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const SERVICES = ["apps/api/src", "apps/worker/src"];
const DIRECT = /\bconsole\s*\.|process\s*\.\s*(stdout|stderr)|\bprocess\s*\[/;

function sources(folder: string): string[] {
  return readdirSync(`${root}${folder}`, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => `${folder}/${name}`)
    .sort();
}

describe("how the api and the worker write a line", () => {
  test.each(SERVICES)("%s: only its main file writes, and only through logTo", (folder) => {
    const files = sources(folder);
    expect(files).toContain(`${folder}/main.ts`);
    const writing = files.filter((path) => DIRECT.test(readFileSync(`${root}${path}`, "utf8")));
    expect(writing).toEqual([`${folder}/main.ts`]);
    const main = readFileSync(`${root}${folder}/main.ts`, "utf8");
    // One writer, given to logTo; no console at all.
    expect(main).not.toMatch(/\bconsole\b/);
    expect(main.match(/process\s*\.\s*(stdout|stderr)/g)).toHaveLength(2);
    expect(main).toMatch(
      /const log = logTo\("(api|worker)", \(line, level\) => \{\n\s*\(level === "error" \? process\.stderr : process\.stdout\)\.write\(`\$\{line\}\\n`\);\n\}\);/,
    );
  });

  test("the pattern finds a direct write, however it is spelt", () => {
    for (const text of [
      "console.log(x)",
      "console .error(x)",
      "process.stdout.write(x)",
      "process . stderr",
      'process["stdout"]',
    ]) {
      expect(DIRECT.test(text), text).toBe(true);
    }
    expect(DIRECT.test("log({ level: 'info' })")).toBe(false);
  });
});
