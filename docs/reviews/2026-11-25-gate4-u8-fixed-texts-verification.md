# Verification of the Gate 4 fixes: M3 U8

Checked: commit `c919040` on `feat/307-m3-u8-fixed-texts`, by an agent
that wrote neither the code nor the review, working in a copy of the
repository. The report is unedited, except that characters that cannot
be seen are written as `\uXXXX`. The author's response follows it.

---

# Verification of the Gate 4 fixes, M3 U8 (commit `c919040`)

**Read:** the review and the response table; the fix diff for `packages/db/src/{inbound,outbound}.ts`, migration 0011 up and down, `packages/core/src/texts.ts`, `apps/worker/src/{texts,handlers}.ts`; `lockConversation`, `noteAccepted`, `withTenant`; the channel's `checkButtonMessage`; note cases D2b and D2c and the data-model's `early_receipts` section.
**Ran:** the three test files (65 pass); 7 temporary probe tests in `disclosure.test.ts` (5 for R1, two using a third connection to force the interleaving; 2 for R6); a node script against the reader, the loader and `fillFixedText` (21 listed fills, 200,000 random fills, 57 file variants); the 9 mutants.
**Restored:** `git status --short` is empty.
**Not checked:** the down migration was read, not executed. `packages/db/test/*` and `tools/e2e.test.ts` were not run. I did not establish what the lost-call sweep does with the message left `sending` in V1. Cross-tenant deletion by the cleanup was reasoned from the policy, not measured.

## Findings of the review

**R1: partly fixed.** The lost failure is fixed; the fix adds a deadlock (V1) and an ordering fault (V2).
- Both orders on the lock, forced with a third connection, end `failed`, session not told, 0 kept rows: receipt queued first (kept, then applied), and `recordSend` queued first (receipt then finds the message, `statusesApplied: 1`).
- Both transactions are READ COMMITTED and the lock is held to commit, so I found no interleaving that loses the failure or leaves the session marked.
- RLS holds: tenant B's kept `failed` for A's identifier was not applied by A's `recordSend` (message `sent`, B's row still there). `recordSend` and the cleanup run inside `withTenant`, so their unqualified `DELETE`s see one tenant.
- The same status twice is one row (unique constraint).
- Growth is bounded to about a day of strays per tenant, but only while that tenant keeps new ones; a tenant that goes quiet keeps its last rows.

**R3: fixed.** Mutants (a) and (b) are killed, and the cross-tenant test now has its second tenant.

**R4: partly fixed.**
- UNSEEN and LONE are applied to bodies, titles and values; ZWNJ and ZWJ are still accepted in a body.
- The loader does run `checkButtonMessage`. Its messages repeat only the file name and the text's name.
- The response says "direction marks" are refused: \u200e, \u200f and \u061c are accepted in a body and a value; only embeddings, overrides and isolates are refused.
- The reader alone accepts a title of only \u200c, \u200d, \u00ad, \u3164 or \u2800; the loader catches those.
- Both accept "Get messages\u2800" and "Get messages\ufff9" beside "Get messages".
- Texts without buttons get no channel check at all.

**R5: fixed.** Both of the review's cases return `undefined`; 0 of 200,000 random fills returned a brace; the reader refuses `{x}` and `}}{{`. Full-width braces pass, harmlessly.

**R6: partly fixed.** See V3 and V4. The down migration drops everything the up adds, in a workable order, by reading.

**R9: fixed** for the test (mutant (c) killed). The kept-buttons point is deferred, as the response says.

**R10: partly fixed.** (e) and (f) are killed, (d) is alive: see V5.

## New findings

**V1 — Medium — `packages/db/src/inbound.ts:306-353` against `outbound.ts:888-921`. Deadlock, measured.**
- `recordSend` locks conversation, message, the advisory lock, then the session row (`noteAccepted`). The status loop takes an advisory lock, then possibly a session row (the D2a `UPDATE`), then the next status's advisory lock.
- Probe: one webhook holding `failed` for N (carried the disclosure, same session) and `delivered` for X, while `recordSend(X)` ran. PostgreSQL raised `40P01` and `recordSend` was the victim.
- Result: the message the channel had accepted stayed `sending` with no identifier, the job was requeued with `last_error: 40P01`, and the kept `delivered` row can never apply.
- The natural window is a few milliseconds and needs both receipts in one batch. Two webhooks with the same identifiers in opposite orders can deadlock the same way.
- Change: before the status loop, take every status's advisory lock, sorted, so the order is conversation, advisory, message, session everywhere. Add a test with two connections.

