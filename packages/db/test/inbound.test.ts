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
  closeDatabase,
  DATABASE_TIMEOUTS,
  type Database,
  type IncomingMessage,
  loadMigrations,
  MIGRATE_ROLE,
  messageAnswered,
  migrateDown,
  migrateUp,
  openDatabase,
  PROCESS_CONVERSATION_JOB,
  recordUnparsed,
  recordUnroutable,
  storeInbound,
  tenantOfReceivingNumber,
  withTenant,
} from "../src/index.ts";
import {
  adopt,
  createTestDatabase,
  MIGRATIONS_DIRECTORY,
  poolOf,
  type TestDatabase,
} from "./harness.ts";

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
    // Message by message this took over a second here; as one query, about ten milliseconds.
    expect(Date.now() - started).toBeLessThan(250);
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
      "a number that passed to another person: the newcomer is a new contact and the number goes with them",
      [
        [P1, U1],
        [P1, U2],
        [null, U2],
      ],
      [
        [null, U1, 1],
        [P1, U2, 2],
      ],
    ],
    [
      "the old holder keeps the conversation and is still reached by the identifier",
      [
        [P1, U1],
        [P1, U2],
        [null, U1],
      ],
      [
        [null, U1, 2],
        [P1, U2, 1],
      ],
    ],
    [
      "after a number has passed on, the number alone reaches its new holder",
      [
        [P1, U1],
        [P1, U2],
        [P1, null],
      ],
      [
        [null, U1, 1],
        [P1, U2, 2],
      ],
    ],
    [
      "two people who swap numbers each end with the number they now use",
      [
        [P1, U1],
        [P2, U2],
        [P2, U1],
        [P1, U2],
      ],
      [
        [P2, U1, 2],
        [P1, U2, 2],
      ],
    ],
    [
      "the verifier's sequence: no contact is left showing a number that is another person's",
      [
        [P1, U1],
        [P2, null],
        [P2, U1],
        [P1, U2],
        [P1, U2],
      ],
      [
        [null, U1, 2],
        [P2, null, 1],
        [P1, U2, 2],
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

  test("two identifiers arriving at once with one identifier-less contact's number: neither is overwritten", async () => {
    for (let round = 0; round < 15; round += 1) {
      await administrator.query("TRUNCATE messages, conversations, contacts, jobs CASCADE");
      await store([message({ phone: P1, userId: null })]);
      const settle = async (userId: string) => {
        // The loser of the race may be told to come again, as the channel would.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            return await store([message({ phone: P1, userId })]);
          } catch {}
        }
        throw new Error("never stored");
      };
      await Promise.all([settle(U1), settle(U2)]);
      const identifiers = (await rows("contacts")).map((row) => row.channel_user_id).sort();
      expect(identifiers, `round ${round}`).toEqual([U1, U2]);
    }
  }, 30_000);

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

