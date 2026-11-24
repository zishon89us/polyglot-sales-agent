# Gate 4 review: M3 U5, buttons and captions in the channel

Reviewed: commit `4a009bb` on `feat/304-m3-u5-buttons-captions` (pull
request #327), by a second agent that did not write the code, working in
a copy of the repository with no network.

The report is as the reviewer wrote it, with one change that is not the
reviewer's: in G1 the invisible characters of its examples (a zero-width
space, a line break, a direction override, composed and decomposed
letters) are written as escapes, so that this file holds none. The
author's response follows the report.

---

# Gate 4 review: M3 U5, buttons and captions in the channel (`feat/304-m3-u5-buttons-captions`)

I found no High finding: no customer input I tried crashes the parser, poisons a webhook, or is stored under the wrong kind. The faults are one Medium (title checks weaker than the note says) and a set of Low test gaps and document slips.

**Read:** the design note, the full diff of every source file named in the brief, the fixtures and README, the db tests in full, and the other tests by title. I read the document diffs except the tail of threat-model A7, which my view cut off.

**Ran in `/tmp/review-u5`:**
- `pnpm -s exec vitest run`: 37 files, 1262 tests, all pass.
- `pnpm -s exec tsc --noEmit -p .`: exit 0.
- A temporary probe of about 55 odd inputs against `checkButtonMessage`, `checkText`, `readButtonPayload` and `parseWebhook`.
- A temporary db probe through `storeInbound` on a scratch database.
- 54 mutants, each restored; `git status` is clean.

**Not checked:** Meta's pages (no network), `EXPLAIN` of `messageAnswered`, lock times on a large table, concurrency, the test page in a browser, the design review document, and a tap or caption through the worker's turn.

## Findings

**G1. Medium. `packages/channel/src/index.ts` lines 75–77 and 97–108 (`CONTROL`, `titleKey`, `checkButtonMessage`); note S3.**
The note says a title that is "blank" or has "a control character or a line break" is refused, and that titles are unique once normalised. The code checks only `\p{Cc}`, `trim()` and NFC plus `toLowerCase()`. The probe shows these are all accepted:
- a title of only U+200B (blank to the eye);
- `a b` (a line break);
- `a‮b` (a bidi override);
- a lone surrogate `\ud800`;
- the pairs `Stop` / `St​op`, `Stop` / `Ｓｔｏｐ`, `STRASSE` / `straße`, and `a b` / `a  b`.

Fix: refuse `\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}` and lone surrogates, and compare titles with NFKC and collapsed whitespace; or narrow S3 to what the code does.

**G2. Low. S3 has no test for a control character or for NFC.**
Mutant 7 (dropping `CONTROL.test(title)`) and mutant 9 (dropping `.normalize("NFC")`) both survive the whatsapp, mock and contract tests. Fix: add `"a\nb"` and the pair `"é"` / `"é"` to the contract's `bad` list.

**G3. Low. `packages/db/migrations/0008_taps.up.sql`, `messages_caption_is_inbound_text`.**
Mutant 45 (dropping `direction = 'inbound'`) survives: nothing tests that a sent text cannot carry `caption_of`. Fix: one administrator insert of an outbound text with `caption_of`, expecting a refusal.

**G4. Low. `packages/core/src/buttons.ts` line 24 (`PAYLOAD`); B3.**
Mutant 31 (the rest allowing `\x20`) survives: B3's "a space" is not tested in the rest position, such as `booking.confirm.a b`. The parser and the table refuse a space today, so this is a gap in the tests of the exported function only. Fix: add that case, and one with a trailing `\n`, to the B3 list.

**G5. Low. `checkButtonMessage` / `checkText` (`index.ts` lines 113 and 121); S5 and S7.**
A body of only whitespace, or of only U+0000, passes both checks. The code matches the note ("empty"), but the refusal is not then "before any call". Whether Meta refuses such a body is not confirmed. Fix: refuse a body that is empty after removing U+0000 and trimming, or say in S5 and S7 that blank bodies are left to the channel.

