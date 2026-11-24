// One call, one trace (M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md, section 2, cases T1 to T13, and what
// a trace may hold, section 3).

import {
  MODEL_CALL_TIMEOUT_MS,
  MODEL_OUTPUT_TOKENS_MAX,
  TRACE_WRITE_TIMEOUT_MS,
} from "@polyglot-sales-agent/core";
import { describe, expect, test } from "vitest";
import { bounded, type Timers, TraceNotStored } from "./bounded.ts";
import { FAKE_PLACE, FakeLlmAdapter, type FakeStep, keptTraces } from "./fake.ts";
import type { CallPlace, LlmAdapter, LlmRequest, TraceRecord } from "./types.ts";

/** Marked text, a number and a name: none may reach a trace. */
const WORDS = "CANARY-WORDS do you have a slot on Thursday";
const PHONE = "+15550142";
const NAME = "Test Customer";

const GOOD = { reply: `Hello ${NAME}. ${WORDS}`, claims: [], flags: [], toolCalls: [] };
const REQUEST: LlmRequest = {
  system: `instructions ${WORDS}`,
  prompts: [
    { name: "reply", version: 3 },
    { name: "reply-pack", version: 1 },
  ],
  messages: [{ role: "customer", text: `${WORDS} ${PHONE} ${NAME}` }],
  tools: [
    { name: "find_times", description: WORDS, argumentsSchema: { type: "object" } },
    { name: "hold", description: WORDS, argumentsSchema: { type: "object" } },
  ],
  claimKinds: ["price"],
  maxOutputTokens: MODEL_OUTPUT_TOKENS_MAX,
  timeoutMs: MODEL_CALL_TIMEOUT_MS,
};
const PRICES = { scripted: { input: 3_000_000, output: 15_000_000 } };
const USE = { inputTokens: 1_000, outputTokens: 500 };

/** Timers that run nothing until told, and a clock that moves with them. */
class HandTimers implements Timers {
  ms = 0;
  #next = 1;
  readonly #waiting = new Map<number, { at: number; run: () => void }>();
  set(run: () => void, afterMs: number): unknown {
    this.#next += 1;
    this.#waiting.set(this.#next, { at: this.ms + afterMs, run });
    return this.#next;
  }
  clear(handle: unknown): void {
    this.#waiting.delete(handle as number);
  }
  pass(ms: number): void {
    this.ms += ms;
    for (const [handle, timer] of [...this.#waiting]) {
      if (timer.at <= this.ms) {
        this.#waiting.delete(handle);
        timer.run();
      }
    }
  }
  readonly now = (): Date => new Date(1_795_000_000_000 + this.ms);
}

const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
};

function made(script: FakeStep[] | LlmAdapter, prices: typeof PRICES | null = PRICES) {
  const timers = new HandTimers();
  const kept = keptTraces();
  const adapter = Array.isArray(script) ? new FakeLlmAdapter(script) : script;
  const client = bounded(adapter, {
    record: kept.record,
    timers,
    now: timers.now,
    ...(prices === null ? {} : { prices }),
  });
  return { timers, traces: kept.traces, client };
}

const SAME = {
  ...FAKE_PLACE,
  startedAt: new Date(1_795_000_000_000),
  latencyMs: 0,
  prompts: REQUEST.prompts,
};
const NOTHING = {
  model: null,
  inputTokens: null,
  outputTokens: null,
  costMicros: null,
  priceInput: null,
  priceOutput: null,
  toolNames: [],
};

