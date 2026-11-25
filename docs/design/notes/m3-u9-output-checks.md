# Design note: the checks on a reply (M3 unit U9, first part)

Status: proposed by the agent, 2026-11-26, before any code; rewritten
the same day after its review
(`docs/reviews/2026-11-26-m3-u9-design-review.md`, five High findings),
and not reviewed again. Changed once more after the code's review
(`docs/reviews/2026-11-26-gate4-u9-reply-checks.md`, eight High
findings): section 4.6 lists what. Issue #308. Stories: US-C4, criteria 3, 5 to 9 and 15; US-C15,
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
as the output structure has them); the business's profile as the turn
read it and gave it to the model; the texts of the customer's latest
batch; the deployment's canary; the instruction text of the prompt;
today's date in the tenant's time zone; and the checkers a pack
registered.

"As the turn read it" is not quite US-C4's "current stored price": an
owner who changes a price while a turn runs gets one reply checked
against the price the model was shown.

Answers: for each of O7, O6, O3 and O5, `passed` or `failed` with a
code. **All four run**, so that each can be counted; the reply passes
only if all four do, and the first that failed, in that order, is the
one the fallback is recorded under. A code is one of a fixed list
(section 7) and never holds a word of the reply, of the customer, or
of the business's data.

The function is pure: no clock, no database, no network. Its answer
does depend on the Unicode tables of the runtime; a test pins the facts
the rules rest on.

## 3. Reading the text

A copy of the text is made plain, in this order:

1. Currency symbols are found first, on the text as written, and each
   is replaced by a private mark that later steps leave alone. (The
   compatibility form would otherwise turn the rupee sign into the
   letters "Rs" and the rial sign into a word.)
2. Unicode's compatibility form (NFKC).
3. Every character Unicode calls a decimal digit becomes its ASCII
   digit: Arabic-Indic, Persian, Devanagari and Bengali numerals read
   as Latin ones. This runs before every scan, O5's too (#208).
4. The Arabic decimal mark (U+066B) becomes `.`, the Arabic thousands
   mark (U+066C) becomes `,`, the Arabic percent sign (U+066A) becomes
   `%`. Every dash and minus sign becomes `-`.
5. Every character with Unicode's property Default_Ignorable_Code_Point
   is removed, and every combining mark that directly follows a digit:
   a digit run or an address cannot be split by something unseen.
6. For matching words only: lower case; the Persian forms of yeh and
   kaf become the Arabic ones; the tatweel is removed.

The marker words of section 4.1 go through the same steps before they
are compared.

Every way a line ends becomes one line break, and the full stops of
other scripts become a dot, before step 1.

Every occurrence of the business's name, without regard to case, is then replaced by a
character that no pattern matches, so that a name such as "5 pm Cafe"
or "Glow.studio" is not read as a value on every mention.

**A number** is a run of ASCII digits, in which `,` or `.` may stand
between two digits, and a space or an apostrophe may stand between two
digits only when exactly three digits follow it and no fourth. So
`1 50` is two numbers and `2 150` is one (2150). Letters beside it do
not matter: the `12` of `A12` is a number.

The business's name is taken out only where it stands alone: an address
that begins with the name is read as an address.

## 4. O3: values, claims and numbers

### 4.1 Detection

Values are looked for in this order. Text that one kind has taken is
replaced by the unmatched character and is not read again.

