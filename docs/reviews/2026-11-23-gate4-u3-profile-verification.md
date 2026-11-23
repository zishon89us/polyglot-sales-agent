# Verification of the fixes to the gate 4 review of M3 unit U3, the business profile (fix commit `c4e77f6`, reviewed commit `adf9490`)

Worked only in `/tmp/u3verify`. The working copy is clean again (`git status --short` prints nothing), my temporary test file is deleted and no `psa_test_*` database is left on the server.

## Verdict

**The fixes are real.** Eleven of the fifteen findings are fixed outright, three are fixed in part exactly as the author's table says (G8, G12, plus G7 answered by removing the claim), and one is fixed less completely than the table says (G9). I found no High or Medium defect introduced by the fixes. I found seven smaller things (V1 to V7), the most practical being that a hand-made development database on a server like this one is now refused by migration 0007 and no document says how to make one that is not.

## What I ran

| Command | Result |
| --- | --- |
| `pg_isready -h 127.0.0.1 -p 5432` | accepting connections |
| `make check` (once, before any mutant or probe) | **exit 0**; vitest 26 files, **1034 tests passed**; the log ends with commitlint and `git identity: ok` |
| The four named test files, baseline | 4 files, 192 tests passed, 12.6 s |
| `node /tmp/u3v_probe/p1.ts` importing `packages/core/src/profile.ts` | about 130 loader, currency, `nameKey` and `contactLike` inputs; results in the tables below |
| A temporary vitest file (`packages/db/test/zz_verify.test.ts`, deleted) on scratch databases the harness made and dropped | cross-tenant role statements, grants and ACLs, non-ASCII names, hostile stored values, every currency round trip, the down migration's ACLs, 40 rounds of four concurrent loads |
| `psql` read-only: `SHOW server_encoding`, `pg_database`, `\dt` and `schema_migrations` of `psa` | server and every database `SQL_ASCII`, collation `C`; the existing `psa` database has migrations 1 to 5 applied |
| 43 mutants, one change each, file restored with `git checkout` after each | 38 killed, 3 survived, 1 mis-targeted, 1 survived only because of which files were run (see table) |

Node is v22.23.4. The scratch databases were UTF8 with collation `C`.

## Findings G1 to G15

