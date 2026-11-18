# Gate 4 review: U8 the worker, the echo reply and the send policy

The reviewer's report follows, as received. It was asked to review the
branch `feat/269-worker-echo-send-policy` at `5fb7d53`. While it ran, the
author pushed `95805e7`, a change to one test (the subject of S1), after
the same failure showed in CI.

| ID | Sev | Location | Finding (with the reproduction I ran) | Fix |
| --- | --- | --- | --- | --- |
| S1 | Medium | `apps/worker/src/worker.test.ts:762-789` ("two workers and bursts of five") | Flaky: 5 failures in 40 runs of the file (1/10, then 4/30), always `expect(await jobs()).toEqual([])` receiving one `send-messages` job in state `queued`. Mechanism reproduced: a second send job that finds the oldest message `sending` is deferred for the rest of the stale time (measured `due_in` = 120 s), and the test only moves the clock 5 s. `make check` will go red about 1 time in 8. | Step the clock past `SENDING_STALE_MS` in that last `work(...)`, or assert only that no job is due and nothing more is sent. |
| S2 | Medium | `packages/db/src/outbound.ts` `claimNextSend`; `handlers.ts`; architecture "Sending a message once" | Lost wake-up when the send job dies. 5 replies waiting, one job, channel wrapper that throws: after 6 runs the job is `dead` (6 calls), leaving 1 message `sending` and 2 `pending` with no job. I aged them 3 days and stored a new customer message: the two old replies were sent then, ahead of the new echo, and the stuck one became `failed/unconfirmed`. Same result follows from 6 worker stops (`worker-lost`). Nothing sweeps, and the document says only "when a send job for the conversation next runs". | Re-queue or sweep conversations with `pending`/`sending` rows and no live job, or fail waiting messages older than a limit; say in the document which. |
| S3 | Medium | `packages/db/migrations/0004_sending.{down,up}.sql` | Down then up fails if any message is `sending`: with one such row, `migrateDown` succeeded and `migrateUp` threw `check constraint "messages_sending_has_time" ... is violated by some row`. The down file's comment admits the lost time but not that up can no longer be applied. Not run, from reading: after down and up every inbound row has `handled_at` NULL, so the next turn echoes the whole history (cut at 1,000 characters). | In down, move `sending` rows to `failed`/`unconfirmed` (or `pending`); or backfill `sending_at` in up before adding the constraint. Add a down/up test with a row in flight. |
| S4 | Medium | `apps/worker/src/worker.test.ts:814` vs `worker.ts` jobs loop | Mutant "the jobs loop returns after its first loop-error" survives. The test waits for 3 reports with `heartbeatMs: 10`, and the heartbeat loop alone supplies them. A worker whose job loop has ended while its heartbeat stays fresh would pass every test. | Assert that a job is run after the database comes back, or count `workOnce` attempts separately from heartbeats. |
| S5 | Low | `send-policy.ts` `decideAfterSend`, refused branch | A reply whose first call was unknown and delivered, then refused for good, ends `failed` with the channel's code (`meta-131026`, `unknown_outcomes` 1, 1 copy delivered). Chaos runs: 1-2 such rows per seed. data-model says `unconfirmed` is the code for "the customer may have it"; here that is not what is stored. | Store `unconfirmed` (or keep both) when `unknownBefore > 0`, or document that `unknown_outcomes > 0` is the signal. |
| S6 | Low | `handlers.ts` `SENDS_PER_RUN`, `worker.ts` (one job at a time) | One conversation delays other tenants. 40 service notices of tenant A on a channel answering "timeout" after 40 ms, one worker: tenant B's echo waited 1,758 ms, behind all 40 calls, because its `process-conversation` and its `send-messages` each queued behind a full run of 20. With the real 10 s timeout that is up to 400 s (computed, not run). | Lower the per-run bound for slow outcomes, or return after the first timeout for every class; note the bound in ADR 0004. |
| S7 | Low | `handlers.ts` `SEND_MESSAGES_JOB` | A send job naming tenant B and tenant A's conversation ends `done` and is deleted with no report; A's message stays `pending`, nothing sent. The same mismatch on `process-conversation` ends dead with an alert. Isolation holds; the fault is silent. | Check the conversation exists in the tenant (as `takeLease` does) and throw `conversation-not-found`. |
| S8 | Low | `handlers.ts` `return { deferMs: next.ms }` | Not clamped. With `send_not_before` 2 h ahead the run failed with `bad-handler-result` and the job went to retry, so 6 runs make it dead. Not reachable from this unit's code (waits are 2 s, 8 s, at most 120 s); latent for any later unit that schedules a send. | `Math.min(ms, JOB_MAX_DEFER_MS)`. |
| S9 | Low | `handlers.ts` `PROCESS_CONVERSATION_JOB`; `outbound.ts` `finishTurn` | `finishTurn` is atomic (insert into `jobs` forced to fail by a scratch trigger: nothing marked, no reply), but the lease taken by `beginTurn` stays held. The retried job is then put back every second until the 2-minute lease runs out, so one transient fault delays the reply by 2 minutes. | Release the lease when `finishTurn` throws, or let the same job retake its own lease. |
| S10 | Low | `apps/worker/src/main.ts`, `handlers.ts` | A message that ends `failed` leaves no log line and no alert. Real `main.ts` against a stub answering 500: the reply ended `failed/unconfirmed` after 2 calls; stdout held only `worker: running` / `worker: stopped`, stderr was empty. | Report `send-failed` with the code (no body, no number). |
| S11 | Low | tests | Other surviving mutants: outbound `kind !== "text"` check dropped (the test's non-text message has a null body, so a template with a body would go out as free text unnoticed); `status = 'sending'` guard widened to include `pending`; `SENDS_PER_RUN` 21; inbound non-text body echoed. Equivalent, no action: `attempts <= MAX`, no early return on retry, `newer-message` not deferred. | Add a non-text outbound row with a body; pin the bound at exactly 20. |
| S12 | Low | `docs/design/architecture.md:91`, `:555`; `user-stories.md:73` | Threat model T11, the plan, STATUS, `.env.example`, `config.ts` and `handlers.ts` state the single credential honestly. Architecture still says sends are "authenticated with the tenant's own credentials" and credentials are "encrypted at rest", with no as-built note. US-C1 criterion 9 allows a second send only when a worker stopped after acceptance; the built policy also resends a reply after a timeout or 5xx with a live worker. Architecture says so, the story and its traceability row do not. | Add the as-built note in both places; amend criterion 9 or note the difference in traceability. |

**Clean:**

- **NFR-R2 under chaos:** 12 seeds, 4 workers, 2 tenants, stale/claim/lease/handler times shortened in a /tmp copy (500 / 1,500 / 600 / 1,000 ms). The channel wrapper accepted, accepted slowly (up to 2.5 s, past stale and handler timeout), delivered then threw, threw, answered unknown with or without delivery, and refused. About 800 inbound and 970 outbound messages: no reply delivered more than twice, no service notice or business-initiated message more than once, at most 3 calls per message, calls always equal to `send_attempts`.
- **Turns in the same runs:** every inbound message handled and present in exactly one reply; no message left `pending` or `sending`; no job left; every send from the right tenant's number.
- **Compare-and-set:** 200 concurrent `claimNextSend` on one message gave 1 `send` and 199 `wait`; 50 concurrent `recordSend` for one attempt gave 1 applied and 49 `superseded`.
- **Policy sequences:** service notice refused twice then unknown-and-delivered: 3 calls, 1 copy, `failed/unconfirmed`.
- **Arrival mid-turn:** a message stored between `beginTurn` and `finishTurn` gave `newer-message`, then one reply `Echo: one\ntwo`.
- **Tenant isolation:** with tenant B's scope and A's ids, `claimNextSend` returned `none`, `recordSend` `superseded`, `beginTurn` threw `conversation-not-found`. `findIsolationProblems` returned `[]`. `messages` grants: `psa_app` INSERT/SELECT/UPDATE at table level, `psa_cross` none.
- **Indexes:** on 200,505 rows the claim uses `messages_to_send` (0.10 ms), `beginTurn` and the newer check use `messages_unhandled` (0.01-0.02 ms), `recordSend` uses `messages_to_send`.
- **`main.ts` run for real:** two tenants answered from their own numbers with the one token; output held no number, text, token or password, including four start-up faults (bad URL, wrong role, missing settings, odd base URL); SIGTERM exit code 0 in 12 ms; one heartbeat row.
- **Mutation:** 51 mutants, 43 killed, 8 survived (3 equivalent). Every policy row, the stale threshold in both directions, the unknown counters, ordering and `finishTurn`'s checks are killed; the restart tests kill the policy mutants.

**Gate 4:**

- Does what the criteria say and nothing else: yes; the three NFR-R2 outcomes are shown at four stop points. S2 and S3 are gaps at the edges.
- Each criterion has a failing-first test: failing-first not checkable from history; by mutation the criteria tests are real, except the "keeps trying" claim (S4).
- Failure paths tested: mostly; not the dead send job (S2), down/up with a row in flight (S3), or the jobs loop after a database fault (S4).
- Tenant-scoped: yes, every statement in `outbound.ts` runs in `withTenant`; nothing crossed.
- Input validated: yes; customer text is only echoed and cut, payloads hold identifiers only, bad jobs fail with `bad-job`.
- No secrets, personal data or disabled tests: none found; numbers are +155501xx; no `.skip`/`.only`/ignore added.
- New dependencies: none from outside; `apps/worker` adds workspace links and the already-pinned `pg`/`@types/pg` 8.23.1 for tests.
- Logs carry no numbers or bodies: confirmed on the real entry point; they also carry nothing about failed sends (S10).
- Docs and traceability match: numbers match the code (3 calls, 2 s / 8 s, 2 min, 5 min, 1 s, 20 per run is code-only); exceptions are S2 and S12.

**Ran:** `worker.test.ts` 40 times; lint, typecheck, `check:docs`, `lint:openapi`, commitlint, git-identity and the full suite once in the repository (18 files, 761 tests, all passed that time); the scratch experiments above in /tmp copies with `rv_` databases; 51 mutants against the core, db inbound/outbound, worker and WhatsApp tests. Afterwards: `git status --short` empty, no `rv_` or `psa_test_` database, no process or scratch file of mine left.

**Could not check:** `make selftest` (it plants files in the workspace) and `make audit` (network); the STATUS claim that API, worker and mock were run together by hand; behaviour with the PostgreSQL server itself stopped (only an unreachable address, via the existing test); real-scale timings (10 s timeouts, 2-minute stale, 5-minute claims) — these were shortened or stepped, not waited for; the contents of #290; whether each test was written failing first.

## Author's response

Written by the agent that wrote the unit. No finding is High. The fixes
were then checked by a second agent; its report is
`2026-11-19-gate4-u8-verification.md`.

| ID | Response |
| --- | --- |
| S1 | **Fixed**, in `95805e7`, before this report arrived: the same failure showed in CI. The last pass moves the queue's clock ten minutes. The file then ran 12 times, and after the other fixes 10 more, with no failure |
| S2 | **Fixed by a limit, not a sweep.** A message that has waited more than 15 minutes since it was stored is not sent: `failed` with `expired`, or `unconfirmed` if the channel may have it. So replies left by a dead job are never sent late or out of nowhere. Nothing re-queues: they still wait for the conversation's next job or an operator's retry, and the architecture now says so under "When the send job itself dies". The number is the agent's (#290) |
| S3 | **Fixed for the first part; the second is stated.** The down step ends every message being sent as `failed` with `unconfirmed`, so up can be applied again; a test does down and up with one in flight. That every customer's message counts as not dealt with after down and up is in the down file's comment and #290; nothing prevents it |
| S4 | **Fixed.** The test now cuts a relay in front of PostgreSQL, waits for five reports with the heartbeat set to a minute so that they can only be the job loop's, stores a message, restores the relay, and waits for the echo |
| S5 | **Fixed.** A message that ends `failed` after any unknown outcome stores `unconfirmed`, whatever the last call said. The channel's code for that last refusal is not kept |
| S6 | **Fixed as suggested.** A run ends at the first call that is not accepted; the bound, twenty quick calls and one slow one, is in ADR 0004. One worker still runs one job at a time and shares nothing fairly (#290, #282) |
| S7 | **Fixed.** `claimNextSend` throws `conversation-not-found` for a conversation the tenant does not have, so such a job ends dead with an alert |
| S8 | **Fixed.** The wait is cut to the queue's hour, with a test |
| S9 | **Fixed.** A turn that fails to store gives the lease back (`abandonTurn`); a test makes the store fail once and sees the retry answer |
| S10 | **Fixed.** Each message that ends `failed` is reported as `send-failed` with its code, including those ended without a call (expired, or found stale); `main.ts` writes it as a line of JSON. `main.ts` itself is still not under test |
| S11 | **Fixed.** Tests added: a template with a body is not sent as text; a result for a message that is not being sent changes nothing; the bound is exactly 20; a caption on a type that is not read is not echoed |
| S12 | **Fixed.** Both passages of the architecture have an as-built note. Criterion 9 is left as written, since a story is the maintainer's; the traceability row says the build is wider than it and why, and #290 asks for the decision |

Of "Could not check": the by-hand run is described in #290 under "Not
shown" and is the author's word only. #290 is rewritten with the review's
leftovers.
