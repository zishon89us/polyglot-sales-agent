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
- Per-conversation ordering: a worker takes a transaction-scoped advisory
  lock on the conversation before processing; a second worker skips it.
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
- Bad, because the advisory lock for ordering and the one for booking
  capacity (ADR 0003) must use distinct key spaces, or they will collide.
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
