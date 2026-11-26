# Design note: the handover record (M3 unit U11)

Status: proposed by the agent, 2026-11-27, before any code, and not yet
reviewed. Issue #310. The maintainer answered row 29 of the decisions
page with yes on 2026-11-27: M3 builds the record. Stories: US-C6,
criteria 1, 2, 3, 5, 6, 8 (its first half), 9 and 10 (its part);
US-C8, 5; US-C11, 4. State machines, sections 1 (steps 10, 11 and 15)
and 2. Guardrail policy, section 6.

A handover is the product telling a customer that a person will reply.
**In M3 no person can.** There is no queue, no screen and no staff
user: those are M4. What M3 builds is the record, the assistant's
silence while it lasts, and the one message that says so. This is
acceptable only because nothing is live (plan, question 1).

## 1. What is built, and what is not

| Built | Not built (unit or milestone) |
| --- | --- |
| The `handovers` table, with its seven states as the state machines name them | The states `in-progress`, `followed-up`, `handed-back` and `answered` are never entered: they need staff (M4) |
| A trigger creates a handover in `waiting`, or adds its reason to the open one, or attaches a `detached` one again (H1) | The triggers of U10 (the emergency phrase, three batches with no text), U12 (limits) and U15 (provider failure) |
| The triggers that exist now: the person button; the model's flags for a person, a sensitive topic, a data request and an emergency; two fallbacks in a row | |
| A handed-over session is not answered by the assistant (H3) | What staff see, notifications, claiming, the escalation clock, the holding message, the follow-up (M4) |
| The customer is told once: the handover text, in or out of business hours, or the emergency text | The emergency email and its hourly ceiling (U10, M4) |
| When the session ends, the handover is `detached`, and the assistant answers the next message | The 14-day and 7-day timers as timers (M4). Here a `detached` handover over 14 days old is closed when the next trigger finds it, and not before |
| The person button on the fallback, now that a tap does something | The button on the unsupported-type reply (U10 sends that text) |

Because the timers are not built, invariant H2 (every handover reaches
an end even if nobody acts) **does not hold in M3**: a detached
handover whose customer never writes again stays `detached`.

## 2. The triggers

| # | Trigger | Where it is decided | Reason | Urgent |
| --- | --- | --- | --- | --- |
| G1 | A tap on the person button is in the batch | The turn, before the model is called (step 11) | `requested` | |
| G2 | The answer's flag `asks-for-person` | The turn, after the answer (step 15) | `requested` | |
| G3 | The flag `sensitive-topic` | The same | `sensitive-topic` | |
| G4 | The flag `data-request` | The same | `data-request` | |
| G5 | The flag `emergency` | The same | `emergency` | Yes |
| G6 | The channel accepts a fallback, and the session's count of fallbacks in a row is then 2 or more | The step that records the send | `repeated-failure` | |

Several flags on one answer add each their reason, in the order of the
table.

**G1 to G5 discard the model's reply** (guardrail policy, O2). Under G1
the model is not called at all. Under G2 to G5 the answer's reply is
not checked and not sent, whatever it says, and what it said of the
language is not kept: the fixed text is the turn's reply. US-C11, 4: a
request for a person beside other text hands over, and no other answer
is attempted.

The flags `asks-to-stop` and `asks-to-resume` are still dropped (U10).
With `asks-if-person` beside a handover flag, the fixed answer to that
question goes before the handover text, in the one message.

**An answer that does not match the schema has no flags.** A customer
whose request for a person produced such an answer gets the fallback,
whose button is now there.

**G6 is decided when the fallback is sent**, as US-C6, 2 says, not when
it is stored. The step that records the send returns the count; if it
is 2 or more the worker hands over in a second transaction. If the
worker stops between the two, no handover is made then; the next
fallback accepted finds the count at 3 and makes it. The count is not
set back by a handover.

## 3. What a trigger does

One function, in one transaction, under the conversation's lock:

| # | The contact's open handover | Result | The customer is told |
| --- | --- | --- | --- |
| H-a | None | A new one in `waiting`, attached to the session, with the reason | Yes |
| H-b | `waiting`, attached to this session | The reason is added if it is not there. Stays | No, unless H-e |
| H-c | `detached`, last detached under 14 days ago | Attached to this session, `waiting`; the reason added | Yes |
| H-d | `detached`, 14 days or more ago | Closed as `closed-unanswered` with reason `expired`; then as H-a | Yes |
| H-e | Any, and the reason is `emergency` | As above; `urgent` is set and never cleared for that handover | The emergency text, unless one was sent for this handover in the last 60 minutes |
| H-f | `waiting`, attached to **another** session | Cannot be: a session's end detaches it (section 5), and a contact has one conversation with one open session. If found, it is treated as H-c | Yes |

A partial unique index holds one open handover for a contact, so two
triggers at once cannot make two (H1): the second fails on the index
and is tried again as H-b.

"The reason is added": `reasons` is a list without repeats, in the
order the reasons first came.

## 4. What the customer is told (US-C6, 5 and 6)

| The trigger | Business hours | Text |
| --- | --- | --- |
| Not an emergency | Open now | `handover-in-hours` |
| Not an emergency | Closed now | `handover-out-of-hours`, with the next opening and the support contact |
| An emergency | Either | `emergency` |

- **Open now**: the turn's clock, in the tenant's time zone, falls in
  one of the tenant's business hours for that weekday. A period that
  closes at `24:00` runs to midnight.
