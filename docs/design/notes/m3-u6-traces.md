# Design note: traces, cost and the log line (M3 unit U6)

Status: proposed by the agent, 2026-11-24, before any code; rewritten the
same day after its review
(`docs/reviews/2026-11-24-m3-u6-design-review.md`, four High findings),
and not reviewed again. Issue #305. Stories: US-C10, criterion 1 without
guardrail results, and criterion 2; NFR-O2. Also #186 (the spans NFR-P2
is measured from), in part.

This unit is about a record of people's conversations that must hold
none of their words, and about money: what a call to the model cost. So
the cases are written here first and reviewed before the code.

## 1. What is built, and what is not

Built:

- one row in `ai_traces` for every call to the model, written by the
  client itself, so that no caller can leave it out;
- the cost of a call, from its two token counts and a price that is a
  setting;
- the shape of one log line, a function that is the only way the api
  and the worker write one, and a test of it.

Not built here, and why:

- **`tool_calls`.** The plan gave this table to U6. It moves to U7, with
  the tool loop that writes it. The data model says its `arguments` and
  `result` hold "identifiers and times, not customer text", and on that
  ground the table is kept when a customer's data is deleted. But the
  arguments are written by the model, which can copy a customer's words
  into them. Whether that sentence can be made true is a question about
  the loop and its tools, and a table built now would have no writer
  and an unproved privacy claim. A trace still records which tools a
  call asked for, by name (US-C10, 1: "tool calls").
- **Guardrail results.** US-C10, 1 lists them. The checks are U9's and
  run after the call, on a turn that may have made several calls. U9
  adds the column with the code that fills it, and decides which trace
  of a turn holds a result. Until then criterion 1 is not complete; the
  plan's row for U9 cites it.
- **The link from a turn to the reply it sent** (#186): U7 stores the
  reply and adds it. This unit records, on each trace, the turn it
  belongs to and when that turn began. That is not the end of the
  batching window, where NFR-P2 starts: the wait between the two (the
  poll interval and any queue) is recorded nowhere yet, and #186 stays
  open for it.
- **Health checks** are not traced: they belong to no session, and send
  the model nothing of a customer's.
- **Real prices.** The setting is empty until the maintainer chooses a
  model (U17). No call to a real model is made in this unit.
- **A scan of an end-to-end run's logs** for text and numbers (US-C10,
  3) is U18's.

## 2. One call, one trace

The client's `generate` takes a second argument, the **call's place**:
the tenant, the session, the turn, and when the turn began. The turn's
identifier is made each time the job's handler runs, so a turn that is
tried again is a new turn. A client is built with a **recorder**, a function that stores
one trace; it cannot be built without one. Tests use a recorder that
keeps traces in a list.

