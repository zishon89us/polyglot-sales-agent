# Gate 4 review of M3 unit U2, 2026-11-23

The report of a second agent on the code of unit U2 (sessions, the reply
window, the batching window, overtaken replies), unedited, and before it
what the author did. The reviewer ran the tests and 43 mutants against a
database. It reviewed commit `d605d48`. That commit's header is three
characters too long for the commit-message check, which neither the
author nor the reviewer ran on it before it was pushed; see the pull
request for what was done about it.

## Author's response

| Finding | Done |
| --- | --- |
| G1 a delivery or read receipt counted as an acceptance | Accepted; the fault was mine and the test I wrote pinned it. A status no longer touches a session. Only the worker's record of its own accepted call moves a session's time or ends a run of dropped replies. The S8 test is rewritten to show a receipt moves nothing and the session still ends; a D6 test shows a receipt does not reset the count |
| G2 rows 38 and 40 said "not built" | Accepted. Both say they are built, and the section says they are its exception |
| G3 no tenant-crossing test for the three new references | Accepted. Three attempts as tenant A, each refused by the key |
| G4 the lock test for starting a turn could not fail | Accepted. The holder now stores a message while the turn waits; the turn's batch must hold it |
| G5 D6's hold-back guard and the time comparison untested | Accepted. The second D6 test claims the reply after the newer message arrives; a new test shows an older open message does not hold a reply |
| G6 a second deadlock shape, through statuses | Gone with G1's fix, as the verifier showed: a status now takes one message row and nothing after it. The note says so |
| G7 a turn that ends after its session's 24 hours stored a reply in a new session | Accepted. Ending a turn checks that the session it read is still the open one, and otherwise stores nothing ("session-over"). Tested. `sessionFor` no longer has an outbound case |
| G8 seven rules no test noticed | A test or an assertion for each: the duplicate looked for again under the lock; a reply whose call ended unknown left alone at a session's end; the migration's 24-hour boundary; its "earlier of the two times"; the unique index; the check on `answered_by`; the one-microsecond stamp |
| G9 sessions ended by the migration kept open messages and replies | Accepted. The migration closes them as S3 does; tested |
| G10 sentences in the documents | Corrected: one job per conversation per webhook; what moves `last_message_at`; the traceability row; the note's "As built" lists the tests not written. "Six rules broken on purpose" is removed from STATUS: there is no record of which |
| G11 the lock test counted waiters in every database | Counts this database's only |
| G12 the real-time test's lower bound | Measured on the database's own times, with no slack |
| G13 row 40 described only a stopped worker | The late-delivery case is in the row and the note |
| G14 a job that waits over 3 seconds on the lock | Not changed. For U7's note: a made reply would be thrown away and made again |
| G15 a held-back reply can be overtaken by a later system reply | Not changed: no system reply exists in U2. For U8 and U9 |
| G16 `SESSION_STATES` unused | Removed |
| G17 equal times, and a clock stepping back | Not changed |

The N1 to N30 table: N12 and N14, which the reviewer marks "response
misstates", are G1 and G3 and are fixed as above. The "partly" verdicts
are G4, G6, G9, G10 and the tests listed as not written.

Left for the follow-up issue #321: G14, G15, G17, and the tests the
note's "As built" lists as not written.

## The report

# Gate 4 review: M3 U2 (sessions, reply window, batching, overtaken replies)

Branch `feat/301-m3-u2-sessions` at d605d48, reviewed in `/tmp/u2review` (a copy). PostgreSQL 16 answered; tests and mutants were run.

## Verdict

**Merge after fixes.** The lock of section 0, the session function, the window arithmetic and the migration do what the note says in every case I could drive, and the baseline is stable (9 new/changed files x3: 360/360 each; whole suite once: 956/956). Four things should be fixed first. (1) A `delivered` or `read` receipt is treated as an acceptance: it resets `reply_discards` and moves `last_message_at`, so D6's bound and the 24-hour session rule are both broken by ordinary receipts (G1, shown by experiment). (2) Decisions rows 38 and 40 tell the maintainer "Proposed, not built" under a heading "nothing is built on them yet"; both rules are built and active (G2). (3) The note and the review response claim tenant-crossing tests for the three new references; none exists and the three mutants survive (G3). (4) Two tests named for the lock and for D6 cannot fail for the thing they name (G4, G5). The rest is Low or Note.

## Findings

