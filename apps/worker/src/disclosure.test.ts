// The disclosure and the answer to "am I talking to a person?" (M3 unit
// U8; design note docs/design/notes/m3-u8-fixed-texts.md, sections 4 to
// 6; US-C5). The model is a scripted adapter and the channel is the
// in-memory one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bounded, FakeLlmAdapter, type FakeStep, loadPrompt } from "@polyglot-sales-agent/ai";
import type { Channel } from "@polyglot-sales-agent/channel";
import {
  createMockChannel,
  MOCK_ACCESS_TOKEN,
  type MockChannel,
} from "@polyglot-sales-agent/channel-mock";
import {
  BATCH_MAX_MS,
  FIXED_TEXTS_VERSION,
  type FixedTextSet,
  fixedTextSet,
  MODEL_FLAGS,
  PART_SEPARATOR,
  REPLY_MAX,
  readProfileFile,
} from "@polyglot-sales-agent/core";
import {
  APP_ROLE,
  CROSS_ROLE,
  type Database,
  replaceProfile,
  storeInbound,
  workOnce,
} from "@polyglot-sales-agent/db";
import { adopt, createTestDatabase, type TestDatabase } from "@polyglot-sales-agent/db/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createHandlers } from "./handlers.ts";
import { handoverTeller } from "./handover.ts";
import { loadFixedTexts } from "./texts.ts";
import { traceRecorder } from "./traces.ts";
import {
  FLAGS_FOR_LATER,
  givenTexts,
  HANDOVER_FLAGS,
  REPLY_PROMPT,
  readFlags,
  todayIn,
  UNREADABLE_KINDS,
} from "./turn.ts";

const PROMPT = loadPrompt(
  fileURLToPath(new URL("../../../prompts/", import.meta.url)),
  REPLY_PROMPT.name,
  REPLY_PROMPT.version,
);
const TEXTS = loadFixedTexts(
  fileURLToPath(new URL("../../../texts/", import.meta.url)),
  FIXED_TEXTS_VERSION,
);
const ENGLISH = TEXTS.pick(["en"], "en").texts;
const TOLD = ENGLISH.disclosure;
const NOT_A_PERSON = ENGLISH["automated-assistant"];
const SALON = (() => {
  const read = readProfileFile(
    readFileSync(
      fileURLToPath(
        new URL("../../../packages/core/fixtures/profile.salon.en.json", import.meta.url),
      ),
    ),
  );
  if (!read.ok) {
    throw new Error("the profile fixture does not load");
  }
  return read.profile;
})();
const CUSTOMER = "+15550143";
const ALWAYS_OPEN = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opens: "00:00",
  closes: "24:00",
}));
const NUMBER = "100000000000041";

