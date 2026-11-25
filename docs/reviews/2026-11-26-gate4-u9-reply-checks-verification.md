# Verification of the Gate 4 fixes: M3 U9, the checks on a reply

Checked: commit `9d87eb0` on `feat/308-m3-u9a-output-checks`, by an agent
that wrote neither the code nor the review, working in a copy of the
repository: it ran 1,112 inputs through the function. The report is
unedited, except that characters that cannot be seen are written as
`\uXXXX`; one of them, in V5, was a space of a kind the author
could not tell and is written as `\u00a0`. The author's response
follows it.

---

# Verification of the U9 reply-check fixes (commit 9d87eb0)

**Read:** `reply-checks.ts` and `markers.ts` in full, the review and response in full, note sections 3 to 9, and the review-fix tests (lines 760 to 954 of the test file). **Ran:** the test file (100 pass); 1,112 calls of `checkReply`: 90 for the R1–R15 re-run, 723 new attack inputs, 56 ordinary replies, 243 crash and timing inputs; 30 mutants. **Not checked:** the first 760 lines of the test file, the ten mutants the review listed as surviving, marker spelling by a speaker, pack checkers, and whether callers cap batch and claim lengths. `git status --short` is clean.

## R1–R15 re-run

Seven of the 90 inputs still pass. Three of them are ones the response calls fixed:

- **R8** `"costs 9.00"` + `opening-hours,1,"9:00"` → PASS. It also passes with no claim.
- **R8** `"haircut 17.00"` + `policy,p,"17:00"` → PASS. It also passes with no claim.
- **R11** the instructions with `\u0301` after the first letter of every sixth word → PASS.

The other four are declared unfixed: `"150 SAR or 45"`, `"closed on 9 de marzo"`, `"45 pc off"`, `"¼ of the price"`. Nothing throws.

## New findings

**V1 High. The multiplier check is a deny-list, so a wrong amount passes with a true claim.** All with claim `price,s,"150 SAR"` → PASS:
- `"150 thousands riyals"`, `"150 grand SAR"`, `"150 mn SAR"`, `"150 mil riyals"`, `"150 MM SAR"`
- `"150 الاف ريال"` ("thousands" without the madda), `"150 ألفاً ريال"`, `"150 مليار ريال"`
- `"150 SAR thousand"`, `"one thousand and 150 SAR"`, `"ألف و150 ريال"` (1,150)
- Change: allow only a listed word between number and currency name (country adjectives); any other word is unreadable. Fail a multiplier word directly before or after the amount.

**V2 High. R8 is not fixed for `H.00`, and the fix lets a dotted time pass with no claim.**
- `"costs 9.00"`, `"costs 9,00"`, `"haircut 17.00"`, `"it is 13.00"`, `"at 16.00"` → PASS with no claims: the number equals a stored hour.
- The R8 test uses `"costs 9.50"` in place of the review's `"costs 9.00"` and leaves out `"haircut 17.00"`.
- Change: a leftover number written with a decimal part may equal only a stored price or a stored number written that way, never an hour or minute.

**V3 High. `am`/`pm` is not in the "marker left on a line" rule, so a wrong time passes with no claim when the hour is stored.** All PASS with no claims:
- `"We open at *4* am"`, `"We open at 4  am"` (two spaces), `"We open at 4\nam"`, `"We open at 4 (am)"`, `"We open at 4-am"`
- `"open until 4-45 pm"`, `"open until 4 : 45 pm"`, `"open until 9 50 pm"`
- `"الساعة 4 صباحًا"` (the mark before the alef; the list holds only the other order), `"4 في المساء"`
- The commit message and the response say a marker "of a time" holds the reply back; the code and note 4.4 cover only "o'clock" words.
- Change: put day-half and day-part words in `strayWords`, allow `GAP` between hour and half, and strip marks before matching words.

**V4 Medium. Common inflections are missing, so the stray rule does not fire.** PASS with no claims (45 and 9 are stored numbers):
- `"45 ريالاً"` and `"45 ريالا"` (the form Arabic grammar requires after 11 to 99), `"45 الريال"`, `"45 رِيال"`, `"45 ر س"`
- `"45 S.R"`, `"45 SARs"`, `"45 ryal"`, `"45 CHF"`, `"45 TRY"`, `"45 HKD"`
- `"45 percents"`, `"45 بالمية"`, `"45 ‰"`
- `"9 Ramadan"`, `"9 رمضان"` (no Hijri months in the data), `"closed 9 لمارس"`
- Change: match currency and month stems with Arabic prefixes and endings; treat any three capitals beside a number as a code; add Hijri months.

