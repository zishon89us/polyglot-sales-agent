# Design note: buttons and captions in the channel (M3 unit U5)

2026-11-24 · issue #304 · written before the code · second version, after
a review of the first (`docs/reviews/2026-11-24-m3-u5-design-review.md`)

M2's channel receives a text or "something it does not read" and sends a
text. M3 needs two things more (plan, question 6; decisions row 33, not
answered): a customer's tap on a button must arrive as an event of its
own, and a text must be able to carry buttons; and the words typed under
a picture or a video are read as a message (US-C12, 2).

**U5 is the channel and what is stored of a tap. It acts on nothing.**
What a tap does (stop, start, a person) is U10's and U11's; the texts
that carry buttons are U8's. After U5 a tap is stored and gets no reply,
and a caption is answered by the echo like any text. **Nothing in M3
calls `sendButtons` until U8** stores a text with buttons: "a text with
buttons can be sent" is met at the channel, and shown by its tests.

## 1. What Meta's pages say

Read on 2026-11-24. **Each page was fetched and then questioned through
a reader that answers from the page's text; none was read by eye,** which
is weaker than reading it, and a number such a reader reports can be
wrong. No live event has been seen (threat model, A7). The pages, and
what was taken from each, are a table in
`packages/channel-whatsapp/fixtures/2026-11-24/README.md`, written with
the fixtures.

| Fact, as the reader reported it | Page | Used for |
| --- | --- | --- |
| A message may carry up to 3 reply buttons. Its body is at most 1,024 characters; a button's title at most 20 and unique among the buttons; a button's identifier at most 256 | Interactive reply buttons messages | The channel's limits; the request |
| A tap comes as a message of type `interactive`, with `interactive.type` `button_reply`, the button's `id` and `title`, and `context.id`, the identifier of the message replied to | The same | Reading a tap |
| A tap on a quick-reply button of a template comes as type `button`, with `button.payload`, `button.text` and `context.id` | Button messages webhook reference | Reading it as a tap too. Templates are M5's; read now so that it is not stored as an unread type under the name this system uses for a tap |
| A picture and a video carry `caption` beside the media's own fields | Image and video messages webhook references | Reading a caption |
| A text sent by the business is at most 4,096 characters | Text messages | The channel's limit on a text |

**Not found on those pages, and how each is treated:**

| Not found | Treated as |
| --- | --- |
| That an identifier comes back exactly as it was set. It is seen in one example only | Assumed, for ASCII. A payload that comes back changed does not read as one of the core's, and the tap is stored and does nothing |
| That `context.id` is on every tap, and is the identifier the send call returned | Assumed. A tap without it is stored with none (section 3) |
| How Meta counts "characters" | Counted here in UTF-16 units, which is at least as strict as code points and less strict than bytes. A text near a limit in a script of several bytes a character may still be refused by Meta; that is a refusal like any other |
| How two titles are compared for being unique; whether a title or an identifier may begin or end with a space; whether a title may hold an emoji | Stricter here than anything the page says: section 2, S3 |
| The longest text a customer can send | Not known. The 8,000 code points of a batch's text (glossary; decisions row 44) stay provisional, and the glossary now says the page did not give it |
| Whether a caption can be absent, and its longest length; a document's caption | A caption that is absent or empty is no caption. A document is not read (the story names pictures and videos); a customer who sends a PDF with a typed question is told the assistant reads text only |
| Whether a customer's app can send a tap for a button it was never shown, with an identifier of its choosing | Assumed that it can (section 3) |
| When a message with buttons may be sent | Every message of M3 that carries a button is a reply inside the window |

## 2. The interface

**In.** `InboundContent` gains a tap, and a text may say it was a
caption:

```ts
| { type: "text"; body: string; captionOf?: "image" | "video" }
| { type: "button"; payload: string; inReplyTo: string | null }
| { type: "unsupported"; channelType: string }
```

`payload` is what the business set on the button. `inReplyTo` is the
channel's identifier of the message the tap answers, or null when the
channel gave none or gave something that is not an identifier.

**A button's title is not passed on.** The webhook carries the label, but
it is whatever the customer's app sent, and it is not the customer's
words. Keeping it as the message's text would put it where a keyword
check or a model reads text. What the label was is known from what was
sent (U8 stores that).

