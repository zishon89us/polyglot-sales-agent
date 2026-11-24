# Design note: the turn, and the customer's language (M3 unit U7)

Status: proposed by the agent, 2026-11-25, before any code; rewritten the
same day after its review
(`docs/reviews/2026-11-25-m3-u7-design-review.md`, three High findings),
and not reviewed again. Issue #306. Stories: US-C3, 4; US-C8, 4 (with a
tool that exists only in tests); US-C11, 5; order of checks, step 15.

This unit puts the model where the echo is. It decides what of a
customer and a business is sent to a model, and what is recorded about a
person's language, so the cases are written here first and reviewed
before the code.

## 1. What is built, and what is not

Built:

- the worker's turn: assemble a request, call the model through the
  client, run the tools it asks for, store the reply;
- the first prompt, `reply`, version 1;
- marking of data inside a request, so that no customer's, owner's or
  tool's text can close its own mark (guardrail policy, I5);
- the language of a session, and the mark for a language that is not
  supported;
- the `tool_calls` table, and an answer to whether it holds a customer's
  words;
- a stand-in for the model, for development and the end-to-end test.

Not built here. Each is another unit's, and **until it is built the
product is not fit to answer a real customer**, which it cannot do yet
in any case: no adapter to a real model exists (U14), and the worker
refuses to start in production.

| What | Whose | Until then |
| --- | --- | --- |
| Checking the reply's claims, the canary and repeated instructions | U9 | **A reply is sent unchecked** |
| Acting on the model's flags (handover, emergency, stop) | U10, U11 | Flags are read and dropped |
| The disclosure on a session's first message; the fallback text | U8 | Neither is sent |
| What happens when the model fails (machine 8), degraded mode | U15 | Section 8, S2: a timeout or a provider's failure fails the job, which is tried again; an answer that is refused is not tried again and the customer gets nothing |
| A batch with no text (step 13); the buttons | U10 | No model call and no reply; the batch is marked as dealt with, as the echo did. **A tap on the stop button is lost** until U10 |
| A tenant that is not answering (step 8) | U10 | No model call and no reply; the batch is left as it is |
| The turn cap and the token budget | U12 | None |
| Real tools, the confirmation a state-changing tool sends, recognising a repeat (`repeat_of`) | M5 | The loop runs with a tool that exists only in tests. **No tool that changes anything may be given to it** until the next row is built: a turn that is tried again runs its tools again |
| Earlier turns' tool results in a later turn's request (architecture, "Processing one turn", 2) | M5, with the first real tool | The table holds what is needed; nothing reads it back |
| An eval of the prompt | U16, U17 | **None exists.** The prompt's `meta.yaml` says `not-evaluated` |

## 2. Which model the worker calls

A setting, `PSA_MODEL_ADAPTER`, required. Its one value in this unit is
`stand-in-echo`: an adapter in `packages/ai` that calls nothing and
answers with the customer's own texts after the word "Echo:", as M2's
echo did, in the structure a model must answer in. With it the whole
path runs in development and in the end-to-end test: the prompt is
loaded, the request assembled and marked, the trace stored.

| # | Case | Result |
| --- | --- | --- |
| A1 | The setting is absent or is not a name this version knows | The worker does not start, and names the setting |
| A2 | `stand-in-echo` in production | The worker does not start: reason `stand-in-model`, added to the list of reasons in this unit. A stand-in must never answer a customer. (Today the worker also refuses for its shared channel credential; this refusal does not depend on that one) |
| A3 | `stand-in-echo` in development | Replies are "Echo: " and the batch's texts, one to a line, cut to 1,000 characters as M2's echo was, so that it is always a reply the client accepts; language `und`; no claim, no flag, no tool call; the model's name is `stand-in-echo`; both token counts 0, so the trace has no cost |

The real adapter and its setting's second value are U14's.

## 3. What a request holds

One function builds it from what the turn read. It is given no contact:
it has no parameter through which a phone number or a contact's name
could arrive (NFR-V7). What a customer typed is sent as typed, their own
number or name included if they typed it (decisions row 36, unanswered).