| Kind | Detected when the plain text has | Not detected |
| --- | --- | --- |
| Date | `Y-M-D` with a four-digit year; `D/M`, `D/M/Y`, `D-M-Y`, `D.M.Y` (D 1 to 31, M 1 to 12, Y two or four digits; with `-` or `.` the year is needed, since `9-5` is hours and `5.10` a time); a number 1 to 31, with or without an ordinal ending (`st`, `nd`, `rd`, `th`), next to a month's name or short name in a supported language, in either order, with "of" or a comma allowed between and an optional four-digit year after. A number directly followed by a currency marker is never the year | `24/7` exactly, when no year follows (#207) |
| Amount | A number and a currency marker, before or after it, with at most one space between, or with one word between the number and a currency's *name*: a currency symbol; one of a list of currency codes, in capitals; a name, a short form or a plural from the marker data (`riyals`, `SR`, `Rs`, `Rs.`, `Dhs`, the Arabic short form of the riyal); or `/-` after the number, which means the tenant's own currency | |
| Percentage | A number and `%`, or the word for "percent" in a supported language, with at most one space between | |
| Clock time | `H:MM` with H 0 to 23 and MM 00 to 59, or `24:00`, with or without a marker for morning or afternoon after at most one space; `H.MM` **only with such a marker**, since `9.50` is also a price (without one it is a number, for 4.4); an hour 1 to 12 with a marker; or, in Urdu, Hindi and Bengali, an hour 1 to 12 with the word for "o'clock" after it and a word for the part of the day before or after. With no such word the half is not known and the time **cannot be read** | An hour with no minutes and no marker |

A marker made of letters must end where a word ends: the Arabic letter
that marks the afternoon is not found at the start of a longer word.

**Marker data.** The months and their short names, the currency names,
short forms and plurals, the words for "percent" and the markers for
morning and afternoon, in Arabic, English, Urdu, Hindi, Bengali and
Tagalog, are data in one file. **The agent wrote them and no speaker
of the five other languages has read them** (decisions, row 52). A
form that is missing leaves a number with no kind, which 4.4 still
does not let pass freely.

### 4.2 Making values comparable

| Kind | Becomes | Rules |
| --- | --- | --- |
| Amount | A whole number of the currency's smallest unit, and the set of currencies its marker can mean | Spaces and apostrophes are grouping. Of `,` and `.`: the last one is the decimal point if 1 or 2 digits follow it, or if exactly 3 follow and the tenant's currency has 3 decimals; otherwise all are grouping. More decimal digits than the currency has cannot be read unless they are zeros. `150`, `150.00` and `150,00` are equal for a currency of two decimals |
| Percentage | A number with up to 4 decimals | `10%` and `10.0 %` are equal |
| Clock time | Minutes after midnight | `5:30 pm` and `17:30` are 1050. `12 am` is 0, `12 pm` is 720. `24:00` is 0. An hour over 12 with a marker (`17:30 am`) cannot be read |
| Date | Year, month, day | A two-digit year is 2000 plus it. With no year: the next such date on or after the day given as today. Day comes before month, always (section 9). A date that does not exist cannot be read |

A value that **cannot be read** fails the reply.

A marker can mean several currencies (`$`, "rupee", "riyal"). An amount
is in the tenant's currency only if that currency is among those its
marker can mean. A number with a marker on each side needs both to
mean it. A symbol with a letter directly before it (`A$`) and a marker
the data does not know mean none. **A tenant with no currency set has
no amount that passes.**

### 4.3 Claims

Each claim is read by its kind:

| Claim kind | Item | Its value must hold | The claim passes only if |
| --- | --- | --- | --- |
| `price` | A service's identifier, as the model was given it | Exactly one amount, or exactly one number with no marker, read as an amount in the tenant's currency | It equals that service's price |
| `opening-hours` | A weekday, `1` to `7`, as the model was given it | One or more clock times and nothing else that is detected | Each equals the opening or the closing of a period stored for that weekday. A closing stored as `24:00` equals `00:00` |
| `service-detail` | A service's identifier | One or more detected values | Each is found, as an equal value of the same kind detected by these same rules, in that service's name or description. An amount must also be in the tenant's currency |
| `policy` | A policy's identifier | The same | The same, in that policy's title or body |
| Any other kind | | One or more clock times or dates | A checker registered for the kind says so for each (section 5) |

**A claim that does not pass fails the reply** (US-C4, criterion 10):
an item that names nothing, a value that holds nothing its kind can
read, or a value that is not what is stored. This is so even when the
reply's text holds no such value, since the claim is the model's own
word about what it said.

