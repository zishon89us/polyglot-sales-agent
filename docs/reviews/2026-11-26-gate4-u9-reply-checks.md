# Gate 4 review: M3 U9, the checks on a reply

Reviewed: commit `3f87570` on `feat/308-m3-u9a-output-checks`, by an
agent that did not write the code, working in a copy of the repository:
it read the code and ran 426 replies through the function. The report is
unedited, except that characters that cannot be seen are written as
`\uXXXX`. The author's response follows it.

---

# Gate 4 review: `checkReply` (M3 U9, first part)

**Verdict: not ready.** One crash on ordinary business names and seven ways a wrong value or foreign link/payment handle passes.

**Read:** `reply-checks.ts` and `markers.ts` in full, the design note in full. **Ran:** the test file (84 pass); 426 replies through `checkReply` in 5 batches; 20 timing inputs; 34 mutants. **Not checked:** the test file line by line, the design-review document, each V/L row by hand (I relied on the passing tests), marker spelling in the five languages. `git status --short` is clean.

Default profile in every example: the note's 4.5 profile, with "Book at salon.example/book" added to policy P. `P` = claim `price, s, "150 SAR"`.

## Findings

**R1 High (crash). A business name with a hyphen throws.** `reply-checks.ts:170` escapes `-`, and `\-` is invalid outside a class under the `u` flag (`:649`).
- Name `"Al-Noor Salon"`, reply `"hello"` → `SyntaxError: Invalid regular expression … Invalid escape`.
- Same for `"Noor - Beauty"` and `"Al–Noor"` (dashes are normalised to `-` first), and for a currency code containing `-` (`:398`).
- Fix: escape only `.*+?^${}()|[]\`; add a test with a name made of every ASCII punctuation character.

**R2 High. A value taken by O3 hides a link from O5.** Values are blanked before contacts are scanned (`:657-658`). The blank breaks the domain, and the rest is refused by the lookbehind at `:605` and by `SOLID` at `:597`.
- `"https://150SAR.evil.com/pay"` + P → PASS
- `"Pay at 150SAR.evil.example"` + P → PASS
- `"evil.150SAR.com"` + P → PASS
- `"9am.evil.com/pay"` + claim `opening-hours, 1, "9 am"` → PASS
- `"pay.5pm.co"`, batch `"5pm?"`, no claims → PASS
- Fix: scan contacts on the plain text before values are blanked; blank values only for the leftover-number step.

**R3 High. Foreign links that are not detected** (`:531`, `:605`). All PASS with no claims:
- `"pay here...evil.com/pay"` and `"pay here…evil.com/pay"`
- `"Pay here: .evil.com"`, `"..evil.com"`
- `"visit evil.com- now"`, `"evil.com—great"` (the lookahead after the ending refuses `-`, so the whole match is dropped)
- `"evil.xn--p1ai"` (punycode ending)
- Also `"evil . com"`, `"evil .com"`, `"evil[.]com"`, `"evil dot cc"`, `"evil  dot  com"`, `"evil。com"`.
- Fix: drop `.` and `-` from the lookbehind; on a failed lookahead, still report the match; accept `xn--` endings.

**R4 High. A payment handle of the `name@provider` shape (UPI) passes.** It is not an email (no dot) and not a handle (lookbehind at `:618`).
- `"pay to salonpay@okaxis"` → PASS; `"UPI: evil@ybl"` → PASS; `"send to evil@paytm please"` → PASS.
- Fix: any `local@word` is a contact that must be stored.

**R5 High. The list-marker rule hides a price or a phone number** (`:634`): any 1 to 3 digits at a line start before `. ` or `) `.
- `"200. Would you like to book?"` → PASS
- `"Prices:\n200) riyals for the haircut"` → PASS
- `"1. Haircut\n250. Colour"` → PASS
- `"Call:\n055. then\n555. then\n010. then\n0. done"` → PASS
- Also after `\t`, `\r`, `\u2028`.
- Fix: exempt only a run 1, 2, 3… on consecutive lines, two or more items.

**R6 High. A multiplier after the number is not read.**
- No claims: `"150k SAR"`, `"150K"`, `"150 thousand SAR"`, `"150 million"` → PASS (150 is a known number).
- With P: `"150 thousand riyals"`, `"150k riyals"`, `"150 hundred riyals"`, `"150 ألف ريال"` → PASS, through the one-word allowance at `:406`.
- Note §9 admits only "Qatari riyal".
- Fix: a number with a letter glued to it, or followed by a multiplier word in any supported language, is unreadable.

**R7 High. `scaledNumber` accepts grouping no reader would** (`:228`).
- `"only 0.150 SAR"` + P → PASS (read as 150.00); `"0,150 SAR"` + P → PASS; `"1.50,00 SAR"` + P → PASS.
- `"it costs 0.150"`, no claims → PASS.
- `"0.010% off"` + `service-detail, s, "10%"` → PASS.
- Claim `price, s, "0.150"` passes too.
- Fix: grouping is valid only as 1 to 3 digits with no leading zero, then groups of exactly three; anything else is unreadable.

**R8 High. A price or discount shaped like a time or date passes by the exception or a time claim.** The note says amounts and percentages never pass by the exception.
- `"Yes, 9.50"`, batch `"is the trim 9.50?"` → PASS
- `"Yes, 20.00."`, batch `"is it 20.00?"` → PASS
- `"Yes, 2.50 sar"`, batch `"2.50?"` → PASS
- `"Yes, 1/2 price for students!"`, batch `"do students get 1/2 price?"` → PASS
- `"costs 9.00"` + `opening-hours, 1, "9:00"` → PASS; `"haircut 17.00"` + `policy, p, "17:00"` → PASS
- Fix: `H.MM` with no day-half marker must also pass as a number; `D/M` with no year should not pass by the exception.

**R9 Medium. A real currency marker the scanner misses falls through to the known-number rule.** No claims, all PASS:
- `"The haircut costs 45 sar"`, `"The haircut costs 9 Sar"`, `"45  SAR"`, `"*45* SAR"` (WhatsApp bold), `"45\nSAR"`, `"45-SAR"`, `"SAR: 45"`, `"45 (SAR)"`, `"10 bucks"`.
- With P: `"150 SAR or 45"` → PASS.
- §9 admits only a bare "150".
- Fix: read the tenant's own code in any case; allow `* _ ( ) :` and white-space runs between number and marker.

**R10 Medium. Dates, times and percentages one step off the patterns pass when the number is known.** No claims, all PASS:
- `"closed on March the 9th"`, `"closed on March, 9"`, `"closed March  9"`, `"closed 9-March"`, `"closed on 9 de marzo"`. Note 4.1 says a comma is allowed between; `:380`/`:387` allow it only before the year.
- `"open until 9 o'clock"`, `"open till 9 p. m."`, `"open at 16h"`.
- `"45 per-cent off"`, `"45 pc off"`, `"¼ of the price"`.
- Fix: a leftover number in the same clause as a month name, percent word or day-half word fails.

**R11 Medium. O6's 12-word rule is defeated by one unseen character** (`wordsOf`, `:680`, does not use section 3's cleaning).
- 40-word instructions; the reply is the same text with `\u200b` inside every sixth word → PASS. Same with `\u00ad`, `\u0301`, `'`, `-`.
- Fix: strip default-ignorables and marks, and join across `'` and `-`, before cutting words.

