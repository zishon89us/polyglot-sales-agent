# Design note: the handover record (M3 unit U11)

Status: proposed by the agent, 2026-11-27, before any code; rewritten
the same day after its review
(`docs/reviews/2026-11-27-m3-u11-design-review.md`, four High findings),
and not reviewed again. Issue #310. The maintainer answered row 29 of the decisions
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
| When the session ends, **or 24 hours after the handover was attached**, the handover is `detached`, and the assistant answers the next message | The 14-day and 7-day timers as timers (M4). Here a `detached` handover over 14 days old is closed when the next trigger finds it, and not before |
| The person button on the fallback, now that a tap does something | The button on the unsupported-type reply (U10 sends that text) |

Because the timers are not built, invariant H2 (every handover reaches
an end even if nobody acts) **does not hold in M3**: a detached
handover whose customer never writes again stays `detached`.

## 2. The triggers

| # | Trigger | Where it is decided | Reason | Urgent |
| --- | --- | --- | --- | --- |
| G1 | A tap on the person button is in the batch | The turn (step 11) | `requested` | |
| G2 | The answer's flag `asks-for-person` | The turn, after the answer (step 15) | `requested` | |
| G3 | The flag `sensitive-topic` | The same | `sensitive-topic` | |
| G4 | The flag `data-request` | The same | `data-request` | |
| G5 | The flag `emergency` | The same | `emergency` | Yes |
| G6 | The channel accepts a fallback, and the session's count of fallbacks in a row is then 2 or more | The step that records the send, in its transaction | `repeated-failure` | |

Several triggers at once add each their reason, in the order of the
table.

**G1 with text beside the tap.** A batch that holds the tap and no
text hands over without the model. A batch that holds the tap **and
text** is given to the model, so that its flags are read: "he is not
breathing" beside a tap must be able to be an emergency. The handover
for the tap is made whatever the model answers, and also when its
answer does not match the schema. If the provider fails, the job is
tried again as for any turn, and the handover waits for it.

**G1 to G5 discard the model's reply** (guardrail policy, O2). It is
not checked and not sent, whatever it says, and what it said of the
language is not kept. US-C11, 4: a request for a person beside other
text hands over, and no other answer is attempted.

The flags `asks-to-stop` and `asks-to-resume` are still dropped (U10).
With `asks-if-person` beside a handover flag, the fixed answer to that
question goes before the telling, in the one message.

**An answer that does not match the schema has no flags.** A customer
whose request for a person in words produced such an answer gets the
fallback, whose button is now there.

**G6 is decided when the fallback is sent**, as US-C6, 2 says, inside
the transaction that records the send and moves the count, under the
conversation's lock, and only if the fallback's session is still the
conversation's open one.

**When a handover is attached, the session's count of fallbacks in a
row is set to 0.**

Every handover made or attached is reported in a line `handed-over`
with its reasons, so that a model that hands every customer over is
seen. No limit on handovers is built.

## 3. What a trigger does

One function, in one transaction, under the conversation's lock:

| # | The contact's open handover | Result | The customer is told |
| --- | --- | --- | --- |
| H-a | None | A new one in `waiting`, attached to the session, with the reasons | Yes |
| H-b | `waiting`, attached to this session | Reasons that are not there are added. Stays | No, unless H-e |
| H-c | `detached`, under 14 days ago | Attached to this session, `waiting`; the reasons added | Yes |
| H-d | `detached`, 14 days or more ago | Closed as `closed-unanswered` with reason `expired`; then as H-a | Yes |
| H-e | Any of the above, and a reason is `emergency` | As above; `urgent` is set and never cleared for that handover | The emergency text, unless the contact has an emergency telling that is waiting to be sent, or one the channel accepted in the last 60 minutes |

The conversation's lock is what keeps one open handover for a contact
(H1): a contact has one conversation. A partial unique index over the
four open states is the table's own guard; if it ever refused, the
transaction would fail and the job be tried again.

`reasons` is a list without repeats, in the order the reasons first
came. `detached_at` is the moment the session ended or the 24 hours
ran out, not the moment that was noticed.

## 4. What the customer is told (US-C6, 5 and 6)

| The trigger | Business hours | Text |
| --- | --- | --- |
| Not an emergency | Open now | `handover-in-hours` |
| Not an emergency | Closed now, and an opening can be given | `handover-out-of-hours`, with the next opening and the support contact |
| Not an emergency | Closed now, and none can | `handover-in-hours`: it says a person will reply, and nothing about hours |
| An emergency | Any | `emergency` |

- **Open now**: the clock, in the tenant's time zone, falls in one of
  the tenant's business hours for that weekday. A period that closes at
  `24:00` runs to midnight.
- **The next opening**: the first start of a period after now, within
  the next 8 days, written as `YYYY-MM-DD HH:MM` in the tenant's time
  zone. Digits only, so that it reads the same in every language. On
  the day clocks go forward, an opening inside the missing hour is
  written as stored, a time that does not exist that day.