| Part | Holds | From |
| --- | --- | --- |
| `system` | The `reply` prompt, then the pack's fragment if the tenant's pack has one, with the canary in place | `prompts/`, by name and version fixed in code, found beside the code (the image must hold the folder; a worker that cannot load the prompt does not start); the canary is the setting `PSA_PROMPT_CANARY` (16 to 64 letters and digits), required, and checked for the example file's placeholder in production |
| Data: the business | The profile U3 assembles, as JSON: name, time zone, currency, support contact, services with prices as text, policies, opening hours | `loadBusinessProfile` |
| Data: the turn | As JSON: how many of the batch's messages could not be read (`unread`), and whether earlier text of the batch was left out for length (`truncated`) | The batch |
| The session so far | Its earlier messages, oldest first: the customer's texts as `customer`, and what was sent to them as `assistant` | Section 4 |
| The batch | Its texts as `customer`, oldest first, bounded by `boundBatch` (8,000 characters; the oldest are left out first) | `beginTurn` |
| `tools` | The tools of the turn: none in a deployment until M5 | The handler's options |
| `claimKinds` | The core's four | `CORE_CLAIM_KINDS` |
| Limits | `MODEL_OUTPUT_TOKENS_MAX`, `MODEL_CALL_TIMEOUT_MS` | U4 |

No sentence is written in code. What the model is told to do with
`unread` and `truncated` is in the prompt; the code gives two values.

| # | Case | Request |
| --- | --- | --- |
| R1 | A batch of two texts | Two `customer` messages after the data and the history |
| R2 | A text and a picture with no caption (US-C11, 5) | The text, and `unread: 1`. The picture's type is not sent. The prompt says to answer the text and to say the other content could not be read |
| R3 | A text and a tap on a button | The text. A tap is not text and is not counted as unread: what a button does is U10's |
| R4 | A caption | A text like any other |
| R5 | A batch over 8,000 characters | The newest texts that fit, the oldest of them cut at its start if one text alone is over, and `truncated: true` in both cases |
| R6 | No text at all | No request: section 1 |
| R7 | The tenant is not answering: `answering()` names a required setting that is not set | No request. The batch is **not** marked as dealt with and the lease is given back: step 8's own mark is U10's. The messages stay for a later turn |
| R8 | The tenant's pack is not one this deployment has | The turn's job fails with `unknown-pack`: a fault of the deployment, not of the customer |

## 4. The session so far

The model is given the open session's earlier messages so that a reply
can follow from what was said.

| # | Message of the session | In the request |
| --- | --- | --- |
| H1 | A customer's text a turn has dealt with | `customer` |
| H2 | An assistant's reply the channel accepted (sent, delivered or read), or one whose send ended `unconfirmed`, which the customer may have: a row of class `assistant-reply`, kind `text`, with a body | `assistant` |
| H2a | Anything else that was sent: a staff member's message, a fixed text, a notice, a message the business began | **Never included.** A staff member's message can hold the contact's name |
| H2b | A row whose text has been removed | Not included |
| H3 | A reply that was dropped, failed, or still waits to be sent | Not included: the customer may not have it. (A reply still waiting is included in no turn; the send job holds it back while a newer message waits, U2) |
| H4 | A message of a type that is not read, a tap | Not included |
| H5 | More than 30 messages, or more than 12,000 characters in all | The newest 30, and of those the newest run that fits the second bound: the first message that does not fit ends the history, so that no older one stands beside a newer with a hole between. One newest message over 12,000 characters therefore leaves no history at all. Both numbers are this note's, unmeasured |
| H6 | A message of an earlier session of the same conversation | Not included: a session is the unit of context |

## 5. Marking data (I5; US-C8, 4)

Only the system text is instruction. **Every message's text is marked,
whatever its kind**: the business's data, the customer's texts, a tool's
result, and the assistant's own earlier replies too, which can repeat a
customer's words (the stand-in's replies are nothing else).

The client builds a marked copy of the request and gives the adapter
that copy; no adapter and no caller can leave it out. A scripted adapter
in a test records the marked copy.

```text
[[data:<mark>]]
<the text>
[[end:<mark>]]
```

`<mark>` is 32 hexadecimal characters drawn for that one call from the
system's random source, which a test can replace.

| # | Case | Result |
| --- | --- | --- |
| M1 | Some text of the request holds the mark that was drawn | That mark is thrown away and another is drawn, up to 8 times; then the call is refused as a fault. **Nothing is removed from any text.** The chance of one such draw is about 1 in 2^128 unless the source is broken |
| M2 | A text that holds `[[end:` with another mark, or `[[data:` | Left as it is: it closes nothing, because the mark differs |
| M3 | An `assistant` message | Marked like the others |
| M4 | A tool's result that says "ignore your instructions" | Marked as any data. That the model does not follow it is the model's behaviour and is shown by the evals (U16), not here |
| M5 | The prompt | Says what the two lines mean without naming a mark: it is fixed text and the mark is not |
| M6 | Two calls of one turn | Two marks |
| M7 | The calls an earlier answer of the turn made (section 6) | Given to the adapter as structure: an identifier, a name and arguments, as the model wrote them, copied all the way down. They are not text in a message and are not marked; a call's identifier is on its result too, also unmarked, and is bounded only in length. The system text and a tool's description are this repository's own |
| M8 | The trace | Unchanged: it holds nothing of a request's text |