let database: TestDatabase;
let appPool: pg.Pool;
let crossPool: pg.Pool;
let app: Database;
let cross: Database;
let administrator: pg.Client;
let tenant = "";
let mock: MockChannel;
const reported: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  appPool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 4 });
  crossPool = new pg.Pool({ connectionString: database.url(CROSS_ROLE), max: 2 });
  app = adopt(APP_ROLE, appPool);
  cross = adopt(CROSS_ROLE, crossPool);
  administrator = await database.administrator();
  // The tenant's default language, Arabic, has no texts: the last resort is English.
  const made = await administrator.query<{ id: string }>(
    `INSERT INTO tenants (name, pack, time_zone, default_language)
     VALUES ('Salon', 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
  );
  tenant = made.rows[0]?.id as string;
  await administrator.query(
    "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
    [tenant, NUMBER],
  );
  await replaceProfile(app, tenant, SALON, { operator: "test" });
  // Open at every hour, so that what a handover says does not turn on when the tests run.
  await administrator.query("UPDATE tenants SET business_hours = $2::jsonb WHERE id = $1", [
    tenant,
    JSON.stringify(ALWAYS_OPEN),
  ]);
}, 30_000);

afterAll(async () => {
  await crossPool.end();
  await appPool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query(
    "TRUNCATE early_receipts, handovers, messages, conversations, contacts, jobs CASCADE",
  );
  mock = createMockChannel();
  reported.length = 0;
});

const settled = (): Date => new Date(Date.now() - BATCH_MAX_MS - 1_000);
let serial = 0;
async function arrives(body: string): Promise<void> {
  serial += 1;
  await storeInbound(
    app,
    tenant,
    NUMBER,
    [
      {
        channelMessageId: `wamid.DISCLOSE${serial}`,
        phone: CUSTOMER,
        userId: null,
        kind: "text",
        body,
        sentAt: new Date(),
      },
    ],
    [],
    settled(),
  );
}

const answer = (reply: string, flags: string[] = [], language = "en"): FakeStep => ({
  kind: "answer",
  value: { reply, claims: [], flags, toolCalls: [], language },
});

/** Runs every job that is due. `ahead` moves the queue's clock, to outlast a wait. */
async function work(
  script: FakeStep[],
  channel: Channel = mock,
  ahead = 0,
  texts: FixedTextSet = TEXTS,
): Promise<void> {
  const handlers = createHandlers({
    app,
    channels: { mock: channel },
    accessToken: MOCK_ACCESS_TOKEN,
    report: (event, code) => reported.push(`${event} ${code}`),
    texts,
    model: {
      client: bounded(new FakeLlmAdapter(script), { record: traceRecorder(app) }),
      prompt: PROMPT,
      fragments: {},
      canary: "testcanary0000000000",
      packs: { "faq-only": { name: "faq-only" } },
      texts,
    },
  });
  for (let runs = 0; runs < 50; runs += 1) {
    const outcome = await workOnce(cross, handlers, {
      clock: () => new Date(Date.now() + ahead + 50),
    });
    if (!outcome.ran) {
      return;
    }
  }
  throw new Error("the queue did not empty");
}

/** A customer's message and its turn, answered with this. */
async function exchange(
  reply: string,
  flags: string[] = [],
  channel: Channel = mock,
  language = "en",
): Promise<void> {
  await arrives(`question ${serial + 1}`);
  await work([answer(reply, flags, language)], channel);
}

interface Row {
  body: string | null;
  disclosure: string | null;
  lead: string | null;
  buttons: unknown;
  status: string;
  class: string;
  turn_id: string | null;
  language: string | null;
  channel_message_id: string | null;
}
const outbound = async (): Promise<Row[]> =>
  (
    await administrator.query<Row>(
      `SELECT body, disclosure, lead, buttons, status, class, turn_id, language, channel_message_id
       FROM messages WHERE direction = 'outbound' ORDER BY created_at, id`,
    )
  ).rows;
const sessions = async (): Promise<{ told: boolean }[]> =>
  (
    await administrator.query<{ told: boolean }>(
      "SELECT disclosed_at IS NOT NULL AS told FROM sessions ORDER BY started_at, id",
    )
  ).rows;
/** Lets a message that waits to be tried again go now. */
const endWaits = () =>
  administrator.query(
    "UPDATE messages SET send_not_before = clock_timestamp() WHERE send_not_before IS NOT NULL",
  );
const handovers = async () =>
  (
    await administrator.query(
      `SELECT state, reasons, urgent, session_id IS NOT NULL AS attached
       FROM handovers ORDER BY created_at, id`,
    )
  ).rows;
const bodies = (): string[] => mock.sent.map((message) => message.body);
const fails = (channelMessageId: string) =>
  storeInbound(
    app,
    tenant,
    NUMBER,
    [],
    [{ channelMessageId, status: "failed", errorCode: "131026" }],
  );

describe("the disclosure (US-C5, 1)", () => {
  test("D1, D2, D5: the first message of a session begins with it, the session is then marked, and later messages do not carry it", async () => {
    await exchange("We open in the morning.");
    expect(bodies()).toEqual([`${TOLD}\n\nWe open in the morning.`]);
    expect(await sessions()).toEqual([{ told: true }]);
    await exchange("Yes, on Friday too.");
    await exchange("Goodbye.");
    expect(bodies().slice(1)).toEqual(["Yes, on Friday too.", "Goodbye."]);
    const rows = await outbound();
    // The record keeps the parts apart: the body is the model's reply alone.
    expect(rows.map((row) => [row.disclosure, row.lead, row.body])).toEqual([
      [TOLD, null, "We open in the morning."],
      [null, null, "Yes, on Friday too."],
      [null, null, "Goodbye."],
    ]);
  });

  test("the session is not marked before the channel has accepted the message", async () => {
    let seen: { told: boolean }[] = [];
    const watching: Channel = {
      ...mock,
      async sendText(from, to, body) {
        seen = await sessions();
        return mock.sendText(from, to, body);
      },
    };
    await exchange("Hello.", [], watching);
    expect(seen).toEqual([{ told: false }]);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("D3: a send that fails for good tells nobody: the session is not marked and the next message carries it", async () => {
    mock.failNextSend("131000", false);
    await exchange("first");
    expect(bodies()).toEqual([]);
    expect(await sessions()).toEqual([{ told: false }]);
    await exchange("second");
    expect(bodies()).toEqual([`${TOLD}\n\nsecond`]);
    expect(await sessions()).toEqual([{ told: true }]);
    expect((await outbound()).map((row) => [row.status, row.disclosure])).toEqual([
      ["failed", TOLD],
      ["sent", TOLD],
    ]);
  });

  test("D3: a send whose outcome is not known tells nobody for certain: the session is not marked", async () => {
    mock.failNextSend("timeout", true, true);
    await arrives("question");
    await work([answer("first")]);
    expect(await sessions()).toEqual([{ told: false }]);
  });

  test("D4: the same message, tried again after a failure that may be tried again, still carries it, once", async () => {
    mock.failNextSend("131016", true);
    await arrives("question");
    await work([answer("the reply")]);
    expect(bodies()).toEqual([]);
    expect(await sessions()).toEqual([{ told: false }]);
    await endWaits();
    await work([], mock, 120_000);
    expect(bodies()).toEqual([`${TOLD}\n\nthe reply`]);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("D4: decided afresh at each try: a message that waited while another told the customer goes without it", async () => {
    mock.failNextSend("131016", true);
    await arrives("question");
    await work([answer("the reply")]);
    const [row] = await outbound();
    expect(row?.disclosure).toBe(TOLD);
    // Another message of the session told the customer meanwhile.
    await administrator.query("UPDATE sessions SET disclosed_at = now()");
    await endWaits();
    await work([], mock, 120_000);
    expect(bodies()).toEqual(["the reply"]);
    expect((await outbound())[0]?.disclosure).toBeNull();
  });

  test("D2a: a message the channel accepted and later reports failed told nobody: the mark comes off and the next message carries it", async () => {
    await exchange("first");
    expect(await sessions()).toEqual([{ told: true }]);
    const id = (await outbound())[0]?.channel_message_id as string;
    await fails(id);
    expect((await outbound())[0]?.status).toBe("failed");
    expect(await sessions()).toEqual([{ told: false }]);
    await exchange("second");
    expect(bodies()).toEqual([`${TOLD}\n\nfirst`, `${TOLD}\n\nsecond`]);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("D2a: the mark stays when another message that carried it reached the customer, and when the failed one did not carry it", async () => {
    await exchange("first");
    await exchange("second");
    const [first, second] = await outbound();
    // A later message without the disclosure fails: the customer was still told.
    await fails(second?.channel_message_id as string);
    expect(await sessions()).toEqual([{ told: true }]);
    // Two messages carried it, as after D3's "told twice"; one of them fails.
    await exchange("third");
    await administrator.query(
      "UPDATE messages SET disclosure = $1 WHERE direction = 'outbound' AND body = 'third'",
      [TOLD],
    );
    await fails(first?.channel_message_id as string);
    expect((await outbound()).map((row) => row.status)).toEqual(["failed", "failed", "sent"]);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("D2a: a message without the disclosure reached the customer and the one with it failed: the mark comes off, and the next message carries it", async () => {
    await exchange("first");
    await exchange("second");
    const [first] = await outbound();
    await fails(first?.channel_message_id as string);
    // "second" was read undisclosed; it does not count as telling.
    expect(await sessions()).toEqual([{ told: false }]);
    await exchange("third");
    expect(bodies()[2]).toBe(`${TOLD}\n\nthird`);
  });

  test("a session is marked only by a message that carried the disclosure", async () => {
    // A worker given no texts sends no disclosure: what it sends marks nothing.
    await arrives("question");
    const handlers = createHandlers({
      app,
      channels: { mock },
      accessToken: MOCK_ACCESS_TOKEN,
      model: {
        client: bounded(new FakeLlmAdapter([answer("no texts")]), { record: traceRecorder(app) }),
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
      },
    });
    while ((await workOnce(cross, handlers, { clock: () => new Date(Date.now() + 50) })).ran) {
      // Until the queue is empty.
    }
    expect(bodies()).toEqual(["no texts"]);
    expect(await sessions()).toEqual([{ told: false }]);
  });

  test("R1: a failure the channel reports before the send is recorded is kept and applied: the message is failed, the session unmarked, the next message carries the disclosure", async () => {
    const early: Channel = {
      ...mock,
      async sendText(from, to, body) {
        const result = await mock.sendText(from, to, body);
        if (result.accepted) {
          // The receipt arrives while the worker has not yet stored the acceptance.
          const stored = await fails(result.channelMessageId);
          expect(stored.statusesApplied).toBe(0);
        }
        return result;
      },
    };
    await exchange("first", [], early);
    expect((await outbound()).map((row) => row.status)).toEqual(["failed"]);
    expect(await sessions()).toEqual([{ told: false }]);
    expect((await administrator.query("SELECT 1 FROM early_receipts")).rowCount).toBe(0);
    await exchange("second");
    expect(bodies()[1]).toBe(`${TOLD}\n\nsecond`);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("V2: a failure and then a delivery, both before the send is recorded, end as they would have after it: failed, and not told", async () => {
    const early: Channel = {
      ...mock,
      async sendText(from, to, body) {
        const result = await mock.sendText(from, to, body);
        if (result.accepted) {
          await fails(result.channelMessageId);
          await storeInbound(
            app,
            tenant,
            NUMBER,
            [],
            [{ channelMessageId: result.channelMessageId, status: "delivered", errorCode: null }],
          );
        }
        return result;
      },
    };
    await exchange("first", [], early);
    expect((await outbound()).map((row) => row.status)).toEqual(["failed"]);
    expect(await sessions()).toEqual([{ told: false }]);
  });

  test("V1: a webhook with a failure for one message and a receipt for another, while the other's send is being recorded, ends with both applied", async () => {
    // This runs the path; it does not force the interleaving that deadlocked, and it passed
    // before the order of locks was fixed. That order is what the fix rests on (#334).
    await exchange("first");
    const first = (await outbound())[0]?.channel_message_id as string;
    for (let round = 0; round < 5; round += 1) {
      let webhook: Promise<unknown> = Promise.resolve();
      const racing: Channel = {
        ...mock,
        async sendText(from, to, body) {
          const result = await mock.sendText(from, to, body);
          if (result.accepted) {
            // Not awaited: it runs while the worker records the send.
            webhook = storeInbound(
              app,
              tenant,
              NUMBER,
              [],
              [
                { channelMessageId: first, status: "failed", errorCode: "131026" },
                { channelMessageId: result.channelMessageId, status: "delivered", errorCode: null },
              ],
            );
          }
          return result;
        },
      };
      await exchange(`next ${"abcde"[round]}`, [], racing);
      await webhook;
    }
    const rows = await outbound();
    expect(rows.map((row) => row.status)).toEqual(["failed", ...Array(5).fill("delivered")]);
    expect((await administrator.query("SELECT 1 FROM early_receipts")).rowCount).toBe(0);
    expect(reported).toEqual([]);
  });

  test("the disclosure's language is the message's own before the session's or the contact's last", async () => {
    const synthetic = (language: string) => ({
      language,
      buttons: TEXTS.pick(["en"], "en").buttons,
      texts: { ...ENGLISH, disclosure: `[${language}] told` },
    });
    const many = fixedTextSet([synthetic("en"), synthetic("ur"), synthetic("hi")]) as FixedTextSet;
    mock.failNextSend("131016", true);
    await arrives("question");
    await work([answer("reply", [], "ur")], mock, 0, many);
    // The message waits; meanwhile the session and the contact moved on to Hindi.
    await administrator.query("UPDATE sessions SET language = 'hi'");
    await administrator.query("UPDATE contacts SET last_language = 'hi'");
    await endWaits();
    await work([], mock, 120_000, many);
    expect(bodies()).toEqual(["[ur] told\n\nreply"]);
  });

  test("R1: a delivery reported before the send is recorded is applied too, and the session is marked", async () => {
    const early: Channel = {
      ...mock,
      async sendText(from, to, body) {
        const result = await mock.sendText(from, to, body);
        if (result.accepted) {
          await storeInbound(
            app,
            tenant,
            NUMBER,
            [],
            [{ channelMessageId: result.channelMessageId, status: "delivered", errorCode: null }],
          );
        }
        return result;
      },
    };
    await exchange("first", [], early);
    expect((await outbound()).map((row) => row.status)).toEqual(["delivered"]);
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("a receipt for a message that is not ours is kept for a day at most, once, and one for a message already recorded is not kept", async () => {
    const stray = { channelMessageId: "wamid.NOTOURS", status: "read", errorCode: null } as const;
    await storeInbound(app, tenant, NUMBER, [], [stray]);
    await storeInbound(app, tenant, NUMBER, [], [stray]);
    const kept = () =>
      administrator.query<{ id: string }>("SELECT channel_message_id AS id FROM early_receipts");
    expect((await kept()).rows).toEqual([{ id: "wamid.NOTOURS" }]);
    await administrator.query("UPDATE early_receipts SET created_at = now() - interval '25 hours'");
    await storeInbound(app, tenant, NUMBER, [], [{ ...stray, channelMessageId: "wamid.OTHER" }]);
    expect((await kept()).rows).toEqual([{ id: "wamid.OTHER" }]);
    // A receipt that moves nothing for a message we do have (a repeat) is not kept.
    await exchange("first");
    const id = (await outbound())[0]?.channel_message_id as string;
    await storeInbound(
      app,
      tenant,
      NUMBER,
      [],
      [{ channelMessageId: id, status: "sent", errorCode: null }],
    );
    expect((await kept()).rows).toEqual([{ id: "wamid.OTHER" }]);
  });

  test("D2a: another tenant's receipt with the same identifier is not this session's", async () => {
    await exchange("first");
    const id = (await outbound())[0]?.channel_message_id as string;
    const other = await administrator.query<{ id: string }>(
      `INSERT INTO tenants (name, pack, time_zone, default_language)
       VALUES ('Other', 'faq-only', 'Asia/Riyadh', 'en') RETURNING id`,
    );
    const otherNumber = "100000000000042";
    await administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [other.rows[0]?.id, otherNumber],
    );
    const stored = await storeInbound(
      app,
      other.rows[0]?.id as string,
      otherNumber,
      [],
      [{ channelMessageId: id, status: "failed", errorCode: "131026" }],
    );
    expect(stored.statusesApplied).toBe(0);
    expect((await outbound())[0]?.status).toBe("sent");
    expect(await sessions()).toEqual([{ told: true }]);
    await administrator.query("DELETE FROM early_receipts WHERE tenant_id = $1", [
      other.rows[0]?.id,
    ]);
    await administrator.query("DELETE FROM channel_accounts WHERE tenant_id = $1", [
      other.rows[0]?.id,
    ]);
    await administrator.query("DELETE FROM tenants WHERE id = $1", [other.rows[0]?.id]);
  });

  test("D2a: a delivery or a read receipt changes nothing, and after one a failure moves neither the message nor the mark", async () => {
    await exchange("first");
    const id = (await outbound())[0]?.channel_message_id as string;
    await storeInbound(
      app,
      tenant,
      NUMBER,
      [],
      [{ channelMessageId: id, status: "delivered", errorCode: null }],
    );
    expect(await sessions()).toEqual([{ told: true }]);
    // After "delivered" a failure does not move the message back, and so not the mark.
    await fails(id);
    expect((await outbound())[0]?.status).toBe("delivered");
    expect(await sessions()).toEqual([{ told: true }]);
  });

  test("D6: a new session of the same conversation is told again", async () => {
    await exchange("first");
    await administrator.query(
      `UPDATE sessions SET started_at = started_at - interval '25 hours',
                           last_message_at = last_message_at - interval '25 hours'`,
    );
    await exchange("a day later");
    expect(bodies()).toEqual([`${TOLD}\n\nfirst`, `${TOLD}\n\na day later`]);
    expect(await sessions()).toEqual([{ told: true }, { told: true }]);
  });

  test("the language: the tenant's default has no texts and no translation exists, so the disclosure is in English whatever the reply's language", async () => {
    await exchange("مرحبا", [], mock, "ar");
    expect(bodies()).toEqual([`${TOLD}\n\nمرحبا`]);
  });

  test("G1 to G4 through the database: the turn's language, then the session's, then the contact's last, then the tenant's default; an unsupported turn does not replace the contact's last", async () => {
    const synthetic = (language: string) => ({
      language,
      buttons: TEXTS.pick(["en"], "en").buttons,
      texts: {
        ...ENGLISH,
        disclosure: `[${language}] told`,
        "automated-assistant": `[${language}] not a person`,
      },
    });
    const many = fixedTextSet([synthetic("en"), synthetic("ar"), synthetic("ur"), synthetic("hi")]);
    if (many === undefined) {
      throw new Error("no set");
    }
    const next = async (language: string, flags: string[] = []) => {
      await arrives("question");
      await work([answer("reply", flags, language)], mock, 0, many);
      return bodies().at(-1);
    };
    const untell = () => administrator.query("UPDATE sessions SET disclosed_at = NULL");
    // The turn's own language first: Urdu, though the tenant's default is Arabic.
    expect(await next("ur", ["asks-if-person"])).toBe("[ur] told\n\n[ur] not a person\n\nreply");
    // Bengali is supported and has no texts, and is now the session's and the contact's
    // last too: none of the three has texts, so the tenant's default, Arabic.
    await untell();
    expect(await next("bn")).toBe("[ar] told\n\nreply");
    // An unsupported language replaces neither: the contact's last stays Bengali.
    await untell();
    expect(await next("fr", ["asks-if-person"])).toBe("[ar] told\n\n[ar] not a person\n\nreply");
    expect((await administrator.query("SELECT last_language FROM contacts")).rows).toEqual([
      { last_language: "bn" },
    ]);
    // The model could not tell: the session's language stays, here French, unsupported;
    // the contact's last has no texts; the tenant's default has.
    await untell();
    expect(await next("und")).toBe("[ar] told\n\nreply");
    // The session's language is used when the turn's is unknown.
    await administrator.query("UPDATE sessions SET language = 'hi'");
    await untell();
    expect(await next("und", ["asks-if-person"])).toBe("[hi] told\n\n[hi] not a person\n\nreply");
    // And the contact's last when neither is known.
    await administrator.query("UPDATE sessions SET language = NULL");
    await administrator.query("UPDATE contacts SET last_language = 'ur'");
    await untell();
    expect(await next("und")).toBe("[ur] told\n\nreply");
  });

  test("the model is never shown the disclosure or a fixed text: the next turn's request holds the reply's body alone", async () => {
    await exchange("We open in the morning.", ["asks-if-person"]);
    const adapter = new FakeLlmAdapter([answer("Yes.")]);
    await arrives("And on Friday?");
    const handlers = createHandlers({
      app,
      channels: { mock },
      accessToken: MOCK_ACCESS_TOKEN,
      texts: TEXTS,
      model: {
        client: bounded(adapter, { record: traceRecorder(app) }),
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
        texts: TEXTS,
      },
    });
    while ((await workOnce(cross, handlers, { clock: () => new Date(Date.now() + 50) })).ran) {
      // Until the queue is empty.
    }
    const request = JSON.stringify(adapter.calls[0]);
    expect(request).toContain("We open in the morning.");
    expect(request).not.toContain(TOLD);
    expect(request).not.toContain(NOT_A_PERSON);
  });
});

describe('"am I talking to a person?" (US-C5, 3)', () => {
  test("P1, P4: the flag with a reply: the fixed text before the reply, after the disclosure in a first message; the message is still the assistant's reply, with its turn and language", async () => {
    await exchange("We open in the morning.", ["asks-if-person"]);
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}\n\nWe open in the morning.`]);
    await exchange("Still me.", ["asks-if-person"]);
    expect(bodies()[1]).toBe(`${NOT_A_PERSON}\n\nStill me.`);
    const rows = await outbound();
    expect(
      rows.map((row) => [row.class, row.disclosure, row.lead, row.body, row.language]),
    ).toEqual([
      ["assistant-reply", TOLD, NOT_A_PERSON, "We open in the morning.", "en"],
      ["assistant-reply", null, NOT_A_PERSON, "Still me.", "en"],
    ]);
    expect(rows.every((row) => row.turn_id !== null)).toBe(true);
  });

  test("P2: the flag with an empty reply: the fixed text alone is sent, where an empty reply alone sends nothing", async () => {
    await exchange("", ["asks-if-person"]);
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}`]);
    expect((await outbound()).map((row) => [row.lead, row.body])).toEqual([[NOT_A_PERSON, null]]);
    expect(reported).toEqual([]);
    await exchange("   ", ["asks-if-person"]);
    expect(bodies()[1]).toBe(NOT_A_PERSON);
    // An empty reply with no flag is a failed reply: the fallback (M3 U9).
    await exchange("");
    expect(bodies()[2]).toBe(ENGLISH.fallback);
    expect(reported).toEqual(["reply-blocked length-empty"]);
  });

  test("P3: no flag, or another flag: the reply as it is", async () => {
    await exchange("first");
    await exchange("second", ["asks-to-stop", "asks-to-resume"]);
    expect(bodies().slice(1)).toEqual(["second"]);
    expect((await outbound()).map((row) => row.lead)).toEqual([null, null]);
  });

  test("the flag beside other flags still gets the fixed text: the others are dropped until their unit", async () => {
    await exchange("Reply.", ["asks-to-resume", "asks-if-person", "asks-to-stop"]);
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}\n\nReply.`]);
  });

  test("D10: the longest first message there can be is sent: the disclosure, the fixed text and a reply of 1,200", async () => {
    const reply = "r".repeat(REPLY_MAX);
    await exchange(reply, ["asks-if-person"]);
    expect(bodies()).toEqual([[TOLD, NOT_A_PERSON, reply].join(PART_SEPARATOR)]);
    expect(reported).toEqual([]);
  });
});

