# Design review: M3 U6, traces, cost and the log line

Reviewed: `docs/design/notes/m3-u6-traces.md` as first written (commit
`docs(design): traces, cost and the log line` on
`feat/305-m3-u6-traces`), before any code, by a second agent that did not
write it, working read-only in a copy of the repository. The report is
unedited. The author's response follows it.

---

**Read:** the note in full; US-C10; NFR-O2/P2/C1/V2; decisions row 47; plan rows and sections U6/U7/U9/U18; data-model `ai_traces`, `tool_calls`, retention row; ADR 0005 amendments (by grep); `packages/ai/src/bounded.ts` and `types.ts` in full; parts of `output.ts`, `prompts.ts`, `fake.ts`; `packages/db/src/jobs.ts`, `tenant.ts`; `packages/core/src/jobs.ts`, `model.ts`; worker `main/worker/handlers.ts`; api `server.ts` (parts). **Not checked:** `webhook.ts` body, architecture.md, ADR 0010, issue #186 itself, migrations beyond grep, any test run.

## Findings

**D1 — High — §4 C10 (overflow).** "The result fits a 64-bit number" is false. A count may be any safe integer (`bounded.ts:38-40`, `Number.isSafeInteger`, about 9.0e15) and a price up to 1e12. One term is about 9e27; after dividing by 1e6 it is about 9e21, over 2^63 (about 9.2e18). Even a realistic 1e6 tokens × 1e12 is 1e18, past 2^53, so "whole numbers, no floating point" requires BigInt, which the note never says. *Change:* state BigInt arithmetic; cap counts for costing (or make an over-cap count a null cost) and lower the price cap so the maximum provably fits `bigint`; say how the column is read back (pg returns a string).

**D2 — High — §2 T8 with §3 CHECKs (paid poison loop).** The client does not validate what the table will refuse. `requestFault` checks only that `prompts` is an array (`bounded.ts:129`); nothing checks 1 to 8 entries, the name pattern (`prompts.ts:42`) or version ≥ 1. A tool's name is only "a string" (`bounded.ts:132-137`), and no tool-name pattern exists in `packages/*/src`. `client-type.test.ts:74,88` already builds requests with `prompts: []`. Such a request is called, billed, the insert is refused, T8 throws, and the job retries: `JOB_RETRIES = 5` (`core/jobs.ts:13`) gives six paid calls, none recorded, then a dead job and no reply. *Change:* validate everything a CHECK enforces before the adapter is called (extend T6/T7), and distinguish a refused row (deterministic, do not repeat the call) from an unreachable database.

**D3 — High — §3 `model` pattern vs T5.** Today a model name is any string up to 200 code points without control characters (`bounded.ts:60-68`, `output.ts:31-33`). The note narrows it to letters, digits and `. _ : / -` and makes a miss a `fault`. That is a fault raised after a billed answer: the row loses the counts and cost (T5 "no counts"), the error is thrown, and the turn retries and pays again each time, e.g. for a name containing `@` or a space. *Change:* on a non-conforming name, keep the result and the counts and store a sentinel model (cost null), rather than throwing.

**D4 — High — §3 `window_closed_at` = "the time its job was due".** Not available and not that time. `Job` carries no `run_at` (`jobs.ts:47-55`; `RETURNING` at :144). `run_at` is rewritten by `deferJob` (:196-197), used for both "busy" and "window still open" (`handlers.ts:104-110`), and by `failJob` on retry (:220). After a T8 retry or a busy defer the start moves later and NFR-P2 is understated. *Change:* take the window's end from `beginTurn` (conversation `turn_started_at`, migration 0006:43-44) and say whether a retried turn keeps its `turn_id` and window time.

**D5 — Medium — §5 the pattern does not keep a number or a name out.** A phone number is digits and a contact's first name is a short word; both fit "a short name or an identifier". `n` is "named whole numbers", and a phone number is one. `requestId`'s source and pattern are unstated (the api has no request id today; `server.ts:52` `logger: false`). By contrast job payloads admit only UUIDs under keys ending `Id` (`core/jobs.ts:85-92`) and `errorCode` bars digits "so that a number cannot ride along" (:97-109). *Change:* identifiers UUID-only; `requestId` generated server-side, never from a header; `event`, `code`, `names` and the keys of `n` drawn from closed lists; bound `n` values (e.g. ≤ 10^9); `code` only via `errorCode`.

**D6 — Medium — §2 "written by the client itself" vs "its own transaction".** The recorder has no time limit: the model call is bounded, the insert is not, so `generate` can outlast `timeoutMs` up to the handler timeout (`jobs.ts:289-298`). If U7 calls `generate` inside `withTenant`, the recorder's own `withTenant` can wait for ever on an exhausted pool (`tenant.ts:36-37`). A session row created in a still-open transaction would fail the trace's foreign key. *Change:* bound the recorder; require that the session is committed and no tenant transaction is open when `generate` is called.