| ID | Sev | Where | What | Evidence | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| G1 | High | `inbound.ts:290-294`; `sessions.ts:131-141`; `sessions.test.ts:251-264` | `noteAccepted` runs for every status that is not `failed`, so `delivered` and `read` receipts count as "accepted". (a) They reset `reply_discards` in the middle of a run of drops: D6's "third reply" is then dropped, or, once stored, becomes held back and is discarded. (b) They move `last_message_at` to the time the receipt was stored, so a read receipt keeps a session open although no message passed for 24 h (glossary; S8 says "moves to that time [of acceptance]"). The case the note names, a `sent` event arriving before the call is recorded, cannot match at all: `FORWARD` matches on `channel_message_id`, which is null until `recordSend`. The S8 test called "a status event that tells of the acceptance first" in fact sends `delivered` two hours after `recordSend` and asserts the session moved to 2 h, so it pins the fault. | Scratch test E1: r0 accepted; two counted drops (count 2); `read` for r0 → `statusesApplied 1`, count 0; third `finishTurn` returns `newer-message`. E5: forced third reply stored; newer m5; `read` for r0 → `claimNextSend` = `wait 5000`; next `beginTurn` discards "third (forced)", count 1. E2: m0 at 0, reply accepted 3.1 s, `read` at 23 h, m1 at 25 h → one session, `last` 25 h. E3: `sent` for a `sending` row → `statusesApplied 0`. | Call `noteAccepted` from the status path only when the status moved a row out of `sending` (or drop the call: unreachable today), never for `delivered`/`read` of a row already `sent`. Rewrite the S8 status test; add E1/E2 as tests. |
| G2 | Medium | `docs/decisions-needed.md` rows 38, 40 (lines 44, 46, under "Raised by the M3 plan; nothing is built on them yet") | Both say "Proposed, not built". D6 is built with `REPLY_DISCARDS_MAX = 2` (`conversation.ts:21`, `outbound.ts:154, 224-233, 335`) and W2/S3 are built (`outbound.ts:136-149`, `sessions.ts:77-81`). architecture.md, state-machines.md and data-model.md in the same PR say "As built ... (decisions row 38/40)". The maintainer is told a "no" costs nothing built. | Text of the rows against the code and against the three design documents. | Say "Built as proposed; a no means ...", and move the rows out of the "nothing is built" section. |
| G3 | Medium | Note §6 last paragraph; review response N13/N14; `isolation.test.ts:218-224` | "The tests that try to cross tenants gain the new table and its three references (NFR-S1)" is not true. The only changed cross-tenant insert uses B's conversation with A's session and is refused by the conversation key, as before. Nothing tries A's message with B's session, `answered_by` at B's message, or A's session on B's conversation. "As built" does not admit it. The schema itself is right (composite keys). | Mutants X30, X31, X32 (each key without `tenant_id`) survive isolation + sessions + migrate tests. | Three inserts/updates as tenant A expecting 23503, beside line 218. |
| G4 | Medium | `sessions.test.ts:654-659` | "starting a turn waits for it" cannot fail without `lockConversation` in `beginTurn`: `takeLease`'s UPDATE of the same row waits on the held lock anyway, after the session and the batch were read unlocked. The note promises "so that the test fails without the lock". | Mutant M1b (lock replaced by a plain existence read) survives sessions, worker, outbound tests. | Assert what the lock protects: hold the row, start `beginTurn`, store a message through a second path before releasing, and check the turn's batch contains it; or check `pg_locks` shows the waiter before any `sessions` row lock is held. |
| G5 | Medium | `sessions.test.ts:521-538` | D6 test says "It is not held back either, though m4 is newer". m4 is stored at 9 300, the reply at 9 400: by `HELD_BACK`'s own rule m4 is not newer, so the claim would succeed with the `reply_discards < MAX` clause removed. In the forced-store path the newer message is always older than the reply, so that clause only matters for a message stored after a reply while count is 2, which no test claims. The `newer.created_at > m.created_at` clause is untested as well. | Mutants X18 (clause removed from `HELD_BACK`) and X21 (time comparison removed) survive. | In the second D6 test, claim r3 after m4 arrives and expect `send`; add a test with an older unhandled message and a reply that must not be held. |
| G6 | Low | Note §0 "Order of locks in any transaction"; `inbound.ts:283-296` | The status path takes a message row (`FORWARD`) and then its session (`noteAccepted`) for conversations it has not locked, after holding other conversations' locks. New deadlock shape, not the X-then-Y one the note admits: webhook A = message for X + status for a reply in Y; webhook B = message for Y + status for a reply in X. | Scratch test E10 (third connection holds the two reply rows, then lets go): one `storeInbound` ends 40P01. API answers 503 and the channel resends, so nothing is lost. | Add it to "Known limit", or apply statuses before messages / in a second transaction. |
| G7 | Low | `outbound.ts:219-259`; `sessions.ts:54-90` | A turn begun just under 24 h after the session's last message and ended after it: `sessionFor(..., "outbound")` ends the session (marks the batch dealt with, no reply), opens a new session whose only row is the reply, the reply is sent, and the batch's `answered_by` stays null. The record says "not answered"; the customer was answered, after the reply window closed. `newer`/`counted` still read `turn.sessionId`. | Scratch test E4: begin at 24 h − 1 ms, finish at 24 h + 1 s → `stored`; two sessions; inbound handled, unanswered; reply `pending` in session 2; `claimNextSend` returns it. | In `finishTurn`, if the open session is not `turn.sessionId`, store nothing and release (the batch was closed by S3). |
| G8 | Low | Tests | Rules with no test that notices: the duplicate re-check under the lock (M11); session end leaving a D4 reply alone (M9b); the backfill's 24-hour boundary (M15); the backfill's "earlier of the two times" (X34); the unique index on open sessions, S5's "second guard" (X33); the check that only an inbound row has `answered_by` (X35); the one-microsecond stamp per row (X27, survives by luck of `ORDER BY created_at, id`). | Mutant table below. | One assertion each. |
| G9 | Low | `0006_sessions.up.sql:79-84`; note §6 table | Sessions the migration ends get `ended_at` only: their unhandled customer messages keep `handled_at` null and their `pending` replies stay `pending`, unlike a session ended by S3. Harmless today (batch and hold-back are per session; the send job expires the replies), but the invariant "an ended session has nothing open" does not hold for old rows and the table does not say so. | Reading; the migration test asserts no `handled_at`. | Mark them in the migration, or add a row to the table. |
| G10 | Low | Documents | (a) architecture.md "Timers" row and note §3: "each message queues its own job"; built: one per conversation per webhook ("As built" says it, architecture does not). (b) data-model.md `last_message_at`: also moved by receipts (G1) and set by an outbound row that starts a session (G7). (c) traceability.md: "each case of the design note by name": B5, B6, W3, P1–P3 have no test in the file (B5, B6 are M2's tests elsewhere). (d) Note "Tests" promises, not written and not listed under "As built": the wake table "row by row" (the D6-store and claim-runs-out rows have no worker-level test), "D3 and D2 with the send job and the turn racing for the lock" (both are sequential), the tenant-crossing tests (G3). (e) STATUS "six rules broken on purpose": nothing records which; not checkable. | Reading. Counts checked: 48 new tests (38 + 4 + 6) right; 956 right (ran); 19 units right. | Correct the sentences. |
| G11 | Note | `sessions.test.ts:631-634` | `whileHeld` counts `pg_locks WHERE NOT granted` for the whole cluster and wants an exact number; test files run in parallel on one server. A waiter in another file's database can delay or, rarely, falsely satisfy it. | Reading; no failure in 4 baseline runs. | Filter on `database = (SELECT oid FROM pg_database WHERE datname = current_database())`. |
| G12 | Note | `worker.test.ts` real-time test | Lower bound is `waited >= 3000 − 50` measured from after `storeInbound` returned; a commit slower than 50 ms after the stamp fails it. Upper side is a 10 s poll. Passed 4 of 4 here. | Reading. | Read `created_at` of the last message from the database and compare `sent_at`. |
| G13 | Note | `outbound.ts:136-149`, `inbound.ts:257-264` | W2 turns on the channel's timestamp. A message stored now with a channel time over 24 h old (E7), or a garbage time, is marked and never answered; only a log line `turn-skipped window-closed`. This is the note's W1/W2 and row 40; said here because row 40 describes only "a worker stopped for a day". | Scratch test E7. | Add the case to row 40. |
| G14 | Note | `connect.ts:27`; `handlers.ts:122-139` | A webhook that waits over 3 s on the conversation lock is answered 503 (resent). A job that does so fails with 55P03 and uses one of its six attempts; in `finishTurn` the made reply is thrown away and made again (a model call from U7). All four transactions are short, so this needs a stalled database. | Reading. | None now; note for U7. |
| G15 | Note | `outbound.ts:341-355` | `OLDEST_WAITING` skips a held-back reply, so a later system reply (from U8/U9) is sent before an older assistant reply that is then released (D9): order within a conversation (NFR-R6) inverts. No such message exists in U2. | Reading. | For U8/U9. |
| G16 | Note | `names.ts:42-44` | `SESSION_STATES` is exported, used nowhere, and not read by `tools/names-check.ts` (note admits the second). No `state` column exists. | grep. | Wire into names-check with state machines §3, or leave out until used. |
| G17 | Note | Clock | With the test clock two webhooks at the same `now` get equal `created_at`; `HELD_BACK`'s `>` then does not hold the reply (E6). In production `clock_timestamp()` is read after the lock each time (E8: 50 rows, 50 distinct, min gap 1.7 ms). A backwards clock step makes a later message look older: reply not held (sent, as D3), window not re-opened (`first` undefined → turn at once). Nothing corrupts; `greatest` protects both times. | E6, E8, reading. | None. |

## A. Cases

| Case | Implemented | Tested | Verdict |
| --- | --- | --- | --- |
| §0 lock first | storeInbound `inbound.ts:226` (after contact work and the cheap duplicate pre-read; re-read under lock); beginTurn `outbound.ts:94`; finishTurn via `holdsLease` `:216`; claimNextSend `:425`; recordSend `:535-542` (one unlocked read of the immutable `conversation_id` first) | `sessions.test.ts:617-722` | OK in code. beginTurn's test cannot fail (G4). Status path breaks the stated order (G6) |
| S1, S2, S3 | `sessions.ts:98-122`, `54-90` | S1, S2, S3 x2 | OK |
| S4 | `sessions.ts:60` (`<=`) | S4 (X23 killed) | OK |
| S5 | lock + `sessions_one_open` | S5 with two waiters | OK; index untested (X33) |
| S6 | `stamp` per row | S6 | OK; offset untested (X27) |
| S7, S9 | `sessionFor(..., "outbound")` | S7, S9 | OK, except G7 |
| S8 | `noteAccepted` | 3 tests | **Differs**: receipts move it (G1) |
| S10 | `openSession` | S10 | OK |
| S3 effects | `sessions.ts:77-88` | S3 second test, S10 | OK; M9b survives |
| W1 | `inbound.ts:257-264` | W1 | OK |
| W2 | `outbound.ts:136-149`, on `last_inbound_at` (As built) | W2 + worker test | OK |
| W3 | not built | — | As the note says |
| B1–B4 | `outbound.ts:102-131`, `conversation.ts:33-38` | B1–B4, core tests, worker burst | OK |
| B5 | lease | M2 worker test | OK |
| B6 | `finishTurn` with no reply | M2 outbound test; D7 | OK |
| B7 | `turn_started_at` | B7 x2 | OK |
| Wake table | `inbound.ts:272-281`; `handlers.ts:104-117` | rows 1–3 tested; "newer message's job" only through the NFR-R6 burst; D6-store and claim-runs-out rows untested at worker level | Code OK; one job per conversation per webhook (As built) |
| D1 | `outbound.ts:219-234` | D1 x2 | OK |
| D2 | `HELD_BACK`, `outbound.ts:154-175` | D2 x2, worker x2 | OK |
| D3 | claim under lock | D3 (sequential) | OK |
| D4 | `unknown_outcomes = 0` in both | D4 | OK |
| D5 | class filter | D5 | OK |
| D6 | three `< MAX` guards; reset in `noteAccepted` | D6 x3 | **Differs**: reset by receipts (G1); hold-back guard untested (G5). Count never exceeds 2 (X19, X20 killed) |
| D7 | `answered_by` | D7 | OK |
| D8 | 15-minute bound in both | D8 + M2 tests | OK |
| D9 | `HELD_BACK` re-read each look; 5 s poll | D9 | OK. Poll ends: at discard (`none`), at release (sent), or at 15 min (expired) — at most ~180 looks per reply |
| §5 other tenant's conversation | `lockConversation` false → throw `conversation-not-found` in beginTurn and claimNextSend; six tries, dead | worker "a job that names another tenant's conversation ...", outbound "cannot be begun or ended ..." | OK |
| §6 migration | 0006 up/down, transactional (runner) | one test | OK; boundary and tenant keys untested (G3, G8); G9 |

Concurrency answers not in a finding: B3 strictly increasing in production (E8). B5 no endless spin found: every `pending` row the query skips is a held-back reply, and holding ends at 15 minutes. B7 the lease is taken before W2 (`:132` then `:136`); `replyDiscards` is read `FOR UPDATE` under the conversation lock, so it is not stale. B8 no lost update (row lock, values recomputed on the current row); deadlock only as G6. Counter (C): incremented at `outbound.ts:171` (once per turn that discards) and `:225` (guarded `< 2`, only with a reply); reset only at `sessions.ts:135`; a session whose replies all fail stays at 2, which only stops holding and discarding. Security (E): `report("turn-skipped", "window-closed")` carries a constant; `HELD_BACK`, `OLDEST_WAITING`, `DAY` interpolate only numeric constants and parameter numbers. Scope (I): no new dependency; no SQL outside `packages/db` in source; test numbers are +1555 01xx; nothing of a later unit built except the unused `pack_outcome` column (ADR 0014) and `SESSION_STATES`.

M2's proofs: US-C1 exactly-once (5 deliveries) kept. NFR-R6 kept, weakened in wording only (statuses `sent` or `discarded`, sent count equals the mock's; X22 kills it). The rewritten retry-order test now proves order for our own messages, not for a customer's second message, which is D2's. NFR-R2's new test deletes the jobs and relies on a third message; recovery by the same job's claim running out is not shown.

