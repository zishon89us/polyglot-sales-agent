# Gate 4 review: M3 U11, the handover record

Reviewed: commit `6e5603e` on `feat/310-m3-u11-handover-record`, by an
agent that did not write the code, working in a copy of the repository.
The report is unedited. The author's response follows it.

---

## Gate 4 review: M3 U11, the handover record

**Read:** the design note; the full diff of `packages/db/src/{handover,outbound,sessions}.ts`, migration 0013 up/down, `apps/worker/src/{turn,handover,handlers}.ts`, `packages/core/src/hours.ts`; `lease.ts`; `claimNextSend`/`recordSend`/`beginTurn`; the doc diffs (STATUS, data-model, guardrail-policy, traceability, README).
**Ran:** baseline for the two test files (94 passed); 23 mutants (each restored); 4 temporary probe tests (removed). `git status --short` is empty at the end. PostgreSQL was reachable.
**Not checked:** `tools/e2e.test.ts` (not read or run); `docs/requirements/user-stories.md`; `hours.test.ts` content beyond mutant results; R4 by execution (psa_migrate cannot create temp tables, so it rests on PostgreSQL semantics); R2 by execution (my scripted tool call was schema-invalid, so that probe took the invalid-output path instead).

### Findings

**R1 — High. A re-attached handover whose telling fails is never told again.** `packages/db/src/outbound.ts`, `joinHandover` re-tell query (`WHERE handover_id = $1 AND status IN (...)`, about line 523).
- The query counts every telling the handover record ever had. H-c re-attaches the same record, so the previous attachment's `sent` telling satisfies it.
- Measured by probe: TAP (told, sent) → session ends → assistant answers in the new session → TAP with the send refused (telling `failed`) → "hello?" → "anyone?". Zero messages were sent after the failure; both turns reported `turn-skipped handed-over`.
- The customer is handed over, was not told in this session, and is silent for up to 24 hours. This contradicts section 4, "told again".
- The same query also blocks S3's emergency text: a `sent` ordinary telling plus a failed emergency telling added by a turn in flight gives no re-tell (by reading, not run).
- Change: add `AND created_at >= attached_at` for the current attachment. For an urgent handover, also require a live telling with `tells = 'emergency'`, or one inside the 60-minute rule.

**R2 — Medium, by reading. A tap beside text is dropped when tool rounds run out.** `apps/worker/src/turn.ts`, about line 495: `if (round >= TOOL_ROUNDS_MAX) return { kind: "no-reply", code: "tool-rounds", end: await end() }`.
- A batch with TAP and text, where the model returns tool calls for five rounds, is marked dealt with: no handover, no telling.
- The note's section 2 says the handover for the tap is made "whatever the model answers".
- Flags are read only in the round with no tool calls, so an `emergency` flag beside a tool call is ignored if the last round omits it.
- Change: on `tool-rounds`, call `handOver(["requested"])` when `tapped`; carry handover flags across rounds.

**R3 — Medium. A tap beside text waits on the provider indefinitely.** `turn.ts`, the catch at the end of `runTurn`.
- A provider failure throws and the job retries; the tap is acted on only if a model call succeeds.
- If the job runs out of attempts, the customer who tapped "person" gets nothing, although the handover needs no model.
- The note admits this ("the handover waits for it") but sets no bound.
- Change: on a provider error with `tapped`, hand over with `["requested"]` at once, or at the last attempt.

**R4 — Medium, by reading. The down migration fails once any `handed-over` row exists.** `packages/db/migrations/0013_handovers.down.sql:5-9`.
- `reply_checks` has FORCE row-level security with a policy only for `psa_app`; `psa_migrate` is created NOSUPERUSER NOBYPASSRLS (`bootstrap.ts:58`).
- The `DELETE` therefore sees no rows, and the `ADD CONSTRAINT ... CHECK` that follows validates all rows and aborts.
- No earlier down migration has a `DELETE`, and no test runs this one with data.
- Change: add `NOT VALID`, or lift FORCE around the delete, and add a down test with a row.

**R5 — Low/Medium. Note and code disagree on a tenant that is not answering.** `turn.ts`, about lines 300-327.
- Section 5 says such a tenant "is stopped before any of this". In code `joinHandover` runs before `answering(...)`.
- For that tenant, a handed-over session's batch is marked, a tap adds a reason, and a re-telling can be stored and sent.
- Change: move the `answering` check above `joinHandover`, or correct the note.

**R6 — Low. The discard inside `applyHandoverTrigger` is untested and wider than its siblings.** `packages/db/src/handover.ts:222-226`.
- Mutant M4 survives: the S4 test passes because `beginTurn` already discards the pending reply. The G6 path (`recordSend`, no turn start) is the only place this discard matters, and nothing tests it.
- It lacks `AND unknown_outcomes = 0`, which `beginTurn` and `openSession` have, so a reply the customer may already hold is recorded as `discarded`.

**R7 — Low. `done` is called before the transaction commits.** `outbound.ts`, in `recordSend` (about line 1155) and `finishTurn` (about line 333).
- In `recordSend` the `handed-over` line is reported inside the transaction; a failure in the later `UPDATE ... buttons = NULL` or at commit leaves a logged handover that does not exist.
- Change: return the result and report after `withTenant` resolves.