- "None can": the tenant has no business hours, or none in 8 days, or
  the text cannot be filled with the support contact (U8's rules).
- The language is chosen as for every fixed text (U8, section 3), from
  the session's, the contact's last and the tenant's default; the
  answer's is not used, as for the fallback.
- The guardrail policy asks for the emergency text in the tenant's
  default language and in English when the contact's language is not
  supported. Only English exists (row 51): it is sent in English.

**How it is stored.** Every telling is a message of class
`system-reply` whose body is the text (with the fixed answer to "am I
talking to a person?" before it, when that flag came with it). **It is
never held back or discarded for a newer message of the customer**:
those rules are for replies of the assistant. It carries
`messages.handover_id` and `messages.tells` (`handover` or
`emergency`). The longest is the disclosure, the fixed answer and a
filled text: 150 + 2 + 300 + 2 + 700 = 1,154 UTF-16 units, under what
every channel carries; a test holds this.

Under G1 to G5 the telling is stored, and the handover made, in the
transaction that ends the turn and marks its batch as dealt with. A
turn that lost its lease, or whose session ended, stores nothing and
hands nothing over. **A newer message of the customer does not stop
it**: the handover is made, and that message is then one in a
handed-over session.

**Told once, and told again.** One telling for each time a handover
becomes attached (H-a, H-c, H-d), and the emergency text under H-e. If
a telling failed or expired (its status is `failed` or `expired`) and
the handover has no telling that is `pending`, `sending`, `sent`,
`delivered` or `read`, the customer's next message in the handed-over
session is told again, with the text worked out anew. A telling whose
send's outcome is not known and was closed as unconfirmed is `failed`,
so the customer can be told twice then.

## 5. A handed-over session (H3, step 10)

A session is handed over exactly while a handover in `waiting` (or, in
M4, `in-progress`) is attached to it.

| # | Event | Result |
| --- | --- | --- |
| S1 | The customer writes in a handed-over session | The batch is marked as dealt with. No model call, no reply, no trace. One line `turn-skipped handed-over`. Told again only by the rule of section 4 |
| S2 | The customer taps the person button there | As S1; the reason `requested` is added if it is not there |
| S3 | A turn was calling the model when the handover was made by another path (G6) | Its reply is not stored. Its handover flags are applied as triggers (H-b, and H-e's text for an emergency). The batch is marked |
| S4 | A reply of the assistant, stored before the handover, is still waiting to be sent | Discarded when the handover is made |
| S5 | The session ends (24 hours with no message) | The handover becomes `detached`, in the place that ends a session. The next message starts a new session, which the assistant answers (US-C6, 8) |
| S5a | **24 hours have passed since the handover was attached**, and the session is still open because the customer went on writing | The handover becomes `detached` when the customer's next message is read, and the assistant answers that message. Only in M3, where nobody can reply: a customer is not left in silence for as long as they keep asking. M4, which gives staff a way to answer, must take this out |
| S6 | The disclosure | The telling carries it if it is the first message of the session |

Step 10 comes before step 11 in the order of checks: S2 is step 10's.

The checks of steps 5 to 9 (opt-out, the rate pause, a tenant not
answering) are other units'. A tenant that is not answering is stopped
before any of this, as today.

## 6. The fallback's button

The fallback is stored with the `person` button (row 50), since a tap
now hands over (G1). The send step leaves it off where the channel
would refuse it (U8, D9). On the smallest channel that happens when the
disclosure, the fixed answer and the fallback together pass 500; the
fallback's words still say to ask for a person. U8's note said this
happens on neither channel; with this unit it can.

## 7. The database

Migration 0013:

- `handovers`: the tenant, the contact, the session (set exactly in
  `waiting` and `in-progress`, held by a check), `state` (the seven),
  `reasons` (a list of the glossary's reasons, not empty, no repeats),
  `urgent`, `created_at`, `attached_at`, `detached_at`,
  `closed_reason`, `ended_at`. A partial unique index on the tenant and
  the contact over the four open states. Row-level security as every
  tenant's table has; select, insert and update for the application's
  role.
- `messages.handover_id` and `messages.tells`: the handover a message
  of ours tells of, and which text it is.
- `reply_checks.outcome` may also be `handed-over`: the answer matched
  the schema and a trigger handed over, so no other check ran.

The columns the data model lists for staff, the clock and the
follow-up are not added: M4 adds them with the code that fills them.

Down: the table and the columns are dropped. A session that was handed
over is answered by the assistant again.

## 8. What is not built, in one place

- **Nobody can reply.** A customer who is told "a person will reply"
  gets no reply from a person. The assistant answers them again when
  their session ends or 24 hours after the handover, whichever is
  first. No one is notified.
- H2 does not hold: no timers (section 1).
- The emergency phrase list checked by code (U10). Until then an
  emergency is seen only if the model flags it, so **an emergency
  written in a session that is already handed over, or beside a tap
  with no other text the model is given, gets nothing.** This is the
  defect the guardrail policy's Gate 2 finding A5 names; U10 closes it.
- The emergency email (U10, M4); the emergency text in two languages.
- A request for a person in words reaches a handover only if the model
  sets the flag; no eval has measured whether it does (U16). Nor is
  there a limit if it sets one on every answer: the line `handed-over`
  is all there is.
- A state-changing tool before a handover: none exists. The unit that
  adds one must tell the customer what it did before the reply is
  discarded.
- Step 10's reply to a Reschedule or Cancel button: there are no
  bookings.
- The next opening is written in digits, not in words.

## 9. Documents

The state machines, sections 1 (steps 10, 11, 15) and 2 (what M3
builds, and S5a); the data model (`handovers` as built, the two
columns, `reply_checks.outcome`); the guardrail policy, sections 4
(O2) and 6; the decisions page (row 29 answered; row 50); the stories
file's table of criteria delivered later; traceability; STATUS; README.

## 10. Tests

Each row of the tables in sections 2, 3, 4 and 5, through the worker
and the in-memory channel, with a scripted model. H3: a handed-over
session never calls the model. A telling is not discarded for a newer
message. The business-hours rule on its own: open, closed, a period to
midnight, a week with no hours, the next opening across a day and a
week, a time zone. The table's constraints refuse a second open
handover, a session on a detached one, an empty or repeated reason.
The longest telling against every channel. The end-to-end test: a tap
on the person button gets the handover text, and the next message
gets nothing.
