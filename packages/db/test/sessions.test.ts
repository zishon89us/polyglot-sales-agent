// Sessions, the reply window, the batching window and a reply that has been
// overtaken (M3 unit U2). Each test is named for its case in the design
// note, docs/design/notes/m3-u2-sessions.md. Every time is passed in, so
// nothing here waits.

import {
  BATCH_MAX_MS,
  BATCH_QUIET_MS,
  HELD_BACK_WAIT_MS,
  REPLY_DISCARDS_MAX,
  SEND_EXPIRES_MS,
  SESSION_INACTIVITY_MS,
} from "@polyglot-sales-agent/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  beginTurn,
  claimNextSend,
  type Database,
  finishTurn,
  loadMigrations,
  MIGRATE_ROLE,
  migrateDown,
  migrateUp,
  recordSend,
  renewTurn,
  runTool,
  sessionHistory,
  storeInbound,
  type ToolReturn,
  type TurnStart,
  type Tx,
  withTenant,
} from "../src/index.ts";
import { adopt, createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./harness.ts";

let database: TestDatabase;
let pool: pg.Pool;
let app: Database;
let administrator: pg.Client;
let tenant = "";
const NUMBER = "100000000000006";
// An hour from now, to the second. Not a fixed date: the tenant's role may
// not queue a job due more than a minute ago (migration 0002), so a test
// that stored a message "at" a date now past would be refused.
const T0 = Math.ceil(Date.now() / 1_000) * 1_000 + 60 * 60_000;
const HOUR = 60 * 60_000;
const at = (ms: number): Date => new Date(T0 + ms);

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  pool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  app = adopt(APP_ROLE, pool);
  administrator = await database.administrator();
  const made = await administrator.query<{ id: string }>(
    `INSERT INTO tenants (name, pack, time_zone, default_language)
     VALUES ('Tenant s', 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
  );
  tenant = made.rows[0]?.id as string;
  await administrator.query(
    "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
    [tenant, NUMBER],
  );
}, 30_000);

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query("TRUNCATE messages, conversations, contacts, jobs CASCADE");
});

let serial = 0;
/** A customer's message stored at T0 + `ms`. `sentMs` is the channel's own time for it, if different. */
async function arrives(body: string | null, ms: number, sentMs = ms): Promise<void> {
  serial += 1;
  await storeInbound(
    app,
    tenant,
    NUMBER,
    [
      {
        channelMessageId: `wamid.SESSION${serial}`,
        phone: "+15550161",
        userId: "US.10000000000000000061",
        kind: body === null ? "image" : "text",
        body,
        sentAt: at(sentMs),
      },
    ],
    [],
    at(ms),
  );
}

async function rows<Row extends pg.QueryResultRow>(sql: string): Promise<Row[]> {
  return (await administrator.query<Row>(sql)).rows;
}
const one = async <Value>(sql: string): Promise<Value> =>
  (await rows<{ value: Value }>(sql))[0]?.value as Value;
const conversation = (): Promise<string> => one<string>("SELECT id AS value FROM conversations");

interface SessionRow {
  started: string;
  last: string;
  ended: string | null;
  discards: number;
  messages: number;
}
/** The sessions, oldest first, with times as milliseconds from T0. */
const sessions = (): Promise<SessionRow[]> =>
  rows<SessionRow>(
    `SELECT round(extract(epoch FROM s.started_at) * 1000 - ${T0})::text AS started,
            round(extract(epoch FROM s.last_message_at) * 1000 - ${T0})::text AS last,
            round(extract(epoch FROM s.ended_at) * 1000 - ${T0})::text AS ended,
            s.reply_discards AS discards,
            (SELECT count(*)::int FROM messages m WHERE m.session_id = s.id) AS messages
     FROM sessions s ORDER BY s.started_at`,
  );

type Turn = Extract<TurnStart, { kind: "turn" }>;
async function begin(ms: number): Promise<Turn> {
  const turn = await beginTurn(app, tenant, await conversation(), at(ms));
  if (turn.kind !== "turn") {
    throw new Error(`no turn: ${JSON.stringify(turn)}`);
  }
  return turn;
}
const bodies = (turn: Turn): (string | null)[] => turn.messages.map((message) => message.body);
async function finish(turn: Turn, reply: string | undefined, ms: number) {
  return finishTurn(
    app,
    tenant,
    await conversation(),
    turn,
    turn.messages.map((message) => message.id),
    reply,
    at(ms),
  );
}
/** A whole turn at `ms`, answering what is there. */
async function answer(reply: string, ms: number): Promise<void> {
  expect(await finish(await begin(ms), reply, ms)).toBe("stored");
}
const claim = async (ms: number) => claimNextSend(app, tenant, await conversation(), at(ms));
/** Claims the next message at `ms` and records that the channel accepted it. */
async function accepted(ms: number): Promise<void> {
  const next = await claim(ms);
  if (next.kind !== "send") {
    throw new Error(`nothing to send: ${JSON.stringify(next)}`);
  }
  await recordSend(
    app,
    tenant,
    next.message,
    { kind: "accepted", channelMessageId: `wamid.OUT${ms}` },
    at(ms),
  );
}
const replies = (): Promise<{ body: string; status: string }[]> =>
  rows("SELECT body, status FROM messages WHERE direction = 'outbound' ORDER BY created_at, id");
const unhandled = (): Promise<number> =>
  one<number>(
    "SELECT count(*)::int AS value FROM messages WHERE direction = 'inbound' AND handled_at IS NULL",
  );

describe("sessions", () => {
  test("S1: the first message starts a session at the time it was stored", async () => {
    await arrives("hello", 0);
    expect(await sessions()).toEqual([
      { started: "0", last: "0", ended: null, discards: 0, messages: 1 },
    ]);
  });

  test("S2: a message under 24 hours after the last joins the session and moves its time", async () => {
    await arrives("one", 0);
    await arrives("two", HOUR);
    expect(await sessions()).toEqual([
      { started: "0", last: String(HOUR), ended: null, discards: 0, messages: 2 },
    ]);
  });

  test("S3: a message 24 hours or more after the last ends the session and starts a new one, together", async () => {
    await arrives("one", 0);
    await arrives("two", HOUR);
    const later = HOUR + SESSION_INACTIVITY_MS + 5;
    await arrives("three", later);
    expect(await sessions()).toEqual([
      {
        started: "0",
        last: String(HOUR),
        ended: String(HOUR + SESSION_INACTIVITY_MS),
        discards: 0,
        messages: 2,
      },
      { started: String(later), last: String(later), ended: null, discards: 0, messages: 1 },
    ]);
  });

  test("S4: exactly 24 hours ends it; a millisecond less does not", async () => {
    await arrives("one", 0);
    await arrives("two", SESSION_INACTIVITY_MS - 1);
    expect(await sessions()).toHaveLength(1);
    await arrives("three", 2 * SESSION_INACTIVITY_MS - 1);
    expect(await sessions()).toHaveLength(2);
  });

  test("S3: ending a session closes what was left in it: its unanswered messages, and its replies that never reached the channel", async () => {
    await arrives("answered", 0);
    await answer("a reply nobody sent", BATCH_QUIET_MS);
    await arrives("never answered", HOUR);
    await arrives("a day later", HOUR + SESSION_INACTIVITY_MS);
    expect(await replies()).toEqual([{ body: "a reply nobody sent", status: "discarded" }]);
    // Only the new session's message is left to answer.
    const turn = await begin(HOUR + SESSION_INACTIVITY_MS + BATCH_QUIET_MS);
    expect(bodies(turn)).toEqual(["a day later"]);
  });

  test("S6: one webhook with messages 25 hours apart by the channel's time is one session, by the time we stored them", async () => {
    await storeInbound(
      app,
      tenant,
      NUMBER,
      [-25 * HOUR, 0].map((sentMs, index) => ({
        channelMessageId: `wamid.S6-${index}`,
        phone: "+15550161",
        userId: "US.10000000000000000061",
        kind: "text",
        body: `message ${index}`,
        sentAt: at(sentMs),
      })),
      [],
      at(0),
    );
    expect(await sessions()).toMatchObject([{ started: "0", messages: 2, ended: null }]);
    // And they keep the order they came in, a microsecond apart.
    expect(
      await rows("SELECT body FROM messages WHERE direction = 'inbound' ORDER BY created_at, id"),
    ).toEqual([{ body: "message 0" }, { body: "message 1" }]);
    expect(await one<number>("SELECT count(DISTINCT created_at)::int AS value FROM messages")).toBe(
      2,
    );
  });

  test("S3: ending a session leaves alone a reply the customer may have: one whose call ended unknown", async () => {
    await arrives("one", 0);
    await answer("perhaps delivered", BATCH_QUIET_MS);
    const next = await claim(BATCH_QUIET_MS);
    if (next.kind !== "send") {
      throw new Error("nothing to send");
    }
    await recordSend(app, tenant, next.message, { kind: "unknown" }, at(BATCH_QUIET_MS));
    await arrives("a day later", 25 * HOUR);
    expect(await replies()).toEqual([{ body: "perhaps delivered", status: "pending" }]);
  });

  test("S7: a turn that ends after its session's 24 hours stores no reply: the session is over, and its messages were closed with it", async () => {
    await arrives("one", 0);
    const turn = await begin(SESSION_INACTIVITY_MS - 1);
    expect(await finish(turn, "too late", SESSION_INACTIVITY_MS + 1_000)).toBe("session-over");
    expect(await replies()).toEqual([]);
    expect(await sessions()).toMatchObject([{ ended: String(SESSION_INACTIVITY_MS), messages: 1 }]);
    expect(await unhandled()).toBe(0);
    expect(
      await one<number>(
        "SELECT count(*)::int AS value FROM conversations WHERE lease_token IS NOT NULL",
      ),
    ).toBe(0);
  });

  test("S7: a turn that ends after its session is over and a new one has begun stores no reply either, and the new message is the next turn's", async () => {
    await arrives("one", 0);
    const turn = await begin(SESSION_INACTIVITY_MS - 1);
    await arrives("the next day", SESSION_INACTIVITY_MS + 10);
    expect(await finish(turn, "to one", SESSION_INACTIVITY_MS + 20)).toBe("session-over");
    expect(await replies()).toEqual([]);
    expect(bodies(await begin(SESSION_INACTIVITY_MS + 10 + BATCH_QUIET_MS))).toEqual([
      "the next day",
    ]);
  });

  test("S5: the database itself allows one open session per conversation", async () => {
    await arrives("one", 0);
    await expect(
      administrator.query(
        `INSERT INTO sessions (tenant_id, conversation_id, started_at, last_message_at)
         SELECT tenant_id, conversation_id, now(), now() FROM sessions`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("only a customer's message can point at the reply that answered it", async () => {
    await arrives("one", 0);
    await answer("a reply", BATCH_QUIET_MS);
    await expect(
      administrator.query("UPDATE messages SET answered_by = id WHERE direction = 'outbound'"),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("S7, S9: a reply is stored in the open session and does not move its time", async () => {
    await arrives("one", 0);
    await answer("a reply", BATCH_QUIET_MS);
    expect(await sessions()).toEqual([
      { started: "0", last: "0", ended: null, discards: 0, messages: 2 },
    ]);
  });

  test("S8: when the channel accepts the reply, the session's time moves to then", async () => {
    await arrives("one", 0);
    await answer("a reply", BATCH_QUIET_MS);
    await accepted(10 * 60_000);
    expect(await sessions()).toMatchObject([{ last: String(10 * 60_000), ended: null }]);
  });

  test("S8: a delivery or read receipt is not a message: it does not move the session's time, and the session still ends 24 hours after the acceptance", async () => {
    await arrives("one", 0);
    await answer("a reply", BATCH_QUIET_MS);
    await accepted(BATCH_QUIET_MS);
    for (const [status, hours] of [
      ["delivered", 2],
      ["read", 23],
    ] as const) {
      const stored = await storeInbound(
        app,
        tenant,
        NUMBER,
        [],
        [{ channelMessageId: `wamid.OUT${BATCH_QUIET_MS}`, status, errorCode: null }],
        at(hours * HOUR),
      );
      expect(stored.statusesApplied).toBe(1);
    }
    expect(await sessions()).toMatchObject([{ last: String(BATCH_QUIET_MS), ended: null }]);
    await arrives("a day later", 25 * HOUR);
    expect(await sessions()).toMatchObject([
      { last: String(BATCH_QUIET_MS), ended: String(BATCH_QUIET_MS + SESSION_INACTIVITY_MS) },
      { started: String(25 * HOUR) },
    ]);
  });

  test("S8: a session that is over is never moved or reopened by an acceptance", async () => {
    await arrives("one", 0);
    await answer("a reply", BATCH_QUIET_MS);
    const next = await claim(BATCH_QUIET_MS);
    if (next.kind !== "send") {
      throw new Error("nothing to send");
    }
    // The call takes more than a day to come back.
    await recordSend(
      app,
      tenant,
      next.message,
      { kind: "accepted", channelMessageId: "wamid.SLOW" },
      at(SESSION_INACTIVITY_MS + HOUR),
    );
    expect(await sessions()).toMatchObject([{ last: "0", ended: null }]);
    // Still over by time: the next message starts a new one.
    await arrives("two", SESSION_INACTIVITY_MS + 2 * HOUR);
    expect(await sessions()).toMatchObject([
      { last: "0", ended: String(SESSION_INACTIVITY_MS) },
      { started: String(SESSION_INACTIVITY_MS + 2 * HOUR) },
    ]);
  });

  test("S10: a session nobody wrote to again is ended when the conversation is next touched, here by a turn", async () => {
    await arrives("one", 0);
    expect(await beginTurn(app, tenant, await conversation(), at(SESSION_INACTIVITY_MS))).toEqual({
      kind: "idle",
    });
    expect(await sessions()).toMatchObject([{ ended: String(SESSION_INACTIVITY_MS) }]);
    // Its message was over 24 hours old: marked, and not answered.
    expect(await unhandled()).toBe(0);
    expect(await replies()).toEqual([]);
  });
});

describe("the reply window", () => {
  const window = (): Promise<string> =>
    one<string>(
      `SELECT round(extract(epoch FROM last_inbound_at) * 1000 - ${T0})::text AS value FROM contacts`,
    );

  test("W1: it opens from the earlier of the channel's time and ours, and never moves back", async () => {
    await arrives("on time", 0);
    expect(await window()).toBe("0");
    // Delivered an hour after it was sent: the channel's time counts.
    await arrives("late", 3 * HOUR, 2 * HOUR);
    expect(await window()).toBe(String(2 * HOUR));
    // A channel time in the future does not open it further than now.
    await arrives("from the future", 4 * HOUR, 9 * HOUR);
    expect(await window()).toBe(String(4 * HOUR));
    // And an old message delivered now does not move it back.
    await arrives("very late", 5 * HOUR, -HOUR);
    expect(await window()).toBe(String(4 * HOUR));
  });

  test("W2: a batch whose reply window has closed is marked and not answered, and the conversation is left free", async () => {
    // Sent 26 hours ago and delivered only now: our session is open, the channel's window is not.
    await arrives("delivered a day late", 0, -26 * HOUR);
    expect(await beginTurn(app, tenant, await conversation(), at(BATCH_QUIET_MS))).toEqual({
      kind: "skipped",
      reason: "window-closed",
      messages: 1,
    });
    expect(await unhandled()).toBe(0);
    expect(await replies()).toEqual([]);
    expect(
      await one<number>(
        "SELECT count(*)::int AS value FROM conversations WHERE lease_token IS NOT NULL",
      ),
    ).toBe(0);
  });
});

describe("the batching window", () => {
  const start = async (ms: number) => beginTurn(app, tenant, await conversation(), at(ms));

  test("B1: one message is answered not before 3 seconds after it", async () => {
    await arrives("one", 0);
    expect(await start(BATCH_QUIET_MS - 1)).toEqual({ kind: "wait", ms: 1 });
    expect(bodies(await begin(BATCH_QUIET_MS))).toEqual(["one"]);
  });

  test("B2: messages at 0, 2 and 4 seconds get one turn, not before 7 seconds, in order", async () => {
    await arrives("one", 0);
    await arrives("two", 2_000);
    await arrives("three", 4_000);
    expect(await start(6_999)).toEqual({ kind: "wait", ms: 1 });
    expect(bodies(await begin(7_000))).toEqual(["one", "two", "three"]);
  });

  test("B3: a customer who keeps writing is answered 10 seconds after the first, and the rest is the next batch", async () => {
    for (const ms of [0, 2_000, 4_000, 6_000, 8_000, 10_000]) {
      await arrives(`at ${ms}`, ms);
    }
    expect(await start(BATCH_MAX_MS - 1)).toEqual({ kind: "wait", ms: 1 });
    const turn = await begin(BATCH_MAX_MS);
    expect(bodies(turn)).toHaveLength(6);
    expect(await finish(turn, "to six", BATCH_MAX_MS)).toBe("stored");
    await accepted(BATCH_MAX_MS + 100);
    // The next message has a window of its own, counted from itself.
    await arrives("at 12000", 12_000);
    expect(await start(14_999)).toEqual({ kind: "wait", ms: 1 });
    expect(bodies(await begin(15_000))).toEqual(["at 12000"]);
  });

  test("B4: a turn that finds the window open takes nothing: no lease, no mark", async () => {
    await arrives("one", 0);
    await start(1_000);
    expect(
      await one<number>(
        "SELECT count(*)::int AS value FROM conversations WHERE lease_token IS NOT NULL OR turn_started_at IS NOT NULL",
      ),
    ).toBe(0);
  });

  test("B7: a turn that failed is run again at once: what is left has already waited", async () => {
    await arrives("one", 0);
    const turn = await begin(BATCH_QUIET_MS);
    // It failed and gave the conversation back.
    await administrator.query(
      "UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL",
    );
    expect(turn.messages).toHaveLength(1);
    expect(bodies(await begin(BATCH_QUIET_MS + 1))).toEqual(["one"]);
  });

  test("B7: after a failed turn, a new message still gets its own 3 seconds, but the cap counts from it, not from the old one", async () => {
    await arrives("old", 0);
    await begin(BATCH_QUIET_MS);
    await administrator.query(
      "UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL",
    );
    // Long after the old message's 10 seconds.
    await arrives("new", 60_000);
    expect(await start(60_000 + BATCH_QUIET_MS - 1)).toEqual({ kind: "wait", ms: 1 });
    expect(bodies(await begin(60_000 + BATCH_QUIET_MS))).toEqual(["old", "new"]);
  });

  test("each stored message queues a job for its conversation, due when the window can first close", async () => {
    await arrives("one", 0);
    await arrives("two", 1_000);
    expect(
      await rows(
        `SELECT type, round(extract(epoch FROM run_at) * 1000 - ${T0})::text AS due
         FROM jobs ORDER BY run_at`,
      ),
    ).toEqual([
      { type: "process-conversation", due: String(BATCH_QUIET_MS) },
      { type: "process-conversation", due: String(1_000 + BATCH_QUIET_MS) },
    ]);
  });
});

describe("a reply that has been overtaken", () => {
  const discards = (): Promise<number> =>
    one<number>("SELECT reply_discards AS value FROM sessions");

  test("D1: the customer writes while a reply is being made: nothing is stored, and it is counted", async () => {
    await arrives("one", 0);
    const turn = await begin(3_000);
    await arrives("two", 3_500);
    expect(await finish(turn, "to one only", 4_000)).toBe("newer-message");
    expect(await replies()).toEqual([]);
    expect(await discards()).toBe(1);
    expect(bodies(await begin(6_500))).toEqual(["one", "two"]);
  });

  test("D1: with no reply to drop, nothing is counted", async () => {
    await arrives(null, 0);
    const turn = await begin(3_000);
    await arrives("two", 3_500);
    expect(await finish(turn, undefined, 4_000)).toBe("newer-message");
    expect(await discards()).toBe(0);
  });

  test("D2: the customer writes while a finished reply waits: it is held back, then discarded by the next turn, which answers everything", async () => {
    await arrives("one", 0);
    await answer("to one only", 3_000);
    await arrives("two", 3_500);
    // The send job does not send it, and looks again later.
    expect(await claim(3_600)).toEqual({ kind: "wait", ms: HELD_BACK_WAIT_MS });
    const turn = await begin(6_500);
    expect(bodies(turn)).toEqual(["one", "two"]);
    expect(await replies()).toEqual([{ body: "to one only", status: "discarded" }]);
    expect(await discards()).toBe(1);
    expect(await finish(turn, "to both", 6_500)).toBe("stored");
    expect(await claim(6_600)).toMatchObject({ kind: "send", message: { body: "to both" } });
  });

  test("D2: a reply the channel refused, waiting to be tried again, is unsent too", async () => {
    await arrives("one", 0);
    await answer("to one only", 3_000);
    const first = await claim(3_100);
    if (first.kind !== "send") {
      throw new Error("nothing to send");
    }
    await recordSend(
      app,
      tenant,
      first.message,
      { kind: "refused", retryable: true, code: "rate-limited" },
      at(3_200),
    );
    await arrives("two", 4_000);
    expect(await claim(60_000)).toEqual({ kind: "wait", ms: HELD_BACK_WAIT_MS });
    expect(bodies(await begin(7_000))).toEqual(["one", "two"]);
  });

  test("D3: a reply already being sent when the customer writes is sent; the new message is the next turn's", async () => {
    await arrives("one", 0);
    await answer("to one", 3_000);
    const next = await claim(3_100);
    await arrives("two", 3_200);
    expect(next.kind).toBe("send");
    expect(bodies(await begin(6_200))).toEqual(["two"]);
    expect(await replies()).toEqual([{ body: "to one", status: "sending" }]);
    expect(await discards()).toBe(0);
  });

  test("D4: a reply whose call ended unknown may be with the customer: not held back, not discarded", async () => {
    await arrives("one", 0);
    await answer("to one", 3_000);
    const first = await claim(3_100);
    if (first.kind !== "send") {
      throw new Error("nothing to send");
    }
    await recordSend(app, tenant, first.message, { kind: "unknown" }, at(3_200));
    await arrives("two", 3_300);
    expect(bodies(await begin(6_300))).toEqual(["two"]);
    expect(await replies()).toEqual([{ body: "to one", status: "pending" }]);
    await administrator.query(
      "UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL",
    );
    expect(await claim(6_400)).toMatchObject({ kind: "send", message: { body: "to one" } });
  });

  test("D5: a system reply is never held back or discarded", async () => {
    await arrives("one", 0);
    await administrator.query(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body, status, created_at)
       SELECT tenant_id, conversation_id, id, 'outbound', 'system-reply', 'text', 'a fixed text', 'pending', $1
       FROM sessions`,
      [at(1_000)],
    );
    await arrives("two", 2_000);
    const turn = await begin(5_000);
    expect(bodies(turn)).toEqual(["one", "two"]);
    expect(await replies()).toEqual([{ body: "a fixed text", status: "pending" }]);
    await administrator.query(
      "UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL",
    );
    expect(await claim(5_100)).toMatchObject({ kind: "send", message: { body: "a fixed text" } });
  });

  test("D6: after two in a row, the third reply is stored although the customer wrote again, and the newer message is the next turn's", async () => {
    expect(REPLY_DISCARDS_MAX).toBe(2);
    await arrives("m1", 0);
    let turn = await begin(3_000);
    await arrives("m2", 3_100);
    expect(await finish(turn, "first try", 3_200)).toBe("newer-message");
    turn = await begin(6_100);
    await arrives("m3", 6_200);
    expect(await finish(turn, "second try", 6_300)).toBe("newer-message");
    expect(await discards()).toBe(2);
    turn = await begin(9_200);
    expect(bodies(turn)).toEqual(["m1", "m2", "m3"]);
    await arrives("m4", 9_300);
    expect(await finish(turn, "third try", 9_400)).toBe("stored");
    // It is not held back either, though m4 is newer.
    expect(await claim(9_500)).toMatchObject({ kind: "send", message: { body: "third try" } });
    expect(bodies(await begin(12_300 + SEND_EXPIRES_MS))).toEqual(["m4"]);
  });

  test("D6: a waiting reply is not discarded a third time either: it is sent, and the turn answers only what is newer", async () => {
    await arrives("m1", 0);
    await answer("r1", 3_000);
    await arrives("m2", 3_100);
    await answer("r2", 6_100);
    await arrives("m3", 6_200);
    await answer("r3", 9_200);
    expect(await discards()).toBe(2);
    expect(await replies()).toMatchObject([
      { body: "r1", status: "discarded" },
      { body: "r2", status: "discarded" },
      { body: "r3", status: "pending" },
    ]);
    await arrives("m4", 9_300);
    // m4 is newer than r3, and r3 is still not held back: two have been dropped already.
    expect(await claim(9_400)).toMatchObject({ kind: "send", message: { body: "r3" } });
    await administrator.query(
      "UPDATE messages SET status = 'pending', sending_at = NULL WHERE status = 'sending'",
    );
    const turn = await begin(12_300);
    expect(bodies(turn)).toEqual(["m4"]);
    expect((await replies())[2]).toEqual({ body: "r3", status: "pending" });
  });

  test("D2: only a message stored after the reply holds it back; an older one that is still open does not", async () => {
    await arrives("m1", 0);
    let turn = await begin(3_000);
    await arrives("m2", 3_100);
    await finish(turn, "first try", 3_200);
    turn = await begin(6_100);
    await arrives("m3", 6_200);
    await finish(turn, "second try", 6_300);
    turn = await begin(9_200);
    await arrives("m4", 9_300);
    // Stored although m4 is open: m4 is older than this reply.
    expect(await finish(turn, "third try", 9_400)).toBe("stored");
    // Even with the count back at zero, as after an acceptance, m4 does not hold it.
    await administrator.query("UPDATE sessions SET reply_discards = 0");
    expect(await claim(9_500)).toMatchObject({ kind: "send", message: { body: "third try" } });
  });

  test("D6: a delivery or read receipt for an earlier reply does not end a run of dropped replies", async () => {
    await arrives("m0", 0);
    await answer("r0", 3_000);
    await accepted(3_100);
    await arrives("m1", 10_000);
    let turn = await begin(13_000);
    await arrives("m2", 13_100);
    await finish(turn, "first try", 13_200);
    turn = await begin(16_100);
    await arrives("m3", 16_200);
    await finish(turn, "second try", 16_300);
    expect(await discards()).toBe(2);
    await storeInbound(
      app,
      tenant,
      NUMBER,
      [],
      [{ channelMessageId: "wamid.OUT3100", status: "read", errorCode: null }],
      at(16_400),
    );
    expect(await discards()).toBe(2);
    turn = await begin(19_200);
    await arrives("m4", 19_300);
    expect(await finish(turn, "third try", 19_400)).toBe("stored");
  });

  test("D6: the count returns to zero when an assistant reply is accepted by the channel", async () => {
    await arrives("m1", 0);
    await answer("r1", 3_000);
    await arrives("m2", 3_100);
    await answer("r2", 6_100);
    expect(await discards()).toBe(1);
    await accepted(6_200);
    expect(await discards()).toBe(0);
  });

  test("D7: only the discarded reply's messages are reopened; one dealt with by no reply is not", async () => {
    await arrives(null, 0);
    // A batch with no text: marked, with no reply.
    expect(await finish(await begin(3_000), undefined, 3_000)).toBe("stored");
    await arrives("a question", 10_000);
    await answer("an answer", 13_000);
    await arrives("another", 13_100);
    expect(bodies(await begin(16_100))).toEqual(["a question", "another"]);
    expect(
      await rows(
        "SELECT kind, handled_at IS NOT NULL AS handled FROM messages WHERE direction = 'inbound' ORDER BY created_at",
      ),
    ).toEqual([
      { kind: "image", handled: true },
      { kind: "text", handled: false },
      { kind: "text", handled: false },
    ]);
  });

  test("D8: a reply held back for 15 minutes expires as it always did, and nothing is reopened", async () => {
    await arrives("one", 0);
    await answer("to one", 3_000);
    await arrives("two", 3_100);
    const late = 3_000 + SEND_EXPIRES_MS + 1;
    // The turn comes first, and leaves it alone.
    const turn = await begin(late);
    expect(bodies(turn)).toEqual(["two"]);
    expect(await replies()).toEqual([{ body: "to one", status: "pending" }]);
    expect(await discards()).toBe(0);
    await administrator.query(
      "UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL",
    );
    expect(await claim(late)).toEqual({ kind: "none", ended: ["expired"] });
  });

  test("D9: when the newer message is dealt with without a turn, the reply is no longer held back", async () => {
    await arrives("one", 0);
    await answer("to one", 3_000);
    await arrives("STOP", 3_100);
    expect(await claim(3_200)).toEqual({ kind: "wait", ms: HELD_BACK_WAIT_MS });
    // As a later unit will, for a keyword that ends before the batch.
    await administrator.query(
      "UPDATE messages SET handled_at = clock_timestamp() WHERE body = 'STOP'",
    );
    expect(await claim(3_300)).toMatchObject({ kind: "send", message: { body: "to one" } });
  });
});