**R8 — Low. Schema looseness in 0013.**
- `emergencyToldLately` measures the 60 minutes from `created_at`, not `sent_at`.
- No check ties `attached_at` to `waiting` or `detached_at` to `detached`.
- `reasons` accepts any name-shaped string, not the core list.
- `EXECUTE` on `handover_reasons_ok` is granted to `psa_cross`, which has no grant on the table.
- Uniqueness is per contact but the lock is per conversation; "a contact has one conversation" is asserted in the note and not enforced that I could find.

**R9 — Note. Docs.**
- STATUS and README say "told once"; R1 and the unknown-outcome resend (`system-reply` is resent) make that "at most twice, sometimes never".
- The note's section 4 names a status `expired`; the code stores `failed` with code `expired`.
- `tellCustomer` and `handoverTeller` parse PostgreSQL's `::text` timestamp with `new Date()`; it works in V8 (checked four forms, including `+00`) but is not ISO.

### Mutants (two test files)

| # | Mutant | Result |
| --- | --- | --- |
| M1 | `finishTurn` does not refuse a handed-over session | killed (1) |
| M2 | `joinHandover` never detaches at 24 h | killed (1) |
| M3 | `joinHandover` always re-tells | killed (3) |
| M4 | discard of pending assistant replies removed | **survived** |
| M5 | count not reset on attach | killed (2) |
| M6 | G6 at count >= 1 | killed (22) |
| M7 | G6 does not check the open session | **survived** |
| M8 | `emergencyToldLately` always false | killed (1) |
| M9 | told when `made === "added"` | killed (1) |
| M10 | `openSession` does not detach | killed (1) |
| M11 | `openAt` uses `<=` for the closing minute | killed (2) |
| M12 | `nextOpening` ignores `ahead > 0` | killed (4) |
| M13 | tap ignored beside text | killed (3) |
| M13b | tap ignored on invalid output only | killed (1) |
| M14 | flagged reply checked and sent | killed (10) |
| M15 | `detached_at` = now, not attached + 24 h | **survived** |
| M16 | re-tell never uses the emergency text | **survived** |
| M17 | H-d expiry never fires | killed (1) |
| M18 | `urgent = $3` (cleared by a later non-emergency trigger) | **survived** |
| M19 | G6 without `m.status <> 'failed'` | **survived** |
| M20 | S2 tap adds no reason | killed (1) |
| M21 | telling's send job not runnable | killed (16) |
| M22 | re-tell query ignores status | killed (1) |

Six of 23 survive.

### Could not fault

- **Lock between `finishTurn` and `recordSend`:** `holdsLease` takes the same `FOR NO KEY UPDATE` row lock as `lockConversation`, so the two serialise. A reply cannot be stored after a concurrent G6 handover; M1's test covers the ordered case.
- **The telling's send path:** `system-reply` is outside `HELD_BACK`, is picked by `claimNextSend`, carries the disclosure, and expires to `failed` after 15 minutes, which the re-tell covers within one attachment. Probe: an emergency telling that failed was re-told with the emergency text.
- **H-d in one transaction:** close then insert does not trip the partial unique index.
- **`openSession` detach:** `detached_at = s.ended_at` reads the row updated in the same transaction, and it runs before `joinHandover` or any trigger on every path I traced (`beginTurn`, `finishTurn`, `recordSend`).
- **The `tell as HandoverTell` cast:** every `handOver` call is guarded by `tapped` (which implies `tell`) or `tell !== undefined`.
- **`reply_checks` rows:** one per turn id, inserted in the finishing transaction.
- **`reply_checks_outcome_check`:** it is the real auto-generated name (0012, inline column check).
- **`hours.ts`:** `h23` cannot return "24"; the weekday mapping is right (1 = Monday); `24:00` as a close works; periods past midnight are refused by profile validation; `handoverTeller` falls back to the in-hours text on a bad time zone.

---

## Author's response

The High finding is accepted and fixed. **These fixes are checked by
the author only**: no second agent read them. What is left is #339.

| Finding | Answer |
|---|---|
| R1 (High) | Fixed: only a telling of the present attachment counts, and an urgent handover is told again with the emergency text when this attachment has no emergency telling that lives and the contact was not sent one within the hour. A test follows the review's own sequence |
| R2 | Fixed for the tap: when the rounds of tools run out and the batch held a tap, the session is handed over. No test, since no tool exists that a scripted model can call five times in a way the client accepts here; in the follow-up issue. Flags on a round that also calls tools are still not read |
| R3 | Fixed: a provider failure with a tap in the batch hands over at once; the text beside the tap goes unread. A test shows it, with no job left to retry |
| R4 | Fixed as 0008 does it: the forcing of row-level security is lifted for the one statement. **Not run with a row**: the migration test runs every down on empty tables. In the follow-up issue |
| R5 | The note is corrected to say what the code does. Whether a tenant that is not answering should have a telling sent is in the follow-up issue |
| R6 | The discard now leaves a reply the customer may already have. Still no test of it on the path of two fallbacks in a row |
| R7 | Fixed: the line is reported after the transaction has committed, in both places |
| R8 | Not changed; in the follow-up issue |
| R9 | The note says `failed` with the code `expired`. "Told once" in STATUS and README is replaced by what is true |
| Mutants | Cases added for the moment of detaching, the emergency text on telling again, urgent staying set, and a second fallback that failed. Not for the discard (R6) nor for the open-session check of two fallbacks in a row |
