// Meta signs each webhook: an HMAC-SHA-256 of the body as sent, keyed with
// the app secret, in the header `X-Hub-Signature-256` as `sha256=` and 64
// hexadecimal digits (read on 2026-11-18; see fixtures/2026-11-18/README.md).

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

const FORM = /^sha256=([0-9a-f]{64})$/;

/** The header value Meta would send for this body and secret. Used by the mock and by tests. */
export function sign(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/**
 * True only if the header is a signature of exactly these bytes under one
 * of the secrets. More than one secret is accepted so that the app secret
 * can be replaced without refusing webhooks signed with the old one.
 *
 * The comparison takes the same time whether the signature is nearly right
 * or wholly wrong, and every secret is tried whichever matches.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecrets: readonly string[],
): boolean {
  const match = typeof header === "string" ? FORM.exec(header) : null;
  if (match === null) {
    return false;
  }
  const given = Buffer.from(match[1] as string, "hex");
  let valid = false;
  for (const secret of appSecrets) {
    if (secret === "") {
      continue;
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    // Not `valid ||`: that would skip the comparison once one has matched.
    valid = timingSafeEqual(given, expected) || valid;
  }
  return valid;
}

/**
 * The registration check Meta makes once: it sends a token and a challenge
 * and expects the challenge back. Returns the challenge to echo, or
 * undefined if the request is not that check or the token is wrong.
 */
export function registrationChallenge(
  query: Readonly<Record<string, unknown>>,
  verifyToken: string,
): string | undefined {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") {
    return undefined;
  }
  if (verifyToken === "") {
    return undefined;
  }
  // Compared as digests so that the lengths are equal and the time does not depend on the token.
  const digest = (text: string): Buffer =>
    createHmac("sha256", "registration").update(text).digest();
  return timingSafeEqual(digest(token), digest(verifyToken)) ? challenge : undefined;
}
