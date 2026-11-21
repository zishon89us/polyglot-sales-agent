# Architecture decision records

Each significant decision has one record here. Records are numbered in the
order they were written and are never deleted; a decision that changes gets a
new record that supersedes the old one.

## Format

Records follow MADR 4.0.0 (Markdown Architectural Decision Records): status
and date in front matter, then context and problem statement, decision
drivers, considered options, decision outcome with consequences and
confirmation, and pros and cons of the options. The template was read from
<https://github.com/adr/madr/tree/4.0.0/template> on 2026-11-16, as a search
extract of the repository page, not the raw file. `template.md` in this
folder is this project's copy.

ADR 0001 was written before the format was adopted and uses a slightly
different layout with the same content.

"Confirmation" in each record says how we will know the decision was
implemented and still holds. Where it names a test or a check, that test or
check must exist by the milestone named.

## Library names

A record decides an approach. Where it names a library, the library is a
candidate. Before it is added in milestone M2, its licence, maintenance
status and known vulnerabilities are checked and recorded in the pull request
that adds it (`AGENTS.md`, section 2). Version numbers are deliberately not
given here, because none has been verified.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-positioning-and-v1-scope.md) | Positioning and scope of v1.0 | Accepted |
| [0002](0002-language-runtime-and-framework.md) | TypeScript on Node.js with Fastify, in one repository | Accepted: merged by the maintainer in #151 |
| [0003](0003-database-and-tenancy.md) | PostgreSQL, one schema, tenant isolation by row-level security | Accepted: merged by the maintainer in #151 |
| [0004](0004-job-queue.md) | Jobs in PostgreSQL, enqueued in the same transaction as the data | Accepted: merged by the maintainer in #151 |
| [0005](0005-llm-client-abstraction.md) | A thin `LlmClient` interface owned by this project | Accepted: merged by the maintainer in #151 |
| [0006](0006-retrieval-approach.md) | Structured business data in context, no vector search | Accepted: merged by the maintainer in #151 |
| [0007](0007-guardrail-strategy.md) | Guardrails in code first; no second model at run time | Accepted: merged by the maintainer in #151 |
| [0008](0008-dashboard-authentication.md) | Email and password with server-side sessions | Accepted: merged by the maintainer in #151 |
| [0009](0009-hosting-target.md) | Hosting target and region | Proposed; needs the maintainer |
| [0010](0010-model-provider.md) | Model provider | A working choice by the maintainer on 2026-11-21 (Amazon Bedrock, a Claude model), to be confirmed by measurement |
| [0011](0011-operator-access.md) | Operator access through commands run on the server, with an insert-only log | Accepted: merged by the maintainer in #175 |
| [0012](0012-core-and-pack-boundary.md) | The core holds nothing about bookings; the booking pack owns its rules, tables and routes | Accepted: merged by the maintainer in #254 |
| [0013](0013-ai-dlc-workflow.md) | Borrow four practices from AWS AI-DLC for the build milestones; do not install it | Proposed by the agent; accepted when the maintainer merges it |

A record written by the agent is a proposal until the maintainer merges the
pull request that adds it; merging is the acceptance. The front matter of
records 0002 to 0008 and 0011 still reads "accepted by the agent"; the status
in this index is the one to rely on (Gate 2 findings S31 and A46).