describe("buttons on a sent message (section 6, D9)", () => {
  const BUTTONS = [
    { payload: "core.person", title: "Talk to a person" },
    { payload: "core.stop", title: "Stop messages" },
  ];
  /** A message with buttons, as a later unit will store one. */
  async function waiting(
    buttons: unknown,
    body = "Sorry, I could not answer that.",
  ): Promise<void> {
    await exchange("first");
    await administrator.query(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                             status, buttons)
       SELECT tenant_id, conversation_id, session_id, 'outbound', 'system-reply', 'text', $1,
              'pending', $2::jsonb
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
      [body, JSON.stringify(buttons)],
    );
    await administrator.query(
      `INSERT INTO jobs (tenant_id, type, payload, run_at)
       SELECT tenant_id, 'send-messages', jsonb_build_object('conversationId', conversation_id),
              now()
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
    );
  }

  test("a message stored with buttons is sent with them, and the record keeps them", async () => {
    await waiting(BUTTONS);
    await work([]);
    expect(mock.sent.at(-1)?.body).toBe("Sorry, I could not answer that.");
    expect(mock.sent.at(-1)?.buttons).toEqual(BUTTONS);
    expect((await outbound()).at(-1)?.buttons).toEqual(BUTTONS);
  });

  test("D9: on a channel that would refuse them the text goes without, and the record then has none", async () => {
    await waiting(BUTTONS);
    const plain: Channel = { ...mock, limits: { ...mock.limits, buttons: null } };
    await work([], plain);
    expect(mock.sent.at(-1)?.body).toBe("Sorry, I could not answer that.");
    expect(mock.sent.at(-1)?.buttons).toEqual([]);
    const row = (await outbound()).at(-1);
    expect([row?.status, row?.buttons]).toEqual(["sent", null]);
  });

  test("D9: a text too long to go with buttons goes without them", async () => {
    await waiting(BUTTONS, "s".repeat(501));
    await work([]);
    expect(mock.sent.at(-1)?.buttons).toEqual([]);
    expect((await outbound()).at(-1)?.buttons).toBeNull();
  });

  test("D9: the disclosure counts toward the limit: a text that fits with buttons alone goes without them as the first of a session", async () => {
    await waiting(BUTTONS, "s".repeat(480));
    await administrator.query("UPDATE sessions SET disclosed_at = NULL");
    await work([]);
    expect(mock.sent.at(-1)?.body).toBe(`${TOLD}\n\n${"s".repeat(480)}`);
    expect(mock.sent.at(-1)?.buttons).toEqual([]);
    expect((await outbound()).at(-1)?.buttons).toBeNull();
  });

  test("the disclosure alone is no message: a row with no body and no lead is not sent, and marks nothing", async () => {
    await exchange("first");
    await administrator.query("UPDATE sessions SET disclosed_at = NULL");
    await administrator.query(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, status)
       SELECT tenant_id, conversation_id, session_id, 'outbound', 'system-reply', 'text', 'pending'
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
    );
    await administrator.query(
      `INSERT INTO jobs (tenant_id, type, payload, run_at)
       SELECT tenant_id, 'send-messages', jsonb_build_object('conversationId', conversation_id),
              now()
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
    );
    await work([]);
    expect(mock.sent).toHaveLength(1);
    expect(await sessions()).toEqual([{ told: false }]);
    expect(reported).toContain("send-failed unsupported-kind");
  });

  test("V3: nor with a body that is only blank", async () => {
    await exchange("first");
    await administrator.query("UPDATE sessions SET disclosed_at = NULL");
    for (const blank of [" ", "\n", "\u200b"]) {
      await administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind,
                               status, body)
         SELECT tenant_id, conversation_id, session_id, 'outbound', 'system-reply', 'text',
                'pending', $1
         FROM messages WHERE direction = 'outbound' AND body = 'first'`,
        [blank],
      );
    }
    await administrator.query(
      `INSERT INTO jobs (tenant_id, type, payload, run_at)
       SELECT tenant_id, 'send-messages', jsonb_build_object('conversationId', conversation_id),
              now()
       FROM messages WHERE direction = 'outbound' AND body = 'first'`,
    );
    await work([]);
    expect(mock.sent).toHaveLength(1);
    expect(await sessions()).toEqual([{ told: false }]);
  });

  test("D9: when the send without them fails, the record still says which buttons the message has: nothing was shown", async () => {
    await waiting(BUTTONS);
    const plain: Channel = { ...mock, limits: { ...mock.limits, buttons: null } };
    mock.failNextSend("131000", false);
    await work([], plain);
    const row = (await outbound()).at(-1);
    expect([row?.status, row?.buttons]).toEqual(["failed", BUTTONS]);
  });

  test("the table refuses buttons that are not a list of one or two, and any of the three columns on a customer's message", async () => {
    const insert = (column: string, value: string, inbound = false) =>
      administrator.query(
        `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                               status, ${column})
         SELECT tenant_id, conversation_id, session_id, direction, class, 'text', 'x', status,
                ${value}
         FROM messages WHERE direction = $1 LIMIT 1`,
        [inbound ? "inbound" : "outbound"],
      );
    await exchange("first");
    await expect(insert("buttons", "'[]'::jsonb")).rejects.toThrow(/buttons_are_buttons/);
    await expect(insert("buttons", "'{}'::jsonb")).rejects.toThrow(/buttons_are_buttons/);
    await expect(insert("buttons", "'[1,2,3]'::jsonb")).rejects.toThrow(/buttons_are_buttons/);
    for (const bad of [
      "[1]",
      "[{}]",
      '[{"payload":"core.stop"}]',
      '[{"payload":"core.stop","title":5}]',
      '[{"payload":null,"title":"Stop"}]',
      '["core.stop"]',
    ]) {
      await expect(insert("buttons", `'${bad}'::jsonb`)).rejects.toThrow(
        /messages_buttons_are_buttons/,
      );
    }
    for (const bad of [
      '[[{"payload":"a","title":"b"}]]',
      '[{"payload":["x"],"title":"t"}]',
      '[{"payload":"a","title":["t"]}]',
      '[{"payload":"","title":""}]',
      '[{"payload":"a","title":" "}]',
      '[{"payload":"a","title":"b","more":1}]',
      "[null]",
    ]) {
      await expect(insert("buttons", `'${bad}'::jsonb`), bad).rejects.toThrow(
        /messages_buttons_are_buttons/,
      );
    }
    await expect(insert("lead", "E'\\r\\n'")).rejects.toThrow(/not_blank/);
    await expect(insert("lead", "E' \\n '")).rejects.toThrow(/not_blank/);
    await expect(insert("disclosure", "'   '")).rejects.toThrow(/not_blank/);
    await expect(insert("lead", "''")).rejects.toThrow(/check/);
    await expect(insert("disclosure", `'${"d".repeat(151)}'`)).rejects.toThrow(/check/);
    await expect(
      insert("buttons", `'[{"payload":"core.stop","title":"Stop"}]'::jsonb`),
    ).resolves.toBeDefined();
    for (const [column, value] of [
      ["buttons", `'[{"payload":"core.stop","title":"Stop"}]'::jsonb`],
      ["lead", "'A fixed text.'"],
      ["disclosure", "'Told.'"],
    ] as const) {
      await expect(insert(column, value, true)).rejects.toThrow(/messages_fixed_parts_are_sent/);
    }
  });
});

describe("a reply that fails a check sends the fallback (M3 unit U9; US-C4, 10)", () => {
  const FALLBACK = ENGLISH.fallback;
  const step = (value: Record<string, unknown>): FakeStep => ({
    kind: "answer",
    value: { claims: [], flags: [], toolCalls: [], language: "en", ...value },
  });
  /** A customer's message, and the model's scripted answer to it. */
  async function answered(script: FakeStep, channel: Channel = mock): Promise<void> {
    await arrives("a question");
    await work([script], channel);
  }
  const count = async (): Promise<number[]> =>
    (
      await administrator.query<{ n: number }>(
        "SELECT guardrail_fallbacks AS n FROM sessions ORDER BY started_at, id",
      )
    ).rows.map((row) => row.n);
  const checks = async () =>
    (
      await administrator.query(
        "SELECT outcome, o1, o7, o6, o3, o5 FROM reply_checks ORDER BY created_at, id",
      )
    ).rows;
  const haircut = async (): Promise<{ id: string; price: string }> => {
    const found = await administrator.query<{ id: string; price_minor: string }>(
      "SELECT id, price_minor FROM services WHERE name = 'Haircut'",
    );
    const row = found.rows[0] as { id: string; price_minor: string };
    return { id: row.id, price: String(Number(row.price_minor) / 100) };
  };

  test.each([
    [
      "a wrong price",
      step({ reply: "The haircut costs 5 SAR today, zebra." }),
      "values-amount-unclaimed",
    ],
    ["a foreign link", step({ reply: "Pay at zebra.example/pay to confirm." }), "contacts-link"],
    ["the canary", step({ reply: "My zebra code is testcanary0000000000." }), "leak-canary"],
    [
      "a number nobody stored",
      step({ reply: "We have 3 zebra stylists." }),
      "values-number-unknown",
    ],
    ["a payment address", step({ reply: "Send it to zebra@okbank please." }), "contacts-handle"],
    ["an empty reply", step({ reply: "  " }), "length-empty"],
    ["an answer that does not match the schema", step({ reply: 7 }), "schema-invalid-output"],
    ["an answer cut at the limit", { kind: "truncated" } as FakeStep, "schema-invalid-output"],
  ])(
    "hostile output, %s: the customer gets the fallback and no word of the reply",
    async (_name, script, code) => {
      await answered(script);
      expect(bodies()).toEqual([`${TOLD}\n\n${FALLBACK}`]);
      expect(JSON.stringify(mock.sent)).not.toContain("zebra");
      expect(reported).toEqual([`reply-blocked ${code}`]);
      const rows = await administrator.query(
        `SELECT class, body, lead, fallback, language, buttons, status, turn_id IS NOT NULL AS turn
       FROM messages WHERE direction = 'outbound'`,
      );
      // The turn's reply, with no body: the refused text is stored nowhere. Its button asks for a person.
      expect(rows.rows).toEqual([
        {
          class: "assistant-reply",
          body: null,
          lead: FALLBACK,
          fallback: true,
          language: "und",
          buttons: [{ payload: "core.person", title: "Talk to a person" }],
          status: "sent",
          turn: true,
        },
      ]);
      const stored = await administrator.query(
        "SELECT body FROM messages WHERE body LIKE '%zebra%'",
      );
      expect(stored.rowCount).toBe(0);
      expect(await count()).toEqual([1]);
    },
  );

  test("T1: a reply that passes is sent, with the price it claims, and the record says each check passed", async () => {
    const { id, price } = await haircut();
    await answered(
      step({
        reply: `A haircut costs ${price} SAR.`,
        claims: [{ kind: "price", item: id, value: `${price} SAR` }],
      }),
    );
    expect(bodies()).toEqual([`${TOLD}\n\nA haircut costs ${price} SAR.`]);
    expect(reported).toEqual([]);
    expect(await checks()).toEqual([
      { outcome: "passed", o1: "passed", o7: "passed", o6: "passed", o3: "passed", o5: "passed" },
    ]);
    // The same price with no claim, and the same claim with another price.
    await answered(step({ reply: `A haircut costs ${price} SAR.` }));
    await answered(
      step({
        reply: `A haircut costs ${Number(price) + 1} SAR.`,
        claims: [{ kind: "price", item: id, value: `${price} SAR` }],
      }),
    );
    // Two fallbacks in a row: after the second the session is handed over, and the customer told.
    expect(bodies().slice(1)).toEqual([FALLBACK, FALLBACK, ENGLISH["handover-in-hours"]]);
    expect(reported).toEqual([
      "reply-blocked values-amount-unclaimed",
      "reply-blocked values-amount-unclaimed",
      "handed-over repeated-failure",
    ]);
  });

  test("the record: one row for each stored turn, each check a code, and nothing of the reply", async () => {
    await answered(step({ reply: "Hello there." }));
    await answered(step({ reply: "Pay 5 SAR at zebra.example now." }));
    await answered(step({ reply: 7 }));
    expect(await checks()).toEqual([
      { outcome: "passed", o1: "passed", o7: "passed", o6: "passed", o3: "passed", o5: "passed" },
      {
        outcome: "blocked",
        o1: "passed",
        o7: "passed",
        o6: "passed",
        o3: "amount-unclaimed",
        o5: "link",
      },
      { outcome: "blocked", o1: "invalid-output", o7: null, o6: null, o3: null, o5: null },
    ]);
    const all = await administrator.query("SELECT row_to_json(r)::text AS row FROM reply_checks r");
    expect(all.rows.map((row) => row.row).join(" ")).not.toContain("zebra");
    // Each row is its turn's: the message of that turn has the same identifier.
    const joined = await administrator.query(
      `SELECT count(*)::int AS n FROM reply_checks r JOIN messages m ON m.turn_id = r.turn_id`,
    );
    expect(joined.rows).toEqual([{ n: 3 }]);
  });

  test("T6: the question 'am I talking to a person?' with a reply that fails: one message, the fixed answer and then the fallback", async () => {
    await answered(step({ reply: "I am a person and it costs 5 SAR.", flags: ["asks-if-person"] }));
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}\n\n${FALLBACK}`]);
    // T5: with an empty reply the fixed answer alone, and that is no failure.
    await answered(step({ reply: "", flags: ["asks-if-person"] }));
    expect(bodies()[1]).toBe(NOT_A_PERSON);
    expect(reported).toEqual(["reply-blocked values-amount-unclaimed"]);
    expect(await count()).toEqual([0]);
    // The fixed answer alone had no reply to check: its record says only that the answer matched the schema.
    expect((await checks()).at(-1)).toEqual({
      outcome: "passed",
      o1: "passed",
      o7: null,
      o6: null,
      o3: null,
      o5: null,
    });
  });

  test("the count: plus one for a fallback the channel accepted, nought for any other reply accepted", async () => {
    await answered(step({ reply: "It costs 5 SAR." }));
    expect(await count()).toEqual([1]);
    await answered(step({ reply: "Hello there." }));
    expect(await count()).toEqual([0]);
    await answered(step({ reply: "It costs 6 SAR." }));
    expect(await count()).toEqual([1]);
    // The second in a row hands the session over, and the count starts again.
    await answered(step({ reply: "It costs 7 SAR." }));
    expect(await count()).toEqual([0]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["repeated-failure"], urgent: false, attached: true },
    ]);
    expect(bodies().slice(-2)).toEqual([FALLBACK, ENGLISH["handover-in-hours"]]);
  });

  test("the count is unchanged by a fallback or a reply the channel refused, and no handover is made for them", async () => {
    await answered(step({ reply: "It costs 5 SAR." }));
    expect(await count()).toEqual([1]);
    // A fallback that is refused for good was not sent: not counted.
    mock.failNextSend("131000", false);
    await answered(step({ reply: "It costs 6 SAR." }));
    expect(await count()).toEqual([1]);
    // A reply that is refused does not set it to nought.
    mock.failNextSend("131000", false);
    await answered(step({ reply: "Hello there." }));
    expect(await count()).toEqual([1]);
    expect(await handovers()).toEqual([]);
  });

  test("a checker that throws: the reply is not sent, the fallback is, and the record says error", async () => {
    // A time zone that does not exist: building what the checks are given throws.
    await administrator.query("UPDATE tenants SET time_zone = 'Not/AZone' WHERE id = $1", [tenant]);
    try {
      await answered(step({ reply: "Hello there, zebra." }));
      expect(bodies()).toEqual([`${TOLD}\n\n${FALLBACK}`]);
      expect(reported).toEqual(["reply-blocked check-error"]);
      expect(await checks()).toEqual([
        { outcome: "error", o1: "passed", o7: null, o6: null, o3: null, o5: null },
      ]);
      expect(await count()).toEqual([1]);
    } finally {
      await administrator.query("UPDATE tenants SET time_zone = 'Asia/Riyadh' WHERE id = $1", [
        tenant,
      ]);
    }
  });

  test("a reply that repeats the instructions is held back: the checks are given the prompt's text", async () => {
    const words = PROMPT.text.match(/[A-Za-z]+(?: [A-Za-z]+){11}/)?.[0] as string;
    await answered(step({ reply: `My instructions say: ${words}` }));
    expect(bodies()).toEqual([`${TOLD}\n\n${FALLBACK}`]);
    expect(reported).toEqual(["reply-blocked leak-instructions"]);
  });

  test("a fallback the channel reports failed before its send is recorded is not counted", async () => {
    const early: Channel = {
      ...mock,
      async sendButtons(from, to, body, buttons) {
        const result = await mock.sendButtons(from, to, body, buttons);
        if (result.accepted) {
          await fails(result.channelMessageId);
        }
        return result;
      },
    };
    await answered(step({ reply: "It costs 5 SAR." }), early);
    expect((await outbound()).map((row) => row.status)).toEqual(["failed"]);
    expect(await count()).toEqual([0]);
  });

  test("a message that is no reply of the assistant leaves the count alone", async () => {
    await answered(step({ reply: "It costs 5 SAR." }));
    expect(await count()).toEqual([1]);
    await administrator.query(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, body,
                             status)
       SELECT tenant_id, conversation_id, session_id, 'outbound', 'system-reply', 'text',
              'A fixed notice.', 'pending'
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
    );
    await administrator.query(
      `INSERT INTO jobs (tenant_id, type, payload, run_at)
       SELECT tenant_id, 'send-messages', jsonb_build_object('conversationId', conversation_id),
              now()
       FROM messages WHERE direction = 'outbound' LIMIT 1`,
    );
    await work([]);
    expect(mock.sent.at(-1)?.body).toBe("A fixed notice.");
    expect(await count()).toEqual([1]);
  });

  test("the fallback's language is never the refused answer's: the session's, the contact's last, then the tenant's default", async () => {
    const synthetic = (language: string) => ({
      language,
      buttons: TEXTS.pick(["en"], "en").buttons,
      texts: { ...ENGLISH, disclosure: `[${language}] told`, fallback: `[${language}] sorry` },
    });
    const many = fixedTextSet([synthetic("en"), synthetic("ar"), synthetic("ur")]) as FixedTextSet;
    await arrives("a question");
    await work([step({ reply: "It costs 5 SAR.", language: "ur" })], mock, 0, many);
    // Urdu has texts and the answer said Urdu; the tenant's default, Arabic, is what is used.
    expect(bodies()).toEqual(["[ar] told\n\n[ar] sorry"]);
    const stored = await administrator.query(
      "SELECT language FROM messages WHERE direction = 'outbound'",
    );
    expect(stored.rows).toEqual([{ language: "und" }]);
  });

  test("a new session starts at nought", async () => {
    await answered(step({ reply: "It costs 5 SAR." }));
    await administrator.query(
      `UPDATE sessions SET started_at = started_at - interval '25 hours',
                           last_message_at = last_message_at - interval '25 hours'`,
    );
    await answered(step({ reply: "It costs 6 SAR." }));
    expect(await count()).toEqual([1, 1]);
  });

  test("a fallback not yet sent is discarded for a newer message, as a reply is, and the batch is answered again (US-C11, 2)", async () => {
    mock.failNextSend("131016", true);
    await answered(step({ reply: "It costs 5 SAR." }));
    expect(bodies()).toEqual([]);
    expect(await count()).toEqual([0]);
    await endWaits();
    await answered(step({ reply: "Hello to both." }));
    expect(bodies()).toEqual([`${TOLD}\n\nHello to both.`]);
    expect((await outbound()).map((row) => [row.status, row.lead === FALLBACK])).toEqual([
      ["discarded", true],
      ["sent", false],
    ]);
    expect(await count()).toEqual([0]);
  });

  test("what a refused answer said of the language is neither stored nor used", async () => {
    await answered(step({ reply: "It costs 5 SAR.", language: "fr" }));
    const session = await administrator.query(
      "SELECT language, unsupported_language FROM sessions",
    );
    expect(session.rows).toEqual([{ language: null, unsupported_language: false }]);
    expect((await administrator.query("SELECT last_language FROM contacts")).rows).toEqual([
      { last_language: null },
    ]);
  });

  test("the model is not shown the fallback or the refused reply: the next request holds neither", async () => {
    await answered(step({ reply: "The zebra price is 5 SAR." }));
    const adapter = new FakeLlmAdapter([step({ reply: "Hello again." })]);
    await arrives("and now?");
    const handlers = createHandlers({
      app,
      channels: { mock },
      accessToken: MOCK_ACCESS_TOKEN,
      texts: TEXTS,
      model: {
        client: bounded(adapter, { record: traceRecorder(app) }),
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
        texts: TEXTS,
      },
    });
    while ((await workOnce(cross, handlers, { clock: () => new Date(Date.now() + 50) })).ran) {
      // Until the queue is empty.
    }
    const request = JSON.stringify(adapter.calls[0]);
    expect(request).not.toContain("zebra");
    expect(request).not.toContain(FALLBACK);
    expect(request).toContain("a question");
  });

  test("a time the customer wrote in this batch passes, and one from no message of the batch does not", async () => {
    await arrives("can I come at 5 pm?");
    await work([step({ reply: "Let me note 5 pm for you." })]);
    expect(bodies()).toEqual([`${TOLD}\n\nLet me note 5 pm for you.`]);
    await arrives("thanks");
    await work([step({ reply: "See you at 6 pm." })]);
    expect(bodies()[1]).toBe(FALLBACK);
  });

  test("a turn that stores nothing leaves no record: the customer wrote again during the call", async () => {
    await arrives("a question");
    const adapter = new FakeLlmAdapter([step({ reply: "It costs 5 SAR." })]);
    const client = bounded(
      {
        generate: async (request, signal) => {
          await arrives("one more thing");
          return adapter.generate(request, signal);
        },
        health: async () => ({ ok: true }),
      },
      { record: traceRecorder(app) },
    );
    const handlers = createHandlers({
      app,
      channels: { mock },
      accessToken: MOCK_ACCESS_TOKEN,
      report: (event, code) => reported.push(`${event} ${code}`),
      texts: TEXTS,
      model: {
        client,
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
        texts: TEXTS,
      },
    });
    await workOnce(cross, handlers, { clock: () => new Date(Date.now() + 50) });
    expect(await checks()).toEqual([]);
    expect(reported).toEqual([]);
    expect(await outbound()).toEqual([]);
  });
});

