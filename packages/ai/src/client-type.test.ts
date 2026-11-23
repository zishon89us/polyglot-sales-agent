// That nothing but `bounded` makes a client (design note
// docs/design/notes/m3-u4-llm-client.md, section 2). These are checks of
// types: `make check` compiles this file, and each line marked as an
// expected error fails the compile if it stops being one.

import { describe, expect, test } from "vitest";
import { bounded, LlmClient } from "./bounded.ts";
import { FakeLlmAdapter } from "./fake.ts";
import type { LlmAdapter, LlmRequest, LlmResult } from "./types.ts";

/** Stands for the turn's code: it takes a client and nothing else. */
function turn(client: LlmClient): LlmClient {
  return client;
}

describe("a client is made by bounded and by nothing else", () => {
  const adapter: LlmAdapter = new FakeLlmAdapter([]);
  const client = bounded(adapter);

  test("what bounded returns is a client", () => {
    expect(turn(client)).toBeInstanceOf(LlmClient);
  });

  test("an adapter, an object written by hand, a copy with a method replaced and a new one are each refused by the compiler", () => {
    const generate = async (_request: LlmRequest): Promise<LlmResult> => ({ kind: "timeout" });
    const health = async () => ({ ok: true }) as const;

    // @ts-expect-error An adapter is not a client: its calls are not bounded or checked.
    turn(adapter);
    // @ts-expect-error Nor is an object with the two methods.
    turn({ generate, health });
    // @ts-expect-error Nor is a copy of a client with one replaced: a copy has no methods of its own.
    turn({ ...client, generate });
    // @ts-expect-error And a client cannot be constructed: the constructor is private.
    const made = new LlmClient(adapter, { set: () => 0, clear: () => {} });
    expect(made).toBeDefined();

    // At run time a copy of a client is an empty object: it has neither method.
    expect(Object.keys({ ...client })).toEqual([]);
  });

  test("a request without a bound is refused by the compiler", () => {
    const request = {
      system: "",
      prompts: [],
      messages: [],
      tools: [],
      claimKinds: [],
    };
    // @ts-expect-error timeoutMs is missing.
    const noTime: LlmRequest = { ...request, maxOutputTokens: 1 };
    // @ts-expect-error maxOutputTokens is missing.
    const noLimit: LlmRequest = { ...request, timeoutMs: 1 };
    expect([noTime, noLimit]).toHaveLength(2);
  });
});
