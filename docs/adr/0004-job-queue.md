---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# Jobs in PostgreSQL, enqueued in the same transaction as the data

## Context and Problem Statement

The webhook must store an inbound message, queue its processing and answer
within a second (NFR-P1), and no acknowledged message may be lost (NFR-R1).
The system also needs timers: batching windows of seconds, retries of a
minute, reminders days ahead, and handover expiries of 7 and 14 days. Where
do jobs and timers live?

`AGENTS.md` section 3 named Redis with a job queue as the default and asked
for it to be confirmed or changed here. This record changes it.

## Decision Drivers

- NFR-R1: "stored and queued" must be one atomic step. If the message is
  stored but the job is lost, the customer gets no reply.
- NFR-R2, NFR-R6: one worker per conversation at a time; replies in order.
- Timers from 3 seconds to 14 days, which must survive restarts.
- NFR-R5: retries with backoff and a dead-letter queue.
- NFR-M4 and one maintainer: as few moving parts as possible.
- Reference load: 20 inbound messages a second.

## Considered Options

- Jobs in PostgreSQL, in the same database as the data
- Redis with a job-queue library
- A managed cloud queue

## Decision Outcome

Chosen option: "jobs in PostgreSQL", because the job can then be written in
the same transaction as the message it concerns, which makes "stored and
queued" atomic with no extra mechanism.

Specifics:

- A `jobs` table holds each job's type, payload, run-at time, attempt count
  and state. Workers claim due jobs with row locking that skips rows another
  worker holds.
- Enqueueing is an insert in the caller's transaction. The webhook's single
  transaction inserts the message and its job; either both exist or neither.
- Timers are jobs with a future run-at time. Cancelling a timer (a reminder
  for a cancelled booking) deletes or marks its row in the same transaction
  as the change that cancels it.
- Per-conversation ordering: a worker takes a **lease** on the conversation
  before processing: in a short transaction it writes its own random token
  and an expiry two minutes ahead to the conversation row, if no unexpired
  lease is there. A second worker that finds a live lease leaves the job for
  later. The lease is renewed before each model attempt. The model call
  happens outside any transaction. When the work is done, the transaction
  that stores the result first checks that the token is still the worker's
  own; if it is not, because the lease expired and another worker took over,
  the result is thrown away and nothing is sent. A transaction-scoped lock
  was the first design; it cannot span a model call that is made outside a
  transaction (Gate 2 finding S1). The full sequence is in
  `docs/design/architecture.md`, "Processing one turn".
- Retries: attempt count and next run-at time are updated on failure with
  exponential backoff; after the last attempt the job moves to a dead-letter
  state and raises the operator alert (NFR-R5).
- Short-lived counters (per-contact rate limit, degraded-mode trigger) also
  live in PostgreSQL. No Redis in v1.0.
- Whether to build this on an existing PostgreSQL job library or write the
  small amount of SQL directly is decided in M2, after checking the
  candidates' maintenance and licence.

### Consequences

- Good, because there is no window in which a message exists without its job,
  and no outbox process to keep the two in step.
- Good, because one fewer service to run, monitor, back up and secure, and a
  simpler local stack.
- Good, because jobs are rows: they can be inspected, counted and tested with
  the same tools as the data, and are covered by the same backup.
- Bad, because throughput is lower than a dedicated queue. Polling adds
  latency: the poll interval must be well under the 3-second batching window.
  At the reference load this is comfortable; at a hundred times that load it
  would need revisiting.
- Bad, because job rows add write load and table churn to the primary
  database; completed jobs must be deleted or archived on a schedule.
- Bad, because a lease can expire while a slow model call is still running.
  The token check makes the late result harmless, at the cost of one wasted
  model call.
- Bad, because it departs from the stack many reviewers expect, so the README
  must explain it.

### Confirmation

By the end of M2: an integration test stops the worker between storing and
processing and shows the message is still processed exactly once (NFR-R1); a
test delivers the same message ID five times and sees one reply (NFR-R2); a
test with two workers and bursts of five messages sees replies in order
(NFR-R6); a test exhausts a job's retries and finds it in the dead-letter
state with an alert raised (NFR-R5); the load test meets NFR-P1 at the
reference load.

## Pros and Cons of the Options

### Jobs in PostgreSQL

- Good, because of transactional enqueue and one fewer service.
- Bad, because of the throughput ceiling and database load.

### Redis with a job-queue library

- Good, because it is fast, widely used, and has delayed jobs and retries
  built in.
- Bad, because storing in PostgreSQL and enqueueing in Redis are two systems:
  a crash between them loses the job unless an outbox table and a relay are
  added, which is most of the PostgreSQL design plus a second service.
- Bad, because Redis must be configured for durability, or timers days ahead
  can be lost on restart.

### Managed cloud queue

- Good, because it is durable and scales without operation.
- Bad, because of the same two-system problem, a dependency on one cloud
  before a hosting target is chosen (ADR 0009), and a local stack that needs
  an emulator.

## More Information

- This changes `AGENTS.md` section 3, which is updated in the same pull
  request.
- Reopen if the load test fails NFR-P1 or if measured polling latency makes
  NFR-P2 unreachable.

## Amendment, 2026-11-17: as built in M2 unit U5

