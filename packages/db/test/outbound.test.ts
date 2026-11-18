// A turn and a send, at the level of the database (M2 unit U8). The worker's
// own tests, in `apps/worker`, run the same functions through the queue.

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  abandonTurn,
  beginTurn,
  claimNextSend,
  type Database,
  finishTurn,
  loadMigrations,
  MIGRATE_ROLE,
  migrateDown,
  migrateUp,
  recordSend,
  SEND_MESSAGES_JOB,
  storeInbound,
  withTenant,
} from "../src/index.ts";
import {
  adopt,
  createTestDatabase,
  MIGRATIONS_DIRECTORY,
  sqlState,
  type TestDatabase,
} from "./harness.ts";

let database: TestDatabase;
let pool: pg.Pool;
let app: Database;
let administrator: pg.Client;
const tenant = { a: "", b: "" };
const NUMBER = { a: "100000000000002", b: "100000000000004" };

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  pool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  app = adopt(APP_ROLE, pool);
  administrator = await database.administrator();
  for (const key of ["a", "b"] as const) {
    const made = await administrator.query<{ id: string }>(
      `INSERT INTO tenants (name, pack, time_zone, default_language)
       VALUES ($1, 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
      [`Tenant ${key}`],
    );
    tenant[key] = made.rows[0]?.id as string;
    await administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [tenant[key], NUMBER[key]],
    );
  }
}, 30_000);

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query("TRUNCATE messages, conversations, contacts, jobs CASCADE");
});

let serial = 0;
/** A customer's message arrives; returns the conversation. */
async function arrives(body: string, key: "a" | "b" = "a"): Promise<string> {
  serial += 1;
  await storeInbound(
    app,
    tenant[key],
    NUMBER[key],
    [
      {
        channelMessageId: `wamid.OUT${serial}`,
        phone: "+15550142",
        userId: "US.10000000000000000042",
        kind: "text",
        body,
        sentAt: new Date("2026-11-19T10:00:00.000Z"),
      },
    ],
    [],
  );
  const found = await withTenant(pool, tenant[key], (tx) =>
    tx.query<{ id: string }>("SELECT id FROM conversations"),
  );
  return found.rows[0]?.id as string;
}

const count = async (where: string): Promise<number> =>
  (await administrator.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${where}`)).rows[0]
    ?.n as number;

/** Runs one whole turn with this reply. */
async function answered(conversation: string, reply: string): Promise<void> {
  const turn = await beginTurn(app, tenant.a, conversation);
  if (turn.busy) {
    throw new Error("busy");
  }
  await finishTurn(
    app,
    tenant.a,
    conversation,
    turn.token,
    turn.messages.map((message) => message.id),
    reply,
  );
}

