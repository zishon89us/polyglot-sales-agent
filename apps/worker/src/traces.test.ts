// A record the client makes is never one the table refuses (design note
// docs/design/notes/m3-u6-traces.md, section 2): every outcome of a call,
// at the edges of what the client lets through, is stored in a real table
// by the worker's own recorder. If the two ever disagree, a call would be
// paid for and then tried again with no record of it.

import {
  bounded,
  type CallPlace,
  FakeLlmAdapter,
  type LlmAdapter,
  type LlmRequest,
} from "@polyglot-sales-agent/ai";
import { MODEL_CALL_TIMEOUT_MS, MODEL_OUTPUT_TOKENS_MAX } from "@polyglot-sales-agent/core";
import { APP_ROLE, CROSS_ROLE, costOfSession, type Database } from "@polyglot-sales-agent/db";
import {
  adopt,
  createTestDatabase,
  type SeededTenant,
  seedTenant,
  type TestDatabase,
} from "@polyglot-sales-agent/db/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { traceRecorder } from "./traces.ts";

let database: TestDatabase;
let pool: pg.Pool;
let app: Database;
let administrator: pg.Client;
let a: SeededTenant;
let place: CallPlace;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  pool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 4 });
  app = adopt(APP_ROLE, pool);
  administrator = await database.administrator();
  a = await seedTenant(await database.client(CROSS_ROLE), pool, "a", "+15550100");
  place = {
    tenantId: a.tenantId,
    sessionId: a.sessionId,
    turnId: "7d0c2b7e-3f0a-4a53-9a4e-0d6f5b1c2a10",
    turnStartedAt: new Date("2026-11-24T10:00:00.000Z"),
  };
}, 30_000);

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query("DELETE FROM ai_traces");
});

const WORDS = "CANARY do you have a slot on Thursday";
const GOOD = {
  reply: `Hello Test Customer. ${WORDS}`,
  claims: [],
  flags: [],
  toolCalls: [],
  language: "en",
};
const LONG = `a${"_-9".repeat(21)}`;
const REQUEST: LlmRequest = {
  system: WORDS,
  prompts: Array.from({ length: 8 }, () => ({ name: `a${"-9".repeat(19)}b`, version: 9_999 })),
  messages: [{ role: "customer", text: `${WORDS} +15550142` }],
  tools: [{ name: LONG, description: WORDS, argumentsSchema: { type: "object" } }],
  claimKinds: ["price"],
  maxOutputTokens: MODEL_OUTPUT_TOKENS_MAX,
  timeoutMs: MODEL_CALL_TIMEOUT_MS,
};
const answers = (
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  value: unknown = GOOD,
): LlmAdapter => ({
  generate: async () => ({ kind: "answer", value, truncated: false, usage, model }),
  health: async () => ({ ok: true }),
});
const stored = async () =>
  (await administrator.query("SELECT * FROM ai_traces ORDER BY created_at, id")).rows;

