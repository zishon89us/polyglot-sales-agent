# ADR 0001: Positioning and scope of v1.0

- Status: accepted
- Date: 2026-11-16
- Deciders: the maintainer, on the agent's recommendation
- Issue: #61

## Context

Three things became known on 2026-11-16, after the first requirements were
written.

1. **An independent review** of the requirements found 44 defects, 9 of them
   High (`docs/reviews/2026-11-16-gate1-requirements.md`). Two of the High
   findings concerned only the cash-on-delivery pack, and a third fell mostly
   on it. Fixing everything properly was estimated to add 8 to 10 stories to
   the 32 that existed.
2. **The channel's owner sells a competing product.** Meta Business Agent
   answers from a business's knowledge, books appointments through connected
   systems and hands off to people (`docs/compliance.md`, finding 2).
3. **Replies are no longer free.** Since 1 October 2026 the channel charges
   per message for ordinary replies beyond a monthly allowance
   (`docs/compliance.md`, finding 1).

The project is built by one maintainer directing an AI agent. Its stated
purpose from the start (`AGENTS.md`, section 1) was twofold: a working product
and a public demonstration of a complete development lifecycle.

## Decision drivers

- The maintainer's primary goal is a repository that shows careful
  engineering, not revenue from this product.
- One maintainer cannot give legal sign-off, run a pilot and support
  customers while also competing with the platform owner.
- A smaller scope that is finished and verified demonstrates more than a
  larger one that is not.
- The pack mechanism still needs a second pack to prove that a new use case
  needs no core change.

## Options considered

### Positioning

1. **Build on Meta Business Agent.** The product becomes configuration,
   evaluation and a dashboard on top of Meta's agent.
2. **Compete with it** on control, grounded answers, other channels and data
   location.
3. **Treat the project as a portfolio and reference implementation.**

### Scope of v1.0

- A. Core, dashboard and both packs, as first planned.
- B. Core, dashboard and the `booking` pack; `cod-confirm` in v1.1.

## Decision

**Positioning: option 3. Scope: option B.**

Version 1.0 is the core engine, the dashboard and the `booking` pack, running
end to end against a mock of the channel. Connecting a live number is
supported by the design and remains an optional step for the maintainer.

The decisions the independent review's fixes depended on are settled as
follows, each on the agent's recommendation and accepted by the maintainer:

| Question | Decision |
| --- | --- |
| How owner accounts are created | By invitation only; no open sign-up |
| When a handover ends | When staff hand back, or when the session ends |
| What a provider outage does | A degraded mode with one notification, not one handover per conversation |
| What deletion does | Per data type, as specified in US-D5; a hashed opt-out record is kept |
| Booking capacity | A whole number per service and time slot; no staff or room scheduling |
| Packs per tenant | Exactly one |
| Translation for staff; dashboard language | None; English |
| Template languages at launch | Arabic and English |
| Whose channel account a tenant uses | Its own, with the operator's help at setup |
| Quiet hours | On by default, configurable |

## Consequences

**Good**

- The serious findings that concerned only `cod-confirm` leave v1.0. They are
  not fixed; they are recorded against the deferred stories.
- No Meta business verification, live number, per-message fee or legal
  opinion is needed to finish v1.0.
- The work a reviewer would want to inspect (grounding, guardrails, evals,
  tenant isolation, handover) is all built in the open, not delegated to a
  hosted agent.

**Bad**

- The product is not validated with real customers. Every business assumption
  in `vision.md` stays an assumption.
- A mock channel can differ from the real one (risk R-T3). Defects that only
  the live channel would reveal will not be found.
- Option 1 might have produced something businesses could use sooner. It was
  rejected because it hides the engineering this project exists to show, and
  because its availability depends on Meta's per-country eligibility rules,
  which were not checked for the target market.
- Legal questions are recorded as limits, not answered. The repository must
  say plainly that it is not ready to process real customer data.

**Neutral**

- With only one product pack, pack independence is proven by a trivial second
  pack, `faq-only`, added at the end of milestone M5 (NFR-M1).
- The `cod-confirm` stories keep their issues under a v1.1 milestone.

## What would reopen this decision

- A business asks to pilot the product. Open questions OQ-1 to OQ-4 must be
  answered first.
- The maintainer decides to pursue revenue from the product itself. Options 1
  and 2 should then be compared again with current information.
