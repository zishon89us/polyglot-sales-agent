// Deliberately failing: the test run must fail on this file.
import { expect, test } from "vitest";

test("selftest fixture fails on purpose", () => {
  expect(1 + 1).toBe(3);
});
