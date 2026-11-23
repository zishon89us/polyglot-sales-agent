// The check of what a model answers (design note
// docs/design/notes/m3-u4-llm-client.md, section 3, S1 to S12).

import {
  CLAIM_TEXT_MAX,
  CLAIMS_MAX,
  CORE_CLAIM_KINDS,
  MODEL_FLAGS,
  TOOL_ARGUMENTS_DEPTH_MAX,
  TOOL_ARGUMENTS_MAX,
  TOOL_CALL_ID_MAX,
  TOOL_CALLS_PER_ROUND_MAX,
} from "@polyglot-sales-agent/core";
import { describe, expect, test } from "vitest";
import { readOutput } from "./output.ts";

const ALLOWED = { claimKinds: [...CORE_CLAIM_KINDS, "pack-kind"], tools: ["find", "write"] };
const read = (value: unknown, allowed = ALLOWED) => readOutput(value, allowed);
const good = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  reply: "We open at 09:00.",
  claims: [{ kind: "opening-hours", item: "1", value: "09:00" }],
  flags: [],
  toolCalls: [],
  ...change,
});
const asks = (calls: unknown[], change: Record<string, unknown> = {}) => ({
  reply: "",
  claims: [],
  flags: [],
  toolCalls: calls,
  ...change,
});
const call = (change: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "find",
  arguments: { day: "2026-12-01" },
  ...change,
});
const refused = (code: string) => ({ ok: false, code });

describe("an answer that keeps the structure", () => {
  test("S1: the four parts are read into a new, frozen copy, never the object handed in", () => {
    const given = good({ flags: ["asks-for-person"] });
    const result = read(given);
    expect(result).toEqual({
      ok: true,
      output: {
        reply: "We open at 09:00.",
        claims: [{ kind: "opening-hours", item: "1", value: "09:00" }],
        flags: ["asks-for-person"],
        toolCalls: [],
      },
    });
    if (!result.ok) {
      throw new Error("not read");
    }
    expect(result.output).not.toBe(given);
    expect(result.output.claims).not.toBe(given["claims"]);
    expect(Object.isFrozen(result.output)).toBe(true);
    expect(Object.isFrozen(result.output.claims)).toBe(true);
    expect(Object.isFrozen(result.output.claims[0])).toBe(true);
    expect(Object.isFrozen(result.output.flags)).toBe(true);
    // A change to what was handed in afterwards changes nothing that was read.
    const first = (given["claims"] as { value: string }[])[0];
    if (first !== undefined) {
      first.value = "10:00";
    }
    expect(result.output.claims[0]?.value).toBe("09:00");
  });

  test("S1: an empty reply with nothing else is the structure too; whether it is sent is another check's", () => {
    expect(read(good({ reply: "", claims: [] })).ok).toBe(true);
    expect(read(good({ reply: "two" + "\n" + "lines" })).ok).toBe(true);
  });

  test("S1: a request for tools is read, its arguments copied and frozen all the way down", () => {
    const given = asks([
      call({
        arguments: { day: "2026-12-01", people: 2, late: false, note: null, list: [1, { a: "b" }] },
      }),
      call({ id: "c2", name: "write", arguments: {} }),
    ]);
    const result = read(given);
    if (!result.ok) {
      throw new Error("not read");
    }
    expect(result.output.toolCalls).toEqual([
      {
        id: "c1",
        name: "find",
        arguments: { day: "2026-12-01", people: 2, late: false, note: null, list: [1, { a: "b" }] },
      },
      { id: "c2", name: "write", arguments: {} },
    ]);
    const copied = result.output.toolCalls[0]?.arguments as { list: [number, { a: string }] };
    expect(copied).not.toBe((given.toolCalls[0] as { arguments: unknown }).arguments);
    expect(Object.isFrozen(copied)).toBe(true);
    expect(Object.isFrozen(copied.list)).toBe(true);
    expect(Object.isFrozen(copied.list[1])).toBe(true);
  });

  test("all seven flags are known, and may come with a reply or with a request for tools", () => {
    expect(read(good({ flags: [...MODEL_FLAGS] }))).toMatchObject({
      ok: true,
      output: { flags: [...MODEL_FLAGS] },
    });
    expect(read(asks([call()], { flags: ["emergency"] }))).toMatchObject({
      ok: true,
      output: { flags: ["emergency"] },
    });
  });

  test("S7: a flag written twice is that flag, once, in the order first written", () => {
    expect(
      read(good({ flags: ["emergency", "asks-to-stop", "emergency", "emergency"] })),
    ).toMatchObject({
      ok: true,
      output: { flags: ["emergency", "asks-to-stop"] },
    });
  });

  test("S9: a claim kind that the tenant's pack registers is accepted where the request allows it, and only there", () => {
    const answer = good({ claims: [{ kind: "pack-kind", item: "r1", value: "10:30" }] });
    expect(read(answer).ok).toBe(true);
    expect(read(answer, { claimKinds: [...CORE_CLAIM_KINDS], tools: [] })).toEqual(
      refused("claim"),
    );
  });

  test("each limit is met exactly", () => {
    const text = "\u{10400}".repeat(CLAIM_TEXT_MAX);
    const claims = Array.from({ length: CLAIMS_MAX }, () => ({
      kind: "price",
      item: text,
      value: text,
    }));
    expect(read(good({ claims })).ok).toBe(true);
    const calls = Array.from({ length: TOOL_CALLS_PER_ROUND_MAX }, (_, index) =>
      call({ id: `${index}`.padEnd(TOOL_CALL_ID_MAX, "x") }),
    );
    expect(read(asks(calls)).ok).toBe(true);
    // {"t":"…"} is 8 characters around the text.
    expect(read(asks([call({ arguments: { t: "a".repeat(TOOL_ARGUMENTS_MAX - 8) } })])).ok).toBe(
      true,
    );
    let deep: unknown = "x";
    for (let level = 1; level <= TOOL_ARGUMENTS_DEPTH_MAX; level += 1) {
      deep = { in: deep };
    }
    expect(read(asks([call({ arguments: deep })])).ok).toBe(true);
  });
});

