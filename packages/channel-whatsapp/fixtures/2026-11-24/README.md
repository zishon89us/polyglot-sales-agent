# Fixtures of 2026-11-24: taps and captions

Synthetic webhooks, written by hand from Meta's documentation as it read on
2026-11-24. The pages were read through a tool that fetches a page and
answers questions about it, not by eye, and no live event has been seen
(threat model, A7). Every name, number and identifier is made up: phone
numbers are from the 555-01xx range.

| Fixture | What it shows | Page it was written from |
|---|---|---|
| `inbound-button-reply.json` | A tap on a reply button: type `interactive`, `interactive.type` `button_reply`, `button_reply.id` and `.title`, and `context.id` naming the message that carried the button | `developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages` |
| `inbound-template-button.json` | A tap on a quick-reply button of a template: type `button`, `button.payload` and `.text`, and `context.id` | `.../whatsapp/webhooks/reference/messages/button/` |
| `inbound-image-caption.json` | A picture with words typed under it: `image.caption` | `.../whatsapp/webhooks/reference/messages/image` |
| `inbound-video-caption.json` | A video with a caption: `video.caption` | `.../whatsapp/webhooks/reference/messages/video` |
| `inbound-image-no-caption.json` | A picture with nothing typed under it | the image page above |
| `inbound-list-reply.json` | An answer to a list, which this version does not read. Its shape is an assumption: only its `interactive.type`, which is not `button_reply`, matters to the test | not read |

What was read and relied on:

- A message may carry up to 3 reply buttons; its text up to 1,024
  characters; a button's title up to 20 and its identifier up to 256;
  titles must differ.
- A text sent by a business may be up to 4,096 characters
  (`.../whatsapp/messages/text-messages`).
- No page read states a longest caption or a longest text from a customer.
  The parser's own bound of 65,536 is this system's, not Meta's.

What was not checked: whether `context.id` is always present on a tap. The
parser keeps a tap that has none.
