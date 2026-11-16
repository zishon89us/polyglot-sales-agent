---
status: "proposed by the agent; accepted when the maintainer merges it"
date: 2026-11-17
decision-makers: "agent (proposal), maintainer (approval)"
---

# Borrow four practices from AWS AI-DLC for the build milestones; do not install it

## Context and Problem Statement

On 2026-11-16 the maintainer asked whether an existing standard or tool
would steer the agent better than a home-made process, and named AWS AI-DLC.
The answer then was to keep named standards plus independent review for the
requirements and design phases, and to evaluate AI-DLC before the build
milestones (issue #59). This record is that evaluation.

The M1 retro (`docs/retros/m1-design.md`) sets the test: the process failed
where one fact was kept by hand in several places, and where reading was
used to find defects that tests would have found.

## What was read

The official repository, <https://github.com/awslabs/aidlc-workflows>,
cloned on 2026-11-17 at commit `8efe179` (dated 2026-11-16).

- **Version:** 2.11.4, released 2026-11-13, the latest tag that is not a
  preview. Preview builds are published daily.
- **Licence:** MIT No Attribution (MIT-0), from the `LICENSE` file.
- **Read:** the top of `README.md` (installation and harnesses), the top of
  `CHANGELOG.md` (the 2.11.4 notes), the stage tables and section headings
  of `docs/guide/04-phases-and-stages.md`, the opening of
  `docs/guide/00-introduction.md`, the section headings of the guides on
  state and audit and on customisation, and the directory listing.
- **Not read:** the other guides, the agents' and stages' own instructions,
  the engine's source, and the security of its installer and hooks. The
  judgement below is about fit, made from the structure and the stage list.
  It is not an assessment of AI-DLC's quality.

AI-DLC has changed since the earlier conversation. It is no longer a folder
of rule files to copy. It is an installed command (`aidlc`) with a
deterministic engine that decides the next step, a runtime for each coding
assistant including Claude Code, hooks into that assistant, its own state
file and audit trail, fourteen agent definitions, and a `/aidlc` command
that runs a workflow of up to five phases with approval gates.

## How its phases map to this project

| AI-DLC phase | Its stages, in short | This project |
| --- | --- | --- |
| 0 Initialization | Workspace, state file, audit trail | `AGENTS.md`, `docs/STATUS.md`, the issue tracker |
| 1 Ideation | Intent, market research, feasibility, scope, approval | M0: vision, ADR 0001. **Done** |
| 2 Inception | Requirements, stories, domain design, **units of work with a dependency graph**, contracts, delivery plan | M0 and M1: requirements and design. **Done**, except that the work is not yet cut into units |
| 3 Construction | Per unit: functional design, NFR requirements and design, code generation; then build and test, and a CI pipeline | M2 to M5 |
| 4 Operation | Deployment, environments, observability, incident response, performance validation | M6 |

## Decision Drivers

- The project is two phases in, with its own documents, reviews and gates.
- The retro's main lesson: do not keep one fact in two places.
- Anything installed must be something the maintainer chose, can run on their
  own machine and in CI, and can keep up to date.
- The repository must stay readable to a stranger without a tool.

## Considered Options

- Install AI-DLC and run the build milestones through it
- Borrow specific practices and keep the current process
- Keep the current process unchanged

## Decision Outcome

Chosen option: "borrow specific practices and keep the current process".

**Why not install it.**

- It would add a second source of truth for the process: its state file and
  audit trail beside `AGENTS.md`, `STATUS.md` and the issues. That is the
  defect the retro identified, moved from the design to the process.
- Its first two phases would either be re-run over finished work or skipped
  by hand. Entering a workflow in the middle is not what it is built for,
  as far as was read.
- It is a native program with hooks into the coding assistant, released
  several times a week, with a "breaking for scripts" note in the latest
  release. That is a dependency to choose on purpose, and this session
  cannot install or run it; the maintainer's sessions would have to.
- Several of its agents and stages assume AWS as the platform. Hosting here
  is undecided (ADR 0009).

**What is borrowed.** Four practices, each answering something the retro
found. They are described in this project's own documents and need nothing
installed.

| Practice, as AI-DLC names it | What this project does | Answers |
| --- | --- | --- |
| **Units of work with a dependency graph** | Before M2 starts, the milestone is cut into units small enough for one pull request each, with the order they depend on each other in, recorded in `docs/test-plan.md` or a plan file and as issues | Large pull requests; findings with no home |
| **A fixed loop per unit** | For each unit: confirm the design it implements, write the tests, write the code, run every check, then a small independent code review (Gate 4) | Review that does not converge when done in one large pass |
| **Sensors: checks run by code, not by reading** | CI checks from the first M2 pull request: every story has a test (traceability); every shared name matches its single source; required sections exist in each document; the OpenAPI file lints and matches the routes | The same fact drifting across documents |
| **Halt and ask on failure** | When a check fails twice for the same reason, the agent stops and opens a `needs-human` issue, as `AGENTS.md` section 2 already says for blockers | Fixes that introduce new defects under time pressure |

### Consequences

- Good, because the process keeps one source of truth.
- Good, because each borrowed practice is tied to a failure that actually
  happened here.
- Good, because nothing depends on a tool that only some sessions can run.
- Bad, because the project does not get AI-DLC's engine, which enforces
  its gates by program; here the gates are still kept by the agent and the
  maintainer, with CI doing what it can.
- Bad, because the repository cannot say it follows AI-DLC, which would
  have been a recognisable name for a portfolio. It can say it borrowed
  four practices and why.
- Neutral, because the choice can be revisited for a new project started
  from nothing, which is the case AI-DLC is designed for.

### Confirmation

- `AGENTS.md` gains the unit loop and the halt rule when M2 is planned.
- The first M2 pull request adds the CI checks named above, or an issue for
  each one it defers.
- Nothing from AI-DLC is installed or copied into this repository. If text
  is ever copied from it, its MIT-0 licence allows that; the source and
  version would be recorded.

## Pros and Cons of the Options

### Install AI-DLC and run the build milestones through it

- Good, because gates and state are enforced by a program.
- Good, because it is maintained, documented and recognisable.
- Bad, for the four reasons under "Why not install it".

### Borrow specific practices and keep the current process

- Good and bad as in "Consequences".

### Keep the current process unchanged

- Good, because it costs nothing.
- Bad, because the retro shows the current process let defects through and
  did not converge. Changing nothing would repeat that.

## More Information

- Issue #59. `docs/retros/m1-design.md`.
- The repository read: <https://github.com/awslabs/aidlc-workflows>,
  version 2.11.4, commit `8efe179`, read 2026-11-17.
