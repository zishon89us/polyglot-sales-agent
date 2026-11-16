# Status

Living progress log. The agent updates this at the end of every session.

## Current milestone: M1 Design

Exit criteria: design documents merged; open questions listed for the
maintainer. Issues #37–#44, plus #58 and #61 for the requirements gate.

M0 Inception met its exit criteria on 2026-11-16; see
[`retros/m0-inception.md`](retros/m0-inception.md).

## Done

- 2026-11-16 — Repository bootstrapped on `main` with README, MIT licence and
  `.gitignore` (single direct commit, because an empty repository has no
  branch to open a pull request against).
- 2026-11-16 — Labels (phase, area, priority, `needs-human`), the M0
  milestone and issues #1–#7 created.
- 2026-11-16 — Working agreement and repository scaffold opened as a pull
  request for #1; merged by the maintainer as #8.
- 2026-11-16 — Product vision and personas merged by the maintainer as #9.
- 2026-11-16 — Milestones M1–M6 created. 23 MVP user stories written, each
  opened as its own issue (#10–#32) and assigned to its milestone;
  traceability table started. Merged by the maintainer as #33.
- 2026-11-16 — Branch ruleset for `main` set to active by the maintainer.
- 2026-11-16 — Non-functional requirements and risk register merged by the
  maintainer as #34 and #35.
- 2026-11-16 — M1 issues #37–#44 opened. M0 retro merged as #45.
- 2026-11-16 — Author's own requirements review merged as #56: 12 findings,
  9 stories added (32 in total, issues #47–#55), glossary added.
- 2026-11-16 — Named standards and independent phase-gate review adopted,
  with checklists; merged as #60.
- 2026-11-16 — First independent review of the requirements: 44 findings, 9
  High, all accepted. Merged as #62.
- 2026-11-16 — Channel rules and data-protection obligations researched from
  official sources (#37); pull request #63.
- 2026-11-16 — Positioning and v1.0 scope decided (ADR 0001). Requirements
  rewritten to fix the review findings; story issues synced; opened as pull
  request #72 for #61.
- 2026-11-16 — Second independent review (52 findings, 8 High), two narrow
  verification reviews, and their fixes, all in pull request #72. Gate 1
  passed with 62 Medium and Low findings tracked as issues.
- 2026-11-16 — Pull request #72 merged by the maintainer. Design started
  with `design/state-machines.md` (#126): transition tables for eight
  machines and one order of checks for inbound messages. Thirteen decisions
  were made there and applied to the requirements; it resolves #118, #119,
  #123 and #124.
- 2026-11-16 — Independent verification of the state machines: 33 findings,
  4 High. All four fixed. The handover machine now has an executable model
  that explores event sequences and asserts its invariants. 27 findings
  tracked as issues #128 to #147. Version 1.0 now has 219 acceptance
  criteria.
- 2026-11-16 — Second verification of the state machines: no High defect
  open. It also showed that the document overstated the handover model,
  which checks invariant H2 only; corrected. Remaining findings tracked as
  #148 to #150.
- 2026-11-16 — Pull request #127 merged by the maintainer. First decision
  records written in MADR 4.0.0 form (#38): seven decided, two proposed for
  the maintainer (hosting, model provider). ADR 0004 replaces Redis with a
  jobs table in PostgreSQL; `AGENTS.md` section 3 updated to match.
- 2026-11-16 — ADRs merged as #151. Architecture document written against
  the arc42 section list (#39): context, containers, packages, the pack
  interface, three runtime flows and how the four highest risks are met.
- 2026-11-16 — Architecture merged as #152. Data model written (#40): every
  table with its tenant scoping, the constraints that carry invariants, and
  a personal-data inventory with retention and deletion behaviour. One
  open handover per contact is now a database constraint.

## Next

1. Maintainer reviews and merges the data model (#40).
2. Threat model (#42), eval plan (#43), guardrail policy (#44) and API
   (#41). The output-check findings #120 to
   #122 are settled in the guardrail policy.
3. Open review findings are checked against the state machines and ADRs as
   design reaches each story.
4. Gate 2: independent review of all design documents together.

## Gate status

**Gate 1 (requirements) is passed, on the route agreed with the maintainer**
(`AGENTS.md` section 11): no High finding is open; Medium and Low findings
are tracked as issues.

| Review | Scope | High findings |
| --- | --- | --- |
| First independent review | Whole set | 9 |
| Second independent review | Whole set, after fixes | 8 |
| Verification | The 8 fixes | 2 new |
| Second verification | The 2 fixes and 3 related | 0 |

62 Medium and Low findings remain open. The last verdict rests on one
judgment call: the verifier rated #118 Medium and called it the closest to
High. Reports and responses are in `reviews/`. No human has yet reviewed the
requirements in detail.

## Scope

Decided on 2026-11-16 (`adr/0001-positioning-and-v1-scope.md`): the project
is a portfolio and reference implementation. Version 1.0 is the core engine,
the dashboard and the `booking` pack, with 36 stories and 219 acceptance
criteria, run against a mock channel. The `cod-confirm` pack is deferred to
v1.1.

## Blocked on the maintainer

- Open questions with the maintainer as owner, in
  `requirements/open-questions.md`. None blocks v1.0 on the mock channel
  except OQ-9 (model provider) before M3 and OQ-11 (merge style) before M2.
- #6 Project board and private vulnerability reporting.
- #7 Copyright holder name, commit identity, and the accounts needed only
  for live use.

## Not done yet

- GitHub project board (Backlog, Ready, In progress, In review, Done). The
  agent's session cannot create GitHub Projects; tracked in #6's follow-up
  comment for the maintainer.
- `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `Makefile` — arrive with the tooling
  in M2, when there is something for them to describe.

## Open questions

None yet.
