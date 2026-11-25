// The words and signs by which a value is recognised in a reply: currency
// signs, codes, names and short forms; the words for "percent"; the
// markers of the half of the day; the months (M3 unit U9; design note
// docs/design/notes/m3-u9-output-checks.md, section 4.1).
//
// The agent wrote these lists. No speaker of Arabic, Urdu, Hindi, Bengali
// or Tagalog has read them (decisions, row 52). A form that is missing
// leaves a number with no kind, which the checks hold back unless the
// business's own data holds that number.

/** A currency sign, and the currencies it can mean. */
export const CURRENCY_SIGNS: Readonly<Record<string, readonly string[]>> = {
  $: ["USD", "AUD", "CAD", "SGD", "HKD", "NZD"],
  "€": ["EUR"],
  "£": ["GBP", "EGP", "LBP"],
  "¥": ["JPY", "CNY"],
  "₹": ["INR"],
  "₨": ["PKR", "INR", "LKR", "NPR"],
  "₱": ["PHP"],
  "৳": ["BDT"],
  "﷼": ["SAR", "QAR", "OMR", "YER", "IRR"],
  "₺": ["TRY"],
};

/**
 * The codes read as a currency when written in capitals beside a number.
 * Not every ISO 4217 code: several are also English words. The tenant's
 * own code is always read.
 */
export const CURRENCY_CODES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "AED",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "JOD",
  "EGP",
  "PKR",
  "INR",
  "BDT",
  "PHP",
  "LKR",
  "NPR",
  "IRR",
  "YER",
  "IQD",
  "MAD",
  "CAD",
  "AUD",
  "SGD",
  "JPY",
  "CNY",
];

const RIYAL = ["SAR", "QAR", "OMR", "YER", "IRR"];
const DIRHAM = ["AED", "MAD"];
const DINAR = ["KWD", "BHD", "JOD", "IQD"];
const RUPEE = ["PKR", "INR", "LKR", "NPR"];
const DOLLAR = ["USD", "AUD", "CAD", "SGD", "HKD", "NZD"];
const POUND = ["GBP", "EGP", "LBP"];

/** A currency's name, short form or plural, and the currencies it can mean. */
export const CURRENCY_NAMES: readonly (readonly [readonly string[], readonly string[]])[] = [
  // English, and Latin short forms used in the markets.
  [["riyal", "riyals", "rial", "rials", "sr", "s.r.", "sr."], RIYAL],
  [["dirham", "dirhams", "dhs", "dhs.", "dh"], DIRHAM],
  [["dinar", "dinars"], DINAR],
  [["rupee", "rupees", "rs", "rs."], RUPEE],
  [["dollar", "dollars", "bucks"], DOLLAR],
  [["pound", "pounds"], POUND],
  [["euro", "euros"], ["EUR"]],
  [["taka", "tk", "tk."], ["BDT"]],
  [["peso", "pesos", "piso"], ["PHP"]],
  // Arabic.
  [["ريال", "ريالات", "ر.س", "ر.س.", "ر.ق", "ر.ع"], RIYAL],
  [["درهم", "دراهم", "د.إ", "د.م"], DIRHAM],
  [["دينار", "دنانير", "د.ك", "د.ب", "د.ا"], DINAR],
  [["دولار", "دولارات"], DOLLAR],
  [["جنيه", "جنيهات"], POUND],
  [["يورو"], ["EUR"]],
  [["روبية", "روبيات"], RUPEE],
  // Urdu.
  [["روپے", "روپیہ", "روپئے", "روپیے"], RUPEE],
  [["ڈالر"], DOLLAR],
  // Hindi.
  [["रुपये", "रुपए", "रुपया", "रुपयों", "रु", "रु."], RUPEE],
  [["डॉलर"], DOLLAR],
  // Bengali.
  [["টাকা", "টা.", "টাকার"], ["BDT"]],
  [["রুপি"], RUPEE],
  [["ডলার"], DOLLAR],
];

/** The words for "percent". */
export const PERCENT_WORDS: readonly string[] = [
  "percent",
  "per cent",
  "per-cent",
  "pct",
  "بالمئة",
  "بالمائة",
  "في المئة",
  "في المائة",
  "فیصد",
  "فی صد",
  "प्रतिशत",
  "फीसदी",
  "फ़ीसदी",
  "শতাংশ",
  "porsiyento",
  "porsyento",
];

/** A marker written after a time: the half of the day it says. */
export const DAY_HALVES: readonly (readonly [readonly string[], "am" | "pm"])[] = [
  [["am", "a.m.", "a.m", "a. m.", "a. m"], "am"],
  [["pm", "p.m.", "p.m", "p. m.", "p. m"], "pm"],
  [["ص", "صباحا", "صباحاً"], "am"],
  [["م", "مساء", "مساءً", "ظهرا", "ظهراً", "عصرا", "عصراً", "ليلا", "ليلاً"], "pm"],
  [["ng umaga", "n.u."], "am"],
  [["ng hapon", "ng gabi", "n.h.", "n.g."], "pm"],
];