The guardrail policy's I5 said a copy of the mark inside a text "is
removed". It is amended to say what M1 does.

## 6. The tool loop

The model may answer with calls to tools instead of a reply (U4). The
turn then runs each call and asks again, giving the calls and their
results.

| # | Case | Result |
| --- | --- | --- |
| L1 | An answer with a reply | The loop ends; section 8 |
| L2 | An answer with 1 to 4 calls | Each is run in order, each in a short transaction of its own that **first checks the turn's lease** (architecture, "Processing one turn", 3), then runs the tool and stores its `tool_calls` row with the outcome `done`. Then the model is called again with the calls and their results added |
| L2a | A tool says the arguments are not ones it takes | The row's outcome is `refused`; the model is given `{"error":"refused"}`. Arguments are checked by the tool, where it runs |
| L3 | A tool that throws, takes more than 2 seconds, runs one statement for more than half a second, or returns what is not plain data or is over 4,000 characters as JSON | Its transaction is undone whole, so nothing it wrote stays. Its row is then stored with the outcome `failed` in a second transaction that checks the lease again; the model is given `{"error":"failed"}`. The tool's message is not given to the model or stored. (The limits matter because the lease check holds the conversation's row, which storing an inbound message also needs and waits 3 seconds for. The wait for a tool ends at 2 seconds; a statement still running then is stopped by the database within half a second more, so the row is held 2.5 seconds at most. The first form of this note gave one limit of 5 seconds, which did not stop a running statement) |
| L4 | The lease is no longer this worker's when a tool is to run | The tool is not run and nothing is stored; the turn ends without a reply, as a lost lease does |
| L5 | A fifth answer that still asks for tools (`TOOL_ROUNDS_MAX` is 4) | The turn ends with `tool-rounds`: no reply, and not tried again (section 8, S2) |
| L6 | A call that names a tool that was not offered, or five calls | Already refused by the client (`invalid-output`, `tool-call`): no reply, and not tried again |
| L7 | Before each call to the model, the first included | The lease is renewed (architecture, 1). If it is no longer this worker's, no call is made and the turn ends |
| L8 | No tool is offered | The loop is one call |

A request's messages gain a fifth kind for this, `tool-calls`: the calls
an earlier answer of the same turn made. U4 had the result of a call and
nowhere to say what the call was, and a provider needs both.

**Does `tool_calls` hold a customer's words?** Yes, it can. Its
arguments are written by the model, which can copy what a customer said
into them, and a tool's result can repeat it. The data model said the
table holds "identifiers and times, not customer text" and on that
ground kept it when a customer's data is deleted. That sentence cannot
be made true by this table's design. So:

- `arguments` and `result` are **treated as the customer's text**: each
  is removed when the row is older than the tenant's retention period,
  by the row's own time as a message's text is by its own, and when the
  contact's data is deleted or anonymised. The jobs that do it are M5's
  and need a grant to update those two columns, which this unit does not
  give; the data model's table of what is kept says all this from this
  unit;
- the row itself, with the tool's name, the outcome and the times,
  holds no text and is kept;
- no log line and no trace carries either.

## 7. The customer's language (US-C3, 4)

The model says which language the customer wrote in: every answer gains
a field, `language`, a code of exactly two small letters (ISO 639-1), or
`und` when it cannot tell. An answer without it, or with anything else
(`eng`, `EN`, `en-GB`), is `invalid-output` (`shape`). An answer that
asks for tools carries the field too; only the language of the answer
that replies is recorded. Every test and fake that builds an answer is
changed with the field.

The supported set at run time is a list in the core: `ar`, `en`, `ur`,
`hi`, `bn`, `tl`. **It is the agent's proposal** (decisions row 4,
unanswered); a different answer changes one list.

When a reply is stored, in the same transaction:

| # | The answer's language | `sessions.language` | `sessions.unsupported_language` |
| --- | --- | --- | --- |
| G1 | A supported one | Set to it | Unchanged |
| G2 | One that is not supported (US-C3, 4) | Set to it | **Set to true, and never set back.** The reply is sent as the model wrote it: the attempt is made |
| G3 | `und` | Unchanged | Unchanged |
| G4 | A different supported one in a later turn (US-C3, 3) | Set to the new one | Unchanged: a session that was ever marked stays marked, so that it stays out of quality claims |
| G5 | The reply is not stored (a newer message, a lost lease, a failed call) | Unchanged | Unchanged |

