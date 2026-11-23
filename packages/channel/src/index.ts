// What the rest of the system knows about a messaging channel (NFR-M2).
// A channel turns its own webhooks into the events below and sends a
// message when asked. Nothing here names WhatsApp; all knowledge of one
// channel's payloads lives in that channel's package.
//
// Built so far: verify a webhook, parse it, send a free-form text (M2 unit
// U6); a tap on a button and a caption as events, and a text with buttons
// (M3 unit U5). Still to come with the units that need them: sending a
// template, submitting a template for approval, checking credentials.

/**
 * The customer at the other end. A channel may give a phone number, an
 * identifier of its own for the person, or both, and at least one. WhatsApp
 * can leave the number out (see the WhatsApp channel's fixtures).
 */
export interface ChannelUser {
  /** E.164 with the leading plus, or null when the channel did not give one. */
  readonly phone: string | null;
  /** The channel's own identifier for the person, or null when it gave none. */
  readonly userId: string | null;
}

/**
 * What a customer sent. Text is read; a tap on a button is carried as what
 * the button was set to; anything else is named, not interpreted.
 */
export type InboundContent =
  | {
      readonly type: "text";
      readonly body: string;
      /** Set when the text was typed under a picture or a video, which is not read. */
      readonly captionOf?: "image" | "video";
    }
  | {
      readonly type: "button";
      /**
       * What the business set on the button. Sent by the customer's app, so
       * untrusted like any text. The button's label is not passed on: it is
       * not the customer's words.
       */
      readonly payload: string;
      /** The channel's identifier of the message the tap answers, or null if it gave none. */
      readonly inReplyTo: string | null;
    }
  | { readonly type: "unsupported"; readonly channelType: string };

/** A payload: 1 to 256 printable ASCII characters with no space. */
export const BUTTON_PAYLOAD = /^[\x21-\x7e]{1,256}$/;
/** A channel's identifier of a message: 1 to 128 printable characters with no space. */
export const CHANNEL_MESSAGE_ID = /^[\x21-\x7e]{1,128}$/;

/** A button on a message that is sent. */
export interface SendButton {
  /** Comes back when the button is tapped. */
  readonly payload: string;
  /** What the customer sees. */
  readonly title: string;
}

/** What a channel can carry. Lengths are in UTF-16 units. */
export interface ChannelLimits {
  /** The longest text. */
  readonly textMax: number;
  /** Null for a channel that has no buttons. */
  readonly buttons: {
    /** How many buttons one message may carry. */
    readonly max: number;
    /** The longest text of a message with buttons: it can be shorter than `textMax`. */
    readonly bodyMax: number;
    readonly titleMax: number;
    readonly payloadMax: number;
  } | null;
}

/** A control character or a line break of any kind. */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/**
 * A character that shows nothing and can reorder or hide what is beside it.
 * The two joiners are left: some scripts need them inside a word.
 */
const HIDDEN = /(?![\u200c\u200d])\p{Cf}/u;
/** Half of a pair with no other half: not text, and not every store or channel takes it. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** Whether a text shows nothing at all. */
const blank = (text: string): boolean => text.replace(/[\p{Cf}\s]/gu, "") === "";
/** Whether a body may be sent: something to read, and no U+0000. */
const sendable = (body: unknown, max: number): body is string =>
  typeof body === "string" && body.length <= max && !blank(body) && !body.includes("\u0000");
/** A title as two are compared: the same letters in another case or form are the same title. */
/**
 * What two titles are compared by: one compatibility form, one case (upper
 * first, so that a letter with a longer upper-case form meets it), no
 * joiners, and one space wherever there is space.
 */
const titleKey = (title: string): string =>
  title
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, "")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * Whether a text with buttons would be refused by a channel with these
 * limits, and why: undefined if it would be sent. Pure, so that every
 * fixed text can be tested against every channel without sending.
 */
export function checkButtonMessage(
  limits: ChannelLimits,
  body: string,
  buttons: readonly SendButton[],
): "no-buttons" | "bad-buttons" | "bad-body" | undefined {
  const allowed = limits.buttons;
  if (allowed === null) {
    return "no-buttons";
  }
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > allowed.max) {
    return "bad-buttons";
  }
  const titles = new Set<string>();
  const payloads = new Set<string>();
  for (const button of buttons) {
    const { title, payload } = button ?? {};
    if (
      typeof title !== "string" ||
      title.length < 1 ||
      title.length > allowed.titleMax ||
      title !== title.trim() ||
      blank(title) ||
      CONTROL.test(title) ||
      HIDDEN.test(title) ||
      LONE_SURROGATE.test(title) ||
      titles.has(titleKey(title)) ||
      typeof payload !== "string" ||
      payload.length > allowed.payloadMax ||
      !BUTTON_PAYLOAD.test(payload) ||
      payloads.has(payload)
    ) {
      return "bad-buttons";
    }
    titles.add(titleKey(title));
    payloads.add(payload);
  }
  if (!sendable(body, allowed.bodyMax)) {
    return "bad-body";
  }
  return undefined;
}

/** Whether a text would be refused by a channel with these limits. */
export function checkText(limits: ChannelLimits, body: string): "bad-body" | undefined {
  return sendable(body, limits.textMax) ? undefined : "bad-body";
}

/** The result of a message that was refused before any call was made. */
export function refusedUnsent(code: string): SendResult {
  return { accepted: false, retryable: false, mayHaveArrived: false, code };
}

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
   * `retryable` says whether sending the same message again can help.
   * `mayHaveArrived` says whether the channel may have accepted the message
   * all the same: true for a timeout, a broken connection, a fault on the
   * channel's side or an answer that could not be read; false only when the
   * channel refused it or it was never sent. The channel offers no way to
   * ask (threat model, A7 h), so the caller decides by the message's class
   * whether to send again (architecture, "Sending a message once").
   */
  | {
      readonly accepted: false;
      readonly retryable: boolean;
      readonly mayHaveArrived: boolean;
      readonly code: string;
    };

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
  /** What it can carry. A caller asks, and does not assume another channel's numbers. */
  readonly limits: ChannelLimits;
  /**
   * Sends a free-form text. Never throws: every failure is a result. An
   * empty text or one over `limits.textMax` is refused before any call.
   */
  sendText(from: SendFrom, to: ChannelUser, body: string): Promise<SendResult>;
  /**
   * Sends a text with buttons. Never throws. What `checkButtonMessage`
   * refuses is refused before any call, with its code.
   */
  sendButtons(
    from: SendFrom,
    to: ChannelUser,
    body: string,
    buttons: readonly SendButton[],
  ): Promise<SendResult>;
}

/** The value of a header by lower-case name, if it was sent exactly once. */
export function singleHeader(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}
