# Personas

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #2, #61

These personas are invented to guide design. They are not based on interviews
and must be revised after a pilot, if one happens. No real person or business
is described.

Stories name three personas: P1 (business owner), P3 (staff agent) and P4
(end customer). P2 belongs to the pack deferred to v1.1.

## P1 — Business owner (shown here as the owner of a small clinic)

The core engine and the dashboard serve any business owner. The `booking`
pack is designed around this example.

**Context.** Runs a dental clinic with two chairs and a receptionist who works
day shifts. Advertises on social media with a "message us" button. Most
inquiries arrive in the evening.

**Goals**
- Fill the appointment book without paying for evening reception cover.
- Stop losing patients who ask a price at night and never hear back.
- Reduce missed appointments.

**Pain points**
- Wakes up to a queue of unanswered messages; some of those people have
  already booked elsewhere.
- Patients write in several languages; the receptionist is fluent in one.
- No easy way to see how many inquiries became bookings.

**What they need from the product**
- Correct prices and real availability in every reply; a wrong price is worse
  than no reply.
- Certainty that the assistant never gives clinical advice.
- A dashboard they can understand in a minute, and the ability to change a
  price themselves.

**Technical comfort.** Uses a phone for everything; will not read
documentation.

**Known mismatches with v1.0**
- The dashboard is in English only (assumption A7).
- Connecting a WhatsApp number needs steps in Meta's own tools that this
  persona is unlikely to complete alone. Version 1.0 assumes the operator
  helps (open question OQ-2).
- Two chairs means two patients at once. Version 1.0 models this as a
  capacity of 2 per time slot for a service, not as two schedulable chairs.

## P2 — Owner of a small online store (deferred to v1.1)

Kept for the `cod-confirm` pack. Not used by any v1.0 story. The independent
review found that this persona's main need, getting the confirmation result
back so that only confirmed orders ship, had no story (finding R6). That must
be fixed when the pack is taken up.

## P3 — Staff agent

**Context.** The receptionist. Shares the business's WhatsApp number with the
assistant.

**Goals**
- Spend time only on conversations that need judgment.
- Never repeat a question the customer has already answered.

**Pain points**
- Fears the assistant will say something wrong and they will take the blame.
- Loses track of who has been answered when several people use one phone.

**What they need from the product**
- A clear signal when a conversation is handed over, and why.
- The full history of the conversation.
- A way to take over at any moment and to hand back.
- A view of upcoming bookings and of any reminder that was not sent.

**Known mismatch with v1.0.** The history is shown in the language the
customer wrote. There is no translation (assumption A8), so a conversation in
a language this person does not read can only be handled by someone who does.

## P4 — End customer

**Context.** Saw an advert and is messaging from a phone, often late in the
day. May write in a first language, a second language, a mix of both, or
their language typed in Latin letters.

**Goals**
- A quick, correct answer to a simple question.
- To finish the task (book, change, cancel) without phoning anyone.

**Pain points**
- Scripted menus that do not understand free text.
- Being answered in a language they did not write in.
- Not knowing whether a person or a machine is replying.

**What they need from the product**
- Replies in their own language within seconds.
- Honesty when the assistant does not know, and a person on request.
- A way to stop receiving messages, respected immediately.

## Not a persona for v1.0

- **Marketing manager running campaigns.** Broadcasts are out of scope.
- **Developer integrating a custom system.** There is no public API.