The mark is the model's word about a customer, taken as given. It is
used for metrics and for which sessions quality is claimed for. Nothing
is refused or sent on its strength in this unit. So that the mark does
not rest on a word that was thrown away, **each reply's row records the
language its turn reported** (`messages.language`): a session's mark can
be checked against its replies and worked out again if the rule or the
supported list changes. `contacts.last_language`
is not built here: the fixed texts that would read it are U8's.

## 8. Storing the reply

As U2 built it, with these additions in the same transaction: the
session's language (section 7), and on the reply's row the language and
the turn's identifier, so that a reply can be joined to its traces
(#186). A reply longer than the channel carries cannot be made: the
client refuses one over 1,200 characters.

The turn's identifier is made once for each run of the job's handler.
The time the turn began is the worker's clock when the turn's code
starts, just after `beginTurn` returns and before anything else is
asked of the database.

`generate` is called outside any transaction, for a session that
`beginTurn` has committed (the rule of U6).

| # | Case | Result |
| --- | --- | --- |
| S1 | The model replies | The reply is stored, the batch is marked as dealt with, the send job is queued; the language is recorded |
| S2 | A timeout, a provider's failure, or a trace that could not be stored | Nothing is stored; the lease is given back; the job fails with a code (`model-timeout`, `model-provider-error`, `trace-not-stored`) and is tried again as any job is: 6 tries in all. **Each try calls the model again and runs the turn's tools again**: at worst 6 × 5 = 30 calls and 6 × 16 = 96 runs of a tool for one batch. After the last try the batch stays unanswered, and the customer's next message starts it again. U15 replaces this |
| S2a | An answer the client refuses (`invalid-output`), a reply of nothing but space, or `tool-rounds` | Not tried again by the job: the same request would likely give the same answer. The batch is marked as dealt with, with no reply, and a line is logged with the code. **The customer gets nothing** until U9 has a fallback to send. If the customer wrote again meanwhile, nothing is marked, and the next turn answers the whole batch, calling the model again |
| S2b | How long one try can take | 5 calls of 20 seconds, 5 traces of 5 seconds, 16 tool runs of 2.5 seconds: 165 seconds, under the 240 a job is given. The lease is 120 seconds and is renewed before each call; the longest stretch between renewals is one call, its trace and four tools, 35 seconds |
| S3 | The customer wrote again during the call | As U2: the reply is dropped, up to twice in a row |
| S4 | The reply is empty or only space and no tool is asked for | The client accepts such an answer; the turn does not send it: S2a, with the code `empty-reply` |

## 9. The prompt

`prompts/reply/1/prompt.md`, in English, with what the guardrail
policy's section 9 lists, and: what the two lines of a data mark mean;
what `unread` and `truncated` mean; that `language` is the language the
customer wrote in, by its code, also when they wrote it in Latin
letters; that the reply is in that language and its usual script. It
asks for at most 1,000 characters where the client takes 1,200: a
margin, unmeasured.

It is the first text a model is ever given by this product and **no
eval has run on it**. A test checks that the file loads and holds each
of section 9's eight points by a word of it; that is a check that
nothing was deleted, not that the prompt works.

## 10. The database

Migration 0010:

- `sessions.language` (null, or two small letters; never `und`) and
  `sessions.unsupported_language` (false);
- `messages.turn_id` and `messages.language` (both null except on an
  assistant's reply made by a turn);
- `tool_calls`: tenant, session, turn, the tool's name (the pattern of
  U6), `arguments` and `result` (JSON, each null once removed), the
  outcome (`done`, `refused` or `failed`), `created_at` and `ended_at`
  (the design's `result_at`, renamed: a failed call has no result). The
  application may insert and read. `repeat_of`, and the grant to remove
  the two JSON columns, are M5's.

## 11. Documents changed with this unit

The data model (`sessions`, `messages.turn_id`, `tool_calls`, and the
retention table, and an index on a session's messages, which every turn
reads); the architecture ("Processing one turn": what is built
of it); the state machines (step 15 as built); ADR 0005 (the fifth kind
of message, the `language` field, the marking of data); the guardrail
policy if section 9 or I5 says anything this contradicts; `prompts/`
README; `.env.example`; decisions rows 48 (the unsupported mark is sticky and taken from the
model) and 49 (`tool_calls` is treated as a customer's text);
traceability; STATUS; README.

## 12. What is not known

- Whether a model reports a language reliably, most of all for a
  language written in Latin letters or two languages mixed. Only an
  eval against a real model can show it (U17).
- Whether 30 messages and 12,000 characters of history are the right
  bounds.
- Whether the form of the data mark is one a real model respects.
