// Sending through the Cloud API's messages endpoint, as documented on
// 2026-11-18: POST {base}/{version}/{phone number id}/messages with a
// bearer token; a success carries `messages[0].id`. A customer is addressed
// by `to` (a phone number) or by `recipient` (a business-scoped user ID).
// A text with reply buttons is an `interactive` message of type `button`,
// as documented on 2026-11-24 (fixtures/2026-11-24/README.md).

import {
  CHANNEL_MESSAGE_ID,
  type ChannelLimits,
  type ChannelUser,
  checkButtonMessage,
  checkText,
  refusedUnsent,
  type SendButton,
  type SendFrom,
  type SendResult,
} from "@polyglot-sales-agent/channel";

/**
 * What Meta's pages give, as read on 2026-11-24: a text of at most 4,096
 * characters; at most 3 reply buttons, on a body of at most 1,024, each
 * with a title of at most 20 and an identifier of at most 256. Counted
 * here in UTF-16 units; how Meta counts was not found.
 */
export const WHATSAPP_LIMITS: ChannelLimits = {
  textMax: 4_096,
  buttons: { max: 3, bodyMax: 1_024, titleMax: 20, payloadMax: 256 },
};

/** How long to wait for an answer to a send, unless told otherwise. The agent's proposal. */
export const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/** No answer of the endpoint is larger than a few hundred bytes; more than this is not read. */
const MAX_ANSWER_BYTES = 64 * 1024;

export interface SendOptions {
  /** `https://graph.facebook.com` in a deployment; the mock's address in development and CI. */
  readonly baseUrl: string;
  /** The Graph API version in the path, such as `v27.0`. */
  readonly apiVersion: string;
  /** How long to wait for an answer. */
  readonly timeoutMs: number;
  /** For tests. */
  readonly fetch?: typeof fetch;
}

// The failures after which Meta may have the message all the same.
const MAY_HAVE_ARRIVED: ReadonlySet<string> = new Set([
  "timeout",
  "network",
  "server-error",
  "bad-response",
]);

function failure(code: string, retryable: boolean): SendResult {
  return { accepted: false, retryable, mayHaveArrived: MAY_HAVE_ARRIVED.has(code), code };
}

/** The answer as JSON, or undefined if it is not JSON or is larger than any real answer. */
async function answerOf(response: Response): Promise<unknown> {
  try {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      return undefined;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > MAX_ANSWER_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function sendText(
  options: SendOptions,
  from: SendFrom,
  to: ChannelUser,
  body: string,
): Promise<SendResult> {
  const refusal = checkText(WHATSAPP_LIMITS, body);
  if (refusal !== undefined) {
    return Promise.resolve(refusedUnsent(refusal));
  }
  return post(options, from, to, { type: "text", text: { body } });
}

export function sendButtons(
  options: SendOptions,
  from: SendFrom,
  to: ChannelUser,
  body: string,
  buttons: readonly SendButton[],
): Promise<SendResult> {
  const refusal = checkButtonMessage(WHATSAPP_LIMITS, body, buttons);
  if (refusal !== undefined) {
    return Promise.resolve(refusedUnsent(refusal));
  }
  return post(options, from, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: "reply",
          reply: { id: button.payload, title: button.title },
        })),
      },
    },
  });
}

/** Posts one message, of whatever kind, and reads the answer. */
async function post(
  options: SendOptions,
  from: SendFrom,
  to: ChannelUser,
  message: Readonly<Record<string, unknown>>,
): Promise<SendResult> {
  if (to.phone === null && to.userId === null) {
    return failure("no-recipient", false);
  }
  // Digits only: anything else could change the path the token is sent to.
  if (!/^[0-9]{1,32}$/.test(from.receivingNumberId)) {
    return failure("bad-sender", false);
  }
  // A token with a space or a line break cannot be put in a header.
  if (!/^[\x21-\x7e]+$/.test(from.accessToken)) {
    return failure("bad-credentials", false);
  }
  const request = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    // If both are given Meta uses the number; give one.
    ...(to.phone === null ? { recipient: to.userId } : { to: to.phone }),
    ...message,
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `${options.baseUrl}/${options.apiVersion}/${from.receivingNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${from.accessToken}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs),
        // Never followed: the token must not travel to another address.
        redirect: "manual",
      },
    );
  } catch (error) {
    // The request may have arrived all the same. Only the kind of failure
    // is reported: an error's text can hold the address and its token.
    const name = error instanceof Error ? error.name : "";
    return failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", true);
  }
  if (response.status >= 300 && response.status < 400) {
    return failure("redirected", false);
  }
  // A failure while reading the answer leaves it unknown. For a 200 that is
  // "bad-response" and not retried: Meta has accepted the message, and
  // sending it again would send it twice.
  const answer = await answerOf(response);
  if (response.ok) {
    const id = (answer as { messages?: { id?: unknown }[] } | undefined)?.messages?.[0]?.id;
    // Accepted by status but with no identifier: sending again could send twice.
    return typeof id === "string" && CHANNEL_MESSAGE_ID.test(id)
      ? { accepted: true, channelMessageId: id }
      : failure("bad-response", false);
  }
  if (response.status === 429) {
    return failure("rate-limited", true);
  }
  if (response.status >= 500 || response.status === 408) {
    return failure("server-error", true);
  }
  if (response.status === 401 || response.status === 403) {
    return failure("not-authorised", false);
  }
  const code = (answer as { error?: { code?: unknown } } | undefined)?.error?.code;
  return failure(
    typeof code === "number" && Number.isSafeInteger(code) && code >= 0
      ? `meta-${code}`
      : "rejected",
    false,
  );
}
