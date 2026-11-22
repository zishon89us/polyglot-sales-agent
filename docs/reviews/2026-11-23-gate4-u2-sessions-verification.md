# Check of the fixes to M3 unit U2, 2026-11-23

A third agent checked commit `8c86843` against the response in
`2026-11-23-gate4-u2-sessions.md`, with the tests, scratch experiments
and 24 mutants against a database. Its report is below, unedited; what
the author did about it comes first. **These last changes were checked by
the author only**, each new test by breaking the rule it names.

## Author's response

| Finding | Done |
| --- | --- |
| G1 | Confirmed fixed by the verifier's own experiments |
| Y1 the lock test for starting a turn still could not fail for the lock | Accepted. The holder now stores a message that reopens the batching window: with the lock the turn is told to wait, without it the turn starts |
| Y2 the migration's discard of old replies untested | Accepted. An unsent reply in an ended session is in the test and must end `discarded`; the one in the open session must stay |
| Y3 the note described a deadlock the fix had removed | Accepted; the note and the response to G6 say it is gone |
| Y4 `session-over` reported nowhere; row 40 overstated | The worker reports `turn-skipped session-over`. Row 40 says what is reported and what is not. No test at the worker reaches it: a handler's clock cannot move between starting and ending one turn |
| Y5 a different open session at the end of a turn untested | Accepted; a test |
| Y6 the way back does not undo the marks | Said in the down file and the note |
| Y7 the commit header | See the pull request |
| Y8 a `sent` status can never match a message being sent | The comment says so; the cases are left in the statement |
| Y9 the response named no issue | #321 |
| G10 (a) in the note | Corrected in section 3 and Departures |

