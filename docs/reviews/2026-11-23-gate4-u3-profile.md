# Gate 4 review: M3 unit U3, the business profile (commit `adf9490`, branch `feat/302-m3-u3-profile`)

Reviewed in `/tmp/u3review`. The working copy is clean again after the mutants and probes (`git status --short` prints nothing).

## Verdict

**Merge after changes.** The tests pass and `make check` exits 0, and isolation, grants and the model's view are sound. Five things should be fixed or decided first:

- **G1:** the support contact and notification email skip the character rule, so an escape, a direction override or a null gets through the loader.
- **G2:** currency decimals come from `Intl`, which gives 0 for PKR, IQD, IRR and others on this Node, and can change with a Node upgrade.
- **G3:** name matching and length checks depend on the database's encoding and collation, which nothing fixes or asserts.
- **G4:** five `replaceProfile` mutants survive, including "a policy's body is not written on update".
- **G5:** the migration says the cross-tenant role cannot read a tenant's settings; it can.

## What I ran

| Command | Result |
| --- | --- |
| `pg_isready -h 127.0.0.1 -p 5432` | accepting connections |
| `pnpm vitest run packages/core/src/profile.test.ts packages/db/test/profile.test.ts apps/ops/src/ops.test.ts` | 3 files, 130 tests passed, 8.2 s; same result after all mutants were restored |
| `make check` (once, before any mutant) | **exit 0**; vitest 26 files, 1025 tests passed; lint, typecheck, docs, selftest, commitlint and git identity ok |
| Fixture measurement with `readProfileFile` | en: 1,515, 12 services, 5 policies; ar: 1,271, 12 services, 5 policies. Matches the note, ADR 0006 and row 41; 40,000 / 1,515 = 26.4 |
| `node` scripts in `/tmp` importing `packages/core/src/profile.ts` | about 45 hostile and edge inputs; results cited in the findings |
| A temporary vitest file using the repo's harness, on a scratch database it created and dropped; file deleted afterwards | database probes cited in the findings |
| `psql -c "SHOW server_encoding"` and a `pg_database` listing (read-only) | this server is `SQL_ASCII`, collation `C`, PostgreSQL 16.15 |
| `node apps/ops/src/main.ts profile load … --file -` with an empty environment | standard input works; the exit statuses I captured are 2 for a deeply nested file and 1 for a valid file with `PSA_DB_CROSS_URL` unset (my other runs piped through `head`, so their statuses were not captured) |
| 53 mutants, one change each, restored after each | 37 killed, 14 survived, 2 void (my change did nothing) |

Core and ops mutants ran against the three files above. Migration mutants also ran `isolation.test.ts`, `policy-check.test.ts` and `migrate.test.ts` (266 tests).

## Mutants

