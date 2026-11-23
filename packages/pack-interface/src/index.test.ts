// The pack interface's own rules (ADR 0014; design note
// docs/design/notes/m3-u4-llm-client.md, section 1, R2 to R5).

import { describe, expect, test } from "vitest";
import {
  type Pack,
  packNamed,
  packNameProblem,
  RESERVED_PACK_NAMES,
  registryProblems,
} from "./index.ts";

describe("a pack's name", () => {
  test("R2: is 1 to 40 of a to z, digits and hyphens, and starts with a letter", () => {
    for (const name of ["a", "faq-only", "cod-confirm", "pack2", `a${"b".repeat(39)}`]) {
      expect(packNameProblem(name), name).toBeUndefined();
    }
    for (const name of [
      "",
      "Booking",
      "2pack",
      "-pack",
      "my_pack",
      "my pack",
      "pack/..",
      "../x",
      "päck",
      "ب",
      `a${"b".repeat(40)}`,
      "__proto__",
    ]) {
      expect(packNameProblem(name), name).toMatch(/^a pack's name is 1 to 40/);
    }
  });

  test("R3: the names of things that are not packs are refused", () => {
    expect(RESERVED_PACK_NAMES).toEqual(["core", "interface", "registry"]);
    for (const name of RESERVED_PACK_NAMES) {
      expect(packNameProblem(name)).toBe(`"${name}" is not a pack's name`);
    }
    // Only the whole name: a pack may hold one of the words.
    expect(packNameProblem("core-extras")).toBeUndefined();
  });
});

describe("a set of packs", () => {
  const one: Pack = { name: "one" };
  const two: Pack = { name: "two", promptFragment: { name: "two", version: 3 } };

  test("R4: a pack is found by its name, and a name nobody registered is not found", () => {
    const registry = { one, two };
    expect(packNamed(registry, "one")).toBe(one);
    expect(packNamed(registry, "two")?.promptFragment).toEqual({ name: "two", version: 3 });
    expect(packNamed(registry, "three")).toBeUndefined();
    expect(packNamed(registry, "")).toBeUndefined();
    expect(packNamed(registry, "ONE")).toBeUndefined();
  });

  test("R5: a name every object has is not a pack", () => {
    const registry = { one };
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(packNamed(registry, name), name).toBeUndefined();
    }
  });

  test("a set is sound when each key is a pack's name and is the name of the pack filed under it", () => {
    expect(registryProblems({ one, two })).toEqual([]);
    expect(registryProblems({})).toEqual([]);
    expect(registryProblems({ one: two })).toEqual([
      '"one": the pack filed here is named otherwise',
    ]);
    expect(registryProblems({ core: { name: "core" } })).toEqual([
      '"core": "core" is not a pack\'s name',
    ]);
    expect(registryProblems({ Bad: { name: "Bad" } })).toHaveLength(1);
    expect(registryProblems({ Bad: one })).toHaveLength(2);
  });
});
