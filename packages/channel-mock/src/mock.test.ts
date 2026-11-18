import { DELIVERY_STATUSES, type EventBatch } from "@polyglot-sales-agent/channel";
import { channelContract } from "@polyglot-sales-agent/channel/contract";
import { MESSAGE_STATUSES } from "@polyglot-sales-agent/core";
import { describe, expect, test } from "vitest";
import { createMockChannel, MOCK_ACCESS_TOKEN, MOCK_SIGNATURE_HEADER } from "./index.ts";

const FROM = { receivingNumberId: "mock-number-a", accessToken: MOCK_ACCESS_TOKEN };
const CUSTOMER = { phone: "+15550142", userId: null };
const BATCHES: EventBatch[] = [
  {
    receivingNumberId: "mock-number-a",
    events: [
      {
        kind: "message",
        channelMessageId: "mock-in-1",
        from: CUSTOMER,
        sentAt: new Date("2026-11-18T10:00:00.000Z"),
        content: { type: "text", body: "hello" },
      },
      {
        kind: "status",
        channelMessageId: "mock.1",
        status: "delivered",
        at: new Date("2026-11-18T10:00:05.000Z"),
        errorCode: null,
      },
    ],
  },
];

channelContract("mock", async () => {
  const channel = createMockChannel();
  return {
    channel,
    signatureHeader: MOCK_SIGNATURE_HEADER,
    from: FROM,
    signed: () => channel.webhook(BATCHES),
  };
});

describe("the mock channel", () => {
  test("gives back exactly the events it was asked to carry", () => {
    const channel = createMockChannel();
    const parsed = channel.parseWebhook(channel.webhook(BATCHES).rawBody);
    expect(parsed).toEqual({ ok: true, batches: BATCHES, skipped: 0, malformed: 0 });
  });

  test("records what was sent, in order", async () => {
    const channel = createMockChannel();
    await channel.sendText(FROM, CUSTOMER, "one");
    await channel.sendText(FROM, { phone: null, userId: "US.1" }, "two");
    expect(channel.sent.map((message) => [message.channelMessageId, message.body])).toEqual([
      ["mock.1", "one"],
      ["mock.2", "two"],
    ]);
  });

  test("can be told to fail the next send, once, and records nothing for it", async () => {
    const channel = createMockChannel();
    channel.failNextSend("server-error", true);
    expect(await channel.sendText(FROM, CUSTOMER, "one")).toEqual({
      accepted: false,
      retryable: true,
      code: "server-error",
    });
    expect(channel.sent).toEqual([]);
    expect((await channel.sendText(FROM, CUSTOMER, "one")).accepted).toBe(true);
  });

  test("refuses a send to nobody, and one with the wrong token", async () => {
    const channel = createMockChannel();
    expect(await channel.sendText(FROM, { phone: null, userId: null }, "x")).toMatchObject({
      accepted: false,
      code: "no-recipient",
    });
    expect(await channel.sendText({ ...FROM, accessToken: "" }, CUSTOMER, "x")).toMatchObject({
      accepted: false,
      code: "not-authorised",
    });
    expect(channel.sent).toEqual([]);
  });

  test.each([
    ['{"mockBatches":[{"receivingNumberId":"","events":[]}]}'],
    [
      '{"mockBatches":[{"receivingNumberId":"a","events":[{"kind":"other","channelMessageId":"x"}]}]}',
    ],
    [
      '{"mockBatches":[{"receivingNumberId":"a","events":[{"kind":"status","channelMessageId":"x","status":"gone","at":"2026-11-18T10:00:00Z","errorCode":null}]}]}',
    ],
    [
      '{"mockBatches":[{"receivingNumberId":"a","events":[{"kind":"message","channelMessageId":"x","from":{},"sentAt":"2026-11-18T10:00:00Z","content":{"type":"text","body":"x"}}]}]}',
    ],
    [
      '{"mockBatches":[{"receivingNumberId":"a","events":[{"kind":"message","channelMessageId":"x","from":{"phone":"15550142"},"sentAt":"2026-11-18T10:00:00Z","content":{"type":"text","body":"x"}}]}]}',
    ],
  ])("refuses a body of the wrong shape: %s", (body) => {
    expect(createMockChannel().parseWebhook(Buffer.from(body))).toEqual({
      ok: false,
      code: "bad-shape",
    });
  });
});

describe("the channel's delivery statuses", () => {
  test("are all message statuses the core knows", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(MESSAGE_STATUSES).toContain(status);
    }
  });
});
