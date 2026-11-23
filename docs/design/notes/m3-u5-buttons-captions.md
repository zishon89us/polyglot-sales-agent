# Design note: buttons and captions in the channel (M3 unit U5)

2026-11-24 · issue #304 · written before the code

M2's channel receives a text or "something it does not read" and sends a
text. M3 needs two things more (plan, question 6; decisions row 33, not
answered): a customer's tap on a button must arrive as an event of its
own, and a text must be able to carry buttons; and the words typed under
a picture or a video are read as a message (US-C12, 2).

**U5 is the channel and what is stored of a tap. It acts on nothing.**
What a tap does (stop, start, a person) is U10's and U11's; the texts
that carry buttons are U8's. After U5 a tap is stored and gets no reply,
and a caption is answered by the echo like any text.

One rule here is about people: which conversation a tap belongs to
(review finding #222, first half). It is section 3.

## 1. What Meta's pages say

Read on 2026-11-24. Each page was fetched and questioned through a
reader that answers from the page; none was read by eye, and no live
event has been seen (threat model, A7). The fixtures of that date say
the same, page by page.

| Fact | Where | Used for |
| --- | --- | --- |
| A message may carry up to 3 reply buttons. Its body is at most 1,024 characters; a button's title at most 20 and unique among the buttons; a button's identifier at most 256 | Interactive reply buttons messages | The channel's limits; the request |
| A tap comes as a message of type `interactive`, with `interactive.type` `button_reply`, the button's `id` and `title`, and `context.id`, the identifier of the message that carried the button. In the page's example the `id` is the one that was set | The same page | Reading a tap; whose message it answers |
| A tap on a quick-reply button of a template comes as type `button`, with `button.payload`, `button.text` and `context.id` | Button messages webhook reference | Reading it as a tap too, so that it is not stored as an unread type under the name this system uses for a tap. Templates are M5's |
| A picture and a video carry `caption` beside the media's own fields | Image and video messages webhook references | Reading a caption |
| A text sent by the business is at most 4,096 characters | Text messages | Already assumed by the stand-in; now read |

Not found on those pages, and so not relied on:

- **The longest text a customer can send.** The limit of 4,096 is stated
  for what a business sends. The 8,000 code points of a batch's text
  (glossary; decisions row 44) therefore stay provisional.
- Whether a caption can be absent, its longest length, and whether a
  document's caption has the same form (the story names pictures and
  videos only).
- Whether an identifier comes back byte for byte when it holds
  characters outside ASCII, and whether a title may hold an emoji. The
  core's payloads are ASCII (section 2).
- Whether a customer's app can send a tap for a button it was never
  shown. Section 3 assumes it can.
- When a message with buttons may be sent. The older blog post says only
  in reply to a customer; every message of M3 that carries a button is a
  reply inside the window.

## 2. The interface

**In.** `InboundContent` gains a tap, and a text may say it was a
caption:

```ts
| { type: "text"; body: string; captionOf?: string }   // "image" or "video" when it was typed under one
| { type: "button"; payload: string; title: string; inReplyTo: string | null }
| { type: "unsupported"; channelType: string }
```

`payload` is what the business set on the button. `title` is what the
customer saw on it. `inReplyTo` is the channel's identifier of the
message that carried the button, or null when the channel did not say.

**Out.** A channel says what it can carry and sends it:

```ts
readonly buttons: { max: number; bodyMax: number; titleMax: number; payloadMax: number };
sendButtons(from, to, body, buttons: readonly { payload: string; title: string }[]): Promise<SendResult>;
```

`sendButtons` never throws. What the channel would refuse is refused
before any call, as a result that is not retryable and cannot have
arrived:

| # | Case | Result |
| --- | --- | --- |
| S1 | 1 to `max` buttons, each within the limits, titles all different, payloads all different | Sent; the channel's identifier |
| S2 | No button, or more than `max` | `bad-buttons` |
| S3 | A title that is empty, over `titleMax`, or the same as another's; a payload that is empty, over `payloadMax`, the same as another's, or with a control character | `bad-buttons` |
| S4 | A body that is empty or over `bodyMax` | `bad-body` |
| S5 | Every failure of a text's send (no recipient, a bad sender, a refusal, a timeout) | The same result as `sendText` gives |

Lengths are counted in UTF-16 units, as M2's check of a text's length
is: a count that can only be stricter than Meta's "characters".

**A text with buttons is shorter than a text.** The body is at most
1,024, where a reply may be 1,200 code points (glossary). Only the fixed
texts carry buttons in M3, and U8 keeps each within the channel's
`bodyMax`; a model's reply carries none.

**What a payload is** is the core's to say, not the channel's (ADR 0014,
"Buttons of a pack"). `packages/core` holds:

- the core's three buttons: `stop`, `start` and `person`. **Start and
  opt-in are one button:** the state machines speak of a "start button"
  at step 5 and of an "opt-in button" in section 6, and both clear an
  opt-out and record consent in the same way;
- `buttonPayload(owner, action)` and `readButtonPayload(text)`. A
  payload is `<owner>.<action>` or `<owner>.<action>.<rest>`, where owner
  and action are lower-case words of letters, digits and hyphens and the
  rest is the owner's own, up to 256 characters in all, in printable
  ASCII.

