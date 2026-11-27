# Design note: the emergency phrase list and the unsupported-type reply (M3 unit U10, first part)

Status: proposed by the agent, 2026-11-28, before any code, and not yet
reviewed. Issue #309. Stories: US-C6, 10 (its first half); US-C12, 1, 3
and 4. Order of checks, steps 4a and 13. Guardrail policy, section 6.
Finding #112 is answered in section 3; #233 in section 2.

U10 is split, as the plan foresaw. **This part**: what code does with an
emergency, and with a batch it cannot read. **The second part**: opting
out and in (machine 6, `consent_records`), step 8's mark, and the
notice writer. Issue #309 is closed by the second part.

The first half matters most. Since U11 a handed-over session is not
given to the model, so an emergency written there gets nothing
(#339). A list of phrases checked by code is what closes that.

## 1. What is honest to say first

**A list of phrases is a weak guard on a person's life, and this one
was written by the agent.** The phrases in Arabic, Urdu, Hindi, Bengali
and Tagalog were read by no speaker (decisions, row 53). The list will
miss wording nobody thought of, and it will fire on harmless messages
("I'm dying to try the new facial" is not on it; "this is an emergency
appointment" is). A miss is a customer in danger who gets an ordinary
reply or silence; a false alarm is an unneeded emergency text and a
handover. The list leans to false alarms.

## 2. The emergency phrase list (step 4a)

**The data.** `EMERGENCY_PHRASES` in the core: for each of the six
supported languages, a list of phrases. Every language's list is
checked against every text, whatever language the session is in.

**Matching.** The text and each phrase are made plain as the reply
checks make text plain (compatibility form, lower case, unseen
characters and the marks over Arabic letters removed), and runs of
white space become one space. A phrase matches where it stands in the
text with no letter directly before or after it: "overdose" is not
found in "overdosed"; both are on the list where both are meant.

**Where.** At the start of a turn, before anything else: before the
check for a handed-over session (step 10), before the tenant's
"answering" check (step 8), before the model. Every text of the batch,
captions included, is checked. A tap carries no text.

| # | Case | Result |
| --- | --- | --- |
| E1 | A text of the batch holds a phrase; the session is not handed over | The emergency trigger of U11 (reason `emergency`, urgent): a handover is made, the emergency text is sent, and the turn then finds the session handed over (step 10): the batch is marked and the model is **not** called |
| E2 | The same, in a session that is already handed over | The reason is added and the handover becomes urgent; the emergency text is sent, unless the contact has one waiting or was sent one in the last 60 minutes (U11, H-e) |
| E3 | The same, for a tenant that is not answering (no profile loaded) | As E1 or E2: step 4a comes before step 8. The text is sent if the channel can send |
| E4 | The same again in a later batch, within 60 minutes | Nothing more: the handover is already urgent and the text was sent |
| E5 | No phrase | Nothing here. The model's `emergency` flag is still the second net (U11, G5) |
| E6 | The turn is tried again after a failure | The check runs again; the trigger adds nothing the second time and the text is not sent twice (U11's rules) |
| E7 | The worker has no fixed texts (a test of an earlier unit) | The check is not run |

**Not the model's to see.** Under E1 the model is not called for that
batch, so nothing else in it is answered. An emergency outranks a
question about prices.

**Not built** (and said in the guardrail policy already): the email to
staff and its hourly ceiling (M4); the text in two languages (only
English exists, row 51); a tenant whose channel cannot send sends
nothing. #233 asks that step 4a not email staff outside the throttle
before the rate pause: there is no email and no rate pause yet; U12 and
M4 must settle it.

## 3. The unsupported-type reply (step 13; US-C12)

A batch **cannot be read** when it holds no text and no tap on a core
button, and at least one message of a kind a person sends to say
something. Which kinds (#112):

| Kind as the channel names it | Treated as |
| --- | --- |
| `image`, `video` (with no caption), `audio`, `document`, `sticker`, `location`, `contacts` | Cannot be read: gets the reply |
| `reaction`, and any other kind the channel delivers (`interactive` that was not read, `order`, `system`, `unknown`, and the rest) | Ignored: marked as dealt with, no reply, not counted |
| `text`, a caption | Text |
| A tap on the person button | U11's. On the stop or start button: the second part's; until then marked and ignored, as today |

| # | Case | Result |
| --- | --- | --- |
| N1 | A batch that cannot be read; the session's count is 0 or 1 | The `unsupported-type` text is sent, with the person button (row 50), and the count goes up by 1 |
| N2 | The third such batch in a row (the count is 2) | The session is handed over with the reason `unsupported-content`, and the customer gets the handover text. **The unsupported-type reply is not sent as well** (#112): one message, not two |
| N3 | A batch with text, or with a tap on the person button | The count is set to 0 when that batch's turn ends, whatever it ends with |
| N4 | A batch of ignored kinds only | Marked. No reply, and the count is not moved |
| N5 | A batch that cannot be read, in a handed-over session | Step 10 comes first: marked, nothing sent |
| N6 | The same, for a tenant that is not answering | Step 8 comes first: nothing, as today |
| N7 | A new session | The count starts at 0: it is the session's |
| N8 | The content of what cannot be read | Never given to the model: the model is not called for such a batch, and a batch with text gives the model its texts only (U7) |

The reply is a message of class `system-reply`: not held back or
discarded for a newer message. It carries the disclosure when it is
the first of its session. The count moves when the reply is stored,
not when it is sent: "three batches that could not be read" is a fact
about what the customer sent, not about what we delivered.

`sessions.unreadable_batches`: a whole number, 0 to 100.

## 4. The database

Migration 0014: `sessions.unreadable_batches`. Down: dropped.

## 5. What is not built, in one place

- The phrases were read by no speaker, and no eval (E17) has measured
  what they miss (U16).
- The emergency email; the emergency text in two languages.
- A phrase inside an image, a voice note or a document is not read.
- Opting out and in, step 8's mark, the notice writer: the second part.
- The media of an unsupported message is not kept or shown to anyone:
  only its kind is stored (US-C12, 3). What staff see is M4's.

## 6. Documents

The guardrail policy, section 6 (what is built of the emergency rule);
the state machines, steps 4a and 13; the data model
(`unreadable_batches`); the decisions page (row 53; row 50's button);
traceability (US-C6, US-C12); STATUS; README. #339's item on an
emergency in a handed-over session is closed by this.

## 7. Tests

Each row of the two tables through the worker and the in-memory
channel. Every phrase of every language found in a sentence; the
boundary rule; text made plain (case, marks, full-width letters, two
spaces). A handed-over session with an emergency: the text is sent and
the model is not called. The kinds: each that gets the reply, each
that is ignored. The count across batches, a text between, a new
session. The end-to-end test: a message that says someone is not
breathing gets the emergency text and no echo.