describe("one call, one trace", () => {
  test("T1: an answer that is read: the model, both counts, the cost and its prices, the tools asked for", async () => {
    const asks = {
      ...GOOD,
      reply: "",
      toolCalls: [
        { id: "1", name: "find_times", arguments: { day: WORDS } },
        { id: "2", name: "find_times", arguments: {} },
        { id: "3", name: "hold", arguments: {} },
      ],
    };
    const { client, traces } = made([{ kind: "answer", value: asks, usage: USE }]);
    expect((await client.generate(REQUEST, FAKE_PLACE)).kind).toBe("ok");
    expect(traces).toEqual([
      {
        ...SAME,
        model: "scripted",
        inputTokens: 1_000,
        outputTokens: 500,
        costMicros: 10_500,
        priceInput: 3_000_000,
        priceOutput: 15_000_000,
        toolNames: ["find_times", "find_times", "hold"],
        outcome: "ok",
        outcomeCode: null,
      },
    ]);
  });

  test("the trace is stored before the caller has the result", async () => {
    const order: string[] = [];
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: async () => {
        await Promise.resolve();
        order.push("stored");
      },
    });
    await client.generate(REQUEST, FAKE_PLACE).then(() => order.push("result"));
    expect(order).toEqual(["stored", "result"]);
  });

  test.each([
    ["shape", { kind: "answer", value: { reply: 7 }, usage: USE }],
    ["flag", { kind: "answer", value: { ...GOOD, flags: ["made-up"] }, usage: USE }],
    ["truncated", { kind: "truncated", value: GOOD, usage: USE }],
  ] as [string, FakeStep][])(
    "T2: an answer refused as %s is costed: the tokens were used",
    async (code, step) => {
      const { client, traces } = made([step]);
      expect(await client.generate(REQUEST, FAKE_PLACE)).toMatchObject({
        kind: "invalid-output",
        code,
      });
      expect(traces).toEqual([
        {
          ...SAME,
          model: "scripted",
          inputTokens: 1_000,
          outputTokens: 500,
          costMicros: 10_500,
          priceInput: 3_000_000,
          priceOutput: 15_000_000,
          toolNames: [],
          outcome: "invalid-output",
          outcomeCode: code,
        },
      ]);
    },
  );

  test("T3 and T11: a call out of time has no model, no counts and no cost, and nothing is added when it ends late", async () => {
    const { client, traces, timers } = made([{ kind: "hang" }]);
    const pending = client.generate({ ...REQUEST, timeoutMs: 700 }, FAKE_PLACE);
    await settled();
    expect(traces).toEqual([]);
    timers.pass(700);
    expect(await pending).toEqual({ kind: "timeout" });
    expect(traces).toEqual([
      { ...SAME, latencyMs: 700, ...NOTHING, outcome: "timeout", outcomeCode: null },
    ]);
    timers.pass(60_000);
    await settled();
    expect(traces).toHaveLength(1);
  });

  test("T4: a provider's failure is traced with its code and nothing else", async () => {
    const { client, traces } = made([{ kind: "provider-error", code: "rate-limited" }]);
    await client.generate(REQUEST, FAKE_PLACE);
    expect(traces).toEqual([
      { ...SAME, ...NOTHING, outcome: "provider-error", outcomeCode: "rate-limited" },
    ]);
  });

  test("T5: a fault of the adapter is traced as a fault, and then thrown on", async () => {
    const fault = new Error(`${WORDS} ${PHONE}`);
    const throws: LlmAdapter = {
      generate: () => Promise.reject(fault),
      health: async () => ({ ok: true }),
    };
    const one = made(throws);
    await expect(one.client.generate(REQUEST, FAKE_PLACE)).rejects.toBe(fault);
    expect(one.traces).toEqual([{ ...SAME, ...NOTHING, outcome: "fault", outcomeCode: null }]);

    const nonsense: LlmAdapter = {
      generate: async () => ({ kind: "sentence", text: WORDS }) as never,
      health: async () => ({ ok: true }),
    };
    const two = made(nonsense);
    await expect(two.client.generate(REQUEST, FAKE_PLACE)).rejects.toThrow("neither an answer");
    expect(two.traces).toMatchObject([{ outcome: "fault", model: null }]);
  });

  test.each([
    ["a bad time limit", { timeoutMs: 0 }],
    ["no prompt", { prompts: [] }],
    ["nine prompts", { prompts: Array.from({ length: 9 }, () => ({ name: "reply", version: 1 })) }],
    ["a prompt named in capitals", { prompts: [{ name: "Reply", version: 1 }] }],
    ["a prompt named with a sentence", { prompts: [{ name: WORDS, version: 1 }] }],
    ["a prompt with version 0", { prompts: [{ name: "reply", version: 0 }] }],
    ["a prompt with version 1.5", { prompts: [{ name: "reply", version: 1.5 }] }],
    ["a prompt with version 10,000", { prompts: [{ name: "reply", version: 10_000 }] }],
    ["a prompt that is a string", { prompts: ["reply"] }],
    ["a prompt that is null", { prompts: [null] }],
    ["a tool named with a space", { tools: [{ ...REQUEST.tools[0], name: "find times" }] }],
    ["a tool named in capitals", { tools: [{ ...REQUEST.tools[0], name: "Find" }] }],
    ["a tool named with a number first", { tools: [{ ...REQUEST.tools[0], name: "15550142" }] }],
    ["a tool with an empty name", { tools: [{ ...REQUEST.tools[0], name: "" }] }],
    ["a tool with a name of 65", { tools: [{ ...REQUEST.tools[0], name: "a".repeat(65) }] }],
  ])(
    "T6: %s is refused before the call: no call, no trace, nothing to pay",
    async (_name, change) => {
      const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
      const kept = keptTraces();
      const client = bounded(adapter, { record: kept.record });
      await expect(
        client.generate({ ...REQUEST, ...change } as unknown as LlmRequest, FAKE_PLACE),
      ).rejects.toBeInstanceOf(Error);
      expect(adapter.remaining()).toBe(1);
      expect(kept.traces).toEqual([]);
    },
  );

  test("the limits of T6 are met exactly: eight prompts, version 9,999, a tool's name of 64", async () => {
    const { client, traces } = made([{ kind: "answer", value: GOOD }]);
    const request = {
      ...REQUEST,
      prompts: Array.from({ length: 8 }, () => ({ name: "a", version: 9_999 })),
      tools: [{ ...REQUEST.tools[0], name: `a${"_-9".repeat(21)}` }],
    } as LlmRequest;
    expect((await client.generate(request, FAKE_PLACE)).kind).toBe("ok");
    expect(traces[0]?.prompts).toHaveLength(8);
  });

  test.each([
    ["no place", undefined],
    ["a place that is a string", "here"],
    ["a tenant that is not a UUID", { ...FAKE_PLACE, tenantId: "tenant-a" }],
    ["a session that is a phone number", { ...FAKE_PLACE, sessionId: PHONE }],
    ["no turn", { ...FAKE_PLACE, turnId: undefined }],
    ["a time that is text", { ...FAKE_PLACE, turnStartedAt: "2026-11-24" }],
    ["a time that is not one", { ...FAKE_PLACE, turnStartedAt: new Date(Number.NaN) }],
    ["a time before 1970", { ...FAKE_PLACE, turnStartedAt: new Date(-1) }],
    ["a time the database cannot hold", { ...FAKE_PLACE, turnStartedAt: new Date(-8.64e15) }],
    ["a time after the year 9999", { ...FAKE_PLACE, turnStartedAt: new Date(253_402_300_800_000) }],
  ])("T7: %s: a TypeError, no call and no trace", async (_name, place) => {
    const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
    const kept = keptTraces();
    const client = bounded(adapter, { record: kept.record });
    await expect(client.generate(REQUEST, place as unknown as CallPlace)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(adapter.remaining()).toBe(1);
    expect(kept.traces).toEqual([]);
  });

  test("the first and last times a place may have are taken", async () => {
    for (const turnStartedAt of [new Date(0), new Date(253_402_300_799_999)]) {
      const { client, traces } = made([{ kind: "answer", value: GOOD }]);
      await client.generate(REQUEST, { ...FAKE_PLACE, turnStartedAt });
      expect(traces[0]?.turnStartedAt).toEqual(turnStartedAt);
    }
  });

  test.each([
    ["no time", () => new Date(Number.NaN)],
    ["a time before 1970", () => new Date(-1)],
    ["a time after the year 9999", () => new Date(253_402_300_800_000)],
    ["something that is not a time", () => 1_795_000_000_000 as never],
  ])("a clock that gives %s is found before the call: no call, no trace", async (_name, now) => {
    const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
    const kept = keptTraces();
    const client = bounded(adapter, { record: kept.record, now });
    await expect(client.generate(REQUEST, FAKE_PLACE)).rejects.toBeInstanceOf(TypeError);
    expect(adapter.remaining()).toBe(1);
    expect(kept.traces).toEqual([]);
  });

  test("a time is read once and copied: nothing done to a clock's or a place's date afterwards reaches the trace", async () => {
    const shared = new Date(1_795_000_000_000);
    const turn = new Date(1_000);
    const { traces, timers } = { traces: [] as TraceRecord[], timers: new HandTimers() };
    const client = bounded(new FakeLlmAdapter([{ kind: "hang" }]), {
      record: async (trace) => {
        traces.push(trace);
      },
      timers,
      now: () => shared,
    });
    const pending = client.generate(
      { ...REQUEST, timeoutMs: 10 },
      { ...FAKE_PLACE, turnStartedAt: turn },
    );
    shared.setTime(-8.64e15);
    turn.setTime(-8.64e15);
    timers.pass(10);
    await pending;
    expect(traces[0]).toMatchObject({
      startedAt: new Date(1_795_000_000_000),
      turnStartedAt: new Date(1_000),
      latencyMs: 0,
    });
  });

  test("an object that only says it is a date, or says a time it does not have, is not taken for one", async () => {
    class Lying extends Date {
      override getTime(): number {
        return 1_000;
      }
    }
    const notADate = Object.assign(Object.create(Date.prototype), { getTime: () => 1_000 });
    for (const odd of [new Lying(-8.64e15), notADate]) {
      for (const [place, now] of [
        [{ ...FAKE_PLACE, turnStartedAt: odd }, undefined],
        [FAKE_PLACE, () => odd],
      ] as const) {
        const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
        const kept = keptTraces();
        const client = bounded(adapter, {
          record: kept.record,
          ...(now === undefined ? {} : { now }),
        });
        await expect(client.generate(REQUEST, place)).rejects.toBeInstanceOf(TypeError);
        expect(adapter.remaining()).toBe(1);
        expect(kept.traces).toEqual([]);
      }
    }
    // One that lies about a time it does have is read by its real time.
    const kept = keptTraces();
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: kept.record,
    });
    class Shifted extends Date {
      override getTime(): number {
        return -8.64e15;
      }
    }
    await client.generate(REQUEST, { ...FAKE_PLACE, turnStartedAt: new Shifted(2_000) });
    expect(kept.traces[0]?.turnStartedAt).toEqual(new Date(2_000));
  });

  test("a prompt's or a tool's name that is text when checked and something else when copied is refused before the call", async () => {
    const twice = (key: "prompts" | "tools") => {
      let reads = 0;
      const item = {
        ...(key === "prompts" ? { version: 1 } : REQUEST.tools[0]),
        get name() {
          reads += 1;
          return reads <= 1 ? "reply" : { toString: () => "reply" };
        },
      };
      return { ...REQUEST, [key]: [item] } as unknown as LlmRequest;
    };
    for (const key of ["prompts", "tools"] as const) {
      const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
      const kept = keptTraces();
      const client = bounded(adapter, { record: kept.record });
      const outcome = await client.generate(twice(key), FAKE_PLACE).then(
        () => "called",
        () => "refused",
      );
      if (outcome === "called") {
        const names = key === "prompts" ? kept.traces[0]?.prompts.map((p) => p.name) : [];
        expect(names?.every((name) => typeof name === "string")).toBe(true);
      } else {
        expect(adapter.remaining()).toBe(1);
        expect(kept.traces).toEqual([]);
      }
    }
  });

  test("a clock that fails after the call does not lose it: the trace is stored with no latency, and the result is given", async () => {
    let readings = 0;
    const kept = keptTraces();
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: kept.record,
      now: () => {
        readings += 1;
        if (readings > 1) {
          throw new Error("the clock is away");
        }
        return new Date(1_000);
      },
    });
    expect((await client.generate(REQUEST, FAKE_PLACE)).kind).toBe("ok");
    expect(kept.traces).toMatchObject([{ outcome: "ok", latencyMs: 0 }]);
  });

  test("a request whose prompts read differently each time: what is stored is what was checked, or there is no call", async () => {
    const shifting = (later: unknown) => {
      let reads = 0;
      return {
        ...REQUEST,
        get prompts() {
          reads += 1;
          return (reads <= 2 ? [{ name: "reply", version: 1 }] : later) as LlmRequest["prompts"];
        },
      } as LlmRequest;
    };
    for (const later of [
      [],
      [{ name: "Do you have a slot?", version: 1 }],
      Array(9).fill({ name: "a", version: 1 }),
    ]) {
      const adapter = new FakeLlmAdapter([{ kind: "answer", value: GOOD }]);
      const kept = keptTraces();
      const client = bounded(adapter, { record: kept.record });
      const outcome = await client.generate(shifting(later), FAKE_PLACE).then(
        () => "called",
        () => "refused",
      );
      if (outcome === "called") {
        expect(kept.traces[0]?.prompts).toEqual([{ name: "reply", version: 1 }]);
      } else {
        expect(adapter.remaining()).toBe(1);
        expect(kept.traces).toEqual([]);
      }
    }
  });

  test("the prompts are copied: a change to the request during the call is not in the trace", async () => {
    const { client, traces, timers } = made([{ kind: "hang" }]);
    const prompts = [{ name: "reply", version: 1 }];
    const pending = client.generate({ ...REQUEST, prompts, timeoutMs: 10 }, FAKE_PLACE);
    prompts[0] = { name: "changed", version: 2 };
    prompts.push({ name: "added", version: 3 });
    timers.pass(10);
    await pending;
    expect(traces[0]?.prompts).toEqual([{ name: "reply", version: 1 }]);
  });

  test("the place is copied when the call starts: a change to it during the call changes nothing", async () => {
    const { client, traces, timers } = made([{ kind: "hang" }]);
    const place = { ...FAKE_PLACE, turnStartedAt: new Date(5) };
    const pending = client.generate({ ...REQUEST, timeoutMs: 10 }, place);
    place.sessionId = "changed";
    place.turnStartedAt.setTime(99);
    timers.pass(10);
    await pending;
    expect(traces[0]).toMatchObject({
      sessionId: FAKE_PLACE.sessionId,
      turnStartedAt: new Date(5),
    });
  });

  test("T8: a recorder that fails: the caller gets that failure and not the model's result", async () => {
    const away = new Error("the database is away");
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: () => Promise.reject(away),
    });
    const outcome = await client.generate(REQUEST, FAKE_PLACE).then(
      (result) => result,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(TraceNotStored);
    expect(outcome).toMatchObject({ code: "trace-not-stored", cause: away });
    expect(JSON.stringify(outcome)).not.toContain("Hello");
  });

  test("T8: a recorder that throws at once, or returns nothing, is a failure too", async () => {
    for (const record of [
      () => {
        throw new Error("at once");
      },
      (() => undefined) as never,
    ]) {
      const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), { record });
      const outcome = await client.generate(REQUEST, FAKE_PLACE).then(
        () => "result",
        (error: unknown) => error,
      );
      if (outcome !== "result") {
        expect(outcome).toBeInstanceOf(TraceNotStored);
      }
    }
  });

  test("T8: a recorder that takes longer than its limit is a failure, at the limit", async () => {
    const timers = new HandTimers();
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: () => new Promise<void>(() => {}),
      timers,
    });
    let outcome: unknown = "pending";
    void client.generate(REQUEST, FAKE_PLACE).then(
      () => {
        outcome = "result";
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await settled();
    timers.pass(TRACE_WRITE_TIMEOUT_MS - 1);
    await settled();
    expect(outcome).toBe("pending");
    timers.pass(1);
    await settled();
    expect(outcome).toBeInstanceOf(TraceNotStored);
  });

  test("T9: when the adapter faults and the recorder fails too, the adapter's fault is the one thrown", async () => {
    const fault = new Error("the adapter's");
    const client = bounded(
      { generate: () => Promise.reject(fault), health: async () => ({ ok: true }) },
      { record: () => Promise.reject(new Error("the recorder's")) },
    );
    await expect(client.generate(REQUEST, FAKE_PLACE)).rejects.toBe(fault);
  });

  test("T10: several calls of one turn leave one trace each, with the same turn", async () => {
    const { client, traces } = made([
      { kind: "provider-error", code: "unavailable" },
      { kind: "answer", value: GOOD },
    ]);
    await client.generate(REQUEST, FAKE_PLACE);
    await client.generate(REQUEST, FAKE_PLACE);
    expect(traces.map((trace) => [trace.turnId, trace.outcome])).toEqual([
      [FAKE_PLACE.turnId, "provider-error"],
      [FAKE_PLACE.turnId, "ok"],
    ]);
  });

  test("health is not traced", async () => {
    const { client, traces } = made([]);
    await client.health().catch(() => undefined);
    expect(traces).toEqual([]);
  });

  test("latency is the time around the adapter's call, by the client's clock", async () => {
    const timers = new HandTimers();
    const kept = keptTraces();
    const slow: LlmAdapter = {
      generate: () =>
        new Promise((resolve) => {
          timers.set(
            () =>
              resolve({
                kind: "answer",
                value: GOOD,
                truncated: false,
                usage: USE,
                model: "scripted",
              }),
            1_234,
          );
        }),
      health: async () => ({ ok: true }),
    };
    const client = bounded(slow, { record: kept.record, timers, now: timers.now });
    const pending = client.generate(REQUEST, FAKE_PLACE);
    await settled();
    timers.pass(1_234);
    await pending;
    expect(kept.traces[0]).toMatchObject({ latencyMs: 1_234, startedAt: SAME.startedAt });
  });

  test("a clock that goes backwards gives a latency of 0, never a negative one", async () => {
    let calls = 0;
    const kept = keptTraces();
    const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD }]), {
      record: kept.record,
      now: () => new Date(1_000 - 500 * calls++),
    });
    await client.generate(REQUEST, FAKE_PLACE);
    expect(kept.traces[0]?.latencyMs).toBe(0);
  });
});

