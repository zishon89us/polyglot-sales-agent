// Contract tests for the WhatsApp channel against dated, synthetic fixtures
// (R-T3, NFR-S2). The fixtures and what they were written from are
// described in fixtures/2026-11-18/README.md.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { channelContract } from "@polyglot-sales-agent/channel/contract";
import { describe, expect, test } from "vitest";
import {
  createWhatsAppChannel,
  parseWebhook,
  registrationChallenge,
  SIGNATURE_HEADER,
  sendText,
  sign,
  verifySignature,
} from "./index.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/2026-11-18/", import.meta.url));
const fixture = (name: string): Buffer => readFileSync(`${FIXTURES}${name}`);
const SECRET = "synthetic-app-secret";
const CUSTOMER = { phone: "+15550142", userId: "US.10000000000000000042" };
const at = (seconds: number): Date => new Date(seconds * 1000);

describe("verifySignature", () => {
  test("agrees with a published HMAC-SHA-256 example (RFC 4231, test case 2)", () => {
    const header = "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
    const body = Buffer.from("what do ya want for nothing?");
    expect(sign(body, "Jefe")).toBe(header);
    expect(verifySignature(body, header, ["Jefe"])).toBe(true);
  });

  test("is checked over the bytes as received, not over the body read and written again", () => {
    const raw = fixture("inbound-text-arabic-escaped.json");
    const header = sign(raw, SECRET);
    const rewritten = Buffer.from(JSON.stringify(JSON.parse(raw.toString("utf8"))));
    expect(rewritten.equals(raw), "the fixture must differ from its re-serialised form").toBe(
      false,
    );
    expect(verifySignature(raw, header, [SECRET])).toBe(true);
    expect(verifySignature(rewritten, header, [SECRET])).toBe(false);
  });

  test.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["the digits without the prefix", sign(Buffer.from("x"), SECRET).slice(7)],
    ["another algorithm's prefix", sign(Buffer.from("x"), SECRET).replace("sha256=", "sha1=")],
    ["upper-case digits", sign(Buffer.from("x"), SECRET).toUpperCase()],
    ["a space after the header", `${sign(Buffer.from("x"), SECRET)} `],
    ["one digit short", sign(Buffer.from("x"), SECRET).slice(0, -1)],
    ["one digit long", `${sign(Buffer.from("x"), SECRET)}0`],
    ["letters that are not hexadecimal", `sha256=${"g".repeat(64)}`],
    ["a signature under another secret", sign(Buffer.from("x"), "another-secret")],
    ["a signature of another body", sign(Buffer.from("y"), SECRET)],
  ])("refuses %s", (_what, header) => {
    expect(verifySignature(Buffer.from("x"), header, [SECRET])).toBe(false);
  });

  test("a header sent twice, which arrives as a list, is refused even when called directly", () => {
    const body = Buffer.from("x");
    const twice = [sign(body, SECRET)] as unknown as string;
    expect(verifySignature(body, twice, [SECRET])).toBe(false);
  });

  test("while the secret is being replaced, the old and the new one are both accepted", () => {
    const body = Buffer.from("x");
    expect(verifySignature(body, sign(body, "old"), ["new", "old"])).toBe(true);
    expect(verifySignature(body, sign(body, "new"), ["new", "old"])).toBe(true);
    expect(verifySignature(body, sign(body, "old"), ["new"])).toBe(false);
  });

  test("an empty secret verifies nothing, and a channel cannot be made without a secret", () => {
    const body = Buffer.from("x");
    expect(verifySignature(body, sign(body, ""), [""])).toBe(false);
    expect(verifySignature(body, sign(body, ""), [])).toBe(false);
    const options = { baseUrl: "http://127.0.0.1:1", apiVersion: "v0.0", timeoutMs: 1 };
    expect(() => createWhatsAppChannel({ ...options, appSecrets: [] })).toThrow("app secret");
    expect(() => createWhatsAppChannel({ ...options, appSecrets: [""] })).toThrow("app secret");
  });
});

