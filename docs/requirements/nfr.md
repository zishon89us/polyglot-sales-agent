# Non-functional requirements

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #4, #46, #61

Each requirement has a number and a way to check it. No target has been
measured; they were chosen before any code existed. Revisit them at the end
of milestone M2, when the walking skeleton gives real numbers, and change them
only through a pull request that explains why.

Terms, metrics and fixed values are defined in [`glossary.md`](glossary.md).
State and transition rules are in
[`docs/design/state-machines.md`](../design/state-machines.md).
A target that cannot be set yet names the open question in
[`open-questions.md`](open-questions.md) that will set it, and is marked
**not yet testable**.

"Reference load" means 20 inbound messages per second sustained for five
minutes across 50 tenants, on the environment size recorded in the load-test
report. It is a provisional sizing assumption, not a forecast.

## Performance

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-P1 | Webhook acknowledgement time | 99th percentile ≤ 1 s at reference load | Load test |
| NFR-P2 | End-to-end reply time with the real model, from the end of the batching window to the reply reaching status `sent` | Median ≤ 10 s, 95th percentile ≤ 20 s | Trace data in staging |
| NFR-P3 | Time spent outside the model call per reply | 95th percentile ≤ 1 s | Trace spans |
| NFR-P4 | Dashboard page load under the browser's "Fast 3G" throttling preset on an emulated mid-tier phone | Largest contentful paint ≤ 3 s on each main screen (NFR-U) | Automated browser audit |
| NFR-P5 | Message batching window | As in the glossary's fixed values | Integration test with timed message bursts |

## Reliability

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-R1 | No inbound message is lost once acknowledged | 0 lost in restart tests | Integration test that stops the worker mid-job |
| NFR-R2 | No duplicate replies | 0 duplicates when the same message ID is delivered 5 times. Separately, when a worker is stopped after the channel accepted a message and before that was recorded: at most 2 copies of a reply, and at most 1 of a template | Integration test, and a restart test that stops the worker at each point |
| NFR-R3 | Bookings are idempotent | Exactly 1 record when a tool call is repeated | Integration test |
| NFR-R4 | Model provider failure is contained | Behaviour of US-C15, with the timeout, attempts and waits in the glossary | Integration test with a failing fake client |
| NFR-R5 | Failed jobs are not silently dropped | A job is retried 5 times with exponential backoff starting at 2 s; 100% of jobs that exhaust their retries are in the dead-letter queue and raise an alert to the operator's configured alert address | Integration test |
| NFR-R6 | Replies within one conversation are sent in order | 0 interleaved or out-of-order replies with 2 workers and bursts of 5 messages; each message waits for the previous one as in US-C18 | Integration test |
| NFR-R7 | Outbound order as seen by the customer | Each message is sent only after the previous one in that conversation is `delivered`, or 10 s after it was `sent`. Order on the customer's phone cannot be guaranteed by the channel (`docs/compliance.md`, finding 7), so this is best effort | Integration test against the mock channel with delayed delivery events |
| NFR-R8 | Service availability objective once deployed | 99.5% per month for the webhook endpoint | Uptime monitoring; an objective, not a guarantee |

