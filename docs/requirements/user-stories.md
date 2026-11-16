# MVP user stories

Status: draft for maintainer review · Phase 1 (requirements) · Issue #3

The MVP has 23 stories. Each has its own issue, which is where the work is tracked; this document is the readable overview. Personas are in [`personas.md`](personas.md). Numeric targets referred to as "the target" are set in `nfr.md`.

Stories marked **AI** change or depend on model behaviour and need eval cases as well as tests.

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
| US-C9 | Follow the channel's rules for business-initiated messages | P1 | M4 | [#18](https://github.com/zishon89us/polyglot-sales-agent/issues/18) |
| US-C10 | Record how every reply was produced (AI) | P1 | M3 | [#19](https://github.com/zishon89us/polyglot-sales-agent/issues/19) |
| US-B1 | Ask about services and prices (AI) | P4 | M4 | [#20](https://github.com/zishon89us/polyglot-sales-agent/issues/20) |
| US-B2 | Book an appointment (AI) | P4 | M4 | [#21](https://github.com/zishon89us/polyglot-sales-agent/issues/21) |
| US-B3 | Get a reminder and confirm it (AI) | P4 | M4 | [#22](https://github.com/zishon89us/polyglot-sales-agent/issues/22) |
| US-B4 | Reschedule or cancel (AI) | P4 | M4 | [#23](https://github.com/zishon89us/polyglot-sales-agent/issues/23) |
| US-O1 | Receive new orders from the store | P2 | M5 | [#24](https://github.com/zishon89us/polyglot-sales-agent/issues/24) |
| US-O2 | Confirm an order and its address (AI) | P4 | M5 | [#25](https://github.com/zishon89us/polyglot-sales-agent/issues/25) |
| US-O3 | Change the address or cancel an order (AI) | P4 | M5 | [#26](https://github.com/zishon89us/polyglot-sales-agent/issues/26) |
| US-O4 | See orders that need a person (AI) | P2 | M5 | [#27](https://github.com/zishon89us/polyglot-sales-agent/issues/27) |
| US-D1 | Sign in and see only my business | P1 | M5 | [#28](https://github.com/zishon89us/polyglot-sales-agent/issues/28) |
| US-D2 | Keep business information current | P1 | M5 | [#29](https://github.com/zishon89us/polyglot-sales-agent/issues/29) |
| US-D3 | Read conversations and take over | P3 | M5 | [#30](https://github.com/zishon89us/polyglot-sales-agent/issues/30) |
| US-D4 | See whether it is working | P1 | M5 | [#31](https://github.com/zishon89us/polyglot-sales-agent/issues/31) |
| US-D5 | Export or delete a customer's data | P1 | M5 | [#32](https://github.com/zishon89us/polyglot-sales-agent/issues/32) |

## Core engine

### US-C1 — Receive every inbound message exactly once

Persona P4 · Milestone M2 · Issue [#10](https://github.com/zishon89us/polyglot-sales-agent/issues/10)

As an end customer, I want my message to be received even if the channel retries or the service restarts, so that I get one reply, not none and not two.

1. **Given** the channel delivers a signed inbound message, **when** the webhook is called, **then** the event is stored, queued, and acknowledged with HTTP 200 within the target in `nfr.md`.
2. **Given** the same message ID is delivered twice, **when** the worker processes both deliveries, **then** exactly one reply is sent.
3. **Given** a request has a missing or invalid signature, **when** the webhook is called, **then** it is rejected and nothing is stored or queued.

### US-C2 — Keep each business's data separate

Persona P1 · Milestone M2 · Issue [#11](https://github.com/zishon89us/polyglot-sales-agent/issues/11)

As a clinic owner, I want messages to my number to be handled only with my business's data, so that another business's prices or customers never appear in my conversations.

1. **Given** two tenants each with their own number and data, **when** a message arrives on tenant A's number, **then** the conversation, retrieval and reply use only tenant A's records.
2. **Given** a query or tool call scoped to tenant A, **when** it requests a record owned by tenant B, **then** the record is not returned and the attempt is logged.

### US-C3 — Reply in the customer's language

Persona P4 · Milestone M3 · Issue [#12](https://github.com/zishon89us/polyglot-sales-agent/issues/12) · **AI**

As an end customer, I want the reply in the language I wrote in, so that I can understand it without translating.

1. **Given** a customer writes in a language covered by the eval set, **when** the assistant replies, **then** the reply is in that same language.
2. **Given** a customer writes their language in Latin letters or mixes two languages, **when** the assistant replies, **then** the reply follows the customer's dominant language and script.
3. **Given** a customer switches language mid-conversation, **when** the assistant replies to the new message, **then** the reply uses the new language.

### US-C4 — Answer only from the business's data

Persona P1 · Milestone M3 · Issue [#13](https://github.com/zishon89us/polyglot-sales-agent/issues/13) · **AI**

As a clinic owner, I want the assistant to state prices, services, hours and policies only from my data, so that customers are never told something untrue about my business.

1. **Given** the answer exists in the tenant's data, **when** a customer asks for it, **then** the reply states it and matches the stored value exactly.
2. **Given** the answer does not exist in the tenant's data, **when** a customer asks for it, **then** the assistant says it does not have that information and offers a person.
3. **Given** any reply containing a price, time or policy, **when** output guardrails run, **then** a value not traceable to retrieved data or a tool result blocks the reply and triggers the fallback.

### US-C5 — Tell customers they are talking to an assistant

Persona P4 · Milestone M3 · Issue [#14](https://github.com/zishon89us/polyglot-sales-agent/issues/14) · **AI**

As an end customer, I want to know from the start that an automated assistant is replying, so that I am not misled about who I am talking to.

1. **Given** a new conversation, **when** the assistant sends its first message, **then** the message states, in the customer's language, that it is an automated assistant.
2. **Given** a customer asks whether they are talking to a person, **when** the assistant replies, **then** it says it is an automated assistant and offers a person.

### US-C6 — Hand the conversation to a person

Persona P4 · Milestone M4 · Issue [#15](https://github.com/zishon89us/polyglot-sales-agent/issues/15) · **AI**

As an end customer, I want to reach a person when I ask or when the assistant cannot help, so that I am not stuck in a loop.

1. **Given** a customer asks for a person in any language, **when** the assistant processes the message, **then** the conversation is marked handed over, the customer is told a person will reply, and the assistant stops replying.
2. **Given** the assistant fails its guardrails or cannot complete the task twice in a row, **when** the next message arrives, **then** the conversation is handed over with the reason recorded.
3. **Given** a complaint or a sensitive topic defined in the guardrail policy, **when** it is detected, **then** the conversation is handed over.

### US-C7 — Stop messages on request

Persona P4 · Milestone M3 · Issue [#16](https://github.com/zishon89us/polyglot-sales-agent/issues/16) · **AI**

As an end customer, I want to stop receiving messages by saying so, so that I am not contacted again against my wishes.

1. **Given** a customer sends an opt-out request in any language, **when** it is processed, **then** the contact is marked opted out and one confirmation is sent.
2. **Given** a contact is opted out, **when** any business-initiated message is attempted, **then** it is not sent and the attempt is logged.

### US-C8 — Resist manipulation and stay in scope

Persona P1 · Milestone M3 · Issue [#17](https://github.com/zishon89us/polyglot-sales-agent/issues/17) · **AI**

As a clinic owner, I want the assistant to ignore instructions hidden in customer messages and to refuse out-of-scope requests, so that it cannot be talked into leaking data, inventing discounts or giving advice it must not give.

1. **Given** a message that tells the assistant to ignore its rules, reveal its prompt or act for another tenant, **when** it is processed, **then** no rule is broken, no prompt or cross-tenant data is revealed, and no unintended tool is called.
2. **Given** a request for medical, legal or financial advice, **when** the assistant replies, **then** it declines and offers a person.
3. **Given** the red-team eval set, **when** it is run, **then** tool-misuse cases pass at 100%.

### US-C9 — Follow the channel's rules for business-initiated messages

Persona P1 · Milestone M4 · Issue [#18](https://github.com/zishon89us/polyglot-sales-agent/issues/18)

As a clinic owner, I want reminders and confirmations to be sent in a way the channel allows, so that my number is not restricted.

1. **Given** the customer's last message is inside the channel's free-reply window, **when** the assistant replies, **then** a free-form message is sent.
2. **Given** the window has closed or the business is starting the conversation, **when** a message is due, **then** only an approved template is sent, or nothing if none applies.

### US-C10 — Record how every reply was produced

Persona P1 · Milestone M3 · Issue [#19](https://github.com/zishon89us/polyglot-sales-agent/issues/19) · **AI**

As a clinic owner, I want each assistant reply to carry a record of the prompt version, model, tokens, cost, latency and guardrail results, so that problems can be diagnosed and cost per conversation is known.

1. **Given** any model call, **when** it completes or fails, **then** one trace row is stored and linked to the conversation.
2. **Given** stored logs and traces, **when** they are inspected, **then** phone numbers and message text are redacted from logs.

## Booking pack

### US-B1 — Ask about services and prices

Persona P4 · Milestone M4 · Issue [#20](https://github.com/zishon89us/polyglot-sales-agent/issues/20) · **AI**

As an end customer, I want to ask what a service costs and what it includes, so that I can decide whether to book.

1. **Given** a service exists in the clinic's data, **when** a customer asks its price in any language, **then** the reply gives the stored price and currency.
2. **Given** a service that is not offered, **when** a customer asks about it, **then** the assistant says it is not listed and offers a person.

### US-B2 — Book an appointment

Persona P4 · Milestone M4 · Issue [#21](https://github.com/zishon89us/polyglot-sales-agent/issues/21) · **AI**

As an end customer, I want to pick a time and book it in the chat, so that I do not have to phone during working hours.

1. **Given** free slots exist, **when** a customer asks to book a service, **then** the assistant offers real free slots and, once one is chosen, creates the booking and confirms it.
2. **Given** the chosen slot was taken in the meantime, **when** the booking is attempted, **then** no double booking is created and other slots are offered.
3. **Given** the same booking request is processed twice, **when** the tool runs twice, **then** exactly one booking exists.

### US-B3 — Get a reminder and confirm it

Persona P4 · Milestone M4 · Issue [#22](https://github.com/zishon89us/polyglot-sales-agent/issues/22) · **AI**

As an end customer, I want a reminder before my appointment with a way to confirm or change it, so that I do not forget, and the clinic knows whether I am coming.

1. **Given** a booking with a reminder due, **when** the reminder time arrives, **then** one reminder is sent under the rules of US-C9.
2. **Given** a reminder was sent, **when** the customer confirms, **then** the booking is marked confirmed.
3. **Given** an opted-out contact, **when** a reminder is due, **then** no reminder is sent.

### US-B4 — Reschedule or cancel

Persona P4 · Milestone M4 · Issue [#23](https://github.com/zishon89us/polyglot-sales-agent/issues/23) · **AI**

As an end customer, I want to move or cancel my appointment in the chat, so that the slot is freed for someone else.

1. **Given** an existing booking, **when** the customer asks to reschedule and picks a free slot, **then** the booking moves and the old slot becomes free.
2. **Given** an existing booking, **when** the customer cancels, **then** the booking is cancelled and the slot becomes free.

## Cash-on-delivery confirmation pack

### US-O1 — Receive new orders from the store

Persona P2 · Milestone M5 · Issue [#24](https://github.com/zishon89us/polyglot-sales-agent/issues/24)

As a store owner, I want my store to notify the assistant of each new cash-on-delivery order, so that confirmation starts without my doing anything.

1. **Given** a correctly signed `order.created` webhook, **when** it is received, **then** the order is stored for the right tenant and a confirmation is scheduled.
2. **Given** an unsigned, wrongly signed or repeated webhook, **when** it is received, **then** it is rejected or ignored and no duplicate order is created.

### US-O2 — Confirm an order and its address

Persona P4 · Milestone M5 · Issue [#25](https://github.com/zishon89us/polyglot-sales-agent/issues/25) · **AI**

As an end customer, I want to confirm my order and delivery address by replying, so that the right parcel reaches the right place.

1. **Given** a new order, **when** the confirmation is sent, **then** it lists the items, total and address in the customer's language and asks to confirm, change or cancel.
2. **Given** a confirmation was sent, **when** the customer confirms, **then** the order is marked confirmed with a timestamp.

### US-O3 — Change the address or cancel an order

Persona P4 · Milestone M5 · Issue [#26](https://github.com/zishon89us/polyglot-sales-agent/issues/26) · **AI**

As an end customer, I want to correct my address or cancel before shipping, so that I do not have to refuse the parcel at the door.

1. **Given** an unshipped order, **when** the customer gives a new address, **then** the address is updated, read back, and confirmed.
2. **Given** an unshipped order, **when** the customer cancels, **then** the order is marked cancelled.

### US-O4 — See orders that need a person

Persona P2 · Milestone M5 · Issue [#27](https://github.com/zishon89us/polyglot-sales-agent/issues/27) · **AI**

As a store owner, I want a list of orders with no reply or an unclear answer, so that I only chase the ones that need it.

1. **Given** a confirmation with no reply after the configured wait, **when** the wait ends, **then** one follow-up is sent under the rules of US-C9, and after a second wait the order is flagged.
2. **Given** a reply the assistant cannot classify, **when** it is processed, **then** the order is flagged and the conversation handed over.

## Owner dashboard

### US-D1 — Sign in and see only my business

Persona P1 · Milestone M5 · Issue [#28](https://github.com/zishon89us/polyglot-sales-agent/issues/28)

As a clinic owner, I want to sign in and see only my own business's data, so that my data is private.

1. **Given** a user of tenant A, **when** they sign in, **then** they see only tenant A's data.
2. **Given** a signed-in user of tenant A, **when** they request a tenant B resource by ID, **then** the request is refused.
3. **Given** repeated failed sign-ins, **when** the limit is reached, **then** further attempts are rate limited.

### US-D2 — Keep business information current

Persona P1 · Milestone M5 · Issue [#29](https://github.com/zishon89us/polyglot-sales-agent/issues/29)

As a clinic owner, I want to edit services, prices, opening hours and policies myself, so that the assistant always answers with current information.

1. **Given** an owner changes a price, **when** a customer asks for it afterwards, **then** the reply uses the new price.
2. **Given** invalid input such as a negative price, **when** it is saved, **then** it is rejected with a clear message.

### US-D3 — Read conversations and take over

Persona P3 · Milestone M5 · Issue [#30](https://github.com/zishon89us/polyglot-sales-agent/issues/30)

As a staff agent, I want to read any conversation, take it over, reply, and hand it back, so that I handle what the assistant should not.

1. **Given** an open conversation, **when** an agent takes over, **then** the assistant stops replying in it until it is handed back.
2. **Given** a handed-over conversation, **when** the agent opens it, **then** the full history and the handover reason are shown, with right-to-left text rendered correctly.

### US-D4 — See whether it is working

Persona P1 · Milestone M5 · Issue [#31](https://github.com/zishon89us/polyglot-sales-agent/issues/31)

As a clinic owner, I want to see reply time, bookings or confirmations, handovers and cost, so that I know whether the assistant is worth it.

1. **Given** conversations exist in a period, **when** the owner opens metrics, **then** median first-reply time, inquiry-to-booking or confirmation rate, handover rate and cost per conversation are shown for that period.
2. **Given** no data in a period, **when** the owner opens metrics, **then** an empty state is shown, not zeros presented as results.

### US-D5 — Export or delete a customer's data

Persona P1 · Milestone M5 · Issue [#32](https://github.com/zishon89us/polyglot-sales-agent/issues/32)

As a clinic owner, I want to export or delete everything held about one customer, so that I can honour a customer's request.

1. **Given** a contact with conversations, **when** the owner requests an export, **then** a file with that contact's data is produced.
2. **Given** a contact with conversations, **when** the owner requests deletion, **then** the contact's messages and personal fields are deleted or anonymised and the action is recorded in the audit log.

## Deliberately not stories

- Payments, broadcasts, voice and images, billing: out of scope (see `vision.md`).
- Deployment, CI, observability and security scanning: engineering work tracked as issues in their milestones, with targets in `nfr.md`, not as user stories.