**Out.** A channel says what it can carry, and sends it:

```ts
readonly limits: {
  textMax: number;
  buttons: { max: number; bodyMax: number; titleMax: number; payloadMax: number } | null;
};
sendButtons(from, to, body, buttons: readonly { payload: string; title: string }[]): Promise<SendResult>;
```

`buttons: null` is a channel that has none; its `sendButtons` answers
`no-buttons`. One pure function in `packages/channel`,
`checkButtonMessage(limits, body, buttons)`, says whether a message
would be refused; every channel's `sendButtons` uses it, and U8 uses it
to test each fixed text against each channel without sending.

Neither send throws. What is refused is refused before any call, as a
result that is not retryable and cannot have arrived:

| # | Case | Result |
| --- | --- | --- |
| S1 | 1 to `max` buttons, each within the limits, titles all different, payloads all different | Sent; the channel's identifier |
| S2 | No button, or more than `max` | `bad-buttons` |
| S3 | A title that is empty, over `titleMax`, blank (nothing left once space, controls, format characters, characters Unicode calls ignorable in display, combining marks and the blank braille cell are removed), with a space at either end, with a control character, a line or paragraph separator, a zero-width space, a word joiner, a byte-order mark, an embedding, override or isolate of text direction, or half of a surrogate pair; or the same as another's once both are brought to one compatibility form (NFKC) and lower case with `ß` as `ss`, characters ignorable in display are removed and every run of space is one space. Allowed inside a title, because honest text needs them: the two joiners, the marks of direction, a soft hyphen, and what an emoji is built with. Known and accepted: two titles that differ only in such a character (a Persian word with and without its joiner, two flags built of tag characters) count as one; a character that shows nothing and is in none of these classes would pass | `bad-buttons` |
| S4 | A payload that is empty, over `payloadMax`, the same as another's, or not printable ASCII without spaces | `bad-buttons` |
| S5 | A body that is empty, blank as S3 has it, holds U+0000, or is over `bodyMax` | `bad-body`. A body is not checked for half a surrogate pair or for direction overrides: it can carry a customer's own words back, and line breaks and mixed direction are ordinary in it |
| S6 | A channel with no buttons | `no-buttons` |
| S7 | `sendText` with a body that is empty, blank, holds U+0000, or is over `textMax` | `bad-body`. New: M2 sent any body and let the channel refuse |
| S8 | Every other failure of a send (no recipient, a bad sender, a refusal, a timeout) | The same result for both sends |

Lengths are in UTF-16 units (section 1).

**A text with buttons is shorter than a text.** Its body is at most
1,024 on this channel, where a reply may be 1,200 code points
(glossary). Only the fixed texts carry buttons in M3, and U8 keeps each
within every channel's limit; a model's reply carries none.

**What a payload is** is the core's to say, not the channel's (ADR 0014,
"Buttons of a pack"). `packages/core` holds:

- the core's buttons: `stop`, `start` and `person`. **Start and opt-in
  are one button (row 46).** `stop` is defined here; whether any text of
  M3 carries it is U8's (the second part of #222, as the plan has it:
  the guardrail policy puts the person button on two texts and the
  opt-in button on one, and names no text with a stop button);
- `coreButton(action)`, which builds `core.<action>` for one of the
  three, `readButtonPayload(text)`, and `coreButtonOf(text)`, which
  gives the core's action only for exactly `core.<action>`: `core.stop.x`
  is a payload with a rest, and is not the stop button.

A payload is `<owner>.<action>` or `<owner>.<action>.<rest>`. Owner and
action are 1 to 40 of the letters a to z, digits and hyphens, starting
with a letter. It is split at its first two full stops; the rest is the
owner's own and may hold more. The whole is at most 256 characters of
printable ASCII, with no space. A channel whose `payloadMax` is smaller
refuses a longer one (S4); the core's own are at most 11.

| # | Payload | `readButtonPayload` |
| --- | --- | --- |
| B1 | `core.stop`, `core.start`, `core.person` | owner `core`, the action, no rest |
| B2 | `booking.confirm.2f6c:2026-12-01T10.00Z` | owner `booking`, action `confirm`, rest `2f6c:2026-12-01T10.00Z` |
| B3 | No owner (`stop`), an empty part (`core.`, `.stop`, `core..x`), upper case, a space, a control character, a character outside ASCII, longer than 256 | Not a payload |
| B4 | `core.dance` | A payload, with owner `core` and an action the core does not have: what is done with it is U10's |
| B5 | Every payload `coreButton` builds | Begins `core.` and reads back as its action (the owner test ADR 0014 asks of U5) |

