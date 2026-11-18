// What the rest of the system knows about a messaging channel (NFR-M2).
// A channel turns its own webhooks into the events below and sends a
// message when asked. Nothing here names WhatsApp; all knowledge of one
// channel's payloads lives in that channel's package.
//
// Built so far (M2 unit U6): verify a webhook, parse it, send a free-form
// text. Still to come with the units that need them: sending a template,
// submitting a template for approval, checking credentials.

/**
 * The customer at the other end. A channel may give a phone number, an
 * identifier of its own for the person, or both, and at least one. WhatsApp
 * can leave the number out (see `packages/channel-whatsapp/fixtures`).
 */
export interface ChannelUser {
  /** E.164 with the leading plus, or null when the channel did not give one. */
  readonly phone: string | null;
  /** The channel's own identifier for the person, or null when it gave none. */
  readonly userId: string | null;
}

/** What a customer sent. Only text is read; anything else is named, not interpreted. */
export type InboundContent =
  | { readonly type: "text"; readonly body: string }
  | { readonly type: "unsupported"; readonly channelType: string };

export interface InboundMessage {
  readonly kind: "message";
  /** The channel's identifier for this message; the same on a redelivery. */
  readonly channelMessageId: string;
  readonly from: ChannelUser;
  /** When the channel says it was sent. */
  readonly sentAt: Date;
  /** Written by the customer. Untrusted: never an instruction (threat model, A1). */
  readonly content: InboundContent;
}

export const DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface StatusUpdate {
  readonly kind: "status";
  /** The identifier the channel returned when the message was sent. */
  readonly channelMessageId: string;
  readonly status: DeliveryStatus;
  readonly at: Date;
  /** The channel's error code for a failed message, as text. */
  readonly errorCode: string | null;
}

export type ChannelEvent = InboundMessage | StatusUpdate;

/** The events of one webhook for one receiving number. */
export interface EventBatch {
  /** The channel's identifier of the business number the events are for. */
  readonly receivingNumberId: string;
  readonly events: readonly ChannelEvent[];
}

export type ParsedWebhook =
  | {
      readonly ok: true;
      readonly batches: readonly EventBatch[];
      /** Parts the channel sent that this version does not handle, and left out. */
      readonly skipped: number;
      /**
       * Messages, statuses or whole groups of them that did not have the
       * form this version expects, and were left out. Not zero means
       * something was lost and someone should look.
       */
      readonly malformed: number;
    }
  /** A short code only: the body may hold a stranger's number and text. */
  | { readonly ok: false; readonly code: string };

export type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Where a message is sent from, and with what right. */
export interface SendFrom {
  readonly receivingNumberId: string;
  /** The tenant's credential for the channel. Never logged. */
  readonly accessToken: string;
}

export type SendResult =
  | { readonly accepted: true; readonly channelMessageId: string }
  /**
   * `retryable` says whether sending the same message again can help. A
   * timeout is retryable and may have been accepted all the same: the
   * channel offers no way to ask (threat model, A7 h).
   */
  | { readonly accepted: false; readonly retryable: boolean; readonly code: string };

export interface Channel {
  /** A short name, as stored in `channel_accounts.channel`. */
  readonly name: string;
  /** The largest webhook body the channel sends. A larger one is refused unread. */
  readonly maxWebhookBytes: number;
  /**
   * True only if the channel signed exactly these bytes. Must be called
   * with the body as received, before any parsing, and must not take longer
   * for a nearly right signature than for a wrong one.
   */
  verifyWebhook(rawBody: Buffer, headers: Headers): boolean;
  /** Turns a verified body into events. Never throws: a body it cannot read is `ok: false`. */
  parseWebhook(rawBody: Buffer): ParsedWebhook;
  /** Sends a free-form text. Never throws: every failure is a result. */
  sendText(from: SendFrom, to: ChannelUser, body: string): Promise<SendResult>;
}

/** The value of a header by lower-case name, if it was sent exactly once. */
export function singleHeader(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}
