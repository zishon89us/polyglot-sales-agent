# Design note: sessions, the reply window and the batch (M3 unit U2)

2026-11-23 · issue #301 · written before the code, as the M2 retro asks
for any rule about people · second version, after a review of the first
(`docs/reviews/2026-11-23-m3-u2-design-review.md`) · built in the same
pull request; "As built" at the end says where the code differs

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
- A message that nobody answered for 24 hours is not answered by the
  assistant.

## Terms, as the glossary has them

- **Session:** starts with the first message, in either direction, after
  24 hours in which neither side sent one; ends when 24 hours pass with
  none.
- **Reply window:** the 24 hours after the contact's latest inbound
  message or call. No channel code reads a call, so U2 sees messages
  only; the error is on the safe side.
- **Batching window:** 3 seconds after the latest inbound message, at
  most 10 seconds after the first.

## 0. One lock per conversation

Everything below is only true if the things that touch one conversation
happen one after another. They are made to:

- **Storing a customer's message, starting a turn, ending a turn and
  claiming a message to send each begin by locking the conversation's
  row** (`FOR NO KEY UPDATE`), and hold it to the end of their
  transaction. Each of the four is one short transaction with no call to
  anything outside the database.
- So a turn that ends cannot miss a message whose transaction has begun
  to store it: one of the two waits for the other.
- Order of locks in any transaction: contact, conversation, session,
  message.
- The comment in `lease.ts` that an insert takes only a key-share lock on
  the conversation stops being true, and the webhook now waits, briefly,
  on a turn that is ending.
