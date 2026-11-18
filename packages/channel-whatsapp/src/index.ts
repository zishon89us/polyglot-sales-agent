import type { Channel } from "@polyglot-sales-agent/channel";
import { singleHeader } from "@polyglot-sales-agent/channel";
import { parseWebhook } from "./parse.ts";
import { type SendOptions, sendText } from "./send.ts";
import { SIGNATURE_HEADER, verifySignature } from "./signature.ts";

export { parseWebhook } from "./parse.ts";
export { DEFAULT_SEND_TIMEOUT_MS, type SendOptions, sendText } from "./send.ts";
export { registrationChallenge, SIGNATURE_HEADER, sign, verifySignature } from "./signature.ts";

export interface WhatsAppOptions extends SendOptions {
  /** The app secret that signs webhooks; the old one too while it is being replaced. */
  readonly appSecrets: readonly string[];
}

/**
 * Meta says a webhook payload can be up to 3 MB (read 2026-11-18). This is
 * 3 MiB, which is a little more.
 */
export const MAX_WEBHOOK_BYTES = 3 * 1024 * 1024;

export function createWhatsAppChannel(options: WhatsAppOptions): Channel {
  if (!options.appSecrets.some((secret) => secret !== "")) {
    throw new Error("channel-whatsapp: an app secret is required");
  }
  // Settings that would otherwise fail on every send, where they would look like an outage.
  let base: URL | undefined;
  try {
    base = new URL(options.baseUrl);
  } catch {
    base = undefined;
  }
  if (base === undefined || !/^https?:$/.test(base.protocol) || base.username !== "") {
    throw new Error("channel-whatsapp: the base address must be an http or https address");
  }
  if (!/^v[0-9]{1,3}\.[0-9]{1,2}$/.test(options.apiVersion)) {
    throw new Error("channel-whatsapp: the API version must look like v27.0");
  }
  if (!(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0)) {
    throw new Error("channel-whatsapp: the timeout must be a positive number of milliseconds");
  }
  return {
    name: "whatsapp",
    maxWebhookBytes: MAX_WEBHOOK_BYTES,
    verifyWebhook: (rawBody, headers) =>
      verifySignature(rawBody, singleHeader(headers, SIGNATURE_HEADER), options.appSecrets),
    parseWebhook,
    sendText: (from, to, body) => sendText(options, from, to, body),
  };
}
