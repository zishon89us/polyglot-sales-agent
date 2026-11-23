// The packs a deployment runs (ADR 0014; design note
// docs/design/notes/m3-u4-llm-client.md, section 1, R1).

import { readFileSync } from "node:fs";
import { packNamed, registryProblems } from "@polyglot-sales-agent/pack-interface";
import { describe, expect, test } from "vitest";
import { PACKS } from "./index.ts";

describe("the registry", () => {
  test("R1: holds exactly the two packs, each under its own name, and every name is a pack's", () => {
    expect(Object.keys(PACKS).sort()).toEqual(["booking", "faq-only"]);
    expect(registryProblems(PACKS)).toEqual([]);
    expect(packNamed(PACKS, "booking")).toEqual({ name: "booking" });
    // In M3 both are a name and nothing else (ADR 0014; decisions row 37).
    expect(packNamed(PACKS, "faq-only")).toEqual({ name: "faq-only" });
    expect(packNamed(PACKS, "cod-confirm")).toBeUndefined();
  });

  test("the file holds the map and nothing else: imports, and one exported constant", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("//"))
      .join("\n");
    expect(code.match(/^export /gm)).toHaveLength(1);
    expect(code).not.toMatch(/\bfunction\b|=>|\bclass\b|\bif\b|\bfor\b/);
    expect(code.replace(/^import .*;$/gm, "").trim()).toMatch(
      /^export const PACKS: PackRegistry = \{[\s\S]*\};$/,
    );
  });
});
