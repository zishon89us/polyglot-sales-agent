// The time bound and the scripted adapter (design note
// docs/design/notes/m3-u4-llm-client.md, sections 2 and 5: C1 to C8, F1 to
// F5). Time is a timer the test moves by hand: nothing here waits.

import {
  MODEL_CALL_TIMEOUT_CEILING_MS,
  MODEL_CALL_TIMEOUT_MS,
  MODEL_HEALTH_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_CEILING,
  MODEL_OUTPUT_TOKENS_MAX,
} from "@polyglot-sales-agent/core";
import { describe, expect, test } from "vitest";
import { AdapterFault, bounded, type Timers } from "./bounded.ts";
import { FAKE_MODEL, FakeLlmAdapter, FakeScriptOver, type FakeStep } from "./fake.ts";
import {
  type AdapterAnswer,
  INVALID_OUTPUT_CODES,
  type LlmAdapter,
  type LlmRequest,
  PROVIDER_ERROR_CODES,
} from "./types.ts";

/** A timer that runs nothing until the test says how much time has passed. */
class HandTimers implements Timers {
  now = 0;
  #next = 1;
  readonly #waiting = new Map<number, { at: number; run: () => void }>();
  cleared = 0;
  set(run: () => void, afterMs: number): unknown {
    const handle = this.#next;
    this.#next += 1;
    this.#waiting.set(handle, { at: this.now + afterMs, run });
    return handle;
  }
  clear(handle: unknown): void {
    if (this.#waiting.delete(handle as number)) {
      this.cleared += 1;
    }
  }
  waiting(): number {
    return this.#waiting.size;
  }
  pass(ms: number): void {
    this.now += ms;
    for (const [handle, timer] of [...this.#waiting]) {
      if (timer.at <= this.now) {
        this.#waiting.delete(handle);
        timer.run();
      }
    }
  }
}

/** Lets every promise that can settle do so. */
const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
};

const GOOD = { reply: "Hello.", claims: [], flags: [], toolCalls: [] };
const REQUEST: LlmRequest = {
  system: "instructions",
  prompts: [{ name: "reply", version: 1 }],
  messages: [{ role: "customer", text: "hi" }],
  tools: [{ name: "find", description: "finds", argumentsSchema: { type: "object" } }],
  claimKinds: ["price"],
  maxOutputTokens: MODEL_OUTPUT_TOKENS_MAX,
  timeoutMs: MODEL_CALL_TIMEOUT_MS,
};
function scripted(
  script: FakeStep[],
  health: ConstructorParameters<typeof FakeLlmAdapter>[1] = [],
) {
  const timers = new HandTimers();
  const adapter = new FakeLlmAdapter(script, health);
  return { timers, adapter, client: bounded(adapter, timers) };
}

