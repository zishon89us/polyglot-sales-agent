---
status: "proposed; needs the maintainer"
date: 2026-11-16
decision-makers: "the maintainer"
---

# Hosting target and region

## Context and Problem Statement

Milestone M6 deploys to a staging environment, with infrastructure defined as
code for one cloud target (`AGENTS.md`, section 3). Which target, and in
which region? This costs money and needs an account, so only the maintainer
can decide (`AGENTS.md`, section 2; issue #7; open question OQ-9).

Nothing before M6 depends on the answer: milestones M2 to M5 run in local
containers and in CI.

## Decision Drivers

- Cost: a portfolio project with no revenue.
- The running parts are few: an API process, a worker process, the dashboard
  and one PostgreSQL database (ADR 0004 removed Redis).
- Region has legal weight if real customer data is ever processed. Hosting
  outside Saudi Arabia would be a transfer of personal data outside the
  Kingdom (`docs/compliance.md`, Part B). For v1.0, which processes no real
  customer data, this does not bind.
- Rollback within 15 minutes (NFR-O3) and reversible migrations (NFR-O4).
- The deployment should be reproducible by a stranger from the repository.

## Considered Options

These are kinds of target, not vendors. No vendor's current pricing, regions
or free allowances have been checked.

- A container platform that runs images and offers managed PostgreSQL
- A single virtual machine running the same containers as the local stack
- A large cloud provider's container service with its managed PostgreSQL,
  chosen for a region in or near the target market
- No hosted deployment: v1.0 ends with the local stack and a recorded demo

## Decision Outcome

Not decided.

The agent's recommendation, for the maintainer to accept or replace: **a
single virtual machine running the project's own containers**, in whichever
region is cheapest, with the README stating that the deployment holds only
synthetic data. It is the cheapest option that still demonstrates deployment,
rollback and migrations, and the infrastructure code is small and readable.
If the project is later used with real data, this record must be superseded
by one that chooses region and provider on legal grounds.

### Consequences

To be written when decided.

### Confirmation

To be written when decided. At minimum: the deploy and rollback runbooks are
each executed once against the chosen target (`AGENTS.md`, section 10).

## Pros and Cons of the Options

### Container platform with managed PostgreSQL

- Good, because there is little to operate and backups are handled.
- Bad, because cost and region choice depend on the vendor; not checked.

### Single virtual machine

- Good, because it is cheap, and identical in shape to the local stack.
- Bad, because the maintainer operates the database: backups, patching and
  recovery are manual, which is acceptable only for synthetic data.

### Large cloud provider, region chosen for the market

- Good, because it is the only option that can address data location.
- Bad, because it is the most expensive and the most infrastructure code.

### No hosted deployment

- Good, because it costs nothing.
- Bad, because the release and operate phases of the lifecycle
  (`AGENTS.md`, section 5) would have no real evidence.

## More Information

- Needs from the maintainer: the choice, an account, and a spending limit.
- Before choosing a vendor, its current pricing and regions must be read from
  its own site and recorded here with the date.
