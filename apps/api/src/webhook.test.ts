// The webhook guard (NFR-S2, issue #154, `docs/design/api.md` section 3).
// The sink here only records what it is given: "stores nothing" means the
// sink is never called. The sink that writes to the database is unit U7's.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import type { EventBatch } from "@polyglot-sales-agent/channel";
import { createMockChannel, MOCK_SIGNATURE_HEADER } from "@polyglot-sales-agent/channel-mock";
import {
  createWhatsAppChannel,
  registrationChallenge,
  SIGNATURE_HEADER,
  sign,
} from "@polyglot-sales-agent/channel-whatsapp";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { BadSignatureLimiter } from "./bad-signature-limiter.ts";
import { registerWebhook, WEBHOOK_BODY_LIMIT, type WebhookSink } from "./webhook.ts";

const SECRET = "synthetic-app-secret";
const fixture = (name: string): Buffer =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../packages/channel-whatsapp/fixtures/2026-11-18/${name}`, import.meta.url),
    ),
  );

interface Recorded {
  events: { batches: readonly EventBatch[]; skipped: number }[];
  unparsed: { code: string; sha256: string; size: number }[];
}

const open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

async function server(
  overrides: {
    sink?: Partial<WebhookSink>;
    bodyLimit?: number;
    now?: () => number;
    limiter?: BadSignatureLimiter;
  } = {},
) {
  const recorded: Recorded = { events: [], unparsed: [] };
  const app = Fastify({ logger: false });
  open.push(app);
  await registerWebhook(app, {
    channel: createWhatsAppChannel({
      appSecrets: [SECRET],
      baseUrl: "https://channel.invalid",
      apiVersion: "v27.0",
      timeoutMs: 1_000,
    }),
    registration: (query) => registrationChallenge(query, "synthetic-verify-token"),
    sink: {
      events: async (batches, skipped) => void recorded.events.push({ batches, skipped }),
      unparsed: async (info) => void recorded.unparsed.push(info),
      ...overrides.sink,
    },
    ...(overrides.bodyLimit === undefined ? {} : { bodyLimit: overrides.bodyLimit }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    ...(overrides.limiter === undefined ? {} : { limiter: overrides.limiter }),
  });
  const post = (body: Buffer | string, signature: string | undefined, source = "203.0.113.7") =>
    app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      payload: body,
      remoteAddress: source,
      headers: {
        "content-type": "application/json",
        ...(signature === undefined ? {} : { [SIGNATURE_HEADER]: signature }),
      },
    });
  return { app, recorded, post };
}

const PROBLEM = "application/problem+json";

describe("POST /webhooks/whatsapp", () => {
  test("a validly signed event is handed on once and answered 200", async () => {
    const { recorded, post } = await server();
    const body = fixture("inbound-text.json");
    const response = await post(body, sign(body, SECRET));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(recorded.unparsed).toEqual([]);
    expect(recorded.events).toHaveLength(1);
    expect(recorded.events[0]?.batches[0]?.events[0]).toMatchObject({
      kind: "message",
      channelMessageId: "wamid.SYNTHETIC0001",
      content: { type: "text", body: "Do you have a slot on Thursday?" },
    });
  });

  test.each([
    ["a missing signature", undefined],
    ["an empty signature", ""],
    ["a signature under another secret", sign(fixture("inbound-text.json"), "another-secret")],
    ["a signature of another body", sign(Buffer.from("{}"), SECRET)],
  ])("%s is answered 401 and nothing is handed on", async (_what, signature) => {
    const { recorded, post } = await server();
    const response = await post(fixture("inbound-text.json"), signature);
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain(PROBLEM);
    expect(response.json()).toEqual({
      type: "about:blank",
      title: "The signature is missing or wrong",
      status: 401,
      code: "bad-signature",
    });
    expect(recorded).toEqual({ events: [], unparsed: [] });
  });

  test("the signature is checked over the body as sent, whatever content type it claims", async () => {
    const { app, recorded } = await server();
    const body = fixture("inbound-text-arabic-escaped.json");
    for (const type of ["application/json", "text/plain", "application/octet-stream"]) {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        payload: body,
        headers: { "content-type": type, [SIGNATURE_HEADER]: sign(body, SECRET) },
      });
      expect(response.statusCode, type).toBe(200);
    }
    expect(recorded.events).toHaveLength(3);
  });

  test("a signed body that cannot be read is answered 200, and only its hash, size and a code are kept", async () => {
    const { recorded, post } = await server();
    const body = Buffer.from("not json, from +15550142");
    const response = await post(body, sign(body, SECRET));
    expect(response.statusCode).toBe(200);
    expect(recorded.events).toEqual([]);
    expect(recorded.unparsed).toEqual([
      {
        code: "not-json",
        sha256: createHash("sha256").update(body).digest("hex"),
        size: body.length,
      },
    ]);
    expect(JSON.stringify(recorded)).not.toContain("15550142");
  });

  test("an empty body with a valid signature for it is unreadable, not an error", async () => {
    const { recorded, post } = await server();
    const response = await post("", sign(Buffer.alloc(0), SECRET));
    expect(response.statusCode).toBe(200);
    expect(recorded.unparsed).toMatchObject([{ code: "not-json", size: 0 }]);
  });

  test("when the sink fails, the answer is 503 so that the channel sends again, and nothing of the failure is shown", async () => {
    const { post } = await server({
      sink: {
        events: async () => {
          throw new Error("connection to postgres://psa_app:secret@db lost");
        },
      },
    });
    const body = fixture("inbound-text.json");
    const response = await post(body, sign(body, SECRET));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 503, code: "unavailable" });
    expect(response.body).not.toContain("postgres");
  });

  test("no answer repeats anything from the request", async () => {
    const { post } = await server();
    const body = Buffer.from('{"marker":"+15550142 said hello"}');
    for (const signature of [undefined, sign(body, SECRET)]) {
      const response = await post(body, signature);
      expect(response.body).not.toContain("15550142");
    }
  });
});

describe("the size limit (issue #154)", () => {
  test("the limit in use is 3 MiB, which admits the 3 MB the channel may send", () => {
    expect(WEBHOOK_BODY_LIMIT).toBe(3 * 1024 * 1024);
    expect(WEBHOOK_BODY_LIMIT).toBeGreaterThanOrEqual(3_000_000);
  });

  test("a body at the limit is read; one byte over is refused with 413 and nothing is handed on", async () => {
    const { recorded, post } = await server({ bodyLimit: 1_000 });
    const atLimit = Buffer.alloc(1_000, "x");
    expect((await post(atLimit, sign(atLimit, SECRET))).statusCode).toBe(200);
    expect(recorded.unparsed).toHaveLength(1);
    const over = Buffer.alloc(1_001, "x");
    const response = await post(over, sign(over, SECRET));
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ status: 413, code: "too-large" });
    expect(recorded.unparsed).toHaveLength(1);
    expect(recorded.events).toEqual([]);
  });

  test("an oversized body is not counted as a bad signature", async () => {
    const limiter = new BadSignatureLimiter({
      limit: 1,
      windowMs: 1_000,
      blockMs: 1_000,
      maxSources: 10,
    });
    const { post } = await server({ bodyLimit: 10, limiter });
    await post(Buffer.alloc(11, "x"), undefined);
    expect(limiter.size).toBe(0);
  });

  /** Sends only headers over a real connection and returns what comes back. */
  function headersOnly(port: number, lines: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let answer = "";
      socket.setTimeout(3_000, () => {
        socket.destroy();
        resolve(answer === "" ? "no answer within 3 seconds" : answer);
      });
      socket.on("data", (chunk) => {
        answer += chunk.toString("latin1");
        if (answer.includes("\r\n\r\n")) {
          socket.destroy();
          resolve(answer);
        }
      });
      socket.on("error", reject);
      socket.on("connect", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    });
  }

  test("a request that announces an oversized body is refused before any of the body is sent", async () => {
    const { app, recorded } = await server();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const answer = await headersOnly(port, [
      "POST /webhooks/whatsapp HTTP/1.1",
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      `Content-Length: ${WEBHOOK_BODY_LIMIT + 1}`,
      "Connection: close",
    ]);
    expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 413 Payload Too Large");
    expect(recorded).toEqual({ events: [], unparsed: [] });
  });

  test("a body sent in pieces without announcing its size is cut off at the limit", async () => {
    const { app, recorded } = await server({ bodyLimit: 1_000 });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 20; i += 1) {
            controller.enqueue(new Uint8Array(100).fill(120));
          }
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(recorded).toEqual({ events: [], unparsed: [] });
  });
});

describe("the limit on bad signatures (issue #154)", () => {
  const limits = { limit: 10, windowMs: 60_000, blockMs: 60_000, maxSources: 100 };

  test("ten bad signatures from one source block it for a minute, even for a valid request, and no other source", async () => {
    let now = 0;
    const { recorded, post } = await server({
      now: () => now,
      limiter: new BadSignatureLimiter(limits),
    });
    const body = fixture("inbound-text.json");
    const valid = sign(body, SECRET);
    for (let i = 0; i < 10; i += 1) {
      expect((await post(body, "sha256=wrong", "198.51.100.1")).statusCode).toBe(401);
    }
    const blocked = await post(body, valid, "198.51.100.1");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ status: 429, code: "too-many-bad-signatures" });
    expect(recorded.events, "a blocked request is not read, so nothing is handed on").toEqual([]);

    expect((await post(body, valid, "198.51.100.2")).statusCode, "another source").toBe(200);

    now = 59_999;
    expect((await post(body, valid, "198.51.100.1")).statusCode).toBe(429);
    now = 60_000;
    expect((await post(body, valid, "198.51.100.1")).statusCode).toBe(200);
  });

  test("nine bad signatures do not block", async () => {
    const { post } = await server({ now: () => 0, limiter: new BadSignatureLimiter(limits) });
    const body = fixture("inbound-text.json");
    for (let i = 0; i < 9; i += 1) {
      await post(body, undefined, "198.51.100.1");
    }
    expect((await post(body, sign(body, SECRET), "198.51.100.1")).statusCode).toBe(200);
  });

  test("valid requests never count: two thousand from one source in one instant are all answered 200", async () => {
    const { recorded, post } = await server({
      now: () => 0,
      limiter: new BadSignatureLimiter(limits),
    });
    const body = fixture("status-delivered.json");
    const signature = sign(body, SECRET);
    const answers = await Promise.all(
      Array.from({ length: 2_000 }, () => post(body, signature, "198.51.100.1")),
    );
    expect(answers.filter((answer) => answer.statusCode !== 200)).toEqual([]);
    expect(recorded.events).toHaveLength(2_000);
  });

  test("the registration check is not blocked with the source", async () => {
    const { app, post } = await server({ now: () => 0, limiter: new BadSignatureLimiter(limits) });
    for (let i = 0; i < 10; i += 1) {
      await post("x", undefined, "198.51.100.1");
    }
    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=42",
      remoteAddress: "198.51.100.1",
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("GET /webhooks/whatsapp, the registration check", () => {
  test("the right token gets the challenge back as plain text", async () => {
    const { app } = await server();
    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=1158201444",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toBe("1158201444");
  });

  test.each([
    "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
    "hub.mode=subscribe&hub.challenge=1",
    "hub.verify_token=synthetic-verify-token&hub.challenge=1",
    "",
  ])("anything else gets 403 and no challenge: %j", async (query) => {
    const { app } = await server();
    const response = await app.inject({ method: "GET", url: `/webhooks/whatsapp?${query}` });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("the guard does not depend on which channel it guards (NFR-M2)", () => {
  test("the mock channel gets its own path, signature and events", async () => {
    const channel = createMockChannel();
    const events: (readonly EventBatch[])[] = [];
    const app = Fastify({ logger: false });
    open.push(app);
    await registerWebhook(app, {
      channel,
      registration: () => undefined,
      sink: {
        events: async (batches) => void events.push(batches),
        unparsed: async () => undefined,
      },
    });
    const batches: EventBatch[] = [
      {
        receivingNumberId: "mock-number-a",
        events: [
          {
            kind: "message",
            channelMessageId: "mock-in-1",
            from: { phone: "+15550142", userId: null },
            sentAt: new Date("2026-11-18T10:00:00.000Z"),
            content: { type: "text", body: "hello" },
          },
        ],
      },
    ];
    const { rawBody, headers } = channel.webhook(batches);
    const good = await app.inject({
      method: "POST",
      url: "/webhooks/mock",
      payload: rawBody,
      headers: { "content-type": "application/json", ...(headers as Record<string, string>) },
    });
    expect(good.statusCode).toBe(200);
    expect(events).toEqual([batches]);
    const bad = await app.inject({
      method: "POST",
      url: "/webhooks/mock",
      payload: rawBody,
      headers: { "content-type": "application/json", [MOCK_SIGNATURE_HEADER]: "0".repeat(64) },
    });
    expect(bad.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/webhooks/whatsapp" })).statusCode).toBe(404);
  });
});