## F. Mutants (all restored; `git status` clean after each batch)

Files: s = sessions.test, w = worker.test, o = outbound.test, i = inbound.test, a = app.test, iso = isolation.test, m = migrate.test.

| # | Mutant | Run | Result |
| --- | --- | --- | --- |
| 1 | `lockConversation` removed from beginTurn (with its throw) | s,w,o | Killed, but only by the cross-tenant tests |
| 1b | same, existence check kept without the lock | s,w,o | **Survived** |
| 2 | removed from claimNextSend (existence check kept) | s,w,o | Killed (lock test) |
| 3 | removed from recordSend | s,w,o | Killed (lock test) |
| 4 | W1 uses stored time only | s,w,i | Killed |
| 5 | W2 check removed | s,w | Killed |
| 6 | `turn_started_at` never written | s,w,o | Killed (B7 second test only) |
| 7 | 15-minute bound removed from the turn's discard | s,w,o | Killed |
| 8 | 15-minute bound removed from `HELD_BACK` | s,w,o | Killed (D8) |
| 9a | `unknown_outcomes = 0` removed from the turn's discard | s,w,o | Killed (D4) |
| 9b | same, from the session-end discard | s,w,o | **Survived** |
| 10 | `noteAccepted` not called from the status path | s,w,i,a | Killed, by the test that pins G1 |
| 11 | duplicate re-check under the lock removed | s,w,i,a | **Survived** |
| 12a | session end does not mark messages | s,w,o | Killed |
| 12b | session end does not discard replies | s,w,o | Killed |
| 13 | handler returns undefined on `wait` | w | Killed |
| 14 | `runInMs` removed | s,w,i,a | Killed |
| 15 | backfill `< 24 hours` → `<=` | s,m | **Survived** |
| 16 | reset of `reply_discards` removed | s,w | Killed |
| X17 | `lockConversation` removed from storeInbound | s,w,i | Killed |
| X18 | `reply_discards < MAX` removed from `HELD_BACK` | s,w | **Survived** |
| X19 | `< MAX` removed from beginTurn | s,w | Killed |
| X20 | `< MAX` removed from finishTurn | s,w | Killed |
| X21 | `newer.created_at > m.created_at` removed | s,w,o | **Survived** |
| X22 | discarded reply's messages not reopened | s,w | Killed |
| X23 | `openSession` `<=` → `<` | s | Killed |
| X24a | `ended_at IS NULL` removed from noteAccepted | s,w | Survived (the time guard covers it) |
| X24b | time guard removed from noteAccepted | s,w | Killed |
| X25 | W1 `greatest` removed | s,w,i | Killed |
| X26 | `unknown_outcomes = 0` removed from `HELD_BACK` | s,w,o | Killed |
| X27 | per-row stamp offset always 0 | s,w,i | **Survived** |
| X28 | W2 does not release the lease | s,w | Killed |
| X29 | D1 counted with no reply | s,w | Killed |
| X30 | `messages_session_fk` without `tenant_id` | iso,s,m | **Survived** |
| X31 | `messages_answered_by_fk` without `tenant_id` | iso,s,m | **Survived** |
| X32 | `sessions` → `conversations` key without `tenant_id` | iso,s,m | **Survived** |
| X33 | `sessions_one_open` not unique | iso,s,m | **Survived** |
| X34 | backfill of `last_inbound_at` from `created_at` only | s,m | **Survived** |
| X35 | `answered_by` check made vacuous | iso,s,m | **Survived** |
| X36 | inbound message does not move `last_message_at` | s,w | Killed |
| X37 | handler returns undefined on `busy` | w | Killed |
| X38 | lease taken before the window answer | s,w | Killed |
| X39 | migration ends every session (`>=`) | s,m | Killed |

