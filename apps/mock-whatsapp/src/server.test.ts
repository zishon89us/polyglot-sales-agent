// The stand-in for Meta's servers, tested from both sides: the WhatsApp
// channel sends to it over real HTTP, and the webhooks it sends are
// accepted by the product's webhook guard (R-T3, Gate 2 finding S34).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApiServer, registerWebhook } from "@polyglot-sales-agent/api";
import type { EventBatch } from "@polyglot-sales-agent/channel";
import { channelContract } from "@polyglot-sales-agent/channel/contract";
import {
  createWhatsAppChannel,
  parseWebhook,
  registrationChallenge,
  SIGNATURE_HEADER,
  sign,
} from "@polyglot-sales-agent/channel-whatsapp";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { createMockWhatsApp, inboundTextPayload, MOCK_HOST, type MockOptions } from "./server.ts";

const SECRET = "synthetic-app-secret";
const TOKEN = "synthetic-access-token";
const FROM = { receivingNumberId: "100000000000002", accessToken: TOKEN };
const CUSTOMER = { phone: "+15550142", userId: null };

const open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

async function listening(app: FastifyInstance): Promise<string> {
  open.push(app);
  return app.listen({ host: "127.0.0.1", port: 0 });
}

async function mock(options: Partial<MockOptions> = {}) {
  const app = createMockWhatsApp({ appSecret: SECRET, accessToken: TOKEN, run: "", ...options });
  const baseUrl = await listening(app);
  const channel = createWhatsAppChannel({
    appSecrets: [SECRET],
    baseUrl,
    apiVersion: "v27.0",
    timeoutMs: 2_000,
  });
  const sent = async () =>
    ((await (await fetch(`${baseUrl}/mock/sent`)).json()) as { sent: unknown[] }).sent;
  const call = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, baseUrl, channel, sent, call };
}

describe("the WhatsApp channel sending to mock-whatsapp over HTTP", () => {
  test("a text is accepted, given an identifier and recorded as sent", async () => {
    const { channel, sent } = await mock();
    const result = await channel.sendText(FROM, CUSTOMER, "مرحبا");
    expect(result).toEqual({ accepted: true, channelMessageId: "wamid.MOCK000001" });
    expect(await sent()).toEqual([
      {
        id: "wamid.MOCK000001",
        phoneNumberId: "100000000000002",
        to: "+15550142",
        recipient: null,
        body: "مرحبا",
      },
    ]);
  });

  test("a customer known only by the channel's identifier is recorded by it", async () => {
    const { channel, sent } = await mock();
    await channel.sendText(FROM, { phone: null, userId: "US.10000000000000000042" }, "hi");
    expect(await sent()).toMatchObject([{ to: null, recipient: "US.10000000000000000042" }]);
  });

  test("a wrong token is refused as Meta refuses it, and nothing is recorded", async () => {
    const { channel, sent } = await mock();
    const result = await channel.sendText({ ...FROM, accessToken: "wrong" }, CUSTOMER, "hi");
    expect(result).toEqual({
      accepted: false,
      retryable: false,
      mayHaveArrived: false,
      code: "not-authorised",
    });
    expect(await sent()).toEqual([]);
  });

  test.each([
    [500, 131000, { retryable: true, mayHaveArrived: true, code: "server-error" }],
    [429, 130429, { retryable: true, mayHaveArrived: false, code: "rate-limited" }],
    [400, 131047, { retryable: false, mayHaveArrived: false, code: "meta-131047" }],
  ])(
    "a failure injected as %s with code %s is seen as %j, once",
    async (status, code, expected) => {
      const { channel, sent, call } = await mock();
      expect((await call("/mock/fail-next", { status, code })).status).toBe(200);
      expect(await channel.sendText(FROM, CUSTOMER, "hi")).toEqual({
        accepted: false,
        ...expected,
      });
      expect(await sent()).toEqual([]);
      expect((await channel.sendText(FROM, CUSTOMER, "hi")).accepted).toBe(true);
    },
  );

  test("no answer in time is a timeout that may be retried", async () => {
    const slow = Fastify({ logger: false });
    slow.post("/:version/:id/messages", () => new Promise(() => undefined));
    const baseUrl = await listening(slow);
    const channel = createWhatsAppChannel({
      appSecrets: [SECRET],
      baseUrl,
      apiVersion: "v27.0",
      timeoutMs: 100,
    });
    expect(await channel.sendText(FROM, CUSTOMER, "hi")).toEqual({
      accepted: false,
      retryable: true,
      mayHaveArrived: true,
      code: "timeout",
    });
    await slow.close();
  });

  test("nothing listening is a network failure that may be retried", async () => {
    const channel = createWhatsAppChannel({
      appSecrets: [SECRET],
      baseUrl: "http://127.0.0.1:9",
      apiVersion: "v27.0",
      timeoutMs: 2_000,
    });
    expect(await channel.sendText(FROM, CUSTOMER, "hi")).toEqual({
      accepted: false,
      retryable: true,
      mayHaveArrived: true,
      code: "network",
    });
  });
});

