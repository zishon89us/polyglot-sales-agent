// The fixed values of one call to the model (issue #158; decisions row
// 44). Each is written out here a second time on purpose: a customer's
// fallback and what a call costs depend on these numbers, and a change to
// one must be a change someone made twice. The glossary, the guardrail
// policy (I3, A6, O7), the design note docs/design/notes/m3-u4-llm-client.md
// (section 4) and row 44 state them too, and this test reads the glossary.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as model from "./model.ts";

describe("the limits on one call to the model", () => {
  test("every value is the one decided", () => {
    expect({ ...model }).toEqual({
      MODEL_CALL_TIMEOUT_MS: 20_000,
      MODEL_CALL_ATTEMPTS: 3,
      MODEL_RETRY_WAITS_MS: [1_000, 4_000],
      MODEL_HEALTH_TIMEOUT_MS: 5_000,
      MODEL_OUTPUT_TOKENS_MAX: 4_096,
      MODEL_CALL_TIMEOUT_CEILING_MS: 60_000,
      MODEL_OUTPUT_TOKENS_CEILING: 8_192,
      REPLY_MAX: 1_200,
      TOOL_ROUNDS_MAX: 4,
      TOOL_CALLS_PER_ROUND_MAX: 4,
      TOOL_ARGUMENTS_MAX: 2_000,
      TOOL_ARGUMENTS_DEPTH_MAX: 5,
      CLAIMS_MAX: 30,
      CLAIM_TEXT_MAX: 100,
      TOOL_CALL_ID_MAX: 100,
      BATCH_TEXT_MAX: 8_000,
      PROMPT_FILE_MAX: 20_000,
    });
  });

  test("they fit each other: what a call is asked for is within its ceiling, and there is a wait between each two attempts", () => {
    expect(model.MODEL_CALL_TIMEOUT_MS).toBeLessThanOrEqual(model.MODEL_CALL_TIMEOUT_CEILING_MS);
    expect(model.MODEL_OUTPUT_TOKENS_MAX).toBeLessThanOrEqual(model.MODEL_OUTPUT_TOKENS_CEILING);
    expect(model.MODEL_RETRY_WAITS_MS).toHaveLength(model.MODEL_CALL_ATTEMPTS - 1);
    expect(model.MODEL_HEALTH_TIMEOUT_MS).toBeLessThan(model.MODEL_CALL_TIMEOUT_MS);
  });

  test("the glossary states the same numbers", () => {
    const glossary = readFileSync(
      new URL("../../../docs/requirements/glossary.md", import.meta.url),
      "utf8",
    );
    const row = (name: string): string => {
      const lines = glossary.split("\n").filter((line) => line.startsWith(`| ${name} |`));
      expect(lines, name).toHaveLength(1);
      return (lines[0] as string).split("|")[2] as string;
    };
    // The row's numbers, each whole ("4,096" is one number, not a 4 and a
    // 96), must be exactly these, in any order: a number changed, added or
    // dropped in the glossary is seen.
    const says = (name: string, ...values: number[]): void => {
      // What a row says in brackets is where it points, not a value.
      const cell = row(name).replaceAll(/\([^)]*\)/g, " ");
      const stated = (cell.match(/\d[\d,]*/g) ?? []).map((text) =>
        Number(text.replaceAll(",", "")),
      );
      expect(
        stated.sort((a, b) => a - b),
        name,
      ).toEqual([...values].sort((a, b) => a - b));
    };
    says(
      "Model call timeout and attempts",
      model.MODEL_CALL_TIMEOUT_MS / 1_000,
      model.MODEL_CALL_ATTEMPTS,
      ...model.MODEL_RETRY_WAITS_MS.map((wait) => wait / 1_000),
    );
    says("Output of one model call", model.MODEL_OUTPUT_TOKENS_MAX);
    says("Reply length", model.REPLY_MAX);
    says(
      "Tool calls in one reply",
      model.TOOL_ROUNDS_MAX,
      model.TOOL_CALLS_PER_ROUND_MAX,
      model.TOOL_ARGUMENTS_MAX,
      model.TOOL_ARGUMENTS_DEPTH_MAX,
      model.TOOL_CALL_ID_MAX,
    );
    says("Claims in one answer", model.CLAIMS_MAX, model.CLAIM_TEXT_MAX);
    says("A batch's customer text", model.BATCH_TEXT_MAX);
    says("Prompt file", model.PROMPT_FILE_MAX);
    says("Provider health check", model.MODEL_HEALTH_TIMEOUT_MS / 1_000);
    says(
      "Ceilings on any model call",
      model.MODEL_CALL_TIMEOUT_CEILING_MS / 1_000,
      model.MODEL_OUTPUT_TOKENS_CEILING,
    );
  });
});
