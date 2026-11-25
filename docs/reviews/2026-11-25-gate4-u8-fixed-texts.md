# Gate 4 review: M3 U8, the code

Reviewed: commit `3c44caf` on `feat/307-m3-u8-fixed-texts`, by a second
agent that did not write it, working in a copy of the repository. The
report is unedited, except that in finding R4 the reviewer wrote
characters that cannot be seen and line separators as themselves; they
are written here as `\uXXXX`, so that the file holds none. The author's
response follows the report.

---

# Gate 4 review: M3 U8, fixed texts and the disclosure

**Read:** the design note, the full diff of `packages/db/src/{outbound,inbound}.ts`, migration 0011 up and down, `packages/core/src/texts.ts`, `apps/worker/src/{texts,handlers,turn,main}.ts`, `texts/fixed/1/en.json`, `texts/README.md`, the changed doc rows, and most of `disclosure.test.ts`.
**Ran:** the three test files (53 pass, PostgreSQL reachable), 51 mutants, six temporary probe tests appended to `disclosure.test.ts`, and a node script against the reader. Everything is restored and `git status --short` is empty.
**Not checked:** `tools/e2e.test.ts` and `packages/db/test/*` were not run; the down migration was read, not executed; no real concurrency was exercised (the races below are from one sequential probe plus reading); `texts.test.ts` was not read line by line.

## Findings

**R1 — High (narrow window) — `packages/db/src/inbound.ts:181-188, 311-327`; `outbound.ts:885-896`.** A failure receipt that lands before `recordSend` commits is lost, and the session is then marked told.
- `FORWARD` matches on `channel_message_id`, which is only written when the acceptance is recorded.
- Probe: a channel whose `sendText` delivers the `failed` receipt before returning. Result: `statusesApplied: 0`, message `sent`, session `told: true`, and the next message went out as `"second"` with no disclosure.
- This is the same class as design-review D1, by another route.
- Change: keep a receipt that matches no message (a small per-tenant table keyed by message id) and apply it in `recordSend` on acceptance; or answer the webhook so the channel redelivers.

**R2 — Medium — note section 4 (D2a, D3), `docs/design/data-model.md` `disclosed_at` row.** "Told twice; never not at all" is not true.
- Probe C: A (disclosure) sent, B sent without it, A reported failed. The mark comes off and C carries it, but the customer has already read B undisclosed. If no C follows, the session is never told.
- The receipt path also takes no conversation lock, so a message already claimed while the session was still marked goes out without it.
- Change: say this in the note and the data model. Consider re-deciding the disclosure for messages still `pending`/`sending` when the mark comes off.

**R3 — Medium — `apps/worker/src/disclosure.test.ts:292-348`.** The D2a tests miss the cases that matter.
- Mutant M4 (the `NOT EXISTS` ignores `other.disclosure`) survives. Under it, the probe C scenario leaves the session marked and never told. No test has a non-disclosure `sent` message present when the disclosure-bearing one fails.
- Mutant M10 (`recordSend` marks the session even when the accepted message carried no disclosure) survives.
- The test at line 322 is titled "...a failure of another tenant's message with the same id is not this session's", and its body has no second tenant. My probe A shows the behaviour is correct under RLS (`statusesApplied: 0`, still told); it is just untested.
- Change: add those three tests.

**R4 — Low — `packages/core/src/texts.ts:66, 141-160` against note F6/F3.** The reader does not apply "the channel's own check of a title".
- Accepted by `readFixedTexts`, measured: a title of only `\u200b`; `"Stop messages\u200b"` beside `"Stop messages"`; a title with `\u202e`; a lone surrogate `\ud800`; bodies with `\u2028`, `\u202e`, or only `\u200b`.
- `checkButtonMessage` (`packages/channel/src/index.ts:130-139`) refuses hidden characters and lone surrogates, so such a file starts the worker and then silently loses its buttons through D9.
- Duplicate JSON keys are accepted (last wins); a 5,000-character first `disclosure` passed.
- Change: have the reader call the channel's title check or share its regexes; refuse `\p{Cf}`, `\u2028`, `\u2029` and lone surrogates in bodies.

