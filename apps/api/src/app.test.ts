// The webhook end to end, against PostgreSQL (unit U7): a signed request in,
// rows and a job out, and nothing at all for a request that is refused.

import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  createWhatsAppChannel,
  registrationChallenge,
  SIGNATURE_HEADER,
  sign,
} from "@polyglot-sales-agent/channel-whatsapp";
import {
  APP_ROLE,
  CROSS_ROLE,
  closeDatabase,
  type Database,
  openDatabase,
  withTenant,
} from "@polyglot-sales-agent/db";
import { adopt, createTestDatabase, type TestDatabase } from "@polyglot-sales-agent/db/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { buildApi } from "./app.ts";
import { readConfig } from "./config.ts";
import { createSink } from "./sink.ts";

const SECRET = "synthetic-app-secret";
const FIXTURES = fileURLToPath(
  new URL("../../../packages/channel-whatsapp/fixtures/2026-11-18/", import.meta.url),
);
const fixture = (name: string): Buffer => readFileSync(`${FIXTURES}${name}`);
const NUMBER = { a: "100000000000002", b: "100000000000004" };

let database: TestDatabase;
let app: pg.Pool;
let cross: pg.Pool;
let administrator: pg.Client;
let api: FastifyInstance;
let appDb: Database;
let crossDb: Database;
const reported: string[] = [];
const tenant = { a: "", b: "" };

const channel = createWhatsAppChannel({
  appSecrets: [SECRET],
  baseUrl: "https://channel.invalid",
  apiVersion: "v27.0",
  timeoutMs: 1_000,
});

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 10 });
  cross = new pg.Pool({ connectionString: database.url(CROSS_ROLE), max: 4 });
  administrator = await database.administrator();
  for (const key of ["a", "b"] as const) {
    const made = await cross.query<{ id: string }>(
      `INSERT INTO tenants (name, pack, time_zone, default_language)
       VALUES ($1, 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
      [`Tenant ${key}`],
    );
    tenant[key] = made.rows[0]?.id as string;
    await cross.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'whatsapp', $2)",
      [tenant[key], NUMBER[key]],
    );
  }
  appDb = adopt(APP_ROLE, app);
  crossDb = adopt(CROSS_ROLE, cross);
  api = await buildApi({
    channel,
    registration: (query) => registrationChallenge(query, "synthetic-verify-token"),
    app: appDb,
    cross: crossDb,
    trustedProxies: false,
    report: (event, code) => reported.push(`${event} ${code}`),
  });
}, 30_000);

afterAll(async () => {
  await api.close();
  await app.end();
  await cross.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query(
    "TRUNCATE messages, conversations, contacts, jobs, unparsed_events, unroutable_events CASCADE",
  );
  reported.length = 0;
});

const post = (body: Buffer | string, signature?: string, server: FastifyInstance = api) =>
  server.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    payload: body,
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { [SIGNATURE_HEADER]: signature }),
    },
  });
const signed = (body: Buffer | string) => post(body, sign(Buffer.from(body), SECRET));

/** How many rows every table holds, read by the administrator, who sees all tenants. */
async function counts(): Promise<Record<string, number>> {
  const tables = await administrator.query<{ name: string }>(
    `SELECT relname AS name FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations'
     ORDER BY 1`,
  );
  const result: Record<string, number> = {};
  for (const { name } of tables.rows) {
    const count = await administrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${name}`,
    );
    result[name] = count.rows[0]?.n as number;
  }
  return result;
}

/** Every value in every column of every table, as one string, to look for something that must not be there. */
async function everythingStored(): Promise<string> {
  const tables = Object.keys(await counts());
  const parts: string[] = [];
  for (const name of tables) {
    const all = await administrator.query(`SELECT * FROM ${name}`);
    parts.push(JSON.stringify(all.rows));
  }
  return parts.join("\n");
}

const messagesOf = async (key: "a" | "b") =>
  (
    await withTenant(app, tenant[key], (tx) =>
      tx.query<{ channel_message_id: string; body: string | null; kind: string }>(
        "SELECT channel_message_id, body, kind FROM messages ORDER BY created_at",
      ),
    )
  ).rows;