describe("a turn", () => {
  test("reads what the customer wrote and no turn has dealt with, oldest first, and holds the conversation", async () => {
    const conversation = await arrives("one");
    await arrives("two");
    const turn = await beginTurn(app, tenant.a, conversation);
    expect(turn).toMatchObject({
      busy: false,
      messages: [
        { kind: "text", body: "one" },
        { kind: "text", body: "two" },
      ],
    });
    expect(await beginTurn(app, tenant.a, conversation)).toEqual({ busy: true });
  });

  test("ends by marking the messages, storing the reply to send, queueing its job and freeing the conversation, together", async () => {
    const conversation = await arrives("one");
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    await administrator.query("DELETE FROM jobs");
    const ids = turn.messages.map((message) => message.id);
    expect(await finishTurn(app, tenant.a, conversation, turn.token, ids, "a reply")).toBe(
      "stored",
    );
    expect(await count("messages WHERE direction = 'inbound' AND handled_at IS NOT NULL")).toBe(1);
    expect(
      await count(
        "messages WHERE direction = 'outbound' AND class = 'assistant-reply' AND status = 'pending' AND body = 'a reply'",
      ),
    ).toBe(1);
    const queued = await administrator.query(
      "SELECT type, tenant_id, subject_id, payload FROM jobs",
    );
    expect(queued.rows).toEqual([
      {
        type: SEND_MESSAGES_JOB,
        tenant_id: tenant.a,
        subject_id: conversation,
        payload: { conversationId: conversation },
      },
    ]);
    expect(await count("conversations WHERE lease_token IS NOT NULL")).toBe(0);
    // A second turn finds nothing to answer.
    expect(await beginTurn(app, tenant.a, conversation)).toMatchObject({
      busy: false,
      messages: [],
    });
  });

  test("with no reply, only marks the messages and queues nothing", async () => {
    const conversation = await arrives("one");
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    await administrator.query("DELETE FROM jobs");
    const ids = turn.messages.map((message) => message.id);
    expect(await finishTurn(app, tenant.a, conversation, turn.token, ids, undefined)).toBe(
      "stored",
    );
    expect(await count("messages WHERE handled_at IS NOT NULL")).toBe(1);
    expect(await count("messages WHERE direction = 'outbound'")).toBe(0);
    expect(await count("jobs")).toBe(0);
  });

  test("stores nothing when another worker has taken the conversation meanwhile", async () => {
    const conversation = await arrives("one");
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    // The lease ran out and another worker took it.
    const later = new Date(Date.now() + 10 * 60_000);
    const other = await beginTurn(app, tenant.a, conversation, later);
    expect(other.busy).toBe(false);
    const ids = turn.messages.map((message) => message.id);
    expect(await finishTurn(app, tenant.a, conversation, turn.token, ids, "late")).toBe(
      "lost-lease",
    );
    expect(await count("messages WHERE direction = 'outbound'")).toBe(0);
    expect(await count("messages WHERE handled_at IS NOT NULL")).toBe(0);
    // And the other worker's lease is untouched.
    expect(await count("conversations WHERE lease_token IS NOT NULL")).toBe(1);
  });

  test("drops the reply when the customer wrote again meanwhile, and frees the conversation for the next turn", async () => {
    const conversation = await arrives("one");
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    await arrives("two");
    const ids = turn.messages.map((message) => message.id);
    expect(await finishTurn(app, tenant.a, conversation, turn.token, ids, "to one only")).toBe(
      "newer-message",
    );
    expect(await count("messages WHERE direction = 'outbound'")).toBe(0);
    expect(await count("messages WHERE handled_at IS NOT NULL")).toBe(0);
    const next = await beginTurn(app, tenant.a, conversation);
    expect(next).toMatchObject({ busy: false, messages: [{ body: "one" }, { body: "two" }] });
  });

  test("can be given up: the conversation is free at once, and nothing is stored", async () => {
    const conversation = await arrives("one");
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    // Not with another's token, nor from another tenant.
    await abandonTurn(app, tenant.a, conversation, "00000000-0000-4000-8000-000000000000");
    await abandonTurn(app, tenant.b, conversation, turn.token);
    expect(await beginTurn(app, tenant.a, conversation)).toEqual({ busy: true });
    await abandonTurn(app, tenant.a, conversation, turn.token);
    expect(await beginTurn(app, tenant.a, conversation)).toMatchObject({
      busy: false,
      messages: [{ body: "one" }],
    });
  });

  test("cannot be begun or ended for another tenant's conversation", async () => {
    const conversation = await arrives("one", "a");
    await expect(beginTurn(app, tenant.b, conversation)).rejects.toMatchObject({
      code: "conversation-not-found",
    });
    const turn = await beginTurn(app, tenant.a, conversation);
    if (turn.busy) {
      throw new Error("busy");
    }
    const ids = turn.messages.map((message) => message.id);
    expect(await finishTurn(app, tenant.b, conversation, turn.token, ids, "x")).toBe("lost-lease");
    expect(await count("messages WHERE direction = 'outbound'")).toBe(0);
  });
});