**G6. Low. The note disagrees with itself or the code in four places.**
- M4 and M10: a caption over 65,536 is "unread" (kept), but a typed text over 65,536 still throws `BadShape` in `messageText` and is dropped as malformed. The same over-long input gets two outcomes, and the note does not say this is meant.
- K5 and the section 4 table say "printable characters" for `in_reply_to`; the code and the SQL are printable ASCII.
- `packages/channel/src/boundary.test.ts` line 2 cites "section 6" of the note; the note has no section 6 (it is section 5).
- Section 2 lists `coreButton` and `readButtonPayload`; the code also exports `coreButtonOf`, which refuses `core.stop.x` (probe: `readButtonPayload` reads it with rest `x`, `coreButtonOf` returns undefined). That rule is tested but is not in the B table.

**G7. Low. The note's "in the turn" claim has no test in this unit.**
Section 4 says the echo answers nothing to a batch of taps alone and that a caption is echoed. `apps/worker/src/worker.test.ts` changed by one line (`buttons: []`). The code path is the old one (`handlers.ts` line 120, `kind === "text"`), so the claim is very likely true, but it is not confirmed by a test. Fix: one worker test with a tap-only batch and one with a caption.

**G8. Note. Migration 0008, locks and the way back.**
- Up runs an unindexed `UPDATE … WHERE kind = 'button'` and then adds validated CHECK constraints, all in one transaction under ACCESS EXCLUSIVE. Unlike 0006, it carries no "stop the API first" comment. Not measured.
- Down then up relabels every real tap as `quick-reply` for good. The down file's comment and a test state this, so it is honest, but down is not a true way back for data.
- FORCE ROW LEVEL SECURITY is back on after up (probe: `relforcerowsecurity = true`; mutant 39 is killed).

**G9. Note. The identifier pattern is written three times.**
`send.ts` line 182 has `/^[\x21-\x7e]{1,128}$/` as a literal, `CHANNEL_MESSAGE_ID` holds it in the interface, and the SQL has it again. They agree today. Fix: use the constant in `send.ts`.

**G10. Note. Mutant 24 survives.**
An `interactive` that is not a `button_reply` but carries a `text` object could be read as text and no test would notice. The existing "type alone decides" test covers a text carrying a tap and a tap carrying text only. Fix: add `text` to the list-reply case.

**G11. Note, in code this change did not touch.** `storeInbound` throws on a body containing U+0000 (`invalid byte sequence`). The WhatsApp parser strips it from texts and captions; the in-memory channel's `revive` does not. `apps/api/src/main.ts` builds only WhatsApp, so no live path reaches it.

## Mutants

54 tried, 48 killed, 6 survived. One survivor is equivalent; mutants 7, 9, 31 and 45 matter.

| File | Change | Result |
|---|---|---|
| `channel/index.ts` | `BUTTON_PAYLOAD` 257; `CHANNEL_MESSAGE_ID` 129; id allows space; max+1; no `< 1`; titleMax+1; no trim check; no duplicate title; no lower-casing; no payloadMax; no duplicate payload; bodyMax+1; textMax+1; `retryable: true` | 14 killed |
| `channel/index.ts` | 7: drop `CONTROL.test(title)` | **survived** |
| `channel/index.ts` | 9: drop `.normalize("NFC")` | **survived** |
| `channel-whatsapp/parse.ts` | caption 65,537; no U+0000 strip; any interactive is a tap; title as payload; `quick-reply` → `button`; `context.from` as id; no `captionOf`; document captions read | 8 killed |
| `channel-whatsapp/parse.ts` | 24: a non-`button_reply` interactive with `text` read as text | **survived** |
| `channel-whatsapp/send.ts` | only `bad-body` refused before the call; id and title swapped | 2 killed |
| `core/buttons.ts` | word `{0,40}`; max+1; `coreButtonOf` ignores rest; ignores owner | 4 killed |
| `core/buttons.ts` | 31: rest allows a space | **survived** |
| `apps/api/sink.ts` | no `OWN_KINDS` mapping; `template` dropped from it; `inReplyTo` null; `captionOf` null | 4 killed |
| `db/inbound.ts` | no same-conversation join; no `direction = 'outbound'` | 2 killed |
| `db/inbound.ts` | 38: drop `tap.direction` / `tap.kind` filter | survived (equivalent: `messages_only_a_tap_answers` already limits `in_reply_to` to taps) |
| `0008_taps.up.sql` | no FORCE restore; rename outbound too; 257; 129; no "tap has no body"; no "only a tap answers"; no payload pattern | 7 killed |
| `0008_taps.up.sql` | 45: caption allowed on an outbound text | **survived** |
| `mock-whatsapp/server.ts` | 4 buttons; title 21; id 257; body 1,025; no duplicate-id check; tap without `context` | 6 killed |
| `channel-mock/index.ts` | refused buttons still delivered | killed |