A detected value in the reply passes when a claim that passes holds an
equal value of the same kind.

**The exception.** A detected clock time or date that no claim holds
still passes if an equal value is detected, by the same rules, in the
texts of the customer's latest batch. An amount or a percentage never
passes this way, and neither does a date written as two numbers and a
slash with no year, which is also how a fraction is written ("1/2
price").

### 4.4 Every number is accounted for

This rule is not in the guardrail policy, which leaves a number with
no marker unchecked. It is added because the review showed how many
ordinary ways of writing a price or a time no list of markers
recognises, and because the other end of a range ("100-150 SAR", "3 to
9 pm") is such a number.

After the values of 4.1 and the contact details of section 6 have been
taken out of the reply, **each number that is left must equal a number
the business's own data holds**: a number in a service's name or
description, in a policy's title or body, or in the business's name; a
price, in whole units and in full; an hour or a minute of the opening
hours, the hour also on the twelve-hour clock.
Compared as numbers: `09` equals `9`.

Not counted as a number left over: the numbering of a list, which is
lines that begin 1, 2, 3 and on, in order, two or more of them, each
number followed by `.` or `)` and a space; and `24/7`.

A number left over **cannot be read**, and the reply fails, when a
letter is glued to it (`150k`, `16h`), when a word after it makes it
another number ("150 thousand"; a list in the marker data), or when
its grouping is no grouping (`0.150`, `1.50,00`).

A line that holds a number left over is held back when the line also
still holds a marker that no number was joined to: a currency sign,
code or name, `%` or a word for percent, a month's name (but not
"may"), or a word for "o'clock". And seven or more digits left over
on one line, in whatever pieces, fail as a long number said in parts.

A number from the customer's messages does **not** pass by this rule:
"yes, 100" after "is it 100?" is held back.

So a wrong number passes only when it happens to equal some other
number the business stored: the same limit the guardrail policy
already accepts for a claim ("a true price of one service stated as
another's").

What it costs: "we have 3 stylists" is held back unless the business's
data says 3; so is "since 2015", "2 for 1" and "room 12".

### 4.5 Cases

The tenant's currency is SAR with two decimals. Service S costs 150.00;
its description says "45 minutes, 10% off on Mondays". Policy P says
"Cancel before 17:00 the day before; a 50 SAR fee applies after". Monday
(weekday 1) is open 09:00 to 13:00 and 16:00 to 21:00; Tuesday is
closed. Today is 2026-11-26.

| # | Reply holds | Claims | Customer's batch | Result |
| --- | --- | --- | --- | --- |
| V1 | "150 SAR" | price, S, "150 SAR" | | passes |
| V2 | the same in Arabic-Indic digits with the Arabic word for riyal | price, S, the same | | passes |
| V3 | "SAR 150.00" | price, S, "150" | | passes: a price claim's value needs no marker |
| V4 | "150 SAR" | none | | fails, `amount-unclaimed` |
| V5 | "200 SAR" | price, S, "200 SAR" | | fails, `claim-failed` |
| V6 | "$150" | price, S, "150" | | fails: `$` cannot mean SAR |
| V7 | "150 SAR" and "300 SAR" (a total) | price, S, "150 SAR" | | fails on 300 (O4) |
| V8 | "not 100 SAR, it is 150 SAR" | price, S, "150 SAR" | "is it 100 SAR?" | fails on 100 (#207; section 8) |
| V9 | "50 SAR" | policy, P, "50 SAR" | | passes |
| V10 | "50 SAR" | price, S, "50 SAR" | | fails, `claim-failed` |
| V11 | "10%" | service-detail, S, "10%" | | passes |
| V12 | "100% sure" | none | | fails (#207; section 8) |
| V13 | "opens at 9:00" | opening-hours, 1, "9:00" | | passes |
| V14 | "9 am to 1 pm and 4 pm to 9 pm" | opening-hours, 1, "9 am to 1 pm, 4 pm to 9 pm" | | passes: one claim holds four times and each is stored |
| V15 | "opens at 16:00" | opening-hours, 2, "16:00" | | fails, `claim-failed` |
| V16 | "at 5 pm" | none | "can I come at 5pm?" | passes by the exception |
| V17 | "at 5 pm" | none | "can I come at 5?" | fails: the customer's "5" is not a detected time |
| V17a | "Yes, 9.50" | none | "is the trim 9.50?" | fails, `number-unknown`: with a dot and no marker it is a number |
| V18 | "17:00" | policy, P, "17:00" | | passes |
| V19 | "on 12 March" | none | "12/3?" | passes by the exception (both are 2027-03-12). "on 12/3" does not: two numbers and a slash never pass this way |
| V20 | "on March 12th" | none | | fails, `date-unclaimed` |
| V21 | "open 24/7" | none | | passes |
| V22 | "45 minutes" | none | | passes: 45 is a number in S's description |
| V23 | "150" | none | | passes: 150 is a stored price. "140" fails, `number-unknown` |
| V24 | "1.500 SAR" | price, S, "1.500 SAR" | | fails: three digits after the separator is grouping, so 1,500.00 |
| V25 | "150.5 SAR" | price, S, "150.5 SAR" | | fails: 150.50 is not 150.00 |
| V26 | "150.005 SAR" | price, S, "150.005 SAR" | | fails: grouping, so 150,005.00 |
| V27 | "150 SAR" | price, "no-such-id", "150 SAR" | | fails, `claim-failed` |
| V28 | "150 SAR" | price, S, "150 SAR"; price, S, "999 SAR" | | fails, `claim-failed` |
| V29 | "1 5 0 SAR" | price, S, "150 SAR" | | fails: the amount is "0 SAR", and 1 and 5 are numbers left over |
| V30 | "150 SAR" with a zero-width space inside the number | price, S, "150 SAR" | | passes: removed in section 3 |
| V31 | "200 Saudi riyals" | price, S, "150 SAR" | | fails, `amount-unclaimed`: one word may stand before a currency's name |
| V32 | "costs two hundred" then "200" with a marker the data does not know | price, S, "150" | | fails, `number-unknown`: 200 is nowhere in the business's data |
| V33 | "100-150 SAR" | price, S, "150 SAR" | | fails, `number-unknown` on 100 |
| V34 | "open 3 to 9 pm" | opening-hours, 1, "9 pm" | | fails, `number-unknown` on 3 |
| V35 | "open 9-5" | none | | fails on 5: 17:00 is not a Monday time, and 5 is not stored. "open 9-1" passes: both are hours of the stored periods, on the twelve-hour clock |
| V36 | "until 24:00" | opening-hours, 1, "24:00" | | fails, `claim-failed` |
| V37 | lines beginning "1. ", "2. ", "3) " | | | passes: a list. "200. Would you like to book?" and "1. Haircut" followed by "250. Colour" fail |
| V38 | "we have 3 stylists" | none | | fails, `number-unknown` |
| V39 | "5 May 50 SAR" | policy, P, "50 SAR" | | fails, `date-unclaimed`: 50 is the amount, not the year, and the date has no claim |

### 4.6 What the code's review changed

- Addresses, handles and bank accounts are looked for **before**
  values, on the whole text; long numbers after values. A value inside
  an address no longer hides the address.
- A number and its marker may have up to three characters of space,
  emphasis or brackets between them (`*45* SAR`, `45 (SAR)`, `SAR:
  45`). The tenant's own currency code is read in any case.
- Groups of a number are 1 to 3 digits with no leading zero, then
  exactly three each. Anything else cannot be read.
- In an amount, a letter glued to the number or a multiplier word
  between the number and the currency's name cannot be read.
- A claim's value holds its values and nothing else that is checked:
  no address, no number left over (but for a price claim's one bare
  number).
- Between a day and a month's name: up to two of space, comma and
  hyphen, and "of", "the", "de" or "ng".
- The codes of O3 are found in this order: a claim that does not pass;
  then each value in the reply; then what is left over.

## 5. Where a pack registers a claim kind

A pack gives, for each kind it adds, a function: given the claim's
item and one clock time or date in its comparable form, it answers
yes or no. Registered once: a second function for a kind, or one for
a core kind, is refused when the registry is built. The function is
synchronous; if it throws, the claim fails. It is asked about times
and dates only: an amount or a percentage passes only by the core's
own four kinds. It is not shown the reply.

The guardrail policy's rule that a calendar-date claim may not be used
beside a slot claim needs all of a reply's claims at once. It is not
built here; it belongs to the unit that builds the booking pack's
kinds (M5), which must extend this hook to do it.

## 6. O5, O6 and O7

### O5: contact details and links

Looked for in the plain text, after every value O3 detected has been
replaced by the unmatched character:

| What | Detected when the text has | Ends |
| --- | --- | --- |
| Web address | A scheme and `://`; or `www.`; or two or more labels of letters (of any script), digits and hyphens joined by dots, the last of 2 to 24 letters or a coded ending (`xn--`). It may follow a dot and be followed by a dash | At white space; closing punctuation at the end is not part of it |
| The same, disguised | A label, then "dot" or a dot in brackets, then one of a list of endings (in the marker data; without `in`, `me` and `co`, which are words); or a label, a plain dot with a space on either side, and one of a shorter list that leaves out endings a sentence begins with ("store. Online") | |
| Email address | A local part, `@`, and a domain as above | |
| Handle | `@` and 2 or more letters, digits, dots, hyphens or underscores, with or without a name before the `@`: also how a payment address is written (`name@provider`) | |
| Long number | 7 or more digits with no letter between the first and the last | |
| Bank account | At the start of a word, in capitals: two letters, two digits and 11 to 30 more letters and digits, single spaces allowed, whose check digits are right (ISO 13616, mod 97) | |

Each one found must equal a value the business stored: one found by
these same rules in the support contact, the business's name, a
service's name or description, or a policy's title or body. Compared
as: a web address without `http://` or `https://` (another scheme is part of it) and a leading `www.`, its host in
lower case and its path as written, without a final `/`; an email and
a handle in lower case; a number as its digits alone; a bank account
without spaces. Otherwise O5 fails.

| # | Reply holds | Stored | Result |
| --- | --- | --- | --- |
| L1 | "https://salon.example/book." | policy text holds "salon.example/book" | passes |
| L2 | "salon.example/pay" | the same | fails, `link` |
| L3 | "evil dot com" | | fails, `link` |
| L4 | "pay to @salon_pay" | | fails, `handle` |
| L5 | "call +966 55 555 0100" | support contact "+966555550100" | passes |
| L6 | the national form "055 555 0100" in Arabic-Indic digits | support contact "+966555550100" | fails, `number`: other digits (section 9) |
| L7 | "055, then 1234, then 567" | | **O5 does not detect it**: letters stand between. It fails all the same, by 4.4: seven digits or more left over on one line |
| L8 | "order 1234567" | | fails, `number` |
| L9 | "17:30 on 12/03/2027" (both passed O3) | | passes |
| L10 | "see you.Then" | | fails, `link`: a missing space after a full stop |
| L11 | "055-555-0100" written with en dashes | | fails, `number` |
| L12 | "the red dot on the map" | | passes: "on" is no ending |
| L13 | "is 45 minutes long" | | passes: no bank account (not capitals) |
| L14 | "salon.example/Book" | policy text holds "salon.example/book" | fails, `link`: the path is compared as written |

### O6: the canary and the instructions

- **Canary.** Fails if the canary is found in the reply or in any
  claim's item or value, with every character that is not a letter or
  a digit removed from both first, without regard to case.
- **Instructions.** The instruction text and the reply are each cut
  into words (runs of letters and digits, lower case, after what is
  unseen, marks, apostrophes and hyphens are taken out). Fails if any 12
  words in a row of the reply are 12 words in a row of the
  instructions. The business's data and the session are not
  instruction text: a reply may quote a policy at length.

A reworded copy of the instructions is not caught.

### O7: length

Fails if the reply, made plain, has no character a reader sees (white
space, controls, marks alone and the blank pattern are not), or if the reply as written is longer than 1,200 code points.

## 7. The codes

`empty`, `too-long`, `canary`, `instructions`, `value-unreadable`,
`claim-failed`, `amount-unclaimed`, `percentage-unclaimed`,
`time-unclaimed`, `date-unclaimed`, `number-unknown`, `link`, `email`,
`handle`, `number`, `bank-account`.

One code for one failed check: the first thing found that fails. The
code says which kind failed and nothing of what it was.

## 8. The review findings this answers

| Finding | Answer |
| --- | --- |
| #207: "24/7" reads as a date | Not detected (V21) |
| #207: "100% sure", a decimal such as "2.50" read as a time, the Arabic marker that is also "metres" | **Still blocked.** Each is a reply held back that was not wrong. How often is for the eval dimension E12 to measure once evals run (U16) |
| #207: the correction "not 100 SAR, it is 150 SAR" is blocked (V8) | **Still blocked.** Letting an amount pass because the customer wrote it would let "yes, 100 SAR" pass too. The eval gate E3 will fail on such a case until this is revisited |
| #207: stale tool results, the ten-minute rule | Not in M3: no tools |
| #208: normalise before the digit scan | Done (section 3) |
| #208: "dot" forms and handles | Detected (L3, L4); "dot" in English only |
| #208: digits split by words | Not detected by O5, and held back by 4.4 (L7) |
| #208: look-alike letters, wallet addresses | **Not detected.** A wallet address of letters and digits with no dots is not a shape these rules know, unless a number inside it is left over for 4.4 |
| #213: a wrong weekday beside a right date | Not in M3: the calendar is the booking pack's |
| #209: an owner's stolen account can store a payment link, which then passes O5 | Not answered by a check on replies: what is stored is trusted here |

#207 and #208 stay open with what is left.

## 9. What is not checked, and what is held back though right

Not checked:

- A value written in words; a weekday name; "tomorrow".
- That a claimed value is said *about* the item claimed.
- A number with no marker that equals some number in the business's
  data (V23): "150" passes whatever it is said about, and so does
  "150 SAR or 45" when 45 is such a number, or "150" before a word no
  list knows.
- An address whose dot is disguised in a way section 6 does not list,
  or with an ending that is not in the lists.
- A percentage or a fraction written as "45 pc" or with a fraction
  sign.
- Opening and closing times are interchangeable, and so are the
  periods of a split day.
- "Qatari riyal" passes as the tenant's riyal: the word before a
  currency's name is not read.
- With three-decimal currencies, `1.500` is one and a half, never
  fifteen hundred.
- Numbers in a script Unicode does not class as decimal digits.

Held back though right (each sends the fallback):

- A count, a year, a room or an address the business's data does not
  hold (V38); a fraction such as "1/2 price", read as a date.
- Day before month, always: a business that writes month first sees
  right dates held back.
- A stored international number written in its national form (L6); a
  missing space after a full stop (L10).
- "at 5 pm" when the customer wrote "at 5" (V17).
- "100% sure" and a correction that repeats a wrong price (section 8).

Words in the marker data were not read by a speaker (row 52).

## 10. Tests

One test for each row of the tables in 4.5 and 6, named by its number;
the rules of 3, 4.1, 4.2 and 4.4 each alone, with the digits of four
scripts; every entry of the marker data detected once; a pack's checker
asked about its kind, never about a core kind, an amount or a
percentage, and failing the claim when it throws; the codes of section
7 carrying nothing of the input; the Unicode facts section 3 rests on;
the function answering the same for the same input.

"A fake that returns hostile output is stopped" is the second part's
test, through the worker.
