// A second implementation of the channel interface, with a format of its
// own, living in memory (NFR-M2). It is what a test of the worker or the
// webhook path uses when the test is not about WhatsApp: no HTTP, nothing
// to start. It imitates no real service. The stand-in for Meta's servers,
// which the WhatsApp channel talks to over HTTP, is `apps/mock-whatsapp`.
//
// It must never be registered in a deployment: its signing secret and
// token are constants in this file.

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  Channel,
  ChannelEvent,
  ChannelLimits,
  ChannelUser,
  EventBatch,
  Headers,
  ParsedWebhook,
  SendButton,
  SendFrom,
  SendResult,
} from "@polyglot-sales-agent/channel";
import {
  BUTTON_PAYLOAD,
  CHANNEL_MESSAGE_ID,
  checkButtonMessage,
  checkText,
  DELIVERY_STATUSES,
  refusedUnsent,
  singleHeader,
} from "@polyglot-sales-agent/channel";

/**
 * This channel's own limits. Two buttons, where WhatsApp has three: a
 * caller that assumed another channel's numbers is caught by a test.
 */
export const MOCK_LIMITS: ChannelLimits = {
  textMax: 2_000,
  buttons: { max: 2, bodyMax: 500, titleMax: 16, payloadMax: 100 },
};

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const MOCK_ACCESS_TOKEN = "mock-access-token";
const SECRET = "mock-signing-secret";

export interface SentMessage {
  readonly channelMessageId: string;
  readonly from: SendFrom;
  readonly to: ChannelUser;
  readonly body: string;
  /** The buttons it carried; none for a plain text. */
  readonly buttons: readonly SendButton[];
}

export interface MockChannel extends Channel {
  /** Every message accepted so far, oldest first. */
  readonly sent: readonly SentMessage[];
  /** Makes the next send fail with this result, once. */
  failNextSend(code: string, retryable: boolean, mayHaveArrived?: boolean): void;
  /** A webhook body and its headers, signed, carrying these batches. */
  webhook(batches: readonly EventBatch[]): { rawBody: Buffer; headers: Headers };
}

function signature(rawBody: Buffer): Buffer {
  return createHmac("sha256", SECRET).update(rawBody).digest();
}

const USER = /^\+[1-9][0-9]{1,14}$/;

function revive(raw: unknown): ChannelEvent {
  const item = raw as Record<string, unknown>;
  const id = item["channelMessageId"];
  if (typeof id !== "string" || id === "") {
    throw new Error("bad");
  }
  if (item["kind"] === "status") {
    const at = new Date(item["at"] as string);
    const errorCode = item["errorCode"];
    if (
      !(DELIVERY_STATUSES as readonly unknown[]).includes(item["status"]) ||
      Number.isNaN(at.getTime()) ||
      (errorCode !== null && typeof errorCode !== "string")
    ) {
      throw new Error("bad");
    }
    return {
      kind: "status",
      channelMessageId: id,
      status: item["status"] as (typeof DELIVERY_STATUSES)[number],
      at,
      errorCode,
    };
  }
  if (item["kind"] !== "message") {
    throw new Error("bad");
  }
  const from = item["from"] as { phone?: unknown; userId?: unknown } | null;
  const content = item["content"] as {
    type?: unknown;
    body?: unknown;
    channelType?: unknown;
    captionOf?: unknown;
    payload?: unknown;
    inReplyTo?: unknown;
  };
  const sentAt = new Date(item["sentAt"] as string);
  const phone = from?.phone ?? null;
  const userId = from?.userId ?? null;
  if (
    (phone !== null && (typeof phone !== "string" || !USER.test(phone))) ||
    (userId !== null && typeof userId !== "string") ||
    (phone === null && userId === null) ||
    Number.isNaN(sentAt.getTime())
  ) {
    throw new Error("bad");
  }
  if (content?.type === "text" && typeof content.body === "string") {
    const captionOf = content.captionOf;
    if (captionOf !== undefined && captionOf !== "image" && captionOf !== "video") {
      throw new Error("bad");
    }
    return {
      kind: "message",
      channelMessageId: id,
      from: { phone, userId },
      sentAt,
      content:
        captionOf === undefined
          ? { type: "text", body: content.body }
          : { type: "text", body: content.body, captionOf },
    };
  }
  if (content?.type === "button") {
    const inReplyTo = content.inReplyTo ?? null;
    // As the real channel does: a tap whose payload cannot be kept is an
    // unread message, and what is not an identifier is no identifier.
    return {
      kind: "message",
      channelMessageId: id,
      from: { phone, userId },
      sentAt,
      content:
        typeof content.payload === "string" && BUTTON_PAYLOAD.test(content.payload)
          ? {
              type: "button",
              payload: content.payload,
              inReplyTo:
                typeof inReplyTo === "string" && CHANNEL_MESSAGE_ID.test(inReplyTo)
                  ? inReplyTo
                  : null,
            }
          : { type: "unsupported", channelType: "tap" },
    };
  }
  if (content?.type === "unsupported" && typeof content.channelType === "string") {
    return {
      kind: "message",
      channelMessageId: id,
      from: { phone, userId },
      sentAt,
      content: { type: "unsupported", channelType: content.channelType },
    };
  }
  throw new Error("bad");
}

