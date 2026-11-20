// A stand-in for Meta's servers, for development and CI (R-T3). It does two
// things: it accepts the "send a message" call the WhatsApp channel makes
// and records it, and it sends webhooks, signed as Meta signs them, to the
// product's webhook address. It is not part of any deployment. Its own
// program (`main.ts`) listens on this machine only unless told to serve a
// container, and refuses to start in production.
//
// What it imitates was read from Meta's documentation on 2026-11-18; see
// `packages/channel-whatsapp/fixtures/2026-11-18/README.md`. It imitates
// only what the product uses.

import { randomBytes } from "node:crypto";
import { SIGNATURE_HEADER, sign } from "@polyglot-sales-agent/channel-whatsapp";
import Fastify, { type FastifyInstance } from "fastify";
import { TEST_PAGE } from "./page.ts";

/** The only address the mock listens on: this machine. */
export const MOCK_HOST = "127.0.0.1";

export interface MockOptions {
  /** Signs the webhooks it sends. */
  readonly appSecret: string;
  /** The bearer token a send must carry. */
  readonly accessToken: string;
  /** Where webhooks go: the product's `/webhooks/whatsapp`. Without it, none can be sent. */
  readonly webhookUrl?: string;
  /** For tests. */
  readonly fetch?: typeof fetch;
  /** For tests. Seconds since 1970. */
  readonly now?: () => number;
  /**
   * A part of every message identifier that differs from one start of the
   * mock to the next. Without it a restarted mock would count from 1 again,
   * and the product, which keeps its database, would take its first
   * messages for ones it has seen (and refuse the identifiers of its own
   * replies as already used). Random by default; a test may fix it.
   */
  readonly run?: string;
}

export interface RecordedSend {
  readonly id: string;
  readonly phoneNumberId: string;
  /** As sent: a phone number, or null when the send was addressed by user ID. */
  readonly to: string | null;
  readonly recipient: string | null;
  readonly body: string;
}

interface Failure {
  status: number;
  code: number;
}

const PHONE = /^\+?[1-9][0-9]{1,14}$/;

function graphError(code: number, message: string) {
  return { error: { message, type: "OAuthException", code } };
}

/** An incoming text message as Meta would post it, for a made-up customer. */
export function inboundTextPayload(input: {
  phoneNumberId: string;
  /** Digits, without the plus. Null for a customer who uses a username. */
  from: string | null;
  userId: string;
  text: string;
  id: string;
  timestamp: number;
}): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550100", phone_number_id: input.phoneNumberId },
              contacts: [
                {
                  profile: { name: "Test Customer" },
                  ...(input.from === null ? {} : { wa_id: input.from }),
                  user_id: input.userId,
                },
              ],
              messages: [
                {
                  ...(input.from === null ? {} : { from: input.from }),
                  from_user_id: input.userId,
                  id: input.id,
                  timestamp: String(input.timestamp),
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

export function createMockWhatsApp(options: MockOptions): FastifyInstance {
  // Letters and digits only: it goes into identifiers the product stores and matches.
  const run =
    options.run ?? `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`.toUpperCase();
  const app = Fastify({ logger: false });
  const sent: RecordedSend[] = [];
  const failures: Failure[] = [];
  let inbound = 0;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(TEST_PAGE));

  // The Cloud API's messages endpoint.
  app.post<{ Params: { version: string; phoneNumberId: string } }>(
    "/:version/:phoneNumberId/messages",
    async (request, reply) => {
      if (!/^v[0-9]{1,3}\.[0-9]{1,2}$/.test(request.params.version)) {
        return reply.code(404).send(graphError(2500, "Unknown path components"));
      }
      if (request.headers.authorization !== `Bearer ${options.accessToken}`) {
        return reply.code(401).send(graphError(190, "Invalid OAuth access token"));
      }
      const failure = failures.shift();
      if (failure !== undefined) {
        return reply.code(failure.status).send(graphError(failure.code, "Injected by the test"));
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const text = (body["text"] as { body?: unknown } | undefined)?.body;
      const to = body["to"];
      const recipient = body["recipient"];
      if (
        body["messaging_product"] !== "whatsapp" ||
        body["type"] !== "text" ||
        typeof text !== "string" ||
        text === "" ||
        text.length > 4096 ||
        (to === undefined && recipient === undefined) ||
        (to !== undefined && (typeof to !== "string" || !PHONE.test(to))) ||
        (recipient !== undefined && typeof recipient !== "string")
      ) {
        return reply.code(400).send(graphError(100, "Invalid parameter"));
      }
      const id = `wamid.MOCK${run}${String(sent.length + 1).padStart(6, "0")}`;
      sent.push({
        id,
        phoneNumberId: request.params.phoneNumberId,
        to: typeof to === "string" ? to : null,
        recipient: typeof recipient === "string" ? recipient : null,
        body: text,
      });
      return reply.code(200).send({
        messaging_product: "whatsapp",
        contacts:
          typeof to === "string"
            ? [{ input: to, wa_id: to.replace(/^\+/, "") }]
            : [{ input: recipient }],
        messages: [{ id }],
      });
    },
  );

  // Everything under /mock is this tool's own, not an imitation of anything.
  app.get("/mock/sent", async () => ({ sent }));

  app.post("/mock/reset", async () => {
    sent.length = 0;
    failures.length = 0;
    return { ok: true };
  });

  app.post("/mock/fail-next", async (request, reply) => {
    const { status, code } = (request.body ?? {}) as { status?: unknown; code?: unknown };
    if (
      typeof status !== "number" ||
      !Number.isInteger(status) ||
      status < 400 ||
      status > 599 ||
      typeof code !== "number" ||
      !Number.isInteger(code)
    ) {
      return reply.code(400).send({ error: "status must be 400 to 599 and code a whole number" });
    }
    failures.push({ status, code });
    return { ok: true };
  });

  // Plays a customer: builds the webhook Meta would send, signs it, posts it.
  app.post("/mock/inbound", async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    const from = input["from"] ?? null;
    const phoneNumberId = input["phoneNumberId"];
    const text = input["text"];
    if (
      typeof phoneNumberId !== "string" ||
      phoneNumberId === "" ||
      typeof text !== "string" ||
      text === "" ||
      (from !== null && (typeof from !== "string" || !PHONE.test(from)))
    ) {
      return reply.code(400).send({ error: "phoneNumberId, text and an optional from are needed" });
    }
    if (options.webhookUrl === undefined) {
      return reply.code(409).send({ error: "no webhook address is configured" });
    }
    inbound += 1;
    const id = `wamid.MOCKIN${run}${String(inbound).padStart(6, "0")}`;
    const rawBody = Buffer.from(
      JSON.stringify(
        inboundTextPayload({
          phoneNumberId,
          from: from === null ? null : (from as string).replace(/^\+/, ""),
          userId: "US.10000000000000000042",
          text,
          id,
          timestamp: now(),
        }),
      ),
    );
    try {
      const response = await (options.fetch ?? fetch)(options.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: sign(rawBody, options.appSecret),
        },
        body: rawBody,
      });
      return { id, webhookStatus: response.status };
    } catch {
      return reply.code(502).send({ error: "the webhook address did not answer" });
    }
  });

  return app;
}
