# Open questions

Status: opened 2026-11-16 · Phase 1 (requirements) · Issue #61

Everything in the requirements that is not yet decided or not yet knowable is
listed here, so that it sits inside the reviewed set. A requirement that
depends on one of these is marked "not yet testable" where it appears.

An entry is closed by a pull request that removes it from this file and
updates the documents that referred to it.

## Open

| ID | Question | Why it is open | Owner | Decided by | Blocks |
| --- | --- | --- | --- | --- | --- |
| OQ-1 | Does Meta's "AI Providers" clause reach a product like this one? | The clause leaves the decision to Meta. The reading in `docs/compliance.md` (finding 3) is the agent's inference. | Maintainer | Before any live WhatsApp number is connected | Live use only. Nothing in v1.0, which runs against a mock channel. |
| OQ-2 | Whose Meta account does a tenant use? | Version 1.0 assumes each tenant brings its own WhatsApp Business account and the operator helps with setup. The alternative needs Meta's app review. | Maintainer | Before a pilot | Live use only. US-D6 and US-C16 are written for tenant-owned accounts. |
| OQ-3 | Does the WhatsApp Business Messaging Policy restrict health-related businesses such as clinics? | The full policy could not be opened during the research for `docs/compliance.md`. | Agent to read; maintainer to decide | Before the `booking` pack is offered to a real clinic | Live use by a clinic. The persona example may need to change. |
| OQ-4 | Are the eight questions for a lawyer in `docs/compliance.md` answered? | They need a lawyer. | Maintainer | Before any real customer data is processed | Live use only. US-D5's deletion rules are the agent's proposal until then. |
| OQ-5 | Which topics always hand over to a person? | The dated topic list belongs in the guardrail policy, a design document. | Agent | Milestone M1, issue #44 | Testing US-C6 criterion 3. |
| OQ-6 | Which languages are supported, and what are the pass thresholds for each eval dimension? | Thresholds must come from a baseline measured on a real dataset. Choosing numbers now would be guessing. | Agent | Milestone M1 for the plan (issue #43); milestone M3 for the numbers | Testing US-C4 criterion 5 and US-C19 criterion 4; NFR-A3; the v1.0 success criterion on eval thresholds. |
| OQ-7 | What is the daily token budget per tenant, and the target model cost per session? | Needs measured cost per session and the provider's current prices. | Agent | Milestone M3 | The `limit` handover in US-C6 for the budget case; NFR-C2 and NFR-C3. The turn cap, which is set, is unaffected. |
| OQ-8 | What is the coverage floor for unit and integration tests? | Set when there is code to measure. | Agent | Milestone M2, in `docs/test-plan.md` | NFR-M3. |
| OQ-9 | Which model provider and which hosting region? | Cost, accounts, and the data-transfer rules in `docs/compliance.md` Part B. | Maintainer | Before milestone M3 for the provider; before any deployment for hosting | Issue #7. Milestones M2 and M3 run on a fake model client and local containers. |
| OQ-10 | Are the proposed setting defaults and fixed values right? | They are the agent's proposals with no data behind them. | Maintainer, from a pilot | No deadline | Nothing. They are testable as written. |
| OQ-11 | Squash merge or merge commits? | `AGENTS.md` says squash; every pull request so far was merged with a merge commit. | Maintainer | Before milestone M2 | Nothing. |

## Standards not yet read from source

`AGENTS.md` section 11 requires a standard to be read in its current
published form before it is first applied. As of 2026-11-16:

| Standard | State |
| --- | --- |
| EARS | Not read from the author's own publication. Read only through secondary descriptions, which agree on five patterns: ubiquitous, event-driven, state-driven, optional feature and unwanted behaviour. The stories use Given/When/Then, which carries the same trigger, precondition and response; they are not written in EARS syntax. |
| ISO/IEC/IEEE 29148 | Not read. It is a paid standard and was not available to the agent. The Gate 1 checklist uses quality characteristics commonly attributed to it (necessary, unambiguous, singular, verifiable, feasible, complete, consistent). **The repository must not say the requirements were reviewed against ISO/IEC/IEEE 29148**; it may say they were reviewed against the checklist in `docs/process/review-checklists.md`. |

## Decided on 2026-11-16

Recorded in `docs/adr/0001-positioning-and-v1-scope.md`.

| Decision | Outcome |
| --- | --- |
| Positioning | A portfolio and reference implementation, not a commercial competitor to Meta Business Agent. |
| Scope of v1.0 | Core engine, dashboard and the `booking` pack. `cod-confirm` is deferred to v1.1. |
| Owner accounts | By invitation only. |
| When a handover ends | When staff hand back, or when the session ends. |
| What deletion does | Defined per data type in US-D5; a hashed opt-out record is kept. |
| Booking capacity | A whole number per service and time slot. |
| Packs per tenant | Exactly one. |
| Translation and dashboard language | None, and English, in v1.0. |
| Template languages at launch | Arabic and English. |
| Quiet hours | 22:00 to 08:00 by default, configurable. |
| Gate 1 after the second review | The eight High findings are fixed and verified by a narrow review; Medium and Low findings become tracked issues, fixed when design or build reaches the story. Agreed by the maintainer on 2026-11-16. |
