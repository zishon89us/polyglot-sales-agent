# Check of the fixes: Gate 4 review of M3 U5

Checked: commit `cdf556e` on `feat/304-m3-u5-buttons-captions`, by an
agent that wrote neither the code nor the review, in a copy of the
repository with no network. Its brief was narrow: whether the fixes do
what the author's response says.

The report is as the verifier wrote it, with one change that is not the
verifier's: invisible and unusual characters in its examples are written
as code points, so that this file holds none. The author's response
follows.

---

**What I ran.** In `/tmp/verify-u5` at `cdf556e`: `pnpm -s exec vitest run` (37 files, **1266 tests, all pass**) and `tsc --noEmit -p .` (exit 0). A temporary probe of about 105 inputs against `checkButtonMessage` and `checkText` (deleted). 20 mutants, all killed and restored; `git status` is clean. **Not checked:** Meta's behaviour, #328's content, the migration on a large table, the down path, the verification file the response mentions, and any mutant re-run for G8 or G11.

| Row | Verdict | How I know |
|---|---|---|
| G1 | **Holds in part** | All eight examples are refused, and ZWJ/ZWNJ titles (Persian, Hindi, emoji family) are accepted. "Blank once characters that show nothing are removed" is not fully true (V1). Seven of the eight are literally in the contract; `Stop`/`St[U+200B]op` is not, only U+200B alone and `ab`/`a[U+200D]b`. |
| G2 | Holds | Dropping `CONTROL` and NFKC→NFC are both killed. Ten more on the new checks are killed too: `HIDDEN`, `LONE_SURROGATE`, `blank(title)`, `toUpperCase`, joiner removal, space collapse, `Zl`/`Zp`, joiners refused, and two on `blank` itself. |
| G3 | Holds | Dropping `direction = 'inbound'` from the constraint fails `inbound.test.ts` by constraint name. |
| G4 | Holds | Space and tab mutants in the rest are each killed by their B3 case. |
| G5 | **Holds in part** | Whitespace-only, U+200B-only and any U+0000 body are refused by both checks, and the mutants are killed. Multi-line, soft-hyphen, emoji and RLM bodies are still accepted. Some blank-looking bodies pass (V2). |
| G6 | Holds | K5 says ASCII, `boundary.test.ts` cites section 5 (which exists), `coreButtonOf` is in section 2, and M4 states the difference. The section 4 table already said ASCII. |
| G7 | Holds | A mutant giving a tap a reply fails the new test. The "payload appears nowhere" assertion is weak: the turn never carries the payload. |
| G8 | Holds | The comment is there and matches 0006's wording. |
| G9 | Holds | `send.ts` uses `CHANNEL_MESSAGE_ID`; loosening it is killed. |
| G10 | Holds | A mutant reading a list reply's `text` as text is killed by the new case. |
| G11, mutant 38 | Not fixed, as stated | No change in the diff. |

**New findings**

- **V1. Low. The title check still lets through "shows nothing" characters that are not category Cf.**
  - Accepted as a sole title: U+3164, U+115F, U+FFA0 (Hangul fillers), U+2800 (braille blank), U+FE0F, U+034F, U+180B, U+17B4, and a lone U+0301.
  - Accepted as pairs: `Stop`/`St[U+034F]op`, `Stop`/`Stop[U+3164]`, U+2764 / U+2764 U+FE0F.
  - So S3's "blank (nothing left once … characters that show nothing are removed)", the response's G1 sentence and STATUS's "It is fixed" claim slightly more than the code does.
  - Fix: also strip `\p{Default_Ignorable_Code_Point}` and U+2800 in `blank` and `titleKey` (keeping the joiner and emoji-selector exceptions), or narrow S3 to "format characters (Cf)".
- **V2. Low. Bodies that show nothing still pass both checks.**
  - U+0001, U+007F, U+0085, U+3164, U+FE0F, U+034F and U+2800 alone are all accepted.
  - S5 and S7 say "blank as S3 has it", so they inherit V1's gap; control-only bodies are a separate gap.
  - Fix: have `blank` strip `\p{Cc}` and the default-ignorables too.
- **V3. Low. Honest titles are wrongly refused.**
  - `kir` and `k[U+0131]r` (Turkish dotless i, different words) are refused as duplicates, because upper-then-lower folds the dotless i to `i`.
  - The England flag emoji (tag characters are Cf) and a title with a soft hyphen are refused; so are Arabic number signs such as U+0600, which are visible Cf.
  - A Persian title with and without ZWNJ counts as one title; that is intended, and stated.
  - Fix: document these in S3, or drop the `toUpperCase` step and special-case `ß`.
- **V4. Note. Bodies are not checked for lone surrogates or direction overrides.**
  - `a\ud800` and `abc [U+202E] def` pass as bodies. Nothing claims otherwise; S5 and S7 are accurate here.
  - The `LONE_SURROGATE` comment ("not every store or channel takes it") applies equally to bodies.
  - Fix: add `LONE_SURROGATE` to `sendable`, or record the choice in S5.
- **V5. Note. The response's "all eight … are in the contract tests" is off by one.**
  - Fix: add `["Stop", "St[U+200B]op"]` to the contract's list, or say "seven, and the eighth by its kind".
- **V6. Note. The STATUS numbers match the review.**
  - 11 findings, none High, one Medium, 6 of 54 mutants alive with one equivalent: all agree.
  - "Third agent" against the review's "second agent" follows STATUS's own convention for code reviews.
  - The only overclaim is "It is fixed" (V1). No fix needed beyond V1.

---

## Author's response

**These fixes are checked by the author only.** No agent has read them.

| Finding | Answer |
|---|---|
| V1 | Fixed. A title or body is blank when nothing is left once space, controls, format characters, characters Unicode marks as ignorable in display, combining marks and the blank braille cell are removed. Titles are compared with ignorable characters removed. Each of the verifier's examples is in the contract tests. S3 now also says what would still pass: a character that shows nothing and is in none of these classes |
| V2 | Fixed by the same change; four such bodies are in the contract tests for both sends |
| V3 | Fixed. Case is folded to lower only, with `ß` as `ss`, so a dotless i stays apart from an i. The refused characters are now a short list (a zero-width space, a word joiner, a byte-order mark, the embeddings, overrides and isolates of direction) and no longer every format character, so a flag, a soft hyphen, a mark of direction and an Arabic number sign are accepted. Five honest titles are in the contract tests. Two titles that differ only in an ignorable character count as one; S3 says so |
| V4 | The choice is recorded in S5 and in the code's comment: a body is not checked for these, since it can carry a customer's own words back |
| V5 | The pair's second title is now in the contract's list. My sentence was wrong by one, as the verifier says |
| V6 | Nothing to do |
| G7's weak assertion | Left: the assertion is true and costs nothing, and the test's other assertions carry it |
