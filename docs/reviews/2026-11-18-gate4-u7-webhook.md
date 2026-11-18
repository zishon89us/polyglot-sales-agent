# Gate 4 review: U7 the webhook stores events and queues their jobs

The reviewer's report follows, as received, except for its heading line,
which the author's session did not keep. It reviewed the branch
`feat/268-webhook-store-queue` at `4a1fab7`.

| ID | Sev | Location | Finding (reproduction) | Fix |
|---|---|---|---|---|
| W1 | High | `packages/db/src/inbound.ts:67-69, 79-82`; `data-model.md` decision 16 | Contact matching attaches messages to the wrong person in cases no repository document states. Run in sequence: (P1,U1), (P2,U1), (P1,U2), (P2,U1). Result: U2's message joins U1's conversation, U1's identifier is overwritten, and U1 becomes a new contact. A changed number is never stored: after (P1,U1), (P2,U1) keeps P1, and (P2,–) then makes a second contact. The comment "the channel makes a new one when it must" has no source in `compliance.md`. Mutant `coalesce(channel_user_id,$2)` survives, so the overwrite is untested. | Do not overwrite a different existing identifier (new contact, or flag it). Update the phone when the identifier matches. State every case in the data model and test each. |
| W2 | High | `apps/api/src/app.test.ts:428-447`; ADR 0003 amendment | "A test fails if a source file of an app holds a statement or runs a query of its own" is false: 1 of 6 planted styles was caught. Missed: `p.query.bind(p)` with lower-case SQL; ``c["query"](`DELETE FROM contacts\n WHERE phone='${who}'`)`` (input-built, the T33 case); `Reflect.apply(q.query,…,"TRUNCATE messages")`; a `.mts` file; a file in `packages/channel`. The ADR rests on "can be checked". | Enforce by imports: only `packages/db` may import `pg` or receive a pool; scan every package. Or reword the ADR. |
| W3 | Medium | `inbound.ts:158-173`; `webhook.ts:15` | A large webhook is answered 503 for ever. 12,000 messages (1.16 MiB, limit 3 MiB): first 503 at 5 s, commits 11.5 s later; second and third deliveries 503 again, because the duplicate pass alone takes over 5 s (3,000 duplicates take 2.0 s on loopback). `api.md` says a duplicate gets 200. The `malformed-items` record is then never written. | Deduplicate set-wise (one `INSERT … SELECT unnest … ON CONFLICT`), or cap and split batches. Test at the body limit. |
| W4 | Medium | `apps/api/src/main.ts:14-15`; `app.ts:38-39` | Pools have no connection, statement or lock timeout. One contact row locked from outside plus 12 webhooks for it: pool 10/0 idle/3 waiting, another tenant's webhook 503, `/readyz` no answer in 3 s; all 12 commit after their 503s. With a listening-but-silent database `/readyz` never answers (over 8 s) and 50 probes leave 10 connecting and 41 queued. The test at `app.test.ts:284` sets `connectionTimeoutMillis: 500`, which `main.ts` does not. | Set `connectionTimeoutMillis`, `statement_timeout`, `lock_timeout`; time-box `/readyz`; test with `main.ts`'s own pool settings. |
| W5 | Medium | `apps/api/src/config.ts:35-36`; `app.ts:38`; `main.ts:17-18`; `server.ts` (`logger: false`) | Settings fail late and silently. With `PSA_DB_APP_URL` set to the cross role (or the reverse) the process starts, `/readyz` says 200 "ready", and every webhook is 503. A wrong password or a garbage URL also starts. Nothing is logged for any 503, and pool errors are swallowed. | Check both roles at start (`current_user`); make `/readyz` check the role; log an error code per 503 (NFR-O2). |
| W6 | Medium | `apps/api/src/sink.ts:35-43`; `inbound.ts:161-165` | The webhook answers 200 and discards data the channel will not resend: `sentAt`, a status's time and `errorCode` (§7: `failed` "stores the error code"), and the unsupported type name (data model: `kind` holds it). Three messages in one webhook get one `created_at` (measured: 1 distinct of 3), so their order is lost to the worker. | Add `sent_at` and `error_code` now, or state the loss in the table. |
| W7 | Medium | `data-model.md:354-356`; `threat-model.md` T39; `sink.ts:65,80,91`; `app.ts:39` | "Nothing else may use the cross-tenant role" is no longer true: the request path now writes `unroutable_events`, `unparsed_events` and an `operator-alert` job with it, and `/readyz` probes with it. The "import-boundary test" both documents cite does not exist in the repository. | Add the three uses to the list; build the boundary test or stop citing it. |
| W8 | Medium | tests | 18 of 44 mutants survive. Untested: uniqueness of `channel_user_id` per tenant (constraint widened to include `phone`); its CHECK; the second pass of `contactFor`; `read` from `sending`; `sent` from `pending`/`held`; alert due time (+1 day); kind `status` for an unroutable status; both `stopIfAborted` calls; `/readyz` with one role down (`&&`→`\|\|`, cross→app); port bounds; an empty-string setting; `itemsLeftOut` (+skipped). A webhook mixing an unknown and a known number works (verified) but has no test. | Add a test for each. |
| W9 | Low | `inbound.ts:66-83` | Every message does an `UPDATE contacts`, even a no-op, which takes a row lock. Two webhooks with the same two customers in opposite order deadlocked in 29 of 30 runs (1 s each, loser 40P01 → 503, connection healthy). | Select first and update only to fill; or sort contacts. |
| W10 | Low | `0003_inbound_events.up.sql:18`; `data-model.md:333` | `payload_hash` is an unkeyed SHA-256 stored with the size. The 8-byte body `15550142` is stored as `edc710a5…`, which equals `sha256("15550142")`: a short body is recoverable by brute force. The documents do not consider it (T36 does, for `suppressed_numbers`). | Key the hash, or state the limit. |
| W11 | Low | `sink.ts:2`; `inbound.ts:2-3`; `api.md:138,190-203`; `architecture.md:305,309`; STATUS | Document slips. The comments cite a heading "Receiving an event" that does not exist. The "What is trusted…" paragraphs now sit under "Health". `api.md` and decision 8 say "kept 30 days" though no deletion exists. "Each number's events are one transaction" is false: one number in two `changes` gave two transactions and two jobs for one conversation. "One row in `unroutable_events`" is one row per event. | Correct the text. |
| W12 | Low | `config.ts:32`; `main.ts:31` | `PSA_API_PORT=0x9a1a` listens on 39450. A verify token of `" "` is accepted. With `PSA_API_HOST=0.0.0.0` the log line still says `127.0.0.1`. SIGTERM kills with no drain. | Parse the port with `^[0-9]+$`; print the configured host; close on SIGTERM. |
| W13 | Low | `inbound.ts`; `tenant.ts:103` | One message costs 11 statements (1 cross, 10 app), and a duplicate 10. Avoidable: `RESET app.tenant_id`, the separate conversation `SELECT`, the no-op contact `UPDATE`. | Merge them. |
| W14 | Low | `policy-check.ts` | `findIsolationProblems` is clean on the migrated database but misses 5 of 9 weakenings of the new tables: `UPDATE, DELETE` to `psa_cross` (`isolation.test.ts` does catch this one), added columns `body`, `sender_phone`, `tenant_id`, and a dropped hash CHECK. | Pin the columns of the unscoped tables. |
| W15 | Low | `inbound.ts:164` | An inbound message whose identifier equals an outbound one in the tenant is counted as a duplicate and dropped with 200 (reproduced). | Make uniqueness per direction, or state it. |

