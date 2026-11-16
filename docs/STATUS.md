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

## Next

1. Second independent review of the fixed requirements (running).
2. Answer its findings. Gate 1 passes only when no High finding is open.
3. Then the M1 design issues #38 to #44, starting with the ADRs.

## Gate status

**Gate 1 (requirements) is not passed.** The first independent review found
44 defects, 9 High. The fixes are in pull request #72: 34 fixed, 6 fixed in
part, 4 not fixed because they belong to the deferred `cod-confirm` pack. A
second independent review is checking the fixed set. The M1 design issues
#38 to #44 stay blocked until it has no open High finding.

## Scope

Decided on 2026-11-16 (`adr/0001-positioning-and-v1-scope.md`): the project
is a portfolio and reference implementation. Version 1.0 is the core engine,
the dashboard and the `booking` pack, with 36 stories and 171 acceptance
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