## Security

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-S1 | Tenant isolation | 0 cross-tenant reads or writes | Automated tests that attempt them on every tenant-owned table and tool |
| NFR-S2 | Webhook authenticity | 100% of requests with a missing or invalid signature are refused and not stored. The answer is 401, or, where the request is refused before its signature can be read, another refusal: 413 for a body over the size limit, 429 from a source blocked for repeated refusals (#154), a 4xx for a request that is not well-formed or is too slow, or a closed connection. A validly signed redelivery is accepted and deduplicated by message ID (US-C1); the channel documents no timestamp for rejecting replays | Contract and integration tests |
| NFR-S3 | No secrets in the repository | 0 findings | Secret scanning on every pull request |
| NFR-S4 | Dependency vulnerabilities | 0 known high or critical vulnerabilities on `main` | Dependency scan in CI |
| NFR-S5 | Channel credentials protected at rest | Encrypted in the database; never written to logs | Unit test and log scan |
| NFR-S6 | Dashboard sign-in abuse | Lockout as in the glossary's fixed values | Integration test |
| NFR-S7 | Per-contact load | Rate limit as in the glossary's fixed values (US-C17) | Integration test |
| NFR-S8 | No open sign-up | 0 routes create an account without a valid invitation | Route inventory test |

## Privacy

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-V1 | Opt-out is honoured | 0 business-initiated messages to opted-out contacts, whether or not the reply window is open | Integration tests, including one with the window open |
| NFR-V2 | Personal data kept out of logs and traces | 0 phone numbers, contact names or message bodies in application logs or in traces | Automated scan in the end-to-end test run |
| NFR-V3 | Deletion on request | Complete within 24 hours, with the per-type behaviour of US-D5 | Integration test |
| NFR-V4 | Retention | A daily job deletes every message older than the tenant's message-retention setting, whatever the age of the conversation's other messages. A contact's name and phone number are deleted once the contact has no message within the retention period, no future booking, and no booking that started within the retention period; for a contact with no messages, age is counted from the latest booking start. Bookings and sessions are kept without personal fields; the hashed opt-out record is kept | Integration tests with a shifted clock, including a returning contact and a contact with a future booking |
| NFR-V5 | No real personal data in the repository | 0 real phone numbers or conversations in code, fixtures, evals or screenshots | Review checklist; pattern scan in CI |
| NFR-V6 | Conversations are not used to train or evaluate models | 0 conversation records in `evals/` or `prompts/`; the model provider's terms, recorded in an ADR, exclude training on submitted data | Pattern scan in CI; ADR review |
| NFR-V7 | Data sent to the model is minimised | No phone number and no contact name is put into a prompt by the system: no field of the contact or the channel's profile is sent. A number or a name the customer typed inside a message is part of that message and is sent with it | Unit test on prompt assembly |

## AI quality

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-A1 | Resistance to misuse | 100% pass on the red-team set for each of: tool misuse, prompt disclosure, cross-tenant exposure | Eval suite |
| NFR-A2 | Wrong prices, or wrong slot or booking times, reaching a customer | 0 in the eval suite, including the cases where a customer states a wrong value and asks for confirmation | A grader that compares each reply with the facts labelled in the eval case, for the named service, slot or booking. It is independent of the run-time check in US-C4, so it also measures what that check cannot catch |
| NFR-A3 | Same-language reply, grounding of other fact kinds, task completion, correct handover, inquiry classification | **Not yet testable.** Thresholds set from a baseline (OQ-6) | Eval suite |
| NFR-A4 | Languages covered by evals | At least 6, including Arabic, English, Urdu and Hindi, plus mixed-language and transliterated input | Dataset inventory in the eval report |
| NFR-A5 | Every model call is traceable | 100% of calls have a stored trace (US-C10) | Integration test |
| NFR-A6 | Scores are reported with their basis | Every published score shows the dataset size for that language and dimension | Eval report check |

## Cost

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-C1 | Cost per session is known | Model cost and channel fees per session are reported per tenant (US-D4) | Dashboard test |
| NFR-C2 | Runaway cost is capped | The turn cap in the glossary is enforced. The daily token budget is **not yet testable** (OQ-7) | Integration test |
| NFR-C3 | Target model cost per session | **Not yet testable** (OQ-7) | Trace report |

## Maintainability and extensibility

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-M1 | A new pack needs no core change | 0 files changed under `packages/core` when adding the trial pack `faq-only` at the end of M5 | Pull request diff |
| NFR-M2 | A new messaging channel fits the channel interface | The mock channel and the WhatsApp channel both implement it, with no channel-specific code in the core | Architecture test on imports |
| NFR-M3 | Unit and integration test coverage of `packages/` | **Not yet testable.** Floor set in M2 (OQ-8) | Coverage gate in CI |
| NFR-M4 | Local setup | Working stack from a fresh clone in ≤ 5 commands | Checked in CI by running the quickstart |
| NFR-M5 | Type safety | TypeScript strict mode, 0 type errors, no `any` without a comment giving the reason | Type check and lint in CI |

## Usability and accessibility

The **main screens** are: sign-in, waiting list, conversation, bookings,
business data, metrics and settings.

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-U1 | Right-to-left and mixed-direction text | In the conversation screen, Arabic and Urdu fixture messages are right-aligned, their characters are in reading order, and embedded numbers and Latin words keep their own order | Browser test compared with approved reference screenshots |
| NFR-U2 | Accessibility | 0 violations of impact "critical" or "serious" reported by the axe-core rule set on each main screen | Automated check in CI |
| NFR-U3 | Phone use | Each main screen is usable at a 360 px wide viewport with no horizontal scrolling | Browser test |

## Operability

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-O1 | Health and readiness | Endpoints on the API. For the worker, which accepts no HTTP, a probe command that reads its heartbeat (ADR 0004, amendment) | Smoke test |
| NFR-O2 | Structured logs | JSON with request and conversation IDs on every line | Log schema test |
| NFR-O3 | Rollback | A release can be rolled back in ≤ 15 minutes following the runbook | Rehearsed once in staging |
| NFR-O4 | Migrations are reversible | Every migration has a tested down step, or a documented reason it cannot | CI migration test |

## Compliance

| ID | Requirement | Target | How it is checked |
| --- | --- | --- | --- |
| NFR-L1 | Channel rules are verified, not remembered | `docs/compliance.md` cites official sources with the date read. Each statement used by the design is either re-read in full, or listed as an assumption in the threat model, section 1. Every such assumption is re-read in full before any live channel is connected | Gate 2 review for the list; a check before live use for the re-reading |
| NFR-L2 | The repository states its limits | The README and the system card say that the software has not been approved for processing real customer data, and list open questions OQ-1 to OQ-4 | Gate 5 review |
