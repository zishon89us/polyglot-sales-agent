# Gate 4 review: M3 U6, traces, cost and the log line

Reviewed: commit `f350b38` on `feat/305-m3-u6-traces` (pull request
#329), by a second agent that did not write the code, working in a copy
of the repository with no network. The report is unedited. The author's
response follows it.

---

# Gate 4 review: M3 U6, traces, cost and the log line (`feat/305-m3-u6-traces`)

**What I did.** In `/tmp/review-u6` only. I read the design note and the full text of `core/trace.ts`, `core/log.ts`, `ai/bounded.ts`, `db/traces.ts`, migration 0009 up and down, `worker/main.ts`, `worker/traces.ts`, `api/main.ts` and `tools/log-shape.test.ts`. I read the diffs of `environment.ts`, `types.ts`, `fake.ts`, `worker.ts`, `server.ts`, both `config.ts`, `e2e.test.ts` and the documents (data model, architecture, ADR 0005, plan, row 47, `.env.example`).

- `pnpm -s exec tsc --noEmit -p .`: clean.
- `pnpm -s exec vitest run`: 43 files, 1480 tests, all pass.
- A temporary probe test, built like `apps/worker/src/traces.test.ts`, put about 20 inputs through `bounded` and `traceRecorder` into a real table. It is deleted.
- 51 mutants, each restored; `git status` is clean and nothing is committed.

**Not checked:** the test files line by line (only through mutants and title greps), `STATUS.md`, `README.md`, `traceability.md`, the runbook and glossary, the review document the note answers, behaviour under a real pool timeout, and the down migration beyond reading it (one `DROP TABLE`).

## Findings

**G1 (Medium): a valid `Date` that PostgreSQL cannot hold is a paid call with no record.** `packages/ai/src/bounded.ts:188-201` (`placeOf`) and `:416-420` (the clock) accept any non-NaN `Date`. Probe: `turnStartedAt: new Date(Date.UTC(-4800,0,1))` and `new Date(-8.64e15)` both gave `TraceNotStored`, cause `22008 timestamp out of range`, after the adapter answered. A clock returning such a date for `startedAt` did the same. The note's section 2 and ADR 0005 say everything the table refuses is refused before the call; that is true of the request but not of the place or the clock. The upper end (year 275760) and 100 BC are stored. Fix: bound both dates in `placeOf` and at the clock check (for example 1970 to 9999) and add the edges to `apps/worker/src/traces.test.ts`.

**G2 (Medium): the price list is held by reference, so it can change after `bounded` is called.** `bounded.ts:364` (`this.#prices = options.prices ?? {}`). Probe: after `prices.m = { input: 1, output: 1 }` the next call was costed 1 instead of 10,500. `readModelPrices` returns frozen objects, so the worker's own path is safe; any other caller, U7's wiring included, is not. Fix: copy each own entry into a frozen null-prototype object in the constructor, validating each price once.

**G3 (Medium): `tools/log-shape.test.ts` passes while a service writes free lines.** I added `apps/api/src/sneak.ts` using `writeSync(1, …)`, `import { stdout } from "node:process"`, `const { stderr } = process` and `globalThis["console"]["log"]`; the test passed (3 of 3). It also scans only `apps/api/src` and `apps/worker/src`; packages those services import are not scanned. `architecture.md` ("A test finds any write to the console or a stream outside the two `main.ts` files") claims more than this. Fix: also refuse `node:process`, bare `process` outside `main.ts`, `writeSync`/`createWriteStream` and `console` in any spelling, and scan the imported packages; or soften the sentence.

**G4 (Medium): a line's words are not from a closed list at the point of logging.** `core/environment.ts` `startReasons` returns any strings found on `error.reasons`, and `core/log.ts:62` (`NAME`) lets any 1 to 40 small letters and hyphens through. `PRODUCTION_REASONS` exists but is not used to filter. `code` is the same: `errorCode` takes any `error.code` of up to 40 letters. Today's throwers are the repository's own, so nothing leaks now; but the note's "a word can appear only if it is in a closed list" is not enforced by the code. Fix: filter `startReasons` through `PRODUCTION_REASONS`, and job types through the known list.

**G5 (Low): the bound on `meta-` codes has no test, and it is the only thing stopping a long number.** `core/log.ts:60`. Mutant M9 (`meta-[0-9]{1,16}`) survived all of core, ai, worker-traces and log-shape tests. `channel-whatsapp/src/send.ts:199` builds `meta-${code}` from any safe integer in the provider's body, so with the bound loosened a 15-digit number would be logged. Separately, a code longer than six digits is logged as `invalid`; if the provider uses such codes the operator loses them (not confirmed against the provider's list). Fix: a test with a 7-digit and a 15-digit code.

