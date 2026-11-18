// What the webhook stores (unit U7): contacts matched on the channel's
// identifier and on the number, messages stored once, one job per
// conversation, statuses that only move forward, and the two records of
// events that reach no tenant.

import { OPERATOR_ALERT_JOB } from "@polyglot-sales-agent/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  CROSS_ROLE,
  type IncomingMessage,
  MIGRATE_ROLE,
  PROCESS_CONVERSATION_JOB,
  recordUnparsed,
  recordUnroutable,
  storeInbound,
  tenantOfReceivingNumber,
  withTenant,
} from "../src/index.ts";
import { createTestDatabase, type TestDatabase } from "./harness.ts";

let database: TestDatabase;
let app: pg.Pool;
let cross: pg.Client;
let administrator: pg.Client;
const tenant = { a: "", b: "" };
const NUMBER = { a: "100000000000002", b: "100000000000004" };

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  cross = await database.client(CROSS_ROLE);
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
}, 30_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

beforeEach(async () => {
  // The administrator clears what no working role may delete.
  await administrator.query(
    "TRUNCATE messages, conversations, contacts, jobs, unparsed_events, unroutable_events CASCADE",
  );
});

let serial = 0;
function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  serial += 1;
  return {
    channelMessageId: `wamid.TEST${serial}`,
    phone: "+15550142",
    userId: null,
    kind: "text",
    body: "hello",
    ...overrides,
  };
}

const store = (messages: IncomingMessage[], key: "a" | "b" = "a") =>
  storeInbound(app, tenant[key], NUMBER[key], messages, []);

/** The columns the tests read by name; a row has more. */
interface Row {
  id: string;
  contact_id: string;
  conversation_id: string;
  channel_message_id: string;
  status: string | null;
}

const rows = async (table: string, key: "a" | "b" = "a"): Promise<Row[]> =>
  (
    await withTenant(app, tenant[key], (tx) =>
      tx.query<Row>(`SELECT * FROM ${table} ORDER BY created_at`),
    )
  ).rows;

const jobs = async () =>
  (await cross.query("SELECT type, tenant_id, subject_id, payload FROM jobs ORDER BY created_at"))
    .rows;

describe("tenantOfReceivingNumber", () => {
  test("finds the tenant of a number, and nothing for a number no tenant has", async () => {
    expect(await tenantOfReceivingNumber(cross, NUMBER.a)).toBe(tenant.a);
    expect(await tenantOfReceivingNumber(cross, NUMBER.b)).toBe(tenant.b);
    expect(await tenantOfReceivingNumber(cross, "999")).toBeUndefined();
  });
});

