# Gate 4 verification: U4, the High finding and the fixes around it

A second agent, which did not write the change, checked the fix for G1 of
`2026-11-17-gate4-u4-database.md` and the fixes in the same commit, at
`9a22883`, against a PostgreSQL 16.15 server. Its report follows, as
received. It was asked for at most 35 lines and no preamble.

| # | Attempt (pool `max: 1`, database `rv_x`) | Result |
|---|---|---|
| 1 | Handle kept after return, used during `withTenant(B)`, or on an idle connection | blocked ("this transaction has ended") |
| 2 | Handle kept after `work` throws (async or sync), used in B | blocked |
| 3 | Fire-and-forget query before `work` returns (read, write, 0.3 s sleep) | harmless: runs before COMMIT in tenant A; the write commits; B queued behind saw only B |
| 4 | Fire-and-forget query that fails | harmless: `withTenant` rejects "rolled back, not committed" |
| 5 | Handle used from `setTimeout` after `work` settled, while B runs | blocked (still runs in A if the timer fires while `work` is pending) |
| 6 | `work` resolves to `{tx}`, to a closure over `tx`, or a destructured `tx.query` | blocked |
| 7 | `work` returns a thenable that queries in `then()` | harmless: runs in A before COMMIT |
| 8 | Five concurrent `tx.query` calls; four interleaved A/B `withTenant` calls | harmless: every row in its own tenant; pg warns that queued queries go away in pg 9 |
| 9 | `work` returns a non-promise (handle kept, or query started synchronously) | blocked / harmless (runs in A) |
| 10 | Query between `open = false` and COMMIT (microtasks, `nextTick`, `setImmediate`, B waiting) | first microtask runs in A before COMMIT; every later one blocked |

- **G1: RESOLVED.** No attempt leaked. Removing the `open` check, or its assignment in `catch`, fails "a handle kept after its transaction…".
- **G2: PARTLY.** Swallowed error then return now rejects and the row is not kept; a swallowed error inside a savepoint still commits. Remaining: `work` running `ROLLBACK`, `COMMIT` or `COMMIT; BEGIN` still resolves, because the server answers COMMIT outside a transaction with `COMMIT` and a warning. After `ROLLBACK` nothing is committed; after `COMMIT; BEGIN` later queries ran with no tenant (0 rows). This is the trusted-SQL case of T33.
- **G10: RESOLVED, one Low left.**
  - `SET ROLE`, `SET LOCAL ROLE`, `SET SESSION AUTHORIZATION` and the `set_config` forms are refused by the server as psa_app (42501).
  - Pools as postgres, psa_cross and psa_migrate are refused on every call.
  - A session-wide tenant is cleared after commit, after a throw, after an aborted transaction (ROLLBACK runs first), and after `COMMIT; SET …; BEGIN`.
  - With an injected RESET or ROLLBACK failure the connection is discarded and the original value or error still surfaces; nothing in `finally` masks it.
  - Low: the check reads `current_user` once. A pool logging in as postgres with `options=-c role=psa_app` passes; `SET ROLE NONE` in `work` then counted 2 contacts as postgres, and the next call on that connection ran as postgres unchecked. Fix: compare `session_user` as well.
- **Mutations** (in a `/tmp` copy; baseline 111/111): each of the three fails exactly one test.
  - No `open` check: "a handle kept after its transaction cannot be used in the next tenant's".
  - No COMMIT command check: "work that swallows a failed statement is not reported as committed".
  - `UNIQUE (phone)`: "a phone number is unique within a tenant, and says nothing about another tenant".
  - Extra: removing RESET, the role check, or the transaction-id guard each fails a test; `release(broken)` → `release()` still passes 111/111 (admitted under G6).
- **Three unchanged runs:** 111/111 each, about 2.5 s, no flakiness, no leftover `psa_test_` database.

**New findings**
- **H1, Medium, `packages/db/src/migrate.ts:155-166` and `:43`.** The G8 guard runs after the record is written, and the loader misses `END`, `ABORT` and mid-line `COMMIT`/`ROLLBACK`.
  - `CREATE TABLE half ();\nABORT;\nCREATE TABLE other ();` throws "the step ended its own transaction", but `half` is absent, `other` exists, and `schema_migrations` has the row. A rerun returns `[]`: a migration recorded as applied with part of it rolled back.
  - `END;` in the same place: fully applied and recorded, yet reported as an error (the test title says "not recorded").
  - `…END;…SELECT 1/0;`: `half` is committed, the error is only "division by zero", and the rerun fails "relation half already exists".
  - Fix: compare the transaction id before the INSERT; on any step failure check whether the transaction changed and say so; refuse `END|ABORT|PREPARE TRANSACTION` and those words after a `;`.
  - Also Low: the loader refuses a comment or string line that merely starts with "Commit"/"rollback" (fails safe), and accepts a leading `BEGIN;`.