**G6 (Low): the prompt list's length is not re-checked after the copy.** `bounded.ts:392` and `:402-409`. A request whose `prompts` getter returned `[]` on a later read passed (`every` on an empty list), the adapter was called, and the table refused the row (`ai_traces_prompt_names_check`). The re-check block itself has no test: M26 (its throw removed) and M44 (prompts not copied) both survived. Fix: read `request.prompts` once into a local, re-check the length, and test it.

**G7 (Low): a clock that throws on its second reading loses a paid call's result with no trace.** `bounded.ts:434` is outside any `try`. Probe: `now` throwing on the second call rejected with the clock's error and stored no row. Only an injected clock can do this. Fix: wrap the second reading and use latency 0 on failure.

**G8 (Low): the note's T8 says "None could be stored", but a slow recorder is not cancelled.** `bounded.ts:367-375` ignores the abort signal `within` creates; `storeTrace` runs on. A trace can therefore land after `TraceNotStored` was thrown, giving a row for a call whose result was dropped. The cost sum stays right (both calls were paid); the note and ADR are inexact. A session that is unknown, uncommitted or another tenant's also gives `TraceNotStored` after payment (probe: `23503`); the note accepts this by rule ("U7 keeps to this"), with no check. Fix: correct T8, and have U7 test the committed-session rule.

