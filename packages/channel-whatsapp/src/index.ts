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

export function createWhatsAppChannel(options: WhatsAppOptions): Channel {
  if (!options.appSecrets.some((secret) => secret !== "")) {
    throw new Error("channel-whatsapp: an app secret is required");
  }
  return {
    name: "whatsapp",
    verifyWebhook: (rawBody, headers) =>
      verifySignature(rawBody, singleHeader(headers, SIGNATURE_HEADER), options.appSecrets),
    parseWebhook,
    sendText: (from, to, body) => sendText(options, from, to, body),
  };
}
