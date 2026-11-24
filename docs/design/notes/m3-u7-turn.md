# Design note: the turn, and the customer's language (M3 unit U7)

Status: proposed by the agent, 2026-11-25, before any code. Issue #306.
Stories: US-C3, 4; US-C8, 4 (with a tool that exists only in tests);
US-C12, 5 (the plan's table says US-C11, 5; the criterion it means, a
batch of text and something unreadable, is US-C12's); order of checks,
step 15.

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
| What happens when the model fails (machine 8), degraded mode | U15 | The turn's job fails and is tried again as any job is; after its last try the batch stays unanswered until the customer writes again |
| A batch with no text (step 13); a tenant that is not answering (step 8); the buttons | U10 | No model call and no reply; the batch is marked as dealt with, as the echo did |
| The turn cap and the token budget | U12 | None |
| Real tools, the confirmation a state-changing tool sends, recognising a repeat (`repeat_of`) | M5 | The loop runs with a tool that exists only in tests |
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
| A2 | `stand-in-echo` in production | The worker does not start: reason `stand-in-model`. A stand-in must never answer a customer |
| A3 | `stand-in-echo` in development | Replies are "Echo: " and the batch's texts, one to a line; language `und`; no claim, no flag, no tool call; the model's name is `stand-in-echo`; both token counts 0, so the trace has no cost |

The real adapter and its setting's second value are U14's.

## 3. What a request holds

One function builds it from what the turn read. It is given no contact:
it has no parameter through which a phone number or a contact's name
could arrive (NFR-V7). What a customer typed is sent as typed, their own
number or name included if they typed it (decisions row 36, unanswered).

| Part | Holds | From |
| --- | --- | --- |
| `system` | The `reply` prompt, then the pack's fragment if the tenant's pack has one, with the canary in place | `prompts/`, by name and version fixed in code; the canary is the setting `PSA_PROMPT_CANARY` (16 to 64 letters and digits), required |
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
| R2 | A text and a picture with no caption (US-C12, 5) | The text, and `unread: 1`. The picture's type is not sent. The prompt says to answer the text and to say the other content could not be read |
| R3 | A text and a tap on a button | The text. A tap is not text and is not counted as unread: what a button does is U10's |
| R4 | A caption | A text like any other |
| R5 | A batch over 8,000 characters | The newest texts that fit, and `truncated: true` |
| R6 | No text at all | No request: section 1 |
| R7 | The tenant's required settings are not all set, so no profile can be assembled | No request, as R6 (step 8 is U10's) |
| R8 | The tenant's pack is not one this deployment has | The turn's job fails with `unknown-pack`: a fault of the deployment, not of the customer |

## 4. The session so far

The model is given the open session's earlier messages so that a reply
can follow from what was said.

| # | Message of the session | In the request |
| --- | --- | --- |
| H1 | A customer's text a turn has dealt with | `customer` |
| H2 | An assistant's reply the channel accepted (sent, delivered or read) | `assistant` |
| H3 | A reply that was dropped, failed, or still waits to be sent | Not included: the customer may not have it. (A reply still waiting is included in no turn; the send job holds it back while a newer message waits, U2) |
| H4 | A message of a type that is not read, a tap | Not included |
| H5 | More than 30 messages, or more than 12,000 characters in all | The newest that fit both; the oldest are left out. Both numbers are this note's, unmeasured |
| H6 | A message of an earlier session of the same conversation | Not included: a session is the unit of context |

## 5. Marking data (I5; US-C8, 4)

Every `data`, `customer` and `tool-result` text is wrapped before any
adapter sees it, by the client itself, so that no adapter and no caller
can leave it out:

```text
[[data:<mark>]]
<the text>
[[end:<mark>]]
```

`<mark>` is 32 hexadecimal characters made for that one call from the
system's random source.

| # | Case | Result |
| --- | --- | --- |
| M1 | A text that holds the call's own mark, or `[[end:` followed by it | Every copy of the mark is removed from the text before it is wrapped. Its chance of being guessed is 1 in 2^128 |
| M2 | A text that holds `[[end:0000…]]` with another mark, or `[[data:` | Left as it is: it closes nothing, because the mark differs |
| M3 | An `assistant` message | Not wrapped: it is the model's own earlier words |
| M4 | A tool's result that says "ignore your instructions" | Wrapped as any data. That the model does not follow it is the model's behaviour and is shown by the evals (U16), not here |
| M5 | The prompt | Says what the two lines mean without naming a mark: it is fixed text and the mark is not |
| M6 | Two calls of one turn | Two marks |

## 6. The tool loop

The model may answer with calls to tools instead of a reply (U4). The
turn then runs each call and asks again, giving the calls and their
results.

