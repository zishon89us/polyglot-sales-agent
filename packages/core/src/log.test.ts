// The shape of a log line (NFR-O2; M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md, section 5).

import { describe, expect, test } from "vitest";
import { LOG_EVENTS, LOG_NUMBERS, type LogFields, logLine, settingsNamed } from "./log.ts";

const AT = new Date("2026-11-24T10:00:00.123Z");
const ID = "0b9f3a52-6c1d-4e8f-9a70-3d2c1b4e5f60";
const KEYS = [
  "time",
  "level",
  "service",
  "event",
  "code",
  "requestId",
  "tenantId",
  "conversationId",
  "jobId",
  "names",
  "n",
];
const read = (fields: unknown): Record<string, unknown> =>
  JSON.parse(logLine(fields as LogFields, AT));

describe("a log line", () => {
  test("is one line of JSON with the same keys in the same order, null where there is none", () => {
    const line = logLine({ level: "info", service: "worker", event: "running" }, AT);
    expect(line).not.toContain("\n");
    expect(Object.keys(JSON.parse(line))).toEqual(KEYS);
    expect(JSON.parse(line)).toEqual({
      time: "2026-11-24T10:00:00.123Z",
      level: "info",
      service: "worker",
      event: "running",
      code: null,
      requestId: null,
      tenantId: null,
      conversationId: null,
      jobId: null,
      names: [],
      n: {},
    });
  });

  test("a full line: every identifier, a code, a name and the three numbers", () => {
    expect(
      read({
        level: "warn",
        service: "worker",
        event: "job",
        code: "retry",
        requestId: ID,
        tenantId: ID,
        conversationId: ID,
        jobId: ID.toUpperCase(),
        names: ["process-conversation", "PSA_DB_APP_URL"],
        n: { status: 503, durationMs: 0, attempts: 1_000_000_000 },
      }),
    ).toMatchObject({
      code: "retry",
      requestId: ID,
      jobId: ID.toUpperCase(),
      names: ["process-conversation", "PSA_DB_APP_URL"],
      n: { status: 503, durationMs: 0, attempts: 1_000_000_000 },
    });
  });

  test("the lists are the ones decided", () => {
    expect(LOG_EVENTS).toEqual([
      "listening",
      "running",
      "stopped",
      "could-not-start",
      "request",
      "job",
      "loop-error",
      "webhook-unavailable",
      "turn-skipped",
      "send-failed",
      "reply-blocked",
    ]);
    expect(LOG_NUMBERS).toEqual(["status", "durationMs", "attempts", "port"]);
  });

  const SENTENCE = "Do you have a slot on Thursday?";
  test.each([
    ["a sentence", SENTENCE],
    ["a phone number", "+15550142"],
    ["digits only", "15550142"],
    ["a name", "Test Customer"],
    ["an address", "customer@example.com"],
    ["a number", 15550142],
    ["an object", { text: SENTENCE }],
    ["a list", [SENTENCE]],
    ["an empty text", ""],
  ])("%s is written nowhere a text can go: each such value becomes `invalid`", (_name, value) => {
    const line = logLine(
      {
        level: value,
        service: value,
        event: value,
        code: value,
        requestId: value,
        tenantId: value,
        conversationId: value,
        jobId: value,
        names: [value, value],
      } as unknown as LogFields,
      AT,
    );
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      time: "2026-11-24T10:00:00.123Z",
      level: "invalid",
      service: "invalid",
      event: "invalid",
      code: "invalid",
      requestId: "invalid",
      tenantId: "invalid",
      conversationId: "invalid",
      jobId: "invalid",
      names: ["invalid", "invalid"],
      n: {},
    });
    for (const mark of ["Thursday", "5550142", "Customer", "example.com"]) {
      expect(line).not.toContain(mark);
    }
  });

  test("a word that looks like a name is not a code unless a code can be made of it, and no code holds a digit beside letters", () => {
    expect(read({ code: "ECONNREFUSED" })["code"]).toBe("ECONNREFUSED");
    expect(read({ code: "trace-not-stored" })["code"]).toBe("trace-not-stored");
    expect(read({ code: "23505" })["code"]).toBe("23505");
    expect(read({ code: "call 15550142" })["code"]).toBe("invalid");
    expect(read({ code: "x15550142" })["code"]).toBe("invalid");
    expect(read({ code: "155501" })["code"]).toBe("invalid");
    expect(read({ code: "a".repeat(41) })["code"]).toBe("invalid");
    // The channel's own number for a refused send: six digits at most, which no phone number is.
    expect(read({ code: "meta-131047" })["code"]).toBe("meta-131047");
    expect(read({ code: "meta-0" })["code"]).toBe("meta-0");
    expect(read({ code: "meta-1555014" })["code"]).toBe("invalid");
    expect(read({ code: "meta-155501420000000" })["code"]).toBe("invalid");
    expect(read({ code: "meta-12a" })["code"]).toBe("invalid");
  });

  test("a name is a setting's or a job's type: no digit, no space, and twenty at most", () => {
    expect(
      read({ names: ["PSA_X", "process-conversation", "psa_x", "PSA_1", "job 1", "x1", "PSA_"] })[
        "names"
      ],
    ).toEqual([
      "PSA_X",
      "process-conversation",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(read({ names: Array.from({ length: 30 }, () => "a") })["names"]).toHaveLength(20);
    expect(read({ names: "PSA_X" })["names"]).toEqual([]);
  });

  test.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["over the ceiling", 1_000_000_001],
    ["text", "200"],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])(
    "a number that is %s is left out, and so is a number under a key that is not in the list",
    (_name, value) => {
      expect(
        read({ n: { status: value, durationMs: 5, phone: 15550142, attemptsx: 1 } })["n"],
      ).toEqual({
        durationMs: 5,
      });
    },
  );

  test("never throws: fields that are missing, null, or that throw when read still give a line", () => {
    expect(read(undefined)).toMatchObject({ level: "invalid", event: "invalid", names: [] });
    expect(read(null)).toMatchObject({ level: "invalid" });
    const trap = {
      level: "info",
      service: "api",
      get event(): string {
        throw new Error(SENTENCE);
      },
    };
    const line = logLine(trap as unknown as LogFields, AT);
    expect(JSON.parse(line)).toMatchObject({ level: "info", service: "api", event: "invalid" });
    expect(line).not.toContain("Thursday");
    expect(
      JSON.parse(
        logLine({ level: "info", service: "api", event: "request" }, new Date(Number.NaN)),
      ),
    ).toMatchObject({
      time: "invalid",
    });
  });

  test("the time is now when none is given", () => {
    const before = Date.now();
    const time = Date.parse(
      JSON.parse(logLine({ level: "info", service: "api", event: "request" })).time,
    );
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now());
  });
});

describe("the settings a failure names", () => {
  test("each setting once, in order, and nothing else of the message", () => {
    expect(
      settingsNamed(
        "worker: PSA_DB_APP_URL is missing; PSA_MODEL_PRICES is not JSON; PSA_DB_APP_URL again, at host 10.0.0.7",
      ),
    ).toEqual(["PSA_DB_APP_URL", "PSA_MODEL_PRICES"]);
    expect(settingsNamed("no setting here")).toEqual([]);
    expect(settingsNamed(undefined)).toEqual([]);
    expect(settingsNamed("XPSA_NOT PSA_ PSA_lower")).toEqual([]);
  });
});
