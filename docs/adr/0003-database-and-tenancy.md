---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# PostgreSQL, one schema, tenant isolation by row-level security

## Context and Problem Statement

Every tenant's data must be invisible to every other tenant (US-C2, NFR-S1,
risk R-T2), and a booking must never exceed capacity under concurrent
requests (invariant B1, risk R-T5). Which database, and how is tenant
isolation enforced?

## Decision Drivers

- NFR-S1: zero cross-tenant reads or writes, proven by tests on every
  tenant-owned table.
- A forgotten `WHERE tenant_id = …` in application code must not leak data.
- Invariant B1: the capacity check and the booking write happen together.
- NFR-O4: reversible, versioned migrations.
- Tenants are small and many; one deployment serves all of them.

## Considered Options

- One PostgreSQL schema, a `tenant_id` on every tenant-owned table, enforced
  by row-level security
- One schema, `tenant_id` filtering in application code only
- One schema per tenant
- One database per tenant

## Decision Outcome

Chosen option: "one schema with row-level security", because isolation is
then enforced by the database on every query, including ones written wrongly.

Specifics:

- Every tenant-owned table has a non-null `tenant_id` and a row-level
  security policy comparing it with a per-transaction setting.
- The application connects as a role that does **not** bypass row-level
  security. Each unit of work opens a transaction and sets the tenant for
  that transaction only. A query run with no tenant set returns no rows.
- A separate role, used only by migrations and by clearly named operator
  jobs (retention, the daily credential check), may act across tenants. Its
  use is confined to one module and covered by the import-boundary test.
- Access goes through a typed SQL query builder, not a full ORM, so the SQL
  that runs is visible in review. Migrations are plain SQL files with an up
  and a down step.
- Booking capacity: creating or moving a booking takes a transaction-scoped
  advisory lock keyed on the tenant, and on the service unless the tenant has
  a total-concurrent-bookings setting, then checks the free-slot rule and
  writes, all in one transaction.
- Deduplication of inbound messages is a unique constraint on the channel
  message ID per tenant, so a redelivered webhook fails the insert and is
  recognised (US-C1).

### Consequences

- Good, because a missing filter in application code yields no rows, not
  another tenant's rows.
- Good, because the isolation tests can be generated: for each table, set
  tenant A and try to read and write tenant B's rows.
- Good, because one schema keeps migrations and operations simple.
- Bad, because row-level security adds a predicate to every query and must be
  remembered for every new table. A test that lists all tables and fails on
  one without a policy is required.
- Bad, because connection pooling must not leak the tenant setting between
  requests. Setting it with transaction scope prevents this, and a test must
  prove it.
- Bad, because a tenant-wide advisory lock serialises bookings for tenants
  that set a total limit. At this product's volumes that is acceptable; it
  would not be for a very large tenant.
- Bad, because one database is one blast radius: a bad migration affects
  every tenant.

### Confirmation

By the end of M2: a test enumerates every table with a `tenant_id` column and
fails if it has no row-level security policy; a generated test attempts
cross-tenant reads and writes on each such table and expects none to succeed;
a test runs two requests for different tenants on one pooled connection and
checks neither sees the other's rows. By the end of M5: a concurrency test
fires parallel bookings at one slot and checks invariant B1.

## Pros and Cons of the Options

### Row-level security

- Good, because enforced below the application.
- Bad, because of the per-table discipline and pooling care described above.

### Application-level filtering only

- Good, because simplest to write.
- Bad, because one missed filter is a data leak, and review is the only
  defence.

### Schema per tenant

- Good, because strong separation and easy per-tenant export.
- Bad, because every migration runs once per tenant, and thousands of schemas
  strain tooling.

### Database per tenant

- Good, because the strongest isolation and per-tenant backup.
- Bad, because of the operational cost, far beyond what one maintainer and a
  portfolio project can run.

## More Information

