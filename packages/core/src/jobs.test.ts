import { describe, expect, test } from "vitest";
import {
  errorCode,
  JOB_CLAIM_MS,
  JOB_MAX_ATTEMPTS,
  LEASE_MS,
  POLL_INTERVAL_MS,
  payloadProblems,
  retryDelayMs,
  WORKER_READY_WITHIN_MS,
} from "./jobs.ts";

describe("retryDelayMs (NFR-R5)", () => {
  test("five retries, starting at 2 seconds and doubling, then none", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs)).toEqual([
      2_000,
      4_000,
      8_000,
      16_000,
      32_000,
      undefined,
      undefined,
    ]);
    expect(JOB_MAX_ATTEMPTS).toBe(6);
  });

  test.each([0, -1, 1.5, Number.NaN])("refuses %s attempts", (attempts) => {
    expect(() => retryDelayMs(attempts)).toThrow("whole number of at least 1");
  });
});

describe("the fixed times agree with what they depend on", () => {
  test("the poll interval is well under the 3-second batching window", () => {
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(1_000);
  });

  test("a claim outlasts the longest job: three 20-second model attempts and their waits", () => {
    expect(JOB_CLAIM_MS).toBeGreaterThan(3 * 20_000 + 1_000 + 4_000);
  });

  test("the lease is two minutes (ADR 0004), and readiness allows three missed heartbeats", () => {
    expect(LEASE_MS).toBe(120_000);
    expect(WORKER_READY_WITHIN_MS).toBe(30_000);
  });
});

describe("payloadProblems", () => {
  const id = "0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77";

  test("accepts identifiers, and an empty payload", () => {
    expect(payloadProblems({ messageId: id, conversationId: id })).toEqual([]);
    expect(payloadProblems({})).toEqual([]);
  });

  test.each([
    [{ phone: "+15550100" }, ['key "phone" does not name an identifier (it must end in Id)']],
    [{ body: "hello" }, ['key "body" does not name an identifier (it must end in Id)']],
    [{ contactId: "+15550100" }, ['the value of "contactId" is not a UUID']],
    [{ contactId: "Ali Khan" }, ['the value of "contactId" is not a UUID']],
    [{ messageId: 7 }, ['the value of "messageId" is not a UUID']],
    [{ messageId: { text: "hello" } }, ['the value of "messageId" is not a UUID']],
    [{ messageId: id, Id: id }, ['key "Id" does not name an identifier (it must end in Id)']],
    ["hello", ["the payload is not an object"]],
    [[id], ["the payload is not an object"]],
    [null, ["the payload is not an object"]],
  ])("refuses %j", (payload, problems) => {
    expect(payloadProblems(payload)).toEqual(problems);
  });

  test("never repeats the refused value", () => {
    expect(payloadProblems({ contactId: "+15550100" }).join(" ")).not.toContain("15550100");
  });
});

describe("errorCode", () => {
  class SendRejected extends Error {}

  test.each([
    [Object.assign(new Error("x"), { code: "ECONNRESET" }), "ECONNRESET"],
    [Object.assign(new Error("x"), { code: "23505" }), "23505"],
    [new SendRejected("the customer said hello"), "SendRejected"],
    [new TypeError("x"), "TypeError"],
    [Object.assign(new Error("x"), { code: "has spaces and text" }), "Error"],
    [Object.assign(new Error("x"), { code: 42 }), "Error"],
    ["a thrown string with text", "unknown"],
    [undefined, "unknown"],
    [null, "unknown"],
  ])("gives a short code for %o", (error, code) => {
    expect(errorCode(error)).toBe(code);
  });

  test("never returns the message", () => {
    expect(errorCode(new Error("+15550100 said hello"))).toBe("Error");
  });
});
