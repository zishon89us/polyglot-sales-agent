# Design note: the emergency phrase list and the unsupported-type reply (M3 unit U10, first part)

Status: proposed by the agent, 2026-11-28, before any code. Reviewed
once as a note (`docs/reviews/2026-11-28-m3-u10a-design.md`: three
High findings) and rewritten; the rewritten note was not reviewed
again as a note. Issue #309. Stories: US-C6, 10 (its first half);
US-C12, 1, 3 and 4. Order of checks, steps 4a and 13. Guardrail
policy, section 6. Finding #112 is answered in section 3; #233 in 2.6.

U10 is split, as the plan foresaw. **This part**: what code does with
an emergency, and with a batch it cannot read. **The second part**:
opting out and in (machine 6, `consent_records`), step 8's mark, and
the notice writer. Issue #309 is closed by the second part.

## 1. What is honest to say first

**A list of phrases is a weak guard on a person's life, and this one
was written by the agent.** The phrases in Arabic, Urdu, Hindi,
Bengali and Tagalog were read by no speaker (decisions, row 53).

- **It misses.** A wording that is not listed, a misspelling, Arabic
  typed in Latin letters and digits, a phrase inside a picture or a
  voice note: none is found. That customer gets an ordinary reply, or,
  in a handed-over session, nothing.
- **It fires on harmless messages.** "My mother had a heart attack
  last year, can I move my booking?" holds a phrase.
- **What either gets in this milestone.** One fixed text in English
  that says to contact the local emergency services, and then **no
  answer to anything for up to 24 hours**: the session is handed over,
  nobody is emailed and nobody can reply before M4. After 24 hours the
  handover is detached and the assistant answers again. For a real
  emergency the text is the whole of the help. For a false alarm it is
  a customer the assistant has stopped serving for a day.

The rule that an emergency hands over is the guardrail policy's. Row
53 asks the maintainer whether a match of the list alone should rather
send the text and leave the assistant answering.

## 2. The emergency phrase list (step 4a)

### 2.1 The data

`EMERGENCY_PHRASES` in the core: for each of the six supported
languages, a list of phrases, and for Hindi and Urdu a few in Latin
letters as people type them. Every list is checked against every
text, whatever the session's language.

**No common single word is a phrase.** A phrase is two words or more,
or one word of eight letters or more ("overdose", "unconscious"). The
word "emergency" alone is on no list, in any language: "an emergency
appointment" does not fire. A test holds every phrase to this.

### 2.2 Matching

The text and every phrase are folded the same way before they are
compared:

1. made plain as the reply checks do (compatibility form; unseen
   characters and the marks over Arabic letters removed) and put in
   lower case;
2. apostrophes of every form removed ("can't" and "can’t" and "cant"
   are one);
3. the forms of the Arabic alef made one, the final yeh forms one, teh
   marbuta and the Urdu he made the Arabic heh; the Hindi nasal marks
   made one;
4. every run of anything that is not a letter, a mark or a digit made
   one space.

A phrase matches where it stands with no letter, mark or digit
directly before it and no letter or mark directly after it; before an
Arabic phrase the one-letter "and" (waw or feh) may stand. Where a
language writes a phrase both joined and apart, both are listed.

The texts of a batch are checked **joined by a space, in the order
they came**, so a phrase written over two messages is found.

### 2.3 Where, and what happens

At the start of a turn, before anything else: before the check for a
handed-over session (step 10) and before the tenant's "answering"
check (step 8). On a match the turn ends there, in **one transaction**
that holds the conversation's lease:

1. if the session's handover has had its 24 hours, it is detached
   first (so the next step attaches it again, with a new time);
2. the emergency trigger of U11 is applied (reason `emergency`,
   urgent; the emergency text unless the contact has one waiting or
   was sent one in the last 60 minutes);
3. the batch is marked as dealt with and the lease released.

The model is not called for that batch. Nothing else in it is
answered.

| # | Case | Result |
| --- | --- | --- |
| E1 | A phrase; the session is not handed over | A handover is made, urgent; the emergency text is sent; the batch is marked; no model |
| E2 | A phrase; the session is handed over, less than 24 hours | The reason is added and the handover is urgent; the text is sent under the 60-minute rule; marked; no model |
| E2a | A phrase; the session is handed over, 24 hours or more | Detached and attached again with a new time, urgent, the text under the same rule; marked; no model. The assistant does **not** answer that batch |
| E3 | A phrase; the tenant is not answering | As E1 or E2: step 4a comes before step 8. The batch is marked, so the trigger is not applied again and again |
| E4 | A phrase again in a later batch, within 60 minutes | Nothing more is sent; the batch is marked |
| E5 | No phrase | Nothing here. The model's `emergency` flag is the second net (U11) |
| E6 | The turn is tried again after a failure | The trigger adds nothing the second time and the text is not sent twice |
| E7 | The worker has no fixed texts (a test of an earlier unit) | The check is not run |
| E8 | The lease was lost | Nothing is stored; the turn that holds the lease does it |