describe("every record the client can make is one the table takes", () => {
  test("each outcome, through the scripted adapter", async () => {
    const client = bounded(
      new FakeLlmAdapter([
        { kind: "answer", value: GOOD, usage: { inputTokens: 1_000, outputTokens: 500 } },
        { kind: "answer", value: { reply: 7 } },
        { kind: "answer", value: { ...GOOD, flags: ["made-up"] } },
        {
          kind: "answer",
          value: { ...GOOD, claims: [{ kind: "made-up", item: "x", value: "y" }] },
        },
        {
          kind: "answer",
          value: { ...GOOD, reply: "", toolCalls: [{ id: "1", name: "missing", arguments: {} }] },
        },
        { kind: "truncated" },
        { kind: "provider-error", code: "unavailable" },
        { kind: "provider-error", code: "rate-limited" },
        { kind: "provider-error", code: "refused" },
        { kind: "provider-error", code: "bad-request" },
        { kind: "provider-error", code: "not-authorised" },
        { kind: "provider-error", code: "other" },
        { kind: "throw", error: new Error(WORDS) },
      ]),
      {
        record: traceRecorder(app),
        prices: { scripted: { input: 3_000_000, output: 15_000_000 } },
      },
    );
    for (let call = 0; call < 12; call += 1) {
      await client.generate(REQUEST, place);
    }
    await expect(client.generate(REQUEST, place)).rejects.toThrow();
    const rows = await stored();
    expect(rows.map((row) => `${row.outcome} ${row.outcome_code}`)).toEqual([
      "ok null",
      "invalid-output shape",
      "invalid-output flag",
      "invalid-output claim",
      "invalid-output tool-call",
      "invalid-output truncated",
      "provider-error unavailable",
      "provider-error rate-limited",
      "provider-error refused",
      "provider-error bad-request",
      "provider-error not-authorised",
      "provider-error other",
      "fault null",
    ]);
    expect(rows[0]).toMatchObject({ cost_micros: "10500", prompt_versions: Array(8).fill(9_999) });
    // US-C10, 2: nothing of the request, the answer or the fault's message is in any column.
    const written = JSON.stringify(rows);
    for (const mark of ["CANARY", "Thursday", "5550142", "Customer", "Hello"]) {
      expect(written, mark).not.toContain(mark);
    }
    expect(await costOfSession(app, a.tenantId, a.sessionId)).toMatchObject({ calls: 13 });
  });

  test("a call out of time", async () => {
    const waiting: (() => void)[] = [];
    const client = bounded(new FakeLlmAdapter([{ kind: "hang" }]), {
      record: traceRecorder(app),
      timers: {
        set: (run, afterMs) => {
          if (afterMs === 50) {
            waiting.push(run);
          }
          return 0;
        },
        clear: () => {},
      },
    });
    const pending = client.generate({ ...REQUEST, timeoutMs: 50 }, place);
    await new Promise((resolve) => setTimeout(resolve, 20));
    waiting[0]?.();
    expect(await pending).toEqual({ kind: "timeout" });
    expect(await stored()).toMatchObject([{ outcome: "timeout", model: null, cost_micros: null }]);
  });

  test.each([
    [
      "the largest counts, which are not costed",
      "scripted",
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      null,
    ],
    [
      "the largest counts that are costed, at the largest prices",
      "dear",
      1e9,
      1e9,
      "2000000000000",
    ],
    ["no tokens", "scripted", 0, 0, "0"],
    ["a model's name of 200", "m".repeat(200), 1, 1, null],
    ["a model's name the table would refuse, stored as other", "a model, with a comma", 1, 1, null],
    ["a model named other", "other", 1, 1, null],
    ["a model's name in another script", "موديل", 1, 1, null],
  ])("%s", async (_name, model, inputTokens, outputTokens, cost) => {
    const client = bounded(answers(model, { inputTokens, outputTokens }), {
      record: traceRecorder(app),
      prices: {
        scripted: { input: 3_000_000, output: 15_000_000 },
        dear: { input: 1e9, output: 1e9 },
        other: { input: 1, output: 1 },
      },
    });
    expect((await client.generate(REQUEST, place)).kind).toBe("ok");
    expect(await stored()).toMatchObject([{ outcome: "ok", cost_micros: cost }]);
  });

  test("four calls for the tool with the longest name, and a clock that jumps a century", async () => {
    let calls = 0;
    const asks = {
      ...GOOD,
      reply: "",
      toolCalls: [1, 2, 3, 4].map((id) => ({
        id: String(id),
        name: LONG,
        arguments: { say: WORDS },
      })),
    };
    const client = bounded(answers("scripted", { inputTokens: 1, outputTokens: 1 }, asks), {
      record: traceRecorder(app),
      now: () => new Date(Date.UTC(2026 + 100 * calls++, 0, 1)),
    });
    expect((await client.generate(REQUEST, place)).kind).toBe("ok");
    expect(await stored()).toMatchObject([
      { tool_names: [LONG, LONG, LONG, LONG], latency_ms: 2_147_483_647 },
    ]);
  });

  test("the first and last times a trace may hold are stored", async () => {
    for (const time of [new Date(0), new Date(253_402_300_799_999)]) {
      const client = bounded(answers("scripted", { inputTokens: 1, outputTokens: 1 }), {
        record: traceRecorder(app),
        now: () => time,
      });
      expect((await client.generate(REQUEST, { ...place, turnStartedAt: time })).kind).toBe("ok");
    }
    expect((await stored()).map((row) => row.turn_started_at.toISOString())).toEqual([
      "1970-01-01T00:00:00.000Z",
      "9999-12-31T23:59:59.999Z",
    ]);
  });

  test("a session that does not exist: the call is made, the trace is refused, and the caller gets that and not the result", async () => {
    const client = bounded(answers("scripted", { inputTokens: 1, outputTokens: 1 }), {
      record: traceRecorder(app),
    });
    await expect(
      client.generate(REQUEST, { ...place, sessionId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "trace-not-stored" });
    expect(await stored()).toEqual([]);
  });
});
