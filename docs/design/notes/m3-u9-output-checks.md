# Design note: the checks on a reply (M3 unit U9, first part)

Status: proposed by the agent, 2026-11-26, before any code, and not yet
reviewed. Issue #308. Stories: US-C4, criteria 3, 5 to 9 and 15; US-C15,
10. Guardrail policy, section 4, checks O3, O5, O6 and O7. Findings #207,
#208 and #213 are answered in section 8.

These checks decide whether a sentence about a price, a time or a way to
pay reaches a customer in the business's name. A value that is wrong and
passes is the harm; a reply that is right and blocked is a cost.
Wherever the two pull apart this note chooses to block.

## 1. Two parts

The plan names U9 among the units likeliest to split. It is split here:

| Part | What | Changes what a customer gets |
| --- | --- | --- |
| **This one** | One function in the core that is given a reply and says whether it passes O3, O5, O6 and O7, and why not. Nothing calls it yet | No |
| The second | The turn calls it; a failure sends the fallback text (U8 wrote it) and counts; a reply that does not match the schema does the same (O1); the flags are read in one place (O2); the results are stored on the trace | Yes |

Issue #308 is closed by the second part.

Not in either part, because M3 has no tools and no booking pack: the
slot and booking claim, the calendar and the calendar-date claim, the
ten-minute age of a tool result, and the exception for a turn in which
a state-changing tool succeeded. A pack registers its claim kinds
through the place section 5 describes.

## 2. What the function is given, and what it answers

Given: the reply's text; its claims (each a kind, an item and a value,
as the output structure has them); the business's profile as the model
was given it; the texts of the customer's latest batch; the
deployment's canary; the instruction text of the prompt; today's date
in the tenant's time zone; and the checkers a pack registered.

Answers: for each of O7, O6, O3 and O5, in that order, `passed`,
`failed` with a code, or `not-run`. The first failure decides, and the
checks after it are not run. A code is one of a fixed list (section 7)
and never holds a word of the reply, of the customer, or of the
business's data.

O7 and O6 come first because they are cheap and because a reply that
repeats the instructions should not be read further. The guardrail
policy's table lists them last; the outcome is the same either way,
since any failure is the fallback. Only the code that is recorded
differs.

The function is pure: no clock, no database, no network. The same
input gives the same answer.

## 3. Reading the text

Before anything is looked for, a copy of the text is made plain:

1. Unicode's compatibility form (NFKC): full-width digits and letters
   become ordinary ones.
2. Every character Unicode calls a decimal digit becomes its ASCII
   digit: Arabic-Indic, Persian, Devanagari and Bengali numerals read as
   Latin ones. This runs before every scan, O5's too (#208).
3. The Arabic decimal mark (U+066B) becomes `.`, the Arabic thousands
   mark (U+066C) becomes `,`, the Arabic percent sign (U+066A) becomes
   `%`.
4. Characters that are not seen (zero-width space and joiners, word
   joiner, soft hyphen, byte-order mark, direction marks) are removed,
   so that a digit run or an address cannot be split by one.

Words are compared without regard to case.

## 4. O3: the four kinds of value

### 4.1 Detection

Values are looked for in this order, and text that one kind has taken
is not read again by a later kind.

