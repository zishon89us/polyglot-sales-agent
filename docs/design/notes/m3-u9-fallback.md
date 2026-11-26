# Design note: the fallback (M3 unit U9, second part)

Status: proposed by the agent, 2026-11-27, before any code, and not yet
reviewed. Issue #308. Stories: US-C4, criterion 10; US-C6, criterion 2
(its count; the handover is U11's); US-C15, criterion 10. Guardrail
policy, section 4.

The first part built the function that says whether a reply passes
(`m3-u9-output-checks.md`). This part makes a turn use it: a reply that
does not pass is **not sent**, and the fallback text is sent in its
place.

## 1. What a turn does with the model's answer

Today: an answer that does not match the schema ends the turn with no
reply; any other answer is sent. From this unit:

| # | The model's answer | The customer gets | The session's count of fallbacks in a row |
| --- | --- | --- | --- |
| T1 | Matches the schema; the reply passes O7, O6, O3 and O5 | The reply | Set to 0 |
| T2 | Matches the schema; the reply fails any of the four | **The fallback text**, with its button for a person | Plus 1 |
| T3 | Does not match the schema (O1) | The fallback text | Plus 1 |
| T4 | The flag `asks-if-person`, and a reply that passes | The fixed answer, then the reply (U8) | Set to 0 |
| T5 | That flag, and an empty reply | The fixed answer alone (U8). An empty reply beside that flag is not a failure | Unchanged |
| T6 | That flag, and a reply that fails a check | The fixed answer, then the fallback text | Plus 1 |
| T7 | No flag, and an empty reply (O7) | The fallback text. Before this unit: nothing | Plus 1 |
| T8 | Calls for tools more rounds than allowed | Nothing, as today. Not a check on a reply | Unchanged |
| T9 | The provider fails, or the call times out | Nothing here; the job is tried again, as today. Never a fallback of this kind (US-C15, 10) | Unchanged |
| T10 | The turn lost its lease, or the tenant no longer answers | Nothing, as today | Unchanged |

The reply that failed is stored nowhere as a message and is never given
back to the model: the session's history holds only replies that were
sent. The model's next turn sees the customer's message with nothing of
ours after it.

A failed check is not tried again with the model (guardrail policy,
section 4).

## 2. The fallback message

- The text is the fixed text `fallback` (U8), in the language of the
  rule of `m3-u8-fixed-texts.md`, section 3, with the language the
  turn's answer reported first. Under T3 there is no such language: the
  session's, then the contact's last, then the tenant's default.
- Stored as a message of class `system-reply`, with the button `person`
  (decisions, row 50), and sent by the same step as every message: so
  it carries the disclosure when it is the first of its session, and
  its button is left off where the channel would refuse it.
- **What a tap on the button does is not built** (U10 and U11). Until
  then a tap arrives as a customer's message with the button's title as
  its text, and the model answers it like any message. The fallback
  text also says in words to ask for a person, and that too is only the
  model's to answer until U11.
- Written in the same transaction that ends the turn, as a reply is.

## 3. The count

`sessions.guardrail_fallbacks`: the number of fallbacks in a row, 0 at
the start. Plus 1 in the transaction that stores a fallback; 0 in the
one that stores a reply that passed. A turn that ends with nothing
(T8 to T10) leaves it.

**Reaching 2 hands the session over (US-C6, 2): not built here.** The
handover record is U11's. Until then the count goes on rising, and a
third failed reply sends a third fallback. The count is capped at 100
in the table so that it cannot grow without end.

Counted when the fallback is stored, not when it is sent: a fallback
that the channel then refuses has still been a failed reply.

## 4. The flags (O2)

One function reads the answer's flags and says what the turn is to do
with each. Today only `asks-if-person` does anything. The other six are
named there with the unit that will act on them, and are dropped. The
guardrail policy's rule that a flagged reply is discarded before O3 is
those units' to build; until then a flagged reply is checked and sent
like any other.

## 5. What is given to the checks

| Input | From |
| --- | --- |
| The reply and its claims | The model's answer |
| The profile | The one the turn read and gave to the model |
| The customer's batch | The texts of the batch the turn answers, as the model was given them (a caption or a button's title included) |
| The canary | The deployment's |
| The instruction text | The prompt's text and the fragments, as assembled for the request; not the business's data, not the session |
| Today | The turn's clock, in the profile's time zone |
| Pack checkers | None: no pack has a claim kind yet |

If the function throws, the turn treats the reply as failed, with the
code `check-error`, and sends the fallback: a reply is never sent
unchecked because the checker broke.

## 6. The record

`ai_traces.guardrail_results`, a new column: for the trace of the call
that gave the answer, the outcome of each check as the function
reported it (`passed`, or its code), and `O1` likewise. No text of the
reply, of a claim or of the customer. Written after the checks, by an
update the application's role is granted on that one column.

A line `reply-blocked` with the first failed check and its code is
reported to the log, with the tenant and the turn. Nothing of the
reply.

If writing the record fails, the turn still ends as it decided: a
missing record does not send a reply that failed, and does not hold
back one that passed.

## 7. The database

Migration 0012: `sessions.guardrail_fallbacks` (a whole number, 0 to
100, not null, 0 by default); `ai_traces.guardrail_results` (JSON, or
null), with the update of that column granted to the application's
role. Down: both columns are dropped.

## 8. What is not built, in one place

- The handover at two fallbacks in a row (U11), and what a tap on the
  person button does (U10, U11).
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

## 9. Tests

A scripted model that returns hostile output, through the worker and
the in-memory channel: a wrong price, a foreign link, the canary, an
empty reply, an answer that does not match the schema; in each the
customer gets the fallback and never the reply. Each row of the table
in section 1. The count: plus 1, to 0, across turns and a new session.
The record on the trace, and that it holds nothing of the reply. The
fallback as the first message of a session carries the disclosure.
The end-to-end test: a message with a number is answered by the
fallback, one without by its echo.
