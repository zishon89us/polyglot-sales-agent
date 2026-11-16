# Risk register

Status: draft for maintainer review · Phase 1 (requirements) · Issue #5

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
| R-P3 | Chat confirmation does not reduce refused cash-on-delivery parcels (A3) | Medium | High | Pilot with one store; compare refused-delivery rate before and after | Maintainer |
| R-P4 | Owners do not keep prices and hours current, so answers go stale | High | High | Make the editor fast on a phone; show "last updated" dates; assistant hands over when data is missing | Agent |
| R-P5 | The market already has established shared-inbox and chatbot products | High | Medium | Stay narrow: two jobs finished end to end, any language, grounded answers; do not build a general inbox | Maintainer |
| R-P6 | Channel fees plus model cost leave no margin at a price small businesses accept (A5) | Medium | High | Measure cost per conversation from traces in M3; verify current channel pricing in M1; cap turns and tokens | Agent |

## Technical risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-T1 | Lost or duplicated messages under retries and restarts | Medium | High | Store-then-queue webhook, dedupe by message ID, idempotent tools; tests for NFR-R1 to R3 | Agent |
| R-T2 | Cross-tenant data leak | Low | High | Tenant scoping in the database layer, not in handlers; automated cross-tenant tests on every table and tool | Agent |
| R-T3 | The mock channel behaves differently from the real API, hiding defects until live testing | High | Medium | Build the mock from current official documentation and dated fixtures; contract tests; one supervised live test before v1.0.0 | Agent, then Maintainer |
| R-T4 | The pack abstraction leaks, so new niches need core changes | Medium | Medium | Build two different packs in the MVP; trial third pack at the end of M5 (NFR-M1) | Agent |
| R-T5 | Double bookings under concurrent requests | Medium | High | Database-level uniqueness on slot; test with concurrent bookings | Agent |
| R-T6 | Scope too large for one agent-driven project to finish | Medium | High | Milestones with exit criteria; walking skeleton first; non-goals enforced; dashboard kept minimal | Maintainer |

## AI-specific risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-A1 | The assistant states a wrong price, time or policy | Medium | High | Retrieval plus output guardrail that blocks values not found in tenant data; deterministic grader (NFR-A2) | Agent |
| R-A2 | Prompt injection causes data exposure or an unintended tool call | Medium | High | Treat customer text as data; server-side tenant scoping and schema validation on every tool; red-team eval set at 100% on tool misuse | Agent |
| R-A3 | Quality is uneven across languages, worst in low-resource, mixed or transliterated input | High | Medium | Eval coverage per language with scores published in the system card; hand over on low confidence | Agent |
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
| R-C3 | Customer messages are sent to a model provider under terms that do not fit a tenant's obligations | Medium | High | Document what is sent and under which terms; make the provider a configuration choice; minimise data in prompts | Maintainer |
| R-C4 | Trademark problems from using the channel's brand in the product name or marketing | Low | Medium | Product name avoids the brand; check current brand guidelines before any public launch | Maintainer |
| R-C5 | A booking pack for clinics is treated as handling health data | Medium | High | Store appointment and service type only, no clinical notes; no clinical advice; raise with a lawyer before a clinic pilot | Maintainer |

## Delivery and operational risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-D1 | Channel business verification is slow or refused, blocking live testing | Medium | Medium | Start it early (issue #7); everything else runs on the mock | Maintainer |
| R-D2 | A secret or real personal data is committed | Low | High | Secret scanning in CI, `.env.example` only, synthetic fixtures, review checklist | Agent |
| R-D3 | No one is watching production when something breaks | High | Medium | Alerts as code, runbooks, dead-letter alerting; decide on-call expectations before a pilot | Maintainer |
| R-D4 | The single maintainer is unavailable and pull requests queue up | Medium | Medium | Small pull requests; `docs/STATUS.md` kept current so work can resume; agree which categories the agent may merge | Maintainer |
| R-D5 | The repository's history overstates what was built or tested | Low | High | Honest-history rules in `AGENTS.md`; no fabricated results; README states how the project was built | Agent |

## Top risks to watch first

R-A1 (wrong facts), R-T2 (tenant leak), R-A2 (injection) and R-C1 (channel
policy) could each harm a real customer or business, so they shape the design
in M1. R-P1 and R-P3 decide whether the product is worth continuing after
v1.0.0, and only a pilot can settle them.
