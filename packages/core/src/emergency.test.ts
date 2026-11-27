import { describe, expect, it } from "vitest";
import { EMERGENCY_PHRASES, emergencyFolded, findEmergency } from "./emergency.ts";

const at = (codePoint: number): string => String.fromCodePoint(codePoint);
const every = Object.entries(EMERGENCY_PHRASES).flatMap(([list, phrases]) =>
  phrases.map((phrase) => ({ list, phrase })),
);

describe("the emergency phrase lists (design note M3 U10a, section 2)", () => {
  it("has a list for each supported language, and one in Latin letters", () => {
    expect(Object.keys(EMERGENCY_PHRASES).sort()).toEqual([
      "ar",
      "bn",
      "en",
      "hi",
      "latin",
      "tl",
      "ur",
    ]);
  });

  it.each(every)("$list: finds its phrase inside a sentence", ({ phrase }) => {
    expect(findEmergency([`ok. ${phrase}, 12`])).toBeDefined();
    expect(findEmergency([phrase])).toBeDefined();
  });

  it.each(every)("$list: no common single word is a phrase", ({ phrase }) => {
    const folded = emergencyFolded(phrase);
    expect(folded.includes(" ") || folded.length >= 8).toBe(true);
    // Folded, a phrase is words and single spaces: nothing a pattern reads as more.
    expect(folded).toMatch(/^[\p{L}\p{M}\p{N}]+(?: [\p{L}\p{M}\p{N}]+)*$/u);
  });

  it("has no phrase twice once folded", () => {
    const folded = every.map(({ phrase }) => emergencyFolded(phrase));
    expect(new Set(folded).size).toBe(folded.length);
  });

  it("the word emergency alone is on no list", () => {
    for (const text of [
      "Is this an emergency number?",
      "I need an emergency appointment today",
      "حالة طارئة",
      "ایمرجنسی",
      "इमरजेंसी",
      "জরুরি",
      "emergency po",
    ]) {
      expect(findEmergency([text])).toBeUndefined();
    }
  });

  it("does not fire on ordinary messages", () => {
    for (const text of [
      "I'm dying to try the new facial",
      "Can I book a haircut on Friday at 5?",
      "patay ang phone ko",
      "my card was declined, I can breathe again once it works",
      "the pain in my back is better",
      "do you sell breathing masks",
      "overdoses of colour in my hair", // "overdoses" is not "overdose"
      "notbreathing", // one word
      "x1not breathing".replace(" ", ""), // glued
    ]) {
      expect(findEmergency([text])).toBeUndefined();
    }
  });

  it("fires on a harmless message that holds a phrase: the list leans that way", () => {
    expect(
      findEmergency(["My mother had a heart attack last year, can I move my booking?"]),
    ).toEqual({ list: "en" });
  });

  it("folds case, apostrophes of every form, punctuation and spaces", () => {
    for (const text of [
      "HE IS NOT BREATHING",
      "i can't breathe",
      `i can${at(0x2019)}t breathe`,
      `i can${at(0x2bc)}t breathe`,
      "i cant   breathe",
      "not\nbreathing",
      "not - breathing!!",
      "*not* _breathing_",
      `n${at(0x200b)}ot brea${at(0x200d)}thing`,
      `${at(0xff4e)}${at(0xff4f)}${at(0xff54)} breathing`, // full-width letters
      "she won't stop bleeding",
    ]) {
      expect(findEmergency([text])).toEqual({ list: "en" });
    }
  });

  it("reads a phrase over two messages of a batch, in their order", () => {
    expect(findEmergency(["he is not", "breathing"])).toEqual({ list: "en" });
    expect(findEmergency(["breathing", "he is not"])).toBeUndefined();
  });

  it("holds the boundary: no letter, mark or digit before, no letter or mark after", () => {
    expect(findEmergency(["overdosed"])).toBeDefined();
    expect(findEmergency(["overdoser"])).toBeUndefined();
    expect(findEmergency(["2overdose"])).toBeUndefined();
    expect(findEmergency(["overdose2"])).toBeDefined();
    // A Hindi phrase is not found inside a longer word that goes on with a vowel sign.
    expect(findEmergency(["बेहोश हैं"])).toBeUndefined();
    expect(findEmergency(["वह बेहोश है।"])).toEqual({ list: "hi" });
  });

  it("makes the Arabic letter forms one, and takes the marks over letters out", () => {
    // Written without the hamza, where the list has it; and the other way.
    expect(findEmergency(["لا استطيع التنفس"])).toEqual({ list: "ar" });
    expect(findEmergency(["لا أقدر أتنفس"])).toEqual({ list: "ar" });
    // Teh marbuta written as heh; alef maksura for yeh.
    expect(findEmergency(["عنده نوبه قلبيه"])).toEqual({ list: "ar" });
    expect(findEmergency(["ألم فى الصدر"])).toEqual({ list: "ar" });
    // With the marks over the letters.
    expect(findEmergency([`ن${at(0x64e)}زيف حاد`])).toEqual({ list: "ar" });
  });

  it("lets the one-letter and stand before an Arabic or an Urdu phrase, and nothing else", () => {
    expect(findEmergency(["تعبان ومش قادر اتنفس"])).toEqual({ list: "ar" });
    expect(findEmergency(["فلا يتنفس"])).toEqual({ list: "ar" });
    expect(findEmergency(["بنزيف حاد"])).toBeUndefined();
    expect(findEmergency(["wnot breathing"])).toBeUndefined();
  });

  it("reads Urdu written with either he and either yeh", () => {
    expect(findEmergency(["امی کو سانس نہیں آ رہی"])).toEqual({ list: "ur" });
    // The Arabic heh and yeh in place of the Urdu ones.
    expect(findEmergency(["سانس نهين آ رهي"])).toEqual({ list: "ur" });
    expect(findEmergency(["سانس نہیں آرہی"])).toEqual({ list: "ur" });
  });

  it("makes the Hindi nasal marks one", () => {
    expect(findEmergency(["साँस नहीं आ रही"])).toEqual({ list: "hi" });
    expect(findEmergency(["सांस नहीं आ रही"])).toEqual({ list: "hi" });
  });

  it("reads Bengali joined and apart, and Tagalog short and long", () => {
    expect(findEmergency(["আমি শ্বাস নিতে পারছিনা"])).toEqual({ list: "bn" });
    expect(findEmergency(["আমি শ্বাস নিতে পারছি না"])).toEqual({ list: "bn" });
    expect(findEmergency(["'di makahinga si nanay"])).toEqual({ list: "tl" });
    expect(findEmergency(["Hindi na humihinga!"])).toEqual({ list: "tl" });
  });

  it("reads Hindi and Urdu typed in Latin letters, where listed", () => {
    expect(findEmergency(["papa ko saans nahi aa rahi"])).toEqual({ list: "latin" });
  });

  it("misses what is not listed: said in the note, section 1", () => {
    for (const text of ["mesh 2ader atnaffas", "he isnt breathin", "cnt breathe", "🚑"]) {
      expect(findEmergency([text])).toBeUndefined();
    }
  });

  it("finds nothing in nothing", () => {
    expect(findEmergency([])).toBeUndefined();
    expect(findEmergency(["", "  "])).toBeUndefined();
  });
});