| # | Case | Result |
| --- | --- | --- |
| L1 | An answer with a reply | The loop ends; section 8 |
| L2 | An answer with 1 to 4 calls | Each is run in order, each in a short transaction of its own that **first checks the turn's lease** (architecture, "Processing one turn", 3), then runs the tool and stores its `tool_calls` row. Then the model is called again with the calls and their results added |
| L3 | A tool that throws | Its row is stored with the outcome `failed`; the model is given `{"error":"failed"}` as that call's result. The tool's message is not given to the model or stored |
| L4 | The lease is no longer this worker's when a tool is to run | The tool is not run and nothing is stored; the turn ends without a reply, as a lost lease does |
| L5 | A fifth answer that still asks for tools (`TOOL_ROUNDS_MAX` is 4) | The turn fails with `tool-rounds`, as a failed call does (section 1) |
| L6 | A call that names a tool that was not offered, or five calls | Already refused by the client (`invalid-output`, `tool-call`): the turn fails |
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

- `arguments` and `result` are **treated as the customer's text**: they
  are removed when the conversation's text is (retention, deletion,
  anonymising; all M5), and the data model's table of what is kept says
  so from this unit;
- the row itself, with the tool's name, the outcome and the times,
  holds no text and is kept;
- no log line and no trace carries either.

## 7. The customer's language (US-C3, 4)

The model says which language the customer wrote in: its answer gains a
field, `language`, a code of two or three small letters (ISO 639), or
`und` when it cannot tell. An answer without it, or with anything else,
is `invalid-output` (`shape`).

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
is refused or sent on its strength in this unit. `contacts.last_language`
is not built here: the fixed texts that would read it are U8's.

## 8. Storing the reply

As U2 built it, with three additions in the same transaction: the
session's language (section 7); the turn's identifier on the reply's
row, so that a reply can be joined to its traces (#186); and nothing
else. A reply longer than the channel carries cannot be made: the
client refuses one over 1,200 characters.

The turn's identifier is made once for each run of the job's handler.
The time the turn began is read when `beginTurn` returns.

`generate` is called outside any transaction, for a session that
`beginTurn` has committed (the rule of U6).

| # | Case | Result |
| --- | --- | --- |
| S1 | The model replies | The reply is stored, the batch is marked as dealt with, the send job is queued; the language is recorded |
| S2 | The call fails, in any of the client's ways, or its trace could not be stored | Nothing is stored; the lease is given back; the job fails with a code (`model-timeout`, `model-provider-error`, `model-invalid-output`, `trace-not-stored`, `tool-rounds`) and is tried again. **Each try calls the model again.** U15 replaces this |
| S3 | The customer wrote again during the call | As U2: the reply is dropped, up to twice in a row |
| S4 | The reply is empty and no tool is asked for | Already refused by the client as `shape` |

## 9. The prompt

`prompts/reply/1/prompt.md`, in English, with what the guardrail
policy's section 9 lists, and: what the two lines of a data mark mean;
what `unread` and `truncated` mean; that `language` is the language the
customer wrote in, by its code, also when they wrote it in Latin
letters; that the reply is in that language and its usual script.

It is the first text a model is ever given by this product and **no
eval has run on it**. A test checks that the file loads and holds each
of section 9's eight points by a word of it; that is a check that
nothing was deleted, not that the prompt works.

## 10. The database

Migration 0010:

- `sessions.language` (null, or two or three small letters) and
  `sessions.unsupported_language` (false);
- `messages.turn_id` (null; for an assistant's reply, the turn that made
  it);
- `tool_calls`: tenant, session, turn, the tool's name (the pattern of
  U6), `arguments` and `result` (JSON, each null once removed), the
  outcome (`done` or `failed`), when it was asked and when it ended. The
  application may insert and read. `repeat_of` is M5's.

## 11. Documents changed with this unit

The data model (`sessions`, `messages.turn_id`, `tool_calls`, and the
retention table); the architecture ("Processing one turn": what is built
of it); the state machines (step 15 as built); ADR 0005 (the fifth kind
of message, the `language` field, the marking of data); the guardrail
policy if section 9 or I5 says anything this contradicts; `prompts/`
README; `.env.example`; the glossary for the two numbers of section 4;
decisions rows 48 (the unsupported mark is sticky and taken from the
model) and 49 (`tool_calls` is treated as a customer's text);
traceability; STATUS; README.

## 12. What is not known

- Whether a model reports a language reliably, most of all for a
  language written in Latin letters or two languages mixed. Only an
  eval against a real model can show it (U17).
- Whether 30 messages and 12,000 characters of history are the right
  bounds.
- Whether the form of the data mark is one a real model respects.