**D7 — Medium — §2 missing outcomes.** No row exists for: a process killed mid-call or between answer and insert; a handler-timeout abort (`generate` takes no signal, so the call runs on and its trace lands after the job failed). "Every model call leaves one trace" needs "unless the process dies". T3's timeout row is written while the adapter may still be running; fine, but T5's rule "record, then throw" has no stated behaviour if the recorder hangs. *Change:* add rows T12 (crash) and T13 (job abort), stating what is lost.

**D8 — Medium — §4 C3 / row 47 "never under what the same prices would bill".** True only per costed row (a ceiling is never below its value). A session's sum omits timeouts, faults, unpriced models and untraced `health()` calls (ADR 0005:115-117: "a minimal request"), so it can be under. US-D4 will show this number. *Change:* word it as "per costed call", and require any sum to report the count of null-cost traces beside it.

**D9 — Medium — §3 `tool_names` "at most 16 (the limit on calls in one answer)".** The limit is 4 (`core/model.ts:37`, enforced `output.ts:292`). *Change:* use the constant.

**D10 — Medium — guardrail results have no owner.** US-C10, 1 lists them; the note still claims "criteria 1 and 2". Plan row U9 (`m3-ai-core.md:163`) does not cite US-C10, and §6 changes only rows U6 and U7. With "may not update" and several traces per turn, which row U9 fills is undefined. *Change:* amend row U9 and say the criterion completes there; decide the target row now.

**D11 — Low — §4 C11/C12.** A 10^12 cap ($1,000,000 per million tokens) catches no unit slip; duplicate JSON keys silently take the last; "empty" (`""` or `{}`) is undefined; a later price cannot fill a null cost because updates are forbidden. The api does not read the setting, which is fine but unstated.

**D12 — Note — §6.** The retention row (`data-model.md:476`) says `tool_calls` hold no text; the note rightly doubts it, but lists it only as an "open question" while the table stays "Kept".

## Could not fault
- Null vs zero (C4 to C6, C9); exact name matching (C7); prices stored per row.
- T6/T11 match `bounded.ts` (`within` drops late answers, :162-167).
- The `sessions` composite key exists (`0006_sessions.up.sql:30`), so the tenant-and-session foreign key is possible.
- Moving `tool_calls` to U7 does not break U6's "done when" (`m3-ai-core.md:160`), though the U6 section text (:344) must change.
- `turn_id` + `session_id` + `cost_micros` suffice for cost per session, given D8.

---

## Author's response

All four High findings are accepted and the note is rewritten. **The
rewritten note has not been reviewed again.**

| Finding | Answer |
|---|---|
| D1 (High) | Accepted. Costs are worked out with `BigInt`. A count over 10^9 is not costed (null), and a price is at most 10^9 (a thousand dollars a million tokens), so the largest cost is 2 × 10^12 and fits both a JavaScript whole number and the column. The column is read back as text and turned into a number, checked to be a safe one. C10 says this |
| D2 (High) | Accepted. Everything the table checks about a request is checked before the adapter is called, by the same patterns, kept in one place in the core: 1 to 8 prompts, each name and version, each offered tool's name. A test stores a trace of every outcome the client can produce in a real table, so a record the client makes and the table refuses is a failing test, not a paid loop. A recorder's failure stays T8; with the above it means the database could not be reached or was too slow |
| D3 (High) | Accepted. The client's rule for a model's name stays as U4 built it. A name that does not fit the table's pattern is stored as `other`, with its counts; its cost is null. Nothing is thrown and the result is unchanged |
| D4 (High) | Accepted. The column is `turn_started_at`: when the turn began, as the caller gives it, which U7 takes from `beginTurn`. It is not the window's end: the wait between the two (the poll interval and any queue) is not in it, and #186 stays open for that. A turn's identifier is made each time the job's handler runs, so a retried turn is a new turn |
| D5 | Accepted. Identifiers are UUIDs only; the request's is made by the api, never read from a header; `event`, the keys of `n` and the job types that `names` may hold are closed lists; a `code` has letters and hyphens only, as `errorCode` gives it; a name in `names` is a setting's (`PSA_` and capitals) or a job type; a number is 0 to 10^9 |
| D6 | Accepted. The recorder has a time limit of its own (5 s), after which T8 applies. The note requires that `generate` is not called inside an open tenant transaction and that the session is committed; U7 must keep to it |
| D7 | Accepted: T12 (the process dies) and T13 (the job's own time runs out) are added, with what is lost |
| D8 | Accepted. The sentence is now about one costed call. The one function that sums a session's cost returns beside it how many of the session's calls have no cost |
| D9 | Accepted: 4, by the constant |
| D10 | Accepted, differently: the column is not made in this unit at all. U9 adds it with the code that fills it and decides which trace of a turn holds a result. This unit claims US-C10, 1 without guardrail results; the plan's row U9 now cites the criterion |
| D11 | The cap is 10^9. Absent, empty and `{}` all mean no prices. A duplicate name in the JSON takes the last value, as JSON does: known, not caught. A null cost is never filled in later; the counts are kept so that a report can work one out. The api does not read the setting |
| D12 | The data model's retention row now says the claim about `tool_calls` is unproved until U7 |