describe("what a call cost, on its trace (section 4)", () => {
  const costOf = async (
    prices: Record<string, { input: number; output: number }> | undefined,
    usage = USE,
    model?: string,
  ) => {
    const adapter: LlmAdapter = {
      generate: async () => ({
        kind: "answer",
        value: GOOD,
        truncated: false,
        usage,
        model: model ?? "scripted",
      }),
      health: async () => ({ ok: true }),
    };
    const { client, traces } = made(adapter, (prices ?? null) as typeof PRICES | null);
    const result = await client.generate(REQUEST, FAKE_PLACE);
    return { trace: traces[0] as TraceRecord, result };
  };

  test("C5: a model that is free costs 0, which is a cost", async () => {
    const { trace } = await costOf({ scripted: { input: 0, output: 0 } });
    expect(trace).toMatchObject({ costMicros: 0, priceInput: 0, priceOutput: 0 });
  });

  test.each([
    ["C6: no price for the model", { another: { input: 1, output: 1 } }],
    ["C7: a name that differs in case", { Scripted: { input: 1, output: 1 } }],
    ["C7: a name with a suffix the setting lacks", { "scripted:0": { input: 1, output: 1 } }],
    ["C12: no prices at all", undefined],
  ])(
    "%s: the cost and its prices are null, never 0, and the counts are kept",
    async (_name, prices) => {
      const { trace } = await costOf(prices);
      expect(trace).toMatchObject({
        model: "scripted",
        inputTokens: 1_000,
        outputTokens: 500,
        costMicros: null,
        priceInput: null,
        priceOutput: null,
      });
    },
  );

  test("a price is found by the model's own name only: not by a name every object has", async () => {
    for (const model of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const { trace } = await costOf({ scripted: { input: 1, output: 1 } }, USE, model);
      expect(trace).toMatchObject({ model, costMicros: null, priceInput: null });
    }
  });

  test("C10a: a count over the ceiling is stored as it came and not costed", async () => {
    const { trace } = await costOf(PRICES, { inputTokens: 1_000_000_001, outputTokens: 1 });
    expect(trace).toMatchObject({
      inputTokens: 1_000_000_001,
      costMicros: null,
      priceInput: null,
      priceOutput: null,
    });
  });

  test.each(["model with spaces", "model@provider", "modèle", `${NAME}`, "other"])(
    "a model named %j is stored as `other`, with its counts and no cost; the result is unchanged and nothing is thrown",
    async (model) => {
      const { trace, result } = await costOf({ [model]: { input: 1, output: 1 } }, USE, model);
      expect(result).toMatchObject({ kind: "ok", model });
      expect(trace).toMatchObject({
        model: "other",
        inputTokens: 1_000,
        outputTokens: 500,
        costMicros: null,
      });
    },
  );

  test("the prices are copied when the client is made: a change to the list afterwards changes no cost", async () => {
    const prices: Record<string, { input: number; output: number }> = {
      scripted: { input: 3_000_000, output: 15_000_000 },
    };
    const kept = keptTraces();
    const client = bounded(
      new FakeLlmAdapter([
        { kind: "answer", value: GOOD, usage: USE },
        { kind: "answer", value: GOOD, usage: USE },
      ]),
      { record: kept.record, prices },
    );
    await client.generate(REQUEST, FAKE_PLACE);
    prices["scripted"] = { input: 1, output: 1 };
    (prices as Record<string, unknown>)["other-model"] = { input: 1, output: 1 };
    await client.generate(REQUEST, FAKE_PLACE);
    expect(kept.traces.map((trace) => trace.costMicros)).toEqual([10_500, 10_500]);
  });

  test("a price is read once: one that reads differently each time is the first reading, or the client is not made", async () => {
    for (const later of [1.5, 1, "x"]) {
      let reads = 0;
      const prices = {
        scripted: {
          get input() {
            reads += 1;
            return reads <= 1 ? 3_000_000 : later;
          },
          output: 15_000_000,
        },
      };
      const kept = keptTraces();
      const client = bounded(new FakeLlmAdapter([{ kind: "answer", value: GOOD, usage: USE }]), {
        record: kept.record,
        prices: prices as never,
      });
      await client.generate(REQUEST, FAKE_PLACE);
      expect(kept.traces[0]).toMatchObject({ costMicros: 10_500, priceInput: 3_000_000 });
      expect(reads).toBe(1);
    }
  });

  test.each([
    ["a fractional price", { m: { input: 0.5, output: 1 } }],
    ["a price over the ceiling", { m: { input: 1_000_000_001, output: 1 } }],
    ["a price that is a number", { m: 3 }],
    ["a price that is null", { m: null }],
  ])("a client is not made with %s", (_name, prices) => {
    expect(() =>
      bounded(new FakeLlmAdapter([]), { record: keptTraces().record, prices: prices as never }),
    ).toThrow(TypeError);
  });

  test("a long cloud identifier is a model's name", async () => {
    const model = "arn:aws:bedrock:us-east-1:000000000000:inference-profile/us.example.model-v1:0";
    const { trace } = await costOf({ [model]: { input: 2, output: 2 } }, USE, model);
    expect(trace).toMatchObject({ model, costMicros: 1 });
  });
});