describe("a validly signed event", () => {
  test("is stored for the tenant of its receiving number, with a job, and answered 200", async () => {
    const response = await signed(fixture("inbound-text.json"));
    expect(response.statusCode).toBe(200);
    expect(await messagesOf("a")).toEqual([
      {
        channel_message_id: "wamid.SYNTHETIC0001",
        body: "Do you have a slot on Thursday?",
        kind: "text",
      },
    ]);
    expect(await messagesOf("b")).toEqual([]);
    expect(await counts()).toMatchObject({ contacts: 1, conversations: 1, messages: 1, jobs: 1 });
  });

  test("the same message five times gives one row, one job, and 200 every time (NFR-R2)", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await signed(fixture("inbound-text.json"))).statusCode).toBe(200);
    }
    expect(await counts()).toMatchObject({ contacts: 1, conversations: 1, messages: 1, jobs: 1 });
  });

  test("the same message five times at once gives one row and one job; each answer is 200 or 503", async () => {
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => signed(fixture("inbound-text.json"))),
    );
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.filter((status) => status !== 200 && status !== 503)).toEqual([]);
    expect(statuses).toContain(200);
    expect(await counts()).toMatchObject({ contacts: 1, conversations: 1, messages: 1, jobs: 1 });
  });

  test("text in Arabic arrives as it was written", async () => {
    await signed(fixture("inbound-text-arabic-escaped.json"));
    expect((await messagesOf("a"))[0]?.body).toBe("هل لديكم موعد يوم الخميس؟");
  });

  test("a customer with no phone number is stored and can write again", async () => {
    await signed(fixture("inbound-text-no-phone.json"));
    const again = JSON.parse(fixture("inbound-text-no-phone.json").toString("utf8"));
    again.entry[0].changes[0].value.messages[0].id = "wamid.SYNTHETIC0033";
    await signed(JSON.stringify(again));
    expect(await counts()).toMatchObject({ contacts: 1, conversations: 1, messages: 2 });
  });

  test("a message of a type that is not read is stored as such", async () => {
    await signed(fixture("inbound-image.json"));
    expect(await messagesOf("a")).toMatchObject([{ kind: "image", body: null }]);
  });

  test("one webhook for two tenants' numbers stores each tenant's part in its own tenant", async () => {
    expect((await signed(fixture("two-numbers.json"))).statusCode).toBe(200);
    expect(await messagesOf("a")).toMatchObject([{ channel_message_id: "wamid.SYNTHETIC0005" }]);
    expect(await messagesOf("b")).toEqual([]);
    expect(await counts()).toMatchObject({ messages: 1, jobs: 1, unroutable_events: 0 });
  });

  test("a failed status keeps the channel's code, from the webhook to the row", async () => {
    await signed(fixture("inbound-text.json"));
    const failed = JSON.parse(fixture("status-failed.json").toString("utf8"));
    const id = failed.entry[0].changes[0].value.statuses[0].id as string;
    await withTenant(app, tenant.a, (tx) =>
      tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status)
         SELECT tenant_id, conversation_id, id, 'outbound', 'assistant-reply', 'text', $1, 'reply', 'sent'
         FROM sessions`,
        [id],
      ),
    );
    expect((await signed(fixture("status-failed.json"))).statusCode).toBe(200);
    const row = await withTenant(app, tenant.a, (tx) =>
      tx.query<{ status: string; error_code: string }>(
        "SELECT status, error_code FROM messages WHERE channel_message_id = $1",
        [id],
      ),
    );
    expect(row.rows).toEqual([{ status: "failed", error_code: "131026" }]);
  });

  test("one number's events are one transaction and one job, however the channel grouped them", async () => {
    const body = JSON.parse(fixture("inbound-text.json").toString("utf8"));
    const second = structuredClone(body.entry[0].changes[0]);
    second.value.messages[0].id = "wamid.SYNTHETIC0011";
    body.entry[0].changes.push(second);
    expect((await signed(JSON.stringify(body))).statusCode).toBe(200);
    expect(await counts()).toMatchObject({ contacts: 1, conversations: 1, messages: 2, jobs: 1 });
  });

  test("a webhook for a known number and an unknown one: the first is stored, the second recorded", async () => {
    const body = JSON.parse(fixture("two-numbers.json").toString("utf8"));
    body.entry[1].changes[0].value.metadata.phone_number_id = "999000000000001";
    expect((await signed(JSON.stringify(body))).statusCode).toBe(200);
    expect(await counts()).toMatchObject({ messages: 1, jobs: 1, unroutable_events: 1 });
    const recorded = await administrator.query("SELECT kind FROM unroutable_events");
    expect(recorded.rows, "the stranger's event was a status").toEqual([{ kind: "status" }]);
  });

  test("a status moves the message it is about, and queues nothing", async () => {
    await signed(fixture("inbound-text.json"));
    await withTenant(app, tenant.a, (tx) =>
      tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status)
         SELECT tenant_id, conversation_id, id, 'outbound', 'assistant-reply', 'text', 'wamid.SYNTHETIC0101', 'reply', 'sent'
         FROM sessions`,
      ),
    );
    expect((await signed(fixture("status-delivered.json"))).statusCode).toBe(200);
    const status = await withTenant(app, tenant.a, (tx) =>
      tx.query("SELECT status FROM messages WHERE channel_message_id = 'wamid.SYNTHETIC0101'"),
    );
    expect(status.rows).toEqual([{ status: "delivered" }]);
    expect((await counts())["jobs"]).toBe(1);
  });
});

