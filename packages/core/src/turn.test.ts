// The fixed values of a turn, each written a second time on purpose (M3
// unit U7; design note docs/design/notes/m3-u7-turn.md).

import { describe, expect, test } from "vitest";
import {
  LANGUAGE_CODE,
  LANGUAGE_UNKNOWN,
  languageSupported,
  SUPPORTED_LANGUAGES,
} from "./names.ts";
import * as turn from "./turn.ts";

describe("the fixed values of a turn", () => {
  test("every value is the one decided", () => {
    expect({ ...turn }).toEqual({
      TOOL_RUN_TIMEOUT_MS: 2_000,
      TOOL_STATEMENT_TIMEOUT_MS: 500,
      TOOL_RESULT_MAX: 4_000,
      HISTORY_MESSAGES_MAX: 30,
      HISTORY_TEXT_MAX: 12_000,
      TOOL_OUTCOMES: ["done", "refused", "failed"],
    });
  });

  test("the supported languages are the six proposed, and nothing else is supported", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["ar", "en", "ur", "hi", "bn", "tl"]);
    for (const code of SUPPORTED_LANGUAGES) {
      expect(languageSupported(code)).toBe(true);
      expect(LANGUAGE_CODE.test(code)).toBe(true);
    }
    for (const code of ["de", "und", "EN", "eng", "", "toString", "constructor"]) {
      expect(languageSupported(code), code).toBe(false);
    }
    expect(LANGUAGE_UNKNOWN).toBe("und");
    expect(LANGUAGE_CODE.test(LANGUAGE_UNKNOWN)).toBe(false);
    expect(LANGUAGE_CODE.test("en\n")).toBe(false);
  });
});
