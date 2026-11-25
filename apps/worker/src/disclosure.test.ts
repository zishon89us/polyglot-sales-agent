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
import { loadFixedTexts } from "./texts.ts";
import { traceRecorder } from "./traces.ts";
import { REPLY_PROMPT } from "./turn.ts";

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
}, 30_000);

afterAll(async () => {
  await crossPool.end();
  await appPool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query(
    "TRUNCATE early_receipts, messages, conversations, contacts, jobs CASCADE",
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
    await exchange("We open at 10:00.");
    expect(bodies()).toEqual([`${TOLD}\n\nWe open at 10:00.`]);
    expect(await sessions()).toEqual([{ told: true }]);
    await exchange("Yes, on Friday too.");
    await exchange("Goodbye.");
    expect(bodies().slice(1)).toEqual(["Yes, on Friday too.", "Goodbye."]);
    const rows = await outbound();
    // The record keeps the parts apart: the body is the model's reply alone.
    expect(rows.map((row) => [row.disclosure, row.lead, row.body])).toEqual([
      [TOLD, null, "We open at 10:00."],
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
      await exchange(`next ${round}`, [], racing);
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
    await exchange("We open at 10:00.", ["asks-if-person"]);
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
    expect(request).toContain("We open at 10:00.");
    expect(request).not.toContain(TOLD);
    expect(request).not.toContain(NOT_A_PERSON);
  });
});

describe('"am I talking to a person?" (US-C5, 3)', () => {
  test("P1, P4: the flag with a reply: the fixed text before the reply, after the disclosure in a first message; the message is still the assistant's reply, with its turn and language", async () => {
    await exchange("We open at 10:00.", ["asks-if-person"]);
    expect(bodies()).toEqual([`${TOLD}\n\n${NOT_A_PERSON}\n\nWe open at 10:00.`]);
    await exchange("Still me.", ["asks-if-person"]);
    expect(bodies()[1]).toBe(`${NOT_A_PERSON}\n\nStill me.`);
    const rows = await outbound();
    expect(
      rows.map((row) => [row.class, row.disclosure, row.lead, row.body, row.language]),
    ).toEqual([
      ["assistant-reply", TOLD, NOT_A_PERSON, "We open at 10:00.", "en"],
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
    await exchange("");
    expect(bodies()).toHaveLength(2);
    expect(reported).toEqual(["turn-skipped empty-reply"]);
  });

  test("P3: no flag, or another flag: the reply as it is", async () => {
    await exchange("first");
    await exchange("second", ["sensitive-topic", "asks-for-person"]);
    expect(bodies().slice(1)).toEqual(["second"]);
    expect((await outbound()).map((row) => row.lead)).toEqual([null, null]);
  });

  test("the flag beside other flags still gets the fixed text: the others are dropped until their unit", async () => {
    await exchange("Reply.", ["emergency", "asks-if-person", "asks-to-stop"]);
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
