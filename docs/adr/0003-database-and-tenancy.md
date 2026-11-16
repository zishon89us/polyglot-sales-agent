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
