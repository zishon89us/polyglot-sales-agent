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