describe("a validly signed event that reaches no tenant", () => {
  test("for a number no tenant has: 200, and only identifiers are kept, never the sender or the text", async () => {
    const body = JSON.parse(fixture("inbound-text.json").toString("utf8"));
    body.entry[0].changes[0].value.metadata.phone_number_id = "999000000000001";
    const response = await signed(JSON.stringify(body));
    expect(response.statusCode).toBe(200);
    expect(await counts()).toMatchObject({
      contacts: 0,
      conversations: 0,
      messages: 0,
      jobs: 0,
      unroutable_events: 1,
    });
    const stored = await everythingStored();
    expect(stored).toContain("wamid.SYNTHETIC0001");
    expect(stored).not.toContain("15550142");
    expect(stored).not.toContain("Thursday");
    expect(stored).not.toContain("Test Customer");
    // Sent again, it is still one record.
    await signed(JSON.stringify(body));
    expect((await counts())["unroutable_events"]).toBe(1);
  });

  test("a body that cannot be read: 200, a hash and a size are kept and an operator alert is queued, once", async () => {
    const body = "not json, from +15550142 who said hello";
    expect((await signed(body)).statusCode).toBe(200);
    expect((await signed(body)).statusCode).toBe(200);
    expect(await counts()).toMatchObject({ messages: 0, unparsed_events: 1, jobs: 1 });
    const stored = await everythingStored();
    expect(stored).toContain('"error_code":"not-json"');
    expect(stored).toContain(`"size_bytes":${body.length}`);
    expect(stored).toContain("operator-alert");
    expect(stored).not.toContain("15550142");
    expect(stored).not.toContain("hello");
  });

  test("a webhook with one message of the wrong form: the others are stored, and what was left out is recorded", async () => {
    const body = JSON.parse(fixture("inbound-text.json").toString("utf8"));
    const value = body.entry[0].changes[0].value;
    value.messages.push({ ...value.messages[0], id: "wamid.SYNTHETIC0008", timestamp: 7 });
    expect((await signed(JSON.stringify(body))).statusCode).toBe(200);
    expect(await messagesOf("a")).toHaveLength(1);
    const recorded = await administrator.query(
      "SELECT error_code, items_left_out FROM unparsed_events",
    );
    expect(recorded.rows).toEqual([{ error_code: "malformed-items", items_left_out: 1 }]);
    // The conversation's job and the alert.
    expect((await counts())["jobs"]).toBe(2);
    // A part that is merely not handled is not counted as left out.
    await administrator.query("TRUNCATE unparsed_events, jobs");
    const withOther = JSON.parse(JSON.stringify(body));
    withOther.entry[0].changes.push({ field: "account_update", value: {} });
    withOther.entry[0].changes[0].value.messages[1].id = "wamid.SYNTHETIC0009";
    await signed(JSON.stringify(withOther));
    const again = await administrator.query("SELECT items_left_out FROM unparsed_events");
    expect(again.rows).toEqual([{ items_left_out: 1 }]);
  });
});

