// What a model call cost, and the price setting (M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md, section 4, cases C1 to C15).

import { describe, expect, test } from "vitest";
import * as trace from "./trace.ts";
import { modelCostMicros, readModelPrices } from "./trace.ts";

const P = { input: 3_000_000, output: 15_000_000 };

describe("the fixed values of a trace", () => {
  test("every value is the one decided", () => {
    const { modelCostMicros: _cost, readModelPrices: _read, ...values } = trace;
    expect(values).toEqual({
      PROMPT_NAME: /^[a-z][a-z0-9-]{0,39}$/,
      PROMPT_VERSION_MAX: 9_999,
      PROMPTS_PER_REQUEST_MAX: 8,
      TOOL_NAME: /^[a-z][a-z0-9_-]{0,63}$/,
      TRACE_MODEL_NAME: /^[A-Za-z0-9._:/-]{1,200}$/,
      TRACE_MODEL_OTHER: "other",
      TRACE_OUTCOMES: ["ok", "invalid-output", "timeout", "provider-error", "fault"],
      TRACE_WRITE_TIMEOUT_MS: 5_000,
      MODEL_PRICE_MAX: 1_000_000_000,
      COSTED_TOKENS_MAX: 1_000_000_000,
      MODEL_PRICES_MAX: 100,
    });
  });
});

describe("what a call cost", () => {
  test.each([
    ["C1", 1_000, 500, P, 10_500],
    ["C2", 1, 0, P, 3],
    ["C3: rounded up", 1, 0, { input: 1, output: 0 }, 1],
    ["C3: rounded up from just over a whole", 1_000_001, 0, { input: 1, output: 0 }, 2],
    ["exactly a whole is not rounded", 1_000_000, 0, { input: 1, output: 0 }, 1],
    ["C4: no tokens", 0, 0, P, 0],
    ["C5: a free model", 1_000, 500, { input: 0, output: 0 }, 0],
    ["output only", 0, 2, { input: 9, output: 500_000 }, 1],
    ["both parts are summed before rounding", 1, 1, { input: 500_000, output: 500_000 }, 1],
    ["C10: both ceilings", 1e9, 1e9, { input: 1e9, output: 1e9 }, 2_000_000_000_000],
  ])("%s", (_name, inputTokens, outputTokens, prices, cost) => {
    expect(modelCostMicros({ inputTokens, outputTokens }, prices)).toBe(cost);
  });

  test("C10: past where floating point is exact, the answer is still exact", () => {
    // 999,999,999 x 999,999,937 + 1 x 1 = 999,999,936,000,000,064; a double cannot hold it.
    expect(
      modelCostMicros(
        { inputTokens: 999_999_999, outputTokens: 1 },
        { input: 999_999_937, output: 1 },
      ),
    ).toBe(999_999_936_001);
  });

  test.each([
    ["C10a: a count over the ceiling", { inputTokens: 1e9 + 1, outputTokens: 0 }, P],
    ["a negative count", { inputTokens: -1, outputTokens: 0 }, P],
    ["a fractional count", { inputTokens: 1.5, outputTokens: 0 }, P],
    ["a count that is not a number", { inputTokens: "7", outputTokens: 0 }, P],
    ["a count that is NaN", { inputTokens: 1, outputTokens: Number.NaN }, P],
    ["no counts", undefined, P],
    [
      "a price over the ceiling",
      { inputTokens: 1, outputTokens: 1 },
      { input: 1e9 + 1, output: 0 },
    ],
    ["a negative price", { inputTokens: 1, outputTokens: 1 }, { input: 1, output: -1 }],
    ["a fractional price", { inputTokens: 1, outputTokens: 1 }, { input: 0.5, output: 1 }],
    ["no price", { inputTokens: 1, outputTokens: 1 }, undefined],
  ])("%s has no cost: null, never 0, and nothing is thrown", (_name, usage, prices) => {
    expect(modelCostMicros(usage as never, prices as never)).toBeNull();
  });
});

