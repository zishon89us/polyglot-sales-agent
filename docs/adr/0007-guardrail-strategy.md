---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# Guardrails in code first; no second model at run time

## Context and Problem Statement

The assistant must not state wrong facts, act for the wrong tenant, be talked
out of its rules, or give advice it must not give (US-C4, US-C8, risks R-A1,
R-A2, R-A4). Where are these rules enforced: in the prompt, in code around
the model, or by a second model that judges the first?

This record sets the strategy. The rules themselves are written in the
guardrail policy (issue #44).

## Decision Drivers

- A rule that matters must not depend on the model choosing to follow it.
- NFR-A1: 100% on tool misuse, prompt disclosure and cross-tenant exposure.
- NFR-P2 and NFR-C1: reply time and cost per session.
- Every guardrail must name how it is enforced and how it is tested
  (Gate 3 checklist).
- The design reviews showed that rules stated once in prose drift; rules in
  code and tables do not.

## Considered Options

- Layered: deterministic checks in code wherever a rule can be decided by
  code, the prompt for the rest, and offline evals to measure the rest
- Prompt instructions only
- A second model call that judges every reply before it is sent

## Decision Outcome

Chosen option: "layered, code first", because it makes the most serious rules
independent of model behaviour and adds no latency or cost per reply.

The layers, in the order a message meets them:

1. **Before the model.** Decided entirely by code, as steps 1 to 14 of the
   order of checks in `docs/design/state-machines.md`: signature, tenant
   resolution, opt-out and opt-in, the Confirm button, handover state, rate
   limit, unreadable content, degraded mode. The model is not called for any
   of these.
2. **What the model is given.** Only the tenant's own profile and tools
   scoped to that tenant and contact on the server side. The model never
   supplies a tenant or contact identifier, and never writes SQL or URLs. No
   phone number or contact name is in the prompt. Customer text and
   owner-entered text are delimited as data.
3. **What the model may do.** Every tool validates its arguments against a
   schema and is idempotent. A tool cannot reach another tenant's rows
   because row-level security forbids it (ADR 0003), whatever the model asks.
4. **What the model returns.** Output must match a schema: reply text,
   claims, tool calls, and flags the model sets (asks for a person, asks to
   stop, sensitive topic). Invalid output is a failure, not a reply.
5. **After the model.** Code verifies each claim against the item it names
   (US-C4), applies the handover triggers from the flags and counters, adds
   the disclosure, and applies the message-class checks before sending.
6. **Offline.** Evals measure what code cannot decide: correct language,
   grounding of facts that carry no checked value, refusal of out-of-scope
   advice, recognition of free-text requests, resistance to manipulation.

No second model judges replies at run time in v1.0.

### Consequences

- Good, because the rules with the worst failure (another tenant's data, a
  message to someone who opted out, an invented price) hold even if the model
  is fully manipulated: layers 1, 2, 3 and 5 do not consult it.
- Good, because each deterministic guardrail is an ordinary unit test.
- Good, because no extra model call per reply.
- Bad, because rules that need judgment (is this medical advice? did the
  customer ask to stop, in free text?) rest on the model and are only
  measured, not enforced. A failure there reaches the customer.
- Bad, because the claim check has a known gap, stated in US-C4: the
  assistant confirming a wrong value that the customer supplied. Only evals
  cover it.
- Bad, because the model must reliably produce structured output with honest
  claims. A model that omits a claim for a value it states is caught only
  where the value is an amount, time or date in the text.

### Confirmation

By the end of M3: the guardrail policy lists every rule with its layer and
its test; unit tests cover layers 1, 3, 4 and 5 with the fake client,
including a fake that returns hostile output (another tenant's identifier, a
tool call it was not offered, a price with no claim); the red-team eval set
runs in CI against a real model once a provider is chosen. At Gate 3 the
independent review checks the policy against this record.

## Pros and Cons of the Options

### Layered, code first

- Good, because the serious rules are deterministic and testable.
- Bad, because judgment rules are measured, not enforced.

### Prompt instructions only

- Good, because it is the least work.
- Bad, because every rule then depends on the model obeying under adversarial
  input, which NFR-A1 cannot accept.

### A second model as judge

- Good, because it can catch some judgment failures before they are sent.
- Bad, because it roughly doubles model cost and adds seconds to every reply,
  against NFR-P2 and NFR-C1.
- Bad, because the judge is a model with the same kinds of blind spot, and
  needs its own evals.
- Neutral, because it could be added later for selected high-risk replies
  only, behind the same interface.

## More Information

- Findings #120, #121 and #122 about the claim check are settled in the
  guardrail policy (#44), within this strategy.
- Reopen if evals show a judgment rule failing at a rate the maintainer will
  not accept; a targeted judge for that rule is then the first candidate.