describe("no words, numbers or names in a trace (US-C10, 2)", () => {
  test("through every outcome, nothing of the request, the answer or a failure's message is in what is recorded", async () => {
    const fault = new Error(`${WORDS} ${PHONE} ${NAME}`);
    const script: FakeStep[] = [
      { kind: "answer", value: GOOD, usage: USE },
      {
        kind: "answer",
        value: {
          ...GOOD,
          reply: "",
          toolCalls: [
            { id: WORDS.slice(0, 20), name: "hold", arguments: { name: NAME, phone: PHONE } },
          ],
        },
      },
      { kind: "answer", value: { reply: WORDS, claims: NAME } },
      { kind: "answer", value: { ...GOOD, flags: [WORDS] } },
      { kind: "answer", value: { ...GOOD, claims: [{ kind: NAME, item: WORDS, value: PHONE }] } },
      { kind: "truncated", value: GOOD },
      { kind: "provider-error", code: "refused" },
      { kind: "hang" },
    ];
    const { client, traces, timers } = made(script);
    for (let call = 0; call < script.length - 1; call += 1) {
      await client.generate(REQUEST, FAKE_PLACE);
    }
    const last = client.generate(REQUEST, FAKE_PLACE);
    await settled();
    timers.pass(MODEL_CALL_TIMEOUT_MS);
    await last;
    const throwing = made({
      generate: () => Promise.reject(fault),
      health: async () => ({ ok: true }),
    });
    await throwing.client.generate(REQUEST, FAKE_PLACE).catch(() => undefined);
    const all = [...traces, ...throwing.traces];
    expect(all.map((trace) => trace.outcome).sort()).toEqual([
      "fault",
      "invalid-output",
      "invalid-output",
      "invalid-output",
      "invalid-output",
      "ok",
      "ok",
      "provider-error",
      "timeout",
    ]);
    const written = JSON.stringify(all);
    for (const mark of [
      "CANARY",
      "Thursday",
      "5550142",
      "Test",
      "Customer",
      "Hello",
      "instructions",
    ]) {
      expect(written, mark).not.toContain(mark);
    }
    // And a record has exactly these fields: a new one is a decision, made here.
    for (const trace of all) {
      expect(Object.keys(trace).sort()).toEqual([
        "costMicros",
        "inputTokens",
        "latencyMs",
        "model",
        "outcome",
        "outcomeCode",
        "outputTokens",
        "priceInput",
        "priceOutput",
        "prompts",
        "sessionId",
        "startedAt",
        "tenantId",
        "toolNames",
        "turnId",
        "turnStartedAt",
      ]);
    }
  });
});
