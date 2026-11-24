// The table of traces (US-C10; M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md, sections 3 and 4): what it takes,
// what it refuses, and the one sum of a session's cost.

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  CROSS_ROLE,
  costOfSession,
  type Database,
  storeTrace,
  type TraceToStore,
  withTenant,
} from "../src/index.ts";
import {
  adopt,
  createTestDatabase,
  type SeededTenant,
  seedTenant,
  type TestDatabase,
} from "./harness.ts";

let database: TestDatabase;
let pool: pg.Pool;
let app: Database;
let administrator: pg.Client;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  pool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 4 });
  app = adopt(APP_ROLE, pool);
  administrator = await database.administrator();
  const cross = await database.client(CROSS_ROLE);
  a = await seedTenant(cross, pool, "a", "+15550100");
  b = await seedTenant(cross, pool, "b", "+15550101");
}, 30_000);

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query("DELETE FROM ai_traces");
});

const TURN = "7d0c2b7e-3f0a-4a53-9a4e-0d6f5b1c2a10";
const AT = new Date("2026-11-24T10:00:00.000Z");
const ok = (overrides: Partial<TraceToStore> = {}): TraceToStore => ({
  tenantId: a.tenantId,
  sessionId: a.sessionId,
  turnId: TURN,
  turnStartedAt: AT,
  startedAt: new Date(AT.getTime() + 250),
  latencyMs: 1_234,
  prompts: [
    { name: "reply", version: 3 },
    { name: "reply-pack", version: 1 },
  ],
  model: "scripted",
  inputTokens: 1_000,
  outputTokens: 500,
  costMicros: 10_500,
  priceInput: 3_000_000,
  priceOutput: 15_000_000,
  toolNames: ["find_times", "find_times"],
  outcome: "ok",
  outcomeCode: null,
  ...overrides,
});
const NOTHING = {
  model: null,
  inputTokens: null,
  outputTokens: null,
  costMicros: null,
  priceInput: null,
  priceOutput: null,
  toolNames: [],
};
const UNPRICED = { costMicros: null, priceInput: null, priceOutput: null };
const rows = async () =>
  (await administrator.query("SELECT * FROM ai_traces ORDER BY created_at, id")).rows;

