// The webhook end to end, against PostgreSQL (unit U7): a signed request in,
// rows and a job out, and nothing at all for a request that is refused.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createWhatsAppChannel,
  registrationChallenge,
  SIGNATURE_HEADER,
  sign,
} from "@polyglot-sales-agent/channel-whatsapp";
import { APP_ROLE, CROSS_ROLE, withTenant } from "@polyglot-sales-agent/db";
import { createTestDatabase, type TestDatabase } from "@polyglot-sales-agent/db/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { buildApi } from "./app.ts";
import { readConfig } from "./config.ts";

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
  api = await buildApi({
    channel,
    registration: (query) => registrationChallenge(query, "synthetic-verify-token"),
    app,
    cross,
    trustedProxies: false,
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
    expect(await messagesOf("a")).toMatchObject([{ kind: "unsupported", body: null }]);
  });

  test("one webhook for two tenants' numbers stores each tenant's part in its own tenant", async () => {
    expect((await signed(fixture("two-numbers.json"))).statusCode).toBe(200);
    expect(await messagesOf("a")).toMatchObject([{ channel_message_id: "wamid.SYNTHETIC0005" }]);
    expect(await messagesOf("b")).toEqual([]);
    expect(await counts()).toMatchObject({ messages: 1, jobs: 1, unroutable_events: 0 });
  });

  test("a status moves the message it is about, and queues nothing", async () => {
    await signed(fixture("inbound-text.json"));
    await withTenant(app, tenant.a, (tx) =>
      tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, channel_message_id, body, status)
         SELECT tenant_id, id, 'outbound', 'assistant-reply', 'text', 'wamid.SYNTHETIC0101', 'reply', 'sent'
         FROM conversations`,
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
  let deadApp: pg.Pool;
  let deadCross: pg.Pool;

  beforeAll(async () => {
    // Port 9 on this machine: nothing listens there.
    const nowhere = "postgres://psa_app:x@127.0.0.1:9/none";
    deadApp = new pg.Pool({ connectionString: nowhere, connectionTimeoutMillis: 500 });
    deadCross = new pg.Pool({ connectionString: nowhere, connectionTimeoutMillis: 500 });
    down = await buildApi({
      channel,
      registration: () => undefined,
      app: deadApp,
      cross: deadCross,
      trustedProxies: false,
    });
  });
  afterAll(async () => {
    await down.close();
    await deadApp.end();
    await deadCross.end();
  });

  test("a valid event is answered 503, so that the channel sends it again, and nothing of the fault is shown", async () => {
    const body = fixture("inbound-text.json");
    const response = await post(body, sign(body, SECRET), down);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 503, code: "unavailable" });
    expect(response.body).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres/i);
  });

  test("an unreadable body is answered 503 too: it could not be recorded", async () => {
    const response = await post("not json", sign(Buffer.from("not json"), SECRET), down);
    expect(response.statusCode).toBe(503);
  });

  test("a bad signature is still answered 401: the database is not needed to refuse", async () => {
    expect((await post(fixture("inbound-text.json"), undefined, down)).statusCode).toBe(401);
  });

  test("the process is alive but not ready", async () => {
    expect((await down.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const ready = await down.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not-ready" });
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
    PSA_DB_APP_URL: "postgres://a",
    PSA_DB_CROSS_URL: "postgres://c",
    PSA_WHATSAPP_APP_SECRET: "new, old",
    PSA_WHATSAPP_VERIFY_TOKEN: "t",
    PSA_WHATSAPP_BASE_URL: "http://127.0.0.1:4010",
    PSA_WHATSAPP_API_VERSION: "v27.0",
  };

  test("are read once, with this machine and no proxy as defaults", () => {
    expect(readConfig(complete)).toEqual({
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
      "api: PSA_DB_CROSS_URL is not set; PSA_WHATSAPP_APP_SECRET is not set; PSA_WHATSAPP_VERIFY_TOKEN is not set; PSA_WHATSAPP_BASE_URL is not set; PSA_WHATSAPP_API_VERSION is not set; PSA_API_PORT is not a port number",
    );
    expect(attempt).not.toThrow("secret");
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

describe("no SQL outside packages/db (ADR 0003, amendment of unit U7)", () => {
  test("no source file of an app holds a statement or runs a query of its own", () => {
    const apps = fileURLToPath(new URL("../../", import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(apps, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.includes("node_modules")) {
        continue;
      }
      const text = readFileSync(`${apps}${name}`, "utf8");
      if (
        /\.query\(|\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^.\n]*\b(FROM|SET|VALUES|WHERE)\b/.test(
          text,
        )
      ) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