The channel packages do not call these. They pass a payload through as
text. Who reads it is U10.

## 3. What a tap answers

A tap arrives from a customer like any message, so it is stored in that
customer's conversation: the sender is the channel's to say, and the
webhook is signed. Review finding #222 has three parts, as the plan
names them: whose conversation a tap came from (this unit), where the
stop button appears (U8), and that a booking named in a payload is the
tapping customer's (the booking pack, M5).

**For the core's own buttons, what a tap answers is a record and not a
condition.** Stop, start and person act on the sender's own contact
only, and each can be asked for by typing a word. A forged `core.` tap
therefore does nothing its sender could not do anyway, and the stories
apply these buttons with no condition (US-C7, 5; state machines, steps
5 and 11). Refusing a tap because it could not be matched would only
fail honest customers: a message whose send ended with nobody knowing
whether it arrived has no identifier recorded, though the customer may
hold it and tap its button.

**What is kept** is the identifier the tap named, as text
(`in_reply_to`), not a link made when the tap is stored. A link made
then would miss a message whose identifier is recorded a moment later.

**What is offered** is one function, `messageAnswered`, which finds the
message a tap answers at the time it is asked: the message **sent in the
same conversation** with that identifier. It is for whoever must know
that a customer was really sent a certain message: a pack, in M5.
Nothing in M3 needs its answer.

| # | The tap names | `messageAnswered` |
| --- | --- | --- |
| K1 | A message this conversation was sent | That message |
| K2 | A message sent in another conversation of the same tenant | None |
| K3 | A message of another tenant | None: the lookup runs in the tenant's scope and cannot see it |
| K4 | An identifier nothing has | None |
| K5 | Nothing; or something that is not an identifier (not 1 to 128 printable ASCII characters without spaces), which is stored as nothing | None |
| K6 | A message **from** this customer, not to them | None: a button is on a message that was sent |
| K7 | A message whose identifier was recorded after the tap was stored | That message, once it is recorded |
| K8 | A message that was sent and never got an identifier (its send ended unknown) | None, for good. **None means "not matched", never "forged"** |
| K9 | The same button tapped twice | Two messages from the customer, each answering the same one. Whatever acts on a tap must be safe to repeat (U10) |
| K10 | One tap delivered twice by the channel | One row (US-C1), as for any message |

**What is not checked:** that the message answered did carry a button,
or which. U5 does not store the buttons a sent message carried; U8 does.
And a customer's app can be assumed to know the identifiers of messages
it received, so a match shows that the conversation was sent that
message, not that the tap is honest.

## 4. What is stored

Migration 0008 adds to `messages`:

| Column | Holds | Checked by the database |
| --- | --- | --- |
| `button_payload` | For a tap, what the button carried | Present exactly when the row is from a customer and its `kind` is `button`; 1 to 256 characters, printable ASCII, no space |
| `in_reply_to` | For a tap, the channel's identifier of the message it answers, or null | Only on a tap; 1 to 128 characters, printable ASCII, no space |
| `caption_of` | For a text that was a caption: `image` or `video` | Only on a text from a customer; one of the two |

**Only a `text` message's `body` is the customer's text.** A tap's
`body` is null. The data model says so, so that no later reader of
`body` takes a tap for words.