**R5 — Low — `texts.ts:69, 79-86, 213-229`.** `fillFixedText` can emit an open place.
- Measured: `fillFixedText("{{a}}{b}}", {a: "{"})` and `fillFixedText("{{{a}}", {a: "{b}}"})` both return `"{{b}}"`.
- The reader accepts such bodies: `"{{opening}}{x}} {{contact}}"` and `"{{{opening}}} {{contact}}"` both passed.
- A value with `\u202e` is also filled in.
- Change: re-test the result for `{{`; refuse a value containing `{` or `}`, or a body with a brace touching a place.

**R6 — Low — `0011_fixed_texts.up.sql:17-27`.** Several constraints do not constrain. Measured as accepted:
- `buttons` of `[1]`, `[{}]`, or two identical buttons;
- `disclosure` of `'   '`; `lead` of a lone line break;
- `disclosure` set on a `pending` row;
- an outbound text row with `body` NULL and `lead` NULL.

That last row, in an untold session, was sent as the disclosure alone and marked the session (probe E). `finishTurn` can write such a row if called with `reply === ""` and no `lead` (`outbound.ts:296-312`); `turn.ts` never does today. Change: check element shape, add `btrim(...) <> ''`, add `CHECK (kind <> 'text' OR body IS NOT NULL OR lead IS NOT NULL)`, and have `finishTurn` refuse an empty reply without a lead.

**R7 — Low — `outbound.ts:705-710`, `handlers.ts:61-65`, `turn.ts:74-78`.** `disclose` and both `texts` options are optional. A caller that omits them sends no disclosure and drops `asks-if-person`, with no error. Only `main.ts` protects production. Change: make them required and pass an explicit stub in tests.

**R8 — Low — `texts.ts:163-172`, note F3a.** The with-buttons length check can never fire: 150 + 2 + 300 = 452, under 500 (mutant C7 alive). Separately, `lead` may be 700 in the table and in `FILLED_TEXT_MAX`; 150 + 2 + 700 + 2 + 1,200 = 2,056, over the 2,000 the note says always fits. Not reachable today, since the only lead is at most 300. A later unit that leads with a filled text gets a permanent `bad-body`. Change: state the bound for `lead` in F3a, or check the composed length when the lead is written.

**R9 — Low — `handlers.ts:104-122`, `outbound.ts:898-900`.** Two smaller points in `call`.
- By reading: when a send without buttons ends "unknown" and is finally closed as unconfirmed, the row keeps `buttons` although the customer may have seen the text without them.
- Mutant H4 (buttons checked against the body alone, not the composed text) survives: no test has the disclosure push a button message over the limit.

**R10 — Note — language order is untested through the database.** Mutants M15, M16, M18 and M19 survive (order of `preferred`, the contact's last language, `last_language` on an unsupported turn, the lead's language). With only `en.json` no test can tell them apart. Change: run a few cases with a synthetic two-language `FixedTextSet`.

**R11 — Note — `inbound.ts:316-326`.** Tenant scoping of the D2a `UPDATE` (and of `FORWARD`) rests on RLS alone; there is no `tenant_id` predicate, and a receipt is not tied to the receiving number it arrived on. It holds today (probe A). Add `failed.tenant_id = $2` as a second line of defence.

**R12 — Note — docs.** Note section 4 says `messages.disclosure` is "the disclosure that was sent with it". A row refused for good keeps it (the D3 test asserts `["failed", TOLD]`). The data model's "what the last try sent" is nearer. `messages.session_id` is NOT NULL, so D8 cannot occur yet.

## Mutants (51 run; 35 killed, 16 alive)