describe("registrationChallenge", () => {
  const query = {
    "hub.mode": "subscribe",
    "hub.verify_token": "token",
    "hub.challenge": "1158201444",
  };

  test("echoes the challenge when the token is right", () => {
    expect(registrationChallenge(query, "token")).toBe("1158201444");
  });

  test.each([
    ["a wrong token", { ...query, "hub.verify_token": "tokem" }, "token"],
    ["a longer token", { ...query, "hub.verify_token": "token2" }, "token"],
    ["the start of the token", { ...query, "hub.verify_token": "tok" }, "token"],
    ["an empty token", { ...query, "hub.verify_token": "" }, "token"],
    ["no token", { "hub.mode": "subscribe", "hub.challenge": "1" }, "token"],
    ["another mode", { ...query, "hub.mode": "unsubscribe" }, "token"],
    ["no challenge", { "hub.mode": "subscribe", "hub.verify_token": "token" }, "token"],
    ["a token given twice", { ...query, "hub.verify_token": ["token", "token"] }, "token"],
    ["no configured token", { ...query, "hub.verify_token": "" }, ""],
  ])("refuses %s", (_what, given, configured) => {
    expect(registrationChallenge(given, configured)).toBeUndefined();
  });
});

describe("parseWebhook, on the fixtures of 2026-11-18", () => {
  test("every fixture is covered by a test below", () => {
    const tested = [
      "inbound-text.json",
      "inbound-text-arabic-escaped.json",
      "inbound-text-no-phone.json",
      "inbound-image.json",
      "status-sent.json",
      "status-delivered.json",
      "status-read.json",
      "status-failed.json",
      "status-unknown.json",
      "two-numbers.json",
      "other-field.json",
    ];
    const present = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));
    expect(present.sort()).toEqual(tested.sort());
  });

  test("a customer's text", () => {
    expect(parseWebhook(fixture("inbound-text.json"))).toEqual({
      ok: true,
      skipped: 0,
      malformed: 0,
      batches: [
        {
          receivingNumberId: "100000000000002",
          events: [
            {
              kind: "message",
              channelMessageId: "wamid.SYNTHETIC0001",
              from: CUSTOMER,
              sentAt: at(1795000000),
              content: { type: "text", body: "Do you have a slot on Thursday?" },
            },
          ],
        },
      ],
    });
  });

  test("text written with escapes is read as the characters it stands for", () => {
    const parsed = parseWebhook(fixture("inbound-text-arabic-escaped.json"));
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      content: { type: "text", body: "هل لديكم موعد يوم الخميس؟" },
    });
  });

  test("a customer with a username: no phone number, only the channel's identifier", () => {
    const parsed = parseWebhook(fixture("inbound-text-no-phone.json"));
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      kind: "message",
      from: { phone: null, userId: "US.10000000000000000042" },
      content: { type: "text", body: "Hello" },
    });
  });

  test("a message of a type this version does not read is named, not interpreted", () => {
    const parsed = parseWebhook(fixture("inbound-image.json"));
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      kind: "message",
      channelMessageId: "wamid.SYNTHETIC0004",
      content: { type: "unsupported", channelType: "image" },
    });
  });

  test.each(["sent", "delivered", "read"] as const)("a %s status", (status) => {
    expect(parseWebhook(fixture(`status-${status}.json`))).toEqual({
      ok: true,
      skipped: 0,
      malformed: 0,
      batches: [
        {
          receivingNumberId: "100000000000002",
          events: [
            {
              kind: "status",
              channelMessageId: "wamid.SYNTHETIC0101",
              status,
              at: at(1795000060),
              errorCode: null,
            },
          ],
        },
      ],
    });
  });

  test("a failed status carries the channel's error code as text", () => {
    const parsed = parseWebhook(fixture("status-failed.json"));
    expect(parsed.ok && parsed.batches[0]?.events).toEqual([
      {
        kind: "status",
        channelMessageId: "wamid.SYNTHETIC0102",
        status: "failed",
        at: at(1795000060),
        errorCode: "131026",
      },
    ]);
  });

  test("a status this version does not know is counted and left out", () => {
    expect(parseWebhook(fixture("status-unknown.json"))).toEqual({
      ok: true,
      skipped: 1,
      malformed: 0,
      batches: [{ receivingNumberId: "100000000000002", events: [] }],
    });
  });

  test("a webhook field other than messages is counted and left out", () => {
    expect(parseWebhook(fixture("other-field.json"))).toEqual({
      ok: true,
      skipped: 1,
      malformed: 0,
      batches: [],
    });
  });

  test("one webhook for two receiving numbers gives two batches", () => {
    const parsed = parseWebhook(fixture("two-numbers.json"));
    expect(
      parsed.ok && parsed.batches.map((batch) => [batch.receivingNumberId, batch.events.length]),
    ).toEqual([
      ["100000000000002", 1],
      ["100000000000004", 1],
    ]);
  });
});