describe("storeTrace", () => {
  test("stores every field as it was given, and returns the row's identifier", async () => {
    const id = await storeTrace(app, ok());
    expect(await rows()).toEqual([
      {
        id,
        tenant_id: a.tenantId,
        created_at: expect.any(Date),
        session_id: a.sessionId,
        turn_id: TURN,
        turn_started_at: AT,
        started_at: new Date(AT.getTime() + 250),
        latency_ms: 1_234,
        prompt_names: ["reply", "reply-pack"],
        prompt_versions: [3, 1],
        model: "scripted",
        input_tokens: "1000",
        output_tokens: "500",
        cost_micros: "10500",
        price_input: "3000000",
        price_output: "15000000",
        tool_names: ["find_times", "find_times"],
        outcome: "ok",
        outcome_code: null,
      },
    ]);
  });

  test("the table has exactly these columns: a new one is a decision about what a trace may hold", async () => {
    const columns = await administrator.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'ai_traces' ORDER BY column_name`,
    );
    expect(columns.rows.map((row) => `${row.column_name} ${row.data_type}`)).toEqual([
      "cost_micros bigint",
      "created_at timestamp with time zone",
      "id uuid",
      "input_tokens bigint",
      "latency_ms integer",
      "model text",
      "outcome text",
      "outcome_code text",
      "output_tokens bigint",
      "price_input bigint",
      "price_output bigint",
      "prompt_names ARRAY",
      "prompt_versions ARRAY",
      "session_id uuid",
      "started_at timestamp with time zone",
      "tenant_id uuid",
      "tool_names ARRAY",
      "turn_id uuid",
      "turn_started_at timestamp with time zone",
    ]);
    // Every text column, and every list of texts, has a check of its own.
    const checked = await administrator.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'ai_traces'::regclass AND contype = 'c'`,
    );
    const all = checked.rows.map((row) => row.definition).join("\n");
    for (const column of ["prompt_names", "tool_names", "model", "outcome", "outcome_code"]) {
      expect(all, column).toMatch(new RegExp(`${column}[^\\n]*(~|= ANY|IN \\(|=)`));
    }
  });

  test.each([
    ["the other outcomes with nothing", { ...NOTHING, outcome: "timeout" }],
    ["a fault", { ...NOTHING, outcome: "fault" }],
    [
      "a provider's failure with its code",
      { ...NOTHING, outcome: "provider-error", outcomeCode: "rate-limited" },
    ],
    [
      "a refused answer, costed",
      { toolNames: [], outcome: "invalid-output", outcomeCode: "truncated" },
    ],
    ["an answer with no price", { ...UNPRICED }],
    ["a model stored as other, with no cost", { ...UNPRICED, model: "other" }],
    ["a free model: a cost of 0", { costMicros: 0, priceInput: 0, priceOutput: 0 }],
    ["no tools", { toolNames: [] }],
    [
      "four tools with names of 64",
      { toolNames: Array.from({ length: 4 }, () => `a${"_-9".repeat(21)}`) },
    ],
    [
      "eight prompts at the largest version",
      {
        prompts: Array.from({ length: 8 }, () => ({
          name: `a${"-9".repeat(19)}b`,
          version: 9_999,
        })),
      },
    ],
    ["a model's name of 200", { ...UNPRICED, model: "m".repeat(200) }],
    [
      "a long cloud identifier",
      { model: "arn:aws:bedrock:us-east-1:000000000000:inference-profile/us.example.model-v1:0" },
    ],
    [
      "the largest counts a client lets through",
      { ...UNPRICED, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER },
    ],
    [
      "the largest cost and prices",
      { costMicros: 2_000_000_000_000, priceInput: 1_000_000_000, priceOutput: 1_000_000_000 },
    ],
    ["the longest latency", { latencyMs: 2_147_483_647 }],
    ["no latency", { latencyMs: 0 }],
  ] as [string, Partial<TraceToStore>][])("takes %s", async (_name, change) => {
    await storeTrace(app, ok(change));
    expect(await rows()).toHaveLength(1);
  });

  const SENTENCE = "Do you have a slot on Thursday?";
  test.each([
    ["a sentence as a prompt's name", { prompts: [{ name: SENTENCE, version: 1 }] }],
    ["a prompt's name in capitals", { prompts: [{ name: "Reply", version: 1 }] }],
    ["a prompt's name with a comma", { prompts: [{ name: "reply,reply", version: 1 }] }],
    ["a prompt's name of 41", { prompts: [{ name: "a".repeat(41), version: 1 }] }],
    ["no prompt", { prompts: [] }],
    ["nine prompts", { prompts: Array.from({ length: 9 }, () => ({ name: "reply", version: 1 })) }],
    ["a prompt with no name", { prompts: [{ name: null as never, version: 1 }] }],
    ["version 0", { prompts: [{ name: "reply", version: 0 }] }],
    ["version 10,000", { prompts: [{ name: "reply", version: 10_000 }] }],
    ["a prompt with no version", { prompts: [{ name: "reply", version: null as never }] }],
    ["a sentence as a tool's name", { toolNames: [SENTENCE] }],
    ["a phone number as a tool's name", { toolNames: ["+15550142"] }],
    ["a tool's name of 65", { toolNames: ["a".repeat(65)] }],
    ["five tools", { toolNames: Array.from({ length: 5 }, () => "hold") }],
    ["a tool with no name", { toolNames: [null as never] }],
    ["a sentence as the model", { ...UNPRICED, model: SENTENCE }],
    ["a model's name with a space", { ...UNPRICED, model: "a model" }],
    ["a model's name of 201", { ...UNPRICED, model: "m".repeat(201) }],
    ["an empty model's name", { ...UNPRICED, model: "" }],
    ["an outcome that is not one", { outcome: "fine" }],
    ["a sentence as the outcome", { outcome: SENTENCE }],
    ["a code on ok", { outcomeCode: "shape" }],
    ["a sentence as the code", { toolNames: [], outcome: "invalid-output", outcomeCode: SENTENCE }],
    ["a refused answer with no code", { toolNames: [], outcome: "invalid-output" }],
    [
      "a provider's code on a refused answer",
      { toolNames: [], outcome: "invalid-output", outcomeCode: "rate-limited" },
    ],
    [
      "a refused answer's code on a provider's failure",
      { ...NOTHING, outcome: "provider-error", outcomeCode: "shape" },
    ],
    ["a provider's failure with no code", { ...NOTHING, outcome: "provider-error" }],
    ["a timeout with a model", { ...NOTHING, model: "scripted", outcome: "timeout" }],
    ["a timeout with counts", { ...NOTHING, inputTokens: 1, outputTokens: 1, outcome: "timeout" }],
    [
      "a timeout with a cost",
      { ...NOTHING, costMicros: 1, priceInput: 1, priceOutput: 1, outcome: "timeout" },
    ],
    ["an answer with no model", { ...UNPRICED, model: null }],
    ["an answer with one count missing", { ...UNPRICED, outputTokens: null }],
    ["a cost with no prices", { priceInput: null, priceOutput: null }],
    ["a cost with one price", { priceOutput: null }],
    ["prices with no cost", { costMicros: null }],
    ["a cost for a model stored as other", { model: "other" }],
    ["tools on an answer that was refused", { outcome: "invalid-output", outcomeCode: "shape" }],
    ["a negative count", { inputTokens: -1 }],
    ["a negative cost", { costMicros: -1 }],
    ["a cost over the largest", { costMicros: 2_000_000_000_001 }],
    ["a price over the ceiling", { priceInput: 1_000_000_001 }],
    ["a negative latency", { latencyMs: -1 }],
    ["another tenant's session", { sessionId: "" as never }],
  ] as [string, Partial<TraceToStore>][])(
    "refuses %s, and stores nothing",
    async (name, change) => {
      const trace =
        name === "another tenant's session" ? ok({ sessionId: b.sessionId }) : ok(change);
      await expect(storeTrace(app, trace)).rejects.toMatchObject({
        code: expect.stringMatching(/^(23514|23503|23502|22P02|2202E)$/),
      });
      expect(await rows()).toEqual([]);
    },
  );

  test("a trace for another tenant than the one it names cannot be written", async () => {
    await expect(
      withTenant(pool, a.tenantId, (tx) =>
        tx.query(
          `INSERT INTO ai_traces (tenant_id, session_id, turn_id, turn_started_at, started_at,
                                  latency_ms, prompt_names, prompt_versions, outcome)
           VALUES ($1, $2, gen_random_uuid(), now(), now(), 0, '{reply}', '{1}', 'timeout')`,
          [b.tenantId, b.sessionId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("the application cannot change or remove a trace", async () => {
    await storeTrace(app, ok());
    for (const statement of [
      "UPDATE ai_traces SET cost_micros = 0, price_input = 0, price_output = 0",
      "UPDATE ai_traces SET outcome = 'timeout'",
      "DELETE FROM ai_traces",
      "TRUNCATE ai_traces",
    ]) {
      await expect(
        withTenant(pool, a.tenantId, (tx) => tx.query(statement)),
        statement,
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(await rows()).toMatchObject([{ cost_micros: "10500", outcome: "ok" }]);
  });

  test("each trace is its own transaction: one that is refused leaves the one before it", async () => {
    await storeTrace(app, ok());
    await expect(storeTrace(app, ok({ outcome: "fine" }))).rejects.toBeDefined();
    expect(await rows()).toHaveLength(1);
  });
});

describe("costOfSession (C15)", () => {
  test("no calls: nothing, and nothing left out", async () => {
    expect(await costOfSession(app, a.tenantId, a.sessionId)).toEqual({
      calls: 0,
      costMicros: 0,
      uncosted: 0,
    });
  });

  test("the sum of what is known, with how many calls it leaves out", async () => {
    await storeTrace(app, ok());
    await storeTrace(app, ok({ costMicros: 0, priceInput: 0, priceOutput: 0 }));
    await storeTrace(app, ok({ costMicros: 2_000_000_000_000, priceInput: 1e9, priceOutput: 1e9 }));
    await storeTrace(app, ok({ ...UNPRICED }));
    await storeTrace(app, ok({ ...NOTHING, outcome: "timeout" }));
    await storeTrace(app, ok({ ...NOTHING, outcome: "fault" }));
    expect(await costOfSession(app, a.tenantId, a.sessionId)).toEqual({
      calls: 6,
      costMicros: 2_000_000_010_500,
      uncosted: 3,
    });
  });

  test("another tenant's traces are not counted, and another tenant is told nothing of this session", async () => {
    await storeTrace(app, ok());
    await storeTrace(
      app,
      ok({
        tenantId: b.tenantId,
        sessionId: b.sessionId,
        costMicros: 7,
        priceInput: 1,
        priceOutput: 1,
      }),
    );
    expect(await costOfSession(app, a.tenantId, a.sessionId)).toMatchObject({
      calls: 1,
      costMicros: 10_500,
    });
    expect(await costOfSession(app, b.tenantId, a.sessionId)).toEqual({
      calls: 0,
      costMicros: 0,
      uncosted: 0,
    });
  });

  test("a session with only calls of unknown cost: 0 is shown beside the count that says why", async () => {
    await storeTrace(app, ok({ ...NOTHING, outcome: "timeout" }));
    expect(await costOfSession(app, a.tenantId, a.sessionId)).toEqual({
      calls: 1,
      costMicros: 0,
      uncosted: 1,
    });
  });
});
