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
import { AdapterFault, bounded, markText, type Timers } from "./bounded.ts";

/** The mark every scripted client of this file draws. */
const MARK = "0123456789abcdef0123456789abcdef";

import {
  FAKE_MODEL,
  FAKE_PLACE,
  FakeLlmAdapter,
  FakeScriptOver,
  type FakeStep,
  keptTraces,
} from "./fake.ts";
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

const GOOD = { reply: "Hello.", claims: [], flags: [], toolCalls: [], language: "en" };
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
  return {
    timers,
    adapter,
    client: bounded(adapter, { record: keptTraces().record, timers: timers, mark: () => MARK }),
  };
}

describe("a call that answers in time", () => {
  test("C1: an answer that matches is ok, with its token counts and the model's name, and the timer is cleared", async () => {
    const { client, timers, adapter } = scripted([
      { kind: "answer", value: GOOD, usage: { inputTokens: 120, outputTokens: 9 } },
    ]);
    expect(await client.generate(REQUEST, FAKE_PLACE)).toEqual({
      kind: "ok",
      output: GOOD,
      usage: { inputTokens: 120, outputTokens: 9 },
      model: FAKE_MODEL,
    });
    expect(timers.waiting()).toBe(0);
    // Two timers, both cleared: the call's, and the one on storing its trace.
    expect(timers.cleared).toBe(2);
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
      results.push(await client.generate(REQUEST, FAKE_PLACE));
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
      language: "en",
    };
    const { client } = scripted([
      { kind: "answer", value: answer },
      { kind: "answer", value: answer },
    ]);
    expect((await client.generate(REQUEST, FAKE_PLACE)).kind).toBe("ok");
    expect(await client.generate({ ...REQUEST, tools: [] }, FAKE_PLACE)).toMatchObject({
      kind: "invalid-output",
      code: "tool-call",
    });
  });

  test("C7: an answer the provider cut at the output limit is truncated, whatever the cut text looks like", async () => {
    const { client } = scripted([
      { kind: "truncated", value: GOOD, usage: { inputTokens: 1, outputTokens: 4096 } },
      { kind: "truncated", value: '{"reply": "We open at' },
    ]);
    expect(await client.generate(REQUEST, FAKE_PLACE)).toEqual({
      kind: "invalid-output",
      code: "truncated",
      usage: { inputTokens: 1, outputTokens: 4096 },
      model: FAKE_MODEL,
    });
    expect(await client.generate(REQUEST, FAKE_PLACE)).toMatchObject({
      kind: "invalid-output",
      code: "truncated",
    });
  });

  test("a provider's failure is passed on with its code, each of the six", async () => {
    const { client } = scripted(
      PROVIDER_ERROR_CODES.map((code) => ({ kind: "provider-error", code })),
    );
    for (const code of PROVIDER_ERROR_CODES) {
      expect(await client.generate(REQUEST, FAKE_PLACE)).toEqual({ kind: "provider-error", code });
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
    void client.generate({ ...REQUEST, timeoutMs: 20_000 }, FAKE_PLACE).then((value) => {
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
    const pending = bounded(adapter, { record: keptTraces().record, timers: timers }).generate(
      REQUEST,
      FAKE_PLACE,
    );
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
        const { client, timers, adapter } = scripted([{ kind: "hang", then, value: GOOD }]);
        const pending = client.generate(REQUEST, FAKE_PLACE);
        await settled();
        expect(adapter.endedLate).toEqual([]);
        timers.pass(MODEL_CALL_TIMEOUT_MS);
        // A good answer that comes late is still a timeout.
        expect(await pending, then).toEqual({ kind: "timeout" });
        await settled();
        await new Promise((resolve) => setImmediate(resolve));
        // The adapter did end, after the client had given up on it.
        // In the way the step said: a late answer and a late rejection are told apart.
        expect(adapter.endedLate, then).toEqual([then]);
      }
    } finally {
      process.off("unhandledRejection", note);
    }
    expect(unhandled).toEqual([]);
  });

  test("the time allowed is the request's own", async () => {
    const { client, timers } = scripted([{ kind: "hang" }]);
    const pending = client.generate({ ...REQUEST, timeoutMs: 50 }, FAKE_PLACE);
    await settled();
    timers.pass(50);
    expect(await pending).toEqual({ kind: "timeout" });
  });
});

