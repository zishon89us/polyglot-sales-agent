# Check of the fixes: Gate 4 review of M3 U7

Checked: commit `d102e84` on `feat/306-m3-u7-turn`, by an agent that
wrote neither the code nor the review, in a copy of the repository with
no network. Its brief was narrow: whether the fixes do what the author's
response says. The report is unedited. The author's response follows.

---

**Ran / not checked.** In `/tmp/verify-u7` only (tree left clean, nothing committed): full suite **1643 tests pass (46 files)**, `tsc` clean. Temporary probes (deleted) against a real database for `runTool`, for `bounded` and the stand-in; 11 mutants, each restored. Not checked: issue #332 (no network), the review's own counts in STATUS (9 findings, 8/46 mutants, "about 9 seconds"), the M7 identifier wording, behaviour under load, the down migration beyond the suite.

Measured G1 (default limits; "freed" = when another connection's `UPDATE conversations` got through): `pg_sleep(3)` returned 506 ms, freed 503 ms; loop of 0.1 s statements 2036/2035 ms; loop of 0.45 s statements 2260/2258 ms (same when the tool swallows errors); tool that never resolves 2007/2004 ms. Every case left exactly one `failed` row. Pool of size 1: `statement_timeout` read back `0` in the next transaction and `pg_sleep(1)` succeeded, also after a timed-out tool: no leak. `timeoutMs` of 1 and 0.4 still stored `done`.

| Row | Verdict | How I know |
|---|---|---|
| G1 | Holds | Times above; worst hold 2.26 s; removing the `SET LOCAL` line fails the new test (3050 ms). The test uses `timeoutMs: 100`, not the defaults |
| G2 | Holds in part | Renew-once and no-lease-check mutants killed. Mutant 8 is **not** equivalent (V1) |
| G3 | Holds | Index exists; with seqscan off the plan is `Index Scan Backward using messages_session`. The test checks the definition only, not the plan |
| G4 | Holds | `kind = 'text'` mutant killed; mutant 29 survives and is equivalent: `size` only grows |
| G5 | Holds | 20 texts through `bounded(standInEcho())` (U+2028, U+2029, U+FEFF, lone low/high surrogates, 1,300 combining marks, U+007F, U+009F, bidi, noncharacter, cut at 1,000) all `ok`; none `invalid-output` |
| G6 | Holds in part | System, tools, claim kinds: what the adapter got matched the single copy checked against. Gaps V2, V3 |
| G7 | Holds in part | V4 |
| G8 | Holds | Fragment-check mutant and both `turnStartedAt` mutants (`new Date()`, read late) killed |
| G9 | Holds for S4, S2a, H5 | Match `runTurn`/`finishTurn`/`sessionHistory` as read; #332 unchecked |

In G6 every adapter call left one trace; no unhandled rejection (0 counted); a function or symbol in a schema is refused before the adapter (`DataCloneError`).

**V1 (Note).** The response says of mutant 8 "nothing a test can see differs". A test that steals the token after the first trace and restores the same token 0.3 s later distinguishes it: original `lost-lease`, 1 model call; mutant `ended/stored`, 2 calls, a reply stored. Unreachable in production (tokens are random), so equivalent in practice only. Fix: reword the response.

**V2 (Low).** `maxOutputTokens` is checked in `requestFault`, then read again for `markedCopy`: a getter returning 4096 then `1e12` (or `"lots"`) delivered that value to the adapter unchecked. Fix: read once into a local and re-check, as `timeoutMs` is.

**V3 (Low).** Claim kinds are type-checked on earlier reads than the one copied: a getter returning `[42, {}]` on the third read reached the adapter. A Date, Map, cycle or BigInt in `argumentsSchema` is cloned and sent, so the renamed test "tools are not plain data is refused" claims more than the code does. Fix: validate the copies; refuse what `JSON.stringify` cannot round-trip.

**V4 (Low).** `asked` drops storable arguments: `{q: "a\\u0000b"}` (a literal backslash, no NUL) was stored as `arguments: null`, because the check looks for the text `\u0000` in the JSON. Fix: test the parsed value for U+0000, or match only an odd run of backslashes.

**V5 (Low, by arithmetic, unmeasured).** S2b's 165 = 100 + 25 + 40 is right, and 35 s between renewals is right, but both count only the tool's run. Each `runTool` transaction first waits for the row lock (`lockMs` 3,000), and a failed tool does so twice: 16 × 8.5 = 136 s, total 261 s, over `JOB_HANDLER_TIMEOUT_MS` (240,000). The same omission makes L3's "2.5 seconds at most" a bound on the tool, not on the transaction. `jobs.ts` repeats the figure. Fix: say what the sum leaves out, or bound the lock wait.

**V6 (Note).** The default 2,000/500 are pinned only by the constants snapshot test; no behavioural test runs at the defaults.

---

## Author's response

**These fixes are checked by the author only.** No agent has read them.

| Finding | Answer |
|---|---|
| V1 | The response is reworded: the two differ only if the same token is given back to the conversation, which no worker can do |
| V2 | Fixed: the limit on the output is read once, and the copy is what is checked and sent. Two tests |
| V3 | Fixed: the copies are what is checked. Claim kinds must be texts; a tool must have a name, a description and a schema that is an object of plain data, so a date, a map or a number that is not one is refused before the call. Six tests |
| V4 | Fixed: the value itself is looked through for U+0000, not the JSON's text. A test with a backslash that only looks like one |
| V5 | Not fixed; said. The note and the comment in `jobs.ts` now say the sum counts no wait for the conversation's row, give the worst case (261 seconds, over the 240 a job has) and what follows (the job is stopped and tried again). No tool exists yet; bounding the wait is #332 |
| V6 | A test now runs at the defaults: a statement that would run 3 seconds is stopped in under 1.5 |