describe("an answer that does not", () => {
  test("S2: a missing part, null for a part, or a part of the wrong type is a fault of shape", () => {
    for (const part of ["reply", "claims", "flags", "toolCalls"]) {
      const missing = good();
      delete missing[part];
      expect(read(missing), part).toEqual(refused("shape"));
      expect(read(good({ [part]: null })), part).toEqual(refused("shape"));
      expect(read(good({ [part]: 7 })), part).toEqual(refused("shape"));
      expect(read(good({ [part]: undefined })), part).toEqual(refused("shape"));
    }
    expect(read(good({ reply: ["a"] }))).toEqual(refused("shape"));
    expect(read(good({ claims: {} }))).toEqual(refused("shape"));
    expect(read(good({ claims: ["price"] }))).toEqual(refused("shape"));
    expect(read(good({ claims: [{ kind: "price", item: 1, value: "1" }] }))).toEqual(
      refused("shape"),
    );
    expect(read(good({ claims: [{ kind: "price", item: "1" }] }))).toEqual(refused("shape"));
    expect(read(good({ flags: "emergency" }))).toEqual(refused("shape"));
    expect(read(good({ flags: [1] }))).toEqual(refused("shape"));
    expect(read(good({ flags: [null] }))).toEqual(refused("shape"));
    expect(read(asks([{ id: "c", name: "find" }]))).toEqual(refused("shape"));
    expect(read(asks([call({ id: 1 })]))).toEqual(refused("shape"));
    expect(read(asks(["find"]))).toEqual(refused("shape"));
  });

  test("S3: a fifth key, at the top or inside a claim or a tool call, is a fault of shape", () => {
    expect(read(good({ thinking: "..." }))).toEqual(refused("shape"));
    expect(read(good({ claims: [{ kind: "price", item: "1", value: "1", sure: true }] }))).toEqual(
      refused("shape"),
    );
    expect(read(asks([call({ reason: "because" })]))).toEqual(refused("shape"));
  });

  test("S4: what is not a plain object at all is a fault of shape", () => {
    class Answer {
      reply = "";
      claims = [];
      flags = [];
      toolCalls = [];
    }
    const getter = good();
    Object.defineProperty(getter, "reply", { get: () => "x", enumerable: true });
    const hidden = good();
    Object.defineProperty(hidden, "extra", { value: 1, enumerable: false });
    const marked = good();
    (marked as Record<symbol, unknown>)[Symbol("x")] = 1;
    const holds: Record<string, unknown> = good();
    holds["claims"] = [holds];
    const holes = new Array(2);
    holes[1] = "emergency";
    for (const value of [
      "text",
      '{"reply":"","claims":[],"flags":[],"toolCalls":[]}',
      7,
      true,
      null,
      undefined,
      [],
      [good()],
      new Map(Object.entries(good())),
      new Date(0),
      new Answer(),
      getter,
      hidden,
      marked,
      holds,
      good({ flags: holes }),
      good({ claims: new Array(1) }),
      () => good(),
    ]) {
      expect(read(value), String(value)).toEqual(refused("shape"));
    }
    // An object with no prototype is as plain as one made by JSON.
    expect(read(Object.assign(Object.create(null), good())).ok).toBe(true);
    expect(read(JSON.parse(JSON.stringify(good()))).ok).toBe(true);
  });

  test("S5: half of a surrogate pair, or a control character other than a line break, anywhere, is a fault of shape", () => {
    for (const bad of [
      "a\u0000b",
      "a\u001B[2J",
      "a\tb",
      "a\rb",
      "a\u0085b",
      "a\uD800b",
      "\uDC00",
    ]) {
      expect(read(good({ reply: bad })), "reply").toEqual(refused("shape"));
      expect(read(good({ claims: [{ kind: "price", item: bad, value: "1" }] })), "item").toEqual(
        refused("shape"),
      );
      expect(read(good({ claims: [{ kind: "price", item: "1", value: bad }] })), "value").toEqual(
        refused("shape"),
      );
      expect(read(good({ claims: [{ kind: bad, item: "1", value: "1" }] })), "kind").toEqual(
        refused("shape"),
      );
      expect(read(good({ flags: [bad] })), "flag").toEqual(refused("shape"));
      expect(read(asks([call({ id: bad })])), "id").toEqual(refused("shape"));
      expect(read(asks([call({ name: bad })])), "name").toEqual(refused("shape"));
      expect(read(asks([call({ arguments: { note: bad } })])), "argument").toEqual(
        refused("shape"),
      );
      expect(read(asks([call({ arguments: { list: [{ deep: [bad] }] } })])), "deep").toEqual(
        refused("shape"),
      );
      expect(read(asks([call({ arguments: { [bad]: 1 } })])), "key").toEqual(refused("shape"));
    }
    // A proper pair, a joiner and a direction mark are text like any other here.
    expect(read(good({ reply: "\u{1F600} \u200D\u200F\u0633" })).ok).toBe(true);
  });

  test("S6: a flag that is not one of the seven is a fault of flag, a name every object has among them", () => {
    for (const flag of [
      "urgent",
      "EMERGENCY",
      "emergency ",
      "",
      "__proto__",
      "constructor",
      "toString",
      "length",
      "0",
    ]) {
      expect(read(good({ flags: [flag] })), flag).toEqual(refused("flag"));
      expect(read(good({ flags: ["emergency", flag] })), flag).toEqual(refused("flag"));
    }
  });

  test("S8: a claim of a kind the request does not allow, with an empty or over-long text, or one too many", () => {
    for (const kind of [
      "calendar-date",
      "total",
      "Price",
      "",
      "__proto__",
      "constructor",
      "includes",
    ]) {
      expect(read(good({ claims: [{ kind, item: "1", value: "1" }] })), kind).toEqual(
        refused("claim"),
      );
    }
    const long = "\u{10400}".repeat(CLAIM_TEXT_MAX + 1);
    expect(read(good({ claims: [{ kind: "price", item: "", value: "1" }] }))).toEqual(
      refused("claim"),
    );
    expect(read(good({ claims: [{ kind: "price", item: "1", value: "" }] }))).toEqual(
      refused("claim"),
    );
    expect(read(good({ claims: [{ kind: "price", item: long, value: "1" }] }))).toEqual(
      refused("claim"),
    );
    expect(read(good({ claims: [{ kind: "price", item: "1", value: long }] }))).toEqual(
      refused("claim"),
    );
    const many = Array.from({ length: CLAIMS_MAX + 1 }, () => ({
      kind: "price",
      item: "1",
      value: "1",
    }));
    expect(read(good({ claims: many }))).toEqual(refused("claim"));
    // A request that allows no kind allows no claim.
    expect(read(good(), { claimKinds: [], tools: [] })).toEqual(refused("claim"));
  });

  test("S10: a tool not on offer, an identifier twice or of a wrong length, or arguments that are not plain data within the bounds", () => {
    for (const name of ["delete", "Find", "", "__proto__", "constructor", "includes"]) {
      expect(read(asks([call({ name })])), name).toEqual(refused("tool-call"));
    }
    expect(read(asks([call()]), { claimKinds: [], tools: [] })).toEqual(refused("tool-call"));
    expect(read(asks([call(), call({ name: "write" })]))).toEqual(refused("tool-call"));
    expect(read(asks([call({ id: "" })]))).toEqual(refused("tool-call"));
    expect(read(asks([call({ id: "x".repeat(TOOL_CALL_ID_MAX + 1) })]))).toEqual(
      refused("tool-call"),
    );
    const calls = Array.from({ length: TOOL_CALLS_PER_ROUND_MAX + 1 }, (_, index) =>
      call({ id: `c${index}` }),
    );
    expect(read(asks(calls))).toEqual(refused("tool-call"));

    let deep: unknown = "x";
    // One level more than is allowed.
    for (let level = 1; level <= TOOL_ARGUMENTS_DEPTH_MAX + 1; level += 1) {
      deep = { in: deep };
    }
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const withGetter = {};
    Object.defineProperty(withGetter, "day", { get: () => "x", enumerable: true });
    const sparse = new Array(2);
    sparse[1] = 1;
    for (const given of [
      [],
      ["a"],
      "day=1",
      null,
      undefined,
      7,
      deep,
      cyclic,
      withGetter,
      new Map(),
      new Date(0),
      { when: new Date(0) },
      { run: () => 1 },
      { n: Number.NaN },
      { n: Number.POSITIVE_INFINITY },
      { n: 10n },
      { missing: undefined },
      { list: sparse },
      { t: "a".repeat(TOOL_ARGUMENTS_MAX - 7) },
      JSON.parse('{"__proto__": {"admin": true}}'),
      JSON.parse('{"a": {"constructor": 1}}'),
      JSON.parse('{"a": [{"prototype": 1}]}'),
    ]) {
      expect(read(asks([call({ arguments: given })])), typeof given).toEqual(refused("tool-call"));
    }
  });

  test("S11: an answer asks for tools or it replies, not both", () => {
    expect(read(asks([call()], { reply: "One moment." }))).toEqual(refused("tool-call"));
    expect(read(asks([call()], { claims: [{ kind: "price", item: "1", value: "1" }] }))).toEqual(
      refused("tool-call"),
    );
  });

  test("S12: with two faults the code is the first of shape, flag, claim, tool-call", () => {
    const badFlag = { flags: ["urgent"] };
    const badClaim = { claims: [{ kind: "total", item: "1", value: "1" }] };
    const badCall = [call({ name: "delete" })];
    expect(read(good({ ...badFlag, extra: 1 }))).toEqual(refused("shape"));
    expect(read(good({ ...badClaim, extra: 1 }))).toEqual(refused("shape"));
    expect(read({ ...asks(badCall), extra: 1 })).toEqual(refused("shape"));
    expect(read(good({ ...badFlag, ...badClaim }))).toEqual(refused("flag"));
    expect(read(asks(badCall, badFlag))).toEqual(refused("flag"));
    expect(read(asks(badCall, badClaim))).toEqual(refused("claim"));
  });

  test("nothing is repaired: an answer one fault from good is refused whole", () => {
    // Not trimmed, not lower-cased, not cut to the limit.
    expect(read(good({ flags: [" emergency"] }))).toEqual(refused("flag"));
    expect(read(good({ claims: [{ kind: "PRICE", item: "1", value: "1" }] }))).toEqual(
      refused("claim"),
    );
    expect(read(good({ reply: 12 }))).toEqual(refused("shape"));
  });
});