**V5 Medium. R11 with a combining mark still passes.** `plainText` applies NFKC first, which composes letter and mark (`s\u0301` becomes `ś`), so the mark is never stripped. The test passes only because 17 words in a row stay unchanged in its text. Change: NFKD before removing marks.
- Low, same check: `_`, `*`, `‘`, `ʼ`, `·` or `\u00a0` inside every sixth word → PASS.

**V6 Medium. Time grows with the square of text length, and the customer controls one input.** `scanValues` refolds and rebuilds the whole text on every match.
- One batch text of 8,000 characters (`BATCH_TEXT_MAX`) of `"1$1%"` repeated: 2,902 ms.
- A profile at its own limits (100 descriptions of 2,000, 30 bodies of 4,000, all distinct) of `"9 am "` repeated: 11,308 ms; of price-list lines: 2,768 ms.
- Change: fold once and patch in place; test the left marker on a bounded slice.

**V7 Medium. An address broken by a tab, a line break or an unseen character passes.** PASS with no claims: `"evil.\ncom"`, `"pay at evil\n.com/pay"`, `"evil.\tcom"`, `"evil.\u0001com"`, `"evil\u007f.com"`, `"evil.\u2800com"`, `"evil.\ufffccom"`, `"evil.\ue0fecom"` (the code's own blank character). Change: use `\s` in the spaced-dot pattern; remove or fail on controls, private-use characters, `\u2800` and `\ufffc`.

**V8 Low. Both per-line rules are dodged by a line break.**
- `"Price: 45\nCurrency: SAR"`, `"The price is 45 in\nSAR"`, `"Haircut: 50\n(all prices in SAR)"`, `"closed on the 9\nof March"` → PASS.
- `"call 0 then 50 then\n150 then 45\nthen 10 then 17"` → PASS (R15, called fixed).
- Change: apply both rules over neighbouring lines too.

**V9 Low. `"open until 9 o’clock"` → PASS**; so do `"9 o-clock"`, `"at 9 hours"`, `"at 9 h"`. Change: fold `’` to `'`; add "hours", "hr", "h".

**V10 Low. Handles.** `"a@b"`, `"pay x@y"`, `"evil @ okaxis"`, `"evil@ okaxis"`, `"evil(at)bank"` → PASS. The response says "any name, `@` and a word".

**V11 Low. The exception still carries price-like text.** PASS: `"costs 9:50"` / batch `"9:50?"`; `"The price is 17:00"` / batch `"17:00"`; `"on 12 March 2000/-"` / batch `"12 March 2000"`; `"12/3/2027 SAR"` / batch `"12/3/2027"`.

**V12 Low. The stored phone number passes in any grouping:** `"Prices: 966 / 555 / 550 / 100"` → PASS.

**V13 Note. Statements the code does not match.**
- "Each has a test with the review's own inputs": not for R8 (V2).
- Note section 6 still opens "after every value O3 detected has been replaced"; 4.6 and the code say before.
- Note section 3 says "the `12` of `A12` is a number"; `"A12"` → `value-unreadable`.
- Note 4.1 still says "at most one space" for amounts and percentages; the code allows three characters.

## Ordinary replies

11 of 56 blocked (40 English, 16 Arabic, correct claims).
- 5: a count or number the data lacks ("2 stylists", "12 King Road", "24 hours", "5-minute walk", 3 stylists in Arabic). Declared.
- 1: `"The total for 2 haircuts would be 300 SAR."` By design.
- 2: ordinals, from the new glued-letter rule (`"your 1st visit"`, `"2nd floor"`).
- 1: `"Our prices in SAR:\n1. Haircut: 150"` + P → `amount-unclaimed`. The gap's line break joins the heading's "SAR" to the list number.
- 1: Arabic `"%10"` + the 10% claim → `value-unreadable` (sign before the number).
- 1: Arabic "5 م" (metres). Declared.

Also blocked in the attack set: `"polka dot top"`, `"Dr.Ahmed will see you"`, `"1.Haircut\n2.Colour"`, `"see you @5pm"`, `"Follow @Salon Noor"`.

## Crashes and time

No throw in 243 inputs: names and currency codes of regex metacharacters, lone surrogates, empty and 5,000-character names, odd decimals, malformed hours. Slowest 1,200-character reply: 63.5 ms (`"1$"` repeated). 50 policies of 2,000 characters with 30 claims: 353 ms. The times above those bounds are in V6.

## Mutants (30 run; 21 killed, 9 survived)

| Survived | Mutant |
| --- | --- |
| M3d | "may" not left out of the stray months |
| M4b | seven digits counted over the whole reply, not per line |
| M5b | letter glued before a leftover number not checked |
| M5c | letter glued to the number inside an amount not checked |
| M7b | one numbered line counts as a list |
| M11b | a claim's value may hold a stray |
| M11e | price claim: an amount plus a leftover number allowed |
| M12 | memo never written (the 500 ms test still passes) |
| M13 | `GAP` of one character, not three |

Killed: values before contacts; `bare` flag; stray rule off, its currency half off, its word half off; seven-digit rule off; glued letter (leftover) off; strict grouping off; leading-zero group; list without sequence; multiplier in an amount; multiplier after a leftover number; `H.MM` without marker; any scheme stripped; `made.contacts`; `made.numbers` in `allIn` and in opening hours; memo keyed on a constant; `name@word` not read; tenant code in capitals only; "o'clock" as either half.

## Could not break

- A stored link swallowing a value: query, fragment, digits after the path, userinfo and port all fail.
- `"200@SAR"`, `"200SAR@x"`; `"@ 5 pm"` and `"see you @ the salon"` are not blocked.
- The gap joining a claimed marker to a wrong unknown number (`"150 SAR - 200"`, `"200\n\nSAR 150"`, `"45: SAR 150"`).
- The list rule with unknown numbers: restarts, mixed `)` and `.`, leading tabs, twelve items, a skipped number.
- Grouping: `"1,500.00"`, `"1.500,00"`, `"1 500,00"`, `"1’500"`, `"1٬500"`, `"150.000"`, `"150.0000"`, `"150.00.00"` never read as 150.
- IBANs with spaces or hyphens, lower case; keycap, circled, superscript and mathematical digits.
- Canary with spacing, case, a mark, or a line break.

---

## Author's response

**These last fixes are checked by the author only.** Two rounds by two
agents each found wrong values that passed, and no third round was run.
What is left is #336.

Both rounds found the same thing: a number the business had stored
somewhere (an hour, a price, "45" from "45 minutes") passed beside any
word that no list knew ("45 ryal", "9.00", "4 (am)"), and every list
has an end. The rule is therefore changed and not the lists:

**A number that is no detected value passes only together with the
word that follows it in the business's own text.** "45 minutes" passes
because the description says "45 minutes"; "45" before any other word,
or alone, does not. A price or an hour never passes as a bare number.

That closes V2, V3, V4, V8 and V9 without naming their forms, and what
V1 found is closed the same way: between a number and a currency's name
only a country's word may stand.

**What it costs.** A duration or a count said in other words than the
business's text is held back: "Please arrive 10 minutes early" when no
text says "10 minutes", and **"45" followed by the Arabic word for
minutes when the business's text is in English.** A reply in a language
other than the one the business wrote its texts in cannot state such a
number. Of twenty ordinary replies the author tried, four were held
back, all for this reason. Row 52 of the decisions page puts this to
the maintainer.

| Finding | Answer |
|---|---|
| V1 (High) | Fixed: only a country's word (a list) may stand between a number and a currency's name; any other word makes the amount unreadable. A word that multiplies, anywhere on a line that holds a number, holds the reply back. A letter glued before the number of an amount cannot be read |
| V2 (High) | Fixed by the changed rule: "9.00" is a number with no stored word after it. The review's own inputs are now the test's |
| V3 (High) | Fixed: up to three characters may stand between an hour and its marker; the marks over Arabic letters are removed before a word is matched; the words for the half and the part of the day are among the markers that hold a line back; and by the changed rule an hour with no marker is not a number that passes |
| V4 | Fixed by the changed rule, for every input given: none of these numbers is followed by its stored word. The lists are not extended: Hijri months, more currency codes and inflected forms are still not *detected*, which now changes only the code a reply fails under |
| V5 | Fixed: marks are removed after the form that separates them from their letters, and the signs of emphasis and joining are taken out of words |
| V6 | Fixed: the text is folded once, and a marker is looked for within 48 characters of its number. The two inputs given now take under two seconds together in the test; **the bound is the test's, measured on one machine** |
| V7 | Fixed: controls, private-use characters and two blank characters are removed before anything is read; a dot may have any white space beside it |
| V8 | Fixed by the changed rule for the inputs given. A marker on another line than its number is still not joined to it |
| V9 | Fixed for the inputs given |
| V10 | A name of one character at a provider is read. An `@` with spaces round it, and "(at)", are not: reading them would hold back "see you @ the salon". In #336 |
| V11 | Not changed: a time or a date the customer wrote passes whatever sentence it stands in. The guardrail policy accepts this gap. In #336 |
| V12 | Not changed: it is the business's own number |
| V13 | The note is corrected in the three places |
| Ordinary replies | The percent sign before its number is read; a line break no longer joins a heading's currency to a list's number. Ordinals and counts are still held back |
| Mutants | Cases added for seven of the nine. Not for "may" left out of the stray months, and not for the memo, which only saves time |