Not done: a `failed` status after an acceptance leaves the session's time
and the count as the acceptance set them (the verifier's check 6); it was
so before this unit and is added to #321.

## The report

# Verification of the Gate 4 fixes: M3 U2, HEAD 8c86843 (reviewed state d605d48)

Done in `/tmp/u2verify` (a copy). PostgreSQL answered; tests, scratch experiments and 24 mutants were run. The copy is clean again (`git status` empty, scratch file removed); the original was not written to.

## Verdict

The High finding G1 is fixed: nothing in the status path reads or writes a session (`inbound.ts:281-292` runs `FORWARD` only; `noteAccepted` has one caller, `outbound.ts:575`), and E1, E2 and E5 re-derived against HEAD all come out right, while the same scratch file against d605d48's source fails all three. All 13 mutants the reviewer listed as surviving (X24a apart) now die. Baseline is stable: 7 files x3 = 325/325 each, whole suite once 963/963, typecheck and lint clean. Five responses are not wholly true: G4's new assertion still cannot fail for the lock (the mutant dies by a deadlock in the test's own holder, and a two-edit mutant survives everything); G9's "tested" covers the marking, not the discarding (mutant survives); G6's "not removed" is wrong in the good direction, because removing `noteAccepted` from the status path removed that deadlock, and the note now documents a limit I could not reproduce; G7's new `session-over` end is neither logged nor tested at the worker nor tested for the "different open session" case; G10(a) is corrected in the architecture and not in the note's own section 3 and Departures. No new correctness defect was found in the code. `pnpm run commitlint` fails on the branch for d605d48 only. Nothing here blocks beyond the commit-message check; Y1, Y2 and Y3 should be corrected because the response or a document says something untrue.

## Check 1: G1 to G17

| ID | Verdict | Where (HEAD) | Note |
| --- | --- | --- | --- |
| G1 | Fixed | `inbound.ts:160-170, 281-292`; `sessions.ts:121-139`; `outbound.ts:574-576`; `sessions.test.ts` S8 (line ~298), D6 receipt test (~639) | E1: `read` for r0 after two drops: `statusesApplied 1`, count stays 2, third `finishTurn` = `stored`. E5: forced third reply, newer m5, receipt: `claimNextSend` = `send`; next `beginTurn` leaves "third (forced)" `pending`, count 2, batch [m4, m5]. E2: m0 at 0, accepted 3.1 s, `read` at 23 h, m1 at 25 h: two sessions, first `last` 3 100, ended 24 h + 3.1 s. E3: `sent` for a `sending` row: 0 applied. Same file on d605d48 source: E1 `newer-message` with count 0, E2 one session `last` 25 h. Reverting `inbound.ts` kills exactly the S8 and D6 receipt tests |
| G2 | Fixed | `decisions-needed.md:26-28, 44, 46` | Rows say "Built as proposed, in #320". Heading still reads "nothing is built on them yet", with the exception stated under it; not moved as the reviewer suggested |
| G3 | Fixed | `isolation.test.ts:225-249` | X30, X31, X32 each killed by "a row cannot point at another tenant's row" |
| G4 | Partly; response misstates how | `sessions.test.ts:767-786`; `outbound.ts:94, 132, 176` | See Y1. Mutant 1b is killed, by `deadlock detected` at `takeLease`, not by the batch assertion |
| G5 | Fixed | `sessions.test.ts:612-616, 622-637` | X18 killed by the claim after m4; X21 killed by the new D2 test |
| G6 | Response misstates (harmlessly) | note lines 53-61 | See Y3: the shape is gone at HEAD |
| G7 | Fixed in code; tests partly | `outbound.ts:224-231`; `sessions.ts:98-119`; `sessions.test.ts:251-263` | E4 at HEAD: `session-over`, no reply, one session ended at 24 h, batch handled, lease free. See Y4, Y5 |
| G8 | Fixed | sessions.test.ts: S6 distinct-times assertion; S3 unknown; S5 index; `answered_by` check; "same webhook twice"; migration `edge` rows and windows 4/147 | M11, 9b, 15, X34, X33, X35, X27 all killed |
| G9 | Partly; "tested" misstates | `0006_sessions.up.sql:86-96`; `sessions.test.ts` migration test | See Y2: the discard statement has no row to act on in the test |
| G10 | Partly | `architecture.md:513`; `data-model.md:246`; `traceability.md:17`; note "As built"; `STATUS.md:454-461` | (a) not corrected in the note's section 3 table (lines 158-162, "Its own job") nor its Departures row (line 287, "Each message queues its own job"); "As built" contradicts both. (b), (c), (d), (e) done |
| G11 | Fixed | `sessions.test.ts:741-744` | Joined to `pg_stat_activity`, `datname = current_database()` |
| G12 | Fixed | `worker.test.ts:493-502` | Exact, see mutant RT and the section on tests |
| G13 | Fixed | `decisions-needed.md:46`; note "As built", W2 item | |
| G14 | Left as stated | — | "For U7's note": recorded only in the review file. No issue number given |
| G15 | Left as stated | — | Same |
| G16 | Fixed | `names.ts`; note "Not in U2" and "As built" | No reference left in code, tests, tools, note, plan or STATUS (only the review file) |
| G17 | Left as stated | — | |

## Check 2

The report section of `docs/reviews/2026-11-23-gate4-u2-sessions.md` (after "## The report") is byte-identical to `/tmp/u2review-report.md` (`diff` empty).

## New findings

| ID | Sev | Where | What | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| Y1 | Low | `sessions.test.ts:767-786`; response G4 | "The turn's batch must hold it" cannot fail for the lock. `beginTurn` reads its batch (`outbound.ts:176`) after `takeLease` (`:132`), which waits on the held row anyway; under READ COMMITTED the later read sees the holder's row. Mutant 1b dies only because the holder's insert needs a key-share lock on the session row that the unlocked turn already holds `FOR UPDATE`: a deadlock inside the test, reported as an error plus a vitest "unhandled rejection", not as a wrong batch | 1b: `error: deadlock detected` at `lease.ts:28`. 1b + `FOR UPDATE` removed from `openSession`: 122/122 pass (sessions, worker, outbound) | Make the holder store something the turn reads before the lease and that changes the answer: e.g. turn at `at(9_500)`, holder stores "two" at `at(9_000)`; with the lock the turn answers `wait`, without it `turn` |
| Y2 | Low | `0006_sessions.up.sql:93-96`; migration test; response G9 | The statement that discards pending replies of ended sessions is untested: the test's only `pending` reply (b5) is in the open session | Mutant G9b (`AND false` on that statement): 71/71 pass | Add a `pending` assistant reply to the busy conversation's first session and assert `discarded`; assert b5 stays `pending` |
| Y3 | Low | note lines 57-61 ("A second shape"); response G6 "not removed" | The second deadlock shape needed the status path to lock a session (`noteAccepted`). It no longer does: a status takes one message row and nothing after it. The note now states a limit that the same commit removed, and "the order of locks ... holds for messages and not for statuses" has no remaining consequence I could find by reading | Scratch E10 (message for X + status for Y's reply against the reverse, third connection holding both reply rows): d605d48 source: `40P01` on round 0. HEAD: both stored, `statusesApplied 1` each, two rounds | Say the shape is gone, or keep one sentence that a status locks only its message's row |
| Y4 | Low | `handlers.ts:122-134`; `decisions-needed.md:46` | `session-over` is handled only by being ignored: the job completes, the lease is released in `finishTurn`, nothing is left held or unanswered beyond the batch S3 closed. But nothing is reported: row 40 says the message "is marked dealt with and the worker reports it", true for W2 only (`turn-skipped window-closed`), not for a batch closed by S3 in `storeInbound`/`beginTurn` (before the fix too) nor by the new `session-over`. The comment at `:123` names `newer-message` only. No worker-level test reaches `session-over` | Reading; grep: `session-over` appears in `outbound.ts` and one db test | `report("turn-skipped", "session-over")` on that result, or correct row 40's sentence |
| Y5 | Low | `outbound.ts:228`; tests | `openSession` can return a different open session (a message stored after the 24 hours while the turn ran). Code is right: `session-over`, no reply, lease free, the new message unhandled and answered by the next turn (scratch P1). No test covers it | Mutant S7c (`open === undefined` in place of the id comparison): 122/122 pass. With it the reply would be stored in the ended session and sent | One test: begin at 24 h − 1 ms, store a message at 24 h + 10 ms, finish: `session-over`, no reply, next batch is the new message |
| Y6 | Note | `0006_sessions.down.sql:1-4`; note section 6 "The way back drops all of it"; test title "the way back loses only what it added" | The up migration now sets `handled_at` and `discarded` on old rows; down does not undo either, and its "What is lost" does not say so. Up after down gives the same sessions and the same marks (second pass finds them set), so it is idempotent; the test asserts only the session count (5) after the second up | Reading of the SQL | One sentence in the down file and the note |
| Y7 | Note | commit d605d48 | See check 5 | `pnpm run commitlint` exit 1 | — |
| Y8 | Note | `inbound.ts:162-164, 168` | The reviewer's point inside G1 that a `sent` status can never match (`channel_message_id` is null until `recordSend`) was neither acted on nor mentioned: the comment "`sent` may arrive while the send is still being recorded" and the `sending` branches of `FORWARD` stay | E3: 0 applied | Correct the comment |
| Y9 | Note | review file, "Author's response" closing paragraphs | "The 'partly' verdicts are G4, G6, G9, G10": the reviewer's partly rows also rest on G1/G7 (N10), G2 (N18), and M11/G8 (N20); all were dealt with under their G numbers. "Left for a follow-up issue" names no issue | Reading | Name the issue |

Checked and found right (check 3): lock order in `finishTurn` is conversation (`holdsLease`, `FOR NO KEY UPDATE`) then `stamp` (no lock) then session (`openSession`, `FOR UPDATE`). `openSession` ending the session inside `finishTurn` is S3's effect and matches the note's S7 row; a session over by time implies the reply window is closed (`last_inbound_at` ≤ stored time ≤ `last_message_at`, one conversation per contact), so no answerable batch is dropped. `newer`/`counted` are unchanged apart from `at` being read earlier. `sessionFor` has one caller (`inbound.ts:238`), typecheck clean; the only outbound insert (`outbound.ts:250-256`) uses `turn.sessionId`. `statusesApplied` is `rowCount` and still right (E1, S8 test). Migration: joins carry `tenant_id`; both statements run between `NO FORCE` (line 49) and `FORCE` (line 111); `handled_at` only on inbound rows (`messages_handled_is_inbound`), `ended_at` is never in the future for a session that has a later one; `pending` rows have no `sending_at`; a `sending` reply and a `pending` reply with `unknown_outcomes > 0` or another class are left, as at run time.

## Tests asked about (check 3f)

| Test | Fails if | Confirmed |
| --- | --- | --- |
| S8 receipt | a receipt moves `last_message_at`, or the session does not end at acceptance + 24 h | G1r killed |
| S3 unknown-outcome reply | session end discards a reply with `unknown_outcomes > 0` | 9b killed |
| S7 turn after 24 h | reply stored, session not ended, batch left open, or lease kept | S7a, S7b, S7d killed; S7c survives (Y5) |
| S5 index | index not unique | X33 killed |
| `answered_by` check | check vacuous | X35 killed |
| D6 claim after m4 | hold-back ignores the count | X18 killed |
| D2 older message | time comparison removed | X21 killed |
| D6 receipt | a receipt resets the count | G1r killed |
| Starting a turn | only through a deadlock (Y1) | 1b killed by deadlock; double mutant survives |
| Same webhook twice | re-check under the lock removed (then a unique violation fails a delivery) | M11 killed |
| Three tenant crossings | a key without `tenant_id` | X30, X31, X32 killed |
| Migration rows | boundary `<=`; window from `created_at` only; marks not set | 15, X34, G9a killed; G9b survives (Y2) |
| Real-time lower bound | the turn starts before latest + 3 000 ms | RT killed in that test. The bound is exact: `beginTurn` starts a turn only when its own stamp ≥ latest + 3 000 ms, and the reply's stamp is read later in `finishTurn`; with three messages 100 ms apart the 10-second cap and the "no message since the last turn" path cannot apply. Not flaky short of a clock stepping back. A window 50 ms short (RT2) does not show in this test, because the handler defers by the true closing time; the clocked B1, B2, B3, B7 tests kill it |

`whileHeld`: the count is of ungranted locks of sessions in this file's database. The polling connection never waits while it polls; the administrator is counted only if it itself waits, which happens only in the Y1 mutant. It cannot hang: 200 tries of 10 ms, then a throw and `COMMIT`; waiters have a 3-second `lock_timeout`. On a throw `running` is left unawaited (unhandled rejection).

## Mutants (all restored; `git status` clean)

s = sessions, w = worker, o = outbound, i = inbound, a = app, iso = isolation, m = migrate tests.

| Mutant | Run | Result |
| --- | --- | --- |
| G1r `inbound.ts` of d605d48 (receipts call `noteAccepted`) | s,i,a | Killed (S8 receipt, D6 receipt) |
| 9b `unknown_outcomes = 0` removed from session-end discard | s,w,o | Killed |
| S7a session check removed from `finishTurn` | s,w,o | Killed |
| S7b `session-over` without releasing the lease | s,w,o | Killed |
| S7c only "no open session" is `session-over` | s,w,o | **Survived** |
| S7d `finishTurn` reads the open row without ending it | s,w,o | Killed |
| X33 index not unique | iso,s,m | Killed |
| X35 check vacuous | iso,s,m | Killed |
| X18 count removed from `HELD_BACK` | s,w | Killed |
| X21 time comparison removed | s,w,o | Killed |
| 1b `beginTurn` lock replaced by an existence read | s,w,o | Killed, by deadlock |
| 1b + `FOR UPDATE` removed from `openSession` | s,w,o | **Survived** |
| 11 re-check under the lock removed | s,w,i,a | Killed |
| X30, X31, X32 keys without `tenant_id` | iso,s,m | Killed, each |
| 15 backfill `<=` | s,m | Killed |
| X34 window from `created_at` only | s,m | Killed |
| G9a migration does not mark messages | s,m | Killed |
| G9b migration does not discard replies | s,m | **Survived** |
| G9c `ended_at IS NOT NULL` removed from the marking | s,m | Survived; equivalent (sets `handled_at` to a null `ended_at`) |
| X27 stamp offset 0 | s,w,i | Killed |
| RT `beginTurn` never waits | w | Killed (clocked burst test and real-time test) |
| RT2 window 50 ms short | w,s | Killed (B1, B2, B3, B7, clocked burst); not by the real-time test |

## Check 4: documents

- STATUS: "43 mutants" right (19 + 24 rows); "one High fault" right; "thirteen mutants that had survived now have a test each" right (1b, 9b, 11, 15, X18, X21, X27, X30 to X35; 1b with the reservation of Y1); "55 new tests, 963 in all" right (514 − 459 `test(` lines against main; suite ran 963/963).
- Rows 38 and 40 and the intro: accurate except "the worker reports it" (Y4). The heading contradicts the two rows and says so.
- Note: S7 and S8 rows match the code. Known limit: Y3. "As built": matches, except that section 3 and Departures still say one job per message (G10). Section 6: Y6.
- data-model and architecture sentences match the code. Nothing found that still says a receipt moves a session.

## Check 5: commit d605d48

`pnpm run commitlint` exits 1: `header must not be longer than 72 characters, current length is 75`, for `test(worker): a burst in time, the migration on old rows, and the documents`. The other four commits on the branch pass, the fix commit included (65 characters). `make check` therefore fails on this branch as it stands. A reader of the pull request must be told: the check fails for one commit already pushed; either it is reworded, which changes the hashes of d605d48 and 8c86843 while the review file and its report name `d605d48`, or the pull request is merged by squash, or the failure is accepted and said. The review file says "see the pull request for what was done about it"; I could not read the pull request.

## Check 6: in the report, ignored and not mentioned

- The unreachable `sent`-for-`sending` case and its comment (Y8).
- The reviewer's "NFR-R2's new test ... recovery by the same job's claim running out is not shown": the note's "As built" now lists "a worker killed in a turn" as untested at the worker, which covers it; the response does not.
- A `failed` status after an acceptance (scratch E3: `sent` becomes `failed`, the session keeps the acceptance's time and reset count). Not a reviewer finding; the same before the fix; S9's wording does not cover it.

## What I did not check

- The pull request, its description and any issue: no network.
- `make e2e`, `pnpm run selftest`, `check:docs`, `lint:openapi`, `audit`.
- E10 beyond two effective rounds and one arrangement; absence of any deadlock through statuses is by reading plus that run.
- The reviewer's mutants that were already killed at d605d48 were not rerun.
- Behaviour with a real clock stepping back, `lock_timeout` expiry, and the migration with workers running: by reading only.
- Whether d605d48's working tree equalled what the reviewer saw.