/**
 * A word for "o'clock" written after an hour in Urdu, Hindi and Bengali.
 * The half of the day is a word before it, when there is one.
 */
export const OCLOCK_WORDS: readonly string[] = ["بجے", "बजे", "টা", "টায়"];
export const DAY_PARTS: readonly (readonly [readonly string[], "am" | "pm"])[] = [
  [["صبح", "सुबह", "সকাল", "সকালে"], "am"],
  [["دوپہر", "شام", "رات", "दोपहर", "शाम", "रात", "দুপুর", "বিকাল", "বিকেল", "সন্ধ্যা", "রাত"], "pm"],
];

/** The months, 1 to 12: each one's names and short names. */
export const MONTHS: readonly (readonly string[])[] = [
  ["january", "jan", "jan.", "يناير", "كانون الثاني", "جنوری", "जनवरी", "জানুয়ারি", "জানুয়ারী", "enero"],
  [
    "february",
    "feb",
    "feb.",
    "فبراير",
    "شباط",
    "فروری",
    "फरवरी",
    "फ़रवरी",
    "ফেব্রুয়ারি",
    "ফেব্রুয়ারী",
    "pebrero",
  ],
  ["march", "mar", "mar.", "مارس", "آذار", "مارچ", "मार्च", "মার্চ", "marso"],
  ["april", "apr", "apr.", "أبريل", "ابريل", "نيسان", "اپریل", "अप्रैल", "এপ্রিল", "abril"],
  ["may", "مايو", "أيار", "ايار", "مئی", "मई", "মে", "mayo"],
  ["june", "jun", "jun.", "يونيو", "حزيران", "جون", "जून", "জুন", "hunyo"],
  ["july", "jul", "jul.", "يوليو", "تموز", "جولائی", "जुलाई", "জুলাই", "hulyo"],
  ["august", "aug", "aug.", "أغسطس", "اغسطس", "آب", "اگست", "अगस्त", "আগস্ট", "agosto"],
  [
    "september",
    "sep",
    "sep.",
    "sept",
    "sept.",
    "سبتمبر",
    "أيلول",
    "ايلول",
    "ستمبر",
    "सितंबर",
    "सितम्बर",
    "সেপ্টেম্বর",
    "setyembre",
  ],
  [
    "october",
    "oct",
    "oct.",
    "أكتوبر",
    "اكتوبر",
    "تشرين الأول",
    "تشرين الاول",
    "اکتوبر",
    "अक्टूबर",
    "অক্টোবর",
    "oktubre",
  ],
  [
    "november",
    "nov",
    "nov.",
    "نوفمبر",
    "تشرين الثاني",
    "نومبر",
    "नवंबर",
    "नवम्बर",
    "নভেম্বর",
    "nobyembre",
  ],
  [
    "december",
    "dec",
    "dec.",
    "ديسمبر",
    "كانون الأول",
    "كانون الاول",
    "دسمبر",
    "दिसंबर",
    "दिसम्बर",
    "ডিসেম্বর",
    "disyembre",
  ],
];

/**
 * The endings a web address is recognised by when its dot is written as a
 * word, in brackets, or with spaces around it. Without "in", "me" and
 * "co", which are also ordinary words.
 */
export const SPOKEN_ENDINGS: readonly string[] = [
  "com",
  "net",
  "org",
  "io",
  "info",
  "app",
  "shop",
  "store",
  "online",
  "site",
  "link",
  "xyz",
  "cc",
  "tv",
  "ly",
  "gg",
  "biz",
  "top",
  "live",
  "pro",
  "vip",
  "club",
  "sa",
  "ae",
  "pk",
  "bd",
  "ph",
];
/** Of those, the ones read after a plain dot with a space beside it: not words a sentence begins with. */
export const SPACED_ENDINGS: readonly string[] = [
  "com",
  "net",
  "org",
  "io",
  "xyz",
  "cc",
  "tv",
  "ly",
  "gg",
  "biz",
  "sa",
  "ae",
  "pk",
  "bd",
  "ph",
];

/**
 * A word after a number that makes it another number ("150 thousand"). A
 * number followed by one cannot be read.
 */
export const MULTIPLIERS: readonly string[] = [
  "k",
  "m",
  "bn",
  "hundred",
  "thousand",
  "million",
  "billion",
  "lakh",
  "lakhs",
  "lac",
  "crore",
  "crores",
  "dozen",
  "مئة",
  "مائة",
  "ألف",
  "الف",
  "آلاف",
  "مليون",
  "ملايين",
  "سو",
  "ہزار",
  "لاکھ",
  "کروڑ",
  "सौ",
  "हजार",
  "हज़ार",
  "लाख",
  "करोड़",
  "শ",
  "শত",
  "হাজার",
  "লাখ",
  "লক্ষ",
  "কোটি",
  "daan",
  "libo",
  "milyon",
];

/**
 * Words that say a number beside them is a time, in a form the scanner
 * does not read. A line with one and a number left over is held back.
 */
export const TIME_WORDS: readonly string[] = ["o'clock", "oclock", "o clock", "hrs"];
