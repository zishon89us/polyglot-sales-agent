# Design note: fixed texts and the disclosure (M3 unit U8)

Status: proposed by the agent, 2026-11-25, before any code; rewritten the
same day after its review
(`docs/reviews/2026-11-25-m3-u8-design-review.md`, three High findings),
and not reviewed again. Changed once more after the code's review
(`docs/reviews/2026-11-25-gate4-u8-fixed-texts.md`): cases D2b and D2c,
and the sentence "never not at all", which was not true. Issue #307.
Story: US-C5, criteria 1 to 3. Also #107, #212, #184 (part l) and #222
(where the stop button appears).

This unit decides words that are sent to every customer in the
business's name, and the one sentence that tells a person they are
talking to a machine. So the cases are written here first and reviewed
before the code.

## 1. What is built, and what is not

Built:

- the fixed texts M3 sends, as one versioned file for each language,
  with one reader that refuses a file that is not complete;
- the rule for which language a fixed text is sent in;
- the disclosure, put before the first message of a session by code,
  where the message is sent and not where it is written;
- the answer to "am I talking to a person?", put before the reply by
  code when the model flags the question. **The prompt is not changed:**
  a second version could not be evaluated yet;
- buttons on a sent message: stored with it, and sent by the worker.

Not built here:

| What | Whose | Until then |
| --- | --- | --- |
| Sending the other nine texts: fallback, unsupported type, the two handover texts, emergency, the two confirmations, the rate notice, the opt-in question | U9, U10, U11, U12 | The texts exist and are read at start-up; nothing sends them |
| **The wording in any language but English** | A speaker of each (#168), after decisions row 4 | Section 3: a customer who wrote in Arabic gets the disclosure in English. That is a gap in US-C5, 2 and is listed |
| The booking texts, the holding message, templates | M5, M4 | None |

## 2. The texts

`texts/fixed/<version>/<language>.json`, beside `prompts/`. One file for
one language holds every text and every button's title. Which version
runs is named in code and changed by pull request.

| Name | Says (guardrail policy, section 7) | Buttons | Filled in by code |
| --- | --- | --- | --- |
| `disclosure` | That an automated assistant is replying | | |
| `automated-assistant` | That an automated assistant is replying and a person can be asked for | | |
| `fallback` | That the assistant could not answer that, and a person can be asked for | person | |
| `unsupported-type` | That only text can be read | person | |
| `handover-in-hours` | That a person will reply | | |
| `handover-out-of-hours` | The next opening time and the support contact | | `opening`, `contact` |
| `emergency` | To contact local emergency services now; no phone number | | |
| `opt-out-confirmation` | What was done and how to reverse it | start | |
| `opt-in-confirmation` | What was done and how to reverse it | stop | |
| `rate-notice` | That the assistant will pause | | |
| `opt-in-question` | Asks whether to resume messages | start | |

**Where the stop button appears (#222, second part):** on the
confirmation that messages are on again, and nowhere else in M3. The
confirmation that messages are off carries the start button, and so does
the question. Each confirmation thus carries the button that undoes it.
Decisions row 50 asks the maintainer.

A file is read whole at start-up and refused, with the worker not
starting, unless:

| # | Rule |
| --- | --- |
| F1 | It is JSON with exactly `language`, `texts` and `buttons`; `language` is the file's name |
| F2 | `texts` has exactly the eleven names, each with a `body` and nothing but `body` and `buttons` |
| F3 | A body is at least 1 and at most 300 UTF-16 units, the disclosure at most 150, with no control character but a line break, no blank start or end |
| F3a | The disclosure, a blank line and any text that has buttons are together at most 500, the most the smallest channel carries with buttons; the disclosure, the `automated-assistant` text, two blank lines and the longest reply (1,200) are together at most 2,000, the most it carries as text |
| F4 | A body holds exactly the places its text is given in the table, each once, written `{{name}}`; no other `{{` |
| F5 | A text's buttons are exactly those of the table, in that order |
| F6 | `buttons` has exactly `stop`, `start` and `person`, each a title of 1 to 16 characters that the channel's own check of a title accepts, no two the same by that check |
| F7 | The `emergency` text holds no character Unicode calls a number, in any script: it must give no phone number |
| F8 | English exists |

The numbers are chosen for the smallest channel there is, the in-memory
one (2,000 as text, 500 with buttons, a title of 16), and a test fails
if any channel's own limits are under them. The longest first message
of a session is 150 + 2 + 300 + 2 + 1,200 = 1,654.

A place is filled only by code, with a value code made (a time written
out) or the owner wrote (the tenant's support contact). A value is at
most 254 UTF-16 units, with no line break or control character and no
`{{`; the filled text is at most 700; a text whose places are not all
given is refused. Nothing is sent with a place left open. What is sent
when a value is missing is the sending unit's to decide (U11); a tenant
that answers has a support contact, which is a required setting.

## 3. Which language

One function, given the languages in order of preference and the
tenant's default:

1. the first of the given languages that is supported (U7's list) and
   has a file;
2. else the tenant's default language, if it has a file;
3. else English.

| # | Case | Language of the text |
| --- | --- | --- |
| G1 | The turn's reply was reported as English | English |
| G2 | The turn's reply was reported as German, which is not supported; the tenant's default is English | English (US-C5, 2: the tenant's default) |
| G3 | Reported as Arabic; no Arabic file exists yet | The tenant's default if it has a file, else English. **This is the gap:** with only English written, every fixed text is in English |
| G4 | `und`, or nothing known of the contact | The tenant's default, else English |
| G5 | A message with no turn behind it (a fixed text sent on its own) | The session's language, then the contact's last one, by the same rule |

The languages given, in order: the language the message's own turn
reported, the session's, the contact's last. `contacts.last_language`
is added here: set when a reply is stored, and only to a supported
language, so that one unsupported turn does not wipe a supported
language known before.

The gaps are listed in `texts/README.md`, and a test fails if the list
there is not the supported languages that have no file.

## 4. The disclosure (US-C5, 1 and 2)

A session records when its customer was told (`sessions.disclosed_at`).
A message records the disclosure its last try sent, or would have
(`messages.disclosure`), apart from any other fixed text put before its
body (`messages.lead`, section 5).

The disclosure is decided **each time a message is taken to be sent**,
in the same transaction that marks it as being sent, and not when it is
written: a reply can be written and then dropped for a newer message,
and the first message written is not always the first one sent.

| # | Case | Result |
| --- | --- | --- |
| D1 | A message of a session that has not been told is taken to be sent | Its `disclosure` is set to the text, in the language of section 3. What is sent is the disclosure, the lead and the body, each present one separated by a blank line |
| D2 | The channel accepts it | The session is marked as told, in the transaction that records the send |
| D2a | The channel accepted it and reports later that it failed | The session's mark is taken off in the transaction that stores the report, unless another message of the session that carried the disclosure is sent, delivered or read. The next message sent carries the disclosure |
| D2b | The channel reports the failure before the worker has stored that the message was accepted: no message has the channel's identifier yet | The report is kept (`early_receipts`) and applied when the send is recorded, in the order such reports arrived: the message ends failed and the session is not marked, unless a delivery was reported before the failure, as it would be had the record been first. The two steps take one lock on the identifier, so the report either finds the message or is kept before the record looks. Everywhere the order of locks is: the conversation, the identifier, the message, the session |
| D2c | A message with the disclosure was accepted, a later one went without it, and then the first is reported failed | The mark comes off, and the next message carries the disclosure. **The customer has by then read a message that did not say it**, and if nothing more is sent in the session they are not told in it. Messages already waiting when the mark comes off are not decided again. Accepted for now; in the follow-up issue |
| D3 | The send fails for good, or its outcome is never known | The session is **not** marked. The next message sent carries the disclosure. A customer can so be told twice |
| D4 | The same message is taken again, after a failure that may be tried again | Decided afresh: the disclosure if the session has still not been told, none if another message told it meanwhile. Nothing is kept from the earlier try |
| D5 | A later message of a session that was told | No disclosure |
| D6 | A new session of the same conversation | Told again: the mark is the session's |
| D7 | Any class of message: the assistant's reply, a fixed text, later a staff member's | The same rule. US-C5, 1 says "of any kind". For a staff member's own message the sentence would be untrue of that message; M4, which builds those, must decide (noted in the follow-up issue) |
| D8 | A message with no session (the business begins; M5) | Not this rule: a template carries the disclosure in its approved wording |
| D9 | A message with buttons that the channel would refuse with them: no buttons on this channel, too many, or the whole text over its limit with buttons | Sent as plain text, without the buttons, and **the row's `buttons` is set to null** when the send is recorded: the record says what the customer saw. Every text that has a button also says in words what to do. With the limits of F3a this happens on neither channel today |
| D10 | The whole text over what the channel carries as text | The send is refused before the call (`bad-body`), as U5 built it. F3a makes this impossible on either channel for a reply the client accepted |
| D11 | Two workers, one conversation | One at a time: the conversation's row is locked for the whole step, as it is today |

The model is never given the disclosure or a lead: the session's history
(U7) holds bodies only, so neither is something the model can learn to
write or to leave out.

## 5. "Am I talking to a person?" (US-C5, 3)

| # | The model's answer | Sent |
| --- | --- | --- |
| P1 | The flag `asks-if-person`, and a reply | The `automated-assistant` text as the message's lead, then the reply |
| P2 | The flag, and an empty reply | The text alone: the message's lead, with an empty body. Before this unit an empty reply sent nothing |
| P3 | No flag | The reply, as today |
| P4 | The flag, in the first message of a session | The disclosure, then the text, then the reply. They say nearly the same thing twice; accepted |
| P5 | The flag and a call for tools | The tools run; the flag that counts is the one on the answer that replies |

In every case the message is the assistant's reply, of the class it has
today, with its turn and language: only its lead is new.

**The prompt is not changed.** Version 1 tells the model to say itself
that it is an automated assistant, so under P1 the customer may read it
twice: once in code's words, once in the model's. Telling the model to
leave it to code would be a second version of a prompt that no eval can
yet be run on, and `AGENTS.md` asks for an eval with every such change.
The first version is already in that position (#332); this unit does
not add to it.

Until U9 and U10: the other six flags are still read and dropped, also
when they come with this one; and the reply beside the fixed text is
still sent unchecked, so it could itself say something a fixed text
must not.

The session's history holds bodies only. A later turn therefore does
not see the fixed answer, and under P2 sees the question with nothing
after it.

## 6. Buttons on a sent message

`messages.buttons`: null, or a list of 1 to 2 buttons, each the payload
(U5's pattern) and the title that was shown. Stored when the message is
written, sent by the worker with the channel's `sendButtons`, or without
them under D9, which also clears them. Two is the most the smallest
channel carries.

A title is stored because a tap comes back with the payload only, and
what the customer saw should be on record.

**This unit sends no message with a button.** It stores and sends them
for the units that do. What a tap on the person button does is U10's
and U11's.

## 7. The database

Migration 0011: `sessions.disclosed_at`; `messages.disclosure`,
`messages.lead`, `messages.buttons`; `contacts.last_language`; and the
table `early_receipts` (case D2b): the tenant, the channel's identifier
of a message, the status reported and its code. A row is removed when
it is applied, or after a day.

A lead may be 700 long once its places are filled, and then the
disclosure, the lead and the longest reply are 2,056, over the smallest
channel's 2,000. No lead is filled in today (the only one is at most
300). The unit that first sends one must bound it; in the follow-up
issue.

## 8. Documents changed with this unit

The guardrail policy, section 7 (where the texts are, the buttons, the
answers to #107 and #212 for M3's texts); the data model; the state
machines where a text is named; `texts/README.md` (new);
US-C5's issue; decisions rows 50 (buttons) and 51 (English only for
now); traceability;
STATUS; README.

## 9. What is not known

- Whether the English wording is what the maintainer wants a customer
  to read. It is the agent's.
- Whether a customer told twice (D3) is acceptable. The other choice
  risks one never told.
- Whether the limits of F3 are enough for the same sentences in the
  other five languages.
