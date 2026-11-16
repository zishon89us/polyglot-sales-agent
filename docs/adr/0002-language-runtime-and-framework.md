---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# TypeScript on Node.js with Fastify, in one repository

## Context and Problem Statement

The product has three running parts: an API that receives webhooks and serves
the dashboard, workers that process messages and timers, and the dashboard
itself. Which language, runtime and web framework should they use, and should
they share one repository?

## Decision Drivers

- One maintainer directing one agent: fewer languages and tools mean less to
  keep correct.
- The state machines (`docs/design/state-machines.md`) must be written once
  and used by API, workers and tests.
- Request and webhook payloads must be validated against schemas, and the API
  contract published as OpenAPI (`AGENTS.md`, section 11).
- NFR-M5: strict typing with no unexplained `any`.
- NFR-M4: a working local stack in five commands or fewer.

## Considered Options

- TypeScript on Node.js, Fastify for the API, one repository with workspaces
- Python with FastAPI for API and workers, TypeScript only for the dashboard
- Go for API and workers, TypeScript only for the dashboard

## Decision Outcome

Chosen option: "TypeScript on Node.js, Fastify, one repository with
workspaces", because it lets the domain rules, the schemas and their types be
written once and shared by every part, including the dashboard.

Specifics:

- TypeScript in strict mode on the current Node.js long-term-support line.
- Fastify for the API, with route schemas as the single source for request
  validation and the generated OpenAPI file.
- One repository with package-manager workspaces: `apps/` for the runnable
  parts, `packages/` for libraries, as laid out in `AGENTS.md` section 4.
- The domain rules (state machines, timing rule, message classes) live in
  `packages/core` as pure functions with no I/O, so they can be tested
  exhaustively.
- Next.js for the dashboard (see ADR 0008 for how it authenticates).

### Consequences

- Good, because one type definition serves the API, the workers and the
  dashboard, so a changed field is a compile error everywhere at once.
- Good, because pure domain functions can be tested in the same way the
  Python design models were, and replace those models.
- Bad, because Node.js runs on one thread per process: a slow synchronous
  step blocks other requests. The webhook path must do no heavy work, which
  the queue design (ADR 0004) already requires.
- Bad, because the wider ecosystem for AI evaluation tooling is stronger in
  Python. The eval runner will be written in TypeScript; if that proves
  costly, it can be a separate Python tool that reads the same dataset files.
- Bad, because the two design models written in Python become throwaway once
  the TypeScript tests exist.

### Confirmation

By the end of M2: CI runs type checking in strict mode with zero errors; a
lint rule fails on `any` without a reason comment; the OpenAPI file is
generated from route schemas and linted; `packages/core` has no import of a
database, network or framework module, checked by an import-boundary test.

## Pros and Cons of the Options

### TypeScript on Node.js with Fastify

- Good, because types and schemas are shared across all three parts.
- Good, because one toolchain: one linter, one test runner, one build.
- Bad, because of the single-thread constraint noted above.

### Python with FastAPI, TypeScript dashboard

- Good, because AI and evaluation libraries are most mature in Python.
- Bad, because the API contract and domain types must be kept in step across
  two languages, by generation or by hand.
- Bad, because two toolchains for one maintainer.

### Go, TypeScript dashboard

- Good, because of performance and simple deployment as one binary.
- Bad, because the same two-language cost, and performance is not the
  constraint: the reference load is 20 messages a second and the model call
  dominates reply time.

## More Information

- No library version has been verified. "Current long-term-support line"
  must be checked against the Node.js release schedule when M2 starts.
- This confirms the default in `AGENTS.md` section 3.
- Reopen if the eval tooling in TypeScript blocks milestone M3.

## Amendment, 2026-11-17: tooling and the Node.js line (M2 unit U1)

This record asked for a check of the Node.js release schedule when M2
starts, and left the tools to the unit that needs them. The first code
review (Gate 4) found neither recorded.

**Node.js.** Read on 2026-11-17 as search extracts, not in full:
<https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule>
(Node.js 26 enters long-term support in October 2026 and is the last line
under the old schedule) and <https://nodejs.org/en/about/previous-releases>
(22 is in maintenance; the extract seen still showed 24 as the active line).
The two extracts do not agree on which line is the active one today, so the
statement is an assumption until read in full.

Decision: the code must run on **Node.js 22.12 or later**. 22 is what the
agent's environment provides and is still supported; CI (unit U2) runs the
checks on 22 and on the newest long-term-support line. Type definitions are
pinned to the 22 line, the oldest supported, so that nothing newer is used
by accident. `engines` is advisory; nothing enforces it until CI does.

**Tools.** Each was chosen on 2026-11-17. Versions are pinned exactly.
Licences are from the npm registry. `pnpm audit` reported no known
vulnerabilities on that date.

| Tool | Version | Licence | Last published | Why this one | Considered instead |
| --- | --- | --- | --- | --- | --- |
| pnpm | 10.28.0 | MIT | Active; 12.x is the newest line | Workspaces, a strict lockfile, already present in the agent's environment. The 10 line is used because that is what is installed; moving to 12 is a separate change | npm workspaces |
| TypeScript | 7.0.2 | Apache-2.0 | 2026-11-16 | Required by this record | — |
| Biome | 2.6.8 | MIT or Apache-2.0 | 2026-11-15 | One tool and one configuration for formatting, lint and import order; fast enough to run on every check | ESLint with Prettier: more rules and plug-ins, two tools to keep in step |
| Vitest | 5.1.0 | MIT | 2026-11-02 | Runs TypeScript and ES modules without a build step | Node's built-in test runner: no dependency, fewer features |
| commitlint | 21.2.4 | MIT | 2026-10-18 | Enforces the commit format of `AGENTS.md` section 4 | A hand-written check |
| @types/node | 22.20.5 | MIT | — | Types for the Node.js line above | — |

All are development dependencies; none ships in the product. Their 110
transitive packages are under MIT, ISC, Apache-2.0, BSD-3-Clause,
Python-2.0 (one) and MPL-2.0 (three: `lightningcss` and its platform
binaries, through Vitest). MPL-2.0 applies file by file and places no
condition on this project's own code.

Not verified: how actively each tool is maintained beyond its last
publication date, and whether a newer major version of any of them has
changed its licence.