describe("a request that is refused stores nothing at all (NFR-S2)", () => {
  test.each([
    ["no signature", undefined],
    ["a wrong signature", `sha256=${"0".repeat(64)}`],
    ["a signature under another secret", sign(fixture("inbound-text.json"), "another-secret")],
  ])("%s: 401, and no table has a row", async (_what, signature) => {
    const before = await counts();
    const response = await post(fixture("inbound-text.json"), signature);
    expect(response.statusCode).toBe(401);
    expect(await counts()).toEqual(before);
    expect(Object.values(before).reduce((sum, n) => sum + n, 0)).toBe(2 + 2 + 2);
  });

  test("a body over the size limit: 413, and no table has a row, even validly signed", async () => {
    const before = await counts();
    const body = Buffer.alloc(channel.maxWebhookBytes + 1, "x");
    const response = await signed(body);
    expect(response.statusCode).toBe(413);
    expect(await counts()).toEqual(before);
  });
});

describe("when the database cannot be reached", () => {
  let down: FastifyInstance;
  let deadApp: Database;
  let deadCross: Database;
  const refusals: string[] = [];

  beforeAll(async () => {
    // Port 9 on this machine: nothing listens there. Opened as `main.ts` opens them.
    deadApp = openDatabase(APP_ROLE, "postgres://psa_app:x@127.0.0.1:9/none");
    deadCross = openDatabase(CROSS_ROLE, "postgres://psa_cross:x@127.0.0.1:9/none");
    down = await buildApi({
      channel,
      registration: () => undefined,
      app: deadApp,
      cross: deadCross,
      trustedProxies: false,
      report: (event, code) => refusals.push(`${event} ${code}`),
    });
  });
  afterAll(async () => {
    await down.close();
    await closeDatabase(deadApp);
    await closeDatabase(deadCross);
  });

  test("a valid event is answered 503, so that the channel sends it again, and nothing of the fault is shown", async () => {
    const body = fixture("inbound-text.json");
    const response = await post(body, sign(body, SECRET), down);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 503, code: "unavailable" });
    expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres/i);
  });

  test("each refusal is reported for the log, as an event and a short code and nothing else", async () => {
    refusals.length = 0;
    const body = fixture("inbound-text.json");
    await post(body, sign(body, SECRET), down);
    expect(refusals).toEqual(["webhook-unavailable ECONNREFUSED"]);
  });

  test("an unreadable body is answered 503 too: it could not be recorded", async () => {
    const response = await post("not json", sign(Buffer.from("not json"), SECRET), down);
    expect(response.statusCode).toBe(503);
  });

  test("a bad signature is still answered 401: the database is not needed to refuse", async () => {
    refusals.length = 0;
    expect((await post(fixture("inbound-text.json"), undefined, down)).statusCode).toBe(401);
    expect(refusals).toEqual([]);
  });

  test("the process is alive but not ready", async () => {
    expect((await down.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const ready = await down.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not-ready" });
  });
});