| # | What happens | Trace | What the caller gets |
| --- | --- | --- | --- |
| T1 | The model answers and the answer is read | One, `ok`, with the model's name, both token counts, the cost, the names of the tools asked for | The result, after the trace is stored |
| T2 | The model answers and the answer is refused (`shape`, `flag`, `claim`, `tool-call`, `truncated`) | One, `invalid-output` with that code, the model's name, both counts and the cost: the tokens were used | The result |
| T3 | The call runs out of time | One, `timeout`. No model, no counts, **no cost: it is unknown, not nothing.** The provider may still have done the work and may bill it | The result |
| T4 | The provider fails with a code from the list | One, `provider-error` with that code. No model, no counts, no cost | The result |
| T5 | The adapter throws, or returns what is not an answer (a fault in this repository's code) | One, `fault`, no code. Then the error is thrown on, as now | The error |
| T6 | The request is refused before the adapter is called: a bad time limit, a missing part, and from this unit **anything the table would refuse**: no prompt or more than 8, a prompt's name or version or an offered tool's name that does not fit its pattern | **None:** no call was made, and none is paid for | The error |
| T7 | The place is not a place (a missing or malformed identifier, or a time that is missing or outside 1970 to 9999, which the table could not hold), or the client's clock gives no such time | None; no call is made | A `TypeError`, before the adapter is called |
| T8 | The recorder fails (the database is away), or takes longer than its own limit of 5 seconds | None is known to be stored. A recorder that was only slow is not stopped, so its row may still land after the caller was told it had not: a trace then exists for a call whose result was dropped. Both calls were paid for, so the sum stays right | **The recorder's error, and not the model's result.** The turn fails and is tried again as any job is. A reply made from a call that left no record is not sent. The repeated call costs again, and the first cost is lost: it could not be written anywhere |
| T9 | The recorder fails after a fault (T5) | None | The adapter's error; the recorder's is dropped. The first fault is the one to see |
| T10 | A turn makes several calls (a tool round, a retry) | One each, with the same turn | |
| T11 | A call that timed out ends later (the adapter ignored the signal) | Still one, `timeout`. Nothing is added when it ends | |
| T12 | The process dies during the call, or after the answer and before the trace is stored | **None.** "Every call leaves a trace" holds for a process that lives. The provider's own record is the only one | Nothing; the job's lease runs out and it is tried again |
| T13 | The job's own time runs out during the call | The call is not stopped by that: it ends by its own limit and its trace is stored then, after the job has failed | The handler has gone; the result is dropped |

Because T8 fails the turn after a call that was paid for, **a record the
client makes must never be one the table refuses.** Two things keep
that: T6 checks before the call everything about the request that the
table checks, with the same patterns, held once in the core; and a test
stores a trace of every outcome in a real table. With both, T8 means
the database could not be reached or was too slow.

`generate` must not be called inside an open tenant transaction, and
the session it names must be committed: the recorder uses a connection
of its own. U7 keeps to this.

A trace is stored in its own transaction, as soon as the call ends, and
not with the reply: if the turn fails afterwards, what the call cost is
still known.

The trace is written by the same code that keeps the time limit, in the
one file that can build a client (ADR 0005, amendment of 2026-11-23).
Latency is measured there, around the adapter's call only, with a clock
that tests replace.

## 3. What a trace holds

| Column | Holds | Rule in the table |
| --- | --- | --- |
| `id`, `tenant_id`, `created_at` | As every tenant-owned table | Row security by tenant |
| `session_id` | The session the call was made for | Not null; the session is this tenant's (a key on both columns) |
| `turn_id` | One identifier for all the calls of a turn. Made by the worker; no table of turns exists | Not null |
| `turn_started_at` | When the turn began, as the caller gave it (U7: from `beginTurn`) | Not null |
| `started_at`, `latency_ms` | When the adapter was called, and how long until it answered or the limit ran out | Not null; latency 0 or more |
| `prompt_names`, `prompt_versions` | The prompts the request was assembled from, in order (U4: the core's, then the pack's fragment). The data model had one name and one version; a request can have two | Same length, 1 to 8; each name fits the pattern of a prompt's name; each version 1 or more |
| `model` | The model's name as the adapter returned it, or `other` for a name that does not fit the pattern (the result the caller gets is unchanged, and nothing is thrown) | Null exactly for `timeout`, `provider-error` and `fault`. 1 to 200 of letters, digits and `. _ : / -` |
| `input_tokens`, `output_tokens` | The two counts | Null exactly when `model` is; 0 or more; 64-bit |
| `cost_micros` | The cost in millionths of a US dollar (section 4) | Null when the counts are, when no price is set for the model, when the model is `other`, or when a count is over 10^9; 0 or more |
| `price_input`, `price_output` | The two prices the cost was worked out from | Null exactly when `cost_micros` is |
| `tool_names` | The names of the tools an `ok` answer asked for, in order, repeats kept | Empty unless `ok`; at most 4 (`TOOL_CALLS_PER_ROUND_MAX`); each fits the pattern of a tool's name, which this unit writes down: a small letter, then up to 63 small letters, digits, `_` or `-` |
| `outcome` | `ok`, `invalid-output`, `timeout`, `provider-error`, `fault` | One of the five |
| `outcome_code` | The code of an `invalid-output` or a `provider-error` | One of that outcome's list; null for the other three |

The application's role may insert and read. It may not delete, and in
this unit it may not update.

**No words, numbers or names (US-C10, 2).** This is kept by the shape of
the thing, not by filtering:

- the record the recorder is given has no field that holds free text.
  Every text in it is an identifier, a name from this repository's own
  lists, or the model's name;
- each such column has a pattern in the table, so a later change that
  put a sentence in one would be refused by the database;
- the request, the reply, the claims, a tool's arguments and a
  provider's error message are never given to the recorder;
- a test makes calls whose request and answer are full of marked text,
  a phone number and a name, through every outcome, and looks for the
  marks in every column of every stored row.

What this does not cover, and is accepted:

- the model's name comes from an adapter, which is this repository's
  code talking to a provider. A long cloud identifier can hold an
  account number. It is not a customer's;
- a tool's name and a prompt's name are written by developers.


## 4. Cost

The price of a model is two whole numbers: **millionths of a US dollar
for a million input tokens**, and the same for output. A price list of
"3 dollars a million" is `3000000`.

`cost = ceiling((input tokens × input price + output tokens × output
price) / 1,000,000)`, in millionths of a dollar, worked out in whole
numbers of any size (`BigInt`), with no floating point. A price is at
most 10^9 (a thousand dollars a million tokens) and a count over 10^9
is not costed, so the largest cost is 2 × 10^12: it fits the 64-bit
column and a JavaScript whole number. The column is read back as text
and turned into a number.

| # | Case | Cost |
| --- | --- | --- |
| C1 | 1,000 in, 500 out, prices 3,000,000 and 15,000,000 | 3,000 + 7,500 = 10,500 |
| C2 | 1 in, 0 out, price 3,000,000 | 3 |
| C3 | 1 in, 0 out, price 1 (a millionth of a dollar a million tokens) | 1: rounded **up**, so that one costed call is never under what the same two prices would give for it. A sum over a session can still be under the bill: it leaves out the calls with no cost |
| C4 | 0 in, 0 out | 0 |
| C5 | Both prices 0 (a model that is free) | 0, which is a cost; not null |
| C6 | The model's name is not in the settings | **Null: unknown.** Never 0. The counts are kept, so a cost can be worked out later |
| C7 | The name differs only in case, or has a version suffix the setting lacks | Null: names are matched exactly. A near match would put a wrong price on a call |
| C8 | `invalid-output` | Costed as `ok` is |
| C9 | `timeout`, `provider-error`, `fault` | Null |
| C10 | Both counts 10^9, both prices 10^9 | 2 × 10^12, exactly |
| C10a | A count of 10^9 + 1 (no model makes one; an adapter's fault or a unit slip) | Null. The counts are stored as they came |
| C11 | The setting is not JSON, is not an object of names to two prices, has a price that is negative, fractional, over 10^9, or not a number, a name that is not a model's name, an unknown key, or more than 100 names | **The worker does not start,** and says which setting. A wrong price is worse than no price |
| C12 | The setting is absent, empty, or `{}` | No prices: every cost is null. This is the state until U17 |
| C13 | A name is written twice in the JSON | The last is used, as JSON reads it. Known, and not caught |
| C14 | A price is set after calls were made with none | Their cost stays null: a trace is never changed. The counts are there for a report to work from |
| C15 | The cost of a session is asked for | One function gives the sum of the costs that are known **and how many of the session's calls have none.** No other code sums costs, so the number is never shown without what it leaves out |

**What this number is and is not.** It is an estimate from two counts
and two prices. It is not the bill: a provider may count cached input,
or round, or charge for a timed-out call. The currency is the US dollar
because that is what the providers considered price in (ADR 0010); a
tenant's own currency is not involved. The two prices are stored on the
trace, so a cost can be checked later and a price change does not
rewrite history.

The setting is `PSA_MODEL_PRICES`, read by the worker only; the api
does not call the model. Decisions row 47
asks the maintainer to confirm the form and that the number is an
estimate.

## 5. The log line

Every line the api and the worker write is one JSON object with the
same keys, always present, null where there is none:

| Key | Holds |
| --- | --- |
| `time` | When, in UTC, to the millisecond |
| `level` | `info`, `warn` or `error` |
| `service` | `api` or `worker` |
| `event` | What happened: one of a closed list: the five below, and the three M2 already reported (`webhook-unavailable`, `turn-skipped`, `send-failed`) |
| `code` | What `errorCode` gives for a failure (letters, `_` and `-`, or the five characters of a database's error class), a job's outcome, or the channel's own number for a refused send as the WhatsApp channel writes it (`meta-` and six digits at most); or null |
| `requestId` | A UUID the api makes for the request being served; never read from a header. Null elsewhere |
| `tenantId`, `conversationId`, `jobId` | UUIDs, or null |
| `names` | The settings a failure to start named (`PSA_` and capital letters), the short reasons of a refusal to start in production (`stand-in-channel`, `placeholder-secret` and so on), or a job's type; small letters and hyphens, no digit. Or empty |
| `n` | Whole numbers from 0 to 10^9 under keys from a closed list: `status`, `durationMs`, `attempts` |

NFR-O2 says "request and conversation IDs on every line". A line about
starting up has neither; a webhook can hold many conversations. So the
two keys are on every line, and are null where the line is about no one
request or conversation. The test checks that.

**There is no key for a sentence.** A line cannot carry a message's
text, an error's message or a phone number, because nothing in its
shape holds one. A digit can appear only in a UUID, in the time, in a
database's five-character error class, or as a number under one of
a few keys, each of which the code works out itself (a status, a
duration, a count of attempts, the port it listens on) and none of
which is read from what arrived. A word in `event` is from a closed
list. A word in `names` is a setting's name found in a failure's
message, one of the listed reasons for refusing to start, or the type
of a job this worker has a handler for (any other is written as
`unknown-job`). **A `code` is not from a closed
list:** it is whatever short name an error carries as its code, or its
class's name, never its message. Today every such error is thrown by
this repository's code or a library; a library that put a customer's
word in an error's code would get it into a line. A value that does not fit is replaced by `invalid` (or left
out of `n`), never written. That is how US-C10, 3 is meant to be kept;
the scan of a whole run (U18) checks that it was.

| # | Line | From |
| --- | --- | --- |
| L1 | `listening` (the api, with its port), `running` (the worker), `stopped` | Each service, once |
| L2 | `could-not-start`, with a code (`settings`, `not-for-production`, `database-unreachable`), and in `names` the settings the failure named and its short reasons | Each service. The sentence that M2 printed is no longer printed: an operator reads which settings and why from the names. That is less than a sentence said, and is the price of a line that cannot carry one |
| L3 | `request`: the request's identifier, the status, the duration | The api, once for every request it answers, the webhook's among them |
| L4 | `job`: the job's identifier and type, the tenant, the conversation if the job has one, the outcome as the code (`done`, `deferred`, `retry`, `dead`, `not-held`), the attempts, the duration | The worker, once for every job it runs. M2 reported only a retry and a dead job, without saying which |
| L5 | `loop-error`, `turn-skipped`, `send-failed`, `webhook-unavailable`, each with a code | As M2 reported them, now in the one shape |

A model call is not a log line: its record is the trace.

## 6. Documents changed with this unit

The data model (`ai_traces`: the columns above; `tool_calls`: built in
U7, and the open question about its arguments); the architecture
("Logging and tracing", and the client's second argument); ADR 0005
(amendment: the recorder, and what happens when it fails); the M3 plan
(rows U6 and U7); `.env.example` and the runbook's list of settings;
the glossary if a number here is a limit; decisions row 47;
traceability; STATUS; README.

## 7. What is not known

- Whether a provider bills a call that timed out on this side. T3
  records the cost as unknown for that reason.
- What the real prices are, and whether two counts are enough to
  estimate them (cached input is priced apart by some providers).
- How long the insert of a trace takes beside a call of seconds. It is
  one row; not measured.
