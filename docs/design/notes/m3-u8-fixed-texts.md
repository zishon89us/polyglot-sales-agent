# Design note: fixed texts and the disclosure (M3 unit U8)

Status: proposed by the agent, 2026-11-25, before any code. Issue #307.
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
- the answer to "am I talking to a person?", sent by code when the model
  flags the question (and the prompt's second version, which tells the
  model to leave that answer to code);
- buttons on a sent message: stored with it, and sent by the worker.

Not built here:

| What | Whose | Until then |
| --- | --- | --- |
| Sending the other nine texts: fallback, unsupported type, the two handover texts, emergency, the two confirmations, the rate notice, the opt-in question | U9, U10, U11, U12 | The texts exist and are read at start-up; nothing sends them |
| **The wording in any language but English** | A speaker of each (#168), after decisions row 4 | Section 3: a customer who wrote in Arabic gets the disclosure in English. That is a gap in US-C5, 2 and is listed |
| The booking texts, the holding message, templates | M5, M4 | None |
| An eval of the prompt's second version | U16, U17 | None exists |

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
| F3 | A body is 1 to 400 characters, with no control character but a line break, no blank start or end |
| F4 | A body holds exactly the places its text is given in the table, each once, written `{{name}}`; no other `{{` |
| F5 | A text's buttons are exactly those of the table, in that order |
| F6 | `buttons` has exactly `stop`, `start` and `person`, each a title of 1 to 16 characters that the channel's own check of a title accepts, no two the same by that check |
| F7 | The `emergency` text holds no digit: it must give no phone number |
| F8 | English exists |

400 and 16 are chosen so that the disclosure, a fixed text and its
buttons fit the smallest channel there is, the in-memory one (a text
with buttons of 500 characters, a title of 16).

A place is filled only by code, with a value code made (a time written
out, the tenant's support contact). A value that itself holds `{{` is
refused, and a text whose places are not all given is refused: nothing
is sent with a place left open.

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
is added here: set with the session's, when a reply is stored.

The gaps are listed in `texts/README.md`, and a test fails if the list
there is not the supported languages that have no file.

## 4. The disclosure (US-C5, 1 and 2)

A session records when its customer was told (`sessions.disclosed_at`).
A message records the fixed text put before its body (`messages.lead`)
and whether that includes the disclosure (`messages.disclosed`).

The disclosure is put on **when a message is taken to be sent**, in the
same transaction that marks it as being sent, and not when it is
written: a reply can be written and then dropped for a newer message,
and the first message written is not always the first one sent.

| # | Case | Result |
| --- | --- | --- |
| D1 | A message of a session that has not been told is taken to be sent | The disclosure, in the language of section 3, becomes the start of its lead. What is sent is the lead, a blank line, the body |
| D2 | The channel accepts it | The session is marked as told, in the transaction that records the send |
| D3 | The send fails for good, or its outcome is never known | The session is **not** marked. The next message sent carries the disclosure. A customer can so be told twice; never not at all |
| D4 | The same message is tried again | It keeps the lead it has; the disclosure is not put on twice |
| D5 | A later message of a session that was told | No disclosure |
| D6 | A new session of the same conversation | Told again: the mark is the session's |
| D7 | Any class of message: the assistant's reply, a fixed text, later a staff member's | The same rule. US-C5, 1 says "of any kind" |
| D8 | A message with no session (the business begins; M5) | Not this rule: a template carries the disclosure in its approved wording |
| D9 | A message with buttons whose lead and body together are over what the channel carries with buttons, or whose titles it would refuse | Sent as plain text, without the buttons. Every text that has a button also says in words what to do |
| D10 | Lead and body together over what the channel carries as text | The send is refused before the call (`bad-body`), as U5 built it. With the limits of section 2 and a reply of at most 1,200 this cannot happen on either channel |
| D11 | Two workers, one conversation | One at a time: the conversation's row is locked for the whole step, as it is today |

The model is never given the lead: the session's history (U7) holds
bodies only, so the disclosure is not something the model can learn to
write or to leave out.

## 5. "Am I talking to a person?" (US-C5, 3)

| # | The model's answer | Sent |
| --- | --- | --- |
| P1 | The flag `asks-if-person`, and a reply | The `automated-assistant` text as the message's lead, then the reply. One message, of class `assistant-reply` |
| P2 | The flag, and an empty reply | The text alone, as a message of class `system-reply` |
| P3 | No flag | The reply, as today |
| P4 | The flag, in the first message of a session | The disclosure, then the text, then the reply. They say nearly the same thing twice; that is accepted for the first message only |
| P5 | The flag and a call for tools | The tools run; the flag that counts is the one on the answer that replies |

The prompt's first version told the model to say itself that it is an
automated assistant. Version 2 tells it to set the flag, to leave that
answer to code, and to answer whatever else was asked, with an empty
reply if nothing else was. **No eval has run on either version.**

Reading the flag here is the one place this unit acts on a flag. U9
moves the reading of all seven to one place after the output checks.

## 6. Buttons on a sent message

`messages.buttons`: null, or a list of 1 to 2 buttons, each the payload
(U5's pattern) and the title that was shown. Stored when the message is
written, sent by the worker with the channel's `sendButtons`, or without
them under D9. Two is the most the smallest channel carries.

A title is stored because a tap comes back with the payload only, and
what the customer saw should be on record.

## 7. The database

Migration 0011: `sessions.disclosed_at`; `messages.lead`,
`messages.disclosed`, `messages.buttons`; `contacts.last_language`.

## 8. Documents changed with this unit

The guardrail policy, section 7 (where the texts are, the buttons, the
answers to #107 and #212 for M3's texts) and section 9 (the prompt's
point 7); the data model; the state machines where a text is named; the
`prompts/` README and the prompt's changelog; `texts/README.md` (new);
US-C5's issue; decisions rows 50 (buttons) and 51 (English only for
now); the glossary if 400 and 16 are limits it lists; traceability;
STATUS; README.

## 9. What is not known

- Whether the English wording is what the maintainer wants a customer
  to read. It is the agent's.
- Whether a customer told twice (D3) is acceptable. The other choice
  risks one never told.
- Whether a model follows version 2's instruction to leave the answer
  to code.