describe("the price setting", () => {
  test.each([[undefined], [""], ["  \n"], ["{}"], [" {} "]])("C12: %j means no prices", (text) => {
    expect(readModelPrices(text)).toEqual({ ok: true, prices: {} });
  });

  test("an object of names to two prices is read, and cannot be changed afterwards", () => {
    const read = readModelPrices(
      '{"model-a":{"input":3000000,"output":15000000},"vendor.model-b:0":{"output":0,"input":0}}',
    );
    expect(read).toEqual({
      ok: true,
      prices: {
        "model-a": { input: 3_000_000, output: 15_000_000 },
        "vendor.model-b:0": { input: 0, output: 0 },
      },
    });
    expect(read.ok && Object.isFrozen(read.prices) && Object.isFrozen(read.prices["model-a"])).toBe(
      true,
    );
  });

  test("the largest price and a hundred names are read", () => {
    const many = Object.fromEntries(
      Array.from({ length: 100 }, (_, n) => [`m${n}`, { input: 1e9, output: 1e9 }]),
    );
    expect(readModelPrices(JSON.stringify(many))).toMatchObject({ ok: true });
  });

  test.each([
    ["not JSON", "{model: 1}", "is not JSON"],
    ["a list", "[]", "is not an object"],
    ["a number", "7", "is not an object"],
    ["null", "null", "is not an object"],
    ["a price that is a number", '{"m":3}', "is not an object"],
    ["a price that is a list", '{"m":[1,2]}', "is not an object"],
    ["no output", '{"m":{"input":1}}', "not exactly"],
    ["an unknown key", '{"m":{"input":1,"output":1,"cached":1}}', "not exactly"],
    ["a misspelt key", '{"m":{"input":1,"outputs":1}}', "not exactly"],
    ["a third key that sorts last", '{"m":{"input":1,"output":1,"zzz":1}}', "not exactly"],
    ["a third key that sorts between", '{"m":{"input":1,"middle":1,"output":1}}', "not exactly"],
    ["a negative price", '{"m":{"input":-1,"output":1}}', "whole number"],
    ["a fractional price", '{"m":{"input":1.5,"output":1}}', "whole number"],
    ["a price as text", '{"m":{"input":"1","output":1}}', "whole number"],
    ["a price over the ceiling", '{"m":{"input":1000000001,"output":1}}', "whole number"],
    ["a name with a space", '{"my model":{"input":1,"output":1}}', "not a model's name"],
    ["an empty name", '{"":{"input":1,"output":1}}', "not a model's name"],
    [
      "the name kept for names that do not fit",
      '{"other":{"input":1,"output":1}}',
      "not a model's",
    ],
    [
      "more than a hundred names",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 101 }, (_, n) => [`m${n}`, { input: 1, output: 1 }]),
        ),
      ),
      "more than 100",
    ],
  ])("C11: %s is a problem, said without repeating the setting", (_name, text, problem) => {
    const read = readModelPrices(text);
    expect(read).toMatchObject({ ok: false });
    expect(read.ok ? "" : read.problem).toContain(problem);
    expect(read.ok ? "" : read.problem).not.toMatch(/my model|outputs|cached/);
  });

  test("a name every object has is a name like any other, and is not found unless it was set", () => {
    const read = readModelPrices('{"constructor":{"input":1,"output":2}}');
    expect(read).toMatchObject({ ok: true });
    if (read.ok) {
      expect(Object.hasOwn(read.prices, "constructor")).toBe(true);
      expect(Object.hasOwn(read.prices, "toString")).toBe(false);
      expect(read.prices["toString"]).toBeUndefined();
    }
  });

  test("C13: a name written twice takes the last, as JSON reads it (known, not caught)", () => {
    expect(readModelPrices('{"m":{"input":1,"output":1},"m":{"input":2,"output":2}}')).toEqual({
      ok: true,
      prices: { m: { input: 2, output: 2 } },
    });
  });
});