describe("storeInbound: a tap and a caption (M3 unit U5, design note sections 3 and 4)", () => {
  const TAP = { kind: "button", body: null, buttonPayload: "core.stop" } as const;
  /** A message sent in the conversation of this customer; returns its row's id. */
  async function sent(
    channelMessageId: string | null,
    phone = "+15550142",
    key: "a" | "b" = "a",
  ): Promise<string> {
    await store([message({ phone })], key);
    const made = await withTenant(app, tenant[key], (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status)
         SELECT c.tenant_id, c.id, s.id, 'outbound', 'assistant-reply', 'text', $2, 'Choose', $3
         FROM conversations c
         JOIN contacts k ON k.id = c.contact_id
         JOIN sessions s ON s.conversation_id = c.id AND s.ended_at IS NULL
         WHERE k.phone = $1
         RETURNING id`,
        [phone, channelMessageId, channelMessageId === null ? "failed" : "sent"],
      ),
    );
    return made.rows[0]?.id as string;
  }
  /** Stores a tap and returns its row's id. */
  async function tap(overrides: Partial<IncomingMessage> = {}, key: "a" | "b" = "a") {
    const tapped = message({ ...TAP, ...overrides });
    await store([tapped], key);
    const found = await withTenant(app, tenant[key], (tx) =>
      tx.query<{ id: string }>(
        "SELECT id FROM messages WHERE direction = 'inbound' AND channel_message_id = $1",
        [tapped.channelMessageId],
      ),
    );
    return found.rows[0]?.id as string;
  }
  const answeredBy = (id: string, key: "a" | "b" = "a") => messageAnswered(appDb, tenant[key], id);
  const taps = async () =>
    (
      await withTenant(app, tenant.a, (tx) =>
        tx.query(
          "SELECT kind, body, button_payload, in_reply_to, caption_of FROM messages WHERE direction = 'inbound' AND kind <> 'text' OR caption_of IS NOT NULL ORDER BY created_at",
        ),
      )
    ).rows;

  test("M6: a tap is stored with what the button carried and what it answers, without a body, and queues a job", async () => {
    await tap({ inReplyTo: "wamid.OUT1" });
    expect(await taps()).toEqual([
      {
        kind: "button",
        body: null,
        button_payload: "core.stop",
        in_reply_to: "wamid.OUT1",
        caption_of: null,
      },
    ]);
    expect(await jobs()).toHaveLength(1);
  });

  test("M2: a caption is stored as a text that says what it was under; M1: a typed text says nothing", async () => {
    await store([
      message({ body: "Can you do this?", captionOf: "image" }),
      message({ body: "And this?", captionOf: "video" }),
      message({ body: "typed" }),
    ]);
    const stored = await withTenant(app, tenant.a, (tx) =>
      tx.query("SELECT kind, body, caption_of FROM messages ORDER BY body"),
    );
    expect(stored.rows).toEqual([
      { kind: "text", body: "And this?", caption_of: "video" },
      { kind: "text", body: "Can you do this?", caption_of: "image" },
      { kind: "text", body: "typed", caption_of: null },
    ]);
  });

  test("K1: a tap answers the message this conversation was sent", async () => {
    const id = await sent("wamid.OUT1");
    expect(await answeredBy(await tap({ inReplyTo: "wamid.OUT1" }))).toBe(id);
  });

  test("K2: not a message sent in another conversation of the same tenant", async () => {
    await sent("wamid.OUT1", "+15550177");
    expect(await answeredBy(await tap({ inReplyTo: "wamid.OUT1" }))).toBeNull();
  });

  test("K3: not another tenant's message, and another tenant cannot ask about this tap", async () => {
    const theirs = await sent("wamid.OUT1", "+15550142", "b");
    const mine = await tap({ inReplyTo: "wamid.OUT1" });
    expect(await answeredBy(mine)).toBeNull();
    expect(await answeredBy(mine, "b")).toBeNull();
    const own = await tap({ inReplyTo: "wamid.OUT1" }, "b");
    expect(await answeredBy(own, "b")).toBe(theirs);
  });

  test("K4 and K5: an identifier nothing has, and no identifier, answer nothing", async () => {
    await sent("wamid.OUT1");
    expect(await answeredBy(await tap({ inReplyTo: "wamid.NOBODY" }))).toBeNull();
    expect(await answeredBy(await tap({ inReplyTo: null }))).toBeNull();
    expect(await answeredBy(await tap())).toBeNull();
  });

  test("K6: not a message from the customer, even one with that identifier", async () => {
    const typed = message({ channelMessageId: "wamid.FROMCUSTOMER" });
    await store([typed]);
    expect(await answeredBy(await tap({ inReplyTo: "wamid.FROMCUSTOMER" }))).toBeNull();
  });

  test("K7: a message whose identifier is recorded after the tap is stored is found from then on", async () => {
    const id = await sent(null);
    const tapped = await tap({ inReplyTo: "wamid.LATE" });
    expect(await answeredBy(tapped)).toBeNull();
    await administrator.query(
      "UPDATE messages SET channel_message_id = 'wamid.LATE', status = 'sent' WHERE id = $1",
      [id],
    );
    expect(await answeredBy(tapped)).toBe(id);
  });

  test("K8: a message that never got an identifier is never matched", async () => {
    await sent(null);
    expect(await answeredBy(await tap({ inReplyTo: "wamid.NEVER" }))).toBeNull();
  });

  test("K9: the same button tapped twice is two messages, each answering the same one", async () => {
    const id = await sent("wamid.OUT1");
    const first = await tap({ inReplyTo: "wamid.OUT1" });
    const second = await tap({ inReplyTo: "wamid.OUT1" });
    expect(first).not.toBe(second);
    expect([await answeredBy(first), await answeredBy(second)]).toEqual([id, id]);
  });

  test("K10: one tap delivered twice is one row", async () => {
    const tapped = message({ ...TAP, inReplyTo: "wamid.OUT1" });
    await store([tapped]);
    await store([tapped]);
    expect(await taps()).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
  });

  test("asked about a message that is not a tap, or about nothing that exists, the answer is none", async () => {
    await sent("wamid.OUT1");
    const [typed] = await rows("messages");
    expect(await answeredBy(typed?.id as string)).toBeNull();
    expect(await answeredBy("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  test.each([
    ["a tap with no payload", { kind: "button", body: null }],
    [
      "a payload on a message that is not a tap",
      { kind: "image", body: null, buttonPayload: "core.stop" },
    ],
    ["a payload on a text", { buttonPayload: "core.stop" }],
    ["a tap with a body", { ...TAP, body: "Stop" }],
    ["a payload with a space", { ...TAP, buttonPayload: "core stop" }],
    ["an empty payload", { ...TAP, buttonPayload: "" }],
    ["a payload of 257 characters", { ...TAP, buttonPayload: "x".repeat(257) }],
    ["an answer on a message that is not a tap", { inReplyTo: "wamid.OUT1" }],
    ["an answered identifier with a space", { ...TAP, inReplyTo: "wamid OUT1" }],
    ["an answered identifier of 129 characters", { ...TAP, inReplyTo: "w".repeat(129) }],
    ["a caption of something else", { captionOf: "document" as never }],
    [
      "a caption on a message that is not a text",
      { kind: "image", body: null, captionOf: "image" },
    ],
    ["a caption on a tap", { ...TAP, captionOf: "image" }],
  ] as [string, Partial<IncomingMessage>][])(
    "the table refuses %s, and stores nothing of the webhook",
    async (_name, bad) => {
      await expect(store([message(), message(bad)])).rejects.toThrow(/check constraint/);
      expect(await rows("messages")).toEqual([]);
      expect(await jobs()).toEqual([]);
    },
  );

  test("the limits are met exactly: a payload of 256 and an answered identifier of 128", async () => {
    await tap({ buttonPayload: "x".repeat(256), inReplyTo: "w".repeat(128) });
    expect(await taps()).toHaveLength(1);
  });

  test("a sent message of kind button needs no payload, and may not have one", async () => {
    await store([message()]);
    const insert = (payload: string | null) =>
      administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body, status, button_payload)
         SELECT c.tenant_id, c.id, s.id, 'outbound', 'assistant-reply', 'button', 'Choose', 'pending', $1
         FROM conversations c JOIN sessions s ON s.conversation_id = c.id`,
        [payload],
      );
    await insert(null);
    await expect(insert("core.stop")).rejects.toThrow(/messages_tap_has_(payload|no_body)/);
  });
});