describe("a call that answers in time", () => {
  test("C1: an answer that matches is ok, with its token counts and the model's name, and the timer is cleared", async () => {
    const { client, timers, adapter } = scripted([
      { kind: "answer", value: GOOD, usage: { inputTokens: 120, outputTokens: 9 } },
    ]);
    expect(await client.generate(REQUEST)).toEqual({
      kind: "ok",
      output: GOOD,
      usage: { inputTokens: 120, outputTokens: 9 },
      model: FAKE_MODEL,
    });
    expect(timers.waiting()).toBe(0);
    expect(timers.cleared).toBe(1);
    expect(adapter.remaining()).toBe(0);
  });

  test("C2: an answer that does not match is invalid output with its code and its token counts, and is not the provider's failing", async () => {
    const { client } = scripted([
      { kind: "answer", value: { ...GOOD, extra: 1 }, usage: { inputTokens: 5, outputTokens: 7 } },
      { kind: "answer", value: { ...GOOD, flags: ["urgent"] } },
      { kind: "answer", value: { ...GOOD, claims: [{ kind: "policy", item: "1", value: "1" }] } },
      {
        kind: "answer",
        value: { ...GOOD, reply: "", toolCalls: [{ id: "1", name: "x", arguments: {} }] },
      },
      { kind: "answer", value: "I am sorry, I cannot answer in that form." },
      { kind: "answer", value: undefined },
    ]);
    const results = [];
    for (let index = 0; index < 6; index += 1) {
      results.push(await client.generate(REQUEST));
    }
    expect(
      results.map((result) => (result.kind === "invalid-output" ? result.code : result.kind)),
    ).toEqual(["shape", "flag", "claim", "tool-call", "shape", "shape"]);
    expect(results[0]).toEqual({
      kind: "invalid-output",
      code: "shape",
      usage: { inputTokens: 5, outputTokens: 7 },
      model: FAKE_MODEL,
    });
    // The text of what the model wrote is in no result.
    expect(JSON.stringify(results)).not.toContain("sorry");
  });

  test("what the request offers decides: the same answer is accepted by one request and refused by another", async () => {
    const answer = {
      reply: "",
      claims: [],
      flags: [],
      toolCalls: [{ id: "1", name: "find", arguments: {} }],
    };
    const { client } = scripted([
      { kind: "answer", value: answer },
      { kind: "answer", value: answer },
    ]);
    expect((await client.generate(REQUEST)).kind).toBe("ok");
    expect(await client.generate({ ...REQUEST, tools: [] })).toMatchObject({
      kind: "invalid-output",
      code: "tool-call",
    });
  });

  test("C7: an answer the provider cut at the output limit is truncated, whatever the cut text looks like", async () => {
    const { client } = scripted([
      { kind: "truncated", value: GOOD, usage: { inputTokens: 1, outputTokens: 4096 } },
      { kind: "truncated", value: '{"reply": "We open at' },
    ]);
    expect(await client.generate(REQUEST)).toEqual({
      kind: "invalid-output",
      code: "truncated",
      usage: { inputTokens: 1, outputTokens: 4096 },
      model: FAKE_MODEL,
    });
    expect(await client.generate(REQUEST)).toMatchObject({
      kind: "invalid-output",
      code: "truncated",
    });
  });

  test("a provider's failure is passed on with its code, each of the six", async () => {
    const { client } = scripted(
      PROVIDER_ERROR_CODES.map((code) => ({ kind: "provider-error", code })),
    );
    for (const code of PROVIDER_ERROR_CODES) {
      expect(await client.generate(REQUEST)).toEqual({ kind: "provider-error", code });
    }
    expect(PROVIDER_ERROR_CODES).toEqual([
      "unavailable",
      "rate-limited",
      "refused",
      "bad-request",
      "not-authorised",
      "other",
    ]);
    expect(INVALID_OUTPUT_CODES).toEqual(["shape", "flag", "claim", "tool-call", "truncated"]);
  });
});

describe("a call that does not answer in time", () => {
  test("C3: at the timeout and not before, the result is a timeout and the adapter is told to stop", async () => {
    const { client, timers, adapter } = scripted([{ kind: "hang" }]);
    let result: unknown = "pending";
    void client.generate({ ...REQUEST, timeoutMs: 20_000 }).then((value) => {
      result = value;
    });
    await settled();
    timers.pass(19_999);
    await settled();
    expect(result).toBe("pending");
    timers.pass(1);
    await settled();
    expect(result).toEqual({ kind: "timeout" });
    expect(adapter.calls).toHaveLength(1);
  });

  test("C3: the signal the adapter is given is aborted at the timeout", async () => {
    const timers = new HandTimers();
    let seen: AbortSignal | undefined;
    const adapter: LlmAdapter = {
      generate: (_request, signal) => {
        seen = signal;
        return new Promise<AdapterAnswer>(() => {});
      },
      health: async () => ({ ok: true }),
    };
    const pending = bounded(adapter, timers).generate(REQUEST);
    await settled();
    expect(seen?.aborted).toBe(false);
    timers.pass(MODEL_CALL_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "timeout" });
    expect(seen?.aborted).toBe(true);
  });

  test("C4: an answer or a rejection that comes after the timeout is dropped, and nothing is left unhandled", async () => {
    const unhandled: unknown[] = [];
    const note = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", note);
    try {
      for (const then of ["answer", "reject"] as const) {
        const { client, timers } = scripted([{ kind: "hang", then }]);
        const pending = client.generate(REQUEST);
        await settled();
        timers.pass(MODEL_CALL_TIMEOUT_MS);
        expect(await pending, then).toEqual({ kind: "timeout" });
        await settled();
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      process.off("unhandledRejection", note);
    }
    expect(unhandled).toEqual([]);
  });

  test("the time allowed is the request's own", async () => {
    const { client, timers } = scripted([{ kind: "hang" }]);
    const pending = client.generate({ ...REQUEST, timeoutMs: 50 });
    await settled();
    timers.pass(50);
    expect(await pending).toEqual({ kind: "timeout" });
  });
});

