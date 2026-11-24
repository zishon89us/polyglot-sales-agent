// A stand-in for Meta's servers, for development and CI (R-T3). It does two
// things: it accepts the "send a message" call the WhatsApp channel makes
// and records it, and it sends webhooks, signed as Meta signs them, to the
// product's webhook address. It is not part of any deployment. Its own
// program (`main.ts`) listens on this machine only unless told to serve a
// container, and refuses to start in production.
//
// What it imitates was read from Meta's documentation on 2026-11-18 and,
// for reply buttons, taps and captions, on 2026-11-24; see the README of
// each date under `packages/channel-whatsapp/fixtures`. It imitates only
// what the product uses.

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
  /** The reply buttons it carried, as sent: none for a plain text. */
  readonly buttons: readonly { readonly id: string; readonly title: string }[];
}

interface Failure {
  status: number;
  code: number;
}

const PHONE = /^\+?[1-9][0-9]{1,14}$/;

function graphError(code: number, message: string) {
  return { error: { message, type: "OAuthException", code } };
}

/** What a made-up customer sends: a text, a tap on a reply button, or a picture with a caption. */
export type InboundKind =
  | { readonly text: string }
  | {
      readonly button: {
        /** The button's identifier, as it was set when the message was sent. */
        readonly id: string;
        readonly title: string;
        /** The identifier of the message that carried the button. */
        readonly replyTo: string;
      };
    }
  | { readonly caption: string };

function inboundParts(kind: InboundKind): Record<string, unknown> {
  if ("text" in kind) {
    return { type: "text", text: { body: kind.text } };
  }
  if ("button" in kind) {
    return {
      context: { from: "15550100", id: kind.button.replyTo },
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: kind.button.id, title: kind.button.title },
      },
    };
  }
  return {
    type: "image",
    image: {
      caption: kind.caption,
      mime_type: "image/jpeg",
      sha256: "MOCKSHA256",
      id: "100000000000009",
    },
  };
}

/** An incoming message as Meta would post it, for a made-up customer. */
export function inboundPayload(
  input: {
    phoneNumberId: string;
    /** Digits, without the plus. Null for a customer who uses a username. */
    from: string | null;
    userId: string;
    id: string;
    timestamp: number;
  },
  kind: InboundKind,
): unknown {
  const payload = inboundTextPayload({ ...input, text: "x" }) as {
    entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[];
  };
  const message = payload.entry[0]?.changes[0]?.value.messages[0] as Record<string, unknown>;
  delete message["type"];
  delete message["text"];
  Object.assign(message, inboundParts(kind));
  return payload;
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

/**
 * The reply buttons of a send, or undefined if Meta would refuse them: 1
 * to 3, each with an identifier of at most 256 characters and a title of
 * at most 20, the titles all different.
 */
function replyButtons(raw: unknown): { id: string; title: string }[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    return undefined;
  }
  const buttons: { id: string; title: string }[] = [];
  for (const item of raw as { type?: unknown; reply?: { id?: unknown; title?: unknown } }[]) {
    const id = item?.reply?.id;
    const title = item?.reply?.title;
    if (
      item?.type !== "reply" ||
      typeof id !== "string" ||
      id === "" ||
      id.length > 256 ||
      typeof title !== "string" ||
      title === "" ||
      title.length > 20 ||
      buttons.some((other) => other.title === title || other.id === id)
    ) {
      return undefined;
    }
    buttons.push({ id, title });
  }
  return buttons;
}

/** What the tester asked the customer to send, or undefined if it is not exactly one thing. */
function inboundKind(input: Record<string, unknown>): InboundKind | undefined {
  const { text, caption, button } = input;
  const given = [text, caption, button].filter((value) => value !== undefined);
  if (given.length !== 1) {
    return undefined;
  }
  if (typeof text === "string" && text !== "") {
    return { text };
  }
  if (typeof caption === "string" && caption !== "") {
    return { caption };
  }
  const tap = (button ?? {}) as { id?: unknown; title?: unknown; replyTo?: unknown };
  if (
    typeof tap.id === "string" &&
    tap.id !== "" &&
    typeof tap.title === "string" &&
    typeof tap.replyTo === "string" &&
    tap.replyTo !== ""
  ) {
    return { button: { id: tap.id, title: tap.title, replyTo: tap.replyTo } };
  }
  return undefined;
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
      const to = body["to"];
      const recipient = body["recipient"];
      // A text, or a text with reply buttons under the limits read on 2026-11-24.
      let text: unknown;
      let buttons: { id: string; title: string }[] | undefined = [];
      if (body["type"] === "text") {
        text = (body["text"] as { body?: unknown } | undefined)?.body;
        if (typeof text === "string" && text.length > 4096) {
          text = undefined;
        }
      } else if (body["type"] === "interactive") {
        const interactive = (body["interactive"] ?? {}) as {
          type?: unknown;
          body?: { text?: unknown };
          action?: { buttons?: unknown };
        };
        text = interactive.body?.text;
        if (typeof text === "string" && text.length > 1024) {
          text = undefined;
        }
        buttons =
          interactive.type === "button" ? replyButtons(interactive.action?.buttons) : undefined;
      }
      if (
        body["messaging_product"] !== "whatsapp" ||
        typeof text !== "string" ||
        text === "" ||
        buttons === undefined ||
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
        buttons,
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
  // One of `text`, `caption` (under a picture) or `button` (a tap) is given.
  app.post("/mock/inbound", async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    const from = input["from"] ?? null;
    const phoneNumberId = input["phoneNumberId"];
    const kind = inboundKind(input);
    if (
      typeof phoneNumberId !== "string" ||
      phoneNumberId === "" ||
      kind === undefined ||
      (from !== null && (typeof from !== "string" || !PHONE.test(from)))
    ) {
      return reply.code(400).send({
        error: "phoneNumberId, an optional from, and one of text, caption or button are needed",
      });
    }
    if (options.webhookUrl === undefined) {
      return reply.code(409).send({ error: "no webhook address is configured" });
    }
    inbound += 1;
    const id = `wamid.MOCKIN${run}${String(inbound).padStart(6, "0")}`;
    const rawBody = Buffer.from(
      JSON.stringify(
        inboundPayload(
          {
            phoneNumberId,
            from: from === null ? null : (from as string).replace(/^\+/, ""),
            userId: "US.10000000000000000042",
            id,
            timestamp: now(),
          },
          kind,
        ),
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