describe("migration 0008, with rows", () => {
  test("the way forward renames a customer's old `button` rows and leaves a sent one; the way back loses what a tap carried and keeps the rows", async () => {
    const scratch = await createTestDatabase({ migrate: true });
    const pool = new pg.Pool({ connectionString: scratch.url(APP_ROLE), max: 2 });
    try {
      const owner = await scratch.administrator();
      const client = await scratch.client(MIGRATE_ROLE);
      const all = loadMigrations(MIGRATIONS_DIRECTORY);
      const later = all.length - all.findIndex((migration) => migration.name === "taps") - 1;
      expect(later).toBeGreaterThanOrEqual(0);
      for (let step = 0; step < later; step += 1) {
        await migrateDown(client, all);
      }
      const made = await owner.query<{ id: string }>(
        `INSERT INTO tenants (name, pack, time_zone, default_language)
         VALUES ('Salon Noor', 'faq-only', 'UTC', 'en') RETURNING id`,
      );
      const id = made.rows[0]?.id as string;
      await owner.query(
        "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'whatsapp', $2)",
        [id, NUMBER.a],
      );
      const scratchDb = adopt(APP_ROLE, pool);
      await storeInbound(
        scratchDb,
        id,
        NUMBER.a,
        [
          message({
            channelMessageId: "wamid.TAP",
            kind: "button",
            body: null,
            buttonPayload: "core.stop",
            inReplyTo: "wamid.OUT1",
          }),
          message({ channelMessageId: "wamid.CAPTION", body: "This style?", captionOf: "image" }),
        ],
        [],
      );
      const kinds = async () =>
        (
          await owner.query(
            "SELECT channel_message_id AS id, direction, kind, body FROM messages ORDER BY channel_message_id",
          )
        ).rows;

      expect(await migrateDown(client, all)).toBe("taps");
      expect(await kinds()).toEqual([
        { id: "wamid.CAPTION", direction: "inbound", kind: "text", body: "This style?" },
        { id: "wamid.TAP", direction: "inbound", kind: "button", body: null },
      ]);
      // As it could be before 0008: a customer's row and a sent one, both of kind `button`.
      await owner.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status)
         SELECT tenant_id, conversation_id, session_id, 'outbound', 'assistant-reply', 'button', 'wamid.OUT1', 'Choose', 'sent'
         FROM messages WHERE channel_message_id = 'wamid.TAP'`,
      );

      await migrateUp(client, all);
      expect(await kinds()).toEqual([
        { id: "wamid.CAPTION", direction: "inbound", kind: "text", body: "This style?" },
        { id: "wamid.OUT1", direction: "outbound", kind: "button", body: "Choose" },
        { id: "wamid.TAP", direction: "inbound", kind: "quick-reply", body: null },
      ]);
      expect(
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM messages WHERE button_payload IS NOT NULL OR in_reply_to IS NOT NULL OR caption_of IS NOT NULL",
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await pool.end();
      await scratch.drop();
    }
  }, 30_000);
});

describe("storeInbound: a status", () => {
  /** An outbound message as the worker will leave it, in a conversation made for the test. */
  async function outbound(status: string, id: string, key: "a" | "b" = "a"): Promise<void> {
    await store([message({ phone: "+15550199" })], key);
    const [conversation] = await rows("conversations", key);
    await withTenant(app, tenant[key], (tx) =>
      tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status, sending_at)
         VALUES ($1, $2, (SELECT id FROM sessions WHERE conversation_id = $2 AND ended_at IS NULL),
                 'outbound', 'assistant-reply', 'text', $3, 'reply', $4,
                 CASE WHEN $4 = 'sending' THEN clock_timestamp() END)`,
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

  test("a failure's code has a plain form, or the row is refused", async () => {
    await outbound("sent", "wamid.OUT1");
    const set = (code: string) =>
      administrator.query("UPDATE messages SET error_code = $1", [code]).then(
        () => "stored",
        (error: { code?: string }) => error.code,
      );
    expect(await set("131026")).toBe("stored");
    expect(await set("has a space")).toBe("23514");
    expect(await set("x".repeat(41))).toBe("23514");
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

describe("a handle opened for the product carries its time limits", () => {
  test("each limit is set on the connection, and a statement over its limit is stopped", async () => {
    const limited = openDatabase(APP_ROLE, database.url(APP_ROLE), { max: 1 });
    try {
      const pool = poolOf(limited);
      const shown = await pool.query<{ statement: string; lock: string; idle: string }>(
        `SELECT current_setting('statement_timeout') AS statement,
                current_setting('lock_timeout') AS lock,
                current_setting('idle_in_transaction_session_timeout') AS idle`,
      );
      expect(shown.rows[0]).toEqual({ statement: "4s", lock: "3s", idle: "10s" });
      expect(pool.options.connectionTimeoutMillis).toBe(DATABASE_TIMEOUTS.connectMs);
      const started = Date.now();
      await expect(pool.query("SELECT pg_sleep(8)")).rejects.toMatchObject({ code: "57014" });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await closeDatabase(limited);
    }
  }, 15_000);
});