| # | Verdict | Evidence |
| --- | --- | --- |
| G1 | **Fixed** | For both `support_contact` and `notification_email`: `a\u001b[2J@b.c`, the right-to-left override, `a\u0000@b.c`, `<script>@x.y`, a trailing line break and a zero-width joiner are each refused by the loader, so the null never reaches PostgreSQL. 254 characters accepted, 255 refused. Reverting the pattern (M6) and dropping the length (M33) are both killed. |
| G2 | **Fixed** | `currencyDecimals`: PKR 2, IQD 3; IRR, AFN, CLF, XXQ undefined and refused in a file with the list. `priceText(15000, PKR)` is `150.00 PKR`. A stored `IRR` makes `loadBusinessProfile` throw `profile-unreadable`. PKR→0 and LBP→0 mutants killed; the test compares the whole table. |
| G3 | **Fixed** | On a UTF8 database: a 200-letter Arabic name and a 4,000-letter body are stored. `Élan` then `élan` gives `changed 1`, same identifier, for the service and the policy; a decomposed `E◌́LAN` also matches. `ΟΔΟΣ`/`οδοσ` and `İstanbul`/`istanbul` are four distinct rows and a second load reports no change. LATIN1 is refused (M26 killed). Reverting either match to `lower()` is killed (M25, M42). |
| G4 | **Fixed** | Body not written (M18), service `updated_at` (M19), email kept (M20), description change not detected (M21), policy `updated_at` (M22): all killed by "a later load with other values…". |
| G5 | **Fixed** | As `psa_cross`: `SELECT currency FROM tenants`, each other setting, `SELECT *`, `SELECT t FROM tenants t`, `row_to_json(t)`, `WHERE currency IS NOT NULL`, `ORDER BY currency`, `COPY tenants TO STDOUT`, and `INSERT` with `currency` or `notification_email` all fail with 42501. The six first columns read, `count(*)` works, a tenant is made. Adding a column to either grant is killed (M27, M28). |
| G6 | **Fixed** | `"\ud800"` in a name, a description or a body is refused; a proper pair is accepted; a lone surrogate as a key is refused as an unknown key. Dropping `\p{Cs}` is killed (M3). |
| G7 | **Answered, not fixed (as stated)** | `1e3`, `150.0` and `-0` are still accepted. The problem text no longer says "without a point or an exponent" and "As built" says the written form is not checked. |
| G8 | **Partly (as stated)** | Now found: Arabic-Indic and Persian digits, `wa.me/15550100`, `example.com/pay`, `bit.ly/abc`, `t.me/x`, `ftp://…`; trailing comma dropped; two adjacent numbers listed apart. Still not found: a domain in Arabic script (`مثال.كوم`). False positives: `ends.Next`, and `2026-11-23 10` from a date and time. |
| G9 | **Partly; the table says Fixed** | Stops the read: `[null, 5]`, `opens: "<b>"`, weekday as text, `24:00` as an opening, price 9007199254740993, currency `IRR`. Still read without complaint: weekday 99 (the period is dropped, so all seven days read as closed), and `closes` earlier than `opens`. See V3. The claim that hours need no `shown()` holds: after the check `opens` and `closes` can only be clock times. |
| G10 | **Fixed** | A line separator, paragraph separator, byte-order mark, tab or line break in a name is refused. Names of only a zero-width space, a joiner, an emoji, `---` or a lone Devanagari vowel sign are refused. A tag character, soft hyphen or word joiner beside a letter is still accepted, as the table says. M4 and M5 killed. |
| G11 | **Fixed** | `services` or `policies` null, absent or an object: refused. `active: null`, `description: null`, `opening_hours: null`, `business_hours: null`, `settings: null`: refused. M7, M8, M9 killed. |
| G12 | **Partly (as stated)** | 400,000 brackets and 5,000 nested objects are refused as "the file is nested too deeply" (M15 killed). "a key is given twice in one object" still names no place. |
| G13 | **Fixed** | Phone minimum (M32), contact length (M33), file cap (M34), hash of nothing (M35), `--tenant` check in `load` (M43) and `show` (M44), digit threshold (M39), database checks (M29, M30): all killed. The "30 policies" title now matches. |
| G14 | **Fixed** | STATUS says "four High and a Medium". A test runs 0007 down and up with rows. `--file -` is tested through the real program. "As built" says size counts active services and that the two records join by hash only. |
| G15 | **Not changed (as stated)** | Not re-examined beyond reading the table. |

## Your questions (a) to (g)