describe("mock-whatsapp refuses what Meta's endpoint would not accept", () => {
  const valid = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "+15550142",
    type: "text",
    text: { body: "hi" },
  };

  test.each([
    ["no messaging product", { ...valid, messaging_product: undefined }],
    ["a type other than text", { ...valid, type: "image" }],
    ["no text", { ...valid, text: undefined }],
    ["an empty text", { ...valid, text: { body: "" } }],
    ["a text over 4096 characters", { ...valid, text: { body: "x".repeat(4097) } }],
    ["nobody to send to", { ...valid, to: undefined }],
    ["a recipient that is not a number", { ...valid, to: "Ali Khan" }],
  ])("%s", async (_what, body) => {
    const { baseUrl, sent } = await mock();
    const response = await fetch(`${baseUrl}/v27.0/100000000000002/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 100 } });
    expect(await sent()).toEqual([]);
  });

  test("a path without an API version is not found", async () => {
    const { baseUrl } = await mock();
    const response = await fetch(`${baseUrl}/latest/100000000000002/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(valid),
    });
    expect(response.status).toBe(404);
  });
});

/** The names of an object's fields, at every depth, without their values. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(shape);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, shape(inner)]),
    );
  }
  return typeof value;
}

describe("the webhooks mock-whatsapp sends", () => {
  const fixture = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            `../../../packages/channel-whatsapp/fixtures/2026-11-18/${name}`,
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    );
  const input = {
    phoneNumberId: "100000000000002",
    userId: "US.10000000000000000042",
    text: "hello",
    id: "wamid.MOCKIN000001",
    timestamp: 1795000000,
  };

  test("have the fields of the dated fixtures, with a phone number and without", () => {
    expect(shape(inboundTextPayload({ ...input, from: "15550142" }))).toEqual(
      shape(fixture("inbound-text.json")),
    );
    const withoutPhone = shape(inboundTextPayload({ ...input, from: null })) as never;
    const expected = shape(fixture("inbound-text-no-phone.json")) as {
      entry: { changes: { value: { contacts: { profile: Record<string, unknown> }[] } }[] }[];
    };
    // The fixture's customer has a username; the mock's does not.
    delete expected.entry[0]?.changes[0]?.value.contacts[0]?.profile["username"];
    expect(withoutPhone).toEqual(expected);
  });

  test("are read by the WhatsApp channel as the message that was typed", () => {
    const raw = Buffer.from(JSON.stringify(inboundTextPayload({ ...input, from: "15550142" })));
    const parsed = parseWebhook(raw);
    expect(parsed.ok && parsed.batches).toEqual([
      {
        receivingNumberId: "100000000000002",
        events: [
          {
            kind: "message",
            channelMessageId: "wamid.MOCKIN000001",
            from: { phone: "+15550142", userId: "US.10000000000000000042" },
            sentAt: new Date(1795000000 * 1000),
            content: { type: "text", body: "hello" },
          },
        ],
      },
    ]);
  });

  /** The product's webhook guard, listening, with a sink that records. */
  async function product(appSecret: string) {
    const received: (readonly EventBatch[])[] = [];
    const app = createApiServer({ trustedProxies: false });
    await registerWebhook(app, {
      channel: createWhatsAppChannel({
        appSecrets: [appSecret],
        baseUrl: "https://channel.invalid",
        apiVersion: "v27.0",
        timeoutMs: 1_000,
      }),
      registration: (query) => registrationChallenge(query, "synthetic-verify-token"),
      sink: {
        events: async (batches) => void received.push(batches),
        unparsed: async () => undefined,
      },
    });
    return { received, webhookUrl: `${await listening(app)}/webhooks/whatsapp` };
  }

  test("a message typed into the mock arrives at the product's webhook, signed, and is accepted", async () => {
    const { received, webhookUrl } = await product(SECRET);
    const { call } = await mock({ webhookUrl, now: () => 1795000000 });
    const response = await call("/mock/inbound", {
      phoneNumberId: "100000000000002",
      from: "+15550142",
      text: "هل لديكم موعد؟",
    });
    expect(await response.json()).toEqual({ id: "wamid.MOCKIN000001", webhookStatus: 200 });
    expect(received).toHaveLength(1);
    expect(received[0]?.[0]?.events[0]).toMatchObject({
      kind: "message",
      channelMessageId: "wamid.MOCKIN000001",
      from: { phone: "+15550142" },
      content: { type: "text", body: "هل لديكم موعد؟" },
    });
  });

  test("a customer with no number arrives with the channel's identifier only", async () => {
    const { received, webhookUrl } = await product(SECRET);
    const { call } = await mock({ webhookUrl });
    await call("/mock/inbound", { phoneNumberId: "100000000000002", text: "hello" });
    expect(received[0]?.[0]?.events[0]).toMatchObject({
      from: { phone: null, userId: "US.10000000000000000042" },
    });
  });

  test("a product configured with another secret refuses the mock's webhook, and the mock says so", async () => {
    const { received, webhookUrl } = await product("another-secret");
    const { call } = await mock({ webhookUrl });
    const response = await call("/mock/inbound", { phoneNumberId: "100000000000002", text: "hi" });
    expect(await response.json()).toMatchObject({ webhookStatus: 401 });
    expect(received).toEqual([]);
  });

  test("each message gets its own identifier", async () => {
    const seen: string[] = [];
    const capture = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse((init.body as Buffer).toString("utf8"));
      seen.push(body.entry[0].changes[0].value.messages[0].id);
      expect((init.headers as Record<string, string>)[SIGNATURE_HEADER]).toBe(
        sign(init.body as Buffer, SECRET),
      );
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const { call } = await mock({
      webhookUrl: "http://product.invalid/webhooks/whatsapp",
      fetch: capture,
    });
    await call("/mock/inbound", { phoneNumberId: "1", text: "one" });
    await call("/mock/inbound", { phoneNumberId: "1", text: "two" });
    expect(seen).toEqual(["wamid.MOCKIN000001", "wamid.MOCKIN000002"]);
  });

  test.each([
    [{ text: "hi" }, 400],
    [{ phoneNumberId: "1" }, 400],
    [{ phoneNumberId: "1", text: "" }, 400],
    [{ phoneNumberId: "1", text: "hi", from: "Ali Khan" }, 400],
  ])("input %j is answered %s", async (body, status) => {
    const { call } = await mock({ webhookUrl: "http://127.0.0.1:9/" });
    expect((await call("/mock/inbound", body)).status).toBe(status);
  });

  test("with no webhook address it says so; with one that does not answer it says that", async () => {
    const none = await mock();
    expect((await none.call("/mock/inbound", { phoneNumberId: "1", text: "hi" })).status).toBe(409);
    const dead = await mock({ webhookUrl: "http://127.0.0.1:9/" });
    expect((await dead.call("/mock/inbound", { phoneNumberId: "1", text: "hi" })).status).toBe(502);
  });
});