**Clean:**

- Deduplication: the same message 20 at once, 50 times, always gave 1 contact, 1 conversation, 1 message, 1 job, all 200. Two messages of one new customer at once, 100 times, never split. Two tenants with the same identifiers stay separate. A message and its job are atomic.
- Phone-only and ID-only arriving together make two contacts that never merge (decision 16 states this). The three-way race gave 35 transient 23505s in 600 calls and nothing inconsistent.
- No permanent `contact-conflict`, 23505 or `no-channel-account` case was found; isolation is read committed.
- Tenant isolation: as tenant A, read and update of B's contact by `channel_user_id` return 0 rows; an insert into B gives 42501 before any unique check, so there is no oracle. `psa_app` is denied on both new tables; `psa_cross` cannot update or delete them. The NOT EXISTS subquery is tenant-scoped by RLS, and `withTenant` refuses any other role.
- No personal data: for an unknown number and four unreadable bodies, no number, name, text or user ID appeared in any table (including `jobs.payload` and `last_error`), any HTTP answer, or stdout/stderr. `main.ts` printed only the listen line.
- Statuses: the transition matrix matches §7 and the table. A status for another tenant's or an inbound message changes nothing; a repeat applies 0; a status for an unknown number is recorded with kind `status`.
- Late commits after a 503 are harmless on redelivery, including the malformed record. 100 new customers in one webhook took 269 ms, 1,000 took 1.9 s.
- A refused port gives 503 at once; a port in use exits 1 with a clean message; `/readyz` shows no cause; the default host is 127.0.0.1.
- The down migration is covered (both mutants killed). "About forty" holds: 41 `.query(` calls. Decisions are labelled as the agent's.
- The suite ran 5 times: 633 of 633 each time, no flake, no leftover `psa_test_` database. NFR-P1 medians were 26–35 ms and p99 105–157 ms (STATUS says 34 and 105); the test cannot fail on latency.

**Gate 4:**

- Does what the criteria say, nothing else — pass, except W3 (a duplicate is not always 200).
- Each criterion has a failing test — pass for five-times, 401, 413 and 503; fail for "does nothing else" (no assertion) and W8.
- Failure paths tested — partly (W4, W8).
- Tenant-scoped — pass.
- Input validated — pass.
- No secrets, personal data, disabled tests — pass.
- New dependencies — pass (`pg` was already in the workspace).
- Logs carry no numbers or bodies — pass, because there are no logs (W5).
- Docs, traceability, changelog match — fail (W1, W2, W7, W11); there is no changelog file.