- **(a) Currency table.** All 25 figures match ISO 4217 minor units **as I remember them; I looked nothing up.** Prototype keys are safe: `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf` all return undefined and are refused in a file; removing `Object.hasOwn` is killed (M2). The object is not frozen (`Object.isFrozen` is false), which only matters if code mutates it.
- **(b) Column grants.** Nothing in `packages/db/src` or `apps/*` breaks: the only cross-tenant statements on `tenants` are `createTenant` (four columns, `RETURNING id`) and `listTenants` (six named columns), both executed through the product functions, plus `connectChannel`. `RETURNING *` and `RETURNING currency` are refused, and nothing uses them. The down migration is an exact reverse: `relacl`, every column's `attacl`, the schema fingerprint and the effective column privileges are identical before 0007 and after up then down. `psa_app` keeps table-level SELECT and gains UPDATE on the six settings only.
- **(c) Keys.** `replaceProfile` is the only writer in `packages/db/src` and `apps/*`, and every insert, match and delete uses `nameKey`. The database cannot check that a key belongs to its name: as `psa_app` I inserted `name 'Haircut', name_key 'SOMETHING ELSE'` and a second `Haircut` with key `k2` (V5). The test harness's `seedTenant` writes `lower($2)`, not `nameKey`. Ordering is by `name_key` then `id`; it was `lower(name)` before, so it depends on the database's collation no more than it did.
- **(d) UTF8 guard.** `docker-compose.yml` and CI use `postgres:16`, whose default is UTF8 (not run here). The harness now says the encoding. The one case refused is a database made by hand on a server whose default is not UTF8: see V1.
- **(e) Email and name rules.** Both fixtures load: en 1,515 code points, ar 1,271, 12 services and 5 policies each. Arabic, Urdu with a zero-width non-joiner, and Hindi names are accepted; a name of one Arabic-Indic digit is accepted. Refused and arguably reasonable: an address with an Arabic local part or an Arabic domain (documented; the punycode form is accepted), and a phone number typed in Arabic-Indic digits (V4). The address pattern is loose in the other direction: `a..b@-x-.c` is accepted.
- **(f) Row lock removed.** Ordering holds. The transaction is read committed and its first statement is the `UPDATE tenants`. 40 rounds of four concurrent loads of two different files: every result was wholly one file, no errors. 20 rounds of three concurrent loads of the same file onto an empty tenant: no unique-key errors.
- **(g) Unreadable profile.** Not through the loader: every one of the 25 currencies, a price of 2^53 − 1, 100 services with long emoji names, `00:00`–`24:00` and `23:59`–`24:00` all round-trip. `replaceProfile` itself does not validate, so a future caller that skips `readProfileFile` could store a three-letter code outside the list and make the tenant unreadable (V6).

## Mutants

All ran against the four named files unless noted.

| # | File | Change | Result |
| --- | --- | --- | --- |
| M1 | core | PKR 2 → 0 | Killed |
| M2 | core | `currencyDecimals` without `Object.hasOwn` | Killed |
| M3 | core | `\p{Cs}` removed from the refused characters | Killed |
| M4 | core | Name's character test run after spaces are folded | Killed |
| M5 | core | "has a letter or a digit" check off | Killed |
| M6 | core | Email pattern reverted to the old one | Killed |
| M7 | core | Absent `services` treated as `[]` | Killed |
| M8 | core | Absent `policies` treated as `[]` | Killed |
| M9 | core | `active: null` means true | Killed |
| M10 | core | Unknown stored currency does not throw | Killed |
| M11 | core | Unsafe stored price does not throw | Killed |
| M12 | core | Stored hours: weekday not checked to be a whole number | Killed |
| M13 | core | `contactLike` counts ASCII digits only | Killed |
| M14 | core | Trailing punctuation kept on a link | Killed |
| M15 | core | Deep nesting rethrown instead of reported | Killed |
| M16 | db | Services not ordered by key | Killed |
| M17 | db | Policies not ordered by key | **Survived** (V7) |
| M18 | db | Policy body not written on update | Killed |
| M19 | db | Service `updated_at` not advanced | Killed |
| M20 | db | Notification email kept on a later load | Killed |
| M21 | db | Description change not detected | Killed |
| M22 | db | Policy `updated_at` not advanced | Killed |
| M23 | db | Insert key is `name.toLowerCase()` | **Survived** (equivalent: the name is already normalised) |
| M24 | db | Delete keys are `name.toLowerCase()` | **Survived** (equivalent, same reason) |
| M25 | db | Service matched by `lower(name)` | Killed |
| M26 | 0007 up | UTF8 guard off | Killed |
| M27 | 0007 up | `psa_cross` SELECT includes `currency` | Killed |
| M28 | 0007 up | `psa_cross` INSERT includes `notification_email` | Killed |
| M29 | 0007 up | `services_name` index not unique | Killed |
| M30 | 0007 up | `name_key <> ''` check removed | Killed |
| M31 | 0007 up | `psa_cross` SELECT without `created_at` | Killed (7 failures, `tenant list` among them) |
| M32 | core | Phone minimum 8 → 7 | Killed |
| M33 | core | Email length limit removed | Killed |
| M34 | core | File cap `>` → `>=` | Killed |
| M35 | ops | SHA-256 of nothing | Killed |
| M36 | 0007 down | Table-level grant not restored; run with `migrate.test.ts` added | Killed |
| M37 | 0007 down | Same change, four named files only | Survived (the test that sees it is `migrate.test.ts`, outside the four) |
| M38 | core | LBP 2 → 0 | Killed |
| M39 | core | `contactLike` threshold 7 → 6 | Killed |
| M40 | ops | (mis-targeted: my pattern changed `channel connect`'s check, not `profile load`'s) | Not counted |
| M41 | core | Stored hours: `closes` not checked | Killed |
| M42 | db | Policy matched by `lower(title)` | Killed |
| M43 | ops | `profile load`: `--tenant` not checked | Killed |
| M44 | ops | `profile show`: `--tenant` not checked | Killed |