function parseWebhook(rawBody: Buffer): ParsedWebhook {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, code: "not-json" };
  }
  try {
    const batches = (body as { mockBatches: unknown[] }).mockBatches.map((raw) => {
      const batch = raw as { receivingNumberId: unknown; events: unknown[] };
      if (typeof batch.receivingNumberId !== "string" || batch.receivingNumberId === "") {
        throw new Error("bad");
      }
      return { receivingNumberId: batch.receivingNumberId, events: batch.events.map(revive) };
    });
    return { ok: true, batches, skipped: 0, malformed: 0 };
  } catch {
    return { ok: false, code: "bad-shape" };
  }
}

export function createMockChannel(): MockChannel {
  const sent: SentMessage[] = [];
  let failure: SendResult | undefined;
  const channel: MockChannel = {
    name: "mock",
    maxWebhookBytes: 1024 * 1024,
    sent,
    failNextSend(code, retryable, mayHaveArrived = false) {
      failure = { accepted: false, retryable, mayHaveArrived, code };
    },
    webhook(batches) {
      const rawBody = Buffer.from(JSON.stringify({ mockBatches: batches }));
      return {
        rawBody,
        headers: { [MOCK_SIGNATURE_HEADER]: signature(rawBody).toString("hex") },
      };
    },
    verifyWebhook(rawBody, headers) {
      const given = singleHeader(headers, MOCK_SIGNATURE_HEADER);
      if (given === undefined || !/^[0-9a-f]{64}$/.test(given)) {
        return false;
      }
      return timingSafeEqual(Buffer.from(given, "hex"), signature(rawBody));
    },
    parseWebhook,
    limits: MOCK_LIMITS,
    async sendText(from, to, body) {
      const refusal = checkText(MOCK_LIMITS, body);
      return refusal === undefined ? deliver(from, to, body, []) : refusedUnsent(refusal);
    },
    async sendButtons(from, to, body, buttons) {
      const refusal = checkButtonMessage(MOCK_LIMITS, body, buttons);
      return refusal === undefined
        ? deliver(
            from,
            to,
            body,
            buttons.map((button) => ({ payload: button.payload, title: button.title })),
          )
        : refusedUnsent(refusal);
    },
  };
  /** What both sends do once the message itself is in order. */
  function deliver(
    from: SendFrom,
    to: ChannelUser,
    body: string,
    buttons: readonly SendButton[],
  ): SendResult {
    if (failure !== undefined) {
      const result = failure;
      failure = undefined;
      return result;
    }
    if (from.accessToken !== MOCK_ACCESS_TOKEN) {
      return refusedUnsent("not-authorised");
    }
    if (to.phone === null && to.userId === null) {
      return refusedUnsent("no-recipient");
    }
    const channelMessageId = `mock.${sent.length + 1}`;
    sent.push({ channelMessageId, from, to, body, buttons });
    return { accepted: true, channelMessageId };
  }
  return channel;
}
