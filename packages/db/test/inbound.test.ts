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
  type Database,
  type IncomingMessage,
  MIGRATE_ROLE,
  PROCESS_CONVERSATION_JOB,
  recordUnparsed,
  recordUnroutable,
  storeInbound,
  tenantOfReceivingNumber,
  withTenant,
} from "../src/index.ts";
import { adopt, createTestDatabase, type TestDatabase } from "./harness.ts";

let database: TestDatabase;
let app: pg.Pool;
let cross: pg.Client;
let appDb: Database;
let crossDb: Database;
let crossPool: pg.Pool;
let administrator: pg.Client;
const tenant = { a: "", b: "" };
const NUMBER = { a: "100000000000002", b: "100000000000004" };

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  cross = await database.client(CROSS_ROLE);
  crossPool = new pg.Pool({ connectionString: database.url(CROSS_ROLE), max: 2 });
  appDb = adopt(APP_ROLE, app);
  crossDb = adopt(CROSS_ROLE, crossPool);
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
  await crossPool.end();
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
    sentAt: new Date("2026-11-18T10:00:00.000Z"),
    ...overrides,
  };
}

const store = (messages: IncomingMessage[], key: "a" | "b" = "a") =>
  storeInbound(appDb, tenant[key], NUMBER[key], messages, []);

/** The columns the tests read by name; a row has more. */
interface Row {
  id: string;
  phone: string | null;
  channel_user_id: string | null;
  created_at: Date;
  error_code: string | null;
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
    expect(await tenantOfReceivingNumber(crossDb, NUMBER.a)).toBe(tenant.a);
    expect(await tenantOfReceivingNumber(crossDb, NUMBER.b)).toBe(tenant.b);
    expect(await tenantOfReceivingNumber(crossDb, "999")).toBeUndefined();
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
      channel_sent_at: new Date("2026-11-18T10:00:00.000Z"),
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

  test("messages of one webhook keep the order they came in", async () => {
    const batch = [message({ body: "one" }), message({ body: "two" }), message({ body: "three" })];
    await store(batch);
    const stored = await withTenant(app, tenant.a, (tx) =>
      tx.query<{ body: string; created_at: Date }>(
        "SELECT body, created_at FROM messages ORDER BY created_at",
      ),
    );
    expect(stored.rows.map((row) => row.body)).toEqual(["one", "two", "three"]);
    // Counted by the database: its times are finer than a millisecond.
    const distinct = await withTenant(app, tenant.a, (tx) =>
      tx.query<{ n: number }>("SELECT count(DISTINCT created_at)::int AS n FROM messages"),
    );
    expect(distinct.rows[0]?.n).toBe(3);
  });

  test("a large webhook sent again is recognised at once, not message by message", async () => {
    const batch = Array.from({ length: 1_500 }, (_, index) =>
      message({ phone: `+1555${String(2_000_000 + (index % 50))}` }),
    );
    expect(await store(batch)).toMatchObject({ stored: 1_500, duplicates: 0 });
    const started = Date.now();
    expect(await store(batch)).toEqual({ stored: 0, duplicates: 1_500, statusesApplied: 0 });
    // The first pass takes seconds; the second is one query.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await jobs()).toHaveLength(50);
  }, 60_000);

