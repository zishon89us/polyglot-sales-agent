---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# A thin `LlmClient` interface owned by this project

## Context and Problem Statement

The assistant calls a language model to write replies, choose tools and
classify sessions. The provider is not chosen yet (ADR 0010, open question
OQ-9) and may change for cost or data-location reasons (risk R-C3). Tests
must run with no provider at all. How does the rest of the code call a model?

## Decision Drivers

- Milestones M2 and M3 must be buildable and testable before any provider key
  exists.
- NFR-R4 and US-C15: timeouts, bounded retries and failure states must be
  under this project's control, not a library's defaults.
- US-C4: a reply comes with structured claims that code verifies.
- US-C10, NFR-A5: every call leaves a trace with tokens, cost and latency.
- NFR-V7: no phone number or contact name may reach the model.
- Risk R-A5: a provider or model change must be one reviewed change with a
  full eval run.

## Considered Options

- A small interface defined by this project, with one adapter per provider
  and a deterministic fake
- Calling one provider's SDK directly throughout the code
- Adopting a multi-provider framework as the abstraction

## Decision Outcome

Chosen option: "a small interface defined by this project", because the
behaviour this product depends on (structured output, tool calls, timeouts,
tracing, redaction) is small enough to own, and owning it keeps a provider
change local.

Specifics:

- `LlmClient` exposes one operation: given a prompt name and version,
  messages, the tools on offer and an output schema, return either a
  validated structured result (reply text, claims, tool calls) or a typed
  failure (timeout, provider error, invalid output).
- The interface uses this project's own types. No provider type appears
  outside an adapter.
- Timeout, attempts and waits are parameters with the values in the glossary.
  The adapter does not retry on its own; the caller implements US-C15.
- Output that does not match the schema is a typed failure, not a best-effort
  parse.
- A wrapper around every adapter writes the trace of US-C10.
- Prompt assembly, which sits in front of the client, never adds the
  contact's phone number or name (NFR-V7). It cannot remove a number the
  customer typed into their own message; that text is theirs and is passed
  as written.
- `FakeLlmClient` is deterministic and scripted: tests state what it returns
  for a given input, including failures and malformed output. It is the only
  client used in unit, integration and end-to-end tests.
- Model name and parameters come from configuration. Each prompt's
  `meta.yaml` names the model it was evaluated with.

### Consequences

- Good, because M2 and M3 need no account, key or network.
- Good, because failure handling is tested deterministically: the fake can
  time out on the second attempt, on demand.
- Good, because a provider change is one adapter plus an eval run.
- Bad, because provider-specific features (prompt caching, native structured
  output modes) must each be mapped through the interface or go unused.
- Bad, because the fake cannot show how a real model behaves; it proves the
  plumbing, not the quality. Only evals against a real model do that, and
  they need a key (OQ-9).
- Bad, because this is code to maintain that a framework would have supplied.

### Confirmation

By the end of M3: an import-boundary test fails if a provider SDK is imported
outside its adapter; unit tests drive every typed failure through the fake;
an integration test checks that one trace exists per call and contains no
message text (US-C10); a unit test on prompt assembly checks that no field
added by code holds the contact's number or name (NFR-V7).

## Pros and Cons of the Options

### Own thin interface

- Good, because it is small, testable and provider-neutral.
- Bad, because it is ours to maintain.

### One provider's SDK directly

- Good, because it is the least code and exposes every feature.
- Bad, because tests need the SDK mocked everywhere, and a provider change
  touches every call site.

### Multi-provider framework

- Good, because adapters for many providers already exist.
- Bad, because it brings its own retry, tracing and prompt conventions, which
  overlap or conflict with requirements this project states precisely.
- Bad, because it is a large dependency whose behaviour changes between
  releases.

## More Information

- Which provider gets the first real adapter is ADR 0010.
- Reopen if a second provider's adapter shows the interface cannot express
  something both need.
