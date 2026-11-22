# Design note: sessions, the reply window and the batch (M3 unit U2)

2026-11-23 · issue #301 · written before the code, as the M2 retro asks
for any rule about people · not yet built

This note says what U2 builds, case by case, so that the cases can be
argued with before there is code to defend. Where it departs from the
plan or from a design document it says so under "Departures".

## What a customer sees after U2

Nothing new is said to them: the reply is still M2's echo. What changes
is **when** it comes and **what it covers**.

- Several messages sent close together get one reply.
- A reply that was ready but not yet sent when the customer wrote again
  is not sent; one reply covers everything.
- That cannot go on for ever: a customer who keeps writing still gets a
  reply.

## Terms, as the glossary has them

- **Session:** starts with the first message, in either direction, after
  24 hours in which neither side sent one; ends when 24 hours pass with
  none.
- **Reply window:** the 24 hours after the contact's latest inbound
  message.
- **Batching window:** 3 seconds after the latest inbound message, at
  most 10 seconds after the first.

## 1. Sessions

A row in `sessions` per session, as the data model has the table. U2
creates every column the data model lists, and writes only
`conversation_id`, `started_at`, `last_message_at`, `ended_at` and one
new counter (section 3). Each other column is written by the unit that
builds its rule; until then it holds its default.

Every message row gets `session_id`.

| # | Case | What happens |
| --- | --- | --- |
| S1 | A customer's message is stored; the conversation has no open session | A session starts at the time the row is stored; the message is in it |
| S2 | Stored; the open session's last message was under 24 hours before | The message joins it; `last_message_at` moves to this message's time |
| S3 | Stored; the open session's last message was 24 hours ago or more | In the same transaction: the old session gets `ended_at` = its last message + 24 hours, and a new one starts with this message (#179) |
| S4 | Exactly 24 hours, to the microsecond | Ended: "under 24 hours" keeps a session open, as the glossary's "24 hours pass" has it |
| S5 | Two webhooks for one conversation at the same moment | The conversation's row is locked while its session is found or made, so both messages land in one session; a unique index allows one open session per conversation as the second guard |
| S6 | One webhook with messages 25 hours apart by the channel's own time | Both are stored now, so both are in one session: a session runs on the time we stored a message, not the time the channel says it was sent |
| S7 | A reply is stored | It is in the session of the newest message it answers |
| S8 | A reply is accepted by the channel | That session's `last_message_at` moves to the time it was sent, if later |
| S9 | A reply fails, expires or is discarded | The session's `last_message_at` does not move: nothing was sent |
| S10 | A session's 24 hours pass and nobody writes | Nothing happens until the conversation is next touched: the row still has no `ended_at`. Whoever reads a session must treat one whose last message is 24 hours old as ended. In U2 one function reads it, and does |
| S11 | A contact known only by a number gets the channel's identifier for the first time (data-model decision 16) | The open session is ended at that moment and the message starts a new one. See "Who a customer is" |

