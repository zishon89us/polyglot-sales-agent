# Product vision

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #2, #61

## What this project is

A complete, runnable, open-source reference implementation of a multilingual
sales assistant for WhatsApp, built to show a full software development
lifecycle and a careful AI development lifecycle in public.

It is **not** positioned as a commercial competitor to the platform owner's
own product. Meta offers Meta Business Agent, an AI agent that answers from a
business's knowledge, books appointments through connected systems and hands
off to people (`docs/compliance.md`, finding 2). The maintainer chose on
2026-11-16 to build this project as a portfolio and learning piece; the
reasoning is recorded in `docs/adr/0001-positioning-and-v1-scope.md`.

What this project offers that a hosted agent does not is that everything is
inspectable: how answers are grounded, how guardrails are enforced and tested,
how quality is measured per language, and how each decision was reached.

## Problem

The statements in this section are **assumptions**. None has been tested with
real businesses, and none is backed by a cited source.

Many small businesses appear to get most of their sales inquiries as chat
messages. The inquiry is usually short, often arrives outside working hours,
and is often in a language the staff on shift do not write well. Three things
then seem to go wrong:

1. **Slow first reply.** The customer has messaged a competitor by the time
   someone answers.
2. **Repetitive work.** Staff retype the same prices, hours and availability.
3. **Missed appointments.** Nobody sent a reminder.

## Vision

A small business connects its WhatsApp number and gets an assistant that
replies within seconds, in the customer's language where that language is
supported, using only that business's data, and that finishes the job: a
booked appointment. When the assistant should not answer, a person takes over
in the same conversation.

## Who it is for

| User | What they need |
| --- | --- |
| Business owner | More inquiries turned into attended appointments, without hiring for nights and extra languages |
| Staff agent | To handle only the conversations that need a person, with the history in front of them |
| End customer | A fast, correct answer in their own language, and an easy way to reach a person |

Personas are described in [`personas.md`](personas.md).

## Product principles

1. **Grounded, or it says it does not know.** The assistant states a grounded
   fact only when it comes from the business's data. Otherwise it says it does
   not have that information and offers a person.
2. **The customer's language, where it is supported.** Replies follow the
   customer's language for every supported language. Messages the business
   sends first use pre-approved templates, which exist only in the template
   languages the business has enabled.
3. **A person is always one step away.** Handover is a feature, not a failure.
4. **The niche is configuration.** The core engine does not know it is serving
   a clinic; the pack carries that knowledge.
5. **Honest about being automated.** Customers are told at the start of every
   session that they are talking to an assistant.
6. **Private by default.** Collect the minimum, isolate every tenant, forget
   on request, and never use conversations to train or evaluate models.

## Scope of v1.0

The core engine, the dashboard and one pack.

| Pack | Job it finishes | Primary metric | Supporting metrics |
| --- | --- | --- | --- |
| `booking` | Inquiry → appointment booked → reminder → attended | Inquiry-to-booking rate | First-reply time, no-show rate |

The dashboard also reports handover rate, containment rate, model cost per
session and channel fees per session. Every metric is defined in
[`glossary.md`](glossary.md) and listed in story US-D4.

Version 1.0 runs end to end against a mock of the channel. Connecting a live
WhatsApp number is supported by the design but is an optional step that needs
the maintainer's own Meta account (`AGENTS.md`, section 10).

## Success criteria for v1.0

These are about the software, because the project has no customers.

- The booking conversation can be completed end to end against the mock
  channel from a fresh clone.
- Every acceptance criterion in `user-stories.md` is covered by an automated
  test, and every AI-marked story by eval cases.
- Eval thresholds are met in every supported language. The thresholds are set
  in the eval plan from a recorded baseline (open question OQ-6), so this
  criterion is not testable until then.
- A second, trivial pack can be added without changing the core engine
  (NFR-M1).
- The non-functional targets in `nfr.md` are met and tested.

## Out of scope for v1.0

- The `cod-confirm` pack (cash-on-delivery order confirmation). Deferred to
  v1.1; see the end of `user-stories.md`.
- Taking payments inside the product.
- Broadcast or bulk marketing messages.
- Voice notes, image understanding and calls.
- Billing and subscription management.
- Medical, legal or financial advice.
- Channels other than WhatsApp.
- A dashboard in languages other than English, and translation of
  conversations for staff.
- Open sign-up. Accounts are created by invitation.

## Assumptions to validate

Each is a risk until tested; see `risks.md`. Without a pilot, they stay
assumptions.

| # | Assumption | How it could be validated |
| --- | --- | --- |
| A1 | Owners in the target niche lose a meaningful share of inquiries to slow replies | Pilot: compare reply time and booking rate before and after |
| A2 | Customers accept answers from a disclosed automated assistant | Pilot: handover requests and drop-off after the disclosure |
| A4 | Replies in the customer's language matter enough for an owner to choose this kind of product | Interviews; pilot language mix |
| A5 | Channel fees plus model cost leave room for an affordable price. Since 1 October 2026 the channel charges for every reply beyond a free monthly allowance (`docs/compliance.md`, finding 1) | Cost per session from traces and channel-reported fees, against the published rate for the market |
| A6 | An owner will keep prices, services and hours current in a simple editor | Dashboard usability test in a pilot |
| A7 | An English-only dashboard is usable by owners and staff in the target market | Pilot; persona P1 and P3 may not read English |
| A8 | Staff can handle conversations without translation | Pilot; staff may not read every language customers write |
| A9 | Arabic and English templates cover enough customers for reminders to be useful | Pilot language mix |

A3, about cash-on-delivery, is deferred with that pack.

## Constraints

- The channel's rules, fees and limits are set by Meta and change. They are
  summarised with sources and dates in `docs/compliance.md` and must be
  re-read before they are relied on.
- Data-protection law in the first target market, Saudi Arabia, applies from
  the first real customer. `docs/compliance.md` lists the questions that need
  a lawyer. Until they are answered, no real customer data is processed.
- Until the maintainer supplies credentials, everything runs against a mock
  channel and a fake model client.
