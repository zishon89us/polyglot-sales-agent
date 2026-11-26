# Design review: M3 U9, the checks on a reply

Reviewed: `docs/design/notes/m3-u9-output-checks.md` as first written
(commit `docs(design): the checks on a reply` on
`feat/308-m3-u9a-output-checks`), before any code, by a second agent that
did not write it, working read-only in a copy of the repository. The
report is unedited, except that in D7 four characters that cannot be seen
are written as `\uXXXX`. The author's response follows it.

---

## Scope

Read: the note in full; guardrail policy section 4 (lines 85-255) and section 9; US-C4 and US-C15 criterion 10; plan row U9 and section "U9"; `packages/core/src/model.ts`; the claims checks in `packages/ai/src/output.ts`; `packages/core/src/profile.ts` (shape, validators, `priceText`); `businessData` in `apps/worker/src/turn.ts`; `prompts/reply/1/prompt.md`; decisions row 52. Ran one `node -e` for Unicode facts (Node's Unicode 17). Not checked: the bodies of findings #207/#208/#213, ADR 0007/0012/0014, the eval plan, and the marker-list file (it does not exist yet). Every finding is from reading the rules literally; nothing was executed against code.

## Findings

**D1. High. Sections 3 and 4.1. NFKC destroys two currency symbols before they are looked for.**
Step 1 runs before detection. Checked: ₨ (rupee sign) becomes the letters `Rs`, and ﷼ (rial sign) becomes the Persian word ریال, spelt with ی rather than the Arabic ي. Neither result is class Sc.
- Example: a PKR tenant, stored price 1500. The reply "₨ 500" has no marker left unless the list holds `Rs`. Nothing is detected, so O3 passes with no claim.
- Change: detect Sc on the original text, or map those symbols first. Fold ی/ي and strip tatweel ـ before matching words.

**D2. High. Section 4.1. The usual written forms of currencies are not markers.**
The amount rule needs a symbol, an ISO code or a name directly beside the number.
- Examples that pass unchecked with a wrong price: "200 Saudi riyals" (a word stands between), "Rs. 500", "SR 200", "200 ر.س", "500/-", "Dhs 200".
- These are the dominant forms in the target markets, so this is not the edge case section 9's "a missing word" implies.
- Change: require abbreviations, plurals and adjective-plus-name forms in the data file. Allow a demonym between number and name.

**D3. High. Section 4.3, last paragraph, and V28. A failing claim is ignored, which drops US-C4 criterion 10.**
Criterion 10 says "any claim or value does not pass". The note silently narrows it to values.
- Example: reply "It costs 200 Saudi riyals", claim `price, S, "200 SAR"`, stored price 150. Nothing is detected in the reply; the claim fails; the reply is sent.
- The claims are a second, free detection channel for exactly the values that D2 and section 9 miss.
- Change: fail the reply when any claim fails, including a claim with zero or several detected values. If V28 is kept, record it as a deviation in the decisions file.

**D4. High. Section 4.2 against V29. The space separator makes the case table wrong and lets a wrong reading pass.**
By the rule, the last separator is the decimal point when 1 or 2 digits follow.
- "1 5 0 SAR" is therefore 15.0, not 150. V29's "passes" does not follow.
- "1 50 SAR" is 1.50. With a stored price of 2.50, "2 50 SAR each" passes and reads as 50.
- With a stored price of 2150, "for 2 150 SAR" passes and reads as 150. The same happens for a percentage.
- The 4.2 sentence listing `1,50` beside `150` is unintelligible: `1,50` is 1.50.
- Change: a space or `'` is grouping only, and only before groups of exactly three digits. Otherwise the number starts after the space. Delete or rewrite V29.

**D5. High. Sections 4.1 and 9. Ranges make "bare number" a wrong price or time beside a checked one.**
- "100-150 SAR" with claim 150: the 100 is unchecked.
- "open 3 to 9 pm" with an opening-hours claim for "9 pm", stored 16:00 to 21:00: the 3 is unchecked.
- "9-5" and "10 - 9 pm" behave the same way. This is how hours are normally written.
- Section 9 admits a bare number in general. I argue the admission is not acceptable for a number joined to a detected value by a dash, "to", "or" or "/".
- Change: treat such a number as a value of the same kind and marker.
- Also: `24:00` in a reply is undetected, so "until 24:00" passes when the stored closing is 22:00. Detect it as 00:00.

**D6. Medium. Section 4.1, dates. Ordinals are unspecified and there is no boundary rule.**
- "March 12th", "12th of March", "Dec 12" and "March 12, 2027" are unspecified. If undetected, a wrong date passes.
- With no digit boundary, "Building 12/3", "1/2 price", "10/10", "3.2.1" and "you may 5 ..." are unclaimed dates and are blocked.
- "5 May 50 SAR" reads 50 as a year and hides the amount.
- Change: add ordinal and "of" forms, digit boundaries, and a rule that a number followed by a currency marker is not a year. List fractions and addresses in section 9.

**D7. Medium. Section 6, long number. Dash variants split a number.**
Checked: NFKC maps ‑ to ‐ and leaves – and − alone. None is in the separator list.
- "055–555–0100" is not detected. Nor is a number split by `,` `:` `*` `_` or ·. Newlines are unspecified.
- This goes beyond the admitted "words stand between".
- Change: allow any run of non-letter characters between digits.
- Section 3 step 4 is an enumerated list. Use the Default_Ignorable property plus Mn/Me: \u034f and \ufe0f are Mn, \u115f and \u3164 are letters, and "1\u0308" survives.

**D8. Medium. Section 6, bank account. The shape matches ordinary sentences, or nothing, depending on the reading.**
With "spaces allowed between groups" and case ignored, "at 10 minutes before your appointment" and "is 45 minutes long" fit two letters, two digits and 11 or more letters.
- Change: require the start of a token, capitals, country-specific length and the mod-97 check.

**D9. Medium. Section 6. "Taken out" is undefined.**
Deletion can join the digits on either side; a space keeps a run alive. Replace each stretch with a character that breaks every pattern.
- Address detection never says where an address ends, yet L1 and L2 depend on the path.
- Lower-casing paths makes different links equal.
- "letters" is undefined. ASCII only lets IDN domains through; Unicode blocks Arabic text with a missing space.
- "red dot on the map" is an address under the "dot" rule.

**D10. Medium. Section 5. A pack can pass an amount or a percentage with any item.**
The policy says a percentage claim "must name one policy or one service, and passes only against that item's text". The hook hands a pack's checker any detected kind.
- Change: the core refuses percentages for pack kinds, or the note states the deviation.
- The checker sees one claim. The policy's rule that a calendar-date claim may not sit beside a slot claim therefore cannot be enforced by it; nobody owns that.
- Unspecified: a checker that throws or is async, and two packs registering one kind.

**D11. Medium. Section 4.3. One claim, one value will block correct hours.**
The natural claim value "09:00 to 13:00" covers nothing, so the reply is blocked, against US-C4 criterion 7.
- A week of split hours is 28 times plus prices, over `CLAIMS_MAX` of 30.
- Change: a claim covers every detected value in it if all pass against its item.
- The exception blocks "at 5 pm" when the customer wrote "at 5" or "5:30". Add to section 9.

**D12. Low. V26.** By 4.2, "150.005 SAR" is grouping, so 150,005.00 and code `amount-unclaimed`, not "cannot be read". The zeros rule can only fire for zero-decimal currencies.

**D13. Low. Sections 4.3 and 6. The business's name is no stored source.** `businessData` gives the model `name`. A name such as "Studio 24" is fine, but "Glow.studio" fails O5 and "5 pm Café" fails O3 on every mention.

**D14. Low. Section 4.1. Ambiguities two programmers would build differently.**
- Whether a single-letter Arabic marker needs a word boundary: "5 مرات" (5 times).
- The spacing rule for percent and time markers.
- A number between two markers ("USD 150 SAR").
- "Qatari riyal" and "A$150" pass as the tenant's currency.
- ISO codes in capitals: "TOP 10" is blocked.

**D15. Note. Section 2.**
- Short-circuiting costs E12 its per-check numbers. Run all four and report the first.
- Policy O2 discards a flagged reply before O3. The second part must not count a fallback for one.
- "As the model was given it" is not US-C4 criterion 3's "current stored price". Say so.
- Purity depends on the runtime's Unicode tables; pin them in a test.

## Could not fault

- V1-V25, V27, V30 and L1-L9 follow from the rules, given D9 for L1/L2.
- O5 runs only after O3 passed, so "detected" and "passed" coincide; a phone number cannot ride through as an amount.
- The customer-batch exception matches the policy's accepted gap.
- The canary check: flags and `language` are validated enums; tool arguments are out of M3.
- The codes carry no content.
- `24:00` as a claim against a stored closing.

---

## Author's response

All five High findings are accepted. The note is rewritten, and **the
rewrite has not been reviewed again**; the review of the code reads it.

The findings have one root: a value was checked only if a list of
markers recognised it, so every form the list missed was a wrong value
that passed. The rewrite adds a rule that does not depend on a list:
**every number in a reply must be accounted for** (the note, 4.4). It
goes beyond the guardrail policy, which leaves a bare number unchecked,
and it will hold back more right replies. That trade is row 52 of the
decisions page.

| Finding | Answer |
|---|---|
| D1 (High) | Accepted: currency symbols are found before the compatibility form is applied; Persian and Arabic forms of two letters are folded and the tatweel removed before words are matched |
| D2 (High) | Accepted: the marker data holds abbreviations and plurals, and one word may stand between a number and a currency's name. A form the data still misses leaves a bare number, which the new rule of 4.4 does not let pass unless the business's own data holds that number |
| D3 (High) | Accepted: a claim that does not pass fails the reply, as criterion 10 says. A claim is read by its kind, so a price claim's value needs no marker |
| D4 (High) | Accepted: a space or an apostrophe groups only before exactly three digits. The case is rewritten |
| D5 (High) | Accepted in another way: the other end of a range is a bare number and falls under 4.4, so it passes only if the business's data holds it. `24:00` is detected |
| D6 | Accepted: ordinals, "of", short month names, boundaries, and no year before a currency marker. Fractions and addresses are listed as blocked |
| D7 | Accepted: any characters that are not letters may stand between the digits of a long number; what is not seen is removed by Unicode's property and not by a list; a combining mark after a digit is removed |
| D8 | Accepted: a bank account is detected only in capitals, at the start of a word, with its check digits right |
| D9 | Accepted: a detected stretch is replaced by a character no pattern matches; an address ends at white space; the host is compared in lower case and the path as written; a label may hold any letter; the "dot" form needs a known ending |
| D10 | Accepted: a pack's checker is asked about times and dates only, cannot be asynchronous, fails the claim if it throws, and a kind is registered once. The rule that a calendar-date claim may not sit beside a slot claim is the booking pack's unit's, said in section 5 |
| D11 | Accepted: a claim covers every value in it when all of them pass against its item. The exception's limit is listed |
| D12 | Accepted: the row was wrong and is rewritten |
| D13 | Accepted: the business's name is taken out before values are looked for, and is a stored source for O5 |
| D14 | Accepted: a marker ends at a word's end; one space at most; two markers must both be able to mean the tenant's currency; a symbol with a letter before it means no currency; only a list of codes is read as codes. "Qatari riyal" still passes as the tenant's riyal; listed |
| D15 | Accepted: all four checks run and each is reported; the second part must not count a fallback for a flagged reply; "as the model was given it" is said to be the profile read in the turn; a test pins the Unicode facts the rules rest on |