Not built: the timer that ends a session nobody writes to again. Its only
effects (a handover detached, the session's record for the metrics) are
other units', and until one of them exists a session that is over but not
marked is not observable.

## 2. The reply window

`contacts.last_inbound_at`, as the data model has it: set at step 4 to
the time the message is stored, never moved back.

| # | Case | What happens |
| --- | --- | --- |
| W1 | A customer's message is stored | `last_inbound_at` = the time it is stored, if later than what is there |
| W2 | An assistant reply or a system reply is about to be sent and the window is closed | The state machines say this cannot occur. In M3 it cannot: a reply that waits 15 minutes expires. U2 makes that a check, not a belief: the message ends `failed` with the code `window-closed`, and is reported like any failed send |
| W3 | A message of a class that may meet a closed window (a staff message, a notice, a business-initiated message) | Not U2's: no such message exists before M4. The pre-send checks by class are built with the first class that needs them |

The channel's own time for a message is stored (since M2) and not used
here. If the channel counts its 24 hours from that time, our window can
be open a few seconds longer than the channel's; a send in that gap is
refused by the channel and ends `failed` with the channel's code.

## 3. The batch

A turn answers **the customer's messages that no turn has dealt with**,
oldest first, as in M2 (`messages.handled_at`). What U2 adds is when a
turn may start, and what happens to a reply that has been overtaken.

**When a turn may start.** Let F be the oldest message not dealt with and
L the newest. The window closes at the earlier of L + 3 seconds and F +
10 seconds, by the times the rows were stored.

| # | Case | What happens |
| --- | --- | --- |
| B1 | One message | The turn starts 3 seconds after it |
| B2 | Messages at 0, 2 and 4 seconds | One turn at 7 seconds answers the three, in order |
| B3 | A message every 2 seconds without end | The first turn starts at 10 seconds and answers what is there; later messages are the next batch |
| B4 | A job for the conversation comes due before the window closes | The turn does not start; the job is put off to the window's close. The turn itself checks the window, so a job that is early, late or doubled does no harm |
| B5 | Two workers pick up jobs for one conversation at once | One takes the conversation's lease and runs; the other is put off, as in M2 (US-C11, 3) |
| B6 | A batch with no text in it | As in M2: the messages are marked dealt with and no reply is made. The unsupported-type reply is U10's |
| B7 | Messages not dealt with in an old session and in the new one | One batch, answered in the new session. Whether an old session's unanswered message should still be answered is U15's (the 15-minute rules) |

**A reply that has been overtaken.** "Not yet sent" means: an assistant
reply with status `pending` for which the channel has never been called.
A reply the channel was called for, whatever the outcome, may be with the
customer and is not discarded.

| # | Case | What happens |
| --- | --- | --- |
| D1 | The customer writes while a reply is being made | The reply is dropped when the turn tries to store it, the messages stay not dealt with, and the next turn answers all of them (as in M2). Counted as a discard |
| D2 | The customer writes while a finished reply waits to be sent | At the moment the new message is stored: the reply becomes `discarded`, and the messages it answered count as not dealt with again. The next turn answers all of them. Counted as a discard |
| D3 | The customer writes just as the reply is being sent | The send job has already claimed it (`sending`): it is sent. The new message is answered by the next turn |
| D4 | A reply the channel was called for once, outcome unknown, waiting for its second call | Not discarded: the customer may have it |
| D5 | A system reply waits to be sent | Never discarded. It answers an event, not the conversation |
| D6 | **The third time in a row** | After two discards in a row in a session, the next reply is not discarded: D1's reply is stored and sent although a newer message exists, and D2's reply stays. The newer message is answered by the next turn. The count returns to zero when an assistant reply is accepted by the channel |
| D7 | A discarded reply's messages were answered together with others that a later reply also covers | Each message points at the one reply that answered it, so only that reply's messages are reopened |

D6 is the bound that findings S22 (#86) and V32 (#147) ask for. Without
it a customer who writes every few seconds is never answered, and once a
model is called (U7) each discard also costs a call. Two is the agent's
number; it is row 38 of the decisions page.

In M3 the model has no tools, so a discarded reply has caused nothing
that needs undoing. What happens to a tool's effect when its reply is
discarded (#86, first half) is M5's, with the first tool that changes
anything.

## 4. Who a customer is

U2 builds on the contact rules as they stand (row 1 is not answered). A
session belongs to a conversation, and a conversation to one contact.

| # | Case | What follows for sessions |
| --- | --- | --- |
| P1 | A number passes to a new person, who writes with a different identifier | A different contact, so a different conversation and session. Nothing is shared |
| P2 | A contact known only by a number; a message arrives with that number and, for the first time, an identifier | By decision 16 the contact takes the identifier. It may be the same person, whom the channel now names, or a new holder of the number. **U2 ends the open session** (S11), so the newcomer's first reply starts a session of its own. From U7 on, what the model is shown is the session's messages: without this, a new holder would be answered in the light of the old holder's last day of messages |
| P3 | The same, and it was the same person | They lose a session's context once: the disclosure is sent again (from U8) and the counters start again. That is the cost of P2 |
| P4 | Two contacts that turn out to be one person (#288) | Nothing merges them, as decided in M2. Each keeps its own conversation and sessions |

P2 is the agent's proposal and is row 39. It narrows what row 1 accepts;
it does not remove it: staff, from M4, would still see the whole
conversation.

## 5. Jobs and tenants

Every handler reads its rows inside the scope of the tenant its job
names, and treats a row it cannot see as a bad job (#219). A job that
names tenant A and a conversation of tenant B fails as a bad job and
touches nothing of B's. U2 adds the test for `process-conversation`;
each later unit that adds a kind of job adds its own.

## 6. The migration (0006)

- `sessions`, with its row-level policy and grants as the other
  tenant-owned tables have them, and the unique index on open sessions.
- `messages.session_id`, not null. Existing messages are given sessions
  by the same 24-hour rule, in the order they were stored, with the
  security policy lifted for the length of the statement, as migration
  0004's way back does.
- `messages.answered_by`: for a customer's message, the reply that
  answered it. Null for a message dealt with by no reply.
- `contacts.last_inbound_at`, filled from each contact's newest inbound
  message.
- `sessions.reply_discards`, the counter of D6. The data model gains it.
- The way back drops all of it. Tested both ways with rows in the tables
  (NFR-O4).

## Departures

| From | What | Why |
| --- | --- | --- |
| The plan, U2: "`handled_at` is gone" | **`handled_at` stays.** | The plan said it would be replaced and did not say by what. The data model has it by decision 18, the batch is exactly "messages with no `handled_at`", and D2 needs only one more column beside it. Removing it would be a migration with no gain. Row 18 still asks the maintainer whether the column is right |
| The plan, U2: "the send-time check of the reply window" | Built only as W2's guard | No message class that can meet a closed window exists before M4 |
| State machines, step 12: "any reply not yet sent is discarded" | Done when the message is stored (step 4), not at step 12 | US-C11, 2 says "when the new message is stored". Later units end some messages before step 12 (an opt-out keyword, a paused contact); a reply made before such a message is stale too, and is not sent. U10 and U12 may narrow this, and say so if they do |
| The data model's `sessions` | One new column, `reply_discards`; `messages.answered_by` | D6 and D7 |
| The glossary's session | S6: by the time we stored a message | The channel's time is the sender's claim about the past; ours orders rows |

## Tests

- Sessions: S1 to S5, S7 to S9 and S11 against the database, with the
  clock passed in; S5 with two transactions.
- The window: B1 to B5 with the clock passed in, and one test in real
  time with two workers and a burst of five (NFR-P5, NFR-R6).
- Discards: D1 to D7, each by name.
- W1, W2.
- The bad job of section 5.
- The migration up and down with rows, and up again.
- M2's restart tests (NFR-R1, R2) and the end-to-end test still pass: the
  echo arrives 3 seconds later than before, and the tests that wait for
  it say so.

## Not in U2

- Steps 4a to 11 and 13 to 15, and with them every counter but
  `reply_discards`.
- The session's language (U7), disclosure (U8), the handed-over mark
  (U11).
- First-reply time and fees on the session (#76, b): M5, with the
  metrics. No column is added for them now.
- The list of session states in `packages/core/src/names.ts` (#278): two
  names, `active` and `ended`, added with a check against the state
  machines.
