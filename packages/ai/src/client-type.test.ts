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

    // Nor is an object with every public member of one: the private part is what makes a client.
    const members: Pick<LlmClient, keyof LlmClient> = client;
    // @ts-expect-error
    turn(members);
  });

  test("a client's calls cannot be replaced in place: not by the compiler, and not at run time", () => {
    const generate = async (_request: LlmRequest): Promise<LlmResult> => ({ kind: "timeout" });
    const before = client.generate;

    expect(() => {
      // @ts-expect-error The call is read-only.
      client.generate = generate;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error So is the other.
      client.health = async () => ({ ok: true });
    }).toThrow(TypeError);
    // What the compiler lets through is refused when it runs: a client is frozen.
    expect(() => Object.assign(client, { generate })).toThrow(TypeError);
    expect(() => Object.defineProperty(client, "generate", { value: generate })).toThrow(TypeError);
    expect(Object.isFrozen(client)).toBe(true);
    expect(client.generate).toBe(before);

    // The class's own prototype is frozen too, and holds neither call.
    expect(Object.isFrozen(LlmClient.prototype)).toBe(true);
    expect(() => Object.assign(LlmClient.prototype, { generate })).toThrow(TypeError);
    expect(bounded(adapter).generate).not.toBe(generate);
  });

  test("a call taken off its client still works, and still refuses by a rejection", async () => {
    const detached = bounded(
      new FakeLlmAdapter([{ kind: "provider-error", code: "unavailable" }]),
    ).generate;
    const request: LlmRequest = {
      system: "",
      prompts: [],
      messages: [],
      tools: [],
      claimKinds: [],
      maxOutputTokens: 1,
      timeoutMs: 1_000,
    };
    expect(await detached(request)).toEqual({ kind: "provider-error", code: "unavailable" });
    await expect(detached({ ...request, timeoutMs: 0 })).rejects.toBeInstanceOf(RangeError);
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