- The typed query builder is a library choice to be verified in M2.
- This refines the default in `AGENTS.md` section 3 ("row-level tenant
  scoping").
- Risk R-T5's mitigation refers to this record.
- Reopen if a tenant needs data held in a different region from the others;
  see ADR 0009.

## Amendment, 2026-11-17: as built in M2 unit U4

Made while building the database (issue #265). It corrects two statements
above that the Gate 2 review found wrong (finding S22, #191) and records how
the decision was carried out. The decision itself is unchanged.

**Corrections.**

- "Specifics" says the cross-tenant role is "used only by migrations and by
  clearly named operator jobs". That was wrong twice. Migrations have a role
  of their own. And the cross-tenant role is also used on ordinary request
  paths: for the three lookups that must happen before a tenant is known
  (routing a webhook, authenticating a request, starting a sign-in), and
  for claiming a job (`docs/design/data-model.md`, "Access before the
  tenant is known").
- "Confirmation" says a test enumerates "every table with a `tenant_id`
  column". That rule fails on tables that carry the column without a policy
  on purpose, and misses `tenants`, which has no such column. The rule as
  built: **every table in the `public` schema must be tenant-scoped unless
  it is on an explicit list**, `UNSCOPED_TABLES` in
  `packages/db/src/roles.ts`, where each entry gives its reason.

**Three roles** (#162), created by a bootstrap step that needs the server's
administrator; nothing after it does.

| Role | Used for | What it can do |
| --- | --- | --- |
| `psa_migrate` | Migrations | Owns the schema. Row-level security is forced, and it has no policy, so it reads no rows of tenant-owned tables |
| `psa_app` | The application | Reads and writes the rows of the transaction's tenant, within the privileges granted per table. Cannot create, alter or truncate anything, and cannot update or delete audit entries |
| `psa_cross` | Lookups and jobs that cross tenants by design | Sees every tenant's rows, in the tables it has been granted. As of unit U4: `tenants`, `channel_accounts`, `channel_routes`. Later units add to this; the list that is kept current is the one in `packages/db/test/isolation.test.ts` |

None of the three is a superuser or has the attribute that bypasses
row-level security. The cross-tenant role sees all rows through a policy of
its own on each table, so no special attribute is needed and what it may
reach is visible in the migrations.

**How isolation is carried.**

- Each tenant-owned table has row-level security enabled and forced, and
  one policy for `psa_app`: the row's tenant must equal
  `app_tenant_id()`, for reads and for writes.
- `app_tenant_id()` reads a setting that `withTenant`
  (`packages/db/src/tenant.ts`) makes for one transaction. With no tenant
  set it is null, so every policy fails and no row is visible.
- Foreign keys between tenant-owned tables include `tenant_id`. A
  foreign-key check is not subject to row-level security, so without this a
  row could point at another tenant's row.
- `channel_routes` is kept equal to `channel_accounts` by a trigger and a
  cascading foreign key. Neither the application role nor the cross-tenant
  role may write it. The migration role, as its owner, can.
- `findIsolationProblems` (`packages/db/src/policy-check.ts`) reads the
  database's catalogue. It reports: a table without the policy, or with a
  policy that admits more; a view; the application role able to truncate a
  table or to reach an unscoped one, by table or by column; one of the three
  roles with a power, a membership or a setting of its own; an object the
  migration role does not own; a function that runs with its owner's rights
  and is not on a list, or that everyone may execute; default privileges
  for the wrong roles. `make db-setup` runs it, and the tests run it.
- It does not judge which table privileges each role holds. A test compares
  those with a fixed list, so widening one is a visible change to that list.
- The bootstrap step sends each role's password as a SCRAM verifier, so the
  password is not in the statement text or the server's log. A password
  must be printable ASCII; others are refused, because the server prepares
  them by rules the step does not implement.
- `withTenant` refuses a pool that does not connect as `psa_app`, refuses a
  query through a handle whose transaction has ended, rejects when the
  transaction was rolled back although the work returned, and clears a
  session-wide tenant setting before the connection goes back to the pool.

**What this does not do.**

- Uniqueness is checked across all rows whatever the policies say. Primary
  keys are unique across tenants, so an insert that reuses another tenant's
  row identifier fails differently from one that does not, which tells the
  caller the identifier exists. The identifiers are random UUIDs. Other
  uniqueness rules on tenant-owned tables include the tenant.
- The application role can see whole-table row counts in the statistics
  views, can take the advisory lock the migration runner uses (the runner
  gives up after 30 seconds), and can connect to other databases on the
  same server unless their owner forbids it (#279).
- The policies stop a query that forgot its filter. They do not stop SQL
  text that sets the tenant itself: the application role may set the
  setting, because that is how `withTenant` works. Query text must never be
  built from outside input (threat T33); nothing enforces that yet (#279).
- `withTenant` sets the tenant it is given. Whether the caller may act for
  that tenant is decided before it, by the session or the webhook route.
- The typed query builder named in "Specifics" is not chosen yet.
  `withTenant` hands out a plain query function; the builder is chosen in
  the first unit that writes real queries (#279).
- Of "Confirmation", the three M2 tests exist. The concurrency test for
  invariant B1 is M5's.

**Dependencies added**, on 2026-11-17, versions pinned exactly. `pnpm audit`
reported no known vulnerabilities after adding them.

| Package | Version | Licence | Last published | Why this one | Considered instead |
| --- | --- | --- | --- | --- | --- |
| pg | 8.23.1 | MIT | 2026-09-30 | The long-established PostgreSQL driver for Node.js; supports the pooled, transaction-scoped use this record needs | `postgres` (porsager): a newer driver with a different pooling model, which sets per-transaction state less directly |
| @types/pg | 8.23.1 | MIT | 2026-10-04 | Types for the driver | — |

The driver brings thirteen packages of its own, all MIT or ISC:
pg-cloudflare, pg-connection-string, pg-int8, pg-pool, pg-protocol,
pg-types, pgpass, postgres-array, postgres-bytea, postgres-date,
postgres-interval, split2 and xtend. Their maintenance was not looked at
one by one.

The tests ran against PostgreSQL 16.15. No other version was tried.
