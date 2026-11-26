# Design note: the fallback (M3 unit U9, second part)

Status: proposed by the agent, 2026-11-27, before any code; rewritten
the same day after its review
(`docs/reviews/2026-11-27-m3-u9-fallback-design-review.md`, three High
findings), and not reviewed again. Small corrections after the code's review
(`docs/reviews/2026-11-27-gate4-u9-fallback.md`). Issue #308. Stories: US-C4, criterion 10; US-C6, criterion 2
(its count; the handover is U11's); US-C15, criterion 10. Guardrail
policy, section 4.

The first part built the function that says whether a reply passes
(`m3-u9-output-checks.md`). This part makes a turn use it: a reply that
does not pass is **not sent**, and the fallback text is sent in its
place.

## 1. What a turn does with the model's answer

Today: an answer that does not match the schema ends the turn with no
reply; any other answer is sent. From this unit:

| # | The model's answer | The turn's reply |
| --- | --- | --- |
| T1 | Matches the schema; the reply passes O7, O6, O3 and O5 | The reply |
| T2 | Matches the schema; the reply fails any of the four | **The fallback** |
| T3 | Does not match the schema (O1) | The fallback |
| T4 | The flag `asks-if-person`, and a reply that passes | The fixed answer, then the reply (U8) |
| T5 | That flag, and an empty reply | The fixed answer alone (U8). An empty reply beside that flag is not a failure |
| T6 | That flag, and a reply that fails a check | One message: the fixed answer, then the fallback text |
| T7 | No flag, and an empty reply (O7) | The fallback. Before this unit: nothing |
| T8 | Calls for tools more rounds than allowed | None, as today. Not a check on a reply |
| T9 | The provider fails, or the call times out | None here; the job is tried again, as today. Never a fallback of this kind (US-C15, 10) |
| T10 | The turn lost its lease | None, as today |

The reply that failed is stored nowhere as a message and is never given
back to the model. A failed check is not tried again with the model
(guardrail policy, section 4).

## 2. The fallback is the turn's reply

The fallback is stored as the reply of its turn is: a message of class
`assistant-reply` with its turn, **an empty body**, and the fallback
text as its fixed part (`messages.lead`, which U8 added for the fixed
answer). A new mark, `messages.fallback`, says that it is one.

So every rule a reply has holds for it, by the code that already keeps
those rules:

- it is not stored when a newer message of the customer waits, and the
  batch is answered again with that message;
- unsent, it is held back and discarded for a newer message, its batch
  reopened (US-C11, 2);
- it carries the disclosure when it is the first of its session;
- the session's history, which holds bodies only, does not show it to
  the model: the next turn sees the customer's message with nothing of
  ours after it.

Its text is the fixed text `fallback` (U8), in the language of the rule
of `m3-u8-fixed-texts.md`, section 3: the session's, then the contact's
last, then the tenant's default, then English. **The language a failed
answer reported is neither stored nor used**: it is the word of an
answer that was just refused. The message's own `language` is `und`, unknown, and
the session's language, its unsupported mark and the contact's last
language are left as they were.

**It is sent without the button.** Row 50 gives the fallback the
`person` button, but a tap on it does nothing yet: a tap is no text,
and a turn with no text sends nothing. Until U10 and U11 give the tap a
meaning, the fallback is stored with no button. Its wording still says
"tap the button below or ask for a person". U8 already accepts that
wording without the button, where a channel cannot carry one; this is
that state, for every customer, until those units. Asking in words
reaches only the model, whose flag for it is dropped until U11.

## 3. The count

`sessions.guardrail_fallbacks`: the number of fallbacks in a row that
the customer was sent, 0 at the start. It moves in the transaction that
records that the channel **accepted** a message:

| The message accepted | The count |
| --- | --- |
| A fallback | Plus 1, and never over 100 |
| Any other reply of the assistant (T1, T4, T5) | 0 |
| Anything else | Unchanged |

A fallback or a reply that is discarded, refused or expires changes
nothing: the customer did not get it (US-C6, 2: "when the second
fallback is sent"). Nor does one whose send ended with its outcome
not known and was then closed as unconfirmed, though the customer may
have got that one: the count is then one short.

Not undone when the channel reports later that an accepted message
failed. The disclosure's mark is undone then (U8); this count is not,
and a customer can so be handed over one failed reply early. In the
follow-up issue.

**Reaching 2 hands the session over (US-C6, 2): not built here.** The
handover record is U11's. Until then the count goes on rising, and a
third failed reply sends a third fallback.

## 4. The flags (O2)

One function reads the answer's flags and says what the turn is to do
with each. Only `asks-if-person` does anything. The other six are named
there with the unit that will act on them (`emergency`, a person, a
sensitive topic and a data request: U11; stop and receive-again: U10)
and are dropped; the plan gives U9 the reading of the `emergency` flag
and U11 the acting, and until U11 nothing acts.

Two things here are not what the guardrail policy's O2 says, and both
are as U8 left them: a flagged reply is checked and sent like any
other, where O2 discards it for the event's fixed text; and beside
`asks-if-person` the model's reply is sent after the fixed answer.

## 5. What is given to the checks

| Input | From |
| --- | --- |
| The reply and its claims | The model's answer |
| The profile | The one the turn read and gave to the model |
| The customer's batch | **Exactly the texts the request gave the model**: after the batch was bounded, so a text that was cut or left out is cut or left out here too. The request builder gives them back |
| The canary | The deployment's |
| The instruction text | The prompt's assembled text; not the business's data, not the session |
| Today | The turn's clock, in the profile's time zone |
| Pack checkers | None: no pack has a claim kind yet |

Building these inputs and running the function are inside one guard.
If either throws, the reply is treated as failed and the fallback is
the turn's reply: a reply is never sent unchecked because the checker
broke. The record says `error`, the line `reply-blocked` is reported
with the code `check-error`, and it counts like any fallback, since the customer got one.
A checker that always throws would so hand every session over once U11
is built; the line is what an operator sees first.

## 6. The record

A table of its own, `reply_checks`, written once and never changed:
one row for a turn whose answer was stored. The tenant, the session,
the turn, when; `outcome` (`passed`, `blocked` or `error`); and for
each of O1, O7, O6, O3 and O5 either `passed`, a code of the function's
fixed list, or nothing when the check did not run (after O1 fails, the
others do not). Each is held to a pattern of lower-case letters and
hyphens. No text of the reply, of a claim or of the customer.

Written in the transaction that stores the turn's reply, so there is a
row exactly when there is a reply or a fallback (under T5, where there
is no reply to check, the row says only that the answer matched the
schema). A row stays when its message is later discarded for a newer
one: the table counts turns stored, not messages sent. And a turn that lost its
lease, or was dropped for a newer message before it was stored, leaves
none, and its next try writes its own.

The trace of the model call is not touched: it is written once
(migration 0009). A row here and the traces of the turn share the
turn's identifier. `guardrail_results` on the trace, which the data
model foresaw, is not built; the data model is corrected.

After the store, a line `reply-blocked` is reported with the first
failed check by name (`schema`, `length`, `leak`, `values`, `contacts`)
and its code, or `check-error`. The tenant and the turn are on the
job's own line.

## 7. The database

Migration 0012:

- `sessions.guardrail_fallbacks`: a whole number, 0 to 100, not null, 0
  by default.
- `messages.fallback`: true or false, not null, false by default; true
  only on a reply of the assistant with a fixed part and no body.
- `reply_checks`, as in section 6, with row-level security as every
  tenant's table has, and insert and select only for the application's
  role.

Down: the table and both columns are dropped; which messages were
fallbacks and how many each session was sent are lost.

## 8. What is not built, in one place

- The handover at two fallbacks in a row (U11).
- The fallback's button, and what a tap on it does (U10, U11).
- Acting on the other six flags (U10, U11).
- The exception for a turn in which a state-changing tool succeeded:
  no such tool exists.
- Degraded mode's fallback after provider failures (U12): another
  rule, and another count.
- **The checks hold back right replies** (row 52; #336): each such
  reply is now a customer who gets "Sorry, I could not answer that"
  in place of a right answer. With the stand-in model that only
  echoes, a message with a number in it is echoed, fails O3, and gets
  the fallback.
- No eval has run on the prompt or the checks (U16).

## 9. Documents

The guardrail policy, section 4 (the O1 row's "ends the turn" and what
is built); the state machines, section 3 (the count moves on a message
accepted) and section 8's row on the schema; the data model (the two
columns, the table, and `guardrail_results`); traceability (US-C4, 10);
STATUS; README.

## 10. Tests

A scripted model that returns hostile output, through the worker and
the in-memory channel: a wrong price, a foreign link, the canary, an
empty reply, an answer that does not match the schema; in each the
customer gets the fallback and never a word of the reply. Each row of
the table in section 1. The count: plus 1 on a fallback accepted, 0 on
a reply accepted, unchanged by one that is refused or discarded, and
never over 100. A fallback discarded for a newer message, and its batch
answered again. The record: a row for each stored turn, none for a
turn that stored nothing, and nothing of the reply in it. The fallback
as the first message of a session carries the disclosure. A checker
that throws. The end-to-end test: a message with a number is answered
by the fallback, one without by its echo.
