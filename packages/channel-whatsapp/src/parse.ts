// Meta's webhook payload, turned into the system's own events. The shapes
// are those of the fixtures under fixtures/2026-11-18, which were written
// from Meta's documentation as read on that date. No live event has been
// seen (threat model, A7).
//
// Strict where it matters and tolerant elsewhere: a field this code relies
// on must have the right form or the whole payload is refused with a code;
// a field it does not know is ignored; a part it does not handle (another
// webhook field, a status it does not know) is counted and left out.

import type {
  ChannelEvent,
  ChannelUser,
  DeliveryStatus,
  EventBatch,
  ParsedWebhook,
} from "@polyglot-sales-agent/channel";
import { DELIVERY_STATUSES } from "@polyglot-sales-agent/channel";

type Json = Readonly<Record<string, unknown>>;

class BadShape extends Error {}

function object(value: unknown): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadShape();
  }
  return value as Json;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BadShape();
  }
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value === "" || value.length > max) {
    throw new BadShape();
  }
  return value;
}

/** Meta gives a time as a string of seconds since 1970. */
function time(value: unknown): Date {
  const seconds = text(value, 12);
  if (!/^[0-9]{1,12}$/.test(seconds)) {
    throw new BadShape();
  }
  return new Date(Number(seconds) * 1000);
}

/** Meta gives a number as digits without the plus. */
function phone(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const digits = text(value, 15);
  if (!/^[1-9][0-9]{1,14}$/.test(digits)) {
    throw new BadShape();
  }
  return `+${digits}`;
}

/** A business-scoped user ID: a country code, a period, and letters and digits. */
function userId(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const id = text(value, 140);
  if (!/^[A-Z]{2}\.[A-Za-z0-9.]{1,136}$/.test(id)) {
    throw new BadShape();
  }
  return id;
}

function message(raw: unknown): ChannelEvent {
  const item = object(raw);
  const from: ChannelUser = { phone: phone(item["from"]), userId: userId(item["from_user_id"]) };
  if (from.phone === null && from.userId === null) {
    throw new BadShape();
  }
  const type = text(item["type"], 40);
  return {
    kind: "message",
    channelMessageId: text(item["id"], 128),
    from,
    sentAt: time(item["timestamp"]),
    content:
      type === "text"
        ? { type: "text", body: text(object(item["text"])["body"], 65_536) }
        : { type: "unsupported", channelType: /^[a-z_]{1,40}$/.test(type) ? type : "unknown" },
  };
}

function status(raw: unknown): ChannelEvent | undefined {
  const item = object(raw);
  const value = text(item["status"], 40);
  if (!(DELIVERY_STATUSES as readonly string[]).includes(value)) {
    // A status this version does not know. Its other fields are not checked.
    return undefined;
  }
  let errorCode: string | null = null;
  if (item["errors"] !== undefined) {
    const code = object(list(item["errors"])[0])["code"];
    errorCode = typeof code === "number" && Number.isInteger(code) ? String(code) : "unknown";
  }
  return {
    kind: "status",
    channelMessageId: text(item["id"], 128),
    status: value as DeliveryStatus,
    at: time(item["timestamp"]),
    errorCode,
  };
}

export function parseWebhook(rawBody: Buffer): ParsedWebhook {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, code: "not-json" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "not-an-object" };
  }
  if ((body as Json)["object"] !== "whatsapp_business_account") {
    return { ok: false, code: "wrong-object" };
  }
  try {
    const batches: EventBatch[] = [];
    let skipped = 0;
    for (const entry of list((body as Json)["entry"])) {
      for (const rawChange of list(object(entry)["changes"])) {
        const change = object(rawChange);
        if (change["field"] !== "messages") {
          skipped += 1;
          continue;
        }
        const value = object(change["value"]);
        const events: ChannelEvent[] = [];
        for (const raw of value["messages"] === undefined ? [] : list(value["messages"])) {
          events.push(message(raw));
        }
        for (const raw of value["statuses"] === undefined ? [] : list(value["statuses"])) {
          const event = status(raw);
          if (event === undefined) {
            skipped += 1;
          } else {
            events.push(event);
          }
        }
        batches.push({
          receivingNumberId: text(object(value["metadata"])["phone_number_id"], 64),
          events,
        });
      }
    }
    return { ok: true, batches, skipped };
  } catch (error) {
    if (error instanceof BadShape) {
      return { ok: false, code: "bad-shape" };
    }
    throw error;
  }
}