## New findings

### V1. Low: a hand-made development database on a non-UTF8 server is now refused, and nothing says how to make one
`packages/db/migrations/0007_profile.up.sql:12-18`; `Makefile:23-33`; `.env.example:16`

The Makefile says "any server works", and `db-setup` runs `db up` against whatever `PSA_DB_ADMIN_URL` names. No file in the repo creates that database outside Docker, and none mentions the encoding. On this server the `psa` database exists, is `SQL_ASCII`, and has migrations 1 to 5 applied: `db up` would apply 0006 and stop at 0007. I did not run it, since it would alter a shared database; the refusal itself is shown by the LATIN1 test.

Fix: one line beside `db-setup` and in `.env.example` giving `CREATE DATABASE psa ENCODING 'UTF8' TEMPLATE template0`, and say that an existing database of another encoding must be remade.

### V2. Low: the glossary still says "Any ISO 4217 code"
`docs/requirements/glossary.md:97`

Decisions row 43 names the contradiction, but the glossary is unchanged and carries no pointer to the row. A reader of the glossary alone is told IRR or AFN is valid; the loader refuses both.

Fix: amend the glossary line to point at row 43 until the maintainer answers.

### V3. Low: stored hours with a weekday outside 1 to 7, or closing before opening, are still read
`packages/core/src/profile.ts:604-619, 647-651`

Stored `[{"weekday":99,"opens":"09:00","closes":"10:00"}]` reads as seven closed days; `closes: "08:00"` after `opens: "09:00"` is handed to the model as is. "As built" says hours of another shape stop the read, and the code's own comment says a turn fails rather than tell a customer an hour that was misread. Only the loader writes today, so this needs a write by other means.

Fix: require `weekday` from 1 to 7 and `closes` later than `opens` in the same check; add both to the test at `packages/db/test/profile.test.ts:619`.

### V4. Low: a phone number typed in Arabic-Indic digits is refused with a message that does not say why
`packages/core/src/profile.ts:165, 385`

`+٩٦٦٥٥٥٠١٠` is refused as "a plus and 8 to 15 digits", which it is, to its writer. `contactLike` now accepts any script's digits, so the two disagree.

Fix: say "digits 0 to 9" in the problem, or fold `\p{Nd}` to ASCII before the test.

### V5. Note: the database cannot tell a key from one `nameKey` did not make
`packages/db/migrations/0007_profile.up.sql:29, 49`; `packages/db/test/harness.ts:220-226`

As `psa_app` in the tenant's scope, two services named `Haircut` with keys `SOMETHING ELSE` and `k2` are both stored. The harness's own seed uses `lower($2)`. `nameKey` also depends on the Unicode tables of the Node it runs on, so an upgrade that changes a case mapping would turn a stored item into "removed and added" on the next load. Worth a sentence in "As built" before M5's screen writes these tables.

### V6. Note: `answering` can say a tenant is ready when every read of its profile fails
`packages/db/src/profile.ts:57-74, 92-97`

With a stored `IRR`, `answering` returns nothing missing and a connected channel, while `loadBusinessProfile` throws. Reachable only by a write that skips `readProfileFile`, or by a later release that removes a code from the list. Either have `replaceProfile` refuse a currency outside the list, or note that removing a code needs a migration of the tenants that hold it.