describe("a send", () => {
  test("claims the oldest waiting message with who it is for and where from, and counts the call", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const next = await claimNextSend(app, tenant.a, conversation);
    expect(next).toEqual({
      kind: "send",
      message: {
        id: expect.any(String),
        attempt: 1,
        class: "assistant-reply",
        kind: "text",
        body: "the reply",
        to: { phone: "+15550142", userId: "US.10000000000000000042" },
        channel: "mock",
        receivingNumberId: NUMBER.a,
      },
    });
    expect(
      await count(
        "messages WHERE status = 'sending' AND send_attempts = 1 AND sending_at IS NOT NULL",
      ),
    ).toBe(1);
  });

  test("is nothing when nothing waits; for another tenant's conversation it is a fault, not nothing", async () => {
    const conversation = await arrives("one");
    expect(await claimNextSend(app, tenant.a, conversation)).toEqual({ kind: "none" });
    await answered(conversation, "the reply");
    await expect(claimNextSend(app, tenant.b, conversation)).rejects.toMatchObject({
      code: "conversation-not-found",
    });
    expect(await count("messages WHERE status = 'pending'")).toBe(1);
  });

  test("a result for a message that is not being sent changes nothing", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const waiting = await administrator.query<{ id: string }>(
      "SELECT id FROM messages WHERE status = 'pending'",
    );
    const id = waiting.rows[0]?.id as string;
    expect(
      await recordSend(
        app,
        tenant.a,
        { id, attempt: 0 },
        { kind: "accepted", channelMessageId: "x" },
      ),
    ).toBe("superseded");
    expect(await count("messages WHERE status = 'pending' AND channel_message_id IS NULL")).toBe(1);
  });

  test("a message that has waited over fifteen minutes is not sent: expired, and the next one goes", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "old");
    const stored = new Date();
    const edge = await claimNextSend(
      app,
      tenant.a,
      conversation,
      new Date(stored.getTime() + 14 * 60_000),
    );
    expect(edge).toMatchObject({ kind: "send", message: { body: "old" } });
    await administrator.query(
      "UPDATE messages SET status = 'pending', sending_at = NULL, send_attempts = 0 WHERE direction = 'outbound'",
    );
    await arrives("two");
    await administrator.query(
      "UPDATE messages SET created_at = created_at - interval '16 minutes' WHERE direction = 'outbound'",
    );
    await answered(conversation, "new");
    expect(await claimNextSend(app, tenant.a, conversation)).toMatchObject({
      kind: "send",
      message: { body: "new" },
    });
    expect(
      await count(
        "messages WHERE body = 'old' AND status = 'failed' AND error_code = 'expired' AND send_attempts = 0",
      ),
    ).toBe(1);
  });

  test("a message put off to a later time is counted from that time, and a refused one that then waits too long is expired", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    await administrator.query(
      "UPDATE messages SET send_not_before = clock_timestamp() + interval '20 minutes' WHERE direction = 'outbound'",
    );
    const start = Date.now();
    // Four minutes before it is due, sixteen after it was stored: it waits, and is not expired.
    expect(
      await claimNextSend(app, tenant.a, conversation, new Date(start + 16 * 60_000)),
    ).toMatchObject({ kind: "wait" });
    expect(
      await claimNextSend(app, tenant.a, conversation, new Date(start + 21 * 60_000)),
    ).toMatchObject({ kind: "send", message: { attempt: 1 } });
    // Refused for now, and then nobody looks for sixteen minutes: expired, though it was called for once.
    const waiting = await administrator.query<{ id: string }>(
      "SELECT id FROM messages WHERE status = 'sending'",
    );
    await recordSend(
      app,
      tenant.a,
      { id: waiting.rows[0]?.id as string, attempt: 1 },
      { kind: "refused", retryable: true, code: "rate-limited" },
      new Date(start + 21 * 60_000),
    );
    expect(await claimNextSend(app, tenant.a, conversation, new Date(start + 40 * 60_000))).toEqual(
      { kind: "none", ended: ["expired"] },
    );
    expect(
      await count(
        "messages WHERE status = 'failed' AND error_code = 'expired' AND send_attempts = 1",
      ),
    ).toBe(1);
  });

  test("a reply left being sent by a worker that stopped long ago is not called for again", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const start = new Date();
    await claimNextSend(app, tenant.a, conversation, start);
    expect(
      await claimNextSend(app, tenant.a, conversation, new Date(start.getTime() + 16 * 60_000)),
    ).toEqual({ kind: "none", ended: ["unconfirmed"] });
    expect(
      await count(
        "messages WHERE status = 'failed' AND error_code = 'unconfirmed' AND send_attempts = 1 AND unknown_outcomes = 1",
      ),
    ).toBe(1);
  });

  test("a call under way and not yet stale is left alone however old the message is", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    await administrator.query(
      "UPDATE messages SET created_at = created_at - interval '16 minutes' WHERE direction = 'outbound'",
    );
    await administrator.query(
      "UPDATE messages SET status = 'sending', sending_at = clock_timestamp(), send_attempts = 1 WHERE direction = 'outbound'",
    );
    expect(await claimNextSend(app, tenant.a, conversation)).toMatchObject({ kind: "wait" });
    expect(await count("messages WHERE status = 'sending'")).toBe(1);
  });

  test("a notice found stale is ended unconfirmed, and the look says so", async () => {
    const conversation = await arrives("one");
    await administrator.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, body, status, sending_at, send_attempts)
       SELECT tenant_id, id, 'outbound', 'service-notice', 'text', 'a notice', 'sending', clock_timestamp() - interval '3 minutes', 1
       FROM conversations`,
    );
    expect(await claimNextSend(app, tenant.a, conversation)).toEqual({
      kind: "none",
      ended: ["unconfirmed"],
    });
  });

  test("an old message the channel may already have is unconfirmed, not expired, and is not called for again", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "old");
    // Waiting to be called again after an unknown outcome.
    await administrator.query(
      `UPDATE messages SET send_attempts = 1, unknown_outcomes = 1,
                           send_not_before = clock_timestamp() - interval '16 minutes',
                           created_at = created_at - interval '17 minutes'
       WHERE direction = 'outbound'`,
    );
    expect(await claimNextSend(app, tenant.a, conversation)).toEqual({
      kind: "none",
      ended: ["unconfirmed"],
    });
    expect(await count("messages WHERE status = 'failed' AND error_code = 'unconfirmed'")).toBe(1);
    // And one found being sent, by a worker that stopped long ago: the same, even for a reply.
    await administrator.query(
      `UPDATE messages SET status = 'sending', sending_at = clock_timestamp() - interval '16 minutes',
                           unknown_outcomes = 0, error_code = NULL
       WHERE direction = 'outbound'`,
    );
    expect(await claimNextSend(app, tenant.a, conversation)).toEqual({
      kind: "none",
      ended: ["unconfirmed"],
    });
    expect(
      await count(
        "messages WHERE status = 'failed' AND error_code = 'unconfirmed' AND send_attempts = 1 AND unknown_outcomes = 1",
      ),
    ).toBe(1);
  });

  test("accepted: sent, with the channel's identifier and the time", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const next = await claimNextSend(app, tenant.a, conversation);
    if (next.kind !== "send") {
      throw new Error("nothing to send");
    }
    expect(
      await recordSend(app, tenant.a, next.message, {
        kind: "accepted",
        channelMessageId: "mock.7",
      }),
    ).toEqual({ next: "sent" });
    expect(
      await count(
        "messages WHERE status = 'sent' AND channel_message_id = 'mock.7' AND sent_at IS NOT NULL AND sending_at IS NULL",
      ),
    ).toBe(1);
  });

  test("a result for a call that is no longer the current one changes nothing", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const first = await claimNextSend(app, tenant.a, conversation);
    if (first.kind !== "send") {
      throw new Error("nothing to send");
    }
    // Three minutes on, the call is taken as lost and the message is sent once more.
    const later = new Date(Date.now() + 3 * 60_000);
    const second = await claimNextSend(app, tenant.a, conversation, later);
    expect(second).toMatchObject({ kind: "send", message: { attempt: 2 } });
    expect(
      await recordSend(app, tenant.a, first.message, {
        kind: "accepted",
        channelMessageId: "late",
      }),
    ).toBe("superseded");
    expect(
      await count(
        "messages WHERE status = 'sending' AND send_attempts = 2 AND unknown_outcomes = 1",
      ),
    ).toBe(1);
    // Nor can another tenant record a result for it.
    if (second.kind === "send") {
      expect(
        await recordSend(app, tenant.b, second.message, {
          kind: "accepted",
          channelMessageId: "x",
        }),
      ).toBe("superseded");
    }
  });

  test("a call under way says how long until it may be taken as lost: two minutes from its start", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const start = new Date();
    await claimNextSend(app, tenant.a, conversation, start);
    const soon = await claimNextSend(
      app,
      tenant.a,
      conversation,
      new Date(start.getTime() + 30_000),
    );
    expect(soon).toEqual({ kind: "wait", ms: 90_000 });
    const edge = await claimNextSend(
      app,
      tenant.a,
      conversation,
      new Date(start.getTime() + 119_999),
    );
    expect(edge).toEqual({ kind: "wait", ms: 1 });
    const over = await claimNextSend(
      app,
      tenant.a,
      conversation,
      new Date(start.getTime() + 120_000),
    );
    expect(over).toMatchObject({ kind: "send", message: { attempt: 2 } });
  });

  test("a refusal that can be retried says how long to wait, and the message goes no sooner", async () => {
    const conversation = await arrives("one");
    await answered(conversation, "the reply");
    const start = new Date();
    const next = await claimNextSend(app, tenant.a, conversation, start);
    if (next.kind !== "send") {
      throw new Error("nothing to send");
    }
    expect(
      await recordSend(
        app,
        tenant.a,
        next.message,
        { kind: "refused", retryable: true, code: "rate-limited" },
        start,
      ),
    ).toEqual({ next: "retry", waitMs: 2_000 });
    expect(
      await claimNextSend(app, tenant.a, conversation, new Date(start.getTime() + 500)),
    ).toEqual({
      kind: "wait",
      ms: 1_500,
    });
    expect(
      await claimNextSend(app, tenant.a, conversation, new Date(start.getTime() + 2_000)),
    ).toMatchObject({ kind: "send", message: { attempt: 2 } });
  });
});

describe("what the database itself refuses", () => {
  const insert = (columns: string, values: string) =>
    sqlState(
      administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, status, ${columns})
         SELECT tenant_id, id, 'outbound', 'system-reply', 'text', ${values} FROM conversations`,
      ),
    );

  test("a message being sent without the time the call started, or the time without the status", async () => {
    await arrives("one");
    expect(await insert("send_attempts", "'sending', 1")).toBe("23514");
    expect(await insert("sending_at", "'pending', now()")).toBe("23514");
    expect(await insert("sending_at, send_attempts", "'sending', now(), 1")).toBe("none");
  });

  test("more unknown outcomes than calls, or a negative count", async () => {
    await arrives("one");
    expect(await insert("send_attempts, unknown_outcomes", "'pending', 1, 2")).toBe("23514");
    expect(await insert("send_attempts", "'pending', -1")).toBe("23514");
    expect(await insert("unknown_outcomes", "'pending', -1")).toBe("23514");
  });

  test("a sent message marked as dealt with: that is for the customer's messages", async () => {
    await arrives("one");
    expect(await insert("handled_at", "'pending', now()")).toBe("23514");
  });
});

