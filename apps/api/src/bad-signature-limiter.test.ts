import { describe, expect, test } from "vitest";
import { BadSignatureLimiter, WEBHOOK_LIMITS } from "./bad-signature-limiter.ts";

const options = { limit: 3, windowMs: 1_000, blockMs: 5_000, maxSources: 4 };

function bad(limiter: BadSignatureLimiter, source: string, ...times: number[]): void {
  for (const time of times) {
    limiter.recordBad(source, time);
  }
}

describe("BadSignatureLimiter", () => {
  test("the limits in use are 10 refusals within a minute, then a minute refused", () => {
    expect(WEBHOOK_LIMITS).toEqual({
      limit: 10,
      windowMs: 60_000,
      blockMs: 60_000,
      maxSources: 10_000,
    });
  });

  test("a source is blocked at the limit, not before, and for the block time exactly", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "a", 0, 10);
    expect(limiter.isBlocked("a", 20)).toBe(false);
    bad(limiter, "a", 20);
    expect(limiter.isBlocked("a", 20)).toBe(true);
    expect(limiter.isBlocked("a", 5_019)).toBe(true);
    expect(limiter.isBlocked("a", 5_020)).toBe(false);
  });

  test("the window slides: refusals on both sides of a minute boundary still add up", () => {
    const limiter = new BadSignatureLimiter(options);
    // With windows fixed at 0 and 1000 these three would be counted apart.
    bad(limiter, "a", 990, 995, 1_005);
    expect(limiter.isBlocked("a", 1_005)).toBe(true);
  });

  test("refusals spread wider than the window do not block, however long they go on", () => {
    const limiter = new BadSignatureLimiter(options);
    for (let time = 0; time < 60_000; time += 500) {
      limiter.recordBad("a", time);
      expect(limiter.isBlocked("a", time), `at ${time}`).toBe(false);
    }
  });

  test("exactly the window apart is outside it", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "a", 0, 500, 1_000);
    expect(limiter.isBlocked("a", 1_000)).toBe(false);
    bad(limiter, "a", 1_499);
    expect(limiter.isBlocked("a", 1_499), "500, 1000 and 1499 are within one window").toBe(true);
  });

  test("one source's refusals do not block another, and a source never seen is not blocked", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "a", 0, 1, 2);
    expect(limiter.isBlocked("a", 3)).toBe(true);
    expect(limiter.isBlocked("b", 3)).toBe(false);
  });

  test("after a block ends, the count starts again", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "a", 0, 1, 2);
    bad(limiter, "a", 6_000, 6_001);
    expect(limiter.isBlocked("a", 6_002)).toBe(false);
    bad(limiter, "a", 6_002);
    expect(limiter.isBlocked("a", 6_003)).toBe(true);
  });

  test("it remembers no more sources than its bound, and forgets an unblocked one before a blocked one", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "blocked", 0, 1, 2);
    for (let i = 0; i < 100; i += 1) {
      limiter.recordBad(`source-${i}`, 10 + i);
    }
    expect(limiter.size).toBe(4);
    expect(limiter.isBlocked("blocked", 200), "other sources cannot push a blocked one out").toBe(
      true,
    );
  });

  test("once its block has ended, a source can be forgotten like any other", () => {
    const limiter = new BadSignatureLimiter(options);
    bad(limiter, "was-blocked", 0, 1, 2);
    for (let i = 0; i < 4; i += 1) {
      limiter.recordBad(`source-${i}`, 6_000 + i);
    }
    expect(limiter.size).toBe(4);
    bad(limiter, "was-blocked", 7_000, 7_001);
    expect(limiter.isBlocked("was-blocked", 7_002), "its earlier count is gone").toBe(false);
  });

  test("when every remembered source is blocked, the one used longest ago goes", () => {
    const limiter = new BadSignatureLimiter({ ...options, maxSources: 2 });
    bad(limiter, "a", 0, 1, 2);
    bad(limiter, "b", 3, 4, 5);
    bad(limiter, "c", 6, 7, 8);
    expect(limiter.size).toBe(2);
    expect([
      limiter.isBlocked("a", 9),
      limiter.isBlocked("b", 9),
      limiter.isBlocked("c", 9),
    ]).toEqual([false, true, true]);
  });
});