describe("the flags are read in one place (guardrail policy, O2)", () => {
  test("the question about a person, the four flags that hand over, and the two that are named for a later unit", () => {
    expect(readFlags(["asks-if-person", "emergency", "asks-to-stop", "asks-for-person"])).toEqual({
      answerIsAutomated: true,
      handover: ["requested", "emergency"],
      dropped: ["asks-to-stop"],
    });
    expect(readFlags([])).toEqual({ answerIsAutomated: false, handover: [], dropped: [] });
    // Every flag the model can set is either acted on, hands over, or is named for a later unit.
    expect(
      [
        "asks-if-person",
        ...HANDOVER_FLAGS.map(([flag]) => flag),
        ...Object.keys(FLAGS_FOR_LATER),
      ].sort(),
    ).toEqual([...MODEL_FLAGS].sort());
  });

  test("today's date is the business's, not the server's", () => {
    const at = new Date("2026-11-26T21:30:00Z");
    expect(todayIn("Asia/Riyadh", at)).toEqual({ year: 2026, month: 11, day: 27 });
    expect(todayIn("America/Los_Angeles", at)).toEqual({ year: 2026, month: 11, day: 26 });
    expect(() => todayIn("Not/AZone", at)).toThrow();
  });

  test("the texts given to the checks are the ones the model was given: cut where the batch was cut", () => {
    const long = "a".repeat(20_000);
    const given = givenTexts([
      { kind: "text", body: long },
      { kind: "image", body: null },
      { kind: "text", body: "at 5 pm" },
    ]);
    expect(given.join("").length).toBeLessThan(long.length);
    expect(givenTexts([{ kind: "button", body: null }])).toEqual([]);
  });
});