### 2.4 It is checked when the turn starts, not when the message is stored

The order of checks says "after the message is stored". What is built
checks at the start of the turn that deals with the message. So:

- **The text is later** by the batching window (3 to 10 seconds), by
  the rest of a turn that is running for the same conversation (at
  most its lease), and by any queue of jobs.
- **A message no turn deals with is not checked**: one that arrives
  with a channel time outside the 24-hour window (it could not be
  answered in any case), and one left unread in a session that a new
  session ends.

Checking at store time is #341's.

### 2.5 When the text is not sent

- A tenant whose channel cannot send: the text waits, and may expire.
- While one emergency text waits to be sent, another is not stored.
  If the first then fails, nothing was sent; the customer's next
  message makes the handed-over check tell again (U11).
- Nobody is alerted when an emergency text fails (M4, #341).

### 2.6 Not built

The email to staff and its hourly ceiling (M4). The text in two
languages (only English exists, row 51). #233 asks that step 4a not
email staff outside the throttle before the rate pause: there is no
email and no rate pause yet; U12 and M4 settle it.

## 3. The unsupported-type reply (step 13; US-C12)

A batch **cannot be read** when it holds no text and no tap on the
person button, and at least one message of a kind in the first row.
Kinds are named as they are stored (`messages.kind`); #112:

| Stored kind | Treated as |
| --- | --- |
| `image`, `video` (without a caption), `audio` (a voice note too), `document` (**its caption is not read**, #341), `sticker`, `location`, `contacts`, and `unsupported` (what the channel itself could not show us: a poll, a view-once picture) | Cannot be read: gets the reply |
| `reaction`, `interactive` and `quick-reply` (a tap that was not understood), `button` other than the person button (stop and start are the second part's), `order`, `system`, `unknown`, and any kind not named here | Ignored: marked, no reply, not counted |
| `text` (a caption of an image or a video is stored as text) | Text |

| # | Case | Result |
| --- | --- | --- |
| N1 | A batch that cannot be read; the count is 0 or 1 | The `unsupported-type` text is stored to be sent, with the person button, and the count goes up by 1 |
| N2 | The third such batch in a row (the count is 2) | The session is handed over with the reason `unsupported-content`; the customer gets the handover text **and not the unsupported-type reply** (#112). The count is set to 0 |
| N3 | A batch with text or a tap on the person button | The count is set to 0 when that batch is marked by the end of its turn. A turn that stores nothing (lost lease, a failure to be tried again) moves nothing |
| N4 | A batch of ignored kinds only; or of ignored kinds and one that cannot be read | The first: marked, no reply, the count not moved. The second cannot be read (N1) |
| N5 | A batch that cannot be read, in a handed-over session | Step 10 comes first: marked, nothing sent, the count not moved |
| N6 | The same, for a tenant that is not answering | Marked, nothing sent, the count not moved |
| N7 | A new session | The count starts at 0 |
| N8 | The content of what cannot be read | The model is not called for such a batch; in a batch with text the model gets the texts only (U7) |
| N9 | After N2, the 24 hours pass and the customer sends pictures again | Two replies and a handover again: at most that each day |

The reply is a `system-reply`: not held back or discarded for a newer
message; it carries the disclosure when it is the first of its
session. The count moves when the reply is stored, not when it is
sent. `sessions.unreadable_batches`: a whole number, 0 to 3.

## 4. The database

Migration 0014: `sessions.unreadable_batches`. Down: dropped.

## 5. What is not built, in one place

- No speaker read the phrases; no eval (E17) has measured what they
  miss (U16). Misses named in section 1 stay misses.
- The check at store time; the alert on a failed emergency text; a
  document's caption (#341).
- The emergency email; the emergency text in two languages.
- The media of an unsupported message is not kept: only its kind
  (US-C12, 3). What staff see is M4's.

## 6. What the second part must keep

- Step 4a comes before step 5: the emergency text is sent to a contact
  who has opted out too (guardrail policy, section 6).
- A stop word or a stop tap in a batch that this part or step 10 marks
  as dealt with must still be applied.

## 7. Documents

The guardrail policy, section 6; the state machines, steps 4a and 13;
the data model; the decisions page (row 53); traceability; STATUS;
README. #339's item on an emergency in a handed-over session.

## 8. Tests

Each row of the two tables through the worker and the in-memory
channel. Every phrase of every list found inside a sentence, and each
held to the rule of 2.1. The folding: case, apostrophes, the Arabic
forms, two spaces, punctuation between words; the boundary; the "and"
before an Arabic phrase; a phrase over two messages. Harmless
sentences that must not fire. Every kind of the kinds table. The count
across batches, a text between, a new session, after a handover. End
to end: "he is not breathing" gets the emergency text and no echo.
