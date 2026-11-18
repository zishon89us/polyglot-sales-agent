// Sending a text through the Cloud API's messages endpoint, as documented
// on 2026-11-18: POST {base}/{version}/{phone number id}/messages with a
// bearer token; a success carries `messages[0].id`.

import type { ChannelUser, SendFrom, SendResult } from "@polyglot-sales-agent/channel";

/** How long to wait for an answer to a send, unless told otherwise. The agent's proposal. */
export const DEFAULT_SEND_TIMEOUT_MS = 10_000;

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

export async function sendText(
  options: SendOptions,
  from: SendFrom,
  to: ChannelUser,
  body: string,
): Promise<SendResult> {
  if (to.phone === null && to.userId === null) {
    return failure("no-recipient", false);
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
      `${options.baseUrl}/${options.apiVersion}/${encodeURIComponent(from.receivingNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${from.accessToken}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "error",
      },
    );
  } catch (error) {
    // The request may have arrived all the same. Only the kind of failure
    // is reported: an error's text can hold the address and its token.
    const name = error instanceof Error ? error.name : "";
    return failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", true);
  }
  let answer: unknown;
  try {
    answer = await response.json();
  } catch {
    answer = undefined;
  }
  if (response.ok) {
    const id = (answer as { messages?: { id?: unknown }[] } | undefined)?.messages?.[0]?.id;
    // Accepted by status but with no identifier: sending again could send twice.
    return typeof id === "string" && id !== ""
      ? { accepted: true, channelMessageId: id }
      : failure("bad-response", false);
  }
  if (response.status === 429) {
    return failure("rate-limited", true);
  }
  if (response.status >= 500) {
    return failure("server-error", true);
  }
  if (response.status === 401 || response.status === 403) {
    return failure("not-authorised", false);
  }
  const code = (answer as { error?: { code?: unknown } } | undefined)?.error?.code;
  return failure(
    typeof code === "number" && Number.isInteger(code) ? `meta-${code}` : "rejected",
    false,
  );
}
