# Traceability

Links each v1.0 user story to its issue, the pull requests that implement it, its tests and, for AI behaviour, its eval cases. Update the row in the pull request that closes the story. An empty cell means the work has not been done yet.

| Story | Issue | Milestone | Pull requests | Tests | Eval cases |
| --- | --- | --- | --- | --- | --- |
| US-C1 Receive every inbound message exactly once | [#10](https://github.com/zishon89us/polyglot-sales-agent/issues/10) | M2 | #289, #291 (in part) | `packages/db/test/inbound.test.ts` and `apps/api/src/app.test.ts`: the same message five times is one row and one job. `apps/worker/src/worker.test.ts`: one reply for five deliveries, and the restart test of criterion 9. **Wider than criterion 9 as written:** a reply is also sent a second time after a timeout or a fault on the channel's side with the worker alive, which is the same unknown outcome (architecture, "Sending a message once"); for the maintainer to confirm (#290). Sessions and the reply window of criterion 4 are not built | not applicable |
| US-C2 Keep each business's data separate | [#11](https://github.com/zishon89us/polyglot-sales-agent/issues/11) | M2 | #280, #281 (in part) | `packages/db/test/isolation.test.ts`: criterion 2, at the database. Criteria 1 and 3 need the webhook and the API | not applicable |
| US-C3 Reply in the customer's language | [#12](https://github.com/zishon89us/polyglot-sales-agent/issues/12) | M3 |  |  |  |
| US-C4 Answer only from the business's data | [#13](https://github.com/zishon89us/polyglot-sales-agent/issues/13) | M3 |  |  |  |
| US-C5 Tell customers they are talking to an assistant | [#14](https://github.com/zishon89us/polyglot-sales-agent/issues/14) | M3 |  |  |  |
| US-C6 Hand the conversation to a person | [#15](https://github.com/zishon89us/polyglot-sales-agent/issues/15) | M4 |  |  |  |
| US-C7 Stop messages on request | [#16](https://github.com/zishon89us/polyglot-sales-agent/issues/16) | M3 |  |  |  |
| US-C8 Resist manipulation and stay in scope | [#17](https://github.com/zishon89us/polyglot-sales-agent/issues/17) | M3 |  |  |  |
| US-C9 Follow the channel's rules when the business messages first | [#18](https://github.com/zishon89us/polyglot-sales-agent/issues/18) | M5 |  |  | not applicable |
| US-C10 Record how every reply was produced | [#19](https://github.com/zishon89us/polyglot-sales-agent/issues/19) | M3 |  |  |  |
| US-C11 Handle several messages sent in a row | [#47](https://github.com/zishon89us/polyglot-sales-agent/issues/47) | M3 |  |  |  |
| US-C12 Respond sensibly to messages the assistant cannot read | [#48](https://github.com/zishon89us/polyglot-sales-agent/issues/48) | M3 |  |  | not applicable |
| US-C13 Message customers first only with their agreement | [#49](https://github.com/zishon89us/polyglot-sales-agent/issues/49) | M5 |  |  | not applicable |
| US-C14 Tell staff when a conversation needs them | [#50](https://github.com/zishon89us/polyglot-sales-agent/issues/50) | M4 |  |  | not applicable |
| US-C15 Stay usable when the AI provider fails | [#64](https://github.com/zishon89us/polyglot-sales-agent/issues/64) | M3 |  |  |  |
| US-C16 Have approved templates before messaging first | [#65](https://github.com/zishon89us/polyglot-sales-agent/issues/65) | M5 |  |  | not applicable |
| US-C17 Limit one sender's load | [#66](https://github.com/zishon89us/polyglot-sales-agent/issues/66) | M3 |  |  | not applicable |
| US-C18 Know whether each message arrived | [#67](https://github.com/zishon89us/polyglot-sales-agent/issues/67) | M3 |  |  | not applicable |
| US-C19 Record what each session was for and how it ended | [#68](https://github.com/zishon89us/polyglot-sales-agent/issues/68) | M5 |  |  |  |
| US-B1 Ask about services and prices | [#20](https://github.com/zishon89us/polyglot-sales-agent/issues/20) | M5 |  |  |  |
| US-B2 Book an appointment | [#21](https://github.com/zishon89us/polyglot-sales-agent/issues/21) | M5 |  |  |  |
| US-B3 Get a reminder and answer it | [#22](https://github.com/zishon89us/polyglot-sales-agent/issues/22) | M5 |  |  |  |
| US-B4 Reschedule or cancel | [#23](https://github.com/zishon89us/polyglot-sales-agent/issues/23) | M5 |  |  |  |
| US-B5 See and book times in the business's time zone | [#51](https://github.com/zishon89us/polyglot-sales-agent/issues/51) | M5 |  |  |  |
| US-D1 Sign in and see only my business | [#28](https://github.com/zishon89us/polyglot-sales-agent/issues/28) | M4 |  |  | not applicable |
| US-D2 Keep business information current | [#29](https://github.com/zishon89us/polyglot-sales-agent/issues/29) | M5 |  |  | not applicable |
| US-D3 Read conversations and take over | [#30](https://github.com/zishon89us/polyglot-sales-agent/issues/30) | M4 |  |  | not applicable |
| US-D4 See whether it is working | [#31](https://github.com/zishon89us/polyglot-sales-agent/issues/31) | M5 |  |  | not applicable |
| US-D5 Export or delete a customer's data | [#32](https://github.com/zishon89us/polyglot-sales-agent/issues/32) | M5 |  |  | not applicable |
| US-D6 Set up my business and connect its number | [#52](https://github.com/zishon89us/polyglot-sales-agent/issues/52) | M4 |  |  | not applicable |
| US-D7 Give staff their own limited access | [#53](https://github.com/zishon89us/polyglot-sales-agent/issues/53) | M4 |  |  | not applicable |
| US-D8 Record whether a customer attended | [#54](https://github.com/zishon89us/polyglot-sales-agent/issues/54) | M5 |  |  | not applicable |
| US-D9 Block time and add bookings by hand | [#55](https://github.com/zishon89us/polyglot-sales-agent/issues/55) | M5 |  |  | not applicable |
| US-D10 Get an owner account by invitation | [#69](https://github.com/zishon89us/polyglot-sales-agent/issues/69) | M4 |  |  | not applicable |
| US-D11 Change how the assistant behaves for my business | [#70](https://github.com/zishon89us/polyglot-sales-agent/issues/70) | M5 |  |  | not applicable |
| US-D12 See bookings and messages that need attention | [#71](https://github.com/zishon89us/polyglot-sales-agent/issues/71) | M5 |  |  | not applicable |

## Engineering work with no user story

Behaviour required by `nfr.md` that no story carries. Each gets an issue when its milestone is planned.

| Work | Requirement | Milestone | Issue | Tests |
| --- | --- | --- | --- | --- |
| Daily retention job | NFR-V4 | M5 |  |  |
| Dead-letter queue and operator alert | NFR-R5 | M2 | #266 | `packages/db/test/jobs.test.ts`: retries, dead-letter, alert queued. Nothing delivers the alert yet (#282) |
| Trial second pack `faq-only` | NFR-M1 | M5 |  |  |
| Health and readiness endpoints, structured logs | NFR-O1, NFR-O2 | M2 | #266, #289, #291 | `packages/db/test/jobs.test.ts`: the heartbeat. `apps/api/src/app.test.ts`: `/healthz`, `/readyz`. `apps/worker/src/worker.test.ts`: the worker records it. Logs are one line per fault, not yet structured throughout (#288, #290) |
| No duplicate replies; the send policy | NFR-R2 | M2 | #289, #291 | `packages/core/src/send-policy.test.ts`: every sequence of outcomes, by class. `apps/worker/src/worker.test.ts`: the restart test at four points |
| Replies of one conversation in order | NFR-R6, NFR-R7 | M2 | #291 (R6 in part) | `apps/worker/src/worker.test.ts`: two workers in one process, bursts of five. The delivery wait of NFR-R7 is not built (#290) |
| Webhook authenticity and unauthenticated load | NFR-S2, #154 | M2 | #267 | `apps/api/src/webhook.test.ts`: 401 and nothing handed on, the size limit, the limit on bad signatures. That nothing is stored needs the sink of #268 |
| A second channel fits the interface | NFR-M2 | M2 | #267 | `packages/channel/src/contract.ts`, run by both channels. The test on imports is not written yet |