describe("migration 0004, down and up again, with a message being sent", () => {
  test("the message ends unconfirmed and the migration can be applied again", async () => {
    const scratch = await createTestDatabase({ migrate: true });
    try {
      const all = loadMigrations(MIGRATIONS_DIRECTORY);
      const upTo = all.slice(0, all.findIndex((migration) => migration.name === "sending") + 1);
      const admin = await scratch.administrator();
      const made = await admin.query<{ id: string }>(
        `INSERT INTO tenants (name, pack, time_zone, default_language)
         VALUES ('t', 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
      );
      const tenantId = made.rows[0]?.id;
      await admin.query(
        `WITH account AS (
           INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', '100000000000009') RETURNING id
         ), contact AS (
           INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550142') RETURNING id
         ), conversation AS (
           INSERT INTO conversations (tenant_id, contact_id, channel_account_id)
           SELECT $1, contact.id, account.id FROM contact, account RETURNING id
         )
         INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, body, status, sending_at, send_attempts)
         SELECT $1, id, 'outbound', 'assistant-reply', 'text', 'in flight', 'sending', now(), 1 FROM conversation`,
        [tenantId],
      );
      const migrator = await scratch.client(MIGRATE_ROLE);
      // Down from the newest to just below 0004.
      for (let step = all.length; step >= upTo.length; step -= 1) {
        await migrateDown(migrator, all.slice(0, step));
      }
      const after = await admin.query("SELECT status, error_code FROM messages");
      expect(after.rows).toEqual([{ status: "failed", error_code: "unconfirmed" }]);
      expect(await migrateUp(migrator, all)).toContain("sending");
    } finally {
      await scratch.drop();
    }
  }, 30_000);
});