**R12 Low. Claim values are read more loosely than 4.3 says.**
- `opening-hours, 1, "9:00 evil.com 77"` passes ("nothing else that is detected").
- `price, s, "150 SAR evil.com"` and `price, s, "150 thousand riyals"` pass.

**R13 Low. The scheme is ignored in comparison.** `"evil.com://salon.example/book"` and `"javascript://salon.example/book"` → PASS. Fix: accept only http/https or none.

**R14 Low. O7.** `"\u0001\u0002"`, `"\u2800"` and `"\u0301"` alone pass as non-empty.

**R15 Low. L7's reasoning does not hold in general.** `"call 0 then 50 then 150 then 45 then 10"` → PASS: every chunk is a known number.

**R16 Note. Code vs note.**
- The name is blanked case-insensitively; the note says "exact".
- The list rule's 1 to 3 digits and leading blanks are not in the note.
- A code is not "the first thing found": claims, then values, then numbers. `"3 stylists and 200 SAR"` → `amount-unclaimed`. This changes counts only.
- A Hindi part-of-day word after the hour is ignored: `"5 बजे सुबह"` (5 in the morning) + `policy, p, "17:00"` → PASS.
- Stored texts are re-read for every claim (`:724`): 20 claims with about 8,000 characters of policy text took 203 ms. Cap the number of claims.
- `numbersIn` puts `NaN` in the known set for a stored number of about 12 or more digits, and `NaN` then matches `NaN`. I could not exploit it because O5 catches such numbers.

**R17 Note. `markers.ts`.**
- `may`: `"option 2 may suit you"` and `"you may 5 times"` → `date-unclaimed`.
- `টা` is also the ordinary Bengali counting suffix; read as "either half", `"9টা"` + `opening-hours, 1, "9 pm"` → PASS.
- Arabic single letters `م` and `ص` block "5 metres" (admitted in §8).
- `pound(s)` blocks weights: `"lose 5 pounds"` → `amount-unclaimed`.
- Endings `in`, `me`, `co`: `"the red dot in the map"` → `link`. L12 passes only because it says "on".
- Missing: lower-case codes, `k`, "thousand", "o'clock", `16h`.

## Mutants (34 run; 24 killed, 10 survived)

| Survived | Mutant |
| --- | --- |
| M4b | minutes of opening hours not added to known numbers |
| M8 | IBAN check digits not tested (`return true`) |
| M9 | dash normalisation removed |
| M11 | marks after digits kept |
| M13 | weekday item compared by `Number()` (so `"01"`, `" 1"`, `"1.0"` would pass) |
| M14 | list marker 1 to 9 digits |
| M20 | "year is an amount" rule off |
| M21 | contact kind not compared |
| M22 | tatweel kept |
| M32 | lookahead after a trailing code dropped |

