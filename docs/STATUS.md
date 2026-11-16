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
- 2026-11-16 — Data model merged as #153. Threat model written (#42): 58
  threats over nine data flows under the STRIDE headings, with the
  AI-specific ones mapped to the titles of the OWASP Top 10 for LLM
  Applications 2026. Thirteen gaps with no requirement behind them were
  opened as issues #154 to #166, labelled `security`.
- 2026-11-16 — Threat model merged as #167. Eval plan written (#43): 15
  dimensions, the red-team set, dataset rules with a held-out set, graders,
  and how thresholds are set from a baseline the maintainer accepts. No eval
  has been run and no score exists. Six languages proposed (#168).
- 2026-11-16 — Guardrail policy written (#44): 16 rules, with the checks
  before and after the model, the handover topics and the fixed texts, each
  naming how it is enforced and tested. It settles findings #120, #121 and
  #122, the reply-content rule #159 and open question OQ-5, and changes
  US-C4 and US-C6; version 1.0 now has 222 acceptance criteria.
- 2026-11-16 — Eval plan and guardrail policy merged as #169 and #170. API
  written (#41): `docs/design/api.md` and `docs/design/openapi.yaml`, with
  43 paths and 55 operations. **No linter has been run on the OpenAPI file**;
  the session was not permitted to download one. A structural check script
  passes. Issue #41 stays open until a linter passes.
- 2026-11-16 — API merged as #171. Pull request #172, from another session,
  added `redocly.yaml` and reports a clean lint of the OpenAPI file. This
  session has not repeated that run. `api.md` now says so, and #41 is closed
  on that basis.
- 2026-11-16 — Keyed hash for suppressed phone numbers defined in the data
  model (#160); the threat model's list of open threats updated.
- 2026-11-16 — ADR 0011 written (#161): the operator works through commands
  run on the server, each recorded in an insert-only log. Whether one tenant
  can be paused is open question OQ-12, for the maintainer.
- 2026-11-16 — Lint status, keyed hash and ADR 0011 merged as #173 to #175.
  Gate 2 review run by two separate agents. Structure review: 44 findings,
  7 High. Threats and AI review: 50 findings, 13 High. Both reports are
  committed unedited in `docs/reviews/`. **Gate 2 is not passed.** No
  finding has been answered or fixed yet.
- 2026-11-16 — Gate 2 findings answered. The maintainer chose to move
  booking out of the core (ADR 0012) and to record channel statements as
  assumptions. All 20 High findings were fixed or answered by withdrawing a
  false claim. A first verification found 14 resolved, 6 partly, and 3 new
  High findings in the fixes; a second found no High finding open. Version
  1.0 has 224 acceptance criteria; the API has 44 paths and 57 operations.
  The regenerated OpenAPI file passes the structural check and has not been
  re-linted.
- 2026-11-17 — Gate 2 pull request merged as #254. README rewritten (#255)
  to say what the product is for, for whom, and that no code exists yet.
- 2026-11-17 — README merged as #256. M1 retro written (#257), with three
  items added to the Gate 2 checklist.
- 2026-11-17 — Retro and README fix merged as #258 and #260. AWS AI-DLC
  evaluated (#59) in ADR 0013: borrow four practices, install nothing.
- 2026-11-17 — M2 planned: ten units of work, issues #262 to #271, in
  `docs/plans/m2-walking-skeleton.md`. Open review findings sorted into the
  milestone that builds their subject. `AGENTS.md` gains the unit loop and
  the halt rule.
- 2026-11-17 — ADR 0013 and the M2 plan merged as #261 and #273. **First
  code.** M2 unit U1 (#262): pnpm workspace, TypeScript 7 in strict mode,
  Biome for format and lint, Vitest, commitlint, and `make check`, with a
  self-test that runs the real checks on deliberately wrong files. The
  first independent code review found 20 defects, two High: the self-test
  did not exercise the project's own configuration, and one commit did not
  pass on its own. Both are fixed; the report is in the pull request.
- 2026-11-17 — The maintainer decided that commits are authored under the
  maintainer's identity, with the agent as co-author. `make identity` sets it,
  `make check` enforces it on the agent's commits, and `AGENTS.md` section 2 records it. Earlier
  commits are not rewritten.

## Next

1. Maintainer reviews and merges U1 (#262).
2. M2 unit U2: the CI pipeline with the document checks (#263).
3. Still open for the maintainer: squash or merge commits (OQ-11).
4. Before any live use: the emergency phrase lists and text, reviewed by a
   fluent speaker and by a person with clinical or crisis training (#168);
   each channel assumption re-read in full (threat model A7).

## Gate status

**Gate 2 (design) passed on 2026-11-17 on the rule of `AGENTS.md` section
11, when the maintainer merged #254:** no High finding is open. That is all it means.

| Review | Scope | High findings |
| --- | --- | --- |
| Structure review | Architecture, data model, state machines, API, ADRs | 7 |
| Threats and AI review | Threat model, guardrail policy, eval plan, compliance | 13 |
| Verification | The 20 fixes | 3 new; 6 of 20 partly resolved |
| Second verification | Those 9 | 0 |

Three rounds each found defects in the round before, and the last still
added eight Medium findings. 146 `review-finding` issues are open across
both gates. The design is not finished; it is at the point where the
remaining defects are better found by building and testing than by another
round of reading. No person has reviewed any of it in detail.

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
the dashboard and the `booking` pack, with 36 stories and 224 acceptance
criteria, run against a mock channel. The `cod-confirm` pack is deferred to
v1.1.

## Blocked on the maintainer

- Open questions with the maintainer as owner, in
  `requirements/open-questions.md`. None blocks v1.0 on the mock channel
  except OQ-9 (model provider) before M3 and OQ-11 (merge style) before M2.
- #6 Project board and private vulnerability reporting.
- #168 Confirm the supported languages and arrange a speaker's review of
  each eval dataset. Needed in M3.
- OQ-12 Whether one tenant's assistant can be paused. Before any live use.
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
