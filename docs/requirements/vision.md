# Product vision

Status: draft for maintainer review · Phase 1 (requirements) · Issue #2

## Problem

Many small businesses get most of their sales inquiries as chat messages, not
through a website form. The inquiry is usually short ("how much?", "are you
open tomorrow?"), often arrives outside working hours, and is often in a
language the staff on shift do not write well.

Three things then go wrong:

1. **Slow first reply.** The customer has already messaged a competitor by the
   time someone answers.
2. **Repetitive work.** Staff spend their day retyping the same prices,
   opening hours and availability.
3. **Leaks after the sale.** Appointments are missed because nobody sent a
   reminder; cash-on-delivery parcels are refused at the door because nobody
   confirmed the order.

Existing shared-inbox tools help a team answer faster, but a person still has
to answer. Generic chatbots answer instantly, but from scripted menus, in one
or two languages, and without access to the business's real prices and
calendar.

## Vision

A small business connects its WhatsApp number once and gets an assistant that
replies within seconds, in the customer's own language, using only that
business's data, and that finishes the job: a booked appointment or a
confirmed order. When the assistant should not answer, a person takes over in
the same conversation.

## Who it is for

| User | What they need |
| --- | --- |
| Business owner | More inquiries turned into bookings or delivered orders, without hiring for nights and extra languages |
| Staff agent | To handle only the conversations that need a person, with the history in front of them |
| End customer | A fast, correct answer in their own language, and an easy way to reach a person |

Personas are described in [`personas.md`](personas.md).

## Product principles

1. **Grounded or silent.** The assistant states a price, a time slot or an
   order detail only when it comes from the business's data. Otherwise it says
   it does not know and offers a person.
2. **Any language in, same language out.** No language is special-cased.
3. **A person is always one step away.** Handover is a feature, not a failure.
4. **The niche is configuration.** The core engine does not know whether it is
   serving a clinic or a shop; packs carry that knowledge.
5. **Honest about being automated.** Customers are told they are talking to an
   assistant.
6. **Private by default.** Collect the minimum, isolate every tenant, and
   forget on request.

## MVP scope

The MVP is the core engine, the owner dashboard and two packs.

| Pack | Job it finishes | Primary metric | Supporting metrics |
| --- | --- | --- | --- |
| `booking` | Inquiry → appointment booked → reminder → attended | Inquiry-to-booking rate | Median first-reply time, no-show rate |
| `cod-confirm` | Cash-on-delivery order → confirmed with address before shipping | Order confirmation rate | Refused-delivery rate, time to confirmation |

Across both packs the product also reports handover rate, containment rate
(conversations finished without a person) and model cost per conversation.

Every metric named here is defined precisely in [`glossary.md`](glossary.md).
The refused-delivery rate cannot be computed by the product as currently
scoped, because the store only tells it when an order is created; this is
open question Q1 in the requirements review.

## Success criteria for v1.0.0

These are about the software, because the project has no customers yet.
Business outcomes can only be measured in a pilot.

- Both pack conversations can be completed end to end against the mock
  channel from a fresh clone.
- Grounded, same-language replies pass the eval thresholds in at least six
  languages (thresholds are set in the eval plan, milestone M1).
- A third pack can be added without changing the core engine.
- The non-functional targets in `nfr.md` are met and tested.

## Out of scope for the MVP

- Taking payments inside the product (links to an external gateway only).
- Broadcast or bulk marketing messages.
- Voice notes, image understanding and calls.
- Billing and subscription management.
- Medical, legal or financial advice, in any pack.
- Channels other than WhatsApp, and platform-specific store connectors.

## Assumptions to validate

Nothing below has been tested with real businesses. Each is a risk until a
pilot confirms it; see `risks.md`.

| # | Assumption | How to validate |
| --- | --- | --- |
| A1 | Owners in the target niches lose a meaningful share of inquiries to slow replies | Pilot: compare reply time and booking rate before and after |
| A2 | Customers accept answers from a disclosed automated assistant | Pilot: handover requests and drop-off after the disclosure message |
| A3 | Order confirmation by chat reduces refused cash-on-delivery parcels | Pilot with one store: refused-delivery rate before and after |
| A4 | Multilingual replies matter enough to owners to choose this product | Interviews and pilot language mix |
| A5 | Per-message channel fees and model cost leave room for an affordable price | Cost per conversation from traces, against current published channel pricing |
| A6 | A business's prices, services and hours can be kept current by the owner in a simple editor | Dashboard usability test in the pilot |

## Constraints

- Messaging rules, template approval and pricing are set by Meta and change;
  they must be read from current official documentation before being relied
  on (see `AGENTS.md`, section 2).
- Data-protection law in the target markets applies from the first real
  customer. The first target market is Saudi Arabia.
- Until the maintainer supplies credentials, everything runs against a mock
  channel and a fake model client.