Killed: name-blanking guard; `equal` ignoring `tenant`; exception for any kind; 12-hour and 24-hour hours as known; failing claim skipped; 12→13; 7→8; ignorables kept; price claim any amount; `every`→`some` for two markers; 3-decimal rule; leftover numbers unchecked; path lower-cased; canary in claims; Persian yeh; o'clock one half; `>`→`>=`; extra decimals; opening-hours non-time; unreadable value; name not blanked; `nextDate` past; support contact dropped.

## Could not break

- Digits of other scripts, mathematical digits, superscripts, circled digits, combining marks, RTL marks and no-break spaces inside an amount: all read or blocked correctly.
- `150,000` / `150.000` / `150 000 SAR`; ranges; `"150 or 200 SAR"`; two different markers; `$150`; null currency; 0 and 3 decimals (apart from the admitted `1,500 KWD`).
- Weekday items `"01"`, `" 1"`, `"1.0"`; `24:00`; `17:30 am`; `31/11`; `29/2`; year 9999; year 0000.
- Userinfo links, look-alike hosts, `..`, query and fragment on a stored link; IP addresses; `hxxp`; phone numbers as sub- or super-strings of the stored one; lower-case or wrong-check IBANs and crypto addresses (caught as numbers).
- Canary with spacing, case and zero-width characters.
- Lone surrogates, empty name, one-letter name, empty profile.
- No hang: the worst 1,200-character reply took 39.5 ms.

---

## Author's response

All eight High findings are accepted and fixed, and each has a test with
the review's own inputs. **These fixes are checked by a second agent in
`2026-11-26-gate4-u9-reply-checks-verification.md`.**

Seven of the eight are one kind: a form of writing a value or an address
that a pattern did not know. Fixing them one by one does not end. Three
rules were added that do not depend on a list of forms: a number with a
letter glued to it, or with a grouping that is no grouping, cannot be
read; a line that still holds a marker of a currency, a percentage, a
month or a time beside a number left over is held back; and seven digits
on one line, in whatever pieces, are a long number.

| Finding | Answer |
|---|---|
| R1 (High) | Fixed: a hyphen is not escaped. A test builds the pattern from a name of every ASCII punctuation mark |
| R2 (High) | Fixed: addresses, handles and bank accounts are looked for first, on the whole text; values after; long numbers last |
| R3 (High) | Fixed for every input the review gives: an address may follow a dot and be followed by a dash; coded endings are read; a dot in brackets, as a word, or with a space beside it is read before a list of endings. A sentence's end is not an address ("store. Online"), since the list for a plain dot with a space leaves out endings that begin sentences |
| R4 (High) | Fixed: any name, `@` and a word is a contact that must be stored |
| R5 (High) | Fixed: only lines numbered 1, 2, 3 and on, in order, two or more, are a list. Every way a line ends is read as one |
| R6 (High) | Fixed: a letter glued to a number, or a multiplier word after it, makes it unreadable, in an amount, in a claim and in a number left over. The multiplier words are a list in six languages, the agent's |
| R7 (High) | Fixed: groups are 1 to 3 digits with no leading zero and then exactly three each; anything else cannot be read |
| R8 (High) | Fixed: `H.MM` is a time only with a marker of the half of the day, and otherwise a number; two numbers and a slash with no year never pass by the exception. This departs from the guardrail policy, which lists `17.30` as a time; said in the note |
| R9 | Fixed: the tenant's own code is read in any case; up to three characters of space, emphasis or brackets may stand between a number and its marker; and a marker left on a line with a number is held back. "150 SAR or 45" still passes: 45 is a number the business stored, the gap the note admits |
| R10 | Fixed for the forms given, and by the rule of the marker left on a line. "9 de marzo" is Spanish, which is not a supported language: not detected. "45 pc" and a fraction sign are not detected |
| R11 | Fixed: words are cut after what is unseen, marks, apostrophes and hyphens are taken out |
| R12 | Fixed: a claim's value holds its values and nothing else that is checked |
| R13 | Fixed: only `http` and `https` are left out when an address is compared |
| R14 | Fixed |
| R15 | Fixed by the seven-digit rule |
| R16 | The note now says the name is matched without regard to case, describes the list rule, and gives the order of the codes. A part of the day after the hour is read; an hour with no part of the day cannot be read, in place of "either half". Stored texts are read once for a call. A stored number that cannot be read is left out of the known numbers |
| R17 | `in`, `me` and `co` are no longer endings. `may` stays a month and is left out of the marker-left-on-a-line rule; "you may 5 times" is still held back. `pounds` as a weight is still held back. The Bengali suffix: an hour with it and no part of the day now cannot be read |
| Mutants | Each of the ten that survived has a case now, except "contact kind not compared", whose case is in the test and passes under the mutant too: two contacts of different kinds do not have the same compared form in any input found |