| # | Change | Result | Killed by |
| --- | --- | --- | --- |
| C1 | Isolates U+2066 to U+2069 no longer refused | Killed | core: "a control character or one that overrides…" |
| C2 | U+2028/2029 no longer refused | Killed | same |
| C3 | Phone minimum 8 digits → 7 | **Survived** | |
| C4 | Phone maximum 15 digits → 16 | **Survived** | |
| C5 | Touching periods count as overlapping | Killed | core: "periods of one weekday do not overlap…" |
| C6 | At most four periods: `>` → `>=` | Killed | same |
| C7 | Size counts inactive services | Killed | core: "is read into…", "a service that is not active does not count" |
| C8 | Budget `>` → `>=` | Killed | core: "a profile at the budget…" |
| C9 | `closes` may equal `opens` | Killed | core: "a period closes later than it opens" |
| C10 | Email maximum 254 made exclusive | Killed | core: "a notification email…" |
| C11 | CRLF not folded to LF | Killed | core: "text in Urdu, Hindi and Bengali…" |
| C12 | `nameKey` not lower-cased | Killed | core: "two names that differ only in case…" |
| C13 | `normaliseName` without NFC | Killed | same |
| C14 | Price `isSafeInteger` → `isInteger` | Killed | core: "a price is a whole number…" |
| C15 | `contactLike` digit threshold 7 → 6 | **Survived** | |
| C16 | Duplicate-key check disabled | Killed | core: "a key given twice…" |
| C17 | Byte-order-mark check removed | Killed | core: "UTF-8, with no byte-order mark" |
| C18 | `24:00` accepted as an opening time | **Survived** (equivalent for accept/refuse: no close is later, so it is still refused, with another message) | |
| C19 | Character rule skipped for descriptions and bodies | Killed | core: "a control character…" |
| C20 | `notification_email` not required | Killed | core: "each of the four…" |
| C21 | File cap `>` → `>=` | **Survived** (no test at exactly 1,000,000 bytes) | |
| C22 | Service cap off by one | Killed | core: "at most 100 services and 30 policies" |
| C23 | Support contact as an email has no length limit | **Survived** | |
| C24 | Weekday 0 allowed | Killed | core: "a weekday is a whole number…" |
| C25 | (void: my change was a no-op) | — | |
| D1 | Inactive services given to the model | Killed | db: M1 to M8, L10, "its own profile" |
| D2 | Tenant row not locked (`FOR NO KEY UPDATE` removed) | **Survived** (the next statement updates the same row, so L9 still waits) | |
| D3 | Service always updated (no `IS DISTINCT FROM`) | Killed | db: L1 in place, L3 |
| D4 | `opening_hours_updated_at` always set | Killed | db: L3 |
| D5 | Omitted policies not deleted | Killed | db: L2, fixtures |
| D6 | Audit row drops the caller's details | Killed | db: L11; ops: load |
| D7 | Service `updated_at` not advanced on a change | **Survived** | |
| D8 | Policy `updated_at` not advanced on a change | **Survived** | |
| D9 | `answering`: no tenant filter on `channel_accounts` | **Survived** (row-level security hides the other tenant's row) | |
| D10 | Services not ordered in the profile query | Killed | db: M1 to M8, L10 |
| D11 | A changed description is not detected | **Survived** | |
| D12 | A policy's body is not written on update | **Survived** | |
| D13 | Notification email kept, not replaced, on a later load | **Survived** | |
| D14 | Opening hours never cleared | Killed | db: L3 |
| O1 | `show`: support contact printed raw | Killed | ops: show (exact lines) |
| O2 | `show`: service name and description raw | Killed | same |
| O3 | `show`: contact-like items raw | Killed | same |
| O4 | `load`: SHA-256 of nothing, not of the file | **Survived** (test checks only 64 hex digits) | |
| O5 | `load`: `--tenant` not checked as a UUID | **Survived** | |
| O6 | `show`: policy title raw | Killed | ops: show |
| O7 | Audit row without the operator's name | Killed | ops: load |
| O8 | (void: my change was a no-op) | — | |
| G1 | `services`: row-level security not forced | Killed | policy-check, isolation (56 failures) |
| G2 | Cross-tenant role granted SELECT on `services` | Killed | isolation privileges; db: cross-tenant role |
| G3 | Description limit 2000 → 2001 in the database | **Survived** | |
| G4 | No currency check in the database | **Survived** | |
| G5 | `policies` unique index without `lower()` | Killed | db: "the database itself refuses a name twice" |
| G6 | Application role may update `tenants.name` | Killed | isolation, migrate, db: application role |
| G7 | Price may be negative in the database | **Survived** | |
| G8 | `policies` policy `WITH CHECK (true)` | Killed | policy-check, isolation |

O1, O2, O3 and O6 are killed only because the test compares exact output lines (the quotes go missing). The one test that puts a hostile character on the screen covers a policy body only.

## Findings

### G1. Medium: support contact and notification email skip the character rule
`packages/core/src/profile.ts:127-129, 325-337`

The note says control characters and direction overrides are "refused everywhere", and that "a contact and an address are one line". Both fields are checked only against `PHONE` or `EMAIL` (`[^\s@]+@[^\s@]+\.[^\s@]+`), never against `REFUSED`, and are not NFC-normalised.

Executed:
- `"support_contact": "a\u001b[2J@b.c"` is accepted, stored, and returned by `loadBusinessProfile` as `supportContact`, so it would go to the model.
- `"a‮gro.elpmaxe@b.c"` (right-to-left override) is accepted.
- `"a\u0000@b.c"` passes the loader, then PostgreSQL refuses it with `22021`. Since `main.ts` maps every non-usage error to status 1, that is exit 1 after the operator's first row is written; L6 promises exit 2 before the database is reached.
- `notification_email` behaves the same; `"<script>@x.y"` is also accepted.

`profile show` escapes these on screen, so the harm is in what is stored and handed to the model.

Fix: apply `REFUSED` to both fields, and consider ASCII-only for the phone and a stricter address; add tests.

### G2. Medium: currency decimals from `Intl` are not ISO 4217 and depend on the Node version
`packages/core/src/profile.ts:108-114`

`resolvedOptions().maximumFractionDigits` is CLDR's figure. On this Node (v22.23.4, ICU 78.3, CLDR 48) `currencyDecimals` returns **0** for PKR, IQD, IRR, AFN, SYP, YER, LBP, IDR, SOS, HUF, COP, ALL, MMK, LAK and MGA. ISO 4217 gives 2 for these (3 for IQD); the ISO values are from my memory, not looked up.

- For a Pakistani business (Urdu is a target language), `price_minor: 15000` is shown and handed to the model as `15000 PKR` with `decimals: 0`. An operator following ISO, or a payment provider's minor units, means 150.00.
- The stored integer has no decimals stored with it. A Node or ICU upgrade that changes CLDR's figure silently changes every stored price by a factor of 100.
- `CLF` and `UYW` are refused as unknown.
- A stored currency that a later runtime drops makes `assembleBusinessProfile` return `currency: null` with prices still present (executed with `XXQ`).

The note does say "the number of decimals comes from the same list", so the code matches it; the hazard is in the design. The test pins only SAR, KWD and JPY.

Fix: a fixed table of code → decimals in `packages/core` with a test, or store the decimals with the tenant at load time. Add PKR to the tests whichever is chosen.

### G3. Medium: name matching and length checks depend on the database's encoding and collation
`packages/db/migrations/0007_profile.up.sql:14-39`; `packages/db/src/profile.ts:126-181`; `packages/db/test/harness.ts:91`

The loader folds case with JavaScript's `toLowerCase()` and counts code points. The database uses `lower()` and `char_length()`, which follow the database's collation and encoding. The harness runs a bare `CREATE DATABASE`.

On this server (SQL_ASCII, C), executed:
- A service named with 101 Arabic letters, or 200, passes the loader and fails `services_name_check` (`23514`). A body of 2,001 Arabic letters fails `policies_body_check`. `char_length('é')` is 2. The migration's comment "Lengths are counted in characters (code points)" is false here.
- `lower()` folds ASCII only. Stored `Élan`, file `élan`: the result is `added 1, removed 1` and a **new identifier**, for services and policies. L1 says the same name whatever its case is updated in place.
- The unique index accepts `ÉLAN` beside `Élan`.

On a UTF-8 database with a real locale (CI's `postgres:16`), not executed here:
- `lower()` and `toLowerCase()` can still disagree. JavaScript gives `ΟΔΟΣ` a final sigma and `İ` a two-code-point lower case, so the loader passes `ΟΔΟΣ` with `οδοσ`, and `İstanbul` with `istanbul`, as distinct names (executed).
- If the database folds either pair together, the second file entry updates the first one's row and a service is lost silently.

Fix:
- Store the loader's own key in a column (`name_key`) with the unique index on it, and match on that, so one function decides sameness.
- Have `db check` or bootstrap refuse a database whose `server_encoding` is not UTF8.
- Create test databases with explicit `ENCODING 'UTF8' TEMPLATE template0`.
- Add a database test with a 200-code-point non-ASCII name and a non-ASCII case-only rename.

### G4. Medium: tests of `replaceProfile` cannot see several real faults
`packages/db/test/profile.test.ts`

Survivors D7, D8, D11, D12 and D13 mean no test:
- changes a policy's body, or a service's description alone, and reads it back;
- checks `updated_at` moves when a value changes (L3 is tested in the unchanged direction only);
- loads a second file with different settings into the same tenant.

D12 is the plainest: with the body dropped from the UPDATE, all 130 tests pass.

Fix: one test that loads BASE, then a file changing one policy body, one description, the currency, the contact and the email; assert the stored values, the counts, and `updated_at` later for the changed rows and equal for the others.

### G5. Medium: "the cross-tenant role cannot read a tenant's settings" is false
`packages/db/migrations/0007_profile.up.sql:67-70`; `packages/db/test/profile.test.ts:531`; `docs/requirements/traceability.md` (new NFR row)

`psa_cross` holds table-level `SELECT, INSERT` on `tenants` from migration 0001, and the new columns inherit it.

Executed as `psa_cross`:
- `SELECT currency, support_contact, notification_email, business_hours FROM tenants` returns every tenant's values.
- `INSERT INTO tenants (…, currency, support_contact, notification_email)` succeeds with settings of its choosing.

It cannot UPDATE them, which is all the test checks. The ADR 0011 amendment's wording ("cannot change a tenant's settings") is accurate. The migration comment, the test's title and the traceability row ("can neither read nor write a profile") overstate. The API and worker hold this credential, so the notification address is readable there.

Fix: correct the three statements, or move `psa_cross` to column-level SELECT and INSERT on `tenants`. Add the SELECT to the test either way.

### G6. Low: lone surrogates pass the loader and collapse in the database
`packages/core/src/profile.ts:184, 211-225`

The fatal decoder cannot see `"\ud800"` written as a JSON escape. Executed: two services named `"\ud800"` and `"\ud801"` are accepted as distinct, both stored as U+FFFD in one row (`added 1, changed 1, removed 1`). Loading the same file again reports `changed 2`, breaking L3.

Fix: refuse any text where `isWellFormed()` is false.

### G7. Low: a price written with a point or an exponent is accepted
`packages/core/src/profile.ts:365-368`

`"price_minor": 1e3` and `150.0` are accepted as 1000 and 150 (executed). The problem text says "written without a point or an exponent". The author's response to Q5.5 says each number form is a row of L6 "with a test"; the test covers `150.5`, a string and 2^53 only.

Fix: check the number's source text, or drop the phrase and the claim.

### G8. Low: `contactLike` misses things the note says it lists
`packages/core/src/profile.ts:470-477`

"Every link, email address and run of seven or more digits". Executed, not found:
- phone numbers in Arabic-Indic or Persian digits (`٠٥٥٥٠١٠٠١٢٣`, `۰۵۵۵۰۱۰۰`);
- links with no scheme (`wa.me/15550100` yields only its digits; `example.com/pay`, `bit.ly/abc`, `t.me/x` nothing);
- `ftp://` links.

It also merges adjacent numbers into one item and keeps trailing punctuation (`www.example.org,`). This is the operator's only view of what the assistant may send, in a product whose first languages write digits this way.

Fix: `\p{Nd}` for digits, a bare-domain pattern, and tests in Arabic.

### G9. Low: `assembleBusinessProfile` trusts whatever is stored
`packages/core/src/profile.ts:523-552`; `apps/ops/src/commands.ts:490`

The database checks only that hours are an array. Executed:
- `opening_hours = [null, 5, {…}]` makes `loadBusinessProfile` throw `TypeError: Cannot read properties of null`; every turn for that tenant would fail.
- A stored price of 9007199254740993 comes back as 9007199254740992.
- `profile show` prints `opens` and `closes` without `shown()`.

Only the loader writes today, but the migration grants the application role these columns for M5's screen. The test titled "a price wider than JSON carries is refused by the loader long before it could be misread here" loads 2^53 − 1 and tests no refusal.

Fix: validate the row's shape in `assemble`, throw on an unsafe price, print hours through `shown()`, or add database checks.

### G10. Low: invisible characters and silent rewriting in names
`packages/core/src/profile.ts:90-103, 216-217`

- `normaliseName` runs before the `REFUSED` test, so U+2028, U+2029 and U+FEFF in a name become a space instead of being refused. A test pins this for U+2028; "As built" mentions only a line break or a tab.
- Accepted (executed): a name that is only U+200B or only U+200D; tag characters, U+2060 and U+00AD inside a name. The note's rule lists what it refuses, so this matches it.

Worth a sentence in "As built", or refuse names with no visible character.

### G11. Low: `null` and absent lists delete everything
`packages/core/src/profile.ts:350, 370, 376, 384`

`"services": null`, `"policies": null` or a missing key means an empty list, so every stored item is deleted. `"active": null` means true; `"description": null` means empty. `settings` is strict about required keys, the lists are not. A truncated or hand-edited file wipes a tenant's services with exit 0.

Fix: require both keys as arrays and refuse `null`.

### G12. Low: two L6 problems carry no place or a wrong message
`packages/core/src/profile.ts:147-155, 198-201`

- "a key is given twice in one object" does not say where; L6 says each problem is named by its place. Detection itself is sound: escaped keys, nested objects and key-like text inside strings all behave (executed).
- A deeply nested file (400,000 brackets, under 1 MB) throws `RangeError` out of `keysIn`; `main.ts` prints "ops: could not read the command", exit 2.

Fix: catch around the key count and report "nested too deeply".

### G13. Low: tests that cannot fail for what they name
- `ops.test.ts` "a tenant that is not an identifier … refused": survives O5, because the unreadable file raises `UsageError` anyway. No test gives a bad `--tenant` with a readable file, and none for `profile show`.
- `ops.test.ts` load: the hash is checked only for shape (O4). Compare it with the SHA-256 of the bytes.
- `db` L9: survives D2. Accurate as "waits on the row", but it does not show that the explicit lock does anything.
- `db` A3 "another tenant's channel does not count": passes by row-level security, not by the query's filter (D9). Fine, but the title credits the query.
- `core` phone bounds: nothing at 7, 8, 15 or 16 digits (C3, C4). Support-contact email length untested (C23). File cap untested at the edge (C21).
- No database test of any check constraint in 0007 (G3, G4, G7 survive).
- `core/profile.test.ts:447` says "30 policies" and builds 10.

### G14. Low: documents that do not match
- `docs/STATUS.md` says "32 findings, five High". The review's table has 32 rows: **4 High**, 22 Medium, 5 Low, 1 Note. The fifth item named (what `ops` records) is Q5.2, Medium.
- The note's "Tests" section promises the migration "both ways with rows (the way back loses them, and says so)". `migrate.test.ts` compares schema fingerprints on empty tables. It is not listed under "Not written". I ran the down step by hand with rows present: it works and leaves the `profile.loaded` audit rows behind.
- `--file -` (Q5.7's response) is built and works, but has no test, and is not listed under "Not written".
- Section 3 says a profile's size is its texts. The code counts **active** services only (`profile.ts:428-431`, with a test). Not in the note or "As built". A file can therefore hold 100 inactive services of 2,000 characters and pass.
- L11 says the audit row carries "the operator's record it belongs to". As built it is the name and the hash, with no invocation identifier, so the two logs join only by hash. "As built" does say what is stored.

### G15. Note: smaller things
- `main.ts:24-29` reads the whole file, or all of standard input, before the size check.
- A missing `PSA_DB_APP_URL` is found only after the first operator-log row is written (tested and intended; could be checked before).
- `profile show` reads the profile and `answering` in two transactions.
- `replaceProfile`'s statements carry no `tenant_id` filter and rely on row-level security, including the two `DELETE … <> ALL` statements. That is the convention of the neighbouring files I grepped (`sessions.ts`, `inbound.ts`, `outbound.ts`), and `withTenant` refuses any other role.
- After a refused file the problems are followed by the full usage text (about 35 lines).

## What I checked and found sound
- **Duplicate keys:** the string-then-colon count cannot be fooled by valid JSON; a duplicate always lowers the parsed count.
- **`__proto__`:** refused as an unknown key.
- **Hours:** `24:00` only as a close, contained and duplicate periods, at most four, touching allowed.
- **Characters:** ZWNJ, ZWJ, LRM, RLM and ALM accepted; C0, C1, DEL, overrides and isolates refused.
- **Problems:** none repeated a typed value in any probe.
- **Atomicity:** one transaction; a failed load left nothing (L8, and the `23514` and `22021` cases above).
- **SQL injection:** all values are parameters; the one interpolation is of constants.
- **Migration 0007:** RLS enabled and forced on both tables, policies as the checker requires, no new grant to `psa_cross`, down reverses up (fingerprint tests; G1, G2, G6, G8 killed).
- **The model's view:** no business hours, notification email, times or contact data; inactive services excluded.
- **Screen output:** `shown()` neutralises an escape or override in everything but hours.
- **Boundaries:** no SQL outside `packages/db`.
- **Numbers:** fixture sizes and "about twenty-six" compute.
- **Design-review responses:** each of Q1 to Q10 is built, apart from the gaps in G7 and G14.

## What I did NOT check
- Behaviour on a UTF-8 database with a non-C locale (what CI and Docker use): this server is SQL_ASCII/C and I created none. G3's second half is reasoning, not execution.
- ISO 4217 minor units against the standard itself (from memory).
- Exit code 3 for the new commands (the note says it is untested); `ops` end to end against a database beyond what `ops.test.ts` does.
- Two real concurrent loads, or a load racing a turn, beyond the existing L9 and L10 tests.
- The pull-request number #323, issue references and anything on GitHub (no network).
- `docs/design/openapi.yaml` beyond confirming 200 and 2,000 for a service; ADR 0014, the threat model and the guardrail policy against this unit.
- Every row of the design review's long Q8.1 finding (my read of that file was truncated near its end).
- The Dockerfile and compose path for `ops`, `tools/e2e.ts`, and whether `README.md` and `docs/STATUS.md` are otherwise current.
- Performance of a load at 100 services; token cost of anything.

---

## Author's response

Everything below is in the same pull request (#323). The fixes were then
checked by another agent: `2026-11-23-gate4-u3-profile-verification.md`.
The mutants the review found alive were run again by the author after the
fixes; the result is beside each.

| Finding | Answer |
| --- | --- |
| G1 contact and email skip the character rule | Fixed. An email address is the Latin alphabet's letters, digits and the usual signs only, so neither field can hold a refused character; an address in another script is refused, and the note says so. Tests for an escape, an override, a null, `<script>` and each length |
| G2 currency decimals from the runtime | Fixed, and it is a decision: row 43. A fixed table of 25 currencies in `packages/core`, each figure pinned by a test. The figures are from three payment providers' published tables read on 2026-11-23, not from the standard, which was not read. A stored currency outside the list now stops the read |
| G3 names and lengths depend on encoding and collation | Fixed. `name_key` and `title_key` hold the loader's own key and carry the unique index; every match is on them. Migration 0007 refuses a database that is not UTF-8, with a test on a LATIN1 database. The harness creates its databases as UTF-8. Tests: a name of 200 Arabic letters, a body of 4,000, a rename that differs only in the case of a letter outside ASCII. Not done: `db check` does not look at the encoding, because the migration cannot be applied without it. The Turkish and Greek cases are now JavaScript's alone to decide, and the note says how |
| G4 `replaceProfile` tests miss real faults | Fixed. One test changes a body alone, a description alone, a price alone and every setting, and reads back values, counts and which times of change moved. D7, D8, D11, D12, D13: killed |
| G5 "the cross-tenant role cannot read a tenant's settings" was false | Fixed in the database, not in the words: its privilege on `tenants` is now on the six first columns only. Tests: each setting refused on read and on insert, `SELECT *` refused, the six columns still read, a tenant still made. The privilege test lists the columns per role |
| G6 lone surrogates | Fixed: refused everywhere, with a test |
| G7 a price with a point or an exponent | The phrase is removed from the problem and the note says the written form is not checked. The claim in the design review's response (Q5.5) was wrong |
| G8 `contactLike` misses forms | Fixed in part: any script's digits, a name with a dot and an ending, any scheme, trailing punctuation dropped; tests in Arabic-Indic and Persian digits. It still can miss forms and can list a word after a full stop with no space; the note and the function's comment say it is not a check. C15: killed |
| G9 `assemble` trusts what is stored | Fixed: hours of another shape, a price that is not exact and an unknown currency each stop the read with `profile-unreadable`, with tests. Hours are not printed through `shown()`: after the check they can only be clock times. The test's title is corrected |
| G10 invisible characters in names | Fixed: a line break, a tab, a separator or a byte-order mark in a name is refused, not made a space; a name must hold a letter or a digit. Tag characters and a soft hyphen inside a name that also has a letter are still taken |
| G11 `null` and absent lists | Fixed: both lists are required; `null` is refused for a list, for `active` and for `description` |
| G12 problems with no place | In part. A file nested too deeply is refused in those words. "A key is given twice" still names no place; the note says why |
| G13 tests that cannot fail for what they name | Fixed: a bad `--tenant` with a readable file, for both commands (O5 killed); the hash compared with the bytes' own, and with the audit row's (O4 killed); phone bounds at 7, 8, 15 and 16 digits (C3, C4 killed); the contact's length (C23 killed); the file at exactly its limit (C21 killed); the database's checks (G3, G4, G7 killed); the comment that said 30. L9: the separate lock is removed, since the update that follows locks the same row (D2 no longer exists). A3 is retitled. C18 and D9 are left: the review calls the first equivalent, and the second is row-level security doing its work |
| G14 documents | Fixed: STATUS says four High and a Medium; the migration is now tested both ways with rows; `--file -` has a test through the real program; the note says the size counts active services only and that the two records join by the hash only |
| G15 notes | Not changed: the file is read before its size is checked (a megabyte's cap follows at once); the missing address is found after the first row; `show` reads in two transactions; the usage text follows a refused file. Left for #324 |
