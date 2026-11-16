# Status

Living progress log. The agent updates this at the end of every session.

## Current milestone: M1 Design

Exit criteria: design documents merged; open questions listed for the
maintainer. Issues #37–#44.

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
- 2026-11-16 — M1 issues #37–#44 opened. M0 retro opened as a pull request
  for #36.

## Next

1. #37 Verify channel rules and data-protection obligations from official
   sources; write `docs/compliance.md`.
2. #38 First ADRs, then #39 architecture, #40 data model, #42 threat model.
3. #43 Eval plan and #44 guardrail policy.
4. #41 API specification.

## Blocked on the maintainer

- #6 Still open: project board, private vulnerability reporting, and which
  pull requests (if any) the agent may merge itself.
- #7 Licence, product name, copyright holder, LLM provider, hosting target,
  Meta developer app, commit identity. Needed before M2; none block M1.
- Squash merge or merge commits: practice and `AGENTS.md` differ (see the M0
  retro).

## Not done yet

- GitHub project board (Backlog, Ready, In progress, In review, Done). The
  agent's session cannot create GitHub Projects; tracked in #6's follow-up
  comment for the maintainer.
- `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `Makefile` — arrive with the tooling
  in M2, when there is something for them to describe.

## Open questions

None yet.
