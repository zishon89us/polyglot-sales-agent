# Risk register

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #5, #61

Likelihood and impact are judgments made before any code or pilot exists, on a
Low / Medium / High scale. Review this register at the end of every milestone;
add, re-score or close risks in a pull request.

Owner is who must act: **Agent** (the AI agent, through the repository) or
**Maintainer** (decisions, accounts, money, legal, customers).

## Product risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-P1 | Owners do not see enough lost sales from slow replies to pay for the product (assumption A1) | Medium | High | Run a pilot that measures reply time and booking rate before and after; do not build beyond v1.0.0 without it | Maintainer |
| R-P2 | Customers distrust or ignore a disclosed automated assistant (A2) | Medium | Medium | Keep handover one message away; measure drop-off after the disclosure message in the pilot | Maintainer |
| R-P3 | Deferred with the `cod-confirm` pack: chat confirmation may not reduce refused cash-on-delivery parcels | Medium | High | Re-assess when v1.1 is planned | Maintainer |
| R-P4 | Owners do not keep prices and hours current, so answers go stale | High | High | Each item shows when it was last updated (US-D2); when data is missing the assistant says so and offers a person (US-C4) | Agent |
| R-P5 | The market already has established shared-inbox and chatbot products | High | Medium | Stay narrow: two jobs finished end to end, any language, grounded answers; do not build a general inbox | Maintainer |
| R-P6 | Channel fees plus model cost leave no margin at a price small businesses accept (A5). The channel has charged for every reply beyond a monthly allowance since 1 October 2026 | High | High | Report model cost and channel fees per session (US-D4, NFR-C1); batch messages (US-C11); cap turns (NFR-C2); read the rate for the market before any pricing | Agent |
| R-P7 | The channel's owner offers its own AI agent with overlapping function (Meta Business Agent) | High | High for a commercial product; Low for this project as positioned | Positioned as a reference implementation, not a competitor (ADR 0001); reopen the decision if revenue from the product becomes a goal | Maintainer |

## Technical risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-T1 | Lost or duplicated messages under retries and restarts | Medium | High | Store-then-queue webhook, dedupe by message ID, idempotent tools; tests for NFR-R1 to R3 | Agent |
| R-T2 | Cross-tenant data leak | Low | High | Tenant scoping in the database layer, not in handlers; automated cross-tenant tests on every table and tool | Agent |
| R-T3 | The mock channel behaves differently from the real API, hiding defects until live testing | High | Medium | Build the mock from current official documentation and dated fixtures; contract tests; one supervised live test before v1.0.0 | Agent, then Maintainer |
| R-T4 | The pack abstraction leaks, so new niches need core changes | Medium | Medium | Build two different packs in the MVP; trial third pack at the end of M5 (NFR-M1) | Agent |
| R-T5 | Overbooking under concurrent requests | Medium | High | The capacity check and the insert happen in one transaction that locks the affected service and time range; tested with concurrent bookings against the free-slot definition in the glossary | Agent |
| R-T6 | Scope too large for one agent-driven project to finish. Version 1.0 has 36 stories after the review fixes | High | High | One pack in v1.0 (ADR 0001); milestones with exit criteria; walking skeleton first; non-goals enforced; review scope again at the end of M2 | Maintainer |
| R-T7 | The model provider is unavailable or slow | Medium | High | Degraded mode with bounded retries, one notification and automatic recovery (US-C15); reminders do not depend on the model | Agent |
| R-T8 | The channel's daily limit on business-initiated recipients is reached, so reminders are late or unsent | Medium | Medium | Queue until capacity returns, withhold and list what would be too late (US-C9, US-D12) | Agent |
| R-T9 | A template is paused, rejected or moved to another category by the channel | Medium | Medium | Track template status, withhold affected messages and tell the owner (US-C16); keep template wording free of promotional content | Agent |