## What I could not fault

- **Parser robustness.** Payloads that were numbers, arrays, 257 characters, non-ASCII, or carried U+0000 or a trailing `\n` all became an unread `interactive` or `quick-reply`. So did a missing, string or array `interactive`, `button_reply` or `button`. None threw and none was counted as malformed.
- **Limits agree across parser, sink and table.** JS `$` and PostgreSQL `~ '…$'` both refuse a trailing newline (the store threw on `core.stop\n` and `a\n`, and the parser never emits them). 256 and 128 are accepted and 257 and 129 refused on both sides. Both columns are ASCII-only, so UTF-16 length equals `char_length`.
- **No poison found.** A caption with a lone surrogate, and one of 65,536 two-byte characters, both stored.
- **Kinds.** A Meta type of `button`, `template`, `quick-reply` or `Button` can never be stored under an own kind. A tap's title is not passed on, and a text carrying an `interactive` object stays a text.
- **`messageAnswered`.** Same conversation, outbound only, inside `withTenant`. `messages_channel_identifier_unique (tenant_id, direction, channel_message_id)` means two outbound rows cannot match and gives the join an index, so a full scan is unlikely (not confirmed by `EXPLAIN`). K1–K10 each have a real test.
- **Migration 0008 logic.** The rename under lifted row security is tested with the real migrate role and old rows; an old outbound `button` row passes the new constraints.
- **Refused sends.** WhatsApp makes no call and the in-memory channel records nothing and keeps its injected failure; both are tested. `WHATSAPP_LIMITS` (3 / 1,024 / 20 / 256 / 4,096) matches the fixture README, and Meta's stand-in enforces the same numbers.
- **Fixtures.** Phones are `15550100` and `15550142`; names and identifiers are synthetic.
- **Documents.** README, STATUS, data-model, the architecture rows, decisions rows 44 and 46 with the header, glossary, traceability and the ADR amendment claim no more than the code does.
- **`boundary.test.ts`.** It scans what it says it scans.

---

## Author's response

No High finding. The fixes below are in the commit after `4a009bb`; the
mutants named were run again by the author, and whether another agent
has checked the fixes is said in
`2026-11-24-gate4-u5-buttons-captions-verification.md` if that file
exists, and nowhere else.

| Finding | Answer |
|---|---|
| G1 (Medium) | **Fixed, with one difference from the suggestion.** A title is refused if it is blank once space and characters that show nothing are removed, or holds a control character, a line or paragraph separator, a format character, or half of a surrogate pair. The zero-width joiner and non-joiner are allowed inside a title, because Persian, Urdu and several Indic scripts need them inside a word; refusing every format character would refuse correct titles in languages the product is for. Titles are compared in NFKC, in one case (upper, then lower, so that `straße` meets `STRASSE`), without joiners and with every run of space as one. All eight of the reviewer's examples are now refused and are in the contract tests, which run against both channels and Meta's stand-in. S3 in the note says the same |
| G2 | Fixed: the contract's list has a line break, the composed and decomposed pair, and the others of G1. The two mutants are killed, and so are six more on the new checks |
| G3 | Fixed: a sent text with `caption_of` is refused by name of the constraint |
| G4 | Fixed: a space, a tab and a trailing line break in the rest are in B3's list; the mutant is killed |
| G5 | Fixed: a body that is blank or holds U+0000 is refused by both sends before any call; S5 and S7 say so. Whether Meta would refuse it is still not known (#328) |
| G6 | Second, third and fourth parts fixed in the note and the test's comment. First part **not fixed**: the note now says the two outcomes differ, and making them one is #328 |
| G7 | Fixed: a worker test with a tap alone (no reply, dealt with), a tap beside a caption (the caption is echoed, the payload appears nowhere in what is sent) |
| G8 | The migration now says to stop the API and the workers first, as 0006 does, and that the time is not measured. The way back is as the reviewer describes; it stays, stated (#328) |
| G9 | Fixed: `send.ts` uses the interface's constant. The pattern in SQL stays a second statement of it, tested at both limits |
| G10 | Fixed: an answer to a list that also carries a `text` part is still unread |
| G11 | Not fixed here: outside this change and on no live path (#328) |
| Mutant 38 | Left: equivalent, as the reviewer says |

Not checked by anyone: the items of #328.
