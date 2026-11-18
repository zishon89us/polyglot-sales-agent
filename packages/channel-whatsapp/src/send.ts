// Sending a text through the Cloud API's messages endpoint, as documented
// on 2026-11-18: POST {base}/{version}/{phone number id}/messages with a
// bearer token; a success carries `messages[0].id`. A customer is addressed
// by `to` (a phone number) or by `recipient` (a business-scoped user ID).

import type { ChannelUser, SendFrom, SendResult } from "@polyglot-sales-agent/channel";

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

function failure(code: string, retryable: boolean): SendResult {
  return { accepted: false, retryable, code };
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

export async function sendText(
  options: SendOptions,
  from: SendFrom,
  to: ChannelUser,
  body: string,
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
    type: "text",
    text: { body },
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
  const answer = await answerOf(response);
  if (response.ok) {
    const id = (answer as { messages?: { id?: unknown }[] } | undefined)?.messages?.[0]?.id;
    // Accepted by status but with no identifier: sending again could send twice.
    return typeof id === "string" && /^\S{1,128}$/.test(id)
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