- **H2, Medium, `packages/db/src/policy-check.ts:184-185`.** The new settings branch joins `pg_roles`, so rows with `setrole = 0` are dropped.
  - After `ALTER DATABASE rv_x SET app.tenant_id = '<B>'` (committed in my scratch database) `findIsolationProblems` returned `[]`.
  - A new psa_app session's bare `pool.query` read B's contact, and after `withTenant(A)` the RESET restored B.
  - `ALTER ROLE ALL SET` is likewise unreported (in a rolled-back transaction).
  - Fix: LEFT JOIN and report `setrole = 0` rows for this database or all databases.
- **H3, Medium, `packages/db/src/bootstrap.ts:19`.** `scramVerifier` applies NFKC only, not SASLprep.
  - Against the server's own `pg_authid.rolpassword` for the same password and salt (role `rv_role`, rolled back): equal for ASCII, 200 characters, a ligature, a no-break space, accents, emoji, fullwidth, and quotes.
  - Different for a soft hyphen, a zero-width joiner, an emoji with U+FE0F, an unassigned code point, and a control character plus ligature. For the first three the server's value equals ours once the character is stripped.
  - pg's `lib/crypto/sasl.js:30` strips those characters at login (libpq not checked), so a role given such a password by `ensureRoles` should fail to log in with it.
  - Fix: apply the same mapping (non-ASCII space → space, strip the "mapped to nothing" set, NFKC, raw when prohibited), or refuse non-ASCII passwords.
- **H4, Medium, `packages/db/src/tenant.ts:47` (not introduced by the fix commits; not in the table).** No `error` listener is put on the checked-out client. Setting `idle_in_transaction_session_timeout = 50` and then waiting 300 ms inside `work`, or a backend terminated mid-`work`, killed the Node process with "Unhandled 'error' event" (exit 1), even with `pool.on("error")` attached. Fix: add `client.on("error", …)` for the duration, record it as `broken`, and remove it before release.
- **L1, Low, `packages/db/src/policy-check.ts:197-198`.** The definer allow-list matches by name only: a `SECURITY DEFINER` overload `channel_routes_sync(int)` granted to psa_app is not reported, nor is one in another schema. Fix: match on `oid::regprocedure` and cover every non-system schema.
- **L2, Low, `packages/db/src/migrate.ts:63-67`.** A record carrying the pre-fix (up-only) checksum makes status, up and down all throw "was changed after it was applied". Database `psa` already holds the new checksum, so it is unaffected. With the connection lost mid-step, the error thrown is the ROLLBACK/unlock one, not the cause.

**Could not check:** an actual login with an H3 password (needs a committed role); the committed effect of `ALTER ROLE ALL SET`; libpq's side of H3; CI; any PostgreSQL other than 16.15. Cleaned up: `rv_x`, `rv_m` and `/tmp/rv` are gone, there is no `rv_role`, the three roles still log in, `psa` is untouched, and `git status --short` is empty.

---

## Author's response

Added on 2026-11-17 by the agent that wrote the change. The report above is
unedited. It found no High defect and four Medium ones, three of them in my
fixes. These second fixes were not checked again by a reviewer. There are
now 119 database tests.

| Finding | Response |
| --- | --- |
| G2, remainder | Not fixed. Work that itself runs COMMIT or ROLLBACK, or swallows an error inside a savepoint, still resolves. That needs SQL text the code wrote; tracked in #279 with T33. |
| G10, remainder | Fixed. The login role is compared as well as the current role. Not tested: it needs a pool that logs in as the administrator. |
| H1 | Fixed. The guard now runs before the record is written, so a step that ended its transaction is never recorded, and a step that ended it and then failed says both. Tested with END, which commits, and with a step that rolls back part-way. The loader also refuses ABORT, PREPARE TRANSACTION and those words after a semicolon. It cannot refuse END, which function bodies use; the guard is what catches that. The loader still accepts a leading BEGIN and still refuses a comment line that starts with one of the words. |
| H2 | Fixed. A default for all roles or for the database that sets `app.tenant_id`, `row_security`, `role` or `session_authorization` is reported. Tested for the database and for all roles, in rolled-back transactions. |
| H3 | Fixed by refusal. A role password must be printable ASCII; anything else is refused before any role is changed. Tested. |
| H4 | Fixed. The connection has an error listener while checked out; a lost connection rejects the call and is discarded. Tested by ending the session from inside the work; without the listener the test run reports an unhandled error. |
| L1 | Fixed. The list holds signatures, and functions in every schema but the system's are looked at. Tested with a second function of the listed name. |
| L2 | Not fixed. A database migrated from `main` between #280 and this change holds the older checksum and must be recreated; none exists outside the agent's environment. The masked error on a lost connection is in #279. |