| Kind | Detected when the plain text has | Not detected |
| --- | --- | --- |
| Date | `Y-M-D` with a four-digit year; `D/M`, `D/M/Y`, `D-M-Y`, `D.M.Y` where D is 1 to 31 and M is 1 to 12 and Y is two or four digits; a number 1 to 31 next to a month's name in a supported language, in either order, with an optional year | `24/7` exactly, when no year follows: "open 24/7" (#207). A number pair that is not a possible day and month (`13/13`) |
| Amount | A number next to a currency marker, before or after it, with at most one space between: any currency symbol (Unicode's class Sc); an ISO 4217 code in capitals; a currency's name in a supported language | A number with no marker |
| Percentage | A number next to `%`, or next to the word for "percent" in a supported language | |
| Clock time | `H:MM` or `H.MM` with H 0 to 23 and MM 00 to 59, with or without a marker for morning or afternoon; or an hour 1 to 12 with such a marker in a supported language | An hour with no minutes and no marker. `H.MM` directly followed or preceded by another digit or separator (a longer number) |

A number is ASCII digits, with `,`, `.`, `'` or a space allowed between
digits as separators.

**Marker lists.** The months, the currency names, the words for
"percent" and the markers for morning and afternoon, in Arabic,
English, Urdu, Hindi, Bengali and Tagalog, are data in one file. **The
agent wrote them and no speaker of the five other languages has read
them** (decisions, row 52). A word that is missing is a value that is
not checked.

**A marker that is also a word.** The Arabic markers for morning and
afternoon are single letters, and one of them also stands for metres
(#207). A number followed by such a letter is read as a time. The reply
"5 metres" in Arabic is then an unclaimed time and is blocked. Chosen:
block.

### 4.2 Making values comparable

| Kind | Becomes | Rules |
| --- | --- | --- |
| Amount | A whole number of the currency's smallest unit, and the set of currencies its marker can mean | The last separator is the decimal point if 1 or 2 digits follow it, or if exactly 3 follow and the tenant's currency has 3 decimals; otherwise every separator is grouping. Digits beyond the currency's decimals must be zeros, or the amount cannot be read. `150`, `150.00`, `1,50` (two decimals) and `١٥٠` compare as the model of section 3 says |
| Percentage | A number with up to 4 decimals | `10%`, `10.0 %` and `١٠٪` are equal |
| Clock time | Minutes after midnight | `5:30 pm` and `17:30` are 1050. `12 am` is 0, `12 pm` is 720. `24:00` is not detected (H is 0 to 23). A time with a 24-hour hour over 12 and a marker that contradicts it (`17:30 am`) cannot be read |
| Date | Year, month, day | A two-digit year is 2000 plus it. With no year: the next such date on or after today. Day comes before month, always: the tenant has no locale setting (section 9). A date that does not exist (`31/2`) cannot be read |

A value that **cannot be read** never passes: no claim covers it and
the exception does not apply.

A marker can mean several currencies (`$`, "rupee", "riyal"). An amount
passes only if the tenant's currency is among those its marker can
mean; a marker the list does not know means none. **A tenant with no
currency set has no amount that passes.**

### 4.3 When a detected value passes

Each claim is read the same way: its `value` goes through sections 3
and 4.1. A claim whose value holds exactly one detected value is a
claim *of* that value. A claim whose value holds none, or more than
one, covers nothing and is otherwise ignored.

A detected value in the reply passes when at least one claim of an
equal value (same kind, equal after 4.2) itself passes:

| Claim kind | Item | Passes only if |
| --- | --- | --- |
| `price` | A service's identifier, as the model was given it | The value is an amount in the tenant's currency equal to that service's stored price |
| `opening-hours` | A weekday, `1` to `7` as the model was given it | The value is a clock time equal to the opening or the closing of a period stored for that weekday. A closing stored as `24:00` equals `00:00` |
| `service-detail` | A service's identifier | An equal value of the same kind is detected, by these same rules, in that service's name or description. An amount found there must also be in the tenant's currency |
| `policy` | A policy's identifier | The same, in that policy's title or body |
| Any other kind | | Only if a registered checker for that kind says so (section 5) |

An item that names nothing the model was given makes the claim fail.

**The exception.** A detected clock time or date with no passing claim
still passes if an equal value is detected, by the same rules, in the
texts of the customer's latest batch. An amount or a percentage never
passes this way.

A claim that fails does not by itself fail the reply: only a detected
value with no passing claim does. A reply with no detected value passes
O3 whatever its claims say.

### 4.4 Cases

The tenant's currency is SAR with two decimals. Service S costs 150.00;
its description says "45 minutes, 10% off on Mondays". Policy P says
"Cancel before 17:00 the day before; a 50 SAR fee applies after". Monday
is open 09:00 to 13:00 and 16:00 to 21:00. Today is 2026-11-26.

| # | Reply holds | Claims | Customer's batch | Result |
| --- | --- | --- | --- | --- |
| V1 | "150 SAR" | price, S, "150 SAR" | | passes |
| V2 | "١٥٠ ريال" | price, S, "١٥٠ ريال" | | passes |
| V3 | "SAR 150.00" | price, S, "150" (no marker: the claim's value holds no detected value) | | **fails**: no claim of the value |
| V4 | "150 SAR" | none | | fails |
| V5 | "200 SAR" | price, S, "200 SAR" | | fails |
| V6 | "$150" | price, S, "$150" | | fails: `$` cannot mean SAR |
| V7 | "150 SAR" and "300 SAR" (a total) | price, S, "150 SAR" | | fails on 300 (O4) |
| V8 | "150 SAR" | price, S, "150 SAR" | "is it 100 SAR?" and reply also holds "100 SAR" | fails on 100: an amount never passes by the exception (#207; section 8) |
| V9 | "50 SAR" | policy, P, "50 SAR" | | passes |
| V10 | "50 SAR" | price, S, "50 SAR" | | fails |
| V11 | "10%" | service-detail, S, "10%" | | passes |
| V12 | "100% sure" | none | | fails (#207; section 8) |
| V13 | "opens at 9:00" | opening-hours, 1, "9:00" | | passes |
| V14 | "closes at 9 pm" | opening-hours, 1, "9 pm" | | passes (21:00) |
| V15 | "opens at 16:00" | opening-hours, 2, "16:00" where Tuesday has no such period | | fails |
| V16 | "at 5 pm" | none | "can I come at 5pm?" | passes by the exception |
| V17 | "at 5 pm" | none | "can I come at 6?" | fails |
| V18 | "17:00" | policy, P, "17:00" | | passes |
| V19 | "on 12/3" | none | "12 March?" | passes by the exception (both are 2027-03-12) |
| V20 | "on 12/3" | none | | fails |
| V21 | "open 24/7" | none | | passes: not a date |
| V22 | "45 minutes" | none | | passes: a duration is not detected |
| V23 | "150" | none | | passes: a bare number is not detected (a gap, section 9) |
| V24 | "1.500 SAR" | price, S, "1.500 SAR" | | fails: three digits after the separator is grouping, so 1,500.00 |
| V25 | "150.5 SAR" | price, S, "150.5 SAR" | | fails: 150.50 is not 150.00 |
| V26 | "150.005 SAR" | any | | fails: cannot be read |
| V27 | "150 SAR" | price, "no-such-id", "150 SAR" | | fails |
| V28 | "150 SAR" | price, S, "150 SAR"; price, S, "999 SAR" | | passes: the second claim covers nothing in the reply |
| V29 | "1 5 0 SAR" | price, S, "150 SAR" | | passes: a space is a separator, and the amounts are equal |
| V30 | "150 SAR" with a zero-width space inside | price, S, "150 SAR" | | passes: removed in section 3 |

## 5. Where a pack registers a claim kind

A pack gives, for each kind it adds, a function: given the claim's
item, the detected value (its kind and its comparable form) and
whatever the pack keeps for the turn, it answers whether the claim
passes. The core calls it only for kinds that are not its own four,
and a kind with no function never passes. A pack cannot replace one of
the core's four, cannot make an amount or a percentage pass by the
exception, and is not shown the reply.

## 6. O5, O6 and O7

### O5: contact details and links

Looked for in the plain text of section 3, after every stretch of text
that O3 detected has been taken out:

| What | Detected when the text has |
| --- | --- |
| Web address | A scheme and `://`; or `www.`; or two or more labels of letters, digits and hyphens joined by dots, the last of 2 to 24 letters |
| The same in words | A label, then "dot" (alone, or in round or square brackets), then a label of 2 to 24 letters. English only |
| Email address | Something, `@`, and a domain as above |
| Handle | `@` and 2 or more letters, digits, dots or underscores, not part of an email address |
| Long number | 7 or more digits, where only spaces and `- . ( ) + /` stand between one digit and the next |
| Bank account | Two letters, two digits, and 11 to 30 more letters and digits, spaces allowed between groups (the IBAN shape) |

Each one found must equal a value the business stored: one found by
these same rules in the support contact, or in a service's name or
description, or in a policy's title or body. Compared as: a web
address without its scheme, a leading `www.`, a trailing `/` or full
stop, in lower case; an email and a handle in lower case; a number as
its digits alone; a bank account without spaces, in capitals. Otherwise
O5 fails.

| # | Reply holds | Stored | Result |
| --- | --- | --- | --- |
| L1 | "https://salon.example/book" | policy text holds "salon.example/book" | passes |
| L2 | "salon.example/pay" | the same | fails: another address |
| L3 | "evil dot com" | | fails |
| L4 | "pay to @salon_pay" | | fails |
| L5 | "call +966 55 555 0100" | support contact "+966555550100" | passes |
| L6 | "call ٠٥٥ ٥٥٥ ٠١٠٠" | support contact "+966555550100" | fails: other digits. The national form of a stored international number does not pass (section 9) |
| L7 | "055, then 1234, then 567" | | **passes: not detected**; words stand between the digits (#208, section 8) |
| L8 | "order 1234567" | | fails |
| L9 | "17:30 on 12/03/2027" | (both passed O3) | passes: taken out before O5 |
| L10 | "see you.Then" | | fails: read as an address. A missing space after a full stop blocks the reply |

### O6: the canary and the instructions

- **Canary.** Fails if the canary is found in the reply, in any
  claim's item or value, with every character that is not a letter or
  a digit removed from both first, without regard to case. So spacing
  the canary out or putting marks between its characters does not hide
  it.
- **Instructions.** The instruction text and the reply are each cut
  into words (runs of letters and digits, lower case). Fails if any 12
  words in a row of the reply are 12 words in a row of the
  instructions. The business's data and the session are not
  instruction text: a reply may quote a policy at length.

### O7: length

Fails if the reply, after section 3, has no character other than white
space, or if the reply as written is longer than 1,200 code points.
The client already refuses an answer over that length as not matching
the schema; this check is the same number, kept where the other checks
are.

## 7. The codes

`empty`, `too-long`, `canary`, `instructions`, `value-unreadable`,
`amount-unclaimed`, `percentage-unclaimed`, `time-unclaimed`,
`date-unclaimed`, `link`, `email`, `handle`, `number`, `bank-account`.

One code for one failed check: the first value found that fails. The
code says which kind failed and nothing of what it was.

## 8. The review findings this answers

| Finding | Answer |
| --- | --- |
| #207: "24/7" reads as a date | Not detected (V21) |
| #207: "100% sure", a decimal such as "2.50" read as a time, the Arabic marker that is also "metres" | **Still blocked.** Each is a reply held back that was not wrong. Chosen because the opposite lets an unchecked percentage or time through. How often it happens is for the eval dimension E12 to measure once evals run (U16) |
| #207: the correction "not 100 SAR, it is 150 SAR" is blocked (V8) | **Still blocked.** Letting an amount pass because the customer wrote it would let "yes, 100 SAR" pass too, and code cannot tell the two apart. The eval gate E3 will fail on such a case until this is revisited; said here, so that it is not found as a surprise |
| #207: stale tool results, the ten-minute rule | Not in M3: no tools |
| #208: normalise before the digit scan | Done (section 3, L6's first half) |
| #208: "dot" forms and handles | Detected (L3, L4), in English only for "dot" |
| #208: look-alike letters, wallet addresses, digits split by words | **Not detected** (L7). A wallet address of letters and digits with no dots is not a shape these rules know |
| #213: a wrong weekday beside a right date | Not in M3: the calendar is the booking pack's |
| #209: an owner's stolen account can store a payment link, which then passes O5 | Not answered by a check on replies: what is stored is trusted here |

#207 and #208 stay open with what is left; the second part's pull
request says so.

## 9. What is not checked, in one place

- A value written in words; a bare number (V23); a duration; a weekday
  name; "tomorrow".
- That a claimed value is said *about* the item claimed: a true price
  of one service can be stated as another's (guardrail policy, "what a
  passing claim does and does not show").
- Opening and closing times are interchangeable, and so are the
  periods of a split day.
- Day before month, always. A business that writes month first will
  see right dates blocked, or `3/4` read as 3 April. No setting exists
  to say otherwise.
- With three-decimal currencies, `1.500` is read as one and a half,
  never as fifteen hundred.
- A stored international number written in its national form is
  blocked (L6); so is a missing space after a full stop (L10).
- Words in the marker lists were not read by a speaker (row 52).
- Text in a language that writes numbers in a script Unicode does not
  class as decimal digits (Chinese numerals, Roman numerals).

## 10. Tests

One test for each row of the tables in 4.4 and 6, named by its number;
the rules of 3, 4.1 and 4.2 each alone, with the digits of four
scripts; every month name, currency name, percent word and day-half
marker of the six languages detected once; a pack's checker called for
its kind and never for a core kind; the codes of section 7 carrying
nothing of the input (a reply with a marked word, and no code holding
it); the function answering the same for the same input.

"A fake that returns hostile output is stopped" is the second part's
test, through the worker.
