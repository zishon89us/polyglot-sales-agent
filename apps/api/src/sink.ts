// What the webhook does with verified events: store them and queue their
// jobs (`docs/design/architecture.md`, "Receiving an event"). It holds no
// SQL; every statement is in `packages/db`.

import type { Channel, ChannelEvent, EventBatch } from "@polyglot-sales-agent/channel";
import {
  type IncomingMessage,
  type IncomingStatus,
  type Queryable,
  recordUnparsed,
  recordUnroutable,
  storeInbound,
  tenantOfReceivingNumber,
} from "@polyglot-sales-agent/db";
import type pg from "pg";
import type { WebhookSink } from "./webhook.ts";

export interface SinkOptions {
  /** The channel's name, recorded with events that reach no tenant. */
  readonly channel: Pick<Channel, "name">;
  /** Connects as the application role. */
  readonly app: pg.Pool;
  /** Connects as the cross-tenant role: finds the tenant of a number, records what has none. */
  readonly cross: Queryable;
}

function split(events: readonly ChannelEvent[]): {
  messages: IncomingMessage[];
  statuses: IncomingStatus[];
} {
  const messages: IncomingMessage[] = [];
  const statuses: IncomingStatus[] = [];
  for (const event of events) {
    if (event.kind === "status") {
      statuses.push({ channelMessageId: event.channelMessageId, status: event.status });
    } else {
      messages.push({
        channelMessageId: event.channelMessageId,
        phone: event.from.phone,
        userId: event.from.userId,
        kind: event.content.type === "text" ? "text" : "unsupported",
        body: event.content.type === "text" ? event.content.body : null,
      });
    }
  }
  return { messages, statuses };
}

/** Stops between steps once the request has been answered 503. What is already committed stays; all of it is safe to repeat. */
function stopIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw Object.assign(new Error("the webhook's deadline passed"), { code: "deadline" });
  }
}

export function createSink(options: SinkOptions): WebhookSink {
  const channel = options.channel.name;
  return {
    async events(batches: readonly EventBatch[], info, signal) {
      for (const batch of batches) {
        stopIfAborted(signal);
        const tenantId = await tenantOfReceivingNumber(options.cross, batch.receivingNumberId);
        if (tenantId === undefined) {
          for (const event of batch.events) {
            await recordUnroutable(options.cross, {
              channel,
              receivingNumberId: batch.receivingNumberId,
              channelMessageId: event.channelMessageId,
              kind: event.kind,
            });
          }
          continue;
        }
        const { messages, statuses } = split(batch.events);
        await storeInbound(options.app, tenantId, batch.receivingNumberId, messages, statuses);
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
