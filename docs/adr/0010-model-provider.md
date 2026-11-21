---
status: "working choice by the maintainer, to be confirmed by measurement"
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

Not decided when this was written. **Since 2026-11-21 there is a working
choice: see the amendment at the end.**

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

## Amendment, 2026-11-21: a working choice

The maintainer's words on 2026-11-21: Amazon Bedrock "likely", with a Claude
model behind it "likely", in the AWS region `us-east-1`. This is the option
"choose one provider now, measure later", taken as a working choice: M3 is
planned and built for it, and it is confirmed or changed by the first eval
run. Nothing is paid for until the maintainer supplies credentials.

What follows from it, as decided by the agent and open to the maintainer:

- **The first real adapter behind `LlmClient` (ADR 0005) is for Bedrock.**
  Development and CI stay on the fake client. The production guard gains
  its check for the fake client in the same unit (#165).
- **Which Claude model is not chosen.** Two or three of the models Bedrock
  offers are to be run on the same eval set, and the results recorded here
  as the recommendation above lists. The model's identifier is a setting.
- **The region and the inference profile are settings.** The default is
  `us-east-1` with a profile that keeps processing inside the United
  States, not the global one.

What was read, on 2026-11-21, from AWS's own pages. Each is AWS's statement
about its service, not something the project has checked:

| Point | Source |
| --- | --- |
| Bedrock has two kinds of cross-region inference profile: geographic, which routes within one geography such as the US, and global, which routes to supported commercial regions worldwide | <https://aws.amazon.com/blogs/machine-learning/global-cross-region-inference-for-latest-anthropic-claude-opus-sonnet-and-haiku-models-on-amazon-bedrock-in-thailand-malaysia-singapore-indonesia-and-taiwan> |
| The global kind is described as for use when there are no data-residency constraints. The agent's paraphrase: the page was read as a search result of its Japanese-language address, and the English page was not opened | <https://docs.aws.amazon.com/jp_jp/bedrock/latest/userguide/models-region-compatibility.html> |
| A US geographic profile needs access to more than one US region: for Claude Sonnet 4.5, `us-east-1`, `us-east-2` and `us-west-2` | <https://aws.amazon.com/blogs/machine-learning/securing-amazon-bedrock-cross-region-inference-geographic-and-global/> |
| Bedrock says it does not store or log prompts and completions, does not use them to train AWS models, and does not distribute them to third parties; model providers have no access to the accounts the models run in | <https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html> |
| Bedrock's data-retention page says requests have a retention mode, that the default is the model's own policy, and that there is "no data retention change to Claude models released before Claude Fable 5". An AWS security post says some newer models require data sharing with the provider, and that choosing models that fit one's obligations is the customer's responsibility | <https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html>, <https://aws.amazon.com/blogs/security/enforce-zero-data-retention-on-amazon-bedrock-with-bedrock-projects-and-service-control-policies/> |

The agent's reading of the last row: **retention is not the same for every
model.** So, for this product, whose channel forbids conversation data
being used to train models (`docs/compliance.md`, finding 4; NFR-V6):

- **A candidate model is admitted to the comparison only if its retention
  on Bedrock is none and nothing is shared with its provider.** That is
  read from AWS's page for the model on the day, and recorded here with
  the date.
- The retention mode is set explicitly in the adapter where the service
  allows, not left to a default.

Not read, and needed before the choice is final: which Claude models are
offered in `us-east-1` and with which profiles; their prices; the service
terms and the model's end-user licence; the quotas of a new account. The
agent could not open the model list on the day. Until the terms and the
licence are read and linked here, **NFR-V6 is not met**: it asks for terms,
recorded in an ADR, that exclude training, and a page of documentation is
not terms. The training row above is also about AWS's own models only.

What `us-east-1` means for real customers: processing in the United States
is, for a business in Saudi Arabia, a transfer of personal data outside the
Kingdom (`docs/compliance.md`, Part B). By that document's reading, which
it marks as inference awaiting a lawyer, it needs a permitted purpose, the
minimum of data, and an adequacy decision or standard contractual clauses.
None of that arises while only synthetic conversations are used, which is
all that development, CI and the evals use. It is a question for a lawyer
before any real customer's message is sent, and the reason the region is a
setting.