### V7. Note: smaller things
- No test fails when policies are returned unordered (M17). The service order is tested; add a second policy to the M1 to M8 test.
- The author's response says the fixes "were then checked by another agent: `2026-11-23-gate4-u3-profile-verification.md`". That file is not in the commit; the sentence is ahead of the fact until this report is saved under that name.
- `contactLike` lists `2026-11-23 10` from a date and time.
- The email pattern accepts `a..b@-x-.c`.
- The harness's `CREATE DATABASE … ENCODING 'UTF8' TEMPLATE template0` gives no locale, so it would fail on a server whose default locale cannot hold UTF8. Not seen here.

## Docs

- **25 currencies:** the table, row 43's list and the refusal message each hold 25 codes.
- **"15 findings, none High, five Medium":** G1 to G5 Medium, G6 to G14 Low, G15 Note. Computes.
- **"14 of 51 mutants alive":** the review ran 53, 2 void, 37 killed, 14 survived. Computes.
- **Fixture sizes:** 1,515 and 1,271, twelve services and five policies each; 40,000 / 1,515 = 26.4.
- **Not true of the code:** "hours of another shape … stops the read" is true only in part (V3); the glossary line (V2); the reference to a verification file that does not exist yet (V7). Everything else I compared in "As built", the ADR 0011 amendment, `data-model.md`, rows 41 to 43, STATUS and the traceability row matches what I executed.

## What I did NOT check

- ISO 4217 against the standard or any provider's table: the currency figures are from memory.
- A UTF8 database with a locale other than `C` (what CI and Docker use): name ordering and the migration there are untested by me.
- `docker compose`, the CI workflow run, `tools/e2e.ts` on its own (only as part of `make check`), anything on GitHub.
- `db up` against the existing `psa` database (V1 is from reading plus the LATIN1 test).
- Exit codes of the real `ops` program for my probe inputs; I called `readProfileFile` directly and relied on `ops.test.ts` for the program.
- A file of exactly 1,000,000 bytes by hand (my probe was malformed); the M34 mutant covers the edge.
- G15's items, ADR 0006, the threat model, the guardrail policy and `openapi.yaml`.
- Mutants of the test files, the harness and the docs; the L9 test after the lock's removal beyond the concurrent-load probe.

---

## Author's response

In the same pull request (#323). These last fixes were checked by the
author only: `make check` and the two mutants named below.

| Finding | Answer |
| --- | --- |
| G9, V3 stored hours with a weekday outside 1 to 7, or closing no later than opening, were read | Fixed: both stop the read, with five more stored shapes in the test. The response to G9 above this report said "Fixed" and was wrong by this much |
| V1 a hand-made database of another encoding is refused, and nothing said so | Fixed in words: the Makefile, above `db-setup`, and `.env.example` say the database must be UTF-8 and how to make one. The development database on the author's own machine is of the other kind and will have to be remade; nothing was run against it |
| V2 the glossary still said any ISO 4217 code | Fixed: the line now says what is built and points at row 43 |
| V4 a phone number in another script's digits | The problem now says "the digits 0 to 9", with a test. The digits are not folded: what is stored is what a customer is shown |
| V5 the database cannot tell a key `nameKey` did not make | Written into the note's "As built", for M5. The harness's seed uses `lower()` on names that are ASCII. Left in #324 |
| V6 `answering` can say ready when the profile cannot be read | Written into "As built": a currency is not taken out of the list without a migration. `replaceProfile` still trusts its caller. Left in #324 |
| V7 policies' order untested | Fixed: a test of eight policies and eight services stored out of order. With the `ORDER BY` of the policies removed it fails; of the services, it fails |
| V7 the response named this file before it existed | True when written; the file is this one |
| V7 `contactLike` lists a date and time; the address pattern takes `a..b@-x-.c`; the harness gives no locale | Not changed. Left in #324 |
