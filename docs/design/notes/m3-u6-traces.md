# Design note: traces, cost and the log line (M3 unit U6)

Status: proposed by the agent, 2026-11-24, before any code. Issue #305.
Stories: US-C10, criteria 1 and 2; NFR-O2. Also #186 (the spans NFR-P2
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
  run after the call. The column exists from this unit and is null,
  which means "not checked"; U9 fills it and says how.
- **The link from a turn to the reply it sent** (#186): U7 stores the
  reply and adds it. This unit records, on each trace, the turn it
  belongs to and when that turn's batching window closed, which is the
  start of NFR-P2's measure.
- **Health checks** are not traced: they belong to no session, and send
  the model nothing of a customer's.
- **Real prices.** The setting is empty until the maintainer chooses a
  model (U17). No call to a real model is made in this unit.
- **A scan of an end-to-end run's logs** for text and numbers (US-C10,
  3) is U18's.

## 2. One call, one trace

The client's `generate` takes a second argument, the **call's place**:
the tenant, the session, the turn, and when the turn's batching window
closed. A client is built with a **recorder**, a function that stores
one trace; it cannot be built without one. Tests use a recorder that
keeps traces in a list.

| # | What happens | Trace | What the caller gets |
| --- | --- | --- | --- |
| T1 | The model answers and the answer is read | One, `ok`, with the model's name, both token counts, the cost, the names of the tools asked for | The result, after the trace is stored |
| T2 | The model answers and the answer is refused (`shape`, `flag`, `claim`, `tool-call`, `truncated`) | One, `invalid-output` with that code, the model's name, both counts and the cost: the tokens were used | The result |
| T3 | The call runs out of time | One, `timeout`. No model, no counts, **no cost: it is unknown, not nothing.** The provider may still have done the work and may bill it | The result |
| T4 | The provider fails with a code from the list | One, `provider-error` with that code. No model, no counts, no cost | The result |
| T5 | The adapter throws, or returns what is not an answer (a fault in this repository's code) | One, `fault`, no code. Then the error is thrown on, as now | The error |
| T6 | The request is refused before the adapter is called (a bad time limit, a missing part) | **None:** no call was made | The error, as now |
| T7 | The place is not a place (a missing or malformed identifier or time) | None; no call is made | A `TypeError`, before the adapter is called |
| T8 | The recorder fails (the database is away) | None could be stored | **The recorder's error, and not the model's result.** The turn fails and is tried again as any job is. A reply made from a call that left no record is not sent. The repeated call costs again, and the first cost is lost: it could not be written anywhere |
| T9 | The recorder fails after a fault (T5) | None | The adapter's error; the recorder's is dropped. The first fault is the one to see |
| T10 | A turn makes several calls (a tool round, a retry) | One each, with the same turn | |
| T11 | A call that timed out ends later (the adapter ignored the signal) | Still one, `timeout`. Nothing is added when it ends | |

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
| `window_closed_at` | When the turn's batching window closed: the time its job was due (NFR-P2 starts here) | Not null |
| `started_at`, `latency_ms` | When the adapter was called, and how long until it answered or the limit ran out | Not null; latency 0 or more |
| `prompt_names`, `prompt_versions` | The prompts the request was assembled from, in order (U4: the core's, then the pack's fragment). The data model had one name and one version; a request can have two | Same length, 1 to 8; each name fits the pattern of a prompt's name; each version 1 or more |
| `model` | The model's name as the adapter returned it | Null exactly for `timeout`, `provider-error` and `fault`. 1 to 200 of letters, digits and `. _ : / -` |
| `input_tokens`, `output_tokens` | The two counts | Null exactly when `model` is; 0 or more |
| `cost_micros` | The cost in millionths of a US dollar (section 4) | Null when the counts are, or when no price is set for the model; 0 or more |
| `price_input`, `price_output` | The two prices the cost was worked out from | Null exactly when `cost_micros` is |
| `tool_names` | The names of the tools an `ok` answer asked for, in order, repeats kept | Empty unless `ok`; at most 16 (the limit on calls in one answer); each fits the pattern of a tool's name |
| `outcome` | `ok`, `invalid-output`, `timeout`, `provider-error`, `fault` | One of the five |
| `outcome_code` | The code of an `invalid-output` or a `provider-error` | One of that outcome's list; null for the other three |
| `guardrail_results` | Null: not checked. Filled by U9 | A list of short names when not null |

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

The name of a model that does not fit the pattern is a fault of the
adapter (T5), as an empty one is today.

## 4. Cost

The price of a model is two whole numbers: **millionths of a US dollar
for a million input tokens**, and the same for output. A price list of
"3 dollars a million" is `3000000`.

`cost = ceiling((input tokens × input price + output tokens × output
price) / 1,000,000)`, in millionths of a dollar, worked out in whole
numbers with no floating point.

| # | Case | Cost |
| --- | --- | --- |
| C1 | 1,000 in, 500 out, prices 3,000,000 and 15,000,000 | 3,000 + 7,500 = 10,500 |
| C2 | 1 in, 0 out, price 3,000,000 | 3 |
| C3 | 1 in, 0 out, price 1 (a millionth of a dollar a million tokens) | 1: rounded **up**, so that a sum of costs is never under what the same prices would bill |
| C4 | 0 in, 0 out | 0 |
| C5 | Both prices 0 (a model that is free) | 0, which is a cost; not null |
| C6 | The model's name is not in the settings | **Null: unknown.** Never 0. The counts are kept, so a cost can be worked out later |
| C7 | The name differs only in case, or has a version suffix the setting lacks | Null: names are matched exactly. A near match would put a wrong price on a call |
| C8 | `invalid-output` | Costed as `ok` is |
| C9 | `timeout`, `provider-error`, `fault` | Null |
| C10 | Counts at the largest whole number a count may be, prices at the largest allowed (10^12) | Worked out exactly; the column is a 64-bit number and the result fits |
| C11 | The setting is not JSON, is not an object of names to two prices, has a price that is negative, fractional, over 10^12, or not a number, a name that is not a model's name, an unknown key, or more than 100 names | **The worker does not start,** and says which setting. A wrong price is worse than no price |
| C12 | The setting is absent or empty | No prices: every cost is null. This is the state until U17 |

**What this number is and is not.** It is an estimate from two counts
and two prices. It is not the bill: a provider may count cached input,
or round, or charge for a timed-out call. The currency is the US dollar
because that is what the providers considered price in (ADR 0010); a
tenant's own currency is not involved. The two prices are stored on the
trace, so a cost can be checked later and a price change does not
rewrite history.

The setting is `PSA_MODEL_PRICES`, read by the worker. Decisions row 47
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
| `event` | What happened: a short name from the service's own list |
| `code` | A short code for a failure, or null |
| `requestId` | The api's identifier for the request being served, or null |
| `tenantId`, `conversationId`, `jobId` | The identifiers the line is about, or null |
| `names` | A list of identifiers the line names (a setting, a job's type), or empty |
| `n` | Named whole numbers: a status, a duration, counts |

NFR-O2 says "request and conversation IDs on every line". A line about
starting up has neither; a webhook can hold many conversations. So the
two keys are on every line, and are null where the line is about no one
request or conversation. The test checks that.

**There is no key for a sentence.** A line cannot carry a message's
text, an error's message or a phone number, because nothing in its
shape holds one: every text is checked against a pattern for a short
name or an identifier, and a value that does not fit is replaced by
`invalid`, never written. That is how US-C10, 3 is meant to be kept;
the scan of a whole run (U18) checks that it was.

| # | Line | From |
| --- | --- | --- |
| L1 | `listening`, `running`, `stopped` | Each service, once |
| L2 | `could-not-start`, with a code, and in `names` the settings the failure named | Each service. The sentence that M2 printed is no longer printed |
| L3 | `request`: the request's identifier, the status, the duration | The api, once for every request it answers, the webhook's among them |
| L4 | `job`: the job's identifier and type, the tenant, the conversation if the job has one, the outcome as the code (`done`, `retry`, `dead`), the duration | The worker, once for every job it runs. M2 reported only a retry and a dead job, without saying which |
| L5 | `loop-error`, with a code | The worker, as now |

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