describe("a fault that is not the provider's", () => {
  test("C5: what the adapter throws is thrown to the caller, the same error, and is not counted as the provider's failing", async () => {
    const fault = new TypeError("cannot read properties of undefined");
    const { client, timers } = scripted([{ kind: "throw", error: fault }]);
    await expect(client.generate(REQUEST, FAKE_PLACE)).rejects.toBe(fault);
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
    const direct = bounded(adapter, { record: keptTraces().record, timers: timers });
    await expect(direct.generate(REQUEST, FAKE_PLACE)).rejects.toBe(fault);
    await expect(direct.health()).rejects.toBe(fault);
    expect(timers.waiting()).toBe(0);
  });

  test("F1: a call the script has no step for is thrown through to the test, by name", async () => {
    const { client, adapter } = scripted([{ kind: "answer", value: GOOD }]);
    await client.generate(REQUEST, FAKE_PLACE);
    expect(adapter.overran).toBe(0);
    adapter.assertDone();
    await expect(client.generate(REQUEST, FAKE_PLACE)).rejects.toBeInstanceOf(FakeScriptOver);
    await expect(client.generate(REQUEST, FAKE_PLACE)).rejects.toThrow("call 3");
    // Were those errors swallowed by the code under test, the count still says so.
    expect(adapter.remaining()).toBe(0);
    expect(adapter.overran).toBe(2);
    expect(() => adapter.assertDone()).toThrow("2 calls had no step");
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
      await expect(
        bounded(returns(answer), { record: keptTraces().record, timers: timers }).generate(
          REQUEST,
          FAKE_PLACE,
        ),
      ).rejects.toBeInstanceOf(AdapterFault);
    }
    // A model's name is a name: one line, short, with nothing that cannot be stored.
    for (const model of ["m\u0000", "m\nthe customer said hello", "m".repeat(201), 7]) {
      const named = {
        kind: "answer",
        value: GOOD,
        truncated: false,
        usage: { inputTokens: 1, outputTokens: 1 },
        model,
      };
      await expect(
        bounded(returns(named), { record: keptTraces().record, timers: timers }).generate(
          REQUEST,
          FAKE_PLACE,
        ),
      ).rejects.toBeInstanceOf(AdapterFault);
    }
    // An adapter that answers at once, with no promise, has still answered.
    const direct = {
      generate: () => ({ kind: "provider-error", code: "unavailable" }),
      health: () => ({ ok: true }),
    } as unknown as LlmAdapter;
    expect(
      await bounded(direct, { record: keptTraces().record, timers: timers }).generate(
        REQUEST,
        FAKE_PLACE,
      ),
    ).toEqual({
      kind: "provider-error",
      code: "unavailable",
    });
    expect(await bounded(direct, { record: keptTraces().record, timers: timers }).health()).toEqual(
      { ok: true },
    );
    // A health that is neither ok nor one of the two failures is a fault too.
    for (const health of [
      null,
      undefined,
      {},
      { ok: "yes" },
      { ok: false },
      { ok: false, failure: "the provider said no" },
    ]) {
      const adapter = {
        generate: async () => undefined,
        health: async () => health,
      } as unknown as LlmAdapter;
      await expect(
        bounded(adapter, { record: keptTraces().record, timers: timers }).health(),
        JSON.stringify(health),
      ).rejects.toBeInstanceOf(AdapterFault);
    }
    // Not saying whether the answer was cut is not the same as saying it was not.
    const unsaid = {
      kind: "answer",
      value: GOOD,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "m",
    };
    expect(
      await bounded(returns(unsaid), { record: keptTraces().record, timers: timers }).generate(
        REQUEST,
        FAKE_PLACE,
      ),
    ).toMatchObject({
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
        client.generate({ ...REQUEST, timeoutMs: timeoutMs as number }, FAKE_PLACE),
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
        client.generate({ ...REQUEST, maxOutputTokens: maxOutputTokens as number }, FAKE_PLACE),
        String(maxOutputTokens),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(adapter.calls).toEqual([]);
    expect(timers.waiting()).toBe(0);
  });

  test("a request that is not one is refused before the adapter is called, and by a rejection, never a throw", async () => {
    const { client, adapter, timers } = scripted([]);
    for (const request of [
      null,
      undefined,
      "request",
      { ...REQUEST, tools: undefined },
      { ...REQUEST, tools: [{ description: "no name" }] },
      { ...REQUEST, tools: ["find"] },
      { ...REQUEST, claimKinds: "price" },
      { ...REQUEST, claimKinds: [1] },
      { ...REQUEST, messages: undefined },
      { ...REQUEST, prompts: undefined },
      { ...REQUEST, system: undefined },
    ]) {
      const pending = client.generate(request as unknown as LlmRequest, FAKE_PLACE);
      await expect(pending, JSON.stringify(request)).rejects.toBeInstanceOf(TypeError);
    }
    // A bound read once: what was checked is what is used.
    let reads = 0;
    const shifting = {
      ...REQUEST,
      get timeoutMs() {
        reads += 1;
        return reads === 1 ? 50 : 1e9;
      },
    };
    await expect(client.generate(shifting, FAKE_PLACE)).rejects.toBeInstanceOf(RangeError);
    expect(adapter.calls).toEqual([]);
    expect(timers.waiting()).toBe(0);
  });

  test("what a request offers is read when the call is made: a caller that changes its request while the call waits changes nothing of the check", async () => {
    const timers = new HandTimers();
    let answer: (value: AdapterAnswer) => void = () => {};
    const adapter: LlmAdapter = {
      generate: () =>
        new Promise<AdapterAnswer>((resolve) => {
          answer = resolve;
        }),
      health: async () => ({ ok: true }),
    };
    const tools = [...REQUEST.tools];
    const claimKinds = [...REQUEST.claimKinds];
    const request = { ...REQUEST, tools, claimKinds };
    const pending = bounded(adapter, { record: keptTraces().record, timers: timers }).generate(
      request,
      FAKE_PLACE,
    );
    await settled();
    // While the call waits, the caller empties both lists and drops one.
    tools.length = 0;
    claimKinds.length = 0;
    (request as { tools: unknown }).tools = undefined;
    answer({
      kind: "answer",
      value: {
        reply: "",
        claims: [],
        flags: [],
        toolCalls: [{ id: "1", name: "find", arguments: {} }],
        language: "en",
      },
      truncated: false,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "m",
    });
    expect((await pending).kind).toBe("ok");

    // The same for the claim kinds, with an answer that makes a claim.
    const kinds = ["price"];
    const second = bounded(adapter, { record: keptTraces().record, timers: timers }).generate(
      { ...REQUEST, claimKinds: kinds },
      FAKE_PLACE,
    );
    await settled();
    kinds.length = 0;
    answer({
      kind: "answer",
      value: {
        reply: "It is 150.00.",
        claims: [{ kind: "price", item: "s1", value: "150.00" }],
        flags: [],
        toolCalls: [],
        language: "en",
      },
      truncated: false,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "m",
    });
    expect((await second).kind).toBe("ok");
  });

  test("a request whose tools are not plain data is refused by the client before any adapter is called", async () => {
    const { client, adapter } = scripted([{ kind: "answer", value: GOOD }]);
    const odd = {
      ...REQUEST,
      tools: [{ name: "find", description: "", argumentsSchema: { check: () => true } }],
    };
    await expect(client.generate(odd, FAKE_PLACE)).rejects.toThrow("could not be cloned");
    expect(adapter.calls).toEqual([]);
  });

  test("a late answer carries the value its step gave", async () => {
    const adapter = new FakeLlmAdapter([{ kind: "hang", value: GOOD }]);
    const controller = new AbortController();
    const pending = adapter.generate(REQUEST, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ kind: "answer", value: GOOD, truncated: false });
  });

  test("C6: each ceiling itself is allowed", async () => {
    const { client } = scripted([
      { kind: "answer", value: GOOD },
      { kind: "answer", value: GOOD },
    ]);
    expect(
      (await client.generate({ ...REQUEST, timeoutMs: MODEL_CALL_TIMEOUT_CEILING_MS }, FAKE_PLACE))
        .kind,
    ).toBe("ok");
    expect(
      (
        await client.generate(
          { ...REQUEST, maxOutputTokens: MODEL_OUTPUT_TOKENS_CEILING },
          FAKE_PLACE,
        )
      ).kind,
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
    expect(adapter.healthRemaining()).toBe(0);
    adapter.assertDone();
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

  test("a scripted health that no call took is not done", async () => {
    const { adapter } = scripted([], [{ kind: "failed", failure: "timeout" }]);
    expect(adapter.healthRemaining()).toBe(1);
    expect(() => adapter.assertDone()).toThrow("1 health steps");
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
    await client.generate(REQUEST, FAKE_PLACE);
    const second = { ...REQUEST, messages: [{ role: "customer" as const, text: "second" }] };
    await client.generate(second, FAKE_PLACE);
    expect(adapter.remaining()).toBe(1);
    // What an adapter is given is a copy with every message's text marked as data.
    const marked = (request: LlmRequest) => ({
      ...request,
      messages: request.messages.map((message) =>
        "text" in message ? { ...message, text: markText(message.text, MARK) } : message,
      ),
    });
    expect(adapter.calls).toEqual([marked(REQUEST), marked(second)]);
    expect(() => adapter.assertDone()).toThrow("1 steps");
    // What was asked is kept as it was: a caller that changes its request afterwards changes no record.
    const messages = [{ role: "customer" as const, text: "third" }];
    await client.generate({ ...REQUEST, messages }, FAKE_PLACE);
    messages.push({ role: "customer", text: "added after the call" });
    expect(adapter.calls[2]?.messages).toEqual([
      { role: "customer", text: markText("third", MARK) },
    ]);
    adapter.assertDone();
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
        results.push(await client.generate(REQUEST, FAKE_PLACE));
      }
      return results;
    };
    expect(await run()).toEqual(await run());
    // The script a test wrote is not used up by running it.
    expect(script).toHaveLength(4);
  });

  test("with real timers and nothing injected, a call still answers", async () => {
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: keptTraces().record,
    });
    expect((await client.generate(REQUEST, FAKE_PLACE)).kind).toBe("ok");
  });
});