Made while building the queue (issue #266) and corrected after its code
review. The decision is unchanged. This settles what "Specifics" left to M2,
records how it was carried out, and says where the build departs from the
design documents.

**Library or own SQL.** Own SQL. Two libraries were looked at on
2026-11-17, by their registry entries only: `pg-boss` 12.38.2 (MIT, last
published 2026-11-10) and `graphile-worker` 0.18.0 (MIT, last published
2026-09-08). Neither was tried. The reasons for writing it here:

- A job is queued by the application role inside the tenant's own
  transaction, under row-level security. A library that owns its tables
  and its connection would need the same policies fitted around it.
- Most tests pass the time in and step it, with no sleeping; a library
  reads its own clock.
- It is fifteen SQL statements in three files.

**One clock.** The database's clock decides when a job is due, when a
claim or a lease has run out, and whether a worker is alive. Workers on
different machines cannot agree on those if each compares against its own
clock, and the first version of this unit did exactly that. Every function
takes an optional time, which running code leaves out; only tests pass it.
The clock is read at each statement, not at the start of its transaction,
so a lease taken late in a transaction still lasts its two minutes.

**At least once.** A job is run at least once, not exactly once. A worker
that is slow, not dead, can still be running a job when another worker
takes it after the claim time; a handler that is failed for taking too long
may still be running. So what a job changes must be safe to do twice. For a
conversation that is what the lease is for; for a send it is U8's concern.

**How it works.**

| Thing | As built |
| --- | --- |
| States | `queued`, `running`, `dead`. A finished job is deleted, so nothing needs archiving. A dead job stays until someone removes it |
| Claim | One statement takes the due job that has waited longest, with a row lock that skips rows another worker holds. One queue for all tenants, oldest first: nothing stops one tenant's flood from delaying another's jobs |
| A failed run | Queued again after 2, 4, 8, 16 and 32 seconds (NFR-R5: five retries), then `dead`. Only a short code of the error is stored, never its message |
| A run that takes too long | Failed after 4 minutes with the code `handler-timeout`, and the handler is told to stop through an abort signal |
| A worker that dies | Its job stays `running`. After the claim time, 5 minutes, another worker takes it. A run that ends this way counts as one of the six |
| A slow worker | Cannot finish, fail or put back a job that another worker has since taken |
| Leaving a job for later | A handler that finds its conversation held by another worker puts the job back for a wait of up to an hour. That does not count as a run, and nothing limits how often. Any other thing a handler returns fails the run |
| Dead job | Queues a job of type `operator-alert` in the same statement, naming the dead job and nothing else. A dead alert raises no alert; the count of them is printed by the worker's probe |
| Type and payload | A type is lower-case letters and hyphens. A payload holds identifiers only: at most 20 keys, each of at most 40 letters ending in `Id`, each value a UUID. The table itself refuses anything else, and the code applies the same rule first. A UUID made to spell a number would pass both |
| Timers | A job can name its subject (a conversation; later a booking or a handover). The queued jobs of one type about one subject can be cancelled or replaced in the transaction that changes the state they belong to |
| Lease | `takeLease`, `renewLease`, `holdsLease`, `releaseLease`, inside the tenant's transaction. `holdsLease` locks the conversation row against another worker taking the lease, so a result is stored and the lease checked as one step. The lock does not hold up a new message for the conversation |
| An expired lease nobody took | Still the worker's. Only another worker's token ends it, as "Specifics" says |

**Who may do what on `jobs`.** The cross-tenant role claims and changes
every job. The application role, inside one tenant's transaction, may add a
job for that tenant (not of the alert type, not dated more than a minute
into the past, and not choosing its state, attempts or identifier), see which of that tenant's jobs exist (identifier,
type, subject and state; not the payload or the error), and delete one that
is still queued. It can change nothing. The data model called `jobs` a
table outside tenant scoping; it is not, and decision 13 there records why.

**Accepted as they are.** The application role can lock the whole `jobs`
table, as it can any table it may update or delete from, and that would
stop the queue; it can queue any number of jobs, which sit ahead of other
tenants' later ones; and it can see how large the table is. All three need
code of ours to do it. They are recorded in #282.

**Where this departs from the data model.** `dedupe_key` is replaced by
`subject_id`, a UUID, so that the column cannot carry text. There is no
uniqueness on it: two replacements of one timer at the same moment can
leave two jobs, which is harmless because a timer job re-reads the state
when it runs (architecture, "Timers").

**Timers of the architecture's table** (Gate 2 finding S26, #195). None of
them exists in M2: the skeleton has no batching window, sessions, reminders
or handovers. What exists is the means: a due time, a subject, cancel and
replace. The table in the architecture is still incomplete, and #195 stays
open.

**The worker's health** (Gate 2 finding S18, #187). The worker accepts no
HTTP, so it cannot have an endpoint. It writes a heartbeat row; a worker is
ready if any worker was seen within 30 seconds. The probe is the command
`pnpm run db worker-status`, which exits 0 or 1 and needs the cross-tenant
role's connection string. It tells that a worker is running, not that jobs
are succeeding. **NFR-O1 was reworded by the agent to say this; that is a
change to a requirement and waits for the maintainer's word** (`STATUS.md`,
"Blocked on the maintainer").

**Fixed times.** In `packages/core/src/jobs.ts` and the glossary.

| Time | Value | From |
| --- | --- | --- |
| Retries and waits | 5; 2 s doubling | NFR-R5 |
| Conversation lease | 2 minutes | This record |
| Claim on a job | 5 minutes | The agent's proposal: longer than a handler may run |
| A handler's time | 4 minutes | The agent's proposal: longer than the longest job, a turn of three 20-second model attempts |
| Poll interval | 500 ms | The agent's proposal: "well under the 3-second batching window" |
| Heartbeat; ready within | 10 s; 30 s | The agent's proposal |

**Reversing the migration** deletes every job, queued, running and dead,
and every held lease.

**Not built here** (#282): the worker process that polls and runs handlers;
delivery of an operator alert, for which there is no mailer; the API's
readiness answer; removal of dead jobs; renewal of a claim by a long job;
any fairness between tenants. Of "Confirmation", this unit shows the retry
and dead-letter test with the alert queued, and the lease at the level of
the database. The restart, five-times and ordering tests need the webhook
and the worker (U7, U8).
