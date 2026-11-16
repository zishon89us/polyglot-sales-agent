---
status: "proposed by the agent; accepted when the maintainer merges it"
date: 2026-11-16
decision-makers: "agent (proposal), maintainer (approval)"
---

# The core holds nothing about bookings; the booking pack owns its rules, tables and routes

## Context and Problem Statement

`AGENTS.md` section 1 says the core knows nothing about any niche and that
adding a pack must not need a core change (NFR-M1). The Gate 2 review found
that the design did not keep to this (finding S4): the booking and reminder
state machines and the reminder timing rule were placed in `packages/core`,
booking tables and settings sat in the core schema, and booking routes in
the core API. The trial pack `faq-only` could not have exposed it, because
that pack adds no code. A real second pack would have needed core changes.

The maintainer chose on 2026-11-16 to move the booking rules out of the core
and keep the claim, over keeping them and weakening it.

## Decision Drivers

- The claim that a new use case is a new pack is the project's main
  architectural point (ADR 0001, quality goal 5).
- The boundary must be checked by something stronger than a pack that adds
  no code.
- Version 1.0 has one real pack. The pack interface must not grow machinery
  that only a hypothetical second pack would use.
- Row-level security, the lease, the send policy and the output checks must
  apply to pack code exactly as they do to core code.

## Considered Options

- Move the booking rules, tables and routes into the pack
- Keep them in the core and say the core is booking-aware
- Split the repository into a core library and separately versioned packs

## Decision Outcome

Chosen option: "move the booking rules, tables and routes into the pack",
because it keeps the central claim true at a cost paid once, now, in design.

### What the core owns

- Tenants, users, contacts, conversations, sessions, messages, handovers,
  consent and opt-out, templates as a mechanism, jobs, traces and the audit
  log.
- The **business profile** every pack answers from: services with a name,
  description and price; policies; opening hours.
- The order of checks and six state machines: handover, session, contact
  messaging permission, outbound message, provider availability, tenant.
- The message classes, quiet hours, the output checks and the claim kinds
  for prices, opening hours, service details and policies.
- The core metrics: first-reply time, handover rate, containment rate, cost.

### What the booking pack owns

- The booking and reminder state machines (state machines sections 4 and 5),
  the reminder timing rule, slots, capacity and invariant B1.
- Its tables, in its own migrations: `bookings`, `reminders`,
  `blocked_periods`, and `booking_service_settings` (a service's duration
  and capacity). Its settings: booking horizon, slot interval, total
  concurrent bookings, minimum notice, change cut-off, reminder lead time.
- Its tools, prompt fragment, templates, the Confirm, Reschedule and Cancel
  buttons, its timers, and the claim kinds for slot and booking times and
  for calendar dates.
- Its API routes: `/bookings`, `/slots`, `/blocked-periods`.
- Its metrics: inquiry-to-booking rate and no-show rate.

### What a pack plugs into

The interface in `architecture.md`, "What a pack provides", gains four
parts so that the list above can live outside the core:

| Part | What the pack supplies | What the core does with it |
| --- | --- | --- |
| Migrations | SQL for its own tables, each with `tenant_id` and a row-level security policy | Runs them after its own; the test that every tenant-owned table has a policy covers them |
| Settings | A schema with defaults and ranges | Stores the values, validates saves, shows them under US-D11 |
| Routes | A route plug-in with a declared role per route | Mounts it; a tenant on another pack gets 404 from it; the role inventory covers it |
| Timers and button handlers | Job types and button payloads it handles | Runs them inside the tenant's scope, under the same lease and send rules |

A pack never gets the cross-tenant role, never calls the channel or the
model itself, and never sends a message except by creating one for the core
to check and send.

### Consequences

- Good, because the claim is now true by construction, not by assertion.
- Good, because the boundary can be tested (below) before a second real pack
  exists.
- Bad, because the pack interface is larger: nine parts became thirteen, on
  the evidence of one pack. Some of it may be the wrong shape for the next
  pack and will be reworked then.
- Bad, because a service's duration and capacity are in a different table
  from its name and price, so the booking pack's queries join two tables.
- Bad, because documents written before this decision described these things
  as core. They are corrected in the same pull request, and anything missed
  is a defect.
- Neutral, because opening hours stay in the core although the booking pack
  is their main user; a pack with no appointments still tells customers when
  the business is open.

### Confirmation

- **Boundary test, in CI from milestone M2:** no file under `packages/core`,
  the core migrations or the core API routes contains the name of a booking
  table, type, setting or route. The list of names is kept by the pack.
- **Import test:** `packages/core` imports no pack; `apps/api` and
  `apps/worker` reach packs only through the registry.
- **Trial pack, end of M5:** `faq-only` is added with no change under
  `packages/core` (NFR-M1). This remains necessary and is no longer the only
  check.
- **Honest limit:** no second pack with code exists, so the interface is
  untested against a different use case. The `cod-confirm` pack in v1.1 is
  the first real test.

### Where the values live

- Pack settings: the core table `pack_settings`, one JSON object per tenant,
  validated against the pack's schema. The core never names a key.
- A service's duration and capacity: the pack table
  `booking_service_settings`.
- Consent records name what they are about by `subject_type` and
  `subject_id`, which the pack sets and the core does not interpret.
- A session's `pack_outcome` and a metrics response's `pack_metrics` are
  supplied by the pack.
- In the API, pack operations carry `x-pack`, and `Settings.pack_settings`
  and `Metrics.pack_metrics` hold what the pack declares.

### Known exceptions, not yet removed

The verification of this decision found places where core rules still name
booking things (finding V9). They are accepted for now and tracked as an
issue, to be routed through pack hooks before the boundary test is switched
on in M2:

- The order of checks names the Reschedule and Cancel buttons (steps 10, 13
  and 15).
- The contact-permission machine lists "contact books in chat" as an event.
- The handover reason `late-change`.
- The glossary's containment metric and quiet-hours rules mention bookings
  and reminders.
- The package diagram in `architecture.md` lacks the edge from `api` to
  `pack`.

The second verification found more (see the response in
`docs/reviews/2026-11-16-gate2-verification-2.md`): the handover reason
`late-change` is also in the core API schema; the OpenAPI descriptions of
`pack_settings` and `pack_metrics` list the booking pack's keys; two core
operations mention bookings in their descriptions; the withheld-messages
route is marked as the booking pack's although core messages appear in it;
and three sentences in `architecture.md` and the data model still describe
the old placement.

So the accurate claim today is narrower than this record's title: **booking
state machines, tables, settings, metrics and routes are designed as the
pack's; the core still names bookings in the places listed here, and the
boundary test would fail on them.** Removing them is tracked work for M2,
before the test is switched on.

## Pros and Cons of the Options

### Move the booking rules, tables and routes into the pack

- Good, because it matches what `AGENTS.md` and ADR 0001 promise.
- Bad, because it is more design and more interface.

### Keep them in the core and say the core is booking-aware

- Good, because it is less work and simpler to build.
- Bad, because the project's main claim would then be false, and the
  repository exists partly to demonstrate it.
- Bad, because the v1.1 pack would begin with a refactoring of the core.

### Split the repository into a core library and separately versioned packs

- Good, because the boundary would be enforced by packaging.
- Bad, because versioning and releasing several packages is cost with no
  user in v1.0.

## More Information

- Gate 2 structure review, finding S4:
  `docs/reviews/2026-11-16-gate2-design-structure.md`.
- NFR-M1; ADR 0001; `architecture.md` sections 5 and 8.