describe("parseWebhook, on payloads that are not what was documented", () => {
  /** The text fixture with one change made to it. */
  function altered(
    change: (message: Record<string, unknown>, value: Record<string, unknown>) => void,
  ): Buffer {
    const body = JSON.parse(fixture("inbound-text.json").toString("utf8"));
    const value = body.entry[0].changes[0].value;
    change(value.messages[0], value);
    return Buffer.from(JSON.stringify(body));
  }

  type Part = Record<string, unknown>;
  const set = (key: string, value: unknown) => (part: Part) => {
    part[key] = value;
  };
  const drop =
    (...keys: string[]) =>
    (part: Part) => {
      for (const key of keys) {
        delete part[key];
      }
    };
  const inValue = (change: (value: Part) => void) => (_message: Part, value: Part) => change(value);

  test.each([
    ["no message identifier", drop("id")],
    ["an empty message identifier", set("id", "")],
    ["an identifier longer than documented", set("id", "w".repeat(129))],
    ["no timestamp", drop("timestamp")],
    ["a timestamp that is not seconds", set("timestamp", "2026-11-18")],
    ["a timestamp given as a number", set("timestamp", 1795000000)],
    ["no type", drop("type")],
    ["a text with no body", set("text", {})],
    ["a text whose body is not a string", set("text", { body: 7 })],
    ["a sender that is not a number", set("from", "Ali Khan")],
    ["a sender with a plus", set("from", "+15550142")],
    ["a user identifier of the wrong form", set("from_user_id", "<script>")],
    ["neither a number nor a user identifier", drop("from", "from_user_id")],
    ["an identifier with a space in it", set("id", "wamid. X")],
    ["an identifier that is only a control character", set("id", "\u0000")],
    ["a time after the year 2100", set("timestamp", "999999999999")],
    ["a text that is only the character U+0000", set("text", { body: "\u0000" })],
    [
      "a message that is not an object",
      (_message: Part, value: Part) => {
        value["messages"] = ["x"];
      },
    ],
  ])("leaves out a message with %s, and says one was left out", (_what, change) => {
    expect(parseWebhook(altered(change))).toEqual({
      ok: true,
      skipped: 0,
      malformed: 1,
      batches: [{ receivingNumberId: "100000000000002", events: [] }],
    });
  });

  test.each([
    ["no metadata", inValue(drop("metadata"))],
    [
      "a receiving number that is not digits",
      inValue(set("metadata", { phone_number_id: "../x" })),
    ],
    ["messages that are not a list", inValue(set("messages", {}))],
    ["statuses that are not a list", inValue(set("statuses", "x"))],
  ])("leaves out a whole group with %s, since nothing in it can be routed", (_what, change) => {
    expect(parseWebhook(altered(change))).toEqual({
      ok: true,
      skipped: 0,
      malformed: 1,
      batches: [],
    });
  });

  test("one message of the wrong form does not cost the messages beside it", () => {
    const body = altered((message, value) => {
      const good = { ...message, id: "wamid.SYNTHETIC0009" };
      delete message["timestamp"];
      value["messages"] = [message, good];
      value["statuses"] = [
        { id: "wamid.SYNTHETIC0101", status: "read", timestamp: "1795000060" },
        { status: "read" },
      ];
    });
    const parsed = parseWebhook(body);
    // One message and one status, each counted once and as malformed only.
    expect(parsed.ok && [parsed.malformed, parsed.skipped]).toEqual([2, 0]);
    expect(parsed.ok && parsed.batches[0]?.events.map((event) => event.channelMessageId)).toEqual([
      "wamid.SYNTHETIC0009",
      "wamid.SYNTHETIC0101",
    ]);
  });

  test.each([
    [[], "unknown"],
    ["not a list", "unknown"],
    [[{ code: "131026" }], "unknown"],
    [[{ code: 1e300 }], "unknown"],
    [[{ code: -1 }], "unknown"],
    [[7], "unknown"],
    [[{ code: 131026 }], "131026"],
  ])("a failed status whose errors are %j is kept, with the code %s", (errors, code) => {
    const body = JSON.parse(fixture("status-failed.json").toString("utf8"));
    body.entry[0].changes[0].value.statuses[0].errors = errors;
    const parsed = parseWebhook(Buffer.from(JSON.stringify(body)));
    expect(parsed.ok && parsed.malformed).toBe(0);
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      status: "failed",
      errorCode: code,
    });
  });

  test("the character U+0000 is removed from a text; everything else is kept as it came", () => {
    const parsed = parseWebhook(
      altered((message) => {
        message["text"] = { body: "a\u0000b\n\t<b>\ud83d" };
      }),
    );
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      content: { type: "text", body: "ab\n\t<b>\ud83d" },
    });
  });

  test.each([
    ["", "not-json"],
    ["{", "not-json"],
    ["[]", "not-an-object"],
    ["null", "not-an-object"],
    ['"text"', "not-an-object"],
    ["{}", "wrong-object"],
    ['{"object":"page","entry":[]}', "wrong-object"],
    ['{"object":"whatsapp_business_account"}', "bad-shape"],
    ['{"object":"whatsapp_business_account","entry":{}}', "bad-shape"],
  ])("refuses %j as %s", (body, code) => {
    expect(parseWebhook(Buffer.from(body))).toEqual({ ok: false, code });
  });

  test("an entry that cannot be walked is counted, and the entries beside it are read", () => {
    const body = JSON.parse(fixture("two-numbers.json").toString("utf8"));
    body.entry.splice(1, 0, {}, "not an entry", { changes: "not a list" });
    const parsed = parseWebhook(Buffer.from(JSON.stringify(body)));
    expect(parsed.ok && [parsed.malformed, parsed.skipped]).toEqual([3, 0]);
    expect(parsed.ok && parsed.batches.map((batch) => batch.receivingNumberId)).toEqual([
      "100000000000002",
      "100000000000004",
    ]);
  });

  test("a change that is not an object is counted and the rest is read", () => {
    const body = '{"object":"whatsapp_business_account","entry":[{"changes":[7]}]}';
    expect(parseWebhook(Buffer.from(body))).toEqual({
      ok: true,
      batches: [],
      skipped: 0,
      malformed: 1,
    });
  });

  test("fields it does not know are ignored", () => {
    const body = altered((message, value) => {
      message["new_field"] = { anything: true };
      value["another"] = [1, 2];
    });
    expect(parseWebhook(body).ok).toBe(true);
  });

  test("a message type with an odd name is called unknown, never echoed", () => {
    const parsed = parseWebhook(
      altered((message) => {
        message["type"] = "<b>+15550142</b>";
      }),
    );
    expect(parsed.ok && parsed.batches[0]?.events[0]).toMatchObject({
      content: { type: "unsupported", channelType: "unknown" },
    });
  });

  test("an empty webhook is valid and holds nothing", () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    expect(parseWebhook(Buffer.from(body))).toEqual({
      ok: true,
      batches: [],
      skipped: 0,
      malformed: 0,
    });
  });
});

