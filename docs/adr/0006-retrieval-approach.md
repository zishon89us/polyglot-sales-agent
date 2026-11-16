---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# Structured business data in context, no vector search

## Context and Problem Statement

The assistant may state a grounded fact only if it is true of the thing it is
about, according to the tenant's stored data (US-C4). How does the model get
that data for each reply?

## Decision Drivers

- US-C4 and NFR-A2: every asserted price, time or date carries a claim that
  names the stored item it came from, and code checks the value against that
  item. The model must therefore see items with stable identifiers.
- A tenant's data in v1.0 is small and structured: a list of services (name,
  price, duration, capacity, description), opening hours per weekday, a
  handful of policies. The persona is a two-chair clinic.
- Availability and the contact's bookings change by the minute and must come
  from a query, never from text.
- Risk R-A1 (wrong facts) is the top AI risk.
- Cost per session matters (NFR-C1), and every token is paid for.

## Considered Options

- Put the tenant's structured business data in the prompt, each item with its
  identifier; get availability and bookings through tools
- Embed the data, store vectors, and retrieve the nearest passages per
  message
- Give the model search tools only and no data in the prompt

## Decision Outcome

Chosen option: "structured data in the prompt, tools for live data", because
the data is small enough to supply whole, and supplying it as identified
items is what makes claim checking possible.

Specifics:

- For each reply the prompt includes a business profile assembled from stored
  rows: services, opening hours and policies, each with its item identifier
  and last-updated time. It is built by code from the database, never
  written by the model, and is the same for every contact of a tenant.
- Live facts come only from tools: free slots for a service and date range,
  the contact's own bookings, and the booking actions. Tool results carry an
  identifier and a time, which US-C4's 10-minute rule uses.
- A size budget is set in M3 from measured token counts. A tenant whose
  profile would exceed it cannot save more data; the editor says so. No
  selection or summarising of the profile happens in v1.0.
- Free-text fields the owner types (descriptions, policies) are delimited as
  data in the prompt (US-C8, criterion 4).

### Consequences

- Good, because nothing relevant can be missed by a retrieval step: the model
  sees all of the tenant's data every time.
- Good, because claims can name item identifiers, so the run-time check
  compares a value with one specific stored value.
- Good, because there is no embedding model, vector index or second data
  store to run, secure or keep in step with edits.
- Good, because an owner's edit takes effect on the next reply (US-D2).
- Bad, because the whole profile is paid for on every call, which raises cost
  per session for tenants with more data. Provider prompt caching may reduce
  this but is not relied on.
- Bad, because it does not scale to a tenant with hundreds of services or
  long documents. That tenant is outside v1.0, and the size budget makes the
  limit explicit instead of silent.
- Bad, because a long profile can dilute the model's attention; this is
  measured by evals with a profile at the size budget.

### Confirmation

By the end of M3: a unit test builds the profile from fixture rows and checks
every item has an identifier; an eval set includes a tenant at the size
budget; the editor rejects data beyond the budget with a clear message (M5).

## Pros and Cons of the Options

### Structured data in the prompt

- Good, because it is complete, simple and checkable.
- Bad, because of cost per call and the size ceiling.

### Vector retrieval

- Good, because it scales to large knowledge bases.
- Bad, because retrieval can miss the one relevant item, and a missed price
  becomes "I do not have that information" or, worse, a guess.
- Bad, because chunks of text do not map cleanly to items, which weakens
  claim checking.
- Bad, because it adds an embedding model, an index and a synchronisation
  problem, for data that fits in a page.

### Search tools only

- Good, because the prompt stays small.
- Bad, because every reply needs at least one extra model round trip, which
  doubles latency and cost for the commonest questions.

## More Information

- Reopen when a pack needs documents or catalogues larger than the size
  budget. Vector search can then be added behind the same profile-building
  step.
- The size budget is unset until M3 (it depends on OQ-9).