describe("a fault that is not the provider's", () => {
  test("C5: what the adapter throws is thrown to the caller, the same error, and is not counted as the provider's failing", async () => {
    const fault = new TypeError("cannot read properties of undefined");
    const { client, timers } = scripted([{ kind: "throw", error: fault }]);
    await expect(client.generate(REQUEST)).rejects.toBe(fault);
    expect(timers.waiting()).toBe(0);
    // One that throws before it returns a promise at all.
    const adapter: LlmAdapter = {
      generate: () => {
        throw fault;
      },
      health: () => {
        throw fault;
      },
    };
    const direct = bounded(adapter, timers);
    await expect(direct.generate(REQUEST)).rejects.toBe(fault);
    await expect(direct.health()).rejects.toBe(fault);
    expect(timers.waiting()).toBe(0);
  });

  test("F1: a call the script has no step for is thrown through to the test, by name", async () => {
    const { client } = scripted([{ kind: "answer", value: GOOD }]);
    await client.generate(REQUEST);
    await expect(client.generate(REQUEST)).rejects.toBeInstanceOf(FakeScriptOver);
    await expect(client.generate(REQUEST)).rejects.toThrow("call 3");
  });

  test("an adapter that breaks its own contract is a fault, not an answer", async () => {
    const timers = new HandTimers();
    const returns = (answer: unknown): LlmAdapter => ({
      generate: async () => answer as AdapterAnswer,
      health: async () => ({ ok: true }),
    });
    for (const answer of [
      {
        kind: "answer",
        value: GOOD,
        truncated: false,
        usage: { inputTokens: -1, outputTokens: 0 },
        model: "m",
      },
      {
        kind: "answer",
        value: GOOD,
        truncated: false,
        usage: { inputTokens: 1.5, outputTokens: 0 },
        model: "m",
      },
      { kind: "answer", value: GOOD, truncated: false, usage: { inputTokens: 1 }, model: "m" },
      {
        kind: "answer",
        value: GOOD,
        truncated: false,
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "",
      },
      { kind: "answer", value: GOOD, truncated: false, model: "m" },
      { kind: "ok", output: GOOD },
      undefined,
      null,
      "an answer",
      // A code is one of the list, never the provider's own words.
      { kind: "provider-error", code: "the provider said: your customer wrote hello" },
    ]) {
      await expect(bounded(returns(answer), timers).generate(REQUEST)).rejects.toBeInstanceOf(
        AdapterFault,
      );
    }
    // Not saying whether the answer was cut is not the same as saying it was not.
    const unsaid = {
      kind: "answer",
      value: GOOD,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "m",
    };
    expect(await bounded(returns(unsaid), timers).generate(REQUEST)).toMatchObject({
      kind: "invalid-output",
      code: "truncated",
    });
    expect(timers.waiting()).toBe(0);
  });

  test("C6: a request with no real bound is refused before the adapter is called", async () => {
    const { client, adapter, timers } = scripted([]);
    for (const timeoutMs of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MODEL_CALL_TIMEOUT_CEILING_MS + 1,
      "20000",
      undefined,
      null,
    ]) {
      await expect(
        client.generate({ ...REQUEST, timeoutMs: timeoutMs as number }),
        String(timeoutMs),
      ).rejects.toBeInstanceOf(RangeError);
    }
    for (const maxOutputTokens of [
      0,
      -1,
      1.5,
      Number.NaN,
      MODEL_OUTPUT_TOKENS_CEILING + 1,
      "1024",
      undefined,
    ]) {
      await expect(
        client.generate({ ...REQUEST, maxOutputTokens: maxOutputTokens as number }),
        String(maxOutputTokens),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(adapter.calls).toEqual([]);
    expect(timers.waiting()).toBe(0);
  });

  test("C6: each ceiling itself is allowed", async () => {
    const { client } = scripted([
      { kind: "answer", value: GOOD },
      { kind: "answer", value: GOOD },
    ]);
    expect(
      (await client.generate({ ...REQUEST, timeoutMs: MODEL_CALL_TIMEOUT_CEILING_MS })).kind,
    ).toBe("ok");
    expect(
      (await client.generate({ ...REQUEST, maxOutputTokens: MODEL_OUTPUT_TOKENS_CEILING })).kind,
    ).toBe("ok");
    expect(MODEL_OUTPUT_TOKENS_MAX).toBeLessThanOrEqual(MODEL_OUTPUT_TOKENS_CEILING);
    expect(MODEL_CALL_TIMEOUT_MS).toBeLessThanOrEqual(MODEL_CALL_TIMEOUT_CEILING_MS);
  });
});

describe("health", () => {
  test("F5: is ok when nothing is scripted, and otherwise what the script says", async () => {
    const { client, adapter } = scripted(
      [],
      [
        { kind: "ok" },
        { kind: "failed", failure: "provider-error" },
        { kind: "failed", failure: "timeout" },
      ],
    );
    expect(await client.health()).toEqual({ ok: true });
    expect(await client.health()).toEqual({ ok: false, failure: "provider-error" });
    expect(await client.health()).toEqual({ ok: false, failure: "timeout" });
    expect(await client.health()).toEqual({ ok: true });
    expect(adapter.healthCalls).toBe(4);
  });

  test("C8: one that has not answered in 5 seconds is a timeout, and its signal is aborted", async () => {
    const { client, timers } = scripted([], [{ kind: "hang" }]);
    let result: unknown = "pending";
    void client.health().then((value) => {
      result = value;
    });
    await settled();
    timers.pass(MODEL_HEALTH_TIMEOUT_MS - 1);
    await settled();
    expect(result).toBe("pending");
    timers.pass(1);
    await settled();
    expect(result).toEqual({ ok: false, failure: "timeout" });
    expect(MODEL_HEALTH_TIMEOUT_MS).toBe(5_000);
  });

  test("C8: a throw is thrown on", async () => {
    const fault = new Error("broken");
    const { client } = scripted([], [{ kind: "throw", error: fault }]);
    await expect(client.health()).rejects.toBe(fault);
  });
});

describe("the scripted adapter", () => {
  test("F2, F3: it keeps each request it was given, and says how many steps no call took", async () => {
    const { client, adapter } = scripted([
      { kind: "answer", value: GOOD },
      { kind: "answer", value: GOOD },
      { kind: "provider-error", code: "unavailable" },
    ]);
    expect(adapter.remaining()).toBe(3);
    await client.generate(REQUEST);
    const second = { ...REQUEST, messages: [{ role: "customer" as const, text: "second" }] };
    await client.generate(second);
    expect(adapter.remaining()).toBe(1);
    expect(adapter.calls).toEqual([REQUEST, second]);
  });

  test("F4: the same script gives the same results, call after call", async () => {
    const script: FakeStep[] = [
      { kind: "answer", value: GOOD },
      { kind: "answer", value: "nonsense" },
      { kind: "truncated" },
      { kind: "provider-error", code: "rate-limited" },
    ];
    const run = async () => {
      const { client } = scripted(script);
      const results = [];
      for (let index = 0; index < script.length; index += 1) {
        results.push(await client.generate(REQUEST));
      }
      return results;
    };
    expect(await run()).toEqual(await run());
    // The script a test wrote is not used up by running it.
    expect(script).toHaveLength(4);
  });

  test("with real timers and nothing injected, a call still answers", async () => {
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]));
    expect((await client.generate(REQUEST)).kind).toBe("ok");
  });
});
