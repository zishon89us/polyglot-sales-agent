// The emergency phrase list (order of checks, step 4a; guardrail policy,
// section 6; design note docs/design/notes/m3-u10a-emergency-unsupported.md,
// section 2). Code looks for these in what a customer wrote, before
// anything else is decided about the message.
//
// WRITTEN BY THE AGENT. No speaker of Arabic, Urdu, Hindi, Bengali or
// Tagalog has read these lists (decisions, row 53). A wording that is not
// here is not found, and a customer in danger then gets an ordinary reply.
//
// No common single word is a phrase: each is two words or more, or one
// word of eight characters or more. A test holds every phrase to that.

import { plainText } from "./reply-checks.ts";

/** The lists, by the language they were written for. `latin` is Hindi and Urdu as typed in Latin letters. */
export const EMERGENCY_PHRASES: Readonly<Record<string, readonly string[]>> = {
  en: [
    "not breathing",
    "cant breathe",
    "cannot breathe",
    "can not breathe",
    "cant breath",
    "cannot breath",
    "can not breath",
    "stopped breathing",
    "heart attack",
    "chest pain",
    "having a stroke",
    "having a seizure",
    "overdose",
    "overdosed",
    "unconscious",
    "passed out",
    "is choking",
    "am choking",
    "anaphylaxis",
    "anaphylactic",
    "severe allergic reaction",
    "severe bleeding",
    "bleeding heavily",
    "bleeding badly",
    "wont stop bleeding",
    "kill myself",
    "killing myself",
    "end my life",
    "suicidal",
    "commit suicide",
    "committing suicide",
    "call an ambulance",
    "need an ambulance",
  ],
  ar: [
    "لا يتنفس",
    "لا تتنفس",
    "لا أستطيع التنفس",
    "لا اقدر اتنفس",
    "ما اقدر اتنفس",
    "مش قادر اتنفس",
    "مش قادرة اتنفس",
    "توقف عن التنفس",
    "نوبة قلبية",
    "جلطة قلبية",
    "أزمة قلبية",
    "سكتة دماغية",
    "ألم في الصدر",
    "فاقد الوعي",
    "فاقدة الوعي",
    "فقد الوعي",
    "فقدت الوعي",
    "أغمي عليه",
    "أغمي عليها",
    "جرعة زائدة",
    "نزيف حاد",
    "نزيف شديد",
    "ينزف بشدة",
    "تنزف بشدة",
    "أريد الانتحار",
    "أفكر في الانتحار",
    "أقتل نفسي",
    "أنهي حياتي",
    "سيارة إسعاف",
    "اطلبوا الإسعاف",
  ],
  ur: [
    "سانس نہیں آ رہی",
    "سانس نہیں آرہی",
    "سانس نہیں آ رہا",
    "سانس نہیں لے رہا",
    "سانس نہیں لے رہی",
    "سانس نہیں لے پا رہا",
    "سانس نہیں لے پا رہی",
    "سانس رک گئی",
    "دل کا دورہ",
    "فالج کا حملہ",
    "سینے میں درد",
    "بے ہوش ہو گیا",
    "بے ہوش ہو گئی",
    "بے ہوش ہے",
    "بیہوش ہو گیا",
    "بیہوش ہو گئی",
    "بیہوش ہے",
    "بہت خون بہہ رہا",
    "خون نہیں رک رہا",
    "خودکشی کرنا",
    "خود کشی کرنا",
    "خودکشی کر لوں",
    "خود کشی کر لوں",
    "جان دے دوں",
    "ایمبولینس بھیجیں",
    "ایمبولینس چاہیے",
  ],
  hi: [
    "सांस नहीं आ रही",
    "सांस नहीं ले रहा",
    "सांस नहीं ले रही",
    "सांस नहीं ले पा रहा",
    "सांस नहीं ले पा रही",
    "सांस रुक गई",
    "दिल का दौरा",
    "हार्ट अटैक",
    "सीने में दर्द",
    "बेहोश हो गया",
    "बेहोश हो गई",
    "बेहोश है",
    "बहुत खून बह रहा",
    "खून नहीं रुक रहा",
    "आत्महत्या करना",
    "आत्महत्या कर लूं",
    "जान दे दूं",
    "एम्बुलेंस भेजो",
    "एम्बुलेंस चाहिए",
  ],
  bn: [
    "শ্বাস নিতে পারছি না",
    "শ্বাস নিতে পারছিনা",
    "শ্বাস নিতে পারছে না",
    "শ্বাস নিতে পারছেনা",
    "শ্বাস নিচ্ছে না",
    "নিঃশ্বাস নিতে পারছি না",
    "নিঃশ্বাস নিতে পারছে না",
    "নিঃশ্বাস নিচ্ছে না",
    "হার্ট অ্যাটাক",
    "বুকে ব্যথা",
    "অজ্ঞান হয়ে গেছে",
    "অজ্ঞান হয়ে গেছেন",
    "জ্ঞান হারিয়েছে",
    "অনেক রক্ত পড়ছে",
    "রক্ত বন্ধ হচ্ছে না",
    "আত্মহত্যা করব",
    "আত্মহত্যা করতে",
    "অ্যাম্বুলেন্স দরকার",
    "অ্যাম্বুলেন্স পাঠান",
  ],
  tl: [
    "hindi makahinga",
    "di makahinga",
    "hindi humihinga",
    "di humihinga",
    "hindi na humihinga",
    "di na humihinga",
    "hirap huminga",
    "nahihirapan huminga",
    "atake sa puso",
    "inatake sa puso",
    "masakit ang dibdib",
    "naninikip ang dibdib",
    "nawalan ng malay",
    "walang malay",
    "maraming dugo",
    "magpapakamatay",
    "magpakamatay",
    "gusto ko nang mamatay",
    "gusto ko ng mamatay",
    "tumawag ng ambulansya",
    "kailangan ng ambulansya",
  ],
  latin: [
    "saans nahi aa rahi",
    "saans nahin aa rahi",
    "sans nahi aa rahi",
    "saans nahi le raha",
    "saans nahi le rahi",
    "saans ruk gayi",
    "dil ka daura",
    "behosh ho gaya",
    "behosh ho gayi",
    "khudkushi karna",
    "ambulance bhejo",
    "ambulance chahiye",
  ],
};

