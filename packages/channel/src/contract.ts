// The tests every channel must pass (NFR-M2). Each channel's own test file
// calls `channelContract` with a way to make a signed webhook for it, so
// the same expectations run against the WhatsApp channel and the mock one.

import { describe, expect, test } from "vitest";
import {
  type Channel,
  type ChannelEvent,
  DELIVERY_STATUSES,
  type Headers,
  type SendFrom,
} from "./index.ts";

export interface SignedWebhook {
  readonly rawBody: Buffer;
  readonly headers: Headers;
}

export interface ContractSubject {
  readonly channel: Channel;
  /** A webhook, signed as the channel would, carrying one text message and one status. */
  signed(): SignedWebhook;
  /** The name of the header that carries the signature. */
  readonly signatureHeader: string;
  /** Where a send would be accepted, for the send tests. */
  readonly from: SendFrom;
}

function check(event: ChannelEvent): void {
  expect(event.channelMessageId).toMatch(/\S/);
  if (event.kind === "message") {
    expect(event.from.phone !== null || event.from.userId !== null).toBe(true);
    if (event.from.phone !== null) {
      expect(event.from.phone).toMatch(/^\+[1-9][0-9]{1,14}$/);
    }
    expect(Number.isNaN(event.sentAt.getTime())).toBe(false);
  } else {
    expect(DELIVERY_STATUSES).toContain(event.status);
    expect(Number.isNaN(event.at.getTime())).toBe(false);
  }
}

export function channelContract(name: string, subject: () => Promise<ContractSubject>): void {
  describe(`channel contract: ${name}`, () => {
    test("has a short lower-case name and says how large its webhooks can be", async () => {
      const { channel } = await subject();
      expect(channel.name).toMatch(/^[a-z]{1,20}$/);
      expect(Number.isInteger(channel.maxWebhookBytes) && channel.maxWebhookBytes > 0).toBe(true);
    });

    test("accepts a webhook it signed, and reads its events", async () => {
      const { channel, signed } = await subject();
      const { rawBody, headers } = signed();
      expect(channel.verifyWebhook(rawBody, headers)).toBe(true);
      const parsed = channel.parseWebhook(rawBody);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect([parsed.skipped, parsed.malformed]).toEqual([0, 0]);
        const events = parsed.batches.flatMap((batch) => batch.events);
        expect(events.map((event) => event.kind).sort()).toEqual(["message", "status"]);
        events.forEach(check);
        for (const batch of parsed.batches) {
          expect(batch.receivingNumberId).toMatch(/\S/);
        }
      }
    });

    test("refuses the same webhook with one byte of the body changed", async () => {
      const { channel, signed } = await subject();
      const { rawBody, headers } = signed();
      const changed = Buffer.from(rawBody);
      changed[changed.length - 2] = (changed[changed.length - 2] as number) ^ 1;
      expect(channel.verifyWebhook(changed, headers)).toBe(false);
    });

    test("refuses a webhook with no signature, an empty, shortened, lengthened or altered one, or two", async () => {
      const { channel, signed, signatureHeader } = await subject();
      const { rawBody, headers } = signed();
      const signature = headers[signatureHeader] as string;
      const without = { ...headers };
      delete (without as Record<string, unknown>)[signatureHeader];
      expect(channel.verifyWebhook(rawBody, without)).toBe(false);
      for (const value of [
        "",
        signature.slice(0, -1),
        `${signature}0`,
        `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`,
        [signature, signature],
      ]) {
        expect(channel.verifyWebhook(rawBody, { ...headers, [signatureHeader]: value })).toBe(
          false,
        );
      }
    });

    test("refuses an empty body under a signature for another body", async () => {
      const { channel, signed } = await subject();
      expect(channel.verifyWebhook(Buffer.alloc(0), signed().headers)).toBe(false);
    });

    test.each(["", "not json", "[]", "null", "{}", '{"object":1}', "\u0000"])(
      "a body it cannot read is a result, not an error: %j",
      async (body) => {
        const { channel } = await subject();
        const parsed = channel.parseWebhook(Buffer.from(body));
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
          expect(parsed.code).toMatch(/^[a-z-]{1,40}$/);
        }
      },
    );

    test("a send is answered with an identifier, or with a failure that says whether to retry", async () => {
      const { channel, from } = await subject();
      const result = await channel.sendText(from, { phone: "+15550142", userId: null }, "hello");
      expect(result).toEqual({ accepted: true, channelMessageId: expect.stringMatching(/\S/) });
      const refused = await channel.sendText(
        { ...from, accessToken: "not-the-token" },
        { phone: "+15550142", userId: null },
        "hello",
      );
      expect(refused).toEqual({
        accepted: false,
        retryable: false,
        mayHaveArrived: false,
        code: expect.any(String),
      });
    });
  });
}