describe("sendText", () => {
  const from = { receivingNumberId: "100000000000002", accessToken: "synthetic-token" };
  const options = { baseUrl: "https://channel.invalid", apiVersion: "v27.0", timeoutMs: 1_000 };
  const accepted = {
    messaging_product: "whatsapp",
    contacts: [{ input: "+15550142", wa_id: "15550142" }],
    messages: [{ id: "wamid.SYNTHETIC0201" }],
  };

  function answering(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const stub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, stub };
  }

  test("posts the documented request and returns the channel's identifier", async () => {
    const { calls, stub } = answering(200, accepted);
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "مرحبا");
    expect(result).toEqual({ accepted: true, channelMessageId: "wamid.SYNTHETIC0201" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://channel.invalid/v27.0/100000000000002/messages");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer synthetic-token",
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+15550142",
      type: "text",
      text: { body: "مرحبا" },
    });
  });

  test("a customer known only by the channel's identifier is addressed by it", async () => {
    const { calls, stub } = answering(200, accepted);
    await sendText({ ...options, fetch: stub }, from, { phone: null, userId: "US.1" }, "hi");
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent.recipient).toBe("US.1");
    expect("to" in sent).toBe(false);
  });

  test("nobody to send to is a failure, and nothing is posted", async () => {
    const { calls, stub } = answering(200, accepted);
    const result = await sendText(
      { ...options, fetch: stub },
      from,
      { phone: null, userId: null },
      "hi",
    );
    expect(result).toEqual({ accepted: false, retryable: false, code: "no-recipient" });
    expect(calls).toHaveLength(0);
  });

  test.each([
    [401, { error: { code: 190 } }, { retryable: false, code: "not-authorised" }],
    [403, { error: { code: 10 } }, { retryable: false, code: "not-authorised" }],
    [
      400,
      { error: { code: 131047, message: "Re-engagement message" } },
      { retryable: false, code: "meta-131047" },
    ],
    [400, { error: { code: "<script>" } }, { retryable: false, code: "rejected" }],
    [404, "not json", { retryable: false, code: "rejected" }],
    [429, { error: { code: 130429 } }, { retryable: true, code: "rate-limited" }],
    [500, "", { retryable: true, code: "server-error" }],
    [503, { error: { code: 131016 } }, { retryable: true, code: "server-error" }],
    [200, {}, { retryable: false, code: "bad-response" }],
    [200, { messages: [{}] }, { retryable: false, code: "bad-response" }],
    [200, "not json", { retryable: false, code: "bad-response" }],
  ])("an answer of %s %j is %j", async (status, body, expected) => {
    const { stub } = answering(status, body);
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, ...expected });
  });

  test("an answer of 408 may be retried", async () => {
    const { stub } = answering(408, "");
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, retryable: true, code: "server-error" });
  });

  test.each([" ", "wamid with space", "w".repeat(129)])(
    "an identifier of %j in a success is not taken for one",
    async (id) => {
      const { stub } = answering(200, { messages: [{ id }] });
      const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
      expect(result).toEqual({ accepted: false, retryable: false, code: "bad-response" });
    },
  );

  test("an answer of exactly 64 KiB is read; one byte more is not", async () => {
    const answer = (bytes: number) => {
      const start = '{"messages":[{"id":"wamid.X"}],"padding":"';
      return `${start}${"x".repeat(bytes - start.length - 2)}"}`;
    };
    for (const [bytes, accepted] of [
      [64 * 1024, true],
      [64 * 1024 + 1, false],
    ] as const) {
      const { stub } = answering(200, answer(bytes));
      const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
      expect(result.accepted, `${bytes} bytes`).toBe(accepted);
    }
  });

  test("an identifier that is not plain printable characters is not taken for one", async () => {
    const stub = (async () =>
      new Response(Buffer.from('{"messages":[{"id":"wamid.\xff\xfe"}]}', "latin1"), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, retryable: false, code: "bad-response" });
  });

  test("an answer far larger than any real one is not read, and counts as no answer", async () => {
    const huge = JSON.stringify({ messages: [{ id: "wamid.X" }], padding: "x".repeat(200_000) });
    const { stub } = answering(200, huge);
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, retryable: false, code: "bad-response" });
  });

  test.each(["..", ".", "1/../2", "100000000000002?x=1", "", "mock-number"])(
    "a sender of %j is refused, and the token is sent nowhere",
    async (receivingNumberId) => {
      const { calls, stub } = answering(200, accepted);
      const result = await sendText(
        { ...options, fetch: stub },
        { ...from, receivingNumberId },
        CUSTOMER,
        "hi",
      );
      expect(result).toEqual({ accepted: false, retryable: false, code: "bad-sender" });
      expect(calls).toHaveLength(0);
    },
  );

  test.each(["", "two words", "line\nbreak", "tab\there"])(
    "a token of %j is refused as a fault that retrying cannot mend",
    async (accessToken) => {
      const { calls, stub } = answering(200, accepted);
      const result = await sendText(
        { ...options, fetch: stub },
        { ...from, accessToken },
        CUSTOMER,
        "hi",
      );
      expect(result).toEqual({ accepted: false, retryable: false, code: "bad-credentials" });
      expect(calls).toHaveLength(0);
    },
  );

  test("the request is made so that a redirect is not followed", async () => {
    const { calls, stub } = answering(200, accepted);
    await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  test("an answer that redirects is a failure that retrying cannot mend", async () => {
    const stub = (async () =>
      new Response(null, {
        status: 307,
        headers: { location: "https://elsewhere.invalid/" },
      })) as unknown as typeof fetch;
    const result = await sendText({ ...options, fetch: stub }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, retryable: false, code: "redirected" });
  });

  test.each([
    [{ baseUrl: "not an address" }, "base address"],
    [{ baseUrl: "ftp://channel.invalid" }, "base address"],
    [{ baseUrl: "https://user:pass@channel.invalid" }, "base address"],
    [{ baseUrl: "https://:pass@channel.invalid" }, "base address"],
    [{ baseUrl: " https://channel.invalid " }, "base address"],
    [{ baseUrl: "https://channel.invalid/" }, "base address"],
    [{ baseUrl: "https://channel.invalid/path" }, "base address"],
    [{ baseUrl: "https://channel.invalid?x=1" }, "base address"],
    [{ timeoutMs: 0.5 }, "timeout"],
    [{ timeoutMs: 2 ** 40 }, "timeout"],
    [{ apiVersion: "latest" }, "API version"],
    [{ apiVersion: "v27.0/../x" }, "API version"],
    [{ timeoutMs: Number.NaN }, "timeout"],
    [{ timeoutMs: 0 }, "timeout"],
  ])("a channel cannot be made with %j", (wrong, message) => {
    expect(() => createWhatsAppChannel({ ...options, appSecrets: [SECRET], ...wrong })).toThrow(
      message,
    );
  });

  test("no answer in time is a failure that may be retried", async () => {
    const never = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const result = await sendText(
      { ...options, timeoutMs: 20, fetch: never },
      from,
      CUSTOMER,
      "hi",
    );
    expect(result).toEqual({ accepted: false, retryable: true, code: "timeout" });
  });

  test("a failed connection is a failure that may be retried, and says nothing of the token", async () => {
    const broken = (async () => {
      throw new TypeError("fetch failed: Bearer synthetic-token at https://channel.invalid");
    }) as unknown as typeof fetch;
    const result = await sendText({ ...options, fetch: broken }, from, CUSTOMER, "hi");
    expect(result).toEqual({ accepted: false, retryable: true, code: "network" });
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
  });
});

channelContract("whatsapp", async () => {
  const stub = (async (_url: string, init: RequestInit) => {
    const good =
      (init.headers as Record<string, string>)["authorization"] === "Bearer synthetic-token";
    return good
      ? new Response(JSON.stringify({ messages: [{ id: "wamid.SYNTHETIC0301" }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 });
  }) as unknown as typeof fetch;
  const channel = createWhatsAppChannel({
    appSecrets: [SECRET],
    baseUrl: "https://channel.invalid",
    apiVersion: "v27.0",
    timeoutMs: 1_000,
    fetch: stub,
  });
  // One text message and one status, in one webhook, from two fixtures.
  const body = JSON.parse(fixture("inbound-text.json").toString("utf8"));
  const status = JSON.parse(fixture("status-delivered.json").toString("utf8"));
  body.entry[0].changes[0].value.statuses = status.entry[0].changes[0].value.statuses;
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    channel,
    signatureHeader: SIGNATURE_HEADER,
    from: { receivingNumberId: "100000000000002", accessToken: "synthetic-token" },
    signed: () => ({ rawBody, headers: { [SIGNATURE_HEADER]: sign(rawBody, SECRET) } }),
  };
});