**V2 — Low — `outbound.ts:905-909`. "A failure last" makes the failure lose.**
- Kept `failed` then `delivered`: the message ends `delivered` and the session is told. The same two receipts arriving after the record end `failed`, not told.
- `FORWARD` refuses `delivered` to `failed`, so applying the failure last drops it. This contradicts D2b's "the message ends failed".
- Change: apply `failed` first, or in arrival order (`ORDER BY created_at`).

**V3 — Low — `apps/worker/src/handlers.ts:99`. The disclosure can still go alone.**
- A row with body `" "`, `"\n"` or `"\u200b"` and no lead was sent as the disclosure plus that blank, and marked the session. Only an empty or null body is refused.
- `turn.ts:254` trims today, so nothing writes such a row.
- Change: test the parts with the channel's `blank`, or add a table check on `body`.

**V4 — Low — `0011_fixed_texts.up.sql:33-39`.** Accepted by the table, measured:
- buttons `[[{"payload":"a","title":"b"}]]`, `[{"payload":["x"],"title":"t"}]`, `[{"payload":"a","title":["t"]}]` (lax jsonpath unwraps arrays);
- `[{"payload":"","title":""}]`, and a button with extra keys;
- a `lead` or `disclosure` of `\r\n`, `\r`, \u00a0, \u200b or \u000b.

The worker's own check drops such buttons, so the harm is a false record. Change: use `strict` jsonpath, or `jsonb_typeof` per key with a length; use `!~ '\S'` for blank.

**V5 — Low — `outbound.ts:811`.** The order of `preferred` in `claimNextSend` is still untested: mutant (d) survives. The response's "accepted" for R10 overstates. Change: one case where the message's language differs from the contact's last.

**V6 — Note — docs and the response.**
- The response says a stray receipt "is removed after a day"; the data model says it truthfully (only when that tenant keeps another).
- D2b needs V2's exception.
- "Each button must be a payload and a title" is not what the table enforces (V4).
- Migration 0011 was edited in place: a database already at 0011 gets no `early_receipts`.

## Mutants (9 run; 8 killed, 1 alive)

| Mutant | Result |
|---|---|
| (a) D2a `NOT EXISTS` ignores `other.disclosure` | killed |
| (b) `recordSend` marks without `m.disclosure IS NOT NULL` | killed |
| (c) buttons checked against the body alone | killed |
| (d) `preferred` reversed in `claimNextSend` | **alive** |
| (e) `last_language` set for an unsupported language | killed |
| (f) the lead's `preferred` without `made.language` | killed |
| (g) loader skips a misnamed file | killed |
| (h) `recordSend` does not apply kept receipts | killed (2 tests) |
| (i) `recordSend` marks although the message is failed | killed |

No existing test uses two connections, so nothing would catch removing `RECEIPT_LOCK` or reordering the locks.

---

## Author's response

**These last fixes are checked by the author only.** What is left is #334.

| Finding | Answer |
|---|---|
| V1 (Medium) | Accepted and fixed by the order of locks: a webhook takes the lock of every identifier it reports on first, sorted, before it changes any row, and the record of a send takes its identifier's lock before the message's row. The order is then the conversation, the identifier, the message, the session, everywhere. **The test added for it passed against the code before the fix as well**, so it shows only that the path runs: the deadlock's absence rests on the order of locks, not on a test. A test that forces the interleaving with a third connection is in the follow-up issue |
| V2 | Accepted and fixed: kept receipts are applied in the order they arrived, and of two kept in one moment the failure first. A test fails without it |
| V3 | Accepted and fixed: the worker sends nothing whose lead and body hold nothing a reader would see |
| V4 | Accepted and fixed: a function checks each button (an object of exactly a payload and a title, both texts of bounded length, the title not blank), and a fixed part must hold a character that is not white space. A lead of a zero-width space alone is still accepted by the table; the reader refuses such a text before it is stored |
| V5 | Accepted: a test where the message's own language differs from the session's and the contact's last |
| V6 | The response to the review is left as written and corrected here. A stray receipt is removed only when the same tenant keeps another after a day, as the data model says. "Direction marks" meant embeddings, overrides and isolates: the left-to-right and right-to-left marks and the Arabic letter mark are allowed, since right-to-left text uses them. A title that only looks like another through a blank Braille or filler character is not refused; in the follow-up issue. Migration 0011 was changed in place because it is not merged: no database outside a developer's has it |