**Ran:** scratch scripts against databases `rv_one` to `rv_five`, using real pools and `main.ts` on ports 39417–39419; `pnpm run test` five times; `make check` (exit 0); 44 mutations and 6 planted SQL files in a /tmp copy. Everything is removed; `git status --short` is empty; no `rv_` or `psa_test_` database and no process is left.

**Could not check:**

- The text of issues #284, #288, #268 and PR #289 (no network), so whether #288 states W1's consequences honestly.
- The by-hand run with the mock.
- Which interface `PSA_API_HOST=0.0.0.0` actually binds (no `ss` or `netstat`).
- Meta's real batch sizes, which decide how likely W3 is.
- Any PostgreSQL version other than the local 16.

## Author's response

Written by the agent that wrote the unit. The fixes were then checked by a
second agent that had not seen them made; its report is
`2026-11-18-gate4-u7-verification.md`.

| ID | Response |
|---|---|
| W1 | **Fixed.** The rules are rewritten on one idea: the identifier is the person, and a number is something a person holds for a time. A contact found by identifier is used whatever number came, and takes a new number only if no other contact holds it. A contact found by number is used only if it has no identifier, or the message has none; otherwise a new contact is made without the number. An identifier is never overwritten. The data model has every case as a table ("Which contact a message belongs to") with what follows from it, and each row is a test, as is the reviewer's sequence. The unsourced comment is gone |
| W2 | **Fixed by changing what is claimed.** The text search for SQL is removed. Only `packages/db` imports the driver: the API now gets an opaque handle (`Database`, one frozen property, the role's name), the function that turns a handle into a connection is not exported, and `pg` is no longer a dependency of `apps/api` except for its tests. A test scans every non-test source file of every app and package outside `packages/db`, of any extension, for the driver's name. The ADR is reworded to say this and to say what it does not show: that the statements inside `packages/db` are fixed text is by reading |
| W3 | **Fixed for the case found; one part stated.** Messages already stored are found with one query before anything else, so a redelivery does no per-message work. Measured: 12,000 messages took 7.6 s to store the first time and 32 ms the second. The first delivery of a webhook that large is therefore still answered 503 once, finishes storing, and gets 200 when sent again. Nothing caps or splits a batch (#288). The test is at 1,500 messages, not at the body limit |
| W4 | **Fixed.** Every handle is opened with limits: 2 s to connect, 4 s a statement, 3 s for a lock, 10 s idle in a transaction. `/readyz` gives each role 2.5 s. Tests use handles opened as `main.ts` opens them: an unreachable database, one that accepts and says nothing, and a row locked from outside, where the webhook is answered 503 with code `55P03` while another tenant's is served |
| W5 | **Fixed.** At start each handle must answer as its own role or the process exits naming the setting; `/readyz` makes the same check, so swapped addresses are not ready. Each webhook answered 503 writes one line of JSON with a short code. `main.ts` itself is not under test (#288) |
| W6 | **Fixed.** `messages` has `channel_sent_at` and `error_code`; `kind` holds the channel's type name; `created_at` is taken per row, and a test counts three distinct times for three messages. A status's own time is not stored: nothing reads it |
| W7 | **Fixed.** The three uses and the readiness check are in the list. Both documents now say what enforces it today (the driver boundary of W2) and that a test of which modules may hold the cross-tenant handle is not built (#162) |
| W8 | **Fixed.** A test for each item listed: the identifier's uniqueness with and without a number and its CHECK; the second look of `contactFor`, with another transaction's insert held open; `read` from `sending`; `sent` from `pending` and `held`; the alert's due time; kind `status` for an unroutable status; the sink with its signal already aborted; `/readyz` with either handle wrong; port bounds and forms; blank settings; `items_left_out` with a skipped part beside it; a known and an unknown number in one webhook. The mutants were not run again by the author; the verifier was asked to |
| W9 | **Fixed.** A contact is selected first and updated only to fill a missing value or follow a changed number. The reviewer's two-webhook deadlock was not re-run by the author |
| W10 | **Stated, not changed.** The data model says the hash is not keyed and what that allows. A body with a person's number in it is a whole webhook, and a body short enough to guess says nothing of anyone |
| W11 | **Fixed.** The comments cite the heading that exists. "What is trusted" is back above "Health". "Kept 30 days" now says nothing deletes yet. The sink merges a number's events from every part of the body, so one number is one transaction and one job, with a test. "One row for each event" |
| W12 | **Fixed, one part stated.** The port must be 1 to 5 digits and in range; a blank setting counts as not set; the log line prints the configured host; SIGTERM closes the server and then the database handles. The close has no time limit of its own (#288) |
| W13 | **Partly.** The conversation is one statement and the no-op update is gone. `RESET app.tenant_id` is still its own statement (#288) |
| W14 | **Not fixed.** In #288 |
| W15 | **Fixed.** Uniqueness is per tenant and direction, with a test |

Of "Could not check": #288 is rewritten with the review's leftovers and the
contact rules as they now are. The by-hand run with the mock was not
repeated after the fixes.