| Mutant | Result |
| --- | --- |
| M1 D2a: drop `NOT EXISTS` | killed |
| M2 D2a: drop `failed.disclosure IS NOT NULL` | alive (shielded by `NOT EXISTS` in real flows) |
| M3 / M3b / M20 D2a: any receipt status unmarks (JS guard, SQL guard, both) | alive x3 (equivalent: the message itself satisfies `NOT EXISTS`) |
| M4 D2a: `NOT EXISTS` ignores `other.disclosure` | **alive, real bug** |
| M5 D2a: `NOT EXISTS` counts only delivered/read | killed |
| M6 D2a: remove the UPDATE | killed |
| M7 claim: keep the earlier disclosure | killed |
| M8 claim: ignore `disclosed_at` | killed |
| M9 record: mark on any outcome | killed |
| M10 record: mark without a disclosure | **alive** |
| M11 record: never mark | killed |
| M12 record: drop the `disclosed_at IS NULL` guard | alive (timestamp only) |
| M13, M14 buttons cleared wrongly | killed x2 |
| M15, M16, M19 order or content of `preferred` | **alive x3** |
| M17 empty reply stored as `''` | killed |
| M18 `last_language` set when unsupported | **alive** |
| C1 skip `languageSupported` | killed |
| C2, C3, C20, C21 loosened limits | killed x4 |
| C4, C5, C6, C8, C15, C16, C18 reader rules | killed x7 |
| C7 remove the F3a button check | alive (dead code) |
| C9, C10, C12, C17, C19 fill rules | killed x5 |
| C11 fill: inherited keys | alive (equivalent) |
| C13, C14 set and tenant default | killed x2 |
| H1, H2, H3 `call` | killed x3 |
| H4 button check on the body only | **alive** |
| T1, T2, T3 `turn.ts` flag | killed x3 |
| W1 loader skips a misnamed file | **alive** |
| W2 loader error repeats the file's content | **alive** |

## Could not fault

- RLS: the joins on `tenants`, `contacts` and `sessions` return rows for the app role. The tests use that role and the disclosure is sent.
- Cross-tenant receipt with the same message id: no effect (probe A).
- Retry after an unknown outcome: the disclosure is carried again and the session is marked only on acceptance (probe D).
- No path stores the model's text in `lead` or `disclosure`. `sessionHistory` reads `body` only, and the test for it is real.
- Problem messages from the reader name only code-side text names. `__proto__` keys are refused at both levels.
- `{{constructor}}` is not filled.
- The down migration reverses the up, by reading.
- STATUS, guardrail section 7, the README language table and the traceability row match the code, apart from R2 and R12.

---

## Author's response

The High finding is accepted and fixed. **These fixes are checked by a
second agent in `2026-11-25-gate4-u8-fixed-texts-verification.md`**; what
is left is #334.

| Finding | Answer |
|---|---|
| R1 (High) | Accepted and fixed. A receipt that matches no message of ours is kept (`early_receipts`, in migration 0011) and applied when the send it is about is recorded; the two take the same lock on the channel's identifier, so a receipt either finds the message or is kept before the record looks. A message so reported failed ends `failed`, and its session is not marked. This also mends the loss of any status that arrives early, which M2 knew of and had left. A kept receipt for a message that is never ours is removed after a day |
| R2 | Accepted: the sentence was wrong and is taken out of the note and the data model. What is true: a customer can read a message without the disclosure when the one that carried it fails after a later one was sent, and if nothing more is sent in the session they are not told in it. Messages already waiting are not decided again when the mark comes off; that is in the follow-up issue |
| R3 | Accepted: the three tests are added, and the mistitled one is renamed and given its second tenant |
| R4 | Accepted in part. The reader now refuses line and paragraph separators, zero-width spaces, direction marks and half pairs, in bodies, titles and filled-in values, and the worker's loader runs the channel's own check on every text with its buttons before it starts. Not all of `\p{Cf}`: Arabic, Urdu, Hindi and Bengali need the joiners in it. A key given twice in a file is still read as its last value; in the follow-up issue |
| R5 | Accepted and fixed: no brace outside a place in a body, none in a value, and the result is tested again |
| R6 | Accepted in part. Fixed: each button must be a payload and a title; a fixed part is not blank; `finishTurn` refuses an empty reply with nothing before it; the worker does not send the disclosure alone. Not added: the check that a text has a body or a lead, since tests of earlier units store such rows on purpose and the worker now refuses them; two identical buttons and a disclosure on a waiting row are not refused by the table |
| R7 | Not changed here: the options stay optional for the tests of earlier units. In the follow-up issue |
| R8 | The check that cannot fire is kept, as it guards the numbers if they change. The bound for a lead that is filled in is now stated in the note as not yet met; in the follow-up issue for the unit that first sends one |
| R9 | The test is added. A message sent without its buttons whose outcome is never known keeps them on record; in the follow-up issue |
| R10 | Accepted: a test with four made-up languages goes through the database |
| R11 | Accepted: the tenant is named in the statement |
| R12 | Accepted: the note now says "what the last try sent, or would have" |