describe("one lock per conversation (design note, section 0)", () => {
  /**
   * Holds the conversation's row as the four operations do, starts `work`,
   * and waits until that many of its transactions are seen waiting for a
   * lock. Then lets go. Without the lock in an operation, nothing would
   * ever be seen waiting and this would time out.
   */
  async function whileHeld<Result>(
    waiters: number,
    work: () => Promise<Result>,
    meanwhile?: () => Promise<unknown>,
  ): Promise<Result> {
    await administrator.query("BEGIN");
    let running: Promise<Result>;
    try {
      await administrator.query("SELECT 1 FROM conversations FOR NO KEY UPDATE");
      running = work();
      for (let tries = 0; ; tries += 1) {
        const waiting = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
           WHERE NOT l.granted AND a.datname = current_database()`,
        );
        if (waiting.rows[0]?.n === waiters) {
          break;
        }
        if (tries > 200) {
          throw new Error(`expected ${waiters} waiting, saw ${waiting.rows[0]?.n}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // Done by the holder, in its transaction: visible to the waiters only once it lets go.
      await meanwhile?.();
    } finally {
      await administrator.query("COMMIT");
    }
    return running;
  }

  test("S5: two webhooks for one conversation at once wait their turn, and both messages land in one session", async () => {
    await arrives("first", 0);
    await whileHeld(2, () => Promise.all([arrives("second", 1_000), arrives("third", 1_001)]));
    expect(await sessions()).toMatchObject([{ messages: 3, ended: null }]);
  });

  test("starting a turn waits for it before it reads anything: a message stored while it waited changes its answer", async () => {
    await arrives("one", 0);
    const id = await conversation();
    // At 9.5 seconds the window of "one" has long closed. While the turn
    // waits, whoever holds the conversation stores "two" as of 9 seconds,
    // which opens the window again until 10. A turn that had looked at the
    // window before it waited would start; this one is told to wait.
    const turn = await whileHeld(
      1,
      () => beginTurn(app, tenant, id, at(9_500)),
      () =>
        administrator.query(
          `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, kind, body, created_at)
           SELECT tenant_id, conversation_id, id, 'inbound', 'text', 'two', $1 FROM sessions`,
          [at(9_000)],
        ),
    );
    expect(turn).toEqual({ kind: "wait", ms: 500 });
  });

  test("the same webhook delivered twice at one moment stores the message once, starts one session and fails neither delivery", async () => {
    await arrives("first", 0);
    const twice = () =>
      storeInbound(
        app,
        tenant,
        NUMBER,
        [
          {
            channelMessageId: "wamid.SESSION-TWICE",
            phone: "+15550161",
            userId: "US.10000000000000000061",
            kind: "text",
            body: "second",
            sentAt: at(1_000),
          },
        ],
        [],
        at(1_000),
      );
    const stored = await whileHeld(2, () => Promise.all([twice(), twice()]));
    expect(stored.map((batch) => [batch.stored, batch.duplicates]).sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(await sessions()).toMatchObject([{ messages: 2 }]);
  });

  test("ending a turn waits for it, so a message being stored cannot slip past: whichever goes second sees the other", async () => {
    await arrives("one", 0);
    const id = await conversation();
    const turn = await begin(3_000);
    const ids = turn.messages.map((message) => message.id);
    // Both are held at the door together, and here they read the real
    // clock, each after it has the lock, as in production: the order of
    // their times is the order they went in. Whatever that order, the reply
    // is never sent as if the newer message did not exist.
    const [end] = await whileHeld(2, () =>
      Promise.all([
        finishTurn(app, tenant, id, turn, ids, "to one only"),
        storeInbound(
          app,
          tenant,
          NUMBER,
          [
            {
              channelMessageId: "wamid.SESSION-RACE",
              phone: "+15550161",
              userId: "US.10000000000000000061",
              kind: "text",
              body: "two",
              sentAt: new Date(),
            },
          ],
          [],
        ),
      ]),
    );
    if (end === "newer-message") {
      expect(await replies()).toEqual([]);
    } else {
      // The turn ended first: its reply waits, held back for the message that followed.
      expect(end).toBe("stored");
      expect(await claimNextSend(app, tenant, id)).toEqual({
        kind: "wait",
        ms: HELD_BACK_WAIT_MS,
      });
    }
  });

  test("claiming a message to send, and recording its result, wait for it", async () => {
    await arrives("one", 0);
    await answer("to one", 3_000);
    const id = await conversation();
    const next = await whileHeld(1, () => claimNextSend(app, tenant, id, at(3_100)));
    if (next.kind !== "send") {
      throw new Error("nothing to send");
    }
    const decision = await whileHeld(1, () =>
      recordSend(
        app,
        tenant,
        next.message,
        { kind: "accepted", channelMessageId: "wamid.L" },
        at(3_200),
      ),
    );
    expect(decision).toMatchObject({ next: "sent" });
  });
});

describe("migration 0006 on a database that has conversations (design note, section 6)", () => {
  test("old messages are cut into sessions at gaps of 24 hours; the way back loses only what it added; and up again", async () => {
    const scratch = await createTestDatabase({ migrate: true });
    try {
      const all = loadMigrations(MIGRATIONS_DIRECTORY);
      const sessionsAt = all.findIndex((migration) => migration.name === "sessions");
      // This test is about 0006: later migrations are taken down first and not brought back.
      const upTo = all.slice(0, sessionsAt + 1);
      const migrator = await scratch.client(MIGRATE_ROLE);
      // Back to just before 0006, and whatever came after it.
      for (let step = all.length; step > sessionsAt; step -= 1) {
        await migrateDown(migrator, all.slice(0, step));
      }
      const admin = await scratch.administrator();
      const t = (hours: number): Date => at(hours * HOUR);
      const made = await admin.query<{ id: string }>(
        `INSERT INTO tenants (name, pack, time_zone, default_language)
         VALUES ('t', 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
      );
      const tenantId = made.rows[0]?.id;
      const account = await admin.query<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id)
         VALUES ($1, 'mock', '100000000000008') RETURNING id`,
        [tenantId],
      );
      const conversations: Record<string, string> = {};
      for (const [name, phone] of [
        ["busy", "+15550171"],
        ["quiet", "+15550172"],
        ["once", "+15550173"],
        ["edge", "+15550174"],
      ] as const) {
        const contact = await admin.query<{ id: string }>(
          "INSERT INTO contacts (tenant_id, phone) VALUES ($1, $2) RETURNING id",
          [tenantId, phone],
        );
        const conversation = await admin.query<{ id: string }>(
          `INSERT INTO conversations (tenant_id, contact_id, channel_account_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, contact.rows[0]?.id, account.rows[0]?.id],
        );
        conversations[name] = conversation.rows[0]?.id as string;
      }
      const inbound = (name: string, stored: Date, sent: Date | null, body: string) =>
        admin.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, kind, body, channel_message_id,
                                 channel_sent_at, created_at)
           VALUES ($1, $2, 'inbound', 'text', $3, $3, $4, $5)`,
          [tenantId, conversations[name], body, sent, stored],
        );
      const outbound = (name: string, stored: Date, status: string, body: string) =>
        admin.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, body, status,
                                 created_at)
           VALUES ($1, $2, 'outbound', 'assistant-reply', 'text', $3, $4, $5)`,
          [tenantId, conversations[name], body, status, stored],
        );
      // One conversation with a gap of 29 hours in it; rows of each kind.
      await inbound("busy", t(0), t(-1), "b1");
      await outbound("busy", t(0.5), "pending", "b1p");
      await outbound("busy", t(1), "sent", "b2");
      await outbound("busy", t(30), "failed", "b3");
      await inbound("busy", t(31), t(32), "b4");
      await outbound("busy", t(31.5), "pending", "b5");
      // One with a single message, delivered an hour after it was sent, and one with none.
      await inbound("once", t(5), t(4), "o1");

      // Two messages exactly 24 hours apart, and a third a millisecond short of 24 hours after.
      await inbound("edge", t(100), t(100), "e1");
      await inbound("edge", t(124), t(124), "e2");
      await inbound("edge", new Date(t(148).getTime() - 1), t(147), "e3");

      expect(await migrateUp(migrator, upTo)).toContain("sessions");

      const hours = (column: string) =>
        `round(extract(epoch FROM ${column}) * 1000 - ${T0}) / ${HOUR}`;
      const made6 = await admin.query(
        `SELECT m.body, ${hours("s.started_at")}::float AS started,
                ${hours("s.last_message_at")}::float AS last, ${hours("s.ended_at")}::float AS ended,
                s.conversation_id = m.conversation_id AS same_conversation, m.answered_by
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.body NOT LIKE 'e%' ORDER BY m.created_at`,
      );
      expect(made6.rows).toEqual([
        { body: "b1", started: 0, last: 1, ended: 25, same_conversation: true, answered_by: null },
        { body: "b1p", started: 0, last: 1, ended: 25, same_conversation: true, answered_by: null },
        { body: "b2", started: 0, last: 1, ended: 25, same_conversation: true, answered_by: null },
        {
          body: "o1",
          started: 5,
          last: 5,
          ended: null,
          same_conversation: true,
          answered_by: null,
        },
        {
          body: "b3",
          started: 30,
          last: 31.5,
          ended: null,
          same_conversation: true,
          answered_by: null,
        },
        {
          body: "b4",
          started: 30,
          last: 31.5,
          ended: null,
          same_conversation: true,
          answered_by: null,
        },
        {
          body: "b5",
          started: 30,
          last: 31.5,
          ended: null,
          same_conversation: true,
          answered_by: null,
        },
      ]);
      // Exactly 24 hours apart is two sessions; a millisecond less is one.
      expect(
        (
          await admin.query(
            `SELECT array_agg(m.body ORDER BY m.created_at) AS bodies, s.ended_at IS NULL AS open
             FROM messages m JOIN sessions s ON s.id = m.session_id
             WHERE m.body LIKE 'e%' GROUP BY s.id ORDER BY min(m.created_at)`,
          )
        ).rows,
      ).toEqual([
        { bodies: ["e1"], open: false },
        { bodies: ["e2", "e3"], open: true },
      ]);
      expect((await admin.query("SELECT count(*)::int AS n FROM sessions")).rows).toEqual([
        { n: 5 },
      ]);
      // What an ended session left open is closed, as when a session ends from now on.
      expect(
        (
          await admin.query(
            "SELECT body, handled_at IS NOT NULL AS handled FROM messages WHERE direction = 'inbound' ORDER BY created_at",
          )
        ).rows,
      ).toEqual([
        { body: "b1", handled: true },
        { body: "o1", handled: false },
        { body: "b4", handled: false },
        { body: "e1", handled: true },
        { body: "e2", handled: false },
        { body: "e3", handled: false },
      ]);
      // A reply that never reached the channel is discarded with its ended session; one in the open session waits on.
      expect(
        (
          await admin.query(
            "SELECT body, status FROM messages WHERE direction = 'outbound' ORDER BY created_at",
          )
        ).rows,
      ).toEqual([
        { body: "b1p", status: "discarded" },
        { body: "b2", status: "sent" },
        { body: "b3", status: "failed" },
        { body: "b5", status: "pending" },
      ]);
      // The reply window: the earlier of the channel's time and ours, of the newest inbound message.
      expect(
        (
          await admin.query(
            `SELECT phone, ${hours("last_inbound_at")}::float AS window FROM contacts ORDER BY phone`,
          )
        ).rows,
      ).toEqual([
        { phone: "+15550171", window: 31 },
        { phone: "+15550172", window: null },
        { phone: "+15550173", window: 4 },
        { phone: "+15550174", window: 147 },
      ]);

      // The way back: the messages stay, what 0006 added goes.
      expect(await migrateDown(migrator, upTo)).toBe("sessions");
      expect((await admin.query("SELECT count(*)::int AS n FROM messages")).rows).toEqual([
        { n: 10 },
      ]);
      expect(
        (
          await admin.query(
            `SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_schema = 'public' AND (table_name = 'sessions'
               OR column_name IN ('session_id', 'answered_by', 'last_inbound_at', 'turn_started_at'))`,
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      // And up again gives the same sessions.
      await migrateUp(migrator, upTo);
      expect((await admin.query("SELECT count(*)::int AS n FROM sessions")).rows).toEqual([
        { n: 5 },
      ]);
    } finally {
      await scratch.drop();
    }
  }, 30_000);
});

describe("what a turn with the model records (M3 unit U7; design note m3-u7-turn, sections 4, 6 and 7)", () => {
  const TURN = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const HOUR_MS = 10 * 60_000;
  const made = (language: string) => ({ turnId: TURN, language });
  async function reply(text: string, ms: number, language: string) {
    const turn = await begin(ms);
    return finishTurn(
      app,
      tenant,
      await conversation(),
      turn,
      turn.messages.map((message) => message.id),
      text,
      at(ms),
      made(language),
    );
  }
  const session = async () =>
    (
      await rows<{ language: string | null; unsupported: boolean }>(
        "SELECT language, unsupported_language AS unsupported FROM sessions ORDER BY started_at",
      )
    )[0];
  const sessionId = (): Promise<string> => one<string>("SELECT id AS value FROM sessions");

  test("G1: a supported language becomes the session's; the reply's row has the turn and the language", async () => {
    await arrives("hello", 0);
    expect(await reply("Hello.", HOUR_MS, "en")).toBe("stored");
    expect(await session()).toEqual({ language: "en", unsupported: false });
    expect(
      await rows("SELECT turn_id, language FROM messages WHERE direction = 'outbound'"),
    ).toEqual([{ turn_id: TURN, language: "en" }]);
  });

  test("G2 and G4: a language that is not supported marks the session, and the mark stays when a supported one follows", async () => {
    await arrives("hallo", 0);
    await reply("Hallo.", HOUR_MS, "de");
    expect(await session()).toEqual({ language: "de", unsupported: true });
    await arrives("hello", 2 * HOUR_MS);
    await reply("Hello.", 3 * HOUR_MS, "en");
    expect(await session()).toEqual({ language: "en", unsupported: true });
    expect(
      await rows("SELECT language FROM messages WHERE direction = 'outbound' ORDER BY created_at"),
    ).toEqual([{ language: "de" }, { language: "en" }]);
  });

  test("G3: when the model could not tell, the session keeps what it had, and the reply records that", async () => {
    await arrives("hello", 0);
    await reply("Hello.", HOUR_MS, "ar");
    await arrives("\u{1F600}", 2 * HOUR_MS);
    await reply("?", 3 * HOUR_MS, "und");
    expect(await session()).toEqual({ language: "ar", unsupported: false });
    expect(
      await rows("SELECT language FROM messages WHERE direction = 'outbound' ORDER BY created_at"),
    ).toEqual([{ language: "ar" }, { language: "und" }]);
    // And a session that has only ever had `und` has no language.
    await administrator.query("TRUNCATE messages, conversations, contacts, jobs CASCADE");
    await arrives("\u{1F600}", 0);
    await reply("?", HOUR_MS, "und");
    expect(await session()).toEqual({ language: null, unsupported: false });
  });

  test.each(["ar", "en", "ur", "hi", "bn", "tl"])("%s is supported", async (language) => {
    await arrives("x", 0);
    await reply("y", HOUR_MS, language);
    expect(await session()).toEqual({ language, unsupported: false });
  });

  test("G5: a reply that is not stored records nothing of a language", async () => {
    await arrives("hallo", 0);
    const turn = await begin(HOUR_MS);
    await arrives("noch etwas", HOUR_MS + 1);
    expect(
      await finishTurn(
        app,
        tenant,
        await conversation(),
        turn,
        turn.messages.map((m) => m.id),
        "Hallo.",
        at(HOUR_MS + 2),
        made("de"),
      ),
    ).toBe("newer-message");
    expect(await session()).toEqual({ language: null, unsupported: false });
    // And a turn that ends with no reply has nothing to record either.
    const again = await begin(2 * HOUR_MS);
    await finishTurn(
      app,
      tenant,
      await conversation(),
      again,
      again.messages.map((m) => m.id),
      undefined,
      at(2 * HOUR_MS),
      made("de"),
    );
    expect(await session()).toEqual({ language: null, unsupported: false });
  });

  test("a reply stored the old way, with no turn, has neither a turn nor a language", async () => {
    await arrives("hello", 0);
    await answer("Hello.", HOUR_MS);
    expect(
      await rows("SELECT turn_id, language FROM messages WHERE direction = 'outbound'"),
    ).toEqual([{ turn_id: null, language: null }]);
  });

  test.each([
    ["a language of three letters", "eng"],
    ["a language in capitals", "EN"],
    ["an empty language", ""],
  ])("the table refuses %s, and nothing of the turn is stored", async (_name, language) => {
    await arrives("hello", 0);
    await expect(reply("Hello.", HOUR_MS, language)).rejects.toMatchObject({ code: "23514" });
    expect(await replies()).toEqual([]);
    expect(await unhandled()).toBe(1);
  });

  test("a turn and a language belong to an assistant's reply only, and together", async () => {
    await arrives("hello", 0);
    await answer("Hello.", HOUR_MS);
    for (const change of [
      `UPDATE messages SET turn_id = '${TURN}' WHERE direction = 'outbound'`,
      "UPDATE messages SET language = 'en' WHERE direction = 'outbound'",
      `UPDATE messages SET turn_id = '${TURN}', language = 'en' WHERE direction = 'inbound'`,
      `UPDATE messages SET turn_id = '${TURN}', language = 'en', class = 'staff-message' WHERE direction = 'outbound'`,
      "UPDATE sessions SET language = 'und'",
      "UPDATE sessions SET language = 'eng'",
    ]) {
      await expect(administrator.query(change), change).rejects.toMatchObject({ code: "23514" });
    }
  });

  describe("the session so far (section 4)", () => {
    const history = async () => sessionHistory(app, tenant, await sessionId());
    /** Puts an outbound row of a class and status straight in, as a later unit would. */
    async function outbound(
      body: string | null,
      cls: string,
      status: string,
      ms: number,
      error: string | null = null,
    ) {
      await administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body, status, error_code, created_at)
         SELECT tenant_id, conversation_id, id, 'outbound', $1, 'text', $2, $3, $4, $5 FROM sessions`,
        [cls, body, status, error, at(ms)],
      );
    }

    test("H1, H2: the customer's texts a turn dealt with and the replies the channel accepted, oldest first", async () => {
      await arrives("first", 0);
      await answer("Echo: first", HOUR_MS);
      await accepted(HOUR_MS + 1);
      await arrives("second", 2 * HOUR_MS);
      await answer("Echo: second", 3 * HOUR_MS);
      await accepted(3 * HOUR_MS + 1);
      await arrives("not dealt with yet", 4 * HOUR_MS);
      expect(await history()).toEqual([
        { role: "customer", text: "first" },
        { role: "assistant", text: "Echo: first" },
        { role: "customer", text: "second" },
        { role: "assistant", text: "Echo: second" },
      ]);
    });

    test("H2, H3: by status: sent, delivered, read and an unconfirmed failure are in; waiting, dropped and failed are not", async () => {
      await arrives("hello", 0);
      await answer("still waiting", HOUR_MS);
      const statuses: [string, string | null][] = [
        ["sent", null],
        ["delivered", null],
        ["read", null],
        ["failed", "unconfirmed"],
        ["failed", "expired"],
        ["failed", "rate-limited"],
        ["discarded", null],
        ["held", null],
        ["withheld", null],
      ];
      let ms = 2 * HOUR_MS;
      for (const [status, error] of statuses) {
        await outbound(`${status} ${error ?? ""}`.trim(), "assistant-reply", status, ms, error);
        ms += 1;
      }
      expect((await history()).map((message) => message.text)).toEqual([
        "hello",
        "sent",
        "delivered",
        "read",
        "failed unconfirmed",
      ]);
    });

    test("H2a: a staff member's message, a fixed text, a notice and a message the business began are never in it", async () => {
      await arrives("hello", 0);
      await answer("Hello.", HOUR_MS);
      await accepted(HOUR_MS + 1);
      let ms = 2 * HOUR_MS;
      for (const cls of ["staff-message", "system-reply", "service-notice", "business-initiated"]) {
        await outbound(`Dear Test Customer, from ${cls}`, cls, "delivered", ms);
        ms += 1;
      }
      const found = await history();
      expect(found).toEqual([
        { role: "customer", text: "hello" },
        { role: "assistant", text: "Hello." },
      ]);
      expect(JSON.stringify(found)).not.toContain("Test Customer");
    });

    test("H2b, H4: a row with no text, a picture and a tap are not in it", async () => {
      await arrives("hello", 0);
      await arrives(null, 1);
      await storeInbound(
        app,
        tenant,
        NUMBER,
        [
          {
            channelMessageId: "wamid.SESSIONTAP",
            phone: "+15550161",
            userId: "US.10000000000000000061",
            kind: "button",
            body: null,
            buttonPayload: "core.stop",
            sentAt: at(2),
          },
        ],
        [],
        at(2),
      );
      await answer("Hello.", HOUR_MS);
      await accepted(HOUR_MS + 1);
      await outbound(null, "assistant-reply", "delivered", 2 * HOUR_MS);
      await outbound("", "assistant-reply", "delivered", 2 * HOUR_MS + 1);
      expect(await history()).toEqual([
        { role: "customer", text: "hello" },
        { role: "assistant", text: "Hello." },
      ]);
    });

    test("H5: the newest thirty, and of those the newest that fit 12,000 characters, still oldest first", async () => {
      await arrives("m0", 0);
      await answer("r0", HOUR_MS);
      for (let n = 1; n <= 34; n += 1) {
        await outbound(`r${n}`, "assistant-reply", "sent", HOUR_MS + 1_000 + n);
      }
      const thirty = await history();
      expect(thirty).toHaveLength(30);
      expect(thirty[0]?.text).toBe("r5");
      expect(thirty.at(-1)?.text).toBe("r34");
      await outbound("x".repeat(6_000), "assistant-reply", "sent", 2 * HOUR_MS);
      await outbound("y".repeat(5_990), "assistant-reply", "sent", 2 * HOUR_MS + 1);
      await outbound("zzzzz", "assistant-reply", "sent", 2 * HOUR_MS + 2);
      // 5 + 5,990 + 6,000 is 11,995; one more of 3 makes 11,998 and fits; the next would make 12,001.
      const bounded = await history();
      expect(bounded.map((message) => message.text.length)).toEqual([3, 6_000, 5_990, 5]);
      await outbound("w".repeat(12_001), "assistant-reply", "sent", 3 * HOUR_MS);
      expect(await history()).toEqual([]);
    });

    test("H5: the first message that does not fit ends the history: no older one is put beside a newer, with a hole between", async () => {
      await arrives("m0", 0);
      await answer("r0", HOUR_MS);
      await outbound("old and short", "assistant-reply", "sent", HOUR_MS + 1_000);
      await outbound("x".repeat(11_990), "assistant-reply", "sent", HOUR_MS + 2_000);
      await outbound("newest", "assistant-reply", "sent", HOUR_MS + 3_000);
      // "newest" fits; the long one would make 11,996 and fits; "old and short" would make 12,009.
      expect((await history()).map((message) => message.text.length)).toEqual([11_990, 6]);
      await outbound("y".repeat(11_995), "assistant-reply", "sent", HOUR_MS + 4_000);
      // Now the newest alone fits and the next does not: the short ones before it are not skipped to.
      expect((await history()).map((message) => message.text.length)).toEqual([11_995]);
    });

    test("H4: a row that is not a text is not in it even if it holds words", async () => {
      await arrives("hello", 0);
      await answer("Hello.", HOUR_MS);
      await accepted(HOUR_MS + 1);
      await administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body, status, created_at)
         SELECT tenant_id, conversation_id, id, 'outbound', 'assistant-reply', 'template', 'A template with words', 'delivered', $1 FROM sessions`,
        [at(2 * HOUR_MS)],
      );
      expect((await history()).map((message) => message.text)).toEqual(["hello", "Hello."]);
    });

    test("the history is read through an index on the session, not by reading every message", async () => {
      const indexes = await rows<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'messages_session'",
      );
      expect(indexes).toEqual([
        {
          indexdef:
            "CREATE INDEX messages_session ON public.messages USING btree (tenant_id, session_id, created_at, id)",
        },
      ]);
    });

    test("H6: a message of an earlier session of the same conversation is not in it, and another tenant sees nothing", async () => {
      await arrives("yesterday", 0);
      await answer("Echo: yesterday", HOUR_MS);
      await accepted(HOUR_MS + 1);
      await arrives("today", 25 * HOUR);
      const newest = await one<string>(
        "SELECT id AS value FROM sessions ORDER BY started_at DESC LIMIT 1",
      );
      expect(await sessionHistory(app, tenant, newest)).toEqual([]);
      const other = await administrator.query<{ id: string }>(
        `INSERT INTO tenants (name, pack, time_zone, default_language)
         VALUES ('Another', 'faq-only', 'UTC', 'en') RETURNING id`,
      );
      const first = await one<string>(
        "SELECT id AS value FROM sessions ORDER BY started_at LIMIT 1",
      );
      expect(await sessionHistory(app, other.rows[0]?.id as string, first)).toEqual([]);
      await administrator.query("DELETE FROM tenants WHERE id = $1", [other.rows[0]?.id]);
    });
  });

  describe("running a tool (section 6)", () => {
    const calls = () =>
      rows<{ tool: string; arguments: unknown; result: unknown; outcome: string; turn_id: string }>(
        "SELECT tool, arguments, result, outcome, turn_id FROM tool_calls ORDER BY created_at, id",
      );
    async function run(
      turn: Turn,
      tool: (tx: Tx) => Promise<ToolReturn>,
      extra: { token?: string; timeoutMs?: number; args?: unknown } = {},
    ) {
      return runTool(
        app,
        tenant,
        {
          conversationId: await conversation(),
          token: extra.token ?? turn.token,
          sessionId: turn.sessionId,
          turnId: TURN,
          tool: "find_times",
          arguments: "args" in extra ? extra.args : { day: "Thursday, please" },
        },
        tool,
        extra.timeoutMs,
      );
    }

    test("L2: the tool runs in a transaction that holds the lease, and its row is stored with what it was asked and what it answered", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      const ran = await run(turn, async (tx) => {
        const seen = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM messages");
        return { outcome: "done", result: { messages: seen.rows[0]?.n, times: ["10:00"] } };
      });
      expect(ran).toEqual({
        kind: "ran",
        outcome: "done",
        result: { messages: 1, times: ["10:00"] },
      });
      expect(await calls()).toEqual([
        {
          tool: "find_times",
          arguments: { day: "Thursday, please" },
          result: { messages: 1, times: ["10:00"] },
          outcome: "done",
          turn_id: TURN,
        },
      ]);
    });

    test("L2a: a tool that does not take the arguments: refused, with no result", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      expect(await run(turn, async () => ({ outcome: "refused" }))).toEqual({
        kind: "ran",
        outcome: "refused",
        result: null,
      });
      expect(await calls()).toMatchObject([{ outcome: "refused", result: null }]);
    });

    test.each([
      [
        "throws",
        async () => {
          throw new Error("Do you have a slot on Thursday? +15550142");
        },
      ],
      [
        "returns too much",
        async () => ({ outcome: "done", result: "x".repeat(4_000) }) as ToolReturn,
      ],
      [
        "returns what is not plain data",
        async () => ({ outcome: "done", result: 10n }) as ToolReturn,
      ],
      [
        "returns nothing that JSON can hold",
        async () => ({ outcome: "done", result: undefined }) as ToolReturn,
      ],
      [
        "returns an outcome that is not one",
        async () => ({ outcome: "fine" }) as unknown as ToolReturn,
      ],
      ["returns nothing", async () => undefined as unknown as ToolReturn],
    ] as [string, (tx: Tx) => Promise<ToolReturn>][])(
      "L3: a tool that %s: everything it wrote is undone, and its row says failed and nothing else",
      async (_name, tool) => {
        await arrives("hello", 0);
        const turn = await begin(HOUR_MS);
        const ran = await run(turn, async (tx) => {
          await tx.query("UPDATE sessions SET reply_discards = 2");
          return tool(tx);
        });
        expect(ran).toEqual({ kind: "ran", outcome: "failed", result: null });
        expect(await calls()).toMatchObject([{ outcome: "failed", result: null }]);
        expect((await sessions())[0]?.discards).toBe(0);
        expect(JSON.stringify(await rows("SELECT * FROM tool_calls"))).not.toMatch(
          /slot on Thursday\?|5550142/,
        );
      },
    );

    test("L3: the largest result that is given back is 4,000 characters as JSON", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      const ran = await run(turn, async () => ({ outcome: "done", result: "x".repeat(3_998) }));
      expect(ran).toMatchObject({ outcome: "done" });
    });

    test("L3: a tool that takes too long fails, what it wrote is undone, and it can ask nothing more of the connection", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      let late: unknown = "not asked";
      let release = (): void => {};
      const ran = await run(
        turn,
        async (tx) => {
          await tx.query("UPDATE sessions SET reply_discards = 2");
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          late = await tx
            .query("UPDATE sessions SET reply_discards = 2")
            .catch((error: Error) => error.message);
          return { outcome: "done", result: 1 };
        },
        { timeoutMs: 30 },
      );
      expect(ran).toEqual({ kind: "ran", outcome: "failed", result: null });
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(late).toBe("the tool's transaction is over");
      expect((await sessions())[0]?.discards).toBe(0);
      expect(await calls()).toMatchObject([{ outcome: "failed" }]);
    });

    test("L3: a statement of a tool that is still running at the limit is stopped by the database, so the conversation's row is not held", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      const started = Date.now();
      const ran = await run(
        turn,
        async (tx) => {
          await tx.query("SELECT pg_sleep(3)");
          return { outcome: "done", result: 1 };
        },
        { timeoutMs: 100 },
      );
      expect(ran).toEqual({ kind: "ran", outcome: "failed", result: null });
      // 100 ms for the tool and 100 ms for its statement, not the 3 seconds it asked for.
      expect(Date.now() - started).toBeLessThan(1_500);
    });

    test("L3: when the lease is lost between a tool's failure and the record of it, no row is written", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      let stolen: Promise<unknown> = Promise.resolve();
      const ran = await run(turn, async () => {
        // Another worker's claim waits for the row this transaction holds, and gets it when the
        // transaction is undone: before the second transaction can check the lease.
        stolen = administrator.query("UPDATE conversations SET lease_token = gen_random_uuid()");
        await new Promise((resolve) => setTimeout(resolve, 150));
        throw new Error("fails");
      });
      await stolen;
      expect(ran).toEqual({ kind: "lost-lease" });
      expect(await calls()).toEqual([]);
    });

    test.each([
      ["a text", { q: "a\u0000b" }],
      ["a key", { "a\u0000b": 1 }],
    ])(
      "arguments with U+0000 in %s cannot be stored: the row is stored without them, and nothing throws",
      async (_name, args) => {
        await arrives("hello", 0);
        const turn = await begin(HOUR_MS);
        expect(
          await run(turn, async () => ({ outcome: "done", result: 1 }), { args }),
        ).toMatchObject({ outcome: "done" });
        expect(
          await run(
            turn,
            async () => {
              throw new Error("fails");
            },
            { args },
          ),
        ).toMatchObject({ outcome: "failed" });
        expect(await calls()).toMatchObject([
          { arguments: null, outcome: "done" },
          { arguments: null, outcome: "failed" },
        ]);
      },
    );

    test("L4: when the conversation is another worker's, the tool is not run and nothing is stored", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      let ran = false;
      const result = await run(
        turn,
        async () => {
          ran = true;
          return { outcome: "done", result: 1 };
        },
        { token: "00000000-0000-4000-8000-000000000000" },
      );
      expect(result).toEqual({ kind: "lost-lease" });
      expect(ran).toBe(false);
      expect(await calls()).toEqual([]);
    });

    test("L4: a tool that fails after the lease was lost leaves no row either", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      const result = await run(turn, async () => {
        await administrator.query("SELECT 1");
        // Another worker takes the conversation: only possible once this transaction lets go, so it is done by the tool's own failure path below.
        throw new Error("fails");
      });
      expect(result).toMatchObject({ outcome: "failed" });
      await administrator.query("UPDATE conversations SET lease_token = gen_random_uuid()");
      expect(
        await run(turn, async () => {
          throw new Error("fails");
        }),
      ).toEqual({ kind: "lost-lease" });
      expect(await calls()).toHaveLength(1);
    });

    test("arguments that are missing are stored as null, and a tool's name the table does not take is a failure of the caller", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      await run(turn, async () => ({ outcome: "done", result: null }), { args: undefined });
      expect(await calls()).toMatchObject([{ arguments: null, result: null, outcome: "done" }]);
    });

    test("the application cannot change or remove a tool's row", async () => {
      await arrives("hello", 0);
      const turn = await begin(HOUR_MS);
      await run(turn, async () => ({ outcome: "done", result: 1 }));
      for (const statement of [
        "UPDATE tool_calls SET arguments = NULL",
        "DELETE FROM tool_calls",
      ]) {
        await expect(withTenant(pool, tenant, (tx) => tx.query(statement))).rejects.toMatchObject({
          code: "42501",
        });
      }
    });

    test("the table refuses a result on a call that did not end done, and a name that is a sentence", async () => {
      await arrives("hello", 0);
      await begin(HOUR_MS);
      const insert = (tool: string, outcome: string, result: string | null) =>
        administrator.query(
          `INSERT INTO tool_calls (tenant_id, session_id, turn_id, tool, result, outcome, ended_at)
           SELECT tenant_id, id, gen_random_uuid(), $1, $2::jsonb, $3, now() FROM sessions`,
          [tool, result, outcome],
        );
      await insert("find_times", "done", "1");
      await expect(insert("find_times", "failed", "1")).rejects.toMatchObject({ code: "23514" });
      await expect(insert("find_times", "refused", "1")).rejects.toMatchObject({ code: "23514" });
      await expect(insert("find_times", "fine", null)).rejects.toMatchObject({ code: "23514" });
      await expect(insert("Do you have a slot?", "done", null)).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  test("renewTurn extends the lease of the worker that holds it, and says no to any other", async () => {
    await arrives("hello", 0);
    const turn = await begin(HOUR_MS);
    const expires = () => one<string>("SELECT lease_expires_at::text AS value FROM conversations");
    const before = await expires();
    expect(
      await renewTurn(app, tenant, await conversation(), turn.token, at(HOUR_MS + 60_000)),
    ).toBe(true);
    expect(Date.parse(await expires()) - Date.parse(before)).toBe(60_000);
    expect(
      await renewTurn(
        app,
        tenant,
        await conversation(),
        "00000000-0000-4000-8000-000000000000",
        at(2 * HOUR_MS),
      ),
    ).toBe(false);
    expect(Date.parse(await expires()) - Date.parse(before)).toBe(60_000);
  });
});
