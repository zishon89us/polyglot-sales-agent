# Gate 4 review: M3 U9, second part, the fallback

Reviewed: commit `d5856f8` on `feat/308-m3-u9b-fallback`, by an agent
that did not write the code, working in a copy of the repository. The
report is unedited. The author's response follows it.

---

## Gate 4 review: M3 U9 second part (fallback)

**Read:** the design note; `apps/worker/src/turn.ts` in full; the branch diff of `outbound.ts`, `handlers.ts`, `main.ts`, `log.ts`; `finishTurn` and `recordSend` in full; migration 0012 up and down; `send-policy.ts` `decideAfterSend`; the last two `describe` blocks of `disclosure.test.ts` (partly); the doc diffs.
**Ran:** the two named test files (baseline 93 passed, PostgreSQL reachable) and 19 mutant runs. `git status --short` is clean at the end; the mutant script is outside the repo in `/tmp/mut-u9b`.
**Not checked:** `tools/e2e.test.ts`, `worker.test.ts` and the db tests were not run; `checkReply` internals; the design-review document; how the send handler composes disclosure + lead + body; mutants against any file but the two named.

### Findings

**No High finding.** I found no path by which a failed or unchecked reply text is stored or sent. The only `INSERT INTO messages` for an assistant reply is in `finishTurn`, and its only caller is `runTurn`'s `end`. The stored text is the same `reply` variable that was checked.

**R1 — Medium — tests: a checker that throws is untested** (`turn.ts:345-361`). Note §10 promises "A checker that throws"; no such test exists. A mutant whose `catch` returns "passed" survives. Sequence: someone later changes the catch to "pass on error", `checkReply` throws on a hostile reply, the reply is sent, and the suite stays green. Change: add a test that makes the guard throw (for example a profile with an invalid time zone, or an injected checker) and expects the fallback, a `reply_checks` row with `error`, and `reply-blocked check-error`.

**R2 — Medium — tests: "never over a hundred" does not test the cap** (`disclosure.test.ts:1026-1041`, `outbound.ts:982`). Removing `least` survives. The CHECK constraint then makes `recordSend` throw after the channel has accepted, the transaction rolls back, the count still reads 100 and `mock.sent` still ends with the fallback. Change: assert the message row's status is `sent` and that no job failed or retried.

**R3 — Medium — note and docs vs code: T5 writes no `reply_checks` row and is not checked** (`turn.ts:337-341`). Note §6 says "a row exactly when there is a reply or a fallback"; `data-model.md` says "One row for a turn whose reply or fallback was stored"; `guardrail-policy.md` says checks run "on every answer". T5 stores an `assistant-reply` with no row. It also writes the model's `language` to `sessions.language` and `contacts.last_language` from an answer that passed no check. Change: either write a row (`outcome: passed`, o1 only) or correct the three documents.

**R4 — Low — `texts` is optional in production wiring** (`turn.ts:84`, `314-317`). `main.ts` passes it, so today this is test-only. If a later wiring omits it, every blocked reply becomes a silent no-reply with the batch marked handled, reported only as `turn-skipped reply-blocked` without the check name. Change: make `texts` required on `TurnModel`.

**R5 — Low — the note contradicts itself on the error line.** §5 says a line `reply-check-error` is reported; §6 and the code (`turn.ts:360`) report event `reply-blocked` with code `check-error`. `reply-check-error` is not in `LOG_EVENTS`. Change: correct §5.

**R6 — Low — `reply_checks.session_id` FK is not tenant-composite** (`0012_fallback.up.sql:33`). 0009 and 0010 use `FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)`; this table uses `REFERENCES sessions (id)`. The FK check bypasses RLS, so a row can name another tenant's session. The code cannot do that today. Change: use the composite FK.

**R7 — Low — count and unknown outcomes** (`outbound.ts:981-988`, `send-policy.ts:103-105`). A fallback's call ends unknown, is retried once, ends unknown or refused again, and is marked failed `unconfirmed`. The customer may have received it, possibly twice, and the count does not move. Note §3 lists only discarded, refused and expired. Effect once U11 exists: a late handover. Change: state it in §3 and the follow-up issue.

**R8 — Low — redundant language guards, each individually untested.** Four single mutants survive: storing `made.language` on a fallback, preferring it for the lead, updating `sessions.language` on a fallback (all in `outbound.ts`), and passing a real language from `turn.ts`. Only all four together are killed. Change: one direct `finishTurn` test with `fallback: true, language: "fr"`.

**R9 — Low — integration gaps behind confident test names.** The test "checked against exactly the texts the model was given" (`disclosure.test.ts:1106`) passes with unbounded batch texts; only the unit test of `givenTexts` covers the cut. `instructions: ""` survives, so no integration test covers an instruction leak. `todayIn(..., new Date())` survives. Dropping `m.status <> 'failed'` survives, so an early failed receipt before the count is untested. Dropping `m.class = 'assistant-reply'` survives, so no test shows a staff or system message leaving the count alone.

