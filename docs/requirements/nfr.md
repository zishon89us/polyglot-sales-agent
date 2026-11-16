# Non-functional requirements

Status: draft for maintainer review · Phase 1 (requirements) · Issue #4

Each requirement has a number and a way to check it. The targets are starting
points chosen before any code exists; none has been measured. Revisit them at
the end of milestone M2, when the walking skeleton gives real numbers, and
change them only through a pull request that explains why.

"Reference load" below means 20 inbound messages per second sustained for five
minutes across 50 tenants, on the staging environment size recorded in the
load-test report. It is a provisional sizing assumption, not a forecast.

## Performance

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-P1 | Webhook acknowledgement time | 99th percentile ≤ 1 s at reference load | Load test |
| NFR-P2 | End-to-end reply time, from inbound webhook to outbound send, with the real model | Median ≤ 10 s, 95th percentile ≤ 20 s | Trace data in staging; reported on the dashboard |
| NFR-P3 | Time spent outside the model call per reply | 95th percentile ≤ 1 s | Trace spans |
| NFR-P4 | Dashboard page load on a mid-range phone connection | Largest content visible ≤ 3 s | Browser test with throttling |

## Reliability

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-R1 | No inbound message is lost once acknowledged | 0 lost in restart and retry tests | Integration test that kills the worker mid-job |
| NFR-R2 | No duplicate replies | 0 duplicates when the same message ID is delivered up to 5 times | Integration test |
| NFR-R3 | Bookings and order confirmations are idempotent | Exactly 1 record when a tool call is repeated | Integration test |
| NFR-R4 | Model provider failure is contained | After 3 retries with backoff, a fallback message is sent and the conversation is handed over | Integration test with a failing fake client |
| NFR-R5 | Failed jobs are not silently dropped | 100% of exhausted jobs land in the dead-letter queue and raise an alert | Integration test |
| NFR-R6 | Service availability target once deployed | 99.5% per month for the webhook endpoint | Uptime monitoring; an objective, not a guarantee |

## Security

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-S1 | Tenant isolation | 0 cross-tenant reads or writes | Automated tests that attempt them on every tenant-owned table and tool |
| NFR-S2 | Webhook authenticity | 100% of unsigned, wrongly signed or replayed requests rejected | Contract and integration tests |
| NFR-S3 | No secrets in the repository | 0 findings | Secret scanning on every pull request |
| NFR-S4 | Dependency vulnerabilities | 0 known high or critical vulnerabilities on `main` | Dependency scan in CI |
| NFR-S5 | Channel tokens protected at rest | Encrypted in the database; never written to logs | Unit test and log inspection test |
| NFR-S6 | Dashboard sign-in abuse | Rate limited after 5 failed attempts per account in 15 minutes | Integration test |

## Privacy

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-V1 | Opt-out is honoured | 0 business-initiated messages to opted-out contacts | Integration test; eval cases for opt-out phrasing in several languages |
| NFR-V2 | Personal data kept out of logs | 0 phone numbers or message bodies in application logs | Automated log scan in the end-to-end test run |
| NFR-V3 | Deletion on request | A contact's messages and personal fields removed or anonymised within one job run | Integration test |
| NFR-V4 | Retention | Conversations older than the tenant's configured period are deleted or anonymised daily | Integration test with a shifted clock |
| NFR-V5 | No real personal data in the repository | 0 real phone numbers or conversations in code, fixtures, evals or screenshots | Review checklist; pattern scan in CI |

## AI quality

Thresholds are set in the eval plan (milestone M1), once a first dataset and a
baseline exist. Setting numbers now would be guessing. Two are fixed already
because they are safety properties:

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-A1 | Tool-misuse resistance | 100% pass on the red-team tool-misuse set | Eval suite |
| NFR-A2 | Ungrounded prices, times or policies reach a customer | 0 in the eval suite | Deterministic grader comparing replies with tenant data |
| NFR-A3 | Same-language reply, grounding, task completion, correct handover | Thresholds to be set in `docs/ai/eval-plan.md` | Eval suite |
| NFR-A4 | Languages covered by evals | At least 6, including Arabic, English, Urdu and Hindi, plus mixed and transliterated input | Dataset inventory in the eval report |
| NFR-A5 | Every model call is traceable | 100% of calls have a stored trace | Integration test |

## Cost

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-C1 | Model cost per conversation is known | Reported per tenant from traces | Dashboard metric |
| NFR-C2 | Runaway cost is capped | Per-conversation turn cap and per-tenant daily token budget enforced; over-budget conversations are handed over | Integration test |
| NFR-C3 | Target model cost per completed conversation | To be set in M3 from measured traces and current provider pricing | Eval and trace report |

## Maintainability and extensibility

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-M1 | A new pack needs no core change | 0 files changed under `packages/core` when adding the trial third pack | Pull request diff at the end of M5 |
| NFR-M2 | A new messaging channel fits the channel interface | Mock channel and WhatsApp channel both implement it with no channel-specific code in the core | Architecture test on imports |
| NFR-M3 | Unit and integration test coverage of `packages/` | Floor to be set in `docs/test-plan.md` in M2 | Coverage gate in CI |
| NFR-M4 | Local setup | Working stack from a fresh clone in ≤ 5 commands | Checked in CI by running the quickstart |
| NFR-M5 | Type safety | TypeScript strict mode, 0 type errors, no unexplained `any` | Type check and lint in CI |

## Usability and accessibility

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-U1 | Right-to-left and mixed-direction chat text renders correctly | Arabic and Urdu fixtures display correctly in the conversation view | Browser test with screenshots |
| NFR-U2 | Dashboard accessibility | No critical violations from an automated accessibility check on main screens | Automated check in CI |
| NFR-U3 | Dashboard usable on a phone | Main screens work at 360 px width | Browser test |

## Operability

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-O1 | Health and readiness endpoints | Present on API and worker | Smoke test after deploy |
| NFR-O2 | Structured logs | JSON with request and conversation IDs on every line | Log schema test |
| NFR-O3 | Rollback | A release can be rolled back in ≤ 15 minutes following the runbook | Rehearsed once in staging |
| NFR-O4 | Migrations are reversible | Every migration has a tested down step, or a documented reason it cannot | CI migration test |

## Compliance

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-L1 | Channel policy rules are verified, not remembered | `docs/compliance.md` cites current official sources with the date read, before US-C9 is designed | Review in M1 |
| NFR-L2 | Data-protection obligations for the first target market are documented | Engineering summary with open questions for a lawyer, before any real customer data | Review in M1; maintainer sign-off before a pilot |