const at = (codePoint: number): string => String.fromCodePoint(codePoint);

/** Letters written in more than one way, made one (the note, 2.2, step 3). */
const ONE_FORM = new Map<string, string>([
  // The forms of the Arabic alef.
  [at(0x622), at(0x627)],
  [at(0x623), at(0x627)],
  [at(0x625), at(0x627)],
  [at(0x671), at(0x627)],
  // Alef maksura and the Farsi yeh: the Arabic yeh.
  [at(0x649), at(0x64a)],
  [at(0x6cc), at(0x64a)],
  // Keheh: kaf.
  [at(0x6a9), at(0x643)],
  // Teh marbuta, its Urdu form and the Urdu he: the Arabic heh.
  [at(0x629), at(0x647)],
  [at(0x6c3), at(0x647)],
  [at(0x6c1), at(0x647)],
  // The Urdu noon without its dot: noon.
  [at(0x6ba), at(0x646)],
  // The Hindi nasal marks: one.
  [at(0x901), at(0x902)],
]);
/** Apostrophes of every form, and the Devanagari dot below: taken out. */
const TAKEN_OUT = new Set([0x27, 0x2019, 0x2018, 0x2bc, 0x60, 0xb4, 0x93c].map(at));
const NOT_A_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

/** A text or a phrase as it is compared (the note, 2.2). */
export function emergencyFolded(text: string): string {
  let out = "";
  for (const character of plainText(text).toLowerCase()) {
    if (!TAKEN_OUT.has(character)) {
      out += ONE_FORM.get(character) ?? character;
    }
  }
  return out.replace(NOT_A_WORD, " ").trim();
}

/** Before an Arabic or Urdu phrase the one-letter "and" may stand. */
const AND_BEFORE = `[${at(0x648)}${at(0x641)}]?`;
const FINDERS: readonly { readonly list: string; readonly finder: RegExp }[] = Object.entries(
  EMERGENCY_PHRASES,
).map(([list, phrases]) => ({
  list,
  finder: new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${list === "ar" || list === "ur" ? AND_BEFORE : ""}(?:${phrases
      .map(emergencyFolded)
      // The longest first: of two phrases that begin alike, the longer is tried first.
      .sort((one, other) => other.length - one.length)
      .join("|")})(?![\\p{L}\\p{M}])`,
    "u",
  ),
}));

/**
 * Whether what a customer wrote holds a phrase of the lists: the texts of
 * one batch, in the order they came, read as one text. Says which list,
 * never the text.
 */
export function findEmergency(texts: readonly string[]): { readonly list: string } | undefined {
  const folded = emergencyFolded(texts.join(" "));
  if (folded === "") {
    return undefined;
  }
  for (const { list, finder } of FINDERS) {
    if (finder.test(folded)) {
      return { list };
    }
  }
  return undefined;
}
