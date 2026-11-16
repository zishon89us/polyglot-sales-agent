---
status: "proposed; needs the maintainer"
date: 2026-11-16
decision-makers: "the maintainer"
---

# Model provider

## Context and Problem Statement

Milestone M3 needs a real language model to run evals and set thresholds
(open questions OQ-6, OQ-7, OQ-9). Which provider and model get the first
real adapter behind `LlmClient` (ADR 0005)? This needs an account, an API key
and a spending limit, so only the maintainer can decide (`AGENTS.md`,
section 2; issue #7).

Milestone M2, and the plumbing of M3, run on the fake client and do not
depend on the answer. The eval harness can be built and tested with the fake;
only its scores against a real model wait.

## Decision Drivers

- Quality in the supported languages, including Arabic, Urdu and Hindi, and
  on mixed and transliterated input (NFR-A4, risk R-A3).
- Reliable structured output and tool calling (ADR 0007, layer 4).
- Cost per session (NFR-C1, NFR-C3) and reply time (NFR-P2).
- Terms that exclude training on submitted data. The channel's terms forbid
  conversation data being used to train models
  (`docs/compliance.md`, finding 4; NFR-V6).
- Where the provider processes data, if real customer data is ever used
  (`docs/compliance.md`, Part B).
- A stable, pinned model version (risk R-A5).

## Considered Options

No provider's current models, prices or terms have been checked, so none is
named here. The candidates are whichever providers the maintainer can open an
account with. The choice between them is made by measurement, not by
reputation:

- Run the same eval set against two or three candidate models
- Choose one provider now, on the maintainer's preference, and measure later

## Decision Outcome

Not decided.

The agent's recommendation: **measure before choosing**. When the eval
harness and first dataset exist in M3, run them against two or three
candidate models the maintainer has keys for, and record in this ADR, for
each: the score per language and dimension with dataset sizes, cost per
session from the traces, reply-time percentiles, and the provider's terms on
training and data location with links and the date read. Then choose.

Until then the project runs on the fake client.

### Consequences

To be written when decided. One is known already: thresholds in the eval plan
(OQ-6) are set from the chosen model's baseline, so they cannot exist before
this decision.

### Confirmation

To be written when decided. At minimum: the model name and version are in
configuration, not code; the provider's terms are linked here with the date
read; the full eval report for the chosen model is stored in the repository.

## Pros and Cons of the Options

### Measure two or three candidates

- Good, because the choice rests on this product's own tasks and languages.
- Good, because the comparison is itself evidence of an AI development
  lifecycle.
- Bad, because it needs more than one account and costs more in eval runs.

### Choose now, measure later

- Good, because M3 can begin real evals as soon as one key exists.
- Bad, because the choice is then a guess, and thresholds set from one
  model's baseline hide whether another would have done better.

## More Information

- Needs from the maintainer: one or more provider accounts, API keys stored
  as repository secrets, and a monthly spending limit on each.
- The agent must not create accounts or enter payment details.
- No real customer conversation may be sent to any provider during this
  comparison; the eval dataset is synthetic (NFR-V5, NFR-V6).

## Note, 2026-11-16 (Gate 2 finding A30)

Candidates are compared on the **development** set of the eval plan, not the
held-out set, so that the held-out set is not used both to choose the model
and to set its thresholds. Prompts written while working with one candidate
favour it; the comparison report must say which candidate the prompts were
written against.