**G9 (Low): operators lose things the note does not list.** L2 admits the sentence is gone. Also gone:
- which problem `PSA_MODEL_PRICES` has (only the setting's name survives);
- the api's host and port on `listening` (the old line had them);
- any detail of an unexpected start failure beyond a class name.

The api never writes `stopped` (`api/main.ts:65-72`; L1 says each service does), handles no SIGINT, and a failed close sets exit code 1 with no line. `webhook-unavailable` carries no `requestId` (`api/main.ts:59`), though it is about one request (NFR-O2). Fix: add `stopped` and the `requestId`, and give `readModelPrices` problems short reason names.

**G10 (Low): `readModelPrices`' unknown-key test is weak.** M6 (the `keys.length !== 2` check removed) survived: the test's extra key sorts before `input`, so a third key sorting after `output` would be accepted unnoticed. Fix: add `{"input":1,"output":1,"zzz":1}` to the C11 cases.

**G11 (Note): smaller gaps.**
- `api/server.ts`: the `>= 500` level (M40) and `durationMs` (M42) have no test; `worker.ts`: `durationMs` (M39) and a throwing `ran` (M51) have none.
- T13 has no test; T12 cannot have one; C9 and C14 are not named in any test.
- `costOfSession` answers `{0,0,0}` for a session that does not exist or is another tenant's, the same as a session with no calls. Its query is supported by the `(tenant_id, session_id, started_at)` index once row security adds the tenant; my `EXPLAIN` was on a near-empty table and shows nothing useful.
- `psa_cross` has no privilege on `ai_traces` (grants probe: only `psa_app` INSERT and SELECT, plus the owner), so no cross-tenant report can read costs yet.

## Mutants (51 run: 41 killed, 10 survived)

| # | File | Change | Result |
|---|---|---|---|
| M1–M5, M7, M8 | `core/trace.ts` | rounding constant, both ceilings `<`, 100-name limit `>=`, `other` allowed, 9 prompts, 65-char tool name | killed |
| M6 | `core/trace.ts` | drop `keys.length !== 2` | **survived** (G10) |
| M9 | `core/log.ts` | `meta-` up to 16 digits | **survived** (G5) |
| M10–M12, M14 | `core/log.ts` | digit in a name, no cap on names, no number ceiling, longer digit code | killed |
| M13 | `core/log.ts` | `settingsNamed` uncapped | survived (`logLine` caps again; equivalent) |
| M15 | `ai/bounded.ts` | drop `Object.hasOwn` | survived (equivalent: `modelCostMicros` rejects a non-price) |
| M16–M22, M24, M25, M27, M43, M45 | `ai/bounded.ts` | `other` costed, prices without cost, T9 order, T8 swallowed, limit +1, latency clamps, place not copied, NaN date, 0 prompts, start time shifted, code dropped | killed |
| M23 | `ai/bounded.ts` | equivalent rewrite of the tool-names condition | survived (equivalent by construction) |
| M26, M44 | `ai/bounded.ts` | re-check removed; prompts not copied | **survived** (G6) |
| M28 | `db/traces.ts` | sum over all sessions | killed |
| M29 | `db/traces.ts` | drop safe-integer guard | survived (not reachable with the column's bounds) |
| M30–M36, M46–M50 | `0009_traces.up.sql` | no FORCE, UPDATE granted, costed/`other`, null code, 5 tools, tools on non-ok, single-column key, cost ceiling, null version, `WITH CHECK (true)`, one count, one price | killed (12) |
| M37, M38 | `worker/worker.ts` | conversation null, attempts 0 | killed |
| M39, M51 | `worker/worker.ts` | duration 0; throwing `ran` not caught | **survived** (G11) |
| M40, M42 | `api/server.ts` | `> 500`; duration 0 | **survived** (G11) |
| M41 | `api/server.ts` | request id read from a header | killed |

## What I could not fault

- `modelCostMicros`: BigInt throughout, ceiling exact at C3 and C10, null and never 0 for an unpriced model, a fractional price or a count over 10^9. A count of 2^53−1 is stored uncosted.
- `priceInput`/`priceOutput` are null exactly when the cost is; model names such as `constructor` cannot pick up a price from the prototype chain.
- Patterns and bounds: prompt name and version, tool name and count, model name, outcome codes, the latency clamp, and upper-case UUIDs agree between `core/trace.ts`, `bounded.ts` and 0009; `$` and newline behave the same in both engines for these patterns.
- Migration 0009: every constraint I mutated is tested. Row security is forced with a `WITH CHECK`, the application role cannot update or delete, and the composite key refuses another tenant's session.
- `costOfSession` isolation: another tenant gets `calls: 0` for a foreign session.
- Control flow: T5, T8 and T9 ordering; a late rejection from the adapter or recorder is handled (no unhandled rejection); timers are cleared on settle; a synchronous throw from the recorder is caught.
- `apps/api/src/main.ts` and `apps/worker/src/main.ts` as written log only through `logTo`. The e2e test checks every line of a real run for the eleven keys and for no `invalid`.
- Design note numbers (8 prompts, 4 tools, 200 characters, 10^9 ceilings, 2×10^12, 5 seconds, 100 names) match the code.

---

## Author's response

No High finding. The fixes are in the commit after `f350b38`. Whether
another agent has checked them is said in
`2026-11-24-gate4-u6-traces-verification.md` if that file exists, and
nowhere else.

| Finding | Answer |
|---|---|
| G1 (Medium) | Fixed. A place's time and the clock's reading must be a date from 1970 to 9999; anything else is refused before the adapter is called. Tests at both edges in the client, and both edges are stored in a real table |
| G2 (Medium) | Fixed. The price list is copied when the client is made, into an object nothing outside can change, and each price is checked then: a client is not made with a price that is not one. A test changes the list after the first call and the second call's cost is the same |
| G3 (Medium) | Fixed in part, and the claim is made smaller. The test now also refuses the four ways the reviewer used and others like them, and reads the packages the two services import (the database's command-line program, which an operator runs and no service imports, is left out by name and that is checked). It is still a check of names in source text; the architecture now says so and no longer says "any write" |
| G4 (Medium) | Fixed for reasons and job types: the reasons written are those of the list only, and a job's type is written only if this worker has a handler for it. **Not fixed for `code`:** it is whatever short name an error carries. The note said a word comes only from a closed list; it now says what is true (#330) |
| G5 | Tests added for six, seven and fifteen digits; the mutant is killed. Whether the provider has longer numbers is not checked (#330) |
| G6 | Fixed: the copy is taken once and its length is checked again with its contents. Tests with a request whose prompts read differently each time, and one that changes them during the call |
| G7 | Fixed: a clock that fails after the call gives a latency of 0; the trace is stored and the result given |
| G8 | The note's T8 now says what happens. Stopping a slow recorder, and a test of the committed-session rule, are #330 |
| G9 | The api now writes `stopped`, stops on an interrupt as well, writes a line when closing fails, and gives its port on `listening`. The rest is #330 |
| G10 | Fixed: two more cases; the mutant is killed |
| G11 | Not fixed here: #330 |
| M13, M15, M23, M29 | Left: equivalent or unreachable, as the reviewer says |
