// What of a batch one call is given (design note
// docs/design/notes/m3-u4-llm-client.md, section 4, T1 to T6).

import { BATCH_TEXT_MAX } from "@polyglot-sales-agent/core";
import { describe, expect, test } from "vitest";
import { boundBatch } from "./batch.ts";

describe("a batch's text", () => {
  test("T1: within the limit, all of it is given as typed, the limit itself included", () => {
    expect(boundBatch(["first", "second"])).toEqual({
      texts: ["first", "second"],
      leftOut: 0,
      cut: false,
    });
    expect(boundBatch(["abc", "de"], 5)).toEqual({ texts: ["abc", "de"], leftOut: 0, cut: false });
    const full = "x".repeat(BATCH_TEXT_MAX);
    expect(boundBatch([full])).toEqual({ texts: [full], leftOut: 0, cut: false });
    expect(BATCH_TEXT_MAX).toBe(8_000);
  });

  test("T2: over the limit, the newest are kept whole and the older left out", () => {
    expect(boundBatch(["abc", "de", "fgh"], 5)).toEqual({
      texts: ["de", "fgh"],
      leftOut: 1,
      cut: false,
    });
    expect(boundBatch(["abc", "de", "fgh"], 4)).toEqual({ texts: ["fgh"], leftOut: 2, cut: false });
  });

  test("T2: it stops at the first that does not fit: an older, smaller one is not kept past a gap", () => {
    // "a" would fit beside "fgh", but "bcde" between them does not.
    expect(boundBatch(["a", "bcde", "fgh"], 5)).toEqual({ texts: ["fgh"], leftOut: 2, cut: false });
  });

  test("T3: the newest alone over the limit is cut to its beginning, and no other is kept", () => {
    expect(boundBatch(["old", "abcdefgh"], 5)).toEqual({ texts: ["abcde"], leftOut: 1, cut: true });
    expect(boundBatch(["x".repeat(BATCH_TEXT_MAX + 1)])).toEqual({
      texts: ["x".repeat(BATCH_TEXT_MAX)],
      leftOut: 0,
      cut: true,
    });
  });

  test("T4: what was left out and whether anything was cut is said in numbers", () => {
    const result = boundBatch(["1", "2", "3", "4", "55555"], 6);
    expect(result).toEqual({ texts: ["4", "55555"], leftOut: 3, cut: false });
  });

  test("T5: an empty batch gives nothing and leaves nothing out; an empty text is kept and costs nothing", () => {
    expect(boundBatch([])).toEqual({ texts: [], leftOut: 0, cut: false });
    expect(boundBatch(["", "abcde"], 5)).toEqual({ texts: ["", "abcde"], leftOut: 0, cut: false });
  });

  test("T6: lengths and the cut are in code points: an astral character is one, and is never halved", () => {
    const face = "\u{1F600}";
    expect(boundBatch([face.repeat(5)], 5)).toEqual({
      texts: [face.repeat(5)],
      leftOut: 0,
      cut: false,
    });
    const cut = boundBatch([`a${face.repeat(5)}`], 3);
    expect(cut).toEqual({ texts: [`a${face.repeat(2)}`], leftOut: 0, cut: true });
    expect(/\p{Cs}/u.test(cut.texts[0] ?? "")).toBe(false);
    // It can fall inside a letter with its mark: accepted, and said in the note.
    expect(boundBatch(["éé"], 3).texts).toEqual(["ée"]);
  });

  test("the texts handed in are not changed, and a limit that is not a whole number above 0 is refused", () => {
    const texts = Object.freeze(["abc", "de", "fgh"]);
    boundBatch(texts, 5);
    expect(texts).toEqual(["abc", "de", "fgh"]);
    for (const max of [0, -1, 1.5, Number.NaN]) {
      expect(() => boundBatch(["a"], max)).toThrow(RangeError);
    }
  });
});
