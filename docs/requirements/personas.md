# Personas

Status: draft for maintainer review · Phase 1 (requirements) · Issue #2

These personas are invented to guide design. They are not based on interviews
and must be revised after the first pilot. No real person or business is
described.

## P1 — Owner of a small clinic (`booking` pack)

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

## P2 — Owner of a small online store (`cod-confirm` pack)

**Context.** Sells clothing through a hosted store. Most customers choose
cash on delivery. Ships a few dozen parcels a day through a courier.

**Goals**
- Fewer parcels refused or returned, because each one costs shipping both
  ways.
- Correct addresses before the parcel leaves.

**Pain points**
- Phones customers one by one to confirm orders; many do not pick up.
- Fake and impulse orders are only discovered at the door.
- Confirmation calls happen during working hours, when customers are also at
  work.

**What they need from the product**
- A confirmation message sent automatically after each order, with a clear
  confirm, change or cancel choice.
- The result written back so that only confirmed orders are shipped.
- A list of orders that need a person: no reply, changed address, unclear
  answer.

**Technical comfort.** Can paste a webhook URL into store settings if given
exact steps.

## P3 — Staff agent

**Context.** The receptionist or the store's customer-service person. Shares
the business's WhatsApp number with the assistant.

**Goals**
- Spend time only on conversations that need judgment.
- Never repeat a question the customer has already answered.

**Pain points**
- Fears the assistant will say something wrong and they will take the blame.
- Loses track of who has been answered when several people use one phone.

**What they need from the product**
- A clear signal when a conversation is handed over, and why.
- The full history, readable even when the customer wrote in another
  language.
- A way to take over at any moment and to hand back.

## P4 — End customer

**Context.** Saw an advert or placed an order, and is messaging from a phone,
often late in the day. May write in a first language, a second language, a
mix of both, or their language typed in Latin letters.

**Goals**
- A quick, correct answer to a simple question.
- To finish the task (book, confirm, change) without phoning anyone.

**Pain points**
- Scripted menus that do not understand free text.
- Being answered in a language they did not write in.
- Not knowing whether a person or a machine is replying.

**What they need from the product**
- Replies in their own language within seconds.
- Honesty when the assistant does not know, and a person on request.
- A way to stop receiving messages, respected immediately.

## Not a persona for the MVP

- **Marketing manager running campaigns.** Broadcasts are out of scope.
- **Developer integrating a custom system.** A public API for third parties is
  out of scope; only the signed `order.created` webhook is supported.
