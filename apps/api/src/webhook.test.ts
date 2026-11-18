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
  MAX_WEBHOOK_BYTES,
  registrationChallenge,
  SIGNATURE_HEADER,
  sign,
} from "@polyglot-sales-agent/channel-whatsapp";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { BadSignatureLimiter } from "./bad-signature-limiter.ts";
import { createApiServer } from "./server.ts";
import { registerWebhook, SINK_DEADLINE_MS, type WebhookSink } from "./webhook.ts";

const SECRET = "synthetic-app-secret";
const fixture = (name: string): Buffer =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../packages/channel-whatsapp/fixtures/2026-11-18/${name}`, import.meta.url),
    ),
  );

interface Recorded {
  events: { batches: readonly EventBatch[]; skipped: number; malformed: number }[];
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
    trustedProxies?: false | readonly string[];
    requestTimeoutMs?: number;
    sinkDeadlineMs?: number;
  } = {},
) {
  const recorded: Recorded = { events: [], unparsed: [] };
  const app = createApiServer({
    trustedProxies: overrides.trustedProxies ?? false,
    ...(overrides.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: overrides.requestTimeoutMs }),
  });
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
      events: async (batches, counts) => void recorded.events.push({ batches, ...counts }),
      unparsed: async (info) => void recorded.unparsed.push(info),
      ...overrides.sink,
    },
    ...(overrides.bodyLimit === undefined ? {} : { bodyLimit: overrides.bodyLimit }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    ...(overrides.limiter === undefined ? {} : { limiter: overrides.limiter }),
    ...(overrides.sinkDeadlineMs === undefined ? {} : { sinkDeadlineMs: overrides.sinkDeadlineMs }),
  });
  const post = (
    body: Buffer | string,
    signature: string | undefined,
    source = "203.0.113.7",
    more: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      payload: body,
      remoteAddress: source,
      headers: {
        "content-type": "application/json",
        ...(signature === undefined ? {} : { [SIGNATURE_HEADER]: signature }),
        ...more,
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
  test("the limit is the channel's own: 3 MiB, which admits the 3 MB WhatsApp may send", () => {
    expect(MAX_WEBHOOK_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_WEBHOOK_BYTES).toBeGreaterThanOrEqual(3_000_000);
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

  test("an oversized body counts towards the limit on refused requests", async () => {
    const limiter = new BadSignatureLimiter({
      limit: 2,
      windowMs: 1_000,
      blockMs: 1_000,
      maxSources: 10,
    });
    const { post } = await server({ bodyLimit: 10, limiter, now: () => 0 });
    expect((await post(Buffer.alloc(11, "x"), undefined)).statusCode).toBe(413);
    expect((await post(Buffer.alloc(11, "x"), undefined)).statusCode).toBe(413);
    expect((await post("x", undefined)).statusCode).toBe(429);
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

  test("a request that announces an oversized body is refused before any of the body is read", async () => {
    const { app, recorded } = await server();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const answer = await headersOnly(port, [
      "POST /webhooks/whatsapp HTTP/1.1",
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      `Content-Length: ${MAX_WEBHOOK_BYTES + 1}`,
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
    expect(blocked.json()).toMatchObject({ status: 429, code: "too-many-refused" });
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

  test("valid requests never count: a hundred in a row from one source, after nine bad ones, are all answered 200", async () => {
    const { recorded, post } = await server({
      now: () => 0,
      limiter: new BadSignatureLimiter(limits),
    });
    const body = fixture("status-delivered.json");
    const signature = sign(body, SECRET);
    for (let i = 0; i < 9; i += 1) {
      expect((await post(body, undefined, "198.51.100.1")).statusCode).toBe(401);
    }
    // One after another: each is counted, or not, before the next arrives.
    for (let i = 0; i < 100; i += 1) {
      expect((await post(body, signature, "198.51.100.1")).statusCode, `request ${i}`).toBe(200);
    }
    expect(recorded.events).toHaveLength(100);
    // The nine are still remembered: one more bad one blocks.
    expect((await post(body, undefined, "198.51.100.1")).statusCode).toBe(401);
    expect((await post(body, signature, "198.51.100.1")).statusCode).toBe(429);
  });

  test("a source is the connection's address: a header naming another address changes nothing", async () => {
    const { post } = await server({ now: () => 0, limiter: new BadSignatureLimiter(limits) });
    const body = fixture("inbound-text.json");
    for (let i = 0; i < 10; i += 1) {
      await post(body, undefined, "198.51.100.1", { "x-forwarded-for": `203.0.113.${i}` });
    }
    expect(
      (await post(body, sign(body, SECRET), "198.51.100.1", { "x-forwarded-for": "203.0.113.99" }))
        .statusCode,
      "rotating the header does not avoid the limit",
    ).toBe(429);
    expect(
      (await post(body, sign(body, SECRET), "198.51.100.2", { "x-forwarded-for": "198.51.100.1" }))
        .statusCode,
      "and naming a blocked address does not get another source blocked",
    ).toBe(200);
  });

  test("behind a declared proxy, a source is the address the proxy reports", async () => {
    const { post } = await server({
      now: () => 0,
      limiter: new BadSignatureLimiter(limits),
      trustedProxies: ["192.0.2.10"],
    });
    const body = fixture("inbound-text.json");
    const viaProxy = (caller: string, signature: string | undefined) =>
      post(body, signature, "192.0.2.10", { "x-forwarded-for": caller });
    for (let i = 0; i < 10; i += 1) {
      await viaProxy("198.51.100.1", undefined);
    }
    expect((await viaProxy("198.51.100.1", sign(body, SECRET))).statusCode).toBe(429);
    expect((await viaProxy("198.51.100.2", sign(body, SECRET))).statusCode).toBe(200);
  });

  test("wrong registration tokens count too, so the token cannot be guessed at without limit", async () => {
    const { app } = await server({ now: () => 0, limiter: new BadSignatureLimiter(limits) });
    const attempt = (token: string) =>
      app.inject({
        method: "GET",
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`,
        remoteAddress: "198.51.100.1",
      });
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(`guess-${i}`)).statusCode).toBe(403);
    }
    expect((await attempt("synthetic-verify-token")).statusCode).toBe(429);
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
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
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