describe("storeInbound: a message", () => {
  test("makes the contact, the conversation and the message, and queues one job for the conversation", async () => {
    const one = message({ body: "Do you have a slot on Thursday?" });
    expect(await store([one])).toEqual({ stored: 1, duplicates: 0, statusesApplied: 0 });
    const [contact] = await rows("contacts");
    const [conversation] = await rows("conversations");
    const [stored] = await rows("messages");
    expect(contact).toMatchObject({ phone: "+15550142", channel_user_id: null });
    expect(conversation).toMatchObject({ contact_id: contact?.id });
    expect(stored).toMatchObject({
      conversation_id: conversation?.id,
      direction: "inbound",
      class: null,
      kind: "text",
      channel_message_id: one.channelMessageId,
      body: "Do you have a slot on Thursday?",
      status: null,
    });
    expect(await jobs()).toEqual([
      {
        type: PROCESS_CONVERSATION_JOB,
        tenant_id: tenant.a,
        subject_id: conversation?.id,
        payload: { conversationId: conversation?.id },
      },
    ]);
  });

  test("the same message five times is one row and one job (NFR-R2)", async () => {
    const one = message();
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await store([one]));
    }
    expect(results.map((result) => [result.stored, result.duplicates])).toEqual([
      [1, 0],
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(await rows("messages")).toHaveLength(1);
    expect(await rows("contacts")).toHaveLength(1);
    expect(await rows("conversations")).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  test("the same message five times at the same moment is still one row and one job", async () => {
    const one = message();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => store([one])));
    // A transaction that lost the race may fail and be sent again; none may store a second row.
    expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThan(0);
    expect(await rows("messages")).toHaveLength(1);
    expect(await rows("contacts")).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  test("the same message twice in one webhook is stored once", async () => {
    const one = message();
    expect(await store([one, one])).toMatchObject({ stored: 1, duplicates: 1 });
    expect(await jobs()).toHaveLength(1);
  });

  test("three messages of one customer in one webhook: three rows, one conversation, one job", async () => {
    expect(await store([message(), message(), message()])).toMatchObject({ stored: 3 });
    expect(await rows("messages")).toHaveLength(3);
    expect(await rows("conversations")).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  test("two customers in one webhook: two conversations and a job for each", async () => {
    await store([message(), message({ phone: "+15550143" })]);
    expect(await rows("contacts")).toHaveLength(2);
    expect(await jobs()).toHaveLength(2);
  });

  test("a message of a type that is not read is stored without a body, and still queues a job", async () => {
    await store([message({ kind: "unsupported", body: null })]);
    expect(await rows("messages")).toMatchObject([{ kind: "unsupported", body: null }]);
    expect(await jobs()).toHaveLength(1);
  });

  test("the same channel identifier in two tenants is two messages, each in its own tenant", async () => {
    const one = message();
    await store([one], "a");
    await store([one], "b");
    expect(await rows("messages", "a")).toHaveLength(1);
    expect(await rows("messages", "b")).toHaveLength(1);
    expect((await rows("contacts", "a"))[0]?.id).not.toBe((await rows("contacts", "b"))[0]?.id);
  });

  test("a receiving number that is not this tenant's is refused and nothing is stored", async () => {
    await expect(storeInbound(app, tenant.a, NUMBER.b, [message()], [])).rejects.toMatchObject({
      code: "no-channel-account",
    });
    expect(await rows("messages")).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  test("the message and its job are stored together or not at all", async () => {
    const migrate = await database.client(MIGRATE_ROLE);
    await migrate.query(`
      CREATE FUNCTION refuse_jobs() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'no jobs today'; END $$;
      CREATE TRIGGER refuse_jobs BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION refuse_jobs();`);
    try {
      await expect(store([message()])).rejects.toThrow("no jobs today");
    } finally {
      await migrate.query("DROP TRIGGER refuse_jobs ON jobs; DROP FUNCTION refuse_jobs();");
    }
    expect(await rows("messages")).toEqual([]);
    expect(await rows("contacts")).toEqual([]);
    expect(await rows("conversations")).toEqual([]);
  });
});

describe("storeInbound: who the customer is (issue #284)", () => {
  const ID = "US.10000000000000000042";

  test("a customer with no number is a contact known by the channel's identifier", async () => {
    await store([message({ phone: null, userId: ID })]);
    await store([message({ phone: null, userId: ID })]);
    expect(await rows("contacts")).toMatchObject([{ phone: null, channel_user_id: ID }]);
    expect(await rows("conversations")).toHaveLength(1);
    expect(await rows("messages")).toHaveLength(2);
  });

  test("a contact known by number gets the identifier when it first arrives, and stays one contact", async () => {
    await store([message({ phone: "+15550142", userId: null })]);
    await store([message({ phone: "+15550142", userId: ID })]);
    await store([message({ phone: null, userId: ID })]);
    expect(await rows("contacts")).toMatchObject([{ phone: "+15550142", channel_user_id: ID }]);
    expect(await rows("conversations")).toHaveLength(1);
  });

  test("a contact known by identifier gets the number when it first arrives", async () => {
    await store([message({ phone: null, userId: ID })]);
    await store([message({ phone: "+15550142", userId: ID })]);
    await store([message({ phone: "+15550142", userId: null })]);
    expect(await rows("contacts")).toMatchObject([{ phone: "+15550142", channel_user_id: ID }]);
    expect(await rows("messages")).toHaveLength(3);
  });

  test("the identifier wins: a number that already belongs to another contact is not moved", async () => {
    await store([message({ phone: "+15550142", userId: null })]);
    await store([message({ phone: null, userId: ID })]);
    // Now the identifier arrives together with the first contact's number.
    await store([message({ phone: "+15550142", userId: ID })]);
    const contacts = await rows("contacts");
    expect(contacts).toMatchObject([
      { phone: "+15550142", channel_user_id: null },
      { phone: null, channel_user_id: ID },
    ]);
    const messages = await rows("messages");
    const conversations = await rows("conversations");
    const byIdentifier = conversations.find((row) => row.contact_id === contacts[1]?.id);
    expect(messages[2]?.conversation_id, "the third message follows the identifier").toBe(
      byIdentifier?.id,
    );
  });

  test("two different identifiers are two contacts, and the same identifier in two tenants is two", async () => {
    await store([message({ phone: null, userId: ID })]);
    await store([message({ phone: null, userId: "US.10000000000000000043" })]);
    await store([message({ phone: null, userId: ID })], "b");
    expect(await rows("contacts", "a")).toHaveLength(2);
    expect(await rows("contacts", "b")).toHaveLength(1);
  });

  test("ten first messages of one new customer at the same moment end with one contact", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => store([message({ phone: "+15550150", userId: ID })])),
    );
    const failed = results.filter((result) => result.status === "rejected");
    expect(await rows("contacts")).toHaveLength(1);
    expect(await rows("conversations")).toHaveLength(1);
    expect(await rows("messages")).toHaveLength(10 - failed.length);
  });
});

describe("storeInbound: a status", () => {
  /** An outbound message as the worker will leave it, in a conversation made for the test. */
  async function outbound(status: string, id: string, key: "a" | "b" = "a"): Promise<void> {
    await store([message({ phone: "+15550199" })], key);
    const [conversation] = await rows("conversations", key);
    await withTenant(app, tenant[key], (tx) =>
      tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, channel_message_id, body, status)
         VALUES ($1, $2, 'outbound', 'assistant-reply', 'text', $3, 'reply', $4)`,
        [tenant[key], conversation?.id, id, status],
      ),
    );
  }
  const apply = (
    id: string,
    status: "sent" | "delivered" | "read" | "failed",
    key: "a" | "b" = "a",
  ) => storeInbound(app, tenant[key], NUMBER[key], [], [{ channelMessageId: id, status }]);
  const statusOf = async (id: string, key: "a" | "b" = "a") =>
    (await rows("messages", key)).find((row) => row.channel_message_id === id)?.status;

  test.each([
    ["sending", "sent", "sent"],
    ["sending", "delivered", "delivered"],
    ["sent", "delivered", "delivered"],
    ["sent", "read", "read"],
    ["delivered", "read", "read"],
    ["sent", "failed", "failed"],
    ["sending", "failed", "failed"],
    // Never backwards, and nothing after the end.
    ["delivered", "sent", "delivered"],
    ["read", "delivered", "read"],
    ["read", "sent", "read"],
    ["delivered", "failed", "delivered"],
    ["read", "failed", "read"],
    ["failed", "delivered", "failed"],
    ["failed", "read", "failed"],
    ["sent", "sent", "sent"],
    ["pending", "delivered", "pending"],
    ["withheld", "delivered", "withheld"],
  ] as const)(
    "a message that is %s and is reported %s is then %s",
    async (from, reported, then) => {
      await outbound(from, "wamid.OUT1");
      const result = await apply("wamid.OUT1", reported);
      expect(await statusOf("wamid.OUT1")).toBe(then);
      expect(result.statusesApplied).toBe(from === then ? 0 : 1);
      expect(await jobs(), "a status queues nothing").toHaveLength(1);
    },
  );

  test("a status for a message nobody sent changes nothing and is not an error", async () => {
    expect(await apply("wamid.NOBODY", "delivered")).toMatchObject({ statusesApplied: 0 });
  });

  test("a status never changes an inbound message, or another tenant's message", async () => {
    const inbound = message();
    await store([inbound]);
    await apply(inbound.channelMessageId, "read");
    expect(await statusOf(inbound.channelMessageId)).toBeNull();
    await outbound("sent", "wamid.OUT2", "b");
    expect(await apply("wamid.OUT2", "delivered", "a")).toMatchObject({ statusesApplied: 0 });
    expect(await statusOf("wamid.OUT2", "b")).toBe("sent");
  });
});

describe("events that reach no tenant", () => {
  const HASH = "a".repeat(64);
  const unparsed = (overrides: object = {}) =>
    recordUnparsed(cross, {
      channel: "whatsapp",
      payloadHash: HASH,
      sizeBytes: 120,
      errorCode: "not-json",
      itemsLeftOut: null,
      ...overrides,
    });

  test("an unreadable body is recorded by hash, size and code, and an operator alert is queued", async () => {
    expect(await unparsed()).toBe(true);
    const recorded = await cross.query("SELECT * FROM unparsed_events");
    expect(recorded.rows).toMatchObject([
      {
        channel: "whatsapp",
        payload_hash: HASH,
        size_bytes: 120,
        error_code: "not-json",
        items_left_out: null,
      },
    ]);
    expect(await jobs()).toEqual([
      {
        type: OPERATOR_ALERT_JOB,
        tenant_id: null,
        subject_id: null,
        payload: { unparsedEventId: recorded.rows[0]?.id },
      },
    ]);
  });

  test("the same body again is the same row and no second alert", async () => {
    expect(await unparsed()).toBe(true);
    expect(await unparsed()).toBe(false);
    expect(await unparsed({ errorCode: "bad-shape" })).toBe(false);
    expect((await cross.query("SELECT 1 FROM unparsed_events")).rowCount).toBe(1);
    expect(await jobs()).toHaveLength(1);
  });

  test("another body, and the same body on another channel, are rows of their own", async () => {
    await unparsed();
    await unparsed({ payloadHash: "b".repeat(64), errorCode: "malformed-items", itemsLeftOut: 2 });
    await unparsed({ channel: "mock" });
    const recorded = await cross.query(
      "SELECT items_left_out FROM unparsed_events ORDER BY received_at",
    );
    expect(recorded.rows.map((row) => row.items_left_out)).toEqual([null, 2, null]);
    expect(await jobs()).toHaveLength(3);
  });

  test.each([
    [{ payloadHash: "not a hash" }],
    [{ payloadHash: "+15550142" }],
    [{ errorCode: "the customer said hello" }],
    [{ sizeBytes: -1 }],
    [{ itemsLeftOut: 0 }],
    [{ channel: "Whats App" }],
  ])("the record cannot hold anything but its own kind of value: %j", async (wrong) => {
    await expect(unparsed(wrong)).rejects.toMatchObject({ code: "23514" });
    expect(await jobs()).toEqual([]);
  });

  test("an event for a number no tenant has is recorded once, by identifiers only", async () => {
    const event = {
      channel: "whatsapp",
      receivingNumberId: "999",
      channelMessageId: "wamid.STRANGER",
      kind: "message" as const,
    };
    await recordUnroutable(cross, event);
    await recordUnroutable(cross, event);
    await recordUnroutable(cross, { ...event, kind: "status" });
    const recorded = await cross.query(
      "SELECT channel, receiving_number_id, channel_message_id, kind FROM unroutable_events ORDER BY kind",
    );
    expect(recorded.rows).toEqual([
      {
        channel: "whatsapp",
        receiving_number_id: "999",
        channel_message_id: "wamid.STRANGER",
        kind: "message",
      },
      {
        channel: "whatsapp",
        receiving_number_id: "999",
        channel_message_id: "wamid.STRANGER",
        kind: "status",
      },
    ]);
    expect(await jobs()).toEqual([]);
  });

  test("the application role can read neither record", async () => {
    for (const table of ["unparsed_events", "unroutable_events"]) {
      const attempt = withTenant(app, tenant.a, (tx) => tx.query(`SELECT * FROM ${table}`));
      await expect(attempt).rejects.toMatchObject({ code: "42501" });
    }
  });
});
