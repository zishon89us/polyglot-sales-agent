// The api and the worker write a line only through the one shape (NFR-O2;
// design note docs/design/notes/m3-u6-traces.md, section 5). A direct
// write to the console or to a stream would be a line of any shape, with
// room for a sentence.
//
// This is a check of names in source text. It finds the ordinary ways to
// write a line and the roundabout ones its last test lists; it does not
// prove that no code can write one, and two reviews each found ways round
// an earlier form of it. The end-to-end test reads what the two
// programs actually wrote.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const SERVICES = ["apps/api/src", "apps/worker/src"];
/** What the two services import and run: a line written there is the service's line. */
const LIBRARIES = [
  "packages/core/src",
  "packages/ai/src",
  "packages/channel/src",
  "packages/channel-whatsapp/src",
  "packages/pack-interface/src",
  "packages/db/src",
];
/** The database's command-line program is run by an operator and prints to them; no service imports it. */
const NOT_A_SERVICE = ["packages/db/src/cli.ts"];

/** Any way to reach the console, the process's streams, or a file descriptor. */
const DIRECT =
  /\bconsole\b|\bwriteFileSync\b|\bemitWarning\b|\bReflect\b|=\s*process\b|\bprocess\s*\?\.|\bprocess\s*\.\s*(stdout|stderr)|\bprocess\s*\[|\{[^}]*\b(stdout|stderr)\b[^}]*\}\s*=\s*process|node:process|["']process["']|\bwriteSync\b|\bcreateWriteStream\b|\bglobalThis\b|node:(tty|console)/;
const code = (path: string): string =>
  readFileSync(`${root}${path}`, "utf8")
    // Comments may speak of the console; code may not use it.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

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
    const writing = files.filter((path) => DIRECT.test(code(path)));
    expect(writing).toEqual([`${folder}/main.ts`]);
    // With comments left in, too: a comment's marks inside a text hide nothing.
    for (const path of files) {
      expect(readFileSync(`${root}${path}`, "utf8"), path).not.toMatch(/\bconsole\b/);
    }
    // Outside the main file the process is not named in code at all.
    for (const path of files.filter((file) => file !== `${folder}/main.ts`)) {
      expect(code(path), path).not.toMatch(/\bprocess\b/);
    }
    const main = code(`${folder}/main.ts`);
    // One writer, given to logTo; no console at all, and no other way round.
    expect(main).not.toMatch(/\bconsole\b|node:process|writeSync|createWriteStream|globalThis/);
    expect(main.match(/process\s*\.\s*(stdout|stderr)/g)).toHaveLength(2);
    expect(main).toMatch(
      /const log = logTo\("(api|worker)", \(line, level\) => \{\n\s*\(level === "error" \? process\.stderr : process\.stdout\)\.write\(`\$\{line\}\\n`\);\n\}\);/,
    );
  });

  test("nothing the two services import writes a line of its own", () => {
    const files = LIBRARIES.flatMap(sources).filter((path) => !NOT_A_SERVICE.includes(path));
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((path) => DIRECT.test(code(path)))).toEqual([]);
    // And the program left out is imported by neither service.
    for (const folder of SERVICES) {
      for (const path of sources(folder)) {
        expect(code(path), path).not.toMatch(/db\/src\/cli|\/cli\.ts/);
      }
    }
  });

  test("the pattern finds a write, however it is spelt", () => {
    for (const text of [
      "console.log(x)",
      "console .error(x)",
      "process.stdout.write(x)",
      "process . stderr",
      'process["stdout"]',
      "const { stderr } = process;",
      "const { env, stdout } = process;",
      'import { stdout } from "node:process";',
      'import { stdout } from "process";',
      "writeSync(1, x)",
      "createWriteStream('/dev/stdout')",
      'globalThis["console"]["log"](x)',
      'import { Console } from "node:console";',
      "process?.stdout.write(x)",
      "writeFileSync(1, x)",
      "process.emitWarning(x)",
      "const p = process;",
      'Reflect.get(process, "stdout")',
    ]) {
      expect(DIRECT.test(text), text).toBe(true);
    }
    for (const text of [
      "log({ level: 'info' })",
      "process.env",
      "process.once('SIGTERM', stop)",
      "process.exitCode = 1",
    ]) {
      expect(DIRECT.test(text), text).toBe(false);
    }
  });
});
