// Meta's webhook payload, turned into the system's own events. The shapes
// are those of the fixtures under fixtures/2026-11-18, which were written
// from Meta's documentation as read on that date. No live event has been
// seen (threat model, A7).
//
// Strict where it matters and tolerant elsewhere. A field it does not know
// is ignored. A part it does not handle (another webhook field, a status it
// does not know) is counted as skipped and left out. A message or a status
// that lacks a field this code relies on, or has it in another form, is
// counted as malformed and left out, and the rest of the webhook is still
// read: one odd item must not cost the messages beside it. An entry or a
// group of messages that cannot be walked counts as one, however much it
// held. Only a body that is not the channel's webhook at all is refused.

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

/** An identifier: printable characters without spaces. */
function identifier(value: unknown, max: number): string {
  const id = text(value, max);
  if (!/^[\x21-\x7e]+$/.test(id)) {
    throw new BadShape();
  }
  return id;
}

/** Meta's identifier of a business number: digits. */
function numberId(value: unknown): string {
  const id = text(value, 32);
  if (!/^[0-9]+$/.test(id)) {
    throw new BadShape();
  }
  return id;
}

const YEAR_2100 = 4_102_444_800;

/** Meta gives a time as a string of seconds since 1970. */
function time(value: unknown): Date {
  const seconds = text(value, 12);
  if (!/^[0-9]{1,12}$/.test(seconds) || Number(seconds) > YEAR_2100) {
    throw new BadShape();
  }
  return new Date(Number(seconds) * 1000);
}

/**
 * A customer's text. The character U+0000 is removed: no store this system
 * uses can hold it, and it means nothing in a message.
 */
function messageText(value: unknown): string {
  const body = text(value, 65_536).replaceAll("\u0000", "");
  if (body === "") {
    throw new BadShape();
  }
  return body;
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
    channelMessageId: identifier(item["id"], 128),
    from,
    sentAt: time(item["timestamp"]),
    content:
      type === "text"
        ? { type: "text", body: messageText(object(item["text"])["body"]) }
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
  // The form of a failed status's errors was read from an extract only, so
  // anything unexpected there becomes "unknown" and the status is kept.
  let errorCode: string | null = null;
  if (item["errors"] !== undefined) {
    const first: unknown = Array.isArray(item["errors"]) ? item["errors"][0] : undefined;
    const code = typeof first === "object" && first !== null ? (first as Json)["code"] : undefined;
    errorCode =
      typeof code === "number" && Number.isSafeInteger(code) && code >= 0
        ? String(code)
        : "unknown";
  }
  return {
    kind: "status",
    channelMessageId: identifier(item["id"], 128),
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
  let entries: readonly unknown[];
  try {
    entries = list((body as Json)["entry"]);
  } catch {
    return { ok: false, code: "bad-shape" };
  }
  const batches: EventBatch[] = [];
  let skipped = 0;
  let malformed = 0;
  /** Runs one item's reading; an item of the wrong form is counted once, not fatal. */
  const attempt = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      if (error instanceof BadShape) {
        malformed += 1;
        return undefined;
      }
      throw error;
    }
  };
  // An entry that cannot be walked is counted and the entries beside it are read.
  const changes = entries.flatMap((entry) => attempt(() => list(object(entry)["changes"])) ?? []);
  for (const rawChange of changes) {
    const change = attempt(() => object(rawChange));
    if (change === undefined) {
      continue;
    }
    if (change["field"] !== "messages") {
      skipped += 1;
      continue;
    }
    // Without the receiving number nothing in this change can be routed.
    const group = attempt(() => {
      const value = object(change["value"]);
      return {
        receivingNumberId: numberId(object(value["metadata"])["phone_number_id"]),
        messages: value["messages"] === undefined ? [] : list(value["messages"]),
        statuses: value["statuses"] === undefined ? [] : list(value["statuses"]),
      };
    });
    if (group === undefined) {
      continue;
    }
    const events: ChannelEvent[] = [];
    for (const raw of group.messages) {
      const event = attempt(() => message(raw));
      if (event !== undefined) {
        events.push(event);
      }
    }
    for (const raw of group.statuses) {
      const before = malformed;
      const event = attempt(() => status(raw));
      if (event !== undefined) {
        events.push(event);
      } else if (malformed === before) {
        skipped += 1;
      }
    }
    batches.push({ receivingNumberId: group.receivingNumberId, events });
  }
  return { ok: true, batches, skipped, malformed };
}
