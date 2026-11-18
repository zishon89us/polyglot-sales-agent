import { describe, expect, test } from "vitest";
import { MESSAGE_CLASSES, type MessageClass } from "./names.ts";
import {
  decideAfterSend,
  ECHO_MAX_CHARS,
  echoReply,
  RESENT_AFTER_UNKNOWN,
  SEND_MAX_ATTEMPTS,
  SEND_RETRY_WAITS_MS,
  type SendOutcome,
  UNCONFIRMED,
} from "./send-policy.ts";

const CLASSES = Object.keys(MESSAGE_CLASSES) as MessageClass[];
const REPLIES: MessageClass[] = ["assistant-reply", "system-reply", "staff-message"];
const OTHERS: MessageClass[] = ["service-notice", "business-initiated"];
const accepted: SendOutcome = { kind: "accepted" };
const unknown: SendOutcome = { kind: "unknown" };
const busy: SendOutcome = { kind: "refused", retryable: true, code: "rate-limited" };
const no: SendOutcome = { kind: "refused", retryable: false, code: "meta-131047" };

describe("the send policy, by message class", () => {
  test("every class has a rule, and the rule is the documented one", () => {
    expect(Object.keys(RESENT_AFTER_UNKNOWN).sort()).toEqual([...CLASSES].sort());
    expect(CLASSES.filter((name) => RESENT_AFTER_UNKNOWN[name])).toEqual(REPLIES);
    expect([SEND_MAX_ATTEMPTS, ...SEND_RETRY_WAITS_MS]).toEqual([3, 2_000, 8_000]);
  });

  test.each(CLASSES)("%s: accepted is sent, whatever came before", (name) => {
    expect(decideAfterSend(name, { attempts: 1, unknownBefore: 0 }, accepted)).toEqual({
      next: "sent",
    });
    expect(decideAfterSend(name, { attempts: 3, unknownBefore: 1 }, accepted)).toEqual({
      next: "sent",
    });
  });

  test.each(CLASSES)(
    "%s: a refusal that cannot be retried fails at once with the channel's code",
    (name) => {
      expect(decideAfterSend(name, { attempts: 1, unknownBefore: 0 }, no)).toEqual({
        next: "failed",
        code: "meta-131047",
      });
    },
  );

  test.each(CLASSES)(
    "%s: a refusal that can be retried is tried three times in all, after 2 and 8 seconds",
    (name) => {
      expect(decideAfterSend(name, { attempts: 1, unknownBefore: 0 }, busy)).toEqual({
        next: "retry",
        waitMs: 2_000,
      });
      expect(decideAfterSend(name, { attempts: 2, unknownBefore: 0 }, busy)).toEqual({
        next: "retry",
        waitMs: 8_000,
      });
      expect(decideAfterSend(name, { attempts: 3, unknownBefore: 0 }, busy)).toEqual({
        next: "failed",
        code: "rate-limited",
      });
    },
  );

  test.each(REPLIES)(
    "%s: an unknown outcome is followed by one more call, and never by a second",
    (name) => {
      expect(decideAfterSend(name, { attempts: 1, unknownBefore: 0 }, unknown)).toEqual({
        next: "retry",
        waitMs: 2_000,
      });
      expect(decideAfterSend(name, { attempts: 2, unknownBefore: 1 }, unknown)).toEqual({
        next: "failed",
        code: UNCONFIRMED,
      });
      // After two refusals there is no call left, so the unknown third ends it.
      expect(decideAfterSend(name, { attempts: 3, unknownBefore: 0 }, unknown)).toEqual({
        next: "failed",
        code: UNCONFIRMED,
      });
    },
  );

  test.each(OTHERS)("%s: an unknown outcome is never followed by another call", (name) => {
    expect(decideAfterSend(name, { attempts: 1, unknownBefore: 0 }, unknown)).toEqual({
      next: "failed",
      code: UNCONFIRMED,
    });
    expect(decideAfterSend(name, { attempts: 2, unknownBefore: 0 }, unknown)).toEqual({
      next: "failed",
      code: UNCONFIRMED,
    });
  });

  test("whatever the channel does, a customer gets at most two copies of a reply and one of anything else (NFR-R2)", () => {
    const outcomes = [accepted, unknown, busy, no];
    // Every sequence of outcomes, as long as the policy keeps calling.
    function worst(name: MessageClass, attempts: number, unknownBefore: number): number {
      let most = 0;
      for (const outcome of outcomes) {
        // A copy may have reached the customer when the call was accepted or unknown.
        const copy = outcome.kind === "refused" ? 0 : 1;
        const decision = decideAfterSend(name, { attempts, unknownBefore }, outcome);
        const later =
          decision.next === "retry"
            ? worst(name, attempts + 1, unknownBefore + (outcome.kind === "unknown" ? 1 : 0))
            : 0;
        if (decision.next === "retry") {
          expect(attempts, "never a fourth call").toBeLessThan(SEND_MAX_ATTEMPTS);
        }
        most = Math.max(most, copy + later);
      }
      return most;
    }
    for (const name of REPLIES) {
      expect(worst(name, 1, 0), name).toBe(2);
    }
    for (const name of OTHERS) {
      expect(worst(name, 1, 0), name).toBe(1);
    }
  });
});

describe("the echo reply", () => {
  test("gives the customer's text back, each message on a line", () => {
    expect(echoReply(["hello"])).toBe("Echo: hello");
    expect(echoReply(["one", null, "two"])).toBe("Echo: one\ntwo");
  });

  test("is nothing when the batch holds no text", () => {
    expect(echoReply([])).toBeUndefined();
    expect(echoReply([null, null])).toBeUndefined();
    expect(echoReply(["  ", "\n"])).toBeUndefined();
  });

  test("is cut at its limit, by character and never through one", () => {
    const long = echoReply(["😀".repeat(2_000)]) as string;
    expect([...long]).toHaveLength(ECHO_MAX_CHARS);
    expect(long.endsWith("😀")).toBe(true);
    // No half of a pair is left at the end.
    expect(encodeURIComponent(long)).toContain("%F0%9F%98%80");
  });
});
