import { describe, expect, test } from "vitest";
import { BadSignatureLimiter, WEBHOOK_LIMITS } from "./bad-signature-limiter.ts";

const options = { limit: 3, windowMs: 1_000, blockMs: 5_000, maxSources: 4 };

describe("BadSignatureLimiter", () => {
  test("the limits in use are 10 failures a minute, then a minute refused", () => {
    expect(WEBHOOK_LIMITS).toEqual({
      limit: 10,
      windowMs: 60_000,
      blockMs: 60_000,
      maxSources: 10_000,
    });
  });

  test("a source is blocked at the limit, not before, and for the block time exactly", () => {
    const limiter = new BadSignatureLimiter(options);
    limiter.recordBad("a", 0);
    limiter.recordBad("a", 10);
    expect(limiter.isBlocked("a", 20)).toBe(false);
    limiter.recordBad("a", 20);
    expect(limiter.isBlocked("a", 20)).toBe(true);
    expect(limiter.isBlocked("a", 5_019)).toBe(true);
    expect(limiter.isBlocked("a", 5_020)).toBe(false);
  });

  test("failures spread over more than the window do not add up", () => {
    const limiter = new BadSignatureLimiter(options);
    limiter.recordBad("a", 0);
    limiter.recordBad("a", 500);
    limiter.recordBad("a", 1_000);
    limiter.recordBad("a", 1_500);
    expect(limiter.isBlocked("a", 1_500)).toBe(false);
    limiter.recordBad("a", 1_900);
    expect(limiter.isBlocked("a", 1_900)).toBe(true);
  });

  test("one source's failures do not block another", () => {
    const limiter = new BadSignatureLimiter(options);
    for (let i = 0; i < 3; i += 1) {
      limiter.recordBad("a", i);
    }
    expect(limiter.isBlocked("a", 3)).toBe(true);
    expect(limiter.isBlocked("b", 3)).toBe(false);
  });

  test("a source never seen is not blocked", () => {
    expect(new BadSignatureLimiter(options).isBlocked("a", 0)).toBe(false);
  });

  test("after a block ends, the count starts again", () => {
    const limiter = new BadSignatureLimiter(options);
    for (let i = 0; i < 3; i += 1) {
      limiter.recordBad("a", i);
    }
    limiter.recordBad("a", 6_000);
    limiter.recordBad("a", 6_001);
    expect(limiter.isBlocked("a", 6_002)).toBe(false);
    limiter.recordBad("a", 6_002);
    expect(limiter.isBlocked("a", 6_003)).toBe(true);
  });

  test("it remembers no more sources than its bound, forgetting the one used longest ago", () => {
    const limiter = new BadSignatureLimiter(options);
    for (let i = 0; i < 3; i += 1) {
      limiter.recordBad("blocked", i);
    }
    for (let i = 0; i < 100; i += 1) {
      limiter.recordBad(`source-${i}`, 10 + i);
    }
    expect(limiter.size).toBe(4);
    // The price of the bound: enough other sources push a blocked one out.
    expect(limiter.isBlocked("blocked", 200)).toBe(false);
  });
});