| # | Payload | `readButtonPayload` |
| --- | --- | --- |
| B1 | `core.stop`, `core.start`, `core.person` | owner `core`, the action, no rest |
| B2 | `booking.confirm.2f6c…:2026-12-01T10:00Z` | owner `booking`, action `confirm`, the rest as it is |
| B3 | No owner (`stop`), an empty part, upper case, a space, a control character, longer than 256 | Not a payload |
| B4 | `core.dance` | A payload, with owner `core` and an action the core does not have: what is done with it is U10's |

The channel packages do not call these. They pass a payload through as
text. Who reads it is U10.

## 3. Whose conversation a tap belongs to

A tap arrives from a customer like any message, so it is stored in that
customer's conversation: the sender is the channel's to say, and the
webhook is signed. What the tap claims is something else: that this
customer was shown a certain button. **That claim is checked against
what was sent.**

When a tap is stored, the message it says it answers (`inReplyTo`) is
looked for among the messages **sent in the same conversation**, by the
channel's identifier. The tap's row keeps the answer in `replies_to`.

| # | The tap's `inReplyTo` | Stored as |
| --- | --- | --- |
| K1 | The identifier of a message this conversation was sent | `replies_to` is that message |
| K2 | The identifier of a message sent in another conversation of the same tenant | `replies_to` is null: it is not this customer's button |
| K3 | The identifier of a message of another tenant | Null. The lookup runs in the tenant's scope and cannot see it |
| K4 | An identifier nothing has | Null |
| K5 | Absent | Null |
| K6 | The identifier of a message **from** this customer, not to them | Null: a button is on a message that was sent |
| K7 | A tap delivered twice | One row (US-C1), as for any message |

**U5 stores; it does not judge.** A tap with `replies_to` null is kept
with its payload, like any other. Whether such a tap may do anything is
decided where taps are acted on. The proposal for U10, recorded here so
that it is not lost: a tap that answers no message of its own
conversation does nothing, whatever its payload; and stop is honoured
all the same, since stopping costs the customer nothing they did not ask
for. That is U10's to write and have reviewed.

The second half of #222, that a booking named in a payload belongs to
the customer who tapped, is the booking pack's (M5): the core does not
read the rest of a payload.

**What is not checked:** that the message answered did carry a button,
or that one. U5 does not store which buttons a sent message carried;
U8 does, with the texts. Until then `replies_to` says "a message this
customer was sent", no more.

## 4. What is stored

Migration 0008 adds to `messages`:

| Column | Holds |
| --- | --- |
| `button_payload` | For a tap, what the button carried. Present exactly when `kind` is `button` |
| `replies_to` | For a tap, the message of the same conversation it answers, or null (section 3) |
| `caption_of` | For a text that was a caption, the channel's name of what it was typed under |

A tap's `body` is the button's title: the words the customer chose, as
the conversation view will show them. A payload is not personal data in
M3 (the core's are fixed words); a pack's may name a booking, and the
data model marks the column accordingly when M5 writes one.

| # | Arrives | Stored |
| --- | --- | --- |
| M1 | A text | As before |
| M2 | A picture or a video with a caption | `kind` `text`, the caption as `body`, `caption_of` `image` or `video`. The media is not fetched and nothing of it is kept (US-C12, 2 and 3) |
| M3 | A picture or a video with no caption, or one that is empty once U+0000 is removed | `kind` `image` or `video`, no body: unread, as before |
| M4 | A document, a sticker, a voice note, with or without a caption | Unread, as before: the story names pictures and videos |
| M5 | A tap on a reply button | `kind` `button`, the title as `body`, `button_payload`, `replies_to` |
| M6 | A tap on a template's quick-reply button | The same |
| M7 | Another interactive answer (a list's row, a form) | Unread, `kind` `interactive` |
| M8 | A tap with no payload, an empty one, one over 256 characters or with a control character; a title that is empty or over 256 | Counted as malformed and left out, as M2 does for a message it cannot read |

**In the turn** (until U10): a tap is in the batch and is not text, so
the echo answers nothing to a batch of taps alone, exactly as it does
for a picture. A caption is text.

## 5. The two stand-ins

Both do what the WhatsApp channel does, so that a test written against
either is a test of the interface (NFR-M2):

- **`packages/channel-mock`** (in memory): carries the two new kinds of
  content in its own format, has `buttons` limits of its own (2 buttons,
  to show that a caller must ask the channel and not assume 3), and
  records what `sendButtons` sent.
- **`apps/mock-whatsapp`** (Meta's stand-in): accepts an `interactive`
  message of type `button` under Meta's limits and refuses one outside
  them; its test page shows a sent message's buttons and lets a tester
  tap one, which posts the webhook Meta would; it can post a picture
  with a caption.

The contract tests every channel must pass gain: the limits are whole
numbers above 0; a text with buttons is sent and one button too many is
refused without a call; a signed webhook with a tap and a caption is
read as such.

## Not in U5

Acting on a tap, and the rule for a tap that answers nothing (U10, U11);
the texts that carry buttons, and storing which buttons a sent message
had (U8); a pack's buttons and what their payloads name (M5); sending a
template (M5); a footer, a header or a list.

## Decision row

Row 33 asks whether buttons and captions are built in M3 at all. It is
not answered; this unit is built on a yes. If the answer is no, the
unit's code stays unused and M3 has keywords only.

Asked in a new row 46: **start and opt-in are one button** (section 2).