- **The next opening**: the first start of a period after now, within
  the next 8 days, written as `YYYY-MM-DD HH:MM` in the tenant's time
  zone. Digits only, so that it reads the same in every language; a
  weekday's name would need a translation nobody has checked. If the
  tenant has no business hours at all, the in-hours text is sent: there
  is no opening to give.
- **The support contact** is the tenant's setting; a tenant that
  answers has one. If the text cannot be filled (U8's rules refuse the
  value), the in-hours text is sent.
- The language is chosen as for every fixed text (U8, section 3). For
  G1 and G6 there is no answer to give a language; for G2 to G5 the
  answer's is not used, as for the fallback.

**How it is stored.** Under G1 to G5 the text is the turn's reply: a
message of class `assistant-reply` with no body and the text as its
fixed part, as the fallback is. So it is dropped for a newer message
and discarded as a reply is, **and the handover is made in the same
transaction that stores it**: a turn that stores nothing hands nothing
over, and its next try decides again. Under G6 it is a message of
class `system-reply`, stored and queued in the transaction that makes
the handover.

A message of ours that tells of a handover carries the mark
`messages.handover_id`.

**Told once, and what "once" is.** One message for each time a
handover becomes attached (H-a, H-c, H-d), and the emergency text under
H-e. If that message is then discarded for a newer customer message,
the customer's next message finds the session handed over and gets
nothing (section 5): **the customer was then never told.** To close
this, a handed-over session whose handover has no message that was
sent, delivered or read, and none waiting, is told again by the next
turn. In the follow-up issue if the review finds this is not enough.

## 5. A handed-over session (H3, step 10)

A session is handed over exactly while a handover in `waiting` (or, in
M4, `in-progress`) is attached to it.

| # | Event in a handed-over session | Result |
| --- | --- | --- |
| S1 | The customer writes | The batch is marked as dealt with. No model call, no reply, no trace. One line `turn-skipped handed-over` |
| S2 | The customer taps the person button | As S1: the reason `requested` is added if it is not there |
| S3 | A turn was already calling the model when the handover was made by another path (G6) | Its reply is not stored: the store step refuses a reply for a handed-over session, marks the batch and reports `handed-over` |
| S4 | A reply of the assistant, stored before the handover, is still waiting to be sent | It is discarded when the handover is made: the customer is not told "a person will reply" and then answered by the assistant |
| S5 | The session ends (24 hours with no message) | The handover becomes `detached`, in the place that ends a session. The next message starts a new session, which the assistant answers (US-C6, 8) |
| S6 | The fallback count, the disclosure | Unchanged by any of this. The handover text carries the disclosure if it is the first message of the session |

Step 10 comes before step 11 in the order of checks: S2 is step 10's.

The checks of steps 5 to 9 (opt-out, the rate pause, a tenant not
answering) are other units'. A tenant that is not answering is already
stopped before the model is called; a handover is not made for it by
G1, since the turn stops first.

## 6. The fallback's button

The fallback is stored with the `person` button (row 50), since a tap
now hands over (G1). The send step leaves it off where the channel
would refuse it (U8, D9).

## 7. The database

Migration 0013:

- `handovers`: the tenant, the contact, the session (null unless
  `waiting` or `in-progress`, held by a check), `state` (the seven),
  `reasons` (a list of the glossary's reasons, not empty, no repeats),
  `urgent`, `emergency_told_at`, `created_at`, `attached_at`,
  `detached_at`, `closed_reason`, `ended_at`. A partial unique index on
  the tenant and the contact over the four open states. Row-level
  security as every tenant's table has; select, insert and update for
  the application's role.
- `messages.handover_id`: the handover a message of ours tells of.
- `reply_checks.outcome` may also be `handed-over`: the answer matched
  the schema and a flag handed over, so no other check ran.

The columns the data model lists for staff, the clock and the
follow-up are not added: M4 adds them with the code that fills them.

Down: the table and the column are dropped. A session that was handed
over is answered by the assistant again.

## 8. What is not built, in one place

- **Nobody can reply.** A customer who is told "a person will reply"
  waits until the session ends, 24 hours after their last message, and
  the assistant then answers again. No one is notified.
- H2 does not hold: no timers (section 1).
- The emergency phrase list checked by code (U10): until then an
  emergency is seen only if the model flags it, and the model is not
  called in a handed-over session, so **an emergency written in a
  handed-over session gets nothing**. This is the defect the guardrail
  policy's Gate 2 finding A5 names; U10 closes it.
- The emergency email (U10, M4).
- A request for a person in words reaches a person only if the model
  sets the flag; no eval has measured whether it does (U16).
- The next opening is written in digits, not in words.

## 9. Documents

The state machines, sections 1 (steps 10, 11, 15) and 2 (what M3
builds); the data model (`handovers` as built, `messages.handover_id`,
`reply_checks.outcome`); the guardrail policy, sections 4 (O2) and 6;
the decisions page (row 29 answered; the fallback's button in row 50);
the stories file's table of criteria delivered later (US-C11, 4 leaves
it; US-C6's criteria that M3 now meets in part); traceability; STATUS;
README.

## 10. Tests

Each row of the tables in sections 2, 3, 4 and 5, through the worker
and the in-memory channel, with a scripted model. H1 with two triggers
at once on two connections. H3: a handed-over session never calls the
model. The business-hours rule on its own: open, closed, a period to
midnight, a week with no hours, the next opening across a day and a
week. The table's constraints refuse a second open handover, a session
on a detached one, an empty or repeated reason. The end-to-end test:
the echo of a text is one thing, a tap on the person button another:
the customer gets the handover text, and the next message gets
nothing.
