# Check of the fixes: Gate 4 review of M3 U6

Checked: commit `d3349da` on `feat/305-m3-u6-traces`, by an agent that
wrote neither the code nor the review, in a copy of the repository with
no network. Its brief was narrow: whether the fixes do what the author's
response says. The report is unedited. The author's response follows.

---

**What I ran.** In `/tmp/verify-u6` only, at `d3349da`. `pnpm -s exec vitest run`: 43 files, 1500 tests, all pass; `tsc --noEmit -p .` clean. A temporary probe test put about 55 inputs through `bounded` and the worker's recorder into a real table. Six temporary writer files went under `apps/api/src`. I ran 15 mutants, each restored. `tools/e2e.test.ts` passes unmodified (10 of 10), and I ran it twice more with a temporary edit that signals the api differently. All temporary files are deleted, `git status` is clean, nothing committed. **Not checked:** G11, the left mutants (M13, M15, M23, M29), ADR 0005, and the test files beyond mutants.

| Row | Verdict | How I know |
|---|---|---|
| G1 | Holds in part | Plain dates: 0 and year-9999 end stored, −1 and max+1 refused before the call, for place and clock; 4 edge mutants killed. Getting past it: V1 |
| G2 | Holds in part | Copy and check mutants killed; inherited, `__proto__` and Proxy lists behave. Getting past it: V3 |
| G3 | Holds as worded ("in part") | The listed spellings are caught and the imported packages are scanned. Six new spellings all pass: V4 |
| G4 | Holds in part | Reasons mutant killed. The job-type filter is in the code, but its mutant survived: V5 |
| G5 | Holds | `{1,16}` mutant killed; 6, 7 and 15 digit cases present |
| G6 | Holds in part | Three mutants killed; getters giving `[]`, 9 prompts, a bad name or version are refused before the call. Getting past it: V2 |
| G7 | Holds | Second read throwing, a string, a BigInt `getTime`, a rejected promise: row stored, latency 0, result given; mutant killed |
| G8 | Holds | T8 wording matches the code (read only) |
| G9 | Holds, with a regression | Real api on SIGINT: `listening` with `n.port`, `stopped`, exit 0. See V6 |
| G10 | Holds | Mutant killed by the "sorts last" case |
| G11, left mutants | Not verified | Nothing changed |

**New findings**

**V1 (Low): the clock's date is stored uncopied, and a place's time is read twice.** Each of these gave an adapter call, then `TraceNotStored`, with no row:
- clock returns one shared `Date` that is `setTime(-8.64e15)` during the call (22008);
- clock returns a `Date` subclass whose `getTime` is in range but whose real time is year −4800 (22008);
- clock returns `Object.create(Date.prototype)` with its own `getTime` ("this is not a Date object");
- place's `turnStartedAt` is a subclass whose `getTime` is valid once, then out of range (22008).

Fix: in `storable`, read `getTime()` once and return `new Date(ms)`; use that copy for both `startedAt` and the place.

**V2 (Low): the re-check has no `typeof`.** A prompt whose `name` getter gives `"reply"` first and `{ toString: () => "reply" }` second passed. The adapter was called, then `TraceNotStored` (23514), no row. Fix: `typeof name === "string"` in the re-check, and the same for tool names.

**V3 (Low): a price is read three times in `pricesOf`.** An `input` getter giving 3,000,000 twice and then 1.5: the client was made and the call stored with a null cost. Giving 3,000,000 then 1 stored cost 7501 at price 1. Giving `"x"` on the second read threw `SyntaxError` from `bounded`. Fix: read `input` and `output` once into locals, check and store those.

**V4 (Low): `log-shape` still passes with free writers.** All six uncaught (4 of 4 pass): `process?.stdout.write`, `writeFileSync(1, …)` from `node:fs`, `process.emitWarning(x)`, `const p = process; p.stderr.write`, `Reflect.get(process, "stdout")`, and `console.log` between two strings `"/*"` and `"*/"`. The last is a hole the new comment stripping opened. Fix: refuse bare `process` outside `main.ts` and `writeFileSync`; test the unstripped text too.

**V5 (Low): the job-type filter has no test.** Replacing the `Object.hasOwn` line in `apps/worker/src/main.ts` with `job.type` passed all worker tests and `log-shape`. The `unknown-job` word is in neither the note nor a list. Fix: move the choice into a tested function and name the word in section 5.

**V6 (Low): two signals make the api stop twice.** SIGTERM then SIGINT gave two `stopped` lines (info, then error with code `Error`) and exit 1; the note's L1 says "once". The e2e test does not check the api's `stopped`, its port or SIGINT. Fix: guard `stop` with a flag and assert the line in e2e.

**V7 (Note): wording that claims more than is true.**
- T7's "the client's clock gives no such time: no call is made" and the response's "anything else is refused before the adapter is called" overstate, by V1.
- "a client is not made with a price that is not one" overstates, by V3.
- `STATUS.md` says three Medium findings "are fixed"; the response itself calls G3 "fixed in part".
- `STATUS.md` says "a third agent" and the review says "a second agent".
- The architecture sentence ("ordinary ways… not a proof") is fair.

---

## Author's response

**These fixes are checked by the author only.** No agent has read them.

| Finding | Answer |
|---|---|
| V1 | Fixed. A time is read once, by the built-in reading and not the object's own, and a plain copy of that reading is what is checked, kept and stored, for the place and for the clock. Tests: a date changed during the call, an object that only says it is a date, and one that says a time it does not have |
| V2 | Fixed: the second check asks that each name is text. A test with a name that is text once and an object the next time |
| V3 | Fixed: each price's two numbers are read once into a copy, and the copy is what is checked and kept. A test with a price that reads differently each time, for the three cases the verifier used |
| V4 | Fixed for the six, and the hole the comment stripping opened is closed: the console is also looked for in the text as it is, and outside the two main files the process is not named in code at all. It is still a check of names; its heading comment now says that two reviews each found ways round an earlier form of it |
| V5 | Fixed: the choice is a function, `jobName`, with a test; the word is in the note |
| V6 | Fixed: a second signal does nothing. The end-to-end test sends the api both signals and asks for one `stopped` line, exit 0 and the port on `listening` |
| V7 | STATUS now says two Medium findings are fixed and what became of the other two. With V1 and V3 fixed, the two sentences about "before the call" and "not made with a price" are true of the inputs the verifier found; that they are true of every input is not shown. "A third agent" in STATUS counts the design reviewer as the second |