**R10 — Note —** a reply that is non-empty but renders to nothing (for example a zero-width character) beside `asks-if-person` misses the T5 `trim()` exit, fails O7, and the customer gets the fixed answer plus the fallback (T6) and a count of +1. Arguably this is T5.

**R11 — Note —** a discarded fallback's `reply_checks` row stays, since the role has only SELECT and INSERT. That is consistent with "stored turn", but the table will overcount what customers got. No retention path exists, which `data-model.md` admits.

### Mutants (two named test files; baseline 93 passed)

| Mutant | Result |
| --- | --- |
| Always pass (skip check) | killed (18 failed) |
| Swallow failed check | killed (17) |
| Drop `fallback: true` | killed (11) |
| Store `made.language` for fallback (`outbound.ts`) | **survived** |
| Prefer `made.language` for lead (`outbound.ts`) | **survived** |
| Session language update on fallback (`outbound.ts`) | **survived** |
| Turn passes a real language for the fallback | **survived** |
| The four language mutants together | killed (7) |
| Count +1 for any reply (`m.fallback` ignored) | killed (3) |
| Remove `least` | **survived** |
| Count touches any class | **survived** |
| Drop `m.status <> 'failed'` | **survived** |
| Unbounded batch texts to checker | **survived** |
| Catch returns "passed" | **survived** |
| `reply-blocked` when not stored | killed (1) |
| `readFlags` ignores the flag | killed (7) |
| `today` from wall clock | **survived** |
| Canary not given to checker | killed (1) |
| No `reply_checks` insert | killed (2) |
| `instructions: ""` | **survived** |
| Remove T5 early exit | killed (2) |

### Could not fault

- **`runTurn` returns:** every `end(reply)` with text follows a passed check; `invalid-output` goes to the fallback before destructuring; a reply after tool rounds takes the same path; `claims` are the validated output's; `profile`, `system.instructions`, `givenTexts` and `todayIn` are all inside the guard or built before it without affecting sending.
- **`reply_checks` uniqueness:** `turnId` is a fresh `randomUUID()` per `runTurn`, and `finishTurn` is called once per turn, so no 23505 loop. The insert sits after the `newer-message` and `session-over` returns.
- **Constraint 0012:** every fallback insert has `body NULL` and a non-null lead. The longest lead is 300 + 2 + 300 = 602, under 700.
- **`language = 'und'`** satisfies the 0010 pattern, and the session update is skipped.
- **`recordSend` count:** it runs only when `decision.next === "sent"`, which needs an accepted call; it is guarded by `status = 'sending' AND send_attempts`, so a superseded or repeated call does not count twice; the conversation lock serialises sends.
- **Log codes:** all fit `CODE`. The longest I found is `values-percentage-unclaimed` (27 characters); `check-error` and `schema-invalid-output` fit. The report carries only check name and code, and only when `end === "stored"`.
- **Migration:** RLS is enabled and forced, grants are SELECT and INSERT only, and the down migration reverses the up.
- **README, STATUS, traceability:** no claim found that the code contradicts, beyond R3.

---

## Author's response

No High finding. **These fixes are checked by the author only**: they
are tests, one row for T5, one foreign key and wording, and no second
agent was asked to read them. What is left is added to #336.

| Finding | Answer |
|---|---|
| R1 | Fixed: a test gives the tenant a time zone that does not exist, so building what the checks are given throws; the customer gets the fallback, the record says `error`, the line says `check-error` |
| R2 | Fixed: the test asserts that the send was recorded as sent, that no job is left, and that the fallback went out once |
| R3 | Fixed: under T5 a row is written that says only that the answer matched the schema. The language of such an answer is still stored, as U8 built it: the answer was not refused |
| R4 | Not changed here: making the fixed texts required touches the tests of four earlier units. In #336, beside the same point for the disclosure (#334) |
| R5 | Fixed in the note |
| R6 | Fixed: the foreign key names the tenant |
| R7 | Said in the note's section 3; in #336 |
| R8 | A test with three languages shows the fallback's language is not the refused answer's, and that the message's language is `und`. Two of the four guards are still each untested alone: they guard the same thing twice |
| R9 | Tests added for the instructions, for a failure reported before the send is recorded, and for a message of another class. The test's name is corrected: the cut of the batch is shown only by the test of `givenTexts`. "Today" from the turn's clock is not shown by a test through the worker; in #336 |
| R10 | Left as built: such a reply is not empty to `trim`, fails O7, and the customer gets the fixed answer and the fallback. In #336 |
| R11 | Said in the note's section 6 |