describe("the handover record (M3 unit U11; US-C6)", () => {
  const FALLBACK = ENGLISH.fallback;
  const WILL_REPLY = ENGLISH["handover-in-hours"];
  const step = (value: Record<string, unknown>): FakeStep => ({
    kind: "answer",
    value: { claims: [], flags: [], toolCalls: [], language: "en", ...value },
  });
  /** The customer's messages of one batch: texts, and "TAP" for a tap on the person button. */
  async function batch(...parts: string[]): Promise<void> {
    serial += 1;
    await storeInbound(
      app,
      tenant,
      NUMBER,
      parts.map((part, index) => ({
        channelMessageId: `wamid.HANDOVER${serial}.${index}`,
        phone: CUSTOMER,
        userId: null,
        kind: part === "TAP" ? "button" : "text",
        body: part === "TAP" ? null : part,
        ...(part === "TAP" ? { buttonPayload: "core.person" } : {}),
        sentAt: new Date(),
      })),
      [],
      settled(),
    );
  }
  /** Runs the queue with a model that counts its calls. */
  async function run(script: FakeStep[], channel: Channel = mock, ahead = 0): Promise<number> {
    const adapter = new FakeLlmAdapter(script);
    const handlers = createHandlers({
      app,
      channels: { mock: channel },
      accessToken: MOCK_ACCESS_TOKEN,
      report: (event, code) => reported.push(`${event} ${code}`),
      texts: TEXTS,
      model: {
        client: bounded(adapter, { record: traceRecorder(app) }),
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
        texts: TEXTS,
      },
    });
    for (let runs = 0; runs < 50; runs += 1) {
      const clock = () => new Date(Date.now() + ahead + 50);
      if (!(await workOnce(cross, handlers, { clock })).ran) {
        return adapter.calls.length;
      }
    }
    throw new Error("the queue did not empty");
  }
  const tellings = async () =>
    (
      await administrator.query(
        `SELECT class, tells, status, handover_id IS NOT NULL AS of FROM messages
         WHERE direction = 'outbound' ORDER BY created_at, id`,
      )
    ).rows;
  const unhandled = async (): Promise<number> =>
    (
      await administrator.query(
        "SELECT 1 FROM messages WHERE direction = 'inbound' AND handled_at IS NULL",
      )
    ).rowCount ?? 0;
  const setHours = (hours: unknown) =>
    administrator.query("UPDATE tenants SET business_hours = $2::jsonb WHERE id = $1", [
      tenant,
      JSON.stringify(hours),
    ]);

  test("G1: a tap on the person button alone hands over without the model, and the customer is told once", async () => {
    await batch("TAP");
    expect(await run([])).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["requested"], urgent: false, attached: true },
    ]);
    expect(await tellings()).toEqual([
      { class: "system-reply", tells: "handover", status: "sent", of: true },
    ]);
    expect(reported).toEqual(["handed-over requested"]);
    expect(await unhandled()).toBe(0);
  });

  test("G1 with text beside the tap: the model is given the text so that its flags are read, and the handover is made whatever it answers", async () => {
    await batch("TAP", "he fell and will not wake");
    expect(await run([step({ reply: "Call for help.", flags: ["emergency"] })])).toBe(1);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["requested", "emergency"], urgent: true, attached: true },
    ]);
    expect(reported).toEqual(["handed-over requested", "handed-over emergency"]);
  });

  test("G1 with text, and an answer that does not match the schema: handed over all the same, with no fallback", async () => {
    await batch("TAP", "hello");
    expect(await run([step({ reply: 7 })])).toBe(1);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    expect((await handovers()).map((row) => row.reasons)).toEqual([["requested"]]);
    const checks = await administrator.query("SELECT outcome, o1 FROM reply_checks");
    expect(checks.rows).toEqual([{ outcome: "handed-over", o1: "invalid-output" }]);
  });

  test.each([
    ["G2", ["asks-for-person"], ["requested"]],
    ["G3", ["sensitive-topic"], ["sensitive-topic"]],
    ["G4", ["data-request"], ["data-request"]],
    [
      "G2 to G4 together",
      ["data-request", "asks-for-person", "sensitive-topic"],
      ["requested", "sensitive-topic", "data-request"],
    ],
  ])(
    "%s: the flag hands over, and the model's reply is discarded unchecked (O2; US-C11, 4)",
    async (_name, flags, reasons) => {
      await batch("I want a refund and a person, zebra");
      await run([step({ reply: "Your zebra refund of 5 SAR is at evil.example", flags })]);
      expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
      expect(JSON.stringify(mock.sent)).not.toContain("zebra");
      expect(await handovers()).toEqual([
        { state: "waiting", reasons, urgent: false, attached: true },
      ]);
      expect(reported).toEqual(reasons.map((reason) => `handed-over ${reason}`));
      // The record: the answer matched the schema, and no other check ran.
      const checks = await administrator.query("SELECT outcome, o1, o3 FROM reply_checks");
      expect(checks.rows).toEqual([{ outcome: "handed-over", o1: "passed", o3: null }]);
      // What the refused answer said of the language is not kept.
      expect((await administrator.query("SELECT language FROM sessions")).rows).toEqual([
        { language: null },
      ]);
    },
  );

  test("G5: the emergency flag hands over as urgent and sends the emergency text, in place of the handover text", async () => {
    await batch("my friend collapsed");
    await run([step({ reply: "Oh no.", flags: ["emergency"] })]);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["emergency"], urgent: true, attached: true },
    ]);
    expect((await tellings()).map((row) => row.tells)).toEqual(["emergency"]);
  });

  test("with the question 'am I talking to a person?' beside a handover flag, the fixed answer goes first, in the one message", async () => {
    await batch("are you a bot? get me a human");
    await run([step({ reply: "x", flags: ["asks-if-person", "asks-for-person"] })]);
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}\n\n${WILL_REPLY}`]);
  });

  test("S1, H3: a handed-over session is not answered: no model call, no reply, the batch marked, one line", async () => {
    await batch("TAP");
    await run([]);
    reported.length = 0;
    await batch("hello? anyone?");
    expect(await run([step({ reply: "Hello!" })])).toBe(0);
    expect(bodies()).toHaveLength(1);
    expect(await unhandled()).toBe(0);
    expect(reported).toEqual(["turn-skipped handed-over"]);
    // S2: a tap there adds its reason, once, and tells nothing more.
    await batch("my data please");
    await administrator.query("UPDATE handovers SET reasons = ARRAY['data-request']");
    await batch("TAP");
    expect(await run([])).toBe(0);
    await batch("TAP");
    await run([]);
    expect((await handovers()).map((row) => row.reasons)).toEqual([["data-request", "requested"]]);
    expect(bodies()).toHaveLength(1);
  });

  test("G6: two fallbacks in a row hand over when the second is sent, the customer is told, and the count starts again", async () => {
    await batch("one");
    await run([step({ reply: "It costs 5 SAR." })]);
    expect(await handovers()).toEqual([]);
    await batch("two");
    await run([step({ reply: "It costs 6 SAR." })]);
    expect(bodies()).toEqual([`${TOLD}\n\n${FALLBACK}`, FALLBACK, WILL_REPLY]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["repeated-failure"], urgent: false, attached: true },
    ]);
    expect(reported.at(-1)).toBe("handed-over repeated-failure");
    const session = await administrator.query("SELECT guardrail_fallbacks AS n FROM sessions");
    expect(session.rows).toEqual([{ n: 0 }]);
  });

  test("G6: a second fallback the channel refused hands nothing over", async () => {
    await batch("one");
    await run([step({ reply: "It costs 5 SAR." })]);
    mock.failNextSend("131000", false);
    await batch("two");
    await run([step({ reply: "It costs 6 SAR." })]);
    expect(await handovers()).toEqual([]);
  });

  test("S3: a turn that was calling the model when the session was handed over has its reply refused, and its flags applied", async () => {
    await batch("a question");
    const adapter = new FakeLlmAdapter([step({ reply: "Hello there." })]);
    const meanwhile = (flags: string[]) =>
      bounded(
        {
          generate: async (request, signal) => {
            // Handed over by another path while the model is being called.
            await administrator.query(
              `INSERT INTO handovers (tenant_id, contact_id, session_id, state, reasons, attached_at)
               SELECT s.tenant_id, c.contact_id, s.id, 'waiting', ARRAY['repeated-failure'], now()
               FROM sessions s JOIN conversations c ON c.id = s.conversation_id
               ON CONFLICT DO NOTHING`,
            );
            return new FakeLlmAdapter([step({ reply: "Hello there.", flags })]).generate(
              request,
              signal,
            );
          },
          health: async () => ({ ok: true }),
        },
        { record: traceRecorder(app) },
      );
    const handlersWith = (flags: string[]) =>
      createHandlers({
        app,
        channels: { mock },
        accessToken: MOCK_ACCESS_TOKEN,
        report: (event, code) => reported.push(`${event} ${code}`),
        texts: TEXTS,
        model: {
          client: meanwhile(flags),
          prompt: PROMPT,
          fragments: {},
          canary: "testcanary0000000000",
          packs: { "faq-only": { name: "faq-only" } },
          texts: TEXTS,
        },
      });
    expect(adapter.calls).toHaveLength(0);
    while (
      (await workOnce(cross, handlersWith([]), { clock: () => new Date(Date.now() + 50) })).ran
    ) {
      // Until the queue is empty.
    }
    expect(bodies()).toEqual([]);
    expect(await unhandled()).toBe(0);
    expect(reported).toEqual(["turn-skipped handed-over"]);
  });

  test("S4: a reply of the assistant still waiting when the handover is made is discarded, not sent after 'a person will reply'", async () => {
    mock.failNextSend("131016", true);
    await batch("one");
    await run([step({ reply: "Hello there." })]);
    expect((await outbound()).map((row) => row.status)).toEqual(["pending"]);
    // The tap's turn discards the waiting reply and reopens its message, which the model is
    // then given beside the tap; the handover is made whatever it answers.
    await batch("TAP");
    await endWaits();
    await run([step({ reply: "Hello again." })], mock, 120_000);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    expect((await outbound()).map((row) => [row.class, row.status])).toEqual([
      ["assistant-reply", "discarded"],
      ["system-reply", "sent"],
    ]);
  });

  test("a telling is not held back or discarded for a newer message of the customer", async () => {
    mock.failNextSend("131016", true);
    await batch("TAP");
    await run([]);
    expect(bodies()).toEqual([]);
    await batch("hello?");
    await endWaits();
    expect(await run([], mock, 120_000)).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    expect((await tellings()).map((row) => row.status)).toEqual(["sent"]);
  });

  test("told again only when every telling failed: the customer's next message gets the text anew", async () => {
    mock.failNextSend("131000", false);
    await batch("TAP");
    await run([]);
    expect(bodies()).toEqual([]);
    await batch("hello?");
    expect(await run([])).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    await batch("hello again?");
    await run([]);
    expect(bodies()).toHaveLength(1);
    expect((await tellings()).map((row) => row.status)).toEqual(["failed", "sent"]);
  });

  test("R1: a handover attached again whose telling fails is told again, though an earlier attachment's telling was sent", async () => {
    await batch("TAP");
    await run([]);
    await administrator.query(
      `UPDATE sessions SET started_at = started_at - interval '25 hours',
                           last_message_at = last_message_at - interval '25 hours'`,
    );
    await administrator.query(
      "UPDATE messages SET created_at = created_at - interval '25 hours' WHERE tells IS NOT NULL",
    );
    await batch("hello again");
    await run([step({ reply: "Hello there." })]);
    mock.failNextSend("131000", false);
    await batch("TAP");
    await run([]);
    expect((await handovers()).map((row) => row.state)).toEqual(["waiting"]);
    expect((await tellings()).at(-1)).toMatchObject({ tells: "handover", status: "failed" });
    const sentBefore = bodies().length;
    await batch("hello?");
    expect(await run([])).toBe(0);
    expect(bodies().slice(sentBefore)).toEqual([WILL_REPLY]);
  });

  test("an urgent handover whose emergency telling failed is told again with the emergency text, and stays urgent when another reason comes", async () => {
    mock.failNextSend("131000", false);
    await batch("help");
    await run([step({ reply: "x", flags: ["emergency"] })]);
    expect(bodies()).toEqual([]);
    await batch("TAP");
    expect(await run([])).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    // The tap added its reason; the handover is urgent still.
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["emergency", "requested"], urgent: true, attached: true },
    ]);
  });

  test("R3: a tap beside text hands over also when the provider fails, at once and with no retry", async () => {
    await batch("TAP", "hello");
    await run([{ kind: "provider-error", code: "unavailable" }]);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    expect((await handovers()).map((row) => row.reasons)).toEqual([["requested"]]);
    expect((await administrator.query("SELECT 1 FROM jobs")).rowCount).toBe(0);
  });

  test("G6: a second fallback that the channel reports failed before its send is recorded hands nothing over", async () => {
    await batch("one");
    await run([step({ reply: "It costs 5 SAR." })]);
    const early: Channel = {
      ...mock,
      async sendButtons(from, to, body, buttons) {
        const result = await mock.sendButtons(from, to, body, buttons);
        if (result.accepted) {
          await fails(result.channelMessageId);
        }
        return result;
      },
    };
    await batch("two");
    await run([step({ reply: "It costs 6 SAR." })], early);
    expect(await handovers()).toEqual([]);
  });

  test("S5, H-c: when the session ends the handover is detached and the assistant answers again; a new trigger attaches the same record", async () => {
    await batch("TAP");
    await run([]);
    await administrator.query(
      `UPDATE sessions SET started_at = started_at - interval '25 hours',
                           last_message_at = last_message_at - interval '25 hours'`,
    );
    await batch("hello again");
    expect(await run([step({ reply: "Hello there." })])).toBe(1);
    expect(bodies().at(-1)).toBe(`${TOLD}\n\nHello there.`);
    expect(await handovers()).toEqual([
      { state: "detached", reasons: ["requested"], urgent: false, attached: false },
    ]);
    await batch("my data please");
    await run([step({ reply: "x", flags: ["data-request"] })]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["requested", "data-request"], urgent: false, attached: true },
    ]);
    expect(bodies().at(-1)).toBe(WILL_REPLY);
  });

  test("S5a: in M3 a handover is detached 24 hours after it was attached, though the customer went on writing", async () => {
    await batch("TAP");
    await run([]);
    await administrator.query("UPDATE handovers SET attached_at = now() - interval '23 hours'");
    await batch("hello?");
    expect(await run([step({ reply: "Hello there." })])).toBe(0);
    await administrator.query("UPDATE handovers SET attached_at = now() - interval '25 hours'");
    await batch("hello??");
    expect(await run([step({ reply: "Hello there." })])).toBe(1);
    expect(bodies().at(-1)).toBe("Hello there.");
    expect((await handovers()).map((row) => row.state)).toEqual(["detached"]);
    // Detached at the moment the 24 hours ran out, not when that was noticed.
    const when = await administrator.query(
      "SELECT round(extract(epoch FROM detached_at - attached_at) / 3600) AS hours FROM handovers",
    );
    expect(when.rows).toEqual([{ hours: "24" }]);
  });

  test("H-d: a detached handover over fourteen days old is closed as expired when a trigger finds it, and a new one is made", async () => {
    await batch("TAP");
    await run([]);
    await administrator.query(
      `UPDATE handovers SET state = 'detached', session_id = NULL,
                            detached_at = now() - interval '15 days'`,
    );
    await batch("TAP");
    await run([]);
    const rows = await administrator.query(
      "SELECT state, closed_reason FROM handovers ORDER BY created_at, id",
    );
    expect(rows.rows).toEqual([
      { state: "closed-unanswered", closed_reason: "expired" },
      { state: "waiting", closed_reason: null },
    ]);
  });

  test("H-e: the emergency text goes to a contact at most once in sixty minutes", async () => {
    await batch("help");
    await run([step({ reply: "x", flags: ["emergency"] })]);
    // Detached, and an emergency again at once: the handover is attached, with the ordinary text.
    await administrator.query(
      "UPDATE handovers SET state = 'detached', session_id = NULL, detached_at = now()",
    );
    await batch("help again");
    await run([step({ reply: "x", flags: ["emergency"] })]);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`, WILL_REPLY]);
    // More than an hour after the last emergency text: it is sent again.
    await administrator.query(
      `UPDATE messages SET created_at = created_at - interval '61 minutes' WHERE tells = 'emergency'`,
    );
    await administrator.query(
      "UPDATE handovers SET state = 'detached', session_id = NULL, detached_at = now()",
    );
    await batch("help once more");
    await run([step({ reply: "x", flags: ["emergency"] })]);
    expect(bodies().at(-1)).toBe(ENGLISH.emergency);
  });

  test("outside business hours the customer is given the next opening and the support contact; with no hours at all, only that a person will reply", async () => {
    try {
      // Closed every day but one minute of Monday: closed now, whenever this runs, bar that minute.
      await setHours([{ weekday: 1, opens: "03:07", closes: "03:08" }]);
      await batch("TAP");
      await run([]);
      expect(bodies()[0]).toMatch(
        /^You are chatting with an automated assistant\.\n\nWe are closed right now\. A person will reply after we open: \d{4}-\d{2}-\d{2} 03:07\. You can also reach us at \+15550100\.$/,
      );
      await administrator.query(
        "TRUNCATE handovers, messages, conversations, contacts, jobs CASCADE",
      );
      mock = createMockChannel();
      await setHours([]);
      await batch("TAP");
      await run([]);
      expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`]);
    } finally {
      await setHours(ALWAYS_OPEN);
    }
  });

  test("the fallback's button: a tap on it hands over", async () => {
    await batch("one");
    await run([step({ reply: "It costs 5 SAR." })]);
    expect(mock.sent[0]?.buttons).toEqual([{ payload: "core.person", title: "Talk to a person" }]);
    await batch("TAP");
    await run([]);
    expect(bodies().at(-1)).toBe(WILL_REPLY);
  });

  test("the table: one open handover for a contact, a session exactly while waiting, no reason twice, an end exactly when closed", async () => {
    await batch("TAP");
    await run([]);
    const again = (set: string) =>
      administrator.query(
        `INSERT INTO handovers (tenant_id, contact_id, session_id, state, reasons, attached_at, ended_at)
         SELECT tenant_id, contact_id, ${set} FROM handovers LIMIT 1`,
      );
    await expect(again("session_id, 'waiting', ARRAY['requested'], now(), NULL")).rejects.toThrow(
      /handovers_one_open_for_a_contact/,
    );
    await expect(again("NULL, 'detached', ARRAY['requested'], now(), NULL")).rejects.toThrow(
      /handovers_one_open_for_a_contact/,
    );
    await expect(again("NULL, 'waiting', ARRAY['requested'], now(), NULL")).rejects.toThrow(
      /attached_exactly/,
    );
    await expect(
      again("NULL, 'closed-unanswered', ARRAY['requested', 'requested'], now(), now()"),
    ).rejects.toThrow(/no_reason_twice/);
    await expect(again("NULL, 'closed-unanswered', ARRAY[]::text[], now(), now()")).rejects.toThrow(
      /check/,
    );
    await expect(
      again("NULL, 'closed-unanswered', ARRAY['Not A Reason'], now(), now()"),
    ).rejects.toThrow(/no_reason_twice/);
    await expect(
      again("NULL, 'closed-unanswered', ARRAY['requested'], now(), NULL"),
    ).rejects.toThrow(/closed_has_its_end/);
    await expect(
      again("NULL, 'closed-unanswered', ARRAY['requested'], now(), now()"),
    ).resolves.toBeDefined();
  });

  test("the longest telling fits every channel: the disclosure, the fixed answer and a filled text", () => {
    const tell = handoverTeller(TEXTS);
    const longest = tell({
      preferred: ["en"],
      tenantDefault: "en",
      emergency: false,
      answerIsAutomated: true,
      timeZone: "Asia/Riyadh",
      businessHours: [{ weekday: 1, opens: "03:07", closes: "03:08" }],
      supportContact: "x".repeat(254),
      at: new Date("2026-11-27T12:00:00Z"),
    });
    expect(longest).toContain("x".repeat(254));
    expect(`${TOLD}\n\n${longest}`.length).toBeLessThanOrEqual(mock.limits.textMax);
    // A contact the filler refuses, and a time zone that cannot be read: the text that says only that a person will reply.
    const base = {
      preferred: ["en"],
      tenantDefault: "en",
      emergency: false,
      answerIsAutomated: false,
      timeZone: "Asia/Riyadh",
      businessHours: [{ weekday: 1, opens: "03:07", closes: "03:08" }],
      supportContact: "+15550100",
      at: new Date("2026-11-27T12:00:00Z"),
    };
    expect(tell({ ...base, supportContact: "a{b}" })).toBe(WILL_REPLY);
    expect(tell({ ...base, supportContact: null })).toBe(WILL_REPLY);
    expect(tell({ ...base, timeZone: "Not/AZone" })).toBe(WILL_REPLY);
    expect(tell({ ...base, emergency: true })).toBe(ENGLISH.emergency);
  });
});

describe("an emergency phrase and a batch that cannot be read (M3 unit U10, first part)", () => {
  const WILL_REPLY = ENGLISH["handover-in-hours"];
  const CANNOT_READ = ENGLISH["unsupported-type"];
  const step = (value: Record<string, unknown>): FakeStep => ({
    kind: "answer",
    value: { claims: [], flags: [], toolCalls: [], language: "en", ...value },
  });
  /** One batch: a text, "TAP" for the person button, or `kind:` and a stored kind for anything else. */
  async function batch(...parts: string[]): Promise<void> {
    serial += 1;
    await storeInbound(
      app,
      tenant,
      NUMBER,
      parts.map((part, index) => ({
        channelMessageId: `wamid.URGENT${serial}.${index}`,
        phone: CUSTOMER,
        userId: null,
        kind: part === "TAP" ? "button" : part.startsWith("kind:") ? part.slice(5) : "text",
        body: part === "TAP" || part.startsWith("kind:") ? null : part,
        ...(part === "TAP" ? { buttonPayload: "core.person" } : {}),
        sentAt: new Date(),
      })),
      [],
      settled(),
    );
  }
  async function run(script: FakeStep[] = [], channel: Channel = mock): Promise<number> {
    const adapter = new FakeLlmAdapter(script);
    const handlers = createHandlers({
      app,
      channels: { mock: channel },
      accessToken: MOCK_ACCESS_TOKEN,
      report: (event, code) => reported.push(`${event} ${code}`),
      texts: TEXTS,
      model: {
        client: bounded(adapter, { record: traceRecorder(app) }),
        prompt: PROMPT,
        fragments: {},
        canary: "testcanary0000000000",
        packs: { "faq-only": { name: "faq-only" } },
        texts: TEXTS,
      },
    });
    for (let runs = 0; runs < 50; runs += 1) {
      if (!(await workOnce(cross, handlers, { clock: () => new Date(Date.now() + 50) })).ran) {
        return adapter.calls.length;
      }
    }
    throw new Error("the queue did not empty");
  }
  const unhandled = async (): Promise<number> =>
    (
      await administrator.query(
        "SELECT 1 FROM messages WHERE direction = 'inbound' AND handled_at IS NULL",
      )
    ).rowCount ?? 0;
  const count = async (): Promise<number[]> =>
    (
      await administrator.query<{ unreadable_batches: number }>(
        "SELECT unreadable_batches FROM sessions ORDER BY started_at, id",
      )
    ).rows.map((row) => row.unreadable_batches);
  const PERSON = [{ payload: "core.person", title: "Talk to a person" }];

  test("E1: a phrase hands the session over as urgent and sends the emergency text, and the model is not called", async () => {
    await batch("Please help, he is NOT breathing!! Also what are your prices?");
    expect(await run([step({ reply: "Our prices are low." })])).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["emergency"], urgent: true, attached: true },
    ]);
    expect(reported).toEqual(["handed-over emergency"]);
    expect(await unhandled()).toBe(0);
    // No turn with the model: no trace, no record of checks.
    expect((await administrator.query("SELECT 1 FROM reply_checks")).rowCount).toBe(0);
  });

  test("E1: a phrase written over two messages of a batch is found, and a tap beside it keeps its reason", async () => {
    await batch("he is not", "TAP", "breathing");
    expect(await run()).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    expect((await handovers()).map((row) => row.reasons)).toEqual([["emergency", "requested"]]);
  });

  test("E1: a phrase in another language than the session's is found", async () => {
    await batch("أمي لا تتنفس");
    expect(await run()).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
  });

  test("E2: in a session that is handed over, a phrase adds the reason, makes it urgent and sends the text (#339)", async () => {
    await batch("TAP");
    await run();
    await batch("she has stopped breathing");
    expect(await run([step({ reply: "x" })])).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${WILL_REPLY}`, ENGLISH.emergency]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["requested", "emergency"], urgent: true, attached: true },
    ]);
    expect(await unhandled()).toBe(0);
  });

  test("E2a: a phrase in a session handed over more than 24 hours ago keeps it handed over, and the assistant does not answer", async () => {
    await batch("TAP");
    await run();
    await administrator.query("UPDATE handovers SET attached_at = now() - interval '25 hours'");
    await batch("I think this is a heart attack");
    expect(await run([step({ reply: "Hello there." })])).toBe(0);
    expect(bodies().at(-1)).toBe(ENGLISH.emergency);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["requested", "emergency"], urgent: true, attached: true },
    ]);
    // Attached again now: the next message is still not answered by the assistant.
    await batch("hello?");
    expect(await run([step({ reply: "Hello there." })])).toBe(0);
    expect(await unhandled()).toBe(0);
  });

  test("E3: a tenant that is not answering sends the text all the same, and the batch is not left to be tried again", async () => {
    await administrator.query("UPDATE tenants SET business_hours = NULL WHERE id = $1", [tenant]);
    try {
      await batch("he is unconscious");
      expect(await run()).toBe(0);
      expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
      expect(await unhandled()).toBe(0);
      expect((await handovers()).length).toBe(1);
    } finally {
      await administrator.query("UPDATE tenants SET business_hours = $2::jsonb WHERE id = $1", [
        tenant,
        JSON.stringify(ALWAYS_OPEN),
      ]);
    }
  });

  test("E4: a phrase again within sixty minutes sends nothing more", async () => {
    await batch("he is not breathing");
    await run();
    await batch("still not breathing");
    expect(await run()).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${ENGLISH.emergency}`]);
    expect((await handovers()).map((row) => row.reasons)).toEqual([["emergency"]]);
    expect(await unhandled()).toBe(0);
    // Reported once: the second phrase made no handover and sent nothing.
    expect(reported).toEqual(["handed-over emergency"]);
  });

  test("E5: a message with no phrase goes to the model as before, the word emergency included", async () => {
    await batch("Do you take emergency appointments?");
    expect(await run([step({ reply: "Please ask the salon." })])).toBe(1);
    expect(bodies()).toEqual([`${TOLD}\n\nPlease ask the salon.`]);
    expect(await handovers()).toEqual([]);
  });

  test("the kinds that get the reply are these and no other", () => {
    expect([...UNREADABLE_KINDS].sort()).toEqual([
      "audio",
      "contacts",
      "document",
      "image",
      "location",
      "sticker",
      "unsupported",
      "video",
    ]);
  });

  test.each(UNREADABLE_KINDS)(
    "N1: a batch of kind %s and no text gets the unsupported-type reply with the person button",
    async (kind) => {
      await batch(`kind:${kind}`);
      expect(await run()).toBe(0);
      expect(bodies()).toEqual([`${TOLD}\n\n${CANNOT_READ}`]);
      const rows = await outbound();
      expect(rows.map((row) => [row.class, row.buttons, row.turn_id])).toEqual([
        ["system-reply", PERSON, null],
      ]);
      expect(mock.sent[0]?.buttons?.map((button) => button.title)).toEqual(["Talk to a person"]);
      expect(await count()).toEqual([1]);
      expect(await unhandled()).toBe(0);
      expect(reported).toEqual([]);
    },
  );

  test.each(["reaction", "interactive", "quick-reply", "order", "system", "unknown", "poll"])(
    "N4: a batch of kind %s alone is marked and ignored: no reply, not counted",
    async (kind) => {
      await batch(`kind:${kind}`);
      expect(await run()).toBe(0);
      expect(bodies()).toEqual([]);
      expect(await count()).toEqual([0]);
      expect(await unhandled()).toBe(0);
    },
  );

  test("N4: an ignored kind beside one that cannot be read: the reply", async () => {
    await batch("kind:reaction", "kind:audio");
    await run();
    expect(bodies()).toEqual([`${TOLD}\n\n${CANNOT_READ}`]);
    expect(await count()).toEqual([1]);
  });

  test("N2: the third batch in a row hands over with its own reason, and the customer gets the handover text and not the reply; the count starts again", async () => {
    await batch("kind:image");
    await run();
    await batch("kind:audio");
    await run();
    expect(await count()).toEqual([2]);
    await batch("kind:sticker");
    expect(await run()).toBe(0);
    expect(bodies()).toEqual([`${TOLD}\n\n${CANNOT_READ}`, CANNOT_READ, WILL_REPLY]);
    expect(await handovers()).toEqual([
      { state: "waiting", reasons: ["unsupported-content"], urgent: false, attached: true },
    ]);
    expect(reported).toEqual(["handed-over unsupported-content"]);
    expect(await count()).toEqual([0]);
    // N5: handed over now, a fourth picture gets nothing and is not counted.
    await batch("kind:image");
    await run();
    expect(bodies().length).toBe(3);
    expect(await count()).toEqual([0]);
    expect(await unhandled()).toBe(0);
  });

  test("N3: a batch with text between sets the count to 0, whatever the turn stores", async () => {
    await batch("kind:image");
    await run();
    await batch("kind:image");
    await run();
    await batch("What are your hours?");
    expect(await run([step({ reply: "Please ask the salon." })])).toBe(1);
    expect(await count()).toEqual([0]);
    await batch("kind:image");
    await run();
    expect(await count()).toEqual([1]);
    expect(await handovers()).toEqual([]);
  });

  test("N3: a picture with text in the same batch is a batch with text: the model answers and nothing is counted", async () => {
    await batch("kind:image", "Is this style possible?");
    expect(await run([step({ reply: "Please ask the salon." })])).toBe(1);
    expect(bodies()).toEqual([`${TOLD}\n\nPlease ask the salon.`]);
    expect(await count()).toEqual([0]);
  });

  test("N6: for a tenant that is not answering, a batch that cannot be read is marked, with no reply and no count", async () => {
    await administrator.query("UPDATE tenants SET business_hours = NULL WHERE id = $1", [tenant]);
    try {
      await batch("kind:image");
      expect(await run()).toBe(0);
      expect(bodies()).toEqual([]);
      expect(await count()).toEqual([0]);
      expect(await unhandled()).toBe(0);
    } finally {
      await administrator.query("UPDATE tenants SET business_hours = $2::jsonb WHERE id = $1", [
        tenant,
        JSON.stringify(ALWAYS_OPEN),
      ]);
    }
  });

  test("N1: the reply is not held back for a newer message, and the disclosure goes with the first only", async () => {
    await batch("kind:image");
    await batch("kind:image");
    await run();
    // Two messages of one batch: one reply.
    expect(bodies()).toEqual([`${TOLD}\n\n${CANNOT_READ}`]);
    expect(await count()).toEqual([1]);
  });

  test("the count cannot leave 0 to 3", async () => {
    await batch("kind:image");
    await run();
    await expect(administrator.query("UPDATE sessions SET unreadable_batches = 4")).rejects.toThrow(
      /check/,
    );
  });
});
