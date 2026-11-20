# Gate 4 verification: U10 review fixes

A second agent, which had not seen the fixes made, was asked to check the
fixes to `2026-11-20-gate4-u10-end-to-end.md` and try to break them, the
High finding first. Its report follows, as received. It checked the branch
`feat/271-end-to-end-guard-boundary` at `5f2ee52`.

| ID | Sev | Location | Finding (with the reproduction I ran) | Fix |
|---|---|---|---|---|
| F1 | Medium | `packages/core/src/environment.ts` `plain()` | The E2 fix has a hole: one malformed `%` anywhere in the value makes `decodeURIComponent` throw, and the value is then compared undecoded. Ran the API with `PSA_ENV=production`, `PSA_WHATSAPP_BASE_URL=https://graph.facebook.com` and `PSA_DB_APP_URL=postgres://psa_app:local%2Donly-app@127.0.0.1:5432/rv_v1?application_name=a%` (same form for the cross URL): it printed `api: listening`, `/readyz` 200, connected with the published password. The same URLs without the stray `%` were refused. | Decode leniently (per `%XX` sequence, or parse URLs with `new URL` and test username/password/host separately); add this value as a test. |
| F2 | Medium | `apps/ops/src/commands.ts:30`, `ops.test.ts:418-439` | E4's test does not pin the fix. Mutant `CHANNELS = ["whatsapp", "mock"]` passed all 68 tests of `ops.test.ts`: the `mock` case uses tenant `x` and fails on the tenant first; the `sms` case checks the message with a contains match, which `whatsapp, mock` satisfies. | Add a case: valid tenant UUID + `--channel mock` refused; compare the message exactly. |
| F3 | Low | `tools/dev-setup.sh` resume logic; `tools/e2e.test.ts` | The resume logic (E9) has no test: mutants "take line 3 instead of 2" and "23505 → 99999" both passed `e2e.test.ts` (10/10). By hand it works: tenant present + number absent → connected to the first tenant, exit 0; second run → "connected already". Two oddities: (a) number connected to ANOTHER tenant (two tenants, `100000000000077` on the second) prints "is connected already", exit 0, without saying to which tenant; (b) with ops unable to reach the database it prints `dev-setup: made the demo tenant ` (empty id, nothing made), then `ops: --tenant is needed`, exit 1. | Test the resume path; fail when `tenant create` prints no id; optionally name the owning tenant. |
| F4 | Low | `packages/packs/booking/src/boundary.test.ts`; ADR 0012 amendment | Plants not caught (6/6 pass): a file NAMED `apps/api/src/bookings.ts` (paths are not compared); `"book" + "ings"`; `"no show"`, `blocked period`, `min.notice` (space and dot not removed); `apps/api/src/config.json` holding `bookings`; `tools/x.ts`; `CREATE TABLE reservations (… availability …)`; `import("@polyglot-sales-agent/" + "pack" + "-bkg")` and `"@polyglot-sales-agent/packs-bkg"`. The amendment states the test-file, Confirm/Cancel and "idea not name" limits, but not: file names, non-code files, spaces/dots, folders outside `apps`/`packages`. Mutant removing `/i` from the `.sql` match survived: the `.SQL` form is not "a case in the test" as the response says. | Compare paths too; strip all non-alphanumerics as the guard does; add the unstated limits to the amendment; add a `.SQL` case. |
| F5 | Low | `docs/retros/m2-walking-skeleton.md:33` | "891 tests": `pnpm exec vitest run` now gives 902 (22 files, 49 s). Review files: 28 on disk. The retro says "counted on the day", so stale rather than false; README has no count. | Update or date the number. |
| F6 | Low | `README.md:133-134`, `.env.example` header | "The secrets in the files are placeholders, each marked `local-only`" and "every placeholder below does": `postgres:postgres` in `PSA_DB_ADMIN_URL`/`PSA_TEST_ADMIN_URL`/compose is not marked. T40 and the compose header do say so. | "each but the database administrator's". |
| F7 | Low | `environment.ts`; `tools/e2e.ts` | Survivors of small weight: removing the `username` check or the `password` check alone (33/33 pass; no user-only or password-only case); `copies !== 1` → `< 1` and `sleep(1_000)` → `sleep(0)` in `e2e.ts` (E8's recount has no test). Guard false positive: `postgres://local:only@h/db` and `…/local?only=1` are refused as placeholders (mark joined across URL parts); harmless direction. | Add the cases if wanted. |

**Confirmed fixed:**

- E1: real processes on ports 39450/39451, scratch database `rv_v1` set up by `tools/dev-setup.sh`. `node tools/e2e.ts` passed 2× fresh, after 3 restarts of mock+api+worker (SIGKILL), 3 restarts of the mock alone, and one SIGTERM restart of api+worker: 9 of 9, 1262–1490 ms. Rows: 9 inbound, 9 outbound all `sent`; ids 34 and 32 characters, letters/digits/dot, inside the `[\x21-\x7e]{1,128}` check; nothing orders by the id. Mutants "run constant", "inbound without run", "outbound without run", "time only" and "random only" all killed (the first three by the restart test in `e2e.test.ts`, also by `server.test.ts`). Same-millisecond starts differ by 4 random bytes.
- E2 (apart from F1): refused `LOCAL_ONLY`, `local%2Donly`, `l%6Fcal-only`, `local only`, zero-width and newline splits; pass as documented: `Local-0nly`, Cyrillic `о`, `postgres`. Mutants no-decode, no-lowercase, hyphen-only all killed. T40 and the compose header say only what is true.
- E7: guard refuses `:8443`, trailing dot, userinfo, Cyrillic host, `%2e` suffix host, `http`. Passing the guard but refused by the channel at start (ran each in production): `blob:https://graph.facebook.com/x`, `…\@evil.example`, full-width host, `:0443`, `?x=1`. Hostname-instead-of-origin mutant killed.
- E3: script exits 1 with the one message for `production`, empty, unset, `Development`, `DEVELOPMENT`, ` development`; guard mutant killed. `ops tenant list` line 2 always starts with the UUID; names starting `--` or holding a newline are refused by `tenant create` (exit 2), so the first-field read is safe.
- E5: all nine of the first review's missed word forms now fail the test, as does `.SQL`; Confirm/Cancel and test-file names pass, as the amendment says. A new `apps/newapp` IS scanned unlisted (word test failed) and also fails the pinned-list test and, having no `package.json`, the dependency test. No reference to `packages/pack-booking` outside `docs/reviews`.
- E6: mutant printing the address for 0.0.0.0 killed; setting documented in `.env.example`. E8: `refused()` has a 10 s kill; no leftover process seen.
- `tools/e2e.test.ts` 5 of 5 (11.0–11.5 s each), no leftover process or `psa_test_…` database.

**Ran:** everything in a copy at `/tmp/rv2/repo` (pwd checked before writes). 9 round trips with real processes; 24 URL and 22 secret values through `productionProblems`; 11 production starts of the API; set-up script 13 times against `rv_v1`/`rv_v2`; 23 boundary plants; 24 mutants (16 killed, 8 survived: F2, F3 ×2, F4, F7 ×4); full suite once (902 pass). Cleaned up: three processes stopped, `rv_v1` and `rv_v2` dropped, `/tmp/rv2` removed, `psa` untouched, role passwords unchanged (`bootstrap` ran with the `local-only-…` values); `git status --short` empty at `5f2ee52`.

**Could not check:** anything in Docker (compose second `up`, image, CI job); GitHub facts (#295 exists, pull-request and issue counts); the worker in production (it never starts there, by design); the `refused()` timeout by mutation; README/retro statements other than those listed.

## Author's response

No finding is High. The changes below were not checked by another agent.

| ID | Response |
|---|---|
| F1 | **Fixed.** Each `%XX` is decoded on its own, so a stray percent sign changes nothing else; the verifier's value and one more are tests |
| F2 | **Fixed.** A case with a valid tenant and `--channel mock`, and a test that the list of channels is exactly `whatsapp` |
| F3 | **Fixed in part.** The script stops with a message if no tenant could be made, and says "to this tenant or another" when the number is taken. The resume logic still has no test: it was run by hand, by the author and by the verifier (#295) |
| F4 | **Fixed in part; the rest stated.** Everything but letters and digits is removed before comparing, so a space or a dot no longer hides a word; a file's name is compared like a line; a test pins the extension match to any case. Not caught, and now said in the amendment: non-code files, folders outside `apps` and `packages`, a name built at run time, another word for the same thing |
| F5 | **Fixed.** The retro says the count is of the day the unit was first pushed |
| F6 | **Fixed.** Both say "each but the database administrator's" |
| F7 | **Fixed in part.** Cases for a user alone and a password alone are added. The recount in the end-to-end script has no test, and the guard's false refusal of a URL whose parts join into the mark is left: it errs on the safe side (#295) |
