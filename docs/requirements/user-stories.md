# User stories for v1.0

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #3, #46, #61

Version 1.0 has 36 stories with 171 acceptance criteria. Each story has its own issue, which is where the work is tracked; this document is the readable overview.

- Personas are in [`personas.md`](personas.md).
- Every term, metric, setting and default used here is defined in [`glossary.md`](glossary.md). Words such as *session*, *supported language*, *business-initiated message*, *grounded fact*, *fallback message* and *business hours* have the meanings given there.
- Numeric targets are in [`nfr.md`](nfr.md).
- Questions that are still open are in [`open-questions.md`](open-questions.md). A criterion marked "not yet testable" depends on one of them.
- 15 stories are marked **AI**: they change or depend on model behaviour and need eval cases as well as tests.

The dashboard is in English in v1.0, and staff see conversations in the language the customer wrote, without translation. Both are assumptions to validate (see `vision.md`).

## Summary

| Story | Title | Persona | Milestone | Issue |
| --- | --- | --- | --- | --- |
| US-C1 | Receive every inbound message exactly once | P4 | M2 | [#10](https://github.com/zishon89us/polyglot-sales-agent/issues/10) |
| US-C2 | Keep each business's data separate | P1 | M2 | [#11](https://github.com/zishon89us/polyglot-sales-agent/issues/11) |
| US-C3 | Reply in the customer's language (AI) | P4 | M3 | [#12](https://github.com/zishon89us/polyglot-sales-agent/issues/12) |
| US-C4 | Answer only from the business's data (AI) | P1 | M3 | [#13](https://github.com/zishon89us/polyglot-sales-agent/issues/13) |
| US-C5 | Tell customers they are talking to an assistant (AI) | P4 | M3 | [#14](https://github.com/zishon89us/polyglot-sales-agent/issues/14) |
| US-C6 | Hand the conversation to a person (AI) | P4 | M4 | [#15](https://github.com/zishon89us/polyglot-sales-agent/issues/15) |
| US-C7 | Stop messages on request (AI) | P4 | M3 | [#16](https://github.com/zishon89us/polyglot-sales-agent/issues/16) |
| US-C8 | Resist manipulation and stay in scope (AI) | P1 | M3 | [#17](https://github.com/zishon89us/polyglot-sales-agent/issues/17) |
| US-C9 | Follow the channel's rules when the business messages first | P1 | M5 | [#18](https://github.com/zishon89us/polyglot-sales-agent/issues/18) |
| US-C10 | Record how every reply was produced (AI) | P1 | M3 | [#19](https://github.com/zishon89us/polyglot-sales-agent/issues/19) |
| US-C11 | Handle several messages sent in a row (AI) | P4 | M3 | [#47](https://github.com/zishon89us/polyglot-sales-agent/issues/47) |
| US-C12 | Respond sensibly to messages the assistant cannot read | P4 | M3 | [#48](https://github.com/zishon89us/polyglot-sales-agent/issues/48) |
| US-C13 | Message customers first only with their agreement | P4 | M5 | [#49](https://github.com/zishon89us/polyglot-sales-agent/issues/49) |
| US-C14 | Tell staff when a conversation needs them | P3 | M4 | [#50](https://github.com/zishon89us/polyglot-sales-agent/issues/50) |
| US-C15 | Stay usable when the AI provider fails (AI) | P4 | M3 | [#64](https://github.com/zishon89us/polyglot-sales-agent/issues/64) |
| US-C16 | Have approved templates before messaging first | P1 | M5 | [#65](https://github.com/zishon89us/polyglot-sales-agent/issues/65) |
| US-C17 | Limit one sender's load | P1 | M3 | [#66](https://github.com/zishon89us/polyglot-sales-agent/issues/66) |
| US-C18 | Know whether each message arrived | P3 | M3 | [#67](https://github.com/zishon89us/polyglot-sales-agent/issues/67) |
| US-C19 | Record what each session was for and how it ended (AI) | P1 | M5 | [#68](https://github.com/zishon89us/polyglot-sales-agent/issues/68) |
| US-B1 | Ask about services and prices (AI) | P4 | M5 | [#20](https://github.com/zishon89us/polyglot-sales-agent/issues/20) |
| US-B2 | Book an appointment (AI) | P4 | M5 | [#21](https://github.com/zishon89us/polyglot-sales-agent/issues/21) |
| US-B3 | Get a reminder and answer it (AI) | P4 | M5 | [#22](https://github.com/zishon89us/polyglot-sales-agent/issues/22) |
| US-B4 | Reschedule or cancel (AI) | P4 | M5 | [#23](https://github.com/zishon89us/polyglot-sales-agent/issues/23) |
| US-B5 | See and book times in the business's time zone (AI) | P4 | M5 | [#51](https://github.com/zishon89us/polyglot-sales-agent/issues/51) |
| US-D1 | Sign in and see only my business | P1 | M4 | [#28](https://github.com/zishon89us/polyglot-sales-agent/issues/28) |
| US-D2 | Keep business information current | P1 | M5 | [#29](https://github.com/zishon89us/polyglot-sales-agent/issues/29) |
| US-D3 | Read conversations and take over | P3 | M4 | [#30](https://github.com/zishon89us/polyglot-sales-agent/issues/30) |
| US-D4 | See whether it is working | P1 | M5 | [#31](https://github.com/zishon89us/polyglot-sales-agent/issues/31) |
| US-D5 | Export or delete a customer's data | P1 | M5 | [#32](https://github.com/zishon89us/polyglot-sales-agent/issues/32) |
| US-D6 | Set up my business and connect its number | P1 | M4 | [#52](https://github.com/zishon89us/polyglot-sales-agent/issues/52) |
| US-D7 | Give staff their own limited access | P1 | M4 | [#53](https://github.com/zishon89us/polyglot-sales-agent/issues/53) |
| US-D8 | Record whether a customer attended | P3 | M5 | [#54](https://github.com/zishon89us/polyglot-sales-agent/issues/54) |
| US-D9 | Block time and add bookings by hand | P3 | M5 | [#55](https://github.com/zishon89us/polyglot-sales-agent/issues/55) |
| US-D10 | Get an owner account by invitation | P1 | M4 | [#69](https://github.com/zishon89us/polyglot-sales-agent/issues/69) |
| US-D11 | Change how the assistant behaves for my business | P1 | M5 | [#70](https://github.com/zishon89us/polyglot-sales-agent/issues/70) |
| US-D12 | See bookings and messages that need attention | P3 | M5 | [#71](https://github.com/zishon89us/polyglot-sales-agent/issues/71) |

## Core engine

### US-C1 — Receive every inbound message exactly once

Persona P4 · Milestone M2 · Issue [#10](https://github.com/zishon89us/polyglot-sales-agent/issues/10)

As an end customer, I want my message to be received even if the channel redelivers it or the service restarts, so that I get one reply, not none and not two.

1. **Given** a validly signed webhook carrying a message ID not seen before, **when** it is received, **then** the event is stored and queued.
2. **Given** a validly signed webhook carrying a message ID not seen before, **when** it is received, **then** HTTP 200 is returned within the target of NFR-P1.
3. **Given** a validly signed webhook carrying a message ID already stored, **when** it is received, **then** HTTP 200 is returned and the message is not processed again, however many times it is redelivered.
4. **Given** a webhook with a missing or invalid signature, **when** it is received, **then** HTTP 401 is returned and nothing is stored or queued.
5. **Given** a validly signed message for a number that maps to no tenant, or to a tenant whose setup is incomplete (US-D6), **when** it is received, **then** HTTP 200 is returned, the event is stored as unroutable, and no reply is sent.
6. **Given** a worker that stops while processing a queued message, **when** it restarts, **then** the message is processed and exactly one reply is sent.

### US-C2 — Keep each business's data separate

Persona P1 · Milestone M2 · Issue [#11](https://github.com/zishon89us/polyglot-sales-agent/issues/11)

As a business owner, I want messages to my number to be handled only with my business's data, so that another business's prices or customers never appear in my conversations.

1. **Given** two tenants, each with its own number and data, **when** a message arrives on tenant A's number, **then** the conversation, retrieval and reply use only tenant A's records.
2. **Given** a query or tool call scoped to tenant A, **when** it requests a record owned by tenant B, **then** the record is not returned.
3. **Given** a query or tool call scoped to tenant A, **when** it requests a record owned by tenant B, **then** the attempt is written to the audit log.

### US-C3 — Reply in the customer's language

Persona P4 · Milestone M3 · Issue [#12](https://github.com/zishon89us/polyglot-sales-agent/issues/12) · **AI**

As an end customer, I want the reply in the language I wrote in, so that I can understand it without translating.

1. **Given** a customer writes in a supported language, **when** the assistant replies, **then** the reply is in that language.
2. **Given** a customer writes a supported language in Latin letters, or mixes two supported languages, **when** the assistant replies, **then** the reply uses the customer's dominant language, in that language's usual script.
3. **Given** a customer switches to another supported language during a session, **when** the assistant replies to the new message, **then** the reply uses the new language.
4. **Given** a customer writes in a language that is not supported, **when** the assistant replies, **then** it attempts a reply in that language and the session is recorded as unsupported-language, so it is excluded from quality claims.

### US-C4 — Answer only from the business's data

Persona P1 · Milestone M3 · Issue [#13](https://github.com/zishon89us/polyglot-sales-agent/issues/13) · **AI**

As a business owner, I want the assistant to state grounded facts only from my data, so that customers are never told something untrue about my business.

1. **Given** a grounded fact that exists in the tenant's data, **when** a customer asks for it, **then** the reply states it.
2. **Given** a reply containing a price, date or time, **when** the output guardrail runs, **then** each such value equals a value in the tenant's data or in a tool result from the same session, after normalising numerals, separators and date format.
3. **Given** a reply containing a price, date or time that does not pass that check, **when** the output guardrail runs, **then** the reply is not sent and the fallback message is sent in its place.
4. **Given** a grounded fact that does not exist in the tenant's data, **when** a customer asks for it, **then** the assistant says it does not have that information and offers a person.
5. **Given** the eval dataset for grounding, **when** it is run, **then** statements about service details, opening hours and policies meet the grounding threshold set in the eval plan (not yet testable; see open question OQ-6).

### US-C5 — Tell customers they are talking to an assistant

Persona P4 · Milestone M3 · Issue [#14](https://github.com/zishon89us/polyglot-sales-agent/issues/14) · **AI**

As an end customer, I want to know from the start that an automated assistant is replying, so that I am not misled about who I am talking to.

1. **Given** a new session, **when** the first outbound message of any kind is sent, including a template, the unsupported-type reply or the fallback message, **then** it contains the fixed disclosure text: added by code in a free-form message, never written by the model, and part of the approved wording in a template.
2. **Given** the contact's language is a supported language, **when** the disclosure text is added, **then** it is in that language; otherwise it is in the tenant's default language.
3. **Given** a customer asks whether they are talking to a person, **when** the assistant replies, **then** it says it is an automated assistant and offers a person.

### US-C6 — Hand the conversation to a person

Persona P4 · Milestone M4 · Issue [#15](https://github.com/zishon89us/polyglot-sales-agent/issues/15) · **AI**

As an end customer, I want to reach a person when I ask or when the assistant should not continue, so that I am not stuck in a loop.

1. **Given** a customer asks for a person in a supported language, or taps the person button, **when** the message is processed, **then** the session is handed over with reason `requested`.
2. **Given** two consecutive assistant turns in one session that ended in the fallback message because of a guardrail failure, **when** the second fallback is sent, **then** the session is handed over with reason `repeated-failure`; provider errors (US-C15) do not count.
3. **Given** a message on a topic in the dated handover-topic list of the guardrail policy, or a request to access or delete personal data, **when** it is processed, **then** the session is handed over with reason `sensitive-topic` or `data-request` (topic list not yet testable; see OQ-5).
4. **Given** a session that reaches the turn cap or the tenant's daily token budget, **when** the limit is reached, **then** the session is handed over with reason `limit`.
5. **Given** any handover inside business hours, **when** it happens, **then** the customer receives one message saying a person will reply.
6. **Given** any handover outside business hours, **when** it happens, **then** the customer receives one message giving the next opening time and the tenant's support contact.
7. **Given** a handed-over session, **when** staff hand it back, or the session ends through inactivity, **then** the handover ends, so the assistant answers the customer's next message.

### US-C7 — Stop messages on request

Persona P4 · Milestone M3 · Issue [#16](https://github.com/zishon89us/polyglot-sales-agent/issues/16) · **AI**

As an end customer, I want to stop receiving messages by saying so, so that I am not contacted again against my wishes.

1. **Given** a customer sends a keyword from the fixed opt-out list for a supported language, or taps a stop button, **when** it is processed by code, without the model, **then** the contact is marked opted out and one confirmation is sent.
2. **Given** a customer asks to stop in free text in a supported language, **when** the assistant recognises it, **then** the contact is marked opted out and one confirmation is sent.
3. **Given** an opted-out contact, **when** a business-initiated message is due, **then** it is not sent, the reason is logged, and it appears in the withheld-messages list (US-D12).
4. **Given** an opted-out contact, **when** they send a message themselves, **then** the assistant replies as usual within that session, and they remain opted out of business-initiated messages.
5. **Given** an opted-out contact, **when** they send a keyword from the fixed opt-in list or explicitly ask to receive messages again, **then** the opt-out is lifted and the new consent is recorded with its time.

### US-C8 — Resist manipulation and stay in scope

Persona P1 · Milestone M3 · Issue [#17](https://github.com/zishon89us/polyglot-sales-agent/issues/17) · **AI**

As a business owner, I want the assistant to treat all text it reads as data and to refuse requests outside its scope, so that it cannot be talked into leaking data, inventing offers or giving advice it must not give.

1. **Given** a customer message telling the assistant to ignore or change its rules, **when** it is processed, **then** the assistant keeps to its rules and replies that it can help with the business's services.
2. **Given** a customer message asking for the assistant's instructions or prompt, **when** it is processed, **then** no part of the prompt is revealed.
3. **Given** a customer message asking about another business's data or customers, **when** it is processed, **then** no such data is revealed.
4. **Given** instructions placed in owner-entered business data or in a contact's profile name, **when** that text reaches the model, **then** they are treated as data and not followed.
5. **Given** a request for medical, legal or financial advice, **when** the assistant replies, **then** it declines and offers a person.
6. **Given** the red-team eval set, **when** it is run, **then** tool-misuse, prompt-disclosure and cross-tenant cases each pass at 100% (NFR-A1).

### US-C9 — Follow the channel's rules when the business messages first

Persona P1 · Milestone M5 · Issue [#18](https://github.com/zishon89us/polyglot-sales-agent/issues/18)

As a business owner, I want reminders and other business-initiated messages to be sent only in ways the channel allows, so that my number is not restricted.

1. **Given** the contact's last inbound message or call was less than 24 hours ago, **when** any message is sent, **then** a free-form message may be used.
2. **Given** the contact's last inbound message or call was 24 hours ago or more, **when** a business-initiated message is due, **then** an approved template is used, in the contact's last known language if the tenant has that template language enabled, otherwise in the tenant's default language.
3. **Given** no approved template exists for the message in either language, **when** the message is due, **then** it is not sent, the reason is logged, and it appears in the withheld-messages list (US-D12).
4. **Given** staff write a reply 24 hours or more after the contact's last inbound message, **when** they try to send it, **then** it is not sent and the dashboard explains that only a template can be sent.
5. **Given** the account's daily limit on business-initiated recipients is reached, **when** another business-initiated message is due, **then** it is queued and sent when capacity returns, unless that would be after the event it concerns, in which case it is withheld and listed (US-D12).

### US-C10 — Record how every reply was produced

Persona P1 · Milestone M3 · Issue [#19](https://github.com/zishon89us/polyglot-sales-agent/issues/19) · **AI**

As a business owner, I want each model call to leave a record, so that problems can be diagnosed and cost per session is known.

1. **Given** any model call, **when** it completes or fails, **then** one trace is stored, linked to the session, holding prompt name and version, model, input and output token counts, cost, latency, tool calls, guardrail results and outcome.
2. **Given** a stored trace, **when** it is inspected, **then** it contains no message text, no phone number and no contact name.
3. **Given** application logs from an end-to-end run, **when** they are scanned, **then** they contain no message text and no phone number.

### US-C11 — Handle several messages sent in a row

Persona P4 · Milestone M3 · Issue [#47](https://github.com/zishon89us/polyglot-sales-agent/issues/47) · **AI**

As an end customer, I want to send my question as several short messages, as people do in chat, so that I get one coherent answer, not a separate reply to each fragment.

1. **Given** a customer sends several text messages within the batching window (NFR-P5), **when** the window closes, **then** they are answered together in one reply, in the order they were sent.
2. **Given** a new message arrives while a reply is being generated and before it is sent, **when** the new message is stored, **then** the pending reply is discarded and one new reply covers all unanswered messages.
3. **Given** messages for one conversation picked up by two workers, **when** they run at the same time, **then** only one worker processes the conversation and replies are sent in order.
4. **Given** a batch that contains a request for a person together with other text, **when** it is processed, **then** the session is handed over (US-C6) and no other answer is attempted.
5. **Given** a batch that contains text and an unsupported message type, **when** it is processed, **then** one reply answers the text and says the other content could not be read.

### US-C12 — Respond sensibly to messages the assistant cannot read

Persona P4 · Milestone M3 · Issue [#48](https://github.com/zishon89us/polyglot-sales-agent/issues/48)

As an end customer, I want a clear response when I send something other than text, so that I know to type my question or ask for a person, and I am not ignored.

1. **Given** a customer sends only an unsupported message type, **when** the batching window closes, **then** one reply says the assistant can only read text and offers a person, in the contact's last known language or else the tenant's default language.
2. **Given** an image or video with a text caption, **when** it is processed, **then** the caption is treated as a text message and the media is ignored.
3. **Given** an unsupported message, **when** it is processed, **then** its content is not sent to the model and the event is stored with its type.
4. **Given** three consecutive batches in one session that contain no text, **when** the third is processed, **then** the session is handed over with reason `unsupported-content`; any text message resets the count.

### US-C13 — Message customers first only with their agreement

Persona P4 · Milestone M5 · Issue [#49](https://github.com/zishon89us/polyglot-sales-agent/issues/49)

As an end customer, I want to receive reminders only if I agreed to be contacted, so that I am not messaged by a business I never dealt with.

1. **Given** a contact with no recorded consent, **when** a business-initiated message is due, **then** it is not sent, the reason is logged, and it appears in the withheld-messages list (US-D12).
2. **Given** a contact who books an appointment in chat, **when** the booking is created, **then** consent to messages about that booking is recorded with source `chat-booking` and the time.
3. **Given** staff add a booking by hand (US-D9), **when** they tick that the customer agreed to be messaged, **then** consent is recorded with source `staff`, the staff user and the time; without the tick no consent is recorded.
4. **Given** a contact who opted out (US-C7), **when** a business-initiated message is due, **then** the opt-out overrides every consent, whenever it was recorded, until the opt-out is lifted under US-C7.

### US-C14 — Tell staff when a conversation needs them

Persona P3 · Milestone M4 · Issue [#50](https://github.com/zishon89us/polyglot-sales-agent/issues/50)

As a staff agent, I want to be notified when a session is handed over, so that the customer is not left waiting for a person who does not know.

1. **Given** a session is handed over, **when** the handover is recorded, **then** it appears in the dashboard waiting list with its reason and waiting time.
2. **Given** a session is handed over, **when** the handover is recorded, **then** an email is sent to the tenant's notification address, with at most one email per tenant in any 5 minutes, listing all sessions waiting.
3. **Given** the notification email fails to send, **when** 3 attempts have failed, **then** the failure is logged and the waiting list remains the record of what is waiting.
4. **Given** a handed-over session with no staff reply within the handover escalation time, **when** that time passes inside business hours, **then** it is marked overdue at the top of the waiting list and the customer receives one holding message with the tenant's support contact; no further automatic message is sent in that session.
5. **Given** a session handed over outside business hours, **when** the escalation time is counted, **then** it is counted from the next opening time.
6. **Given** the customer writes again while the session is handed over, **when** the message arrives, **then** the assistant does not reply and the message is added to the waiting session.

### US-C15 — Stay usable when the AI provider fails

Persona P4 · Milestone M3 · Issue [#64](https://github.com/zishon89us/polyglot-sales-agent/issues/64) · **AI**

As an end customer, I want a clear message when the assistant cannot answer because of a technical fault, so that I am not left without any reply.

1. **Given** a model call that fails or exceeds 20 seconds, **when** it fails, **then** it is retried up to 3 times in total, waiting 1 second then 4 seconds between attempts.
2. **Given** all 3 attempts have failed, **when** the last one fails, **then** the fallback message is sent, the session is marked `awaiting-retry`, and it is not handed over.
3. **Given** 5 sessions marked `awaiting-retry` within 2 minutes for one provider, **when** the fifth is marked, **then** the service enters degraded mode and each affected tenant's notification address receives one email.
4. **Given** degraded mode, **when** a customer message arrives, **then** the fallback message is sent at most once per session and no model call is attempted for it.
5. **Given** degraded mode, **when** a provider health check, run every 30 seconds, succeeds, **then** degraded mode ends, sessions marked `awaiting-retry` whose last customer message is under 15 minutes old are answered, and one recovery email is sent per affected tenant.
6. **Given** degraded mode, **when** a template reminder is due, **then** it is sent as normal, because it does not need the model.

### US-C16 — Have approved templates before messaging first

Persona P1 · Milestone M5 · Issue [#65](https://github.com/zishon89us/polyglot-sales-agent/issues/65)

As a business owner, I want the templates my pack needs to be submitted and tracked for me, so that reminders can be sent as soon as I am set up.

1. **Given** a pack that defines its templates in Arabic and English, **when** a tenant enables a template language during setup, **then** each of the pack's templates is submitted to the tenant's channel account in that language, in the utility category.
2. **Given** a submitted template, **when** the channel reports its status, **then** the status is stored and shown on the setup screen.
3. **Given** a required template that is not approved in the tenant's default language, **when** setup is evaluated, **then** setup is incomplete (US-D6) and the owner sees which template is waiting or rejected.
4. **Given** an approved template that the channel pauses, rejects, disables or moves to another category, **when** the status change arrives, **then** messages using it are withheld and listed (US-D12) and the owner sees the change.

### US-C17 — Limit one sender's load

Persona P1 · Milestone M3 · Issue [#66](https://github.com/zishon89us/polyglot-sales-agent/issues/66)

As a business owner, I want one phone number to be unable to run up cost or flood my staff, so that abuse or a faulty client does not hurt my business.

1. **Given** a contact who sends more than 20 messages in 5 minutes, **when** the 21st arrives, **then** the assistant sends one notice that it will pause, and does not reply to that contact for 15 minutes.
2. **Given** a contact paused for rate, **when** they send more messages, **then** the messages are stored, no model call is made, no handover is created and no notification is sent.
3. **Given** the 15 minutes have passed, **when** the contact sends a message, **then** the assistant replies as usual.

### US-C18 — Know whether each message arrived

Persona P3 · Milestone M3 · Issue [#67](https://github.com/zishon89us/polyglot-sales-agent/issues/67)

As a staff agent, I want every outbound message to show whether it was delivered, so that I can see when a customer did not receive something.

1. **Given** an outbound message accepted by the channel API, **when** it is accepted, **then** it is stored with status `sent`.
2. **Given** a status event from the channel, **when** it is received, **then** the message's status becomes `delivered`, `read` or `failed`, with the channel's error code on failure.
3. **Given** a send call that fails with a temporary error, **when** it fails, **then** it is retried up to 3 times in total with waits of 2 and 8 seconds, then marked `failed`.
4. **Given** a send call that fails with a permanent error, such as a number that cannot receive messages, **when** it fails, **then** it is marked `failed` without retry.
5. **Given** a failed message, **when** staff open the conversation, **then** the failure is shown on that message, and a failed business-initiated message appears in the withheld-messages list (US-D12).
6. **Given** two outbound messages for one conversation, **when** the second is ready, **then** it is sent only after the first is `delivered`, or 10 seconds after the first was `sent`, whichever is sooner (NFR-R7).

### US-C19 — Record what each session was for and how it ended

Persona P1 · Milestone M5 · Issue [#68](https://github.com/zishon89us/polyglot-sales-agent/issues/68) · **AI**

As a business owner, I want each session to be labelled with what the customer wanted and what happened, so that the rates shown on my dashboard are computed from recorded facts.

1. **Given** a session that has ended through inactivity, **when** it is closed, **then** it is stored with: whether it was an inquiry, whether a booking was created, changed or cancelled, whether it was handed over, and whether it was contained, each as defined in the glossary.
2. **Given** the booking, handover and containment fields, **when** they are set, **then** they are derived by code from recorded events, not judged by the model.
3. **Given** the inquiry field, **when** it is set, **then** it is produced by the model from the session's messages.
4. **Given** the eval set for inquiry classification, **when** it is run, **then** it meets the threshold set in the eval plan (not yet testable; see OQ-6).

## Booking pack

### US-B1 — Ask about services and prices

Persona P4 · Milestone M5 · Issue [#20](https://github.com/zishon89us/polyglot-sales-agent/issues/20) · **AI**

As an end customer, I want to ask what a service costs and what it includes, so that I can decide whether to book.

1. **Given** a service that exists in the tenant's data, **when** a customer asks its price in a supported language, **then** the reply gives the stored price with the tenant's currency.
2. **Given** a service that is not in the tenant's data, **when** a customer asks about it, **then** the assistant says it is not listed and offers a person.
3. **Given** a question that matches more than one service, **when** a customer asks it, **then** the assistant names the matching services and asks which is meant.

### US-B2 — Book an appointment

Persona P4 · Milestone M5 · Issue [#21](https://github.com/zishon89us/polyglot-sales-agent/issues/21) · **AI**

As an end customer, I want to pick a time and book it in the chat, so that I do not have to phone during working hours.

1. **Given** free slots exist for the requested service within the booking horizon, **when** a customer asks to book it, **then** the assistant offers up to 5 free slots.
2. **Given** a customer chooses an offered slot that still has capacity, **when** the booking tool runs, **then** one booking is created and the assistant confirms the service, date, weekday and time.
3. **Given** a customer chooses a slot whose capacity was used in the meantime, **when** the booking tool runs, **then** no booking is created and other free slots are offered.
4. **Given** no free slot exists for the service within the booking horizon, **when** a customer asks to book it, **then** the assistant says so and offers a person.
5. **Given** a customer asks to book without naming a service that exists, **when** the request is processed, **then** the assistant asks which service is wanted.
6. **Given** a contact who already has 3 future bookings, **when** they ask for another, **then** no booking is created and the assistant offers a person.
7. **Given** the same booking request processed twice, **when** the tool runs twice, **then** exactly one booking exists.
8. **Given** any booking, **when** it is stored, **then** it holds only the contact, service, start time, status and timestamps; it has no free-text field.

### US-B3 — Get a reminder and answer it

Persona P4 · Milestone M5 · Issue [#22](https://github.com/zishon89us/polyglot-sales-agent/issues/22) · **AI**

As an end customer, I want a reminder before my appointment that I can answer with one tap, so that I do not forget, and the business knows whether I am coming.

1. **Given** a booking made at least the reminder lead time before its start, for a contact with consent, **when** the lead time before the start is reached, **then** one reminder is sent under US-C9, with Confirm, Reschedule and Cancel buttons.
2. **Given** a booking made less than the reminder lead time before its start, **when** it is created, **then** no reminder is scheduled.
3. **Given** a reminder whose send time falls in quiet hours, **when** it is scheduled, **then** it is sent at the last moment before quiet hours begin.
4. **Given** a reminder was sent, **when** the customer taps Confirm, **then** the booking is marked confirmed.
5. **Given** a reminder was sent, **when** the customer taps Reschedule or Cancel, **then** the assistant continues under US-B4.
6. **Given** a reminder was sent, **when** the customer does not answer, **then** the booking is unchanged and no second reminder is sent.
7. **Given** a booking with a pending reminder, **when** it is rescheduled, **then** the reminder is rescheduled for the new time and any confirmed mark is cleared.
8. **Given** a booking with a pending reminder, **when** it is cancelled, **then** the reminder is cancelled.
9. **Given** an opted-out contact, **when** they book an appointment, **then** no reminder is scheduled and the booking confirmation says that no reminder will be sent unless they opt back in.

### US-B4 — Reschedule or cancel

Persona P4 · Milestone M5 · Issue [#23](https://github.com/zishon89us/polyglot-sales-agent/issues/23) · **AI**

As an end customer, I want to move or cancel my appointment in the chat, so that the slot is freed for someone else.

1. **Given** a contact with one future booking, more than the change cut-off before its start, **when** they ask to reschedule and choose a free slot, **then** the booking moves to the new slot and the old slot becomes free.
2. **Given** a reschedule to a slot whose capacity was used in the meantime, **when** the tool runs, **then** the original booking is kept and other free slots are offered.
3. **Given** a contact with one future booking, more than the change cut-off before its start, **when** they ask to cancel and confirm, **then** the booking is cancelled and the slot becomes free.
4. **Given** a contact with more than one future booking, **when** they ask to reschedule or cancel, **then** the assistant lists them and asks which is meant.
5. **Given** a contact with no future booking, **when** they ask to reschedule or cancel, **then** the assistant says it finds no booking and offers a person.
6. **Given** a booking that starts within the change cut-off, **when** the customer asks to change or cancel it, **then** it is not changed and the session is handed over with reason `late-change`.

### US-B5 — See and book times in the business's time zone

Persona P4 · Milestone M5 · Issue [#51](https://github.com/zishon89us/polyglot-sales-agent/issues/51) · **AI**

As an end customer, I want appointment times shown clearly in the business's local time, so that I arrive at the right time.

1. **Given** a tenant with a configured time zone, **when** slots are offered or a booking is confirmed, **then** each time is given in that time zone with the date and weekday.
2. **Given** a candidate slot that is in the past or sooner than the minimum notice, **when** availability is computed, **then** it is not offered.
3. **Given** a candidate slot that is outside opening hours, inside a blocked period, or does not fit the service's duration before closing, **when** availability is computed, **then** it is not offered.
4. **Given** a daylight-saving change between booking and appointment, **when** the reminder is scheduled, **then** it is timed from the appointment's local start time.

## Dashboard

### US-D1 — Sign in and see only my business

Persona P1 · Milestone M4 · Issue [#28](https://github.com/zishon89us/polyglot-sales-agent/issues/28)

As a business owner, I want to sign in and see only my own business's data, so that my data is private.

1. **Given** a user of tenant A, **when** they sign in with a correct email and password, **then** they see only tenant A's data.
2. **Given** a signed-in user of tenant A, **when** they request a tenant B resource by ID, **then** the request is refused with HTTP 404.
3. **Given** 5 failed sign-in attempts for one account within 15 minutes, **when** a sixth is made, **then** sign-in for that account is refused for 15 minutes.
4. **Given** a signed-in session, **when** it has been idle for 60 minutes or is 12 hours old, **then** it ends and the user must sign in again.

### US-D2 — Keep business information current

Persona P1 · Milestone M5 · Issue [#29](https://github.com/zishon89us/polyglot-sales-agent/issues/29)

As a business owner, I want to edit my services, opening hours and policies myself, so that the assistant always answers with current information.

1. **Given** an owner, **when** they add or edit a service, **then** it is saved with a name, a price of zero or more, a duration of 5 to 480 minutes and a capacity of 1 to 50.
2. **Given** an owner, **when** they enter a value outside those ranges or leave the name empty, **then** it is not saved and the field with the problem is named.
3. **Given** an owner saves a change, **when** a reply is generated 5 seconds or more later, **then** the reply uses the new value.
4. **Given** any business data screen, **when** it is shown, **then** each item shows when it was last updated.
5. **Given** an owner changes opening hours so that existing future bookings fall outside them, **when** they save, **then** the change is saved, the bookings are kept, and the affected bookings are listed for the owner.

### US-D3 — Read conversations and take over

Persona P3 · Milestone M4 · Issue [#30](https://github.com/zishon89us/polyglot-sales-agent/issues/30)

As a staff agent, I want to read any conversation, take it over, reply, and hand it back, so that I handle what the assistant should not.

1. **Given** any conversation of the tenant, **when** staff open it, **then** the full message history is shown, with right-to-left text rendered correctly and the handover reason if there is one.
2. **Given** a session that is not handed over, **when** staff take it over, **then** it is handed over with reason `staff`, and any assistant reply not yet sent is discarded.
3. **Given** a session one staff user has taken, **when** a second staff user opens it, **then** they see who holds it and cannot send until it is released.
4. **Given** a handed-over session, **when** staff hand it back, **then** the assistant does not reply until the customer's next message, and then has the staff messages as context.
5. **Given** a staff reply written inside the reply window, **when** it is sent, **then** it is sent as a free-form reply, including to an opted-out contact, because it answers the contact's own message.
6. **Given** a staff reply, **when** it is sent, **then** it is stored with the staff user who sent it.

### US-D4 — See whether it is working

Persona P1 · Milestone M5 · Issue [#31](https://github.com/zishon89us/polyglot-sales-agent/issues/31)

As a business owner, I want to see the assistant's results for a period I choose, so that I know whether it is worth it.

1. **Given** an owner, **when** they open metrics, **then** they can choose today, the last 7 days, the last 30 days or a custom date range.
2. **Given** sessions exist in the chosen range, **when** metrics are shown, **then** they show first-reply time, inquiry-to-booking rate, no-show rate with the count of unrecorded appointments, handover rate, containment rate, and model cost and channel fees per session, each as defined in the glossary.
3. **Given** a metric whose denominator is zero in the chosen range, **when** it is shown, **then** it reads "no data".

### US-D5 — Export or delete a customer's data

Persona P1 · Milestone M5 · Issue [#32](https://github.com/zishon89us/polyglot-sales-agent/issues/32)

As a business owner, I want to export or delete everything held about one customer, so that I can honour a customer's request.

1. **Given** a contact, **when** the owner requests an export, **then** a JSON file is produced holding the contact record, messages, bookings, and consent and opt-out records.
2. **Given** a contact, **when** the owner requests deletion and confirms, **then** within 24 hours the contact's messages, name and phone number are deleted.
3. **Given** a contact with future bookings, **when** deletion runs, **then** those bookings are cancelled, their slots freed and their reminders cancelled.
4. **Given** a contact who had opted out, **when** deletion runs, **then** only a one-way hash of the phone number is kept, marked opted out, so that the opt-out still applies if the number appears again.
5. **Given** a deleted contact's past bookings and sessions, **when** deletion runs, **then** they are kept without any personal field, so past metrics do not change.
6. **Given** a contact that has already been deleted, **when** the owner searches for it to export or delete, **then** nothing is found and the dashboard says no data is held for that number.
7. **Given** any export or deletion, **when** it runs, **then** it is recorded in the audit log with the user and time, and without the contact's phone number.

### US-D6 — Set up my business and connect its number

Persona P1 · Milestone M4 · Issue [#52](https://github.com/zishon89us/polyglot-sales-agent/issues/52)

As a business owner, I want to set up my business and connect my WhatsApp number, so that the assistant starts answering for me.

1. **Given** an invited owner, **when** they complete setup, **then** the tenant has a name, time zone, default language, enabled template languages, currency, support contact, notification email address and business hours.
2. **Given** a tenant, **when** it is created, **then** it uses exactly one pack.
3. **Given** channel credentials are entered, **when** they are saved, **then** they are verified with the channel, stored encrypted, and never shown again in full.
4. **Given** a tenant missing any required setting, verified credentials, or an approved required template (US-C16), **when** its setup is evaluated, **then** setup is incomplete and the owner sees what is missing.

### US-D7 — Give staff their own limited access

Persona P1 · Milestone M4 · Issue [#53](https://github.com/zishon89us/polyglot-sales-agent/issues/53)

As a business owner, I want to invite staff with an agent role, so that they can handle conversations without changing prices, settings or other users.

1. **Given** an owner, **when** they invite a person by email as owner or agent, **then** an invitation link is emailed that expires after 7 days and can be used once.
2. **Given** an agent-role user, **when** they use the dashboard, **then** they can read and reply to conversations, manage bookings and record attendance, and cannot edit business data, settings or users, or export or delete contact data.
3. **Given** an owner removes a user, **when** the removal is saved, **then** that user's sessions end within 60 seconds and they can no longer sign in.
4. **Given** a removed user held handed-over sessions, **when** the removal is saved, **then** those sessions return to the waiting list unheld.
5. **Given** a staff reply submitted before a removal took effect, **when** the removal is saved, **then** the reply is sent and stored with that user.
6. **Given** a tenant with one owner, **when** that owner tries to remove themselves or change their own role, **then** it is refused.

### US-D8 — Record whether a customer attended

Persona P3 · Milestone M5 · Issue [#54](https://github.com/zishon89us/polyglot-sales-agent/issues/54)

As a staff agent, I want to mark an appointment as attended or missed, so that the no-show rate the owner sees is real.

1. **Given** an appointment whose start time has passed, **when** staff mark it attended or missed, **then** the outcome is stored and counted in the no-show rate.
2. **Given** an appointment whose start time has not passed, **when** staff try to mark it, **then** it is refused.
3. **Given** a recorded outcome, **when** staff change it, **then** the new outcome replaces it and the change is written to the audit log.

### US-D9 — Block time and add bookings by hand

Persona P3 · Milestone M5 · Issue [#55](https://github.com/zishon89us/polyglot-sales-agent/issues/55)

As a staff agent, I want to block time off and to add bookings made by phone or in person, so that the assistant never offers a slot that is already taken.

1. **Given** staff block a period that contains no bookings, **when** a customer asks for availability afterwards, **then** the blocked time is not offered.
2. **Given** staff block a period that contains bookings, **when** they save, **then** they must choose to keep those bookings or cancel the block; nothing is cancelled automatically.
3. **Given** staff add a manual booking in a slot with capacity, **when** they save, **then** the booking is created and the slot's capacity is reduced.
4. **Given** staff add a manual booking in a slot with no capacity, **when** they save, **then** it is refused.

### US-D10 — Get an owner account by invitation

Persona P1 · Milestone M4 · Issue [#69](https://github.com/zishon89us/polyglot-sales-agent/issues/69)

As a business owner, I want to receive an invitation and set my own password, so that I can reach my business's dashboard without anyone else knowing my password.

1. **Given** an operator creates a tenant with an owner email address, **when** it is created, **then** an invitation link is emailed that expires after 7 days and can be used once.
2. **Given** an invited person opens a valid link, **when** they set a password of at least 12 characters, **then** their account is active.
3. **Given** anyone, **when** they look for a way to create an account without an invitation, **then** there is none.
4. **Given** a user who forgot their password, **when** they request a reset, **then** a link valid for 1 hour and usable once is emailed, and the response is the same whether or not the address has an account.

### US-D11 — Change how the assistant behaves for my business

Persona P1 · Milestone M5 · Issue [#70](https://github.com/zishon89us/polyglot-sales-agent/issues/70)

As a business owner, I want to view and change my tenant settings, so that the assistant fits how my business works.

1. **Given** an owner, **when** they open settings, **then** every setting in the glossary's settings table is shown with its current value.
2. **Given** an owner, **when** they save a value inside the allowed range in that table, **then** it applies to events scheduled after the change.
3. **Given** an owner, **when** they enter a value outside the allowed range, **then** it is not saved and the allowed range is shown.

### US-D12 — See bookings and messages that need attention

Persona P3 · Milestone M5 · Issue [#71](https://github.com/zishon89us/polyglot-sales-agent/issues/71)

As a staff agent, I want to see upcoming bookings and any message that was not sent, so that I can act before a customer is let down.

1. **Given** staff, **when** they open bookings, **then** future bookings are listed by start time with service, status and whether confirmed.
2. **Given** staff, **when** they cancel or move a booking, **then** the booking changes, capacity is updated, and the customer is told under US-C9 if they have consent.
3. **Given** a business-initiated message that was withheld or failed, **when** staff open the withheld-messages list, **then** it is listed with the contact, what it was for and the reason.

## Criteria delivered later than their story

A few criteria depend on a story in a later milestone. The story is built in its own milestone and these criteria are completed, and tested, in the milestone shown.

| Criterion | Depends on | Completed in |
| --- | --- | --- |
| US-C11 criterion 4 (hand over on a request inside a batch) | US-C6 | M4 |
| US-C12 criterion 4 (hand over after three unreadable batches) | US-C6 | M4 |
| US-C7 criterion 3 (withheld message is listed) | US-D12 | M5 |
| US-C18 criterion 5 (failed message is listed) | US-D12 | M5 |

In M3, "offers a person" in US-C4, US-C5, US-C8 and US-C12 means the reply tells the customer they can ask for a person. Acting on that request is US-C6, in M4.

## Deferred to v1.1: cash-on-delivery confirmation pack

The maintainer decided on 2026-11-16 that v1.0 ships the core engine, the dashboard and the `booking` pack. The `cod-confirm` pack follows in v1.1. Its four stories keep their issues, moved to the v1.1 milestone, and their text is **not** maintained here. They are known to be incomplete: the independent review's findings R5, R6, R11, R12 and R30 apply to them and must be fixed, and reviewed, before that pack is designed.

| Story | Title | Issue |
| --- | --- | --- |
| US-O1 | Receive new orders from the store | [#24](https://github.com/zishon89us/polyglot-sales-agent/issues/24) |
| US-O2 | Confirm an order and its address | [#25](https://github.com/zishon89us/polyglot-sales-agent/issues/25) |
| US-O3 | Change the address or cancel an order | [#26](https://github.com/zishon89us/polyglot-sales-agent/issues/26) |
| US-O4 | See orders that need a person | [#27](https://github.com/zishon89us/polyglot-sales-agent/issues/27) |

## Deliberately not stories

- Payments, broadcasts, voice and image understanding, billing, translation of conversations for staff, and a dashboard in languages other than English: out of scope for v1.0 (see `vision.md`).
- Deployment, CI, observability, security scanning, the daily retention job (NFR-V4) and the trial second pack that proves pack independence (NFR-M1): engineering work tracked as issues in their milestones, with targets in `nfr.md`.
