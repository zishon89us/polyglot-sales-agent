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

## Amendment, 2026-11-16 (Gate 2 findings S19, A23, A43)

- **A second operation.** The interface has two operations, not one: the
  call that produces a reply, and `health()`, a minimal request that tells
  whether the provider is reachable. The provider state machine needs it
  (state machines section 8). It is run by one worker at a time, under a
  lease, so that several workers do not repeat it.
- **Flags.** The structured result carries the flags listed in the guardrail
  policy, section 11.
- **Retries.** The adapter makes one attempt and never retries. The three
  attempts and the waits between them belong to the caller, which is the
  turn-processing code; where this record calls them "parameters of the
  interface" it means parameters the caller passes for the timeout only.
- Not settled here: the model call that labels a session as an inquiry when
  it ends (US-C19), its failure behaviour and its cost. Tracked as a
  `review-finding` issue from S19.

## Amendment, 2026-11-23 (M3 unit U4; design note `docs/design/notes/m3-u4-llm-client.md`)

Proposed by the agent with the code.

- **An adapter and a client are two types.** A provider's adapter returns
  what the provider said, unchecked, or a typed failure. One function,
  `bounded`, makes a client of an adapter: it keeps the time and checks
  the answer against the structure. The rest of the code takes a client,
  so the bound and the check cannot be left out. "A wrapper around every
  adapter writes the trace" still holds; it goes outside this one.
- **The request carries the assembled text,** with the names and versions
  of the prompts it was made from, not "a prompt name and version": the
  adapter does not read files.
- **What an adapter throws is thrown on.** Only a typed `timeout` or
  `provider-error` counts as the provider's failing. An exception is a
  fault in this repository's code and fails the job; it is not retried
  as a provider failure and not counted towards degraded mode.
- **An answer cut at the output limit** is `invalid-output` with the code
  `truncated`, whatever the cut text looks like.
- **Failures carry a code from a fixed list** and never the model's text
  or the provider's message.
- **The structure has four parts:** reply, claims, flags, tool calls. An
  answer asks for tools or replies, not both. The seven flags and the
  core's four claim kinds are named in `packages/core/src/names.ts`.
- **Confirmation, as built in U4:** the import-boundary test is a list of
  known providers' packages; a library it does not know, or a plain HTTP
  call, passes. Each typed failure is driven through the scripted
  adapter. The trace and prompt-assembly tests are U6's and U7's.
