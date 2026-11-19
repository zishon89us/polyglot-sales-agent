# Gate 4 verification: U9 review fixes

A second agent, which had not seen the fixes made, was asked to check the
fixes to `2026-11-19-gate4-u9-ops.md` and try to break them. Its report
follows, as received, except that the line and paragraph separator
characters it quoted raw in Q2 are written here as `U+2028`. It checked
the branch `feat/270-operator-commands` at `38e6026`.

| ID | Sev | Location | Finding (with the reproduction I ran) | Fix |
| --- | --- | --- | --- | --- |
| Q1 | Low | `apps/ops/src/ops.test.ts` boundary tests (`NAMED`, identity test); ADR 0011 amendment "under any name" | One re-export still passes both test files (111 of 111 green): `export { createTenant as makeTenant } from "./operator.ts?v";` appended to `packages/db/src/index.ts`. `NAMED` wants a quote straight after `operator.ts`, and the query string loads a second copy of the module, so the identity comparison sees different functions. `node apps/api/src/x.ts` importing `makeTenant` from the main entry printed `function createTenant`. `tsc` does refuse it (TS2307, exit 1), so `make check` would still fail. | Make ``NAMED`` ``/operator(\.ts)?[?#"'`]/``, or also compare exports by function name. Otherwise say in the ADR that the type check is part of the guard. |
| Q2 | Low | `commands.ts` `UNPRINTABLE` and `shown()` | U+2028 and U+2029 are separators, not category C. `--name` with U+2028 between two letters passed `prepare` (it reached "PSA_DB_CROSS_URL is not set", exit 1, not 2). A name planted by SQL printed both raw in `tenant list`. Every category-C character I planted was written as a code: ESC, BEL, newline, U+009B, U+202E, U+200D, U+00AD, U+FEFF, U+E000, U+E0001, U+0378. U+3164 (invisible Hangul filler, a letter) is also accepted. | Use `/[\p{C}\p{Zl}\p{Zp}]/u` in both places. |
| Q3 | Low | ADR 0011 amendment ("No role has the privilege to update, delete or truncate"); `data-model.md` row ("No role has the privilege to change or remove a row") | Not literally true. `has_table_privilege('psa_migrate','operator_log',…)` returned true for UPDATE, DELETE and TRUNCATE; the owner holds them implicitly. Only the trigger stopped its `DELETE` ("operator_log is insert-only"). The migration comment, T39 and STATUS ("by a plain statement") are accurate. | "No role but the owner holds the privilege; the trigger refuses the owner's plain statements too." |
| Q4 | Low | `ops.test.ts` | Two of 22 mutants survived. (a) `main.ts` `RecordIncomplete ? 3 : 1` changed to `1 : 1`: the author declared this untested (#293). (b) `--limit` pattern changed to `/^[0-9]{1,4}$/`, so `01` is accepted: no consequence. | Add one `program()` test with a trigger that fails the `finished` row, expecting status 3. I ran exactly that by hand and it works. |
| Q5 | Low | `docs/reviews/2026-11-19-gate4-u9-ops.md`, author's response | It says the fixes "were then checked by a second agent; its report is `2026-11-19-gate4-u9-verification.md`". That file does not exist at `38e6026`. | Save this report under that name, or reword until it is. |

**Confirmed fixed:**

- **P1.** Plants E, F and a relay file in `packages/db/src` each failed two `ops.test.ts` tests ("names it" and "main entry gives out none").
  - G, and `@polyglot-sales-agent/ops` imported from `apps/worker`, failed "nothing outside apps/ops imports from apps/ops".
  - A wrapper function in a relay file failed the "names it" test only; a relay outside `src` failed the identity test only.
  - A new `./admin` entry in the db `package.json` used from the worker failed `app.test.ts` "no file outside packages/db goes round it" only.
- **P3.** As `psa_cross`, "permission denied" for every attempt to set `at` or `id`: plain INSERT, `DEFAULT` keywords, no column list, INSERT … SELECT, COPY with and without a column list, `ON CONFLICT DO UPDATE SET at`, MERGE and a writable CTE. `ALTER … SET DEFAULT`, UPDATE and CREATE TRIGGER were refused too.
  - The seven-column COPY and INSERT work. Afterwards every row was under a minute old and none had the chosen id.
  - A lone `finished` row under another name is still accepted, as the documents now state.
  - `ops` works with the column grant: `tenant list` and `log show` exit 0.
- **P5.** With no URL set, `Etc/GMT+5`, `Mars/Olympus` and `-05:00` exit 2 with the time-zone reason. Stored values: `asia/riyadh` as `Asia/Riyadh`, `UTC` and `utc` as `UTC`, `Europe/London` unchanged, `US/Pacific` as `America/Los_Angeles`, `Etc/GMT-5` unchanged.
- **P6.** Names with U+009B, U+202E, a newline, a zero-width joiner or ESC exit 2 with no URL set. Printed output had no category-C character (see Q2 for the two separators).
- **P9.** A wrong command with no `PSA_DB_CROSS_URL` exits 2 with "there is no such command". `--limit` 1 and 1000 exit 0; `0`, `1001`, `01`, `1e3`, `-1`, `9999`, `10000`, empty, `" 5"`, `1.0`, an Arabic-Indic digit, a doubled `--limit`, and `--limit` on `tenant list` all exit 2.
- **P8.** With a trigger failing every `finished` insert:
  - `tenant create` printed `tenant created: <id>`, then "the command was done, but its second row could not be recorded; do not run it again", and exited 3; the tenant was there.
  - `tenant list` printed its list and exited 3.
  - A failing `jobs retry` exited 1 with its own message.
  - Each of the three left a `started` row with no `finished` row.
- **Mutants.** 20 of 22 killed, including the three grant mutants (whole table, `at`, `id`), every time-zone, name, `shown` and incomplete-record mutant, the usage exit status, a connection check placed before parsing, and the P7 ones (`ORDER BY id`, an option value starting with `--`, `only()` removed from `log show`, `run_at`).
- **Documents.** The ADR amendment, data-model row and T39 say the owner can remove the guard, the cross role can forge a row but not its time or id, and the pattern is a net, not the rule. All of that matches what I measured, apart from Q3 and the "under any name" wording in Q1.

**Ran:** baseline of the two test files in a /tmp copy (111 passed, 15 s); 9 boundary plants plus full-file, `tsc` and runtime re-runs of the two that survived the first filtered pass; scratch database `rv_u9v` (bootstrap, up, `check` clean; note it was created with SQL_ASCII encoding); about 20 SQL statements as `psa_cross` plus privilege checks; 39 invocations of `apps/ops/src/main.ts`; 22 mutants against `ops.test.ts` and `isolation.test.ts`. Cleaned up: `rv_u9v` dropped, no `rv_` or `psa_test_` database left, /tmp files removed, no process left, `git status --short` empty, head `38e6026`.

**Could not check:** what #293 and #294 are (no GitHub); `make check` on the branch (not run); which test killed each mutant (my JSON parsing failed, so kills are by vitest exit status against a green baseline); how a real terminal renders U+2028; USAGE and the `isolation.test.ts` additions beyond running them.

## Author's response

No finding is High or Medium. The changes below were not checked by another
agent.

| ID | Response |
| --- | --- |
| Q1 | **Fixed both ways.** The pattern also takes a `?` or `#` after the module's name, with the verifier's case as a test; and the ADR says the type check is part of the guard |
| Q2 | **Fixed.** The line and paragraph separators are refused in a name and written as codes on output, with tests. U+3164 and other letters that show as nothing are still taken (#293) |
| Q3 | **Fixed.** Both documents say "no role but the table's owner" |
| Q4 | **Fixed.** A test runs the program with the second row made to fail and expects the result, the warning and status 3. `--limit 01` is refused, with a test |
| Q5 | **Fixed** by this file |