## AI-specific risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-A1 | The assistant states a wrong price, time or policy | Medium | High | Retrieval plus output guardrail that blocks values not found in tenant data; deterministic grader (NFR-A2) | Agent |
| R-A2 | Prompt injection causes data exposure or an unintended tool call | Medium | High | Treat customer text as data; server-side tenant scoping and schema validation on every tool; red-team eval set at 100% on tool misuse | Agent |
| R-A3 | Quality is uneven across languages, worst in low-resource, mixed or transliterated input | High | Medium | Eval coverage per language with scores and dataset sizes published (NFR-A4, NFR-A6); nothing is claimed for unsupported languages (US-C3); repeated guardrail failure hands over (US-C6) | Agent |
| R-A4 | The assistant gives medical, legal or financial advice | Medium | High | Written guardrail policy; refusal eval cases per pack and language; handover | Agent |
| R-A5 | A model or provider update silently changes behaviour | High | Medium | Pin the model version in config; full eval run and new baseline on any change; provider behind an interface | Agent |
| R-A6 | Evals are too small or too easy, giving false confidence | Medium | High | Every defect becomes an eval case; validate any model-based grader against hand labels; report dataset size beside every score | Agent |
| R-A7 | Model cost or latency exceeds targets | Medium | Medium | Trace every call; token budgets and turn caps; compare candidate models on cost and score in an ADR | Agent |
| R-A8 | The development agent itself introduces plausible but wrong code or documentation | Medium | High | Tests and evals before merge, CI gates, maintainer review of every pull request, no unverified claims about external rules | Agent and Maintainer |

## Compliance and legal risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-C1 | Breaking the channel's messaging or template policy gets a business's number restricted | Medium | High | Verify rules from official sources in M1; enforce window and template rules in the channel adapter; opt-out respected | Agent |
| R-C2 | Data-protection law in a target market is not met | Medium | High | Engineering summary in `docs/compliance.md`; consent, retention, export and deletion built in; legal advice before a paying customer | Maintainer |
| R-C3 | Customer messages are sent to a model provider under terms that do not fit a tenant's obligations, or are used for training against the channel's terms | Medium | High | No phone number or name in prompts (NFR-V7); provider terms that exclude training recorded in an ADR (NFR-V6); provider and region chosen by the maintainer (OQ-9) | Maintainer |
| R-C4 | Trademark problems from using the channel's brand in the product name or marketing | Low | Medium | Product name avoids the brand; check current brand guidelines before any public launch | Maintainer |
| R-C5 | A booking pack for clinics is treated as handling health data | Medium | High | A booking holds only contact, service, time and status, with no free-text field (US-B2); clinical advice is refused (US-C8). Customers may still write health details in messages; each message is deleted when it is older than the retention period, even for a returning customer (NFR-V4). Raise with a lawyer before a clinic pilot (OQ-3, OQ-4) | Maintainer |
| R-C6 | The channel's "AI Providers" clause is held to cover this product | Low | High | Read as not applying (`docs/compliance.md`, finding 3); confirm before any live number is connected (OQ-1) | Maintainer |
| R-C7 | The channel restricts or disables a tenant's account for policy or quality reasons | Low | High | Consent before business-initiated messages (US-C13); opt-out by keyword and button (US-C7); utility-only templates (US-C16); handover paths required by policy (US-C6) | Agent |

## Delivery and operational risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-D1 | Channel business verification is slow or refused, blocking live testing | Medium | Medium | Start it early (issue #7); everything else runs on the mock | Maintainer |
| R-D2 | A secret or real personal data is committed | Low | High | Secret scanning in CI, `.env.example` only, synthetic fixtures, review checklist | Agent |
| R-D3 | No one is watching production when something breaks | High | Medium | Alerts as code, runbooks, dead-letter alerting; decide on-call expectations before a pilot | Maintainer |
| R-D4 | The single maintainer is unavailable and pull requests queue up | Medium | Medium | Small pull requests; `docs/STATUS.md` kept current so work can resume; agree which categories the agent may merge | Maintainer |
| R-D5 | The repository's history overstates what was built or tested | Low | High | Honest-history rules in `AGENTS.md`; no fabricated results; README states how the project was built | Agent |
| R-D6 | The product is never tried by a real business, so its assumptions are never tested and defects only a live channel would show are never found | High | Medium | Stated plainly in the README and system card (NFR-L2); the mock channel is built from dated official documentation with contract tests (R-T3) | Maintainer |

## Top risks to watch first

R-A1 (wrong facts), R-T2 (tenant leak), R-A2 (injection) and R-C7 (account
restriction) could each harm a real customer or business, so they shape the
design in M1. R-T6 (scope) is the risk most likely to stop the project being
finished. R-P1, R-P7 and R-D6 concern whether the product would succeed
commercially, which this project, as positioned in ADR 0001, does not set out
to prove.
