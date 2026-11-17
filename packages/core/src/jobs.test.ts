import { describe, expect, test } from "vitest";
import {
  errorCode,
  JOB_CLAIM_MS,
  JOB_HANDLER_TIMEOUT_MS,
  JOB_MAX_ATTEMPTS,
  JOB_TYPE,
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
    expect(POLL_INTERVAL_MS).toBe(500);
  });

  test("a handler may run as long as the longest job, and a claim outlasts the handler", () => {
    // Three 20-second model attempts and their waits of 1 and 4 seconds (glossary).
    expect(JOB_HANDLER_TIMEOUT_MS).toBeGreaterThan(3 * 20_000 + 1_000 + 4_000);
    expect(JOB_CLAIM_MS - JOB_HANDLER_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(JOB_CLAIM_MS).toBe(5 * 60_000);
  });

  test("the lease is two minutes (ADR 0004), and readiness allows three missed heartbeats", () => {
    expect(LEASE_MS).toBe(120_000);
    expect(WORKER_READY_WITHIN_MS).toBe(30_000);
  });
});

describe("payloadProblems", () => {
  const id = "0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77";
  const KEY = "a key does not name an identifier (it must be letters ending in Id)";

  test("accepts identifiers, and an empty payload", () => {
    expect(payloadProblems({ messageId: id, conversationId: id })).toEqual([]);
    expect(payloadProblems({})).toEqual([]);
  });

  test.each([
    [{ phone: "+15550100" }, [KEY]],
    [{ body: "hello" }, [KEY]],
    [{ "hello Ali Khan Id": id }, [KEY]],
    [{ contactId: "+15550100" }, ['the value of "contactId" is not a UUID']],
    [{ contactId: "Ali Khan" }, ['the value of "contactId" is not a UUID']],
    [{ contactId: `${id} and more` }, ['the value of "contactId" is not a UUID']],
    [{ messageId: 7 }, ['the value of "messageId" is not a UUID']],
    [{ messageId: { text: "hello" } }, ['the value of "messageId" is not a UUID']],
    [{ messageId: id, Id: id }, [KEY]],
    ["hello", ["the payload is not a plain object"]],
    [[id], ["the payload is not a plain object"]],
    [null, ["the payload is not a plain object"]],
    [new Date(0), ["the payload is not a plain object"]],
    [new Map([["messageId", id]]), ["the payload is not a plain object"]],
  ])("refuses %j", (payload, problems) => {
    expect(payloadProblems(payload)).toEqual(problems);
  });

  test("never repeats a refused value or key", () => {
    const text = [
      ...payloadProblems({ contactId: "+15550100" }),
      ...payloadProblems({ "15550100": id }),
    ].join(" ");
    expect(text).not.toContain("15550100");
  });
});

describe("JOB_TYPE", () => {
  test.each(["process-conversation", "operator-alert", "a", "send2"])("accepts %s", (type) => {
    expect(JOB_TYPE.test(type)).toBe(true);
  });
  test.each(["", "Send", "send to +15550100", "send_message", "-x", "x".repeat(41), "toString"])(
    "refuses %j",
    (type) => {
      expect(JOB_TYPE.test(type)).toBe(false);
    },
  );
});

describe("errorCode", () => {
  class SendRejected extends Error {}
  class Customer15550100 extends Error {}

  test.each([
    [Object.assign(new Error("x"), { code: "ECONNRESET" }), "ECONNRESET"],
    [Object.assign(new Error("x"), { code: "send-rejected" }), "send-rejected"],
    [Object.assign(new Error("x"), { code: "23505" }), "23505"],
    [Object.assign(new Error("x"), { code: "40P01" }), "40P01"],
    [new SendRejected("the customer said hello"), "SendRejected"],
    [new TypeError("x"), "TypeError"],
    [Object.assign(new Error("x"), { code: "has spaces and text" }), "Error"],
    [Object.assign(new Error("x"), { code: "15550100" }), "Error"],
    [Object.assign(new Error("x"), { code: "Ali.Khan" }), "Error"],
    [Object.assign(new Error("x"), { code: 42 }), "Error"],
    [new Customer15550100("x"), "unknown"],
    ["a thrown string with text", "unknown"],
    [undefined, "unknown"],
    [null, "unknown"],
  ])("gives a short code for %o", (error, code) => {
    expect(errorCode(error)).toBe(code);
  });

  test("never returns the message, and never throws", () => {
    expect(errorCode(new Error("+15550100 said hello"))).toBe("Error");
    const hostile = {
      get code(): string {
        throw new Error("no");
      },
    };
    expect(errorCode(hostile)).toBe("unknown");
    const proxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error("no");
        },
      },
    );
    expect(errorCode(proxy)).toBe("unknown");
  });
});
