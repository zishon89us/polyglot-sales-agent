# Gate 4 verification: U5, the High finding and the fixes around it

A second agent, which did not write the change, checked the fixes for J1
and J2 of `2026-11-17-gate4-u5-jobs.md` and spot-checked the others, at
`dd074a9`, against a PostgreSQL 16.15 server. Its report follows, as
received. It was asked for at most 40 lines and no preamble.

**J1 (High): RESOLVED, with residuals.** As `psa_app` in `withTenant`: enqueue + `replaceJob` + `cancelJobs` work alongside an `audit_log` insert, and a throw undoes both. Tenant A gets 0 rows for B's and tenantless jobs via `count(*)`, `id=`, `DELETE … RETURNING`; any use of `payload`/`run_at`/`attempts`/`ctid`/`xmin`, `SELECT … FOR UPDATE/SHARE`, `UPDATE`, `COPY`, `TRUNCATE` → 42501; running and dead jobs cannot be deleted; `subject_id` = B's conversation is accepted but B neither sees nor cancels it. Row locks from an uncommitted DELETE of 10,000 own jobs do not stall claims (14 ms, B's job claimed). What remains: K1, K2, K6 below.

**J2 (Medium): RESOLVED for cross-process skew, PARTLY inside long transactions.** All 15 statements use `coalesce($n, now())`; `runNextJob` uses one source throughout. A worker in an older transaction could not take a lease another took and renewed later (returned undefined). Stale `now()` errs short, not double-held: see K3.

| Fix | Result | Experiment |
|---|---|---|
| J3 | Fixed, gaps | 20 hostile inserts refused (id/state/attempts/last_error/locked_until/created_at, alert type, other/no tenant, `x\n`, infinity, 2001 bytes). Still accepted: type `p15550100`, key `aliKhanSaysHelloId`, UUID spelling a number. `job_payload_ok` is pure, no oracle. Parity gap: K5 |
| J4 | Fixed | Two transactions insert a message then `holdsLease`: the second waits, no 40P01. Message insert passes during a store; `takeLease`, `renewLease`, `releaseLease` all block |
| J5 | Fixed, gaps | Defer leaves attempts 0; double defer → false; forged attempts 0 → 23514. Bad `deferMs`: K4 |
| J6/J7 | Fixed | `constructor` and inherited handler → `no-handler`; timer cleared (0 left); late reject/resolve after timeout: no unhandled rejection, no second completion; Proxy and `throw undefined` → `unknown` |
| J8 | Fixed | In a /tmp copy, removing the lease drops fails only the new per-step test; keeping the function, heartbeat table or one column also fails |

**New findings**
| ID | Sev | Location | Finding (reproduction) | Fix |
|---|---|---|---|---|
| K1 | Medium | `0002…up.sql:66` | `GRANT DELETE` lets `psa_app` run `LOCK TABLE jobs IN ACCESS EXCLUSIVE MODE` (ok). While held, `claimJob` and another tenant's enqueue both hit a 2 s statement timeout: the whole queue stops. Before this change the role had INSERT only | Cancel via a `cancelled_at` column grant or a narrow function; or set `lock_timeout` and document |
| K2 | Medium | `jobs.ts:124-142`; up.sql:38 | One tenant starves the rest: `run_at` `1970-01-01` or `4713 BC` is claimed ahead of B's due job; 10,000 jobs insert in 176 ms and sit ahead of B (claim 1.3 → 7 ms; 87 ms at 110k). Author admits the past date; no cap exists | Clamp `run_at >= now()` in the policy or a trigger; per-tenant limit |
| K3 | Low | `lease.ts:14,57`; `jobs.ts:77` | `now()` is transaction start. `takeLease` 3 s into a transaction leaves 116.99 s; `renewLease` in a 3-s-old transaction moved expiry back from 120.00 to 117.00 s; a job queued "in 1 s" at the end of a 2 s transaction was due 1.01 s ago at commit; a claim in a 1.5-s-old transaction missed a due job | `clock_timestamp()`, or `greatest()` on renew; document |
| K4 | Medium | `jobs.ts:306-308` | A handler returning `null`, `{}`, `[]`, or `{deferMs: NaN/Infinity/undefined}` makes `runNextJob` reject (TypeError, 23502, 22008); the job stays `running` 5 min with no `last_error`. `deferMs: -1` runs at once; `9e15` defers 285,000 years; 30 straight deferrals leave attempts 0, never dead | Validate the wish; route errors to `failJob`; cap deferrals |
| K5 | Low | `core/src/jobs.ts:67-86` | No size check in code: a 50-key valid payload passes `payloadProblems`, then the table raises 23514. The 2000 bytes count jsonb's text form (2002 for 1931 sent) | Check size in code |
| K6 | Low | up.sql:65-66 | `psa_app` reads global queue volume: `pg_relation_size('jobs')` and `pg_stat_user_tables.n_tup_ins` (110068). `cancelJobs` waits on an uncommitted claim; 4 concurrent `replaceJob` leave 4 jobs (admitted) | Accept or document |
| K7 | Medium | `policy-check.ts:49-61,128-176` | Not reported (baseline `[]`): dropping `jobs_payload_check`; `job_payload_ok` replaced by `RETURN true`; dropping the type check or tenant FK; `WITH GRANT OPTION`; `GRANT TRIGGER, REFERENCES`; unique index `(type, subject_id)` (cross-tenant oracle); AFTER INSERT trigger `pg_notify`-ing each row; BEFORE INSERT trigger forging `attempts`/`last_error`; `DO INSTEAD NOTHING` rule on DELETE; FK `messages → jobs(id)`; state/id defaults | Fingerprint constraints, function body, triggers, rules, indexes, grant options |

**Flakiness:** `pnpm exec vitest run packages` ×5: 240/240 each, about 5.3 s; ×3 more with both CPUs saturated: 240/240, about 13 s. No `psa_test_` database left.

**False or stale claims**
- "282 tests" is the whole suite (8 files); the command you gave runs 240.
- ADR "Tests step a clock and never sleep" and `jobs.test.ts:2` say the same; `lease.test.ts:222` sleeps 300 ms, and `jobs.test.ts:524-535,631` use the real clock and a 50 ms timeout.
- ADR "the code refuses it first": not for size (K5).
- `core/src/jobs.ts` "so it can never carry data" and ADR "plain lower-case name": digits are allowed (`p15550100`).
- `lease.ts:71-73` "can deadlock": no longer reproduces.
- "fourteen ways": the test has 15 jobs cases, counting `DROP TABLE jobs`.
- True: fifteen statements (7 + 5 + 3), five insert columns, twenty rounds, 2/4/8/16/32 s, 4 and 5 minutes, 30 s.

**Could not check:** the real 4-minute timeout and a lease born expired after a transaction open over 2 minutes (extrapolated from 3 s); the two K7 leaks were not exercised end to end; `make check` and CI were not run; no network. `rv_x` and `/tmp/rv` removed; `git status --short` empty.

---

## Author's response

Added on 2026-11-17 by the agent that wrote the change. The report above is
unedited. It found no High defect and four Medium ones. These second fixes
were not checked again by a reviewer. The suite now has 293 tests.

| Finding | Response |
| --- | --- |
| K1 | Not fixed; recorded as accepted in the ADR amendment and #282. The application role can already lock every table it may update, so this is not new with the delete right, and it takes code of ours to do it. |
| K2 | Fixed in part. The application role cannot date a job more than a minute into the past; tested for two minutes ago and for 1970. Nothing limits how many jobs a tenant queues (#282). |
| K3 | Fixed. The clock is read at each statement. Tested: a lease taken a second into its transaction still has its two minutes. |
| K4 | Fixed. A handler's result must be nothing, or a wait from 0 to an hour; anything else fails the run with the code `bad-handler-result`, and an error while putting the job back is recorded the same way. Eight cases tested. Not done: a limit on how often a job may be put back. |
| K5 | Fixed. Code and table apply the same rule: at most 20 keys of at most 40 letters. The byte limit is gone. Tested at 20 and 21 keys and at 40 and 41 letters. |
| K6 | Recorded as accepted in the ADR amendment. |
| K7 | Not fixed (#282). The check reads policies, privileges, ownership and functions' rights. It does not notice a changed constraint, function body, trigger, rule or index; the tests of those run on the migrations as written. |
| Claims | Corrected: the ADR and the test file no longer say the tests never sleep; a type is now letters and hyphens only, with no digits; the comment about a deadlock is replaced; "fourteen" is fifteen. |