describe("readiness is about being able to work, not about answering", () => {
  async function readiness(appHandle: Database, crossHandle: Database): Promise<number> {
    const server = await buildApi({
      channel,
      registration: () => undefined,
      app: appHandle,
      cross: crossHandle,
      trustedProxies: false,
    });
    try {
      return (await server.inject({ method: "GET", url: "/readyz" })).statusCode;
    } finally {
      await server.close();
    }
  }

  test("ready only when each handle is the role it is meant to be", async () => {
    expect(await readiness(appDb, crossDb)).toBe(200);
    // The addresses swapped, as a wrong setting would have them: both answer, neither can work.
    expect(await readiness(adopt(APP_ROLE, cross), adopt(CROSS_ROLE, app))).toBe(503);
    expect(await readiness(appDb, adopt(CROSS_ROLE, app)), "only the second is wrong").toBe(503);
    expect(await readiness(adopt(APP_ROLE, cross), crossDb), "only the first is wrong").toBe(503);
  });

  test("a database that accepts the connection and then says nothing is not waited for", async () => {
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    const mute = openDatabase(APP_ROLE, `postgres://psa_app:x@127.0.0.1:${port}/none`);
    const started = Date.now();
    try {
      expect(await readiness(mute, crossDb)).toBe(503);
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally {
      await closeDatabase(mute).catch(() => undefined);
      silent.close();
    }
  }, 15_000);
});

describe("a row held by another transaction does not hold the API (database time limits)", () => {
  test("the webhook gives up on the lock with 503 and a code; another tenant is served meanwhile", async () => {
    // Handles opened as `main.ts` opens them, so its time limits are the ones tested.
    const limitedApp = openDatabase(APP_ROLE, database.url(APP_ROLE));
    const limitedCross = openDatabase(CROSS_ROLE, database.url(CROSS_ROLE), { max: 4 });
    const codes: string[] = [];
    const server = await buildApi({
      channel,
      registration: () => undefined,
      app: limitedApp,
      cross: limitedCross,
      trustedProxies: false,
      report: (_event, code) => codes.push(code),
    });
    const first = fixture("inbound-text.json");
    try {
      expect((await post(first, sign(first, SECRET), server)).statusCode).toBe(200);
      await administrator.query("BEGIN");
      await administrator.query("SELECT 1 FROM conversations FOR UPDATE");
      const again = JSON.parse(first.toString("utf8"));
      again.entry[0].changes[0].value.messages[0].id = "wamid.SYNTHETIC0012";
      const blocked = Buffer.from(JSON.stringify(again));
      const other = JSON.parse(first.toString("utf8"));
      other.entry[0].changes[0].value.metadata.phone_number_id = NUMBER.b;
      const free = Buffer.from(JSON.stringify(other));
      const started = Date.now();
      const [held, served] = await Promise.all([
        post(blocked, sign(blocked, SECRET), server),
        post(free, sign(free, SECRET), server),
      ]);
      expect(served.statusCode, "the other tenant").toBe(200);
      expect(held.statusCode).toBe(503);
      expect(Date.now() - started).toBeLessThan(4_500);
      // 55P03: the lock was not had in time.
      expect(codes).toEqual(["55P03"]);
      expect((await server.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    } finally {
      await administrator.query("ROLLBACK");
      await server.close();
      await closeDatabase(limitedApp);
      await closeDatabase(limitedCross);
    }
  }, 20_000);
});

describe("the sink stops between steps once its deadline has passed", () => {
  test("with the signal already aborted, nothing is stored or recorded", async () => {
    const sink = createSink({ channel, app: appDb, cross: crossDb });
    const aborted = AbortSignal.abort();
    const parsed = channel.parseWebhook(fixture("inbound-text.json"));
    if (!parsed.ok) {
      throw new Error("the fixture must parse");
    }
    const info = { skipped: 0, malformed: 0, sha256: "a".repeat(64), size: 1 };
    await expect(sink.events(parsed.batches, info, aborted)).rejects.toMatchObject({
      code: "deadline",
    });
    await expect(
      sink.unparsed({ code: "not-json", sha256: "a".repeat(64), size: 1 }, aborted),
    ).rejects.toMatchObject({ code: "deadline" });
    expect(await counts()).toMatchObject({ messages: 0, jobs: 0, unparsed_events: 0 });
  });

  test("the record of what was left out is not written once the deadline has passed", async () => {
    const sink = createSink({ channel, app: appDb, cross: crossDb });
    // Nothing to store, so the only step left is the record.
    const info = { skipped: 0, malformed: 1, sha256: "b".repeat(64), size: 1 };
    await expect(sink.events([], info, AbortSignal.abort())).rejects.toMatchObject({
      code: "deadline",
    });
    expect(await counts()).toMatchObject({ unparsed_events: 0, jobs: 0 });
    await sink.events([], info, new AbortController().signal);
    expect(await counts()).toMatchObject({ unparsed_events: 1 });
  });
});

describe("the route inventory (NFR-S8; ADR 0011: there is no operator route)", () => {
  test("the API answers on these paths and methods and on no other", () => {
    const routes = api
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .map((line) => line.replace(/^[^/]*/, "").trim())
      .filter((line) => line !== "");
    expect(routes).toEqual(["/healthz (GET)", "/readyz (GET)", "/webhooks/whatsapp (GET, POST)"]);
  });
});

describe("health", () => {
  test("alive and ready when both database roles answer", async () => {
    const alive = await api.inject({ method: "GET", url: "/healthz" });
    expect([alive.statusCode, alive.json()]).toEqual([200, { status: "ok" }]);
    const ready = await api.inject({ method: "GET", url: "/readyz" });
    expect([ready.statusCode, ready.json()]).toEqual([200, { status: "ready" }]);
  });
});

describe("NFR-P1, measured and not yet gated", () => {
  test("three hundred webhooks, ten at a time, over a real connection: the 99th percentile is recorded", async () => {
    const address = await api.listen({ host: "127.0.0.1", port: 0 });
    const template = fixture("inbound-text.json").toString("utf8");
    const times: number[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < 300) {
        const n = next;
        next += 1;
        // A new message from one of thirty customers each time.
        const body = Buffer.from(
          template
            .replace("wamid.SYNTHETIC0001", `wamid.LOAD${n}`)
            .replaceAll("15550142", `155501${String(10 + (n % 30))}`)
            .replaceAll("US.10000000000000000042", `US.1000000000000000${String(1000 + (n % 30))}`),
        );
        const started = performance.now();
        const response = await fetch(`${address}/webhooks/whatsapp`, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(body, SECRET) },
          body,
        });
        await response.text();
        times.push(performance.now() - started);
        expect([200, 503]).toContain(response.status);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    times.sort((x, y) => x - y);
    const p99 = times[Math.floor(times.length * 0.99) - 1] as number;
    // Not a gate: the reference load is not defined yet. The number goes in the status log.
    process.stdout.write(
      `NFR-P1 measurement: ${times.length} requests, median ${(times[150] as number).toFixed(1)} ms, p99 ${p99.toFixed(1)} ms\n`,
    );
    expect(times).toHaveLength(300);
    expect((await counts())["contacts"]).toBe(30);
  }, 60_000);
});

describe("settings", () => {
  const complete = {
    PSA_ENV: "development",
    PSA_DB_APP_URL: "postgres://a",
    PSA_DB_CROSS_URL: "postgres://c",
    PSA_WHATSAPP_APP_SECRET: "new, old",
    PSA_WHATSAPP_VERIFY_TOKEN: "t",
    PSA_WHATSAPP_BASE_URL: "http://127.0.0.1:4010",
    PSA_WHATSAPP_API_VERSION: "v27.0",
  };

  test("are read once, with this machine and no proxy as defaults", () => {
    expect(readConfig(complete)).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 3000,
      appDatabaseUrl: "postgres://a",
      crossDatabaseUrl: "postgres://c",
      whatsappAppSecrets: ["new", "old"],
      whatsappVerifyToken: "t",
      whatsappBaseUrl: "http://127.0.0.1:4010",
      whatsappApiVersion: "v27.0",
      trustedProxies: false,
    });
    expect(
      readConfig({ ...complete, PSA_TRUSTED_PROXIES: "192.0.2.10, 192.0.2.11" }).trustedProxies,
    ).toEqual(["192.0.2.10", "192.0.2.11"]);
  });

  test("everything missing is named together, and no value is repeated", () => {
    const attempt = () =>
      readConfig({ PSA_DB_APP_URL: "postgres://user:secret@host/db", PSA_API_PORT: "http" });
    expect(attempt).toThrow(
      "api: PSA_ENV must be set to development or production; PSA_DB_CROSS_URL is not set; PSA_WHATSAPP_APP_SECRET is not set; PSA_WHATSAPP_VERIFY_TOKEN is not set; PSA_WHATSAPP_BASE_URL is not set; PSA_WHATSAPP_API_VERSION is not set; PSA_API_PORT is not a port number",
    );
    expect(attempt).not.toThrow("secret");
  });

  test.each(["0", "65536", "0x9a1a", "3000.5", " 3000", "-1", ""])(
    "a port of %j is refused",
    (port) => {
      expect(() => readConfig({ ...complete, PSA_API_PORT: port })).toThrow(
        "PSA_API_PORT is not a port number",
      );
    },
  );

  test.each(["1", "65535"])("a port of %j is accepted", (port) => {
    expect(readConfig({ ...complete, PSA_API_PORT: port }).port).toBe(Number(port));
  });

  test("a blank host is this machine only, never every interface", () => {
    for (const blank of ["", " "]) {
      expect(readConfig({ ...complete, PSA_API_HOST: blank }).host).toBe("127.0.0.1");
    }
    expect(readConfig({ ...complete, PSA_API_HOST: " 192.0.2.7 " }).host).toBe("192.0.2.7");
  });

  test("a setting that is empty or only spaces counts as not set", () => {
    for (const blank of ["", " ", "\t"]) {
      expect(() => readConfig({ ...complete, PSA_WHATSAPP_VERIFY_TOKEN: blank })).toThrow(
        "PSA_WHATSAPP_VERIFY_TOKEN is not set",
      );
    }
  });

  test("in production it refuses the stand-in channel and every placeholder, by name (#165)", () => {
    const real = {
      PSA_ENV: "production",
      PSA_DB_APP_URL: "postgres://psa_app:Zx81@db.internal/psa",
      PSA_DB_CROSS_URL: "postgres://psa_cross:Qw90@db.internal/psa",
      PSA_WHATSAPP_APP_SECRET: "c0ffee",
      PSA_WHATSAPP_VERIFY_TOKEN: "a-real-one",
      PSA_WHATSAPP_BASE_URL: "https://graph.facebook.com",
      PSA_WHATSAPP_API_VERSION: "v27.0",
    };
    expect(readConfig(real).environment).toBe("production");
    expect(() => readConfig({ ...complete, PSA_ENV: "production" })).toThrow(
      "api: will not start in production: PSA_WHATSAPP_BASE_URL is not https://graph.facebook.com, so the channel is a stand-in",
    );
    const example = Object.fromEntries(
      readFileSync(fileURLToPath(new URL("../../../.env.example", import.meta.url)), "utf8")
        .split("\n")
        .filter((line) => /^PSA_[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    // The example file as it is, with only the one word changed: every secret in it is refused.
    const attempt = () => readConfig({ ...example, PSA_ENV: "production" });
    for (const name of [
      "PSA_DB_APP_URL",
      "PSA_DB_CROSS_URL",
      "PSA_WHATSAPP_APP_SECRET",
      "PSA_WHATSAPP_VERIFY_TOKEN",
    ]) {
      expect(attempt).toThrow(`${name} holds a placeholder from the example file`);
    }
    expect(attempt).not.toThrow("local-only");
    for (const [name, value] of Object.entries(real)) {
      if (name.startsWith("PSA_DB") || name.includes("SECRET") || name.includes("TOKEN")) {
        expect(() => readConfig({ ...real, [name]: `${value}-local-only` })).toThrow(
          `${name} holds a placeholder`,
        );
      }
    }
    expect(readConfig(example).environment).toBe("development");
  });

  test("the example file names every setting the API reads", () => {
    const example = readFileSync(
      fileURLToPath(new URL("../../../.env.example", import.meta.url)),
      "utf8",
    );
    const source = readFileSync(fileURLToPath(new URL("./config.ts", import.meta.url)), "utf8");
    const read = [...source.matchAll(/"(PSA_[A-Z_]+)"/g)].map((match) => match[1] as string);
    expect(read.length).toBeGreaterThan(5);
    for (const name of new Set(read)) {
      // The host is optional and deliberately left out of the example.
      if (name !== "PSA_API_HOST") {
        expect(example, name).toContain(`${name}=`);
      }
    }
  });
});

describe("only packages/db can reach the database (ADR 0003, amendment of 2026-11-18)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  /** Every source file of the product outside packages/db that is not a test. */
  function sources(): string[] {
    const found: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const name of readdirSync(`${root}${top}`, { recursive: true, encoding: "utf8" })) {
        const path = `${top}/${name}`;
        if (
          /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) &&
          !/\.test\.[a-z]+$/.test(name) &&
          !/(^|\/)node_modules\//.test(path) &&
          !path.startsWith("packages/db/")
        ) {
          found.push(path);
        }
      }
    }
    return found;
  }
  const DRIVER = /["'`]pg(\/[^"'`]*)?["'`]|["'`]pg-[a-z-]+["'`]|["'`]postgres["'`]/;

  // Ways round the first pattern: the package's inner files and its testing
  // entry, which do give a connection; and a module name that is built,
  // escaped or resolved at run time, which no pattern can read.
  const WAYS_ROUND = [
    // Any entry of the package but its main one, and the operator's, which a test in
    // `apps/ops` keeps to that app and which gives no connection either.
    /["'`]@polyglot-sales-agent\/db\/(?!operator["'`])[^"'`]*["'`]/,
    /["'`][^"'`]*\/db\/(src|test)\/[^"'`]*["'`]/,
    /\bcreateRequire\b/,
    /\bimport\.meta\.resolve\b/,
    // Anything but one plain string between the brackets.
    /\bimport\(\s*(?!["'][^"'\\]*["']\s*\))/,
    // Anything but one plain string between the brackets.
    /\brequire\(\s*(?!["'][^"'\\]*["']\s*\))/,
    /\b(from|import)\s*\(?\s*["'][^"'\n]*\\[^"'\n]*["']/,
  ];

  test("the scan sees the product's files", () => {
    const all = sources();
    expect(all).toContain("apps/api/src/main.ts");
    expect(all).toContain("apps/api/src/sink.ts");
    expect(all).toContain("packages/channel-whatsapp/src/send.ts");
    expect(all.some((path) => path.startsWith("packages/db/"))).toBe(false);
  });

  test("no file outside packages/db names the database driver, so none can hold a connection", () => {
    const offenders = sources().filter((path) =>
      DRIVER.test(readFileSync(`${root}${path}`, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("no file outside packages/db goes round it", () => {
    const offenders = sources().filter((path) => {
      const text = readFileSync(`${root}${path}`, "utf8");
      return WAYS_ROUND.some((pattern) => pattern.test(text));
    });
    expect(offenders).toEqual([]);
  });

  test("each way round that was tried is caught", () => {
    for (const text of [
      'import { poolOf } from "@polyglot-sales-agent/db/testing";',
      'import { poolOf } from "../../../packages/db/src/connect.ts";',
      'import { adopt } from "../../../packages/db/test/harness.ts";',
      'const pg = await import("p" + "g");',
      "const pg = await import(name);",
      'const pg = createRequire(import.meta.url)(["p", "g"].join(""));',
      'createRequire(import.meta.resolve("@polyglot-sales-agent/db"))',
      'import pg from "\\x70g";',
      "const pg = require(name);",
    ]) {
      expect(
        WAYS_ROUND.some((pattern) => pattern.test(text)),
        text,
      ).toBe(true);
    }
    for (const text of [
      'import { storeInbound } from "@polyglot-sales-agent/db";',
      'import { buildApi } from "./app.ts";',
      'const page = await import("./page.ts");',
    ]) {
      expect(
        WAYS_ROUND.some((pattern) => pattern.test(text)),
        text,
      ).toBe(false);
    }
  });

  test("a folder that only has node_modules in its name is still scanned", () => {
    expect(/(^|\/)node_modules\//.test("apps/api/src/node_modules_shim/x.ts")).toBe(false);
    expect(/(^|\/)node_modules\//.test("apps/api/node_modules/pg/index.js")).toBe(true);
  });

  test("the pattern catches every way of naming the driver", () => {
    for (const text of [
      'import pg from "pg";',
      "import { Pool } from 'pg';",
      'const pg = require("pg");',
      'await import("pg");',
      'import type { Pool } from "pg";',
      'import Pool from "pg-pool";',
      'import x from "pg/lib/client";',
      "import postgres from 'postgres';",
    ]) {
      expect(DRIVER.test(text), text).toBe(true);
    }
    expect(DRIVER.test('import { storeInbound } from "@polyglot-sales-agent/db";')).toBe(false);
  });

  test("the package gives out handles, not connections", async () => {
    const db = await import("@polyglot-sales-agent/db");
    expect(Object.keys(db)).not.toContain("poolOf");
    expect(Object.keys(db)).not.toContain("adopt");
    expect(Object.keys(appDb)).toEqual(["role"]);
    expect(Object.isFrozen(appDb)).toBe(true);
  });
});
