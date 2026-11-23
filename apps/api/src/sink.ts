// What the webhook does with verified events: store them and queue their
// jobs (`docs/design/architecture.md`, "What the webhook does with each
// kind of event"). It holds no SQL and no database driver; every statement
// is in `packages/db`.

import type { Channel, ChannelEvent, EventBatch } from "@polyglot-sales-agent/channel";
import {
  type Database,
  type IncomingMessage,
  type IncomingStatus,
  recordUnparsed,
  recordUnroutable,
  storeInbound,
  tenantOfReceivingNumber,
} from "@polyglot-sales-agent/db";
import type { WebhookSink } from "./webhook.ts";

export interface SinkOptions {
  /** The channel's name, recorded with events that reach no tenant. */
  readonly channel: Pick<Channel, "name">;
  /** The application role's. */
  readonly app: Database;
  /** The cross-tenant role's: finds the tenant of a number, and records what has none. */
  readonly cross: Database;
}

function split(events: readonly ChannelEvent[]): {
  messages: IncomingMessage[];
  statuses: IncomingStatus[];
} {
  const messages: IncomingMessage[] = [];
  const statuses: IncomingStatus[] = [];
  for (const event of events) {
    if (event.kind === "status") {
      statuses.push({
        channelMessageId: event.channelMessageId,
        status: event.status,
        errorCode: event.errorCode,
      });
    } else {
      const content = event.content;
      messages.push({
        channelMessageId: event.channelMessageId,
        phone: event.from.phone,
        userId: event.from.userId,
        sentAt: event.sentAt,
        ...(content.type === "text"
          ? { kind: "text", body: content.body, captionOf: content.captionOf ?? null }
          : content.type === "button"
            ? {
                kind: "button",
                body: null,
                buttonPayload: content.payload,
                inReplyTo: content.inReplyTo,
              }
            : {
                // A channel's name for a type is never stored under one of
                // this system's own names for a kind.
                kind: OWN_KINDS.includes(content.channelType) ? "unknown" : content.channelType,
                body: null,
              }),
      });
    }
  }
  return { messages, statuses };
}

/** The kinds this system gives a message itself (data model, `messages.kind`). */
const OWN_KINDS: readonly string[] = ["text", "button", "template"];

/** All the events of one webhook for one receiving number, in the order they came. */
function byNumber(batches: readonly EventBatch[]): Map<string, ChannelEvent[]> {
  const groups = new Map<string, ChannelEvent[]>();
  for (const batch of batches) {
    const events = groups.get(batch.receivingNumberId) ?? [];
    events.push(...batch.events);
    groups.set(batch.receivingNumberId, events);
  }
  return groups;
}

/**
 * Stops between steps once the request has been answered 503. A step that
 * is already running is not stopped and may still commit; every step is
 * safe to repeat when the channel sends the webhook again.
 */
function stopIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw Object.assign(new Error("the webhook's deadline passed"), { code: "deadline" });
  }
}

export function createSink(options: SinkOptions): WebhookSink {
  const channel = options.channel.name;
  return {
    async events(batches, info, signal) {
      // One transaction per receiving number, whatever way the channel grouped its events.
      for (const [receivingNumberId, events] of byNumber(batches)) {
        stopIfAborted(signal);
        const tenantId = await tenantOfReceivingNumber(options.cross, receivingNumberId);
        if (tenantId === undefined) {
          for (const event of events) {
            await recordUnroutable(options.cross, {
              channel,
              receivingNumberId,
              channelMessageId: event.channelMessageId,
              kind: event.kind,
            });
          }
          continue;
        }
        const { messages, statuses } = split(events);
        await storeInbound(options.app, tenantId, receivingNumberId, messages, statuses);
      }
      // Last, so that it is recorded even though the rest was read: someone must look.
      if (info.malformed > 0) {
        stopIfAborted(signal);
        await recordUnparsed(options.cross, {
          channel,
          payloadHash: info.sha256,
          sizeBytes: info.size,
          errorCode: "malformed-items",
          itemsLeftOut: info.malformed,
        });
      }
    },
    async unparsed(info, signal) {
      stopIfAborted(signal);
      await recordUnparsed(options.cross, {
        channel,
        payloadHash: info.sha256,
        sizeBytes: info.size,
        errorCode: info.code,
        itemsLeftOut: null,
      });
    },
  };
}