The kinds `text`, `button` and `template` are this system's own. A
channel's name for a type it does not read is never stored under one of
them: the webhook's sink stores such a name as `unknown`. The migration
renames any row an earlier version stored as `button` with no payload
(a template's quick reply, before this unit) to `quick-reply`.

| # | Arrives | Stored |
| --- | --- | --- |
| M1 | A text | As before |
| M2 | A picture or a video with a caption | `kind` `text`, the caption as `body`, `caption_of`. The media is not fetched and nothing of it is kept (US-C12, 2 and 3) |
| M3 | A picture or a video with no caption, with one that is not text, or with one that is empty once U+0000 is removed | `kind` `image` or `video`, no body: unread, as before |
| M4 | A caption over the longest text the parser takes (65,536) | Unread, as M3. A typed text over that length is still counted as malformed and left out, as M2 built it: the two differ, and making them one is in the follow-up issue |
| M5 | A document, a sticker, a voice note, with or without a caption | Unread, as before |
| M6 | A tap on a reply button | `kind` `button`, `button_payload`, `in_reply_to`, no body |
| M7 | A tap on a template's quick-reply button | The same |
| M8 | Another interactive answer (a list's row, a form) | Unread, `kind` `interactive` |
| M9 | A tap whose payload is absent, empty, over 256 characters or not printable ASCII without spaces; `interactive` of type `button_reply` with no `button_reply` object; `button` with no `button` object | **Stored, unread,** as `interactive` or `quick-reply`: the customer did something, and the conversation shows it. Not counted as malformed |
| M10 | A message that is malformed as M2 has it: no usable identifier, sender or time | Counted and left out, as before |

**Which reading applies is decided by the message's `type` alone.** A
`text` that also carries an `interactive` object is a text; an
`interactive` that also carries a `button` object is read as
interactive.

**In the turn** (until U10): a tap is in the batch and is not text, so
the echo answers nothing to a batch of taps alone, as it does for a
picture. A caption is text. A tap opens the session and the reply
window like any message from a customer.

## 5. The two stand-ins, the contract, the fixtures

Both stand-ins do what the WhatsApp channel does, so that a test written
against either is a test of the interface (NFR-M2):

- **`packages/channel-mock`** (in memory): carries the two new kinds of
  content in its own format; its limit is 2 buttons, to show that a
  caller must ask the channel and not assume 3; records what
  `sendButtons` sent.
- **`apps/mock-whatsapp`** (Meta's stand-in): accepts an `interactive`
  message of type `button` under the limits of section 1 and refuses one
  outside them; its test page shows a sent message's buttons and lets a
  tester tap one, which posts the webhook Meta would; it can post a
  picture with a caption.

**The contract** every channel passes gains, with new makers on its
subject for a signed tap and a signed caption:

- the limits are whole numbers above 0, or `buttons` is null;
- a text with buttons is accepted; one button too many, a repeated title
  and an over-long body are each refused with the result of S2 to S5
  (that no call was made is shown in each channel's own test, where a
  call can be seen);
- a signed webhook with a tap is read as a tap with its payload and what
  it answers, and one with a caption as text with `captionOf`.

**Fixtures,** in `packages/channel-whatsapp/fixtures/2026-11-24/`, all
synthetic: `inbound-button-reply.json`, `inbound-template-button.json`,
`inbound-image-caption.json`, `inbound-video-caption.json`,
`inbound-image-no-caption.json`, `inbound-list-reply.json`, and a
`README.md` with the pages read and how. The fixtures of 2026-11-18
stay, and their tests still pass.

**A test keeps channel-specific imports out of the core** (the plan's
last criterion for U5): no file of `packages/core`, `packages/db`,
`packages/ai` or `packages/pack-interface` imports a channel package
other than the interface, and none of `apps/api` or `apps/worker`
outside the one file of each that builds its channels.

## Documents changed with this unit

- `docs/design/data-model.md`: `kind`, `body`, `button_payload` (the
  core reads its owner and action; the rest is the owner's), the two new
  columns.
- `docs/design/architecture.md`: what the webhook does with a tap and a
  caption; the channel interface.
- `docs/design/state-machines.md`: "start button" and "opt-in button"
  are one, pending row 46.
- `docs/design/threat-model.md`: A7 (what is now assumed of taps), T7.
- `docs/requirements/glossary.md` and decisions row 44 (d): the
  channel's limit on a customer's text was looked for and not found.
- `docs/decisions-needed.md`: row 46; the header's list of rows.
- ADR 0014: an amendment answering what it asked of U5.

## Not in U5

Acting on a tap (U10, U11); the texts that carry buttons, storing which
buttons a sent message had, and the worker sending one (U8); a pack's
buttons and what their payloads name (M5); sending a template (M5); a
footer, a header or a list.

## Decision rows

Row 33 asks whether buttons and captions are built in M3 at all. It is
not answered; this unit is built on a yes. If the answer is no, the
unit's code stays unused and M3 has keywords only.

Row 46: start and opt-in are one button.
