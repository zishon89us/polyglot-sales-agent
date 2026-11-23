import { describe, expect, test } from "vitest";
import {
  BATCH_MAX_MS,
  BATCH_QUIET_MS,
  batchWindowClosesAt,
  REPLY_DISCARDS_MAX,
  REPLY_WINDOW_MS,
  SESSION_INACTIVITY_MS,
} from "./conversation.ts";

describe("the fixed values of a conversation's timing (glossary, fixed values)", () => {
  test("are the glossary's: 24 hours, 24 hours, 3 seconds and at most 10", () => {
    expect(SESSION_INACTIVITY_MS).toBe(24 * 60 * 60 * 1000);
    expect(REPLY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(BATCH_QUIET_MS).toBe(3_000);
    expect(BATCH_MAX_MS).toBe(10_000);
    expect(REPLY_DISCARDS_MAX).toBe(2);
  });
});

describe("when the batching window closes", () => {
  test("3 seconds after the latest message", () => {
    expect(batchWindowClosesAt(1_000, 1_000)).toBe(4_000);
    expect(batchWindowClosesAt(5_000, 1_000)).toBe(8_000);
  });

  test("but at most 10 seconds after the first", () => {
    expect(batchWindowClosesAt(9_000, 1_000)).toBe(11_000);
    expect(batchWindowClosesAt(60_000, 1_000)).toBe(11_000);
    // Exactly where the two meet.
    expect(batchWindowClosesAt(8_000, 1_000)).toBe(11_000);
  });

  test("at once, when nothing was stored since the last turn started: what is left has already waited", () => {
    expect(batchWindowClosesAt(5_000, undefined)).toBe(Number.NEGATIVE_INFINITY);
  });
});