- **Known limit.** A webhook that carries messages of customers X then Y,
  at the same moment as one that carries Y then X, can deadlock; the
  database ends one, the API answers 503 and the channel sends it again.
  M2 had this for two new customers (#288, X7); U2 widens it to any two.
  Whether Meta puts several customers in one webhook has not been seen.
  Not tested.

## 1. Sessions

A row in `sessions` per session. U2 creates the columns it writes and one
that ADR 0014 asks for: `conversation_id`, `started_at`,
`last_message_at`, `ended_at`, `reply_discards` (section 3) and
`pack_outcome` (unread, unwritten). The other columns of the data model's
table arrive with the units that use them, as migration 0001 says columns
do.

Every message row gets `session_id`. One function finds the session for
a message at a time, in either direction, and is the only code that
decides whether a session is open:

| # | Case | What happens |
| --- | --- | --- |
| S1 | A message is stored; the conversation has no open session | A session starts; `started_at` and `last_message_at` are the message's stored time |
| S2 | Stored; the open session's last message was under 24 hours before | The message joins it; `last_message_at` moves to this message's time, if later |
| S3 | Stored; the open session's last message was 24 hours ago or more | In the same transaction the old session is ended (below) with `ended_at` = its last message + 24 hours, and a new one starts with this message (#179) |
| S4 | Exactly 24 hours | Ended: a session stays open only while under 24 hours have passed |
| S5 | Two webhooks for one conversation at the same moment | The lock of section 0 puts one after the other; both messages land in one session. A unique index allows one open session per conversation, as the second guard |
| S6 | One webhook with messages 25 hours apart by the channel's own time | Both are stored now, so both are in one session. Sessions, and the order of a batch, run on the time we stored a message; the channel does not promise to deliver in the order sent |
| S7 | A reply is stored | It goes through the same function at the time it is stored. In U2 that is always the open session its turn just read |
| S8 | A reply is accepted by the channel, by our call's result or by a status event that arrives first | If its session is still open, `last_message_at` moves to that time, if later. An ended session is never moved or reopened |
| S9 | A reply fails, expires or is discarded | Its session's `last_message_at` does not move |
| S10 | A session's 24 hours pass and nobody writes | The row keeps no `ended_at` until the conversation is next touched. Only the one function reads whether a session is open, and it applies the 24 hours |

**When a session is ended** (S3), in the same transaction:

- its customer messages that no turn dealt with are marked dealt with,
  with no reply. They are over 24 hours old; see W2;
- its assistant replies still waiting, for which no call ended unknown,
  become `discarded`.

Later units add their own effects to this one place: a handover detached
(U11), the awaiting-retry mark dropped (U15).

Not built: the timer that ends a session nobody writes to again. Ending
when the conversation is next touched is the design for M3. The unit
that first needs an end without a new message (a handover to detach, a
session's record for the metrics) builds the timer the architecture
lists.

## 2. The reply window

`contacts.last_inbound_at`, as the data model has it.

| # | Case | What happens |
| --- | --- | --- |
| W1 | A customer's message is stored | `last_inbound_at` becomes the earlier of the channel's time for the message and the time we stored it, if that is later than what is there. A webhook delivered a day late therefore does not open a window the channel has closed |
| W2 | A turn starts and the window is closed: the newest message in the batch is 24 hours old or more | The batch is marked dealt with, no reply is made, and the worker reports `turn-skipped` with the reason `window-closed` and nothing of the message. This can happen: a worker stopped for a day, or a dead job retried by an operator |
| W3 | A message of a class that may meet a closed window (a staff message, a notice, a business-initiated message) | Not U2's: no such message exists before M4. The pre-send checks by class are built with the first class that needs them |

W2 and the first bullet under S3 are one rule: **a customer's message
nobody answered within 24 hours is not answered by the assistant.** In
M3 nobody else sees it either; from M4 staff do. It is row 40 of the
decisions page. The state machines call a closed window for a reply
something that "cannot occur"; it can, and this is what then happens.

One conversation per contact, whatever number of the tenant's the
customer wrote to, is M2's design; a per-contact window inherits it.

## 3. The batch

A turn answers **the customer's messages of the open session that no
turn has dealt with**, in the order stored (`messages.handled_at`, as in
M2).

**When a turn may start.** Let L be the newest such message, and F the
oldest of them stored since this conversation's last turn started (a new
column on the conversation records that time). The window closes at the
earlier of L + 3 seconds and F + 10 seconds. If none was stored since the
last turn started, the turn may start at once: what is left has already
waited.

| # | Case | What happens |
| --- | --- | --- |
| B1 | One message | The turn starts not before 3 seconds after it |
| B2 | Messages at 0, 2 and 4 seconds | One turn, not before 7 seconds, answers the three in order |
| B3 | A message every 2 seconds without end | The first turn starts not before 10 seconds and answers what is there; later messages are the next batch, with a window of their own |
| B4 | A job comes due before the window closes | The turn does not start and takes no lease; the job is put off to the window's close. The turn checks the window itself, so a job that is early, late or doubled does no harm |
| B5 | Two workers pick up jobs for one conversation at once | One takes the lease and runs; the other is put off, as in M2 (US-C11, 3) |
| B6 | A batch with no text in it | As in M2: marked dealt with, no reply. The unsupported-type reply is U10's |
| B7 | A turn failed and its job runs again | Nothing was stored since the last turn started, so it starts at once |

"Not before": a turn starts when a worker is free and has polled, which
in M2 is up to half a second later and from U7 can be much longer. NFR-P5
is tested as "one reply, and not before the window closes", never as an
upper time.

**Which job wakes a turn.** Every stored customer message queues a job
for its conversation, due 3 seconds later; none is ever skipped because
another exists.

| After | The next turn is woken by |
| --- | --- |
| A message stored | Its own job |
| A turn found the window open | The same job, put off to the close |
| A turn found the conversation held | The same job, put off 1 second |
| A turn ended "the customer wrote again" | The newer message's own job |
| A reply stored though a newer message exists (D6) | The newer message's own job |
| A worker killed in a turn | Any later message's job once the lease runs out, or else the same job when its claim runs out |

**A reply that has been overtaken.** A reply is *unsent* while it is an
assistant reply with status `pending` for which no call ended unknown. A
reply the channel refused, waiting to be tried again, is unsent: the
customer has nothing. A reply whose call ended unknown may be with the
customer and is never discarded.

Storing a message discards nothing. Two rules do the work:

- **The send job holds back** an unsent assistant reply while the
  session has a newer customer message that no turn has dealt with, and
  looks again every 5 seconds while that is all there is to send.
- **The turn decides.** When a turn starts on a batch, it discards the
  session's unsent assistant replies and counts their messages as not
  dealt with again, so that its one reply covers all of them.

| # | Case | What happens |
| --- | --- | --- |
| D1 | The customer writes while a reply is being made | The turn finds the newer message when it ends, stores nothing, and the next turn answers all (as in M2). Counted |
| D2 | The customer writes while a finished reply waits to be sent | The reply is held back. The next turn discards it, reopens the messages it answered and answers all. Counted |
| D3 | The customer writes just as the reply is being sent | The send job had claimed it first: it is sent. The new message is answered by the next turn |
| D4 | A reply whose call ended unknown, waiting for its second call | Not held back and not discarded: the customer may have it |
| D5 | A system reply waits to be sent | Never held back or discarded. It answers an event, not the conversation |
| D6 | **The third time in a row** | After two counted discards in a row in a session, the next reply is neither held back nor discarded: it is stored (D1) or sent (D2) although a newer message exists, and the newer message is answered by the next turn. The count returns to zero when an assistant reply of the session is accepted by the channel |
| D7 | Each message points at the reply that answered it | Only the discarded reply's messages are reopened. A message dealt with by no reply (B6) points at nothing and is never reopened |
| D8 | A held-back reply has waited 15 minutes | It expires as in M2, `failed` with `expired`, and nothing is reopened (decisions row 3 stands). The turn discards only replies younger than that |
| D9 | The newer message is dealt with without a turn (from U10: an opt-out keyword; from U12: a paused contact) | The held-back reply is no longer held back and is sent. The unit that ends a message this way queues the send job |

What is counted for D6: a reply that was made and dropped (D1, only when
the turn had a reply to store) and a turn that discards one or more
replies (D2, once). The count is the open session's. A fallback, from
U9, is a system reply and neither counts nor resets.

**How long D6 lets a customer wait.** It bounds discards, not seconds:
the wait is at most one window and three turns. With the echo that is
about 10 seconds. With a model answering in 5 seconds, about 25. With
the worst a turn may take under US-C15 (three tries of 20 seconds, waits
of 1 and 4), about 205 seconds. The reply that D6 forces does not cover
the newest message, so a second reply follows it, and from M5 each
reply sent is one the channel may charge for.

D6 is the bound that findings S22 (#86) and V32 (#147) ask for. Two is
the agent's number; a yes also changes US-C11, 2, which today reads as
"always discarded". It is row 38.

In M3 the model has no tools, so a discarded reply has caused nothing to
undo. A tool's effect whose reply is discarded (#86, first half) is M5's.

## 4. Who a customer is

U2 builds on the contact rules as they stand (row 1 is not answered). A
session belongs to a conversation, and a conversation to one contact.

| # | Case | What follows for sessions |
| --- | --- | --- |
| P1 | A number passes to a new person, who writes with a different identifier | A different contact, so a different conversation and session. Nothing is shared |
| P2 | Two contacts that turn out to be one person (#288) | Nothing merges them, as decided in M2 |
| P3 | A channel that sends no identifier, so a contact is its number | Whoever holds the number is the contact, and joins its open session. This is what row 1 asks the maintainer to accept; from U7 the model is shown the session's earlier messages (architecture, "Processing one turn") |

The first version of this note proposed ending the session when a contact
known only by a number first gets an identifier (row 39). It is
withdrawn. WhatsApp has sent the identifier with every message since
April 2026 (data model, under `contacts`), so the case arises only on a
channel that sends none, where ending the session would not close the
other paths to the same result. Row 1 is where it is decided.

## 5. Jobs and tenants

Every handler reads its rows inside the scope of the tenant its job
names, and treats a row it cannot see as a bad job (#219). Both of M2's
jobs already do, and are tested for it; a bad job is tried six times
before it is dead. Each unit that adds a kind of job adds its own test.

## 6. The migration (0006)

Run with the API and the workers stopped, as 0004 required.

Tables and columns:

- `sessions`: the six columns of section 1, `tenant_id`, `UNIQUE
  (tenant_id, id)`, a foreign key on `(tenant_id, conversation_id)`, the
  unique index on open sessions, row-level security forced, and the
  grants the other tenant-owned tables have.
- `messages.session_id`, not null, with a foreign key on `(tenant_id,
  session_id)`.
- `messages.answered_by`, null or the reply that answered a customer's
  message: a foreign key on `(tenant_id, answered_by)`, a check that only
  an inbound row has it, and an index for the reopening of D2.
- `contacts.last_inbound_at`; `conversations.turn_started_at`.
- Nothing in the schema ties a message's session to the message's own
  conversation; the code that writes both is one function. Said, not
  enforced.

Existing rows:

| Rows | Become |
| --- | --- |
| Each conversation's messages, both directions, in the order stored | Sessions cut wherever 24 hours or more lie between one row's stored time and the next. The stored time is used for every row, sent or not, which for old rows is near enough |
| Each session but a conversation's last | `ended_at` = its last row + 24 hours |
| A conversation's last session | Left open, whatever its age; S3 ends it when the conversation is next touched |
| `answered_by` | Null everywhere: an old reply's messages are not known. A reply waiting at the moment of migration can therefore be discarded by D2 with nothing reopened, which is why the workers are stopped and the queue of sends is let run out first |
| `last_inbound_at` | Each contact's newest inbound message, by the earlier of its two times |
| `turn_started_at` | Null |

The way back drops all of it. Both ways are tested with rows of each
kind above (NFR-O4), and the tests that try to cross tenants gain the new
table and its three references (NFR-S1).

Migration 0004's own way back has a known fault (#290, S3): after down
and up again every customer message counts as not dealt with. U0's page
gave it to U2 on the belief that U2 replaced the column. The column
stays, so the fault does; W2 and S3 now limit what would be answered
again to the open session's messages inside the reply window. It is
M6's, with the other migration hardening.

## Departures

| From | What | Why |
| --- | --- | --- |
| The plan, U2: "`handled_at` is gone" | **`handled_at` stays.** The plan, decisions row 18 and data-model decision 18 are corrected in this pull request | The plan said it would be replaced and did not say by what. The batch is exactly "messages with no `handled_at`", and D2 needs one more column beside it |
| The plan, U2: "the send-time check of the reply window" | Built as W2, at the start of a turn | A reply cannot wait more than 15 minutes, so the turn is where a closed window is met |
| Architecture, "What the webhook writes": the session and the reply window "run later, in the worker" | S1 to S5 and W1 run in the webhook's transaction | Step 4 of the order of checks puts them with the store; a message row needs its session; they are three small statements under the lock |
| Architecture, "Timers": the batching job is moved by later messages; a session-end job per message | Each message queues its own job and the turn checks the window; no session-end job | Section 3; section 1 |
| Architecture, "Processing one turn", step 7 | Knows only D1 | D2 to D9 |
| State machines, step 12: "any reply not yet sent is discarded" | The same, done by the turn that reaches step 12, with the send job holding the reply back meanwhile | So that a message which ends before step 12 does not destroy a ready answer |
| State machines, section 7: a closed window for a reply "cannot occur" | W2 | It can |
| US-C11, 2 | D6 | Row 38 |
| The data model | `sessions.reply_discards`, `messages.answered_by`, `conversations.turn_started_at`; only six columns of `sessions` now | Sections 1, 3 |
| The glossary's reply window: "message or call" | Messages only | No code reads a call |

The four documents are changed in this pull request where U2 makes them
wrong.

## Tests

The worker's handlers and `storeInbound` take a clock, for tests only;
the window stays a fixed value and is not a setting. A webhook's rows are
stamped one microsecond apart from that clock, so that they keep their
order. M2's tests of the echo run the worker with a clock ahead of the
rows by more than the window, so they do not wait.

- Sessions: S1 to S10 against the database; S4 by rows written with SQL
  intervals; S5 and the lock of section 0 with a third connection that
  holds the conversation's row while two others wait, read from
  `pg_locks`, so that the test fails without the lock.
- Section 0's case by name: a message being stored while a turn ends.
- The window: B1 to B7 with the clock passed in. One test in real time,
  one worker, one burst: one reply, and not before the window closes
  (NFR-P5). NFR-R6 is M2's test of two workers, kept, now with batches.
- The table of which job wakes a turn, row by row.
- Discards: D1 to D9, each by name; D3 and D2 with the send job and the
  turn racing for the lock.
- W1, W2; the session-end effects of S3.
- The migration, both ways, with each kind of row; the tenant-crossing
  tests for `sessions`.
- Stops (NFR-R1, R2): the worker stopped while a job is put off for the
  window, between a discard and the turn's reply, and after a D6 store.
- M2's end-to-end test: the echo now arrives not before 3 seconds.

Not tested: the deadlock of section 0; P1 to P3, which are M2's rules.

## Not in U2

- Steps 4a to 11 and 13 to 15, and with them every counter but
  `reply_discards`.
- The session's language (U7), disclosure (U8), the handed-over mark
  (U11).
- First-reply time and fees on the session (#76, b): M5, with the
  metrics.
- The list of session states in `packages/core/src/names.ts` (#278): two
  names, `active` and `ended`, added. The check of shared names does not
  read them yet.

## As built

Where the code differs from the sections above, or adds what they left
open:

- **Jobs.** A webhook queues one job for each conversation it stored a
  message for, not one for each message, due 3 seconds after the
  webhook's time.
- **"Newer" for the send job** is by stored time: a customer's message
  stored after the reply was. Both times are read under the conversation's
  lock, so their order is the order the two happened in.
- **W2 is decided on `contacts.last_inbound_at`,** the earlier of the
  channel's time and ours, not on the stored time of the newest message
  of the batch.
- **Tests named in this note and not written:** S5 is shown by two
  webhooks made to wait on the lock, not by `pg_locks` of each; the stop
  "after a D6 store" is covered only by D6's own test at the database;
  nothing tests the cross-webhook deadlock.
- **M2's tests** store their messages as of 11 seconds earlier, so that a
  turn starts as soon as a worker looks; two of them changed meaning and
  were rewritten: a customer's second message no longer waits behind a
  reply that is being retried, it replaces it; and a burst may now leave
  discarded replies behind.