## G. Design review N1–N30

| N | Verdict | Note |
| --- | --- | --- |
| N1 | Fixed | Lock in all four; the interleaving test exists. beginTurn's own lock test is weak (G4) |
| N2 | Fixed | Rule withdrawn; batch is the open session's; session end closes |
| N3 | Fixed | D8; M2's expiry tests kill mutant 7 |
| N4 | Fixed | Storing discards nothing |
| N5 | Fixed | `turn_started_at`; B7 tests |
| N6 | Fixed | W2 at turn start; row 40 exists but misstates "not built" (G2) |
| N7 | Partly | Order stated, but the status path does not keep it and a second deadlock shape is not in the known limit (G6) |
| N8 | Partly | Table present; window before lease (X38 killed). "Every stored message queues a job" is one per conversation per webhook, and the table is not tested row by row |
| N9 | Partly | Clocks added; lock tests with a third connection. S5/claim/record tests can fail; beginTurn's cannot (G4) |
| N10 | Partly | One function; ended session never moved. But a live session is moved by receipts (G1), and see G7 |
| N11 | Fixed | |
| N12 | Response misstates | "The reset from both accept paths": the status path cannot see an acceptance first; what it adds is a reset on `delivered`/`read` (G1). (a), (b), (c), (e) are defined and built |
| N13 | Partly | Table of rows present and built; G9 not said |
| N14 | Response misstates | Keys, checks, index built. "The tenant-crossing tests named": named, not written (G3) |
| N15 | Fixed | Plan, row 18, decision 18 corrected; 0004's fault assigned to M6 |
| N16 | Fixed | Departures listed; (h) no longer applies |
| N17 | Fixed | Row 39 withdrawn |
| N18 | Partly | The numbers are in row 38; the row says "not built" (G2) |
| N19 | Fixed | Residual through a status event's row lock only delays 5 s (`held` query) |
| N20 | Partly | Built (`inbound.ts:229-236`); `contactFor` still runs first (idempotent); untested (M11) |
| N21 | Fixed | |
| N22 | Fixed | |
| N23 | Fixed | |
| N24 | Fixed | |
| N25 | Partly | Several named tests not written and not all admitted (G10 d) |
| N26 | Fixed | |
| N27–N30 | Fixed | Said in the note |

## What I did not check

- Tests were run: the 9 new/changed files three times (all passed), the whole suite once (956 passed), 43 mutants, and two scratch files of experiments (E1–E10), since deleted. Not run: `make e2e`, `tools/` checks, lint, typecheck.
- The original repository was not touched; whether its working tree equals the copy at review time was not re-verified after the copy.
- Whether Meta sends `delivered`/`read` receipts in the volume G1 assumes, or batches messages and statuses of different customers in one webhook (G6): no live webhook was seen.
- The deadlock of the note's own known limit (X then Y) was not reproduced; only G6's shape.
- `apps/api` sink and webhook code beyond how they call `storeInbound` and answer errors; `apps/ops`; ADR 0014 beyond `pack_outcome`; AGENTS.md read only for the limits asked about.
- Behaviour with workers running during 0006: by reading only (old code's inserts fail on `session_id NOT NULL`; `ALTER TABLE` waits on, and blocks, every statement on `messages`).
- "Six rules broken on purpose" (STATUS): no record to check against.
- The second D6 behaviour under a real clock, a backwards clock step, and `lock_timeout` expiry: by reading.