describe("order, deadlines and what else is answered", () => {
  test("nothing is read out of a body before its signature is checked", async () => {
    const real = createWhatsAppChannel({
      appSecrets: [SECRET],
      baseUrl: "https://channel.invalid",
      apiVersion: "v27.0",
      timeoutMs: 1_000,
    });
    const calls: string[] = [];
    const app = createApiServer({ trustedProxies: false });
    open.push(app);
    await registerWebhook(app, {
      channel: {
        ...real,
        verifyWebhook: (body, headers) => {
          calls.push("verify");
          return real.verifyWebhook(body, headers);
        },
        parseWebhook: (body) => {
          calls.push("parse");
          return real.parseWebhook(body);
        },
      },
      registration: () => undefined,
      sink: { events: async () => undefined, unparsed: async () => undefined },
    });
    const body = fixture("inbound-text.json");
    const send = (signature: string) =>
      app.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        payload: body,
        headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
      });
    await send("sha256=wrong");
    expect(calls, "a refused body is never parsed").toEqual(["verify"]);
    await send(sign(body, SECRET));
    expect(calls).toEqual(["verify", "verify", "parse"]);
  });

  test("what was left out of a webhook is passed on as counts", async () => {
    const { recorded, post } = await server();
    const other = fixture("other-field.json");
    await post(other, sign(other, SECRET));
    expect(recorded.events).toEqual([{ batches: [], skipped: 1, malformed: 0 }]);
  });

  test("a sink that does not finish in time is answered 503; the deadline in use is 5 seconds", async () => {
    expect(SINK_DEADLINE_MS).toBe(5_000);
    const { post } = await server({
      sinkDeadlineMs: 50,
      sink: { events: () => new Promise(() => undefined) },
    });
    const body = fixture("inbound-text.json");
    const response = await post(body, sign(body, SECRET));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "unavailable" });
  });

  test("the 200 is sent only after the sink has finished", async () => {
    let finish: () => void = () => undefined;
    const { post } = await server({
      sink: {
        events: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const body = fixture("inbound-text.json");
    let answered = false;
    const pending = post(body, sign(body, SECRET)).then((response) => {
      answered = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(answered).toBe(false);
    finish();
    expect((await pending).statusCode).toBe(200);
  });

  test("an error from the sink that carries a status of its own is still answered 503", async () => {
    const { post } = await server({
      sink: {
        events: async () => {
          throw Object.assign(new Error("x"), { statusCode: 413 });
        },
      },
    });
    const body = fixture("inbound-text.json");
    expect((await post(body, sign(body, SECRET))).statusCode).toBe(503);
  });

  test("a body that arrives too slowly is cut off", async () => {
    const { app } = await server({ requestTimeoutMs: 300 });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect(port, "127.0.0.1");
      let answer = "";
      socket.on("connect", () => {
        socket.write(
          "POST /webhooks/whatsapp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\nx",
        );
      });
      socket.on("data", (chunk) => {
        answer += chunk.toString("latin1");
      });
      socket.on("close", () =>
        resolve(answer === "" ? "closed" : (answer.split("\r\n")[0] as string)),
      );
      socket.on("error", () => resolve("closed"));
      socket.setTimeout(3_000, () => {
        socket.destroy();
        resolve("still open after 3 seconds");
      });
    });
    expect(["closed", "HTTP/1.1 408 Request Timeout"]).toContain(outcome);
  });

  test("an unknown path or a broken request is answered without repeating anything of it", async () => {
    const { app } = await server();
    const missing = await app.inject({ method: "GET", url: "/no-such/+15550142" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      type: "about:blank",
      title: "No such route",
      status: 404,
      code: "not-found",
    });
    expect(missing.body).not.toContain("15550142");
    for (const method of ["PUT", "DELETE", "PATCH"] as const) {
      expect((await app.inject({ method, url: "/webhooks/whatsapp" })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: "POST", url: "/webhooks/whatsapp/" })).statusCode).toBe(404);
  });
});

describe("the guard does not depend on which channel it guards (NFR-M2)", () => {
  test("the mock channel gets its own path, signature and events", async () => {
    const channel = createMockChannel();
    const events: (readonly EventBatch[])[] = [];
    const app = createApiServer({ trustedProxies: false });
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