  test("a message of a type that is not read is stored without a body, and still queues a job", async () => {
    await store([message({ kind: "image", body: null })]);
    expect(await rows("messages")).toMatchObject([{ kind: "image", body: null }]);
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
    await expect(storeInbound(appDb, tenant.a, NUMBER.b, [message()], [])).rejects.toMatchObject({
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

describe("storeInbound: who the customer is (data model, decision 16)", () => {
  const U1 = "US.10000000000000000042";
  const U2 = "US.10000000000000000043";
  const P1 = "+15550142";
  const P2 = "+15550143";
  type Customer = readonly [string | null, string | null];
  /** Stores one message from each given customer, in order, and returns the contacts as [phone, identifier, messages]. */
  async function after(customers: readonly Customer[]): Promise<unknown[]> {
    for (const [phone, userId] of customers) {
      await store([message({ phone, userId })]);
    }
    const contacts = await rows("contacts");
    const conversations = await rows("conversations");
    const messages = await rows("messages");
    return contacts.map((contact) => {
      const conversation = conversations.find((row) => row.contact_id === contact.id);
      const count = messages.filter((row) => row.conversation_id === conversation?.id).length;
      return [contact.phone, contact.channel_user_id, count];
    });
  }

  const cases: [string, Customer[], unknown[]][] = [
    [
      "a number only, twice: one contact",
      [
        [P1, null],
        [P1, null],
      ],
      [[P1, null, 2]],
    ],
    [
      "an identifier only, twice: one contact with no number",
      [
        [null, U1],
        [null, U1],
      ],
      [[null, U1, 2]],
    ],
    [
      "both, twice: one contact",
      [
        [P1, U1],
        [P1, U1],
      ],
      [[P1, U1, 2]],
    ],
    [
      "known by number, then the identifier arrives with it: the contact takes the identifier",
      [
        [P1, null],
        [P1, U1],
        [null, U1],
      ],
      [[P1, U1, 3]],
    ],
    [
      "known by identifier, then the number arrives with it: the contact takes the number",
      [
        [null, U1],
        [P1, U1],
        [P1, null],
      ],
      [[P1, U1, 3]],
    ],
    [
      "the person changes number: the contact follows the identifier and takes the new number",
      [
        [P1, U1],
        [P2, U1],
        [P2, null],
      ],
      [[P2, U1, 3]],
    ],
    [
      "a number that passed to another person: the newcomer is a new contact, without the number",
      [
        [P1, U1],
        [P1, U2],
        [null, U2],
      ],
      [
        [P1, U1, 1],
        [null, U2, 2],
      ],
    ],
    [
      "the old holder is not displaced, and is still reached by the identifier",
      [
        [P1, U1],
        [P1, U2],
        [null, U1],
      ],
      [
        [P1, U1, 2],
        [null, U2, 1],
      ],
    ],
    [
      "the reviewer's sequence: nobody's message joins another person's conversation",
      [
        [P1, U1],
        [P2, U1],
        [P1, U2],
        [P2, U1],
      ],
      [
        [P2, U1, 3],
        [P1, U2, 1],
      ],
    ],
    [
      "an identifier that arrives with a number another contact holds: the two stay apart",
      [
        [P1, null],
        [null, U1],
        [P1, U1],
      ],
      [
        [P1, null, 1],
        [null, U1, 2],
      ],
    ],
    [
      "a number alone, held by a contact with an identifier: that contact",
      [
        [P1, U1],
        [P1, null],
      ],
      [[P1, U1, 2]],
    ],
    [
      "two identifiers: two contacts",
      [
        [null, U1],
        [null, U2],
      ],
      [
        [null, U1, 1],
        [null, U2, 1],
      ],
    ],
  ];

  test.each(cases)("%s", async (_what, customers, contacts) => {
    expect(await after(customers)).toEqual(contacts);
  });

  test("the same identifier in two tenants is two contacts, and one per tenant however often it comes", async () => {
    await store([message({ phone: null, userId: U1 })], "a");
    await store([message({ phone: null, userId: U1 })], "b");
    await store([message({ phone: null, userId: U1 })], "b");
    expect(await rows("contacts", "a")).toHaveLength(1);
    expect(await rows("contacts", "b")).toHaveLength(1);
  });

  test("an identifier is unique in a tenant whatever number stands beside it, and has a plain form", async () => {
    const insert = (userId: string, phone: string | null) =>
      withTenant(app, tenant.a, (tx) =>
        tx.query("INSERT INTO contacts (tenant_id, phone, channel_user_id) VALUES ($1, $2, $3)", [
          tenant.a,
          phone,
          userId,
        ]),
      ).then(
        () => "stored",
        (error: { code?: string }) => error.code,
      );
    expect(await insert(U1, P1)).toBe("stored");
    expect(await insert(U1, P2)).toBe("23505");
    expect(await insert(U1, null)).toBe("23505");
    expect(await insert("has a space", null)).toBe("23514");
    expect(await insert("", null)).toBe("23514");
  });

  test("ten first messages of one new customer at the same moment end with one contact", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => store([message({ phone: "+15550150", userId: U1 })])),
    );
    const failed = results.filter((result) => result.status === "rejected");
    expect(await rows("contacts")).toHaveLength(1);
    expect(await rows("conversations")).toHaveLength(1);
    expect(await rows("messages")).toHaveLength(10 - failed.length);
  });

  test("a contact made by another transaction between the look and the insert is found on the second look", async () => {
    // The administrator holds an uncommitted insert of the same customer; the store waits for it.
    await administrator.query("BEGIN");
    await administrator.query(
      "INSERT INTO contacts (tenant_id, phone, channel_user_id) VALUES ($1, $2, $3)",
      [tenant.a, "+15550151", U2],
    );
    const pending = store([message({ phone: "+15550151", userId: U2 })]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await administrator.query("COMMIT");
    expect(await pending).toMatchObject({ stored: 1 });
    expect(await rows("contacts")).toHaveLength(1);
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
  ) =>
    storeInbound(
      appDb,
      tenant[key],
      NUMBER[key],
      [],
      [{ channelMessageId: id, status, errorCode: status === "failed" ? "131026" : null }],
    );
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
    ["sending", "read", "read"],
    ["pending", "delivered", "pending"],
    ["pending", "sent", "pending"],
    ["held", "sent", "held"],
    ["withheld", "delivered", "withheld"],
    ["discarded", "read", "discarded"],
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

  test("a failed status keeps the channel's code; no other status has one", async () => {
    await outbound("sent", "wamid.OUT1");
    await apply("wamid.OUT1", "failed");
    const failed = (await rows("messages")).find((row) => row.channel_message_id === "wamid.OUT1");
    expect(failed).toMatchObject({ status: "failed", error_code: "131026" });
    await administrator.query("TRUNCATE messages, conversations, contacts, jobs CASCADE");
    await outbound("sent", "wamid.OUT1");
    await apply("wamid.OUT1", "delivered");
    const delivered = (await rows("messages")).find(
      (row) => row.channel_message_id === "wamid.OUT1",
    );
    expect(delivered).toMatchObject({ status: "delivered", error_code: null });
  });

  test("a customer's message with the identifier of a sent message is a message, not a duplicate", async () => {
    await outbound("sent", "wamid.SHARED");
    expect(await store([message({ channelMessageId: "wamid.SHARED" })])).toMatchObject({
      stored: 1,
      duplicates: 0,
    });
    // And a status for that identifier moves the sent one only.
    await apply("wamid.SHARED", "delivered");
    const both = (await rows("messages")).filter(
      (row) => row.channel_message_id === "wamid.SHARED",
    );
    expect(both.map((row) => row.status).sort()).toEqual(["delivered", null]);
  });

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
    recordUnparsed(crossDb, {
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
    const due = await cross.query<{ late: number }>(
      "SELECT extract(epoch FROM run_at - clock_timestamp())::float AS late FROM jobs",
    );
    expect(due.rows[0]?.late, "the alert is due at once").toBeLessThanOrEqual(0);
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
    await recordUnroutable(crossDb, event);
    await recordUnroutable(crossDb, event);
    await recordUnroutable(crossDb, { ...event, kind: "status" });
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
