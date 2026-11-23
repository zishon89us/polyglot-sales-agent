// What a button's payload is (design note M3 U5, section 2, cases B1 to B5).

import { describe, expect, test } from "vitest";
import {
  BUTTON_PAYLOAD_MAX,
  CORE_BUTTON_OWNER,
  coreButton,
  coreButtonOf,
  readButtonPayload,
} from "./buttons.ts";
import { CORE_BUTTONS } from "./names.ts";

describe("a button's payload", () => {
  test("the core's buttons are exactly these three, and their owner is `core`", () => {
    expect(CORE_BUTTONS).toEqual(["stop", "start", "person"]);
    expect(CORE_BUTTON_OWNER).toBe("core");
    expect(BUTTON_PAYLOAD_MAX).toBe(256);
  });

  test("B1 and B5: every payload the core builds begins with its owner and reads back as its action", () => {
    for (const action of CORE_BUTTONS) {
      const payload = coreButton(action);
      expect(payload).toBe(`core.${action}`);
      expect(readButtonPayload(payload)).toEqual({ owner: "core", action, rest: null });
      expect(coreButtonOf(payload)).toBe(action);
    }
  });

  test("the core builds no payload for an action it does not have", () => {
    expect(() => coreButton("dance" as never)).toThrow(RangeError);
  });

  test("B2: a pack's payload has the pack as owner, an action, and a rest that is the pack's own", () => {
    expect(readButtonPayload("booking.confirm.2f6c:2026-12-01T10.00Z")).toEqual({
      owner: "booking",
      action: "confirm",
      rest: "2f6c:2026-12-01T10.00Z",
    });
    expect(coreButtonOf("booking.stop")).toBeUndefined();
  });

  test.each([
    "stop",
    "core.",
    ".stop",
    "core..x",
    "core.stop.",
    "Core.stop",
    "core.Stop",
    "core.stop now",
    " core.stop",
    "core.stop\n",
    "core.stop\u0000",
    "core.stop.é",
    "corе.stop",
    "1core.stop",
    "",
    `core.${"x".repeat(41)}`,
    `core.stop.${"x".repeat(247)}`,
    7,
    null,
    undefined,
    ["core.stop"],
  ])("B3: %j is not a payload", (value) => {
    expect(readButtonPayload(value)).toBeUndefined();
    expect(coreButtonOf(value)).toBeUndefined();
  });

  test("the longest payload, 256 characters, is read", () => {
    const payload = `core.stop.${"x".repeat(246)}`;
    expect(payload).toHaveLength(256);
    expect(readButtonPayload(payload)?.rest).toHaveLength(246);
  });

  test("B4: an action the core does not have is a payload, and not one of the core's buttons", () => {
    expect(readButtonPayload("core.dance")).toEqual({ owner: "core", action: "dance", rest: null });
    expect(coreButtonOf("core.dance")).toBeUndefined();
  });

  test("a core payload with anything after the action is not one of the core's buttons", () => {
    expect(coreButtonOf("core.stop.now")).toBeUndefined();
    expect(coreButtonOf("core.stop")).toBe("stop");
  });
});