describe("the mock's own controls", () => {
  test("reset forgets what was sent and any failure waiting", async () => {
    const { channel, sent, call } = await mock();
    await channel.sendText(FROM, CUSTOMER, "hi");
    await call("/mock/fail-next", { status: 500, code: 1 });
    await call("/mock/reset", {});
    expect(await sent()).toEqual([]);
    expect((await channel.sendText(FROM, CUSTOMER, "hi")).accepted).toBe(true);
  });

  test.each([{}, { status: 200, code: 1 }, { status: 500 }, { status: "500", code: 1 }])(
    "a failure to inject must be an error status and a code: %j",
    async (body) => {
      const { call } = await mock();
      expect((await call("/mock/fail-next", body)).status).toBe(400);
    },
  );

  test("what it shows of a send never includes the token", async () => {
    const { baseUrl, channel } = await mock();
    await channel.sendText(FROM, CUSTOMER, "hi");
    expect(await (await fetch(`${baseUrl}/mock/sent`)).text()).not.toContain(TOKEN);
  });

  test("it listens on this machine only, unless told to serve a container, and never in production", () => {
    expect(MOCK_HOST).toBe("127.0.0.1");
    const main = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");
    // This machine unless the setting says otherwise, and the setting has one other value.
    expect(main).toContain('(process.env["PSA_MOCK_HOST"] ?? "").trim() || MOCK_HOST');
    expect(main).toContain('if (host !== MOCK_HOST && host !== "0.0.0.0") {');
    expect(main).not.toContain("::");
    // The refusal comes before anything listens. `tools/e2e.test.ts` runs the program and sees both.
    expect(main.indexOf("refuseInProduction(")).toBeGreaterThan(0);
    expect(main.indexOf("refuseInProduction(")).toBeLessThan(main.indexOf("app.listen("));
  });

  test("two starts of the mock never give the same identifier, to a message in or a message out", async () => {
    const ids: string[] = [];
    for (let start = 0; start < 2; start += 1) {
      const app = createMockWhatsApp({
        appSecret: SECRET,
        accessToken: TOKEN,
        webhookUrl: "http://127.0.0.1:9/none",
        fetch: async () => new Response(null, { status: 200 }),
      });
      const inbound = await app.inject({
        method: "POST",
        url: "/mock/inbound",
        payload: { phoneNumberId: "100000000000002", from: "+15550142", text: "hello" },
      });
      const sent = await app.inject({
        method: "POST",
        url: "/v27.0/100000000000002/messages",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          messaging_product: "whatsapp",
          to: "+15550142",
          type: "text",
          text: { body: "x" },
        },
      });
      ids.push(inbound.json().id, sent.json().messages[0].id);
      await app.close();
    }
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(id).toMatch(/^wamid\.MOCK(IN)?[A-Z0-9]{9,}[0-9]{6}$/);
    }
  });

  test("a redirect from the channel's address is not followed: the token goes nowhere else", async () => {
    const seen: string[] = [];
    const elsewhere = Fastify({ logger: false });
    elsewhere.all("/*", async (request) => {
      seen.push(request.headers.authorization ?? "none");
      return { messages: [{ id: "wamid.STOLEN" }] };
    });
    const target = await listening(elsewhere);
    const redirecting = Fastify({ logger: false });
    redirecting.post("/:version/:id/messages", async (_request, reply) =>
      reply.redirect(`${target}/v27.0/1/messages`, 307),
    );
    const channel = createWhatsAppChannel({
      appSecrets: [SECRET],
      baseUrl: await listening(redirecting),
      apiVersion: "v27.0",
      timeoutMs: 2_000,
    });
    expect(await channel.sendText(FROM, CUSTOMER, "hi")).toEqual({
      accepted: false,
      retryable: false,
      mayHaveArrived: false,
      code: "redirected",
    });
    expect(seen).toEqual([]);
  });

  test("the test page is served, says what it is, and puts messages on the page as text", async () => {
    const { baseUrl } = await mock();
    const response = await fetch(`${baseUrl}/`);
    const page = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(page).toContain("A stand-in for WhatsApp, for development only");
    expect(page).toContain("textContent");
    expect(page).not.toContain("innerHTML");
  });
});

channelContract("whatsapp, against mock-whatsapp over HTTP", async () => {
  const { channel } = await mock();
  const body = Buffer.from(
    JSON.stringify({
      ...(inboundTextPayload({
        phoneNumberId: "100000000000002",
        from: "15550142",
        userId: "US.10000000000000000042",
        text: "hello",
        id: "wamid.MOCKIN000001",
        timestamp: 1795000000,
      }) as object),
    }),
  );
  const withStatus = JSON.parse(body.toString("utf8"));
  withStatus.entry[0].changes[0].value.statuses = [
    {
      id: "wamid.MOCK000001",
      status: "delivered",
      timestamp: "1795000060",
      recipient_id: "15550142",
    },
  ];
  const rawBody = Buffer.from(JSON.stringify(withStatus));
  return {
    channel,
    signatureHeader: SIGNATURE_HEADER,
    from: FROM,
    signed: () => ({ rawBody, headers: { [SIGNATURE_HEADER]: sign(rawBody, SECRET) } }),
  };
});
