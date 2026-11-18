# WhatsApp webhook fixtures, written 2026-11-18

**These are synthetic.** No file here was captured from a real webhook, and
no live event has been seen by this project. Each was written by hand from
Meta's documentation as read on 2026-11-18, to give the parser and the mock
something of the documented shape. Every identifier is made up, the phone
numbers are from the 555-01xx range reserved for fiction, and the name is
"Test Customer".

They are dated because the channel changes. When the documentation is read
again, add a new dated directory and keep this one: a test that still
passes on old fixtures shows the parser reads what was once sent.

## What was read

| Page | How | What was taken from it |
| --- | --- | --- |
| `developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/` | Fetched in full | The shape of an incoming text message; payloads of up to 3 MB; redelivery for up to 7 days when the answer is not 200, which can cause duplicates |
| `developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/` | First 100,000 of 186,760 characters | `user_id`, `from_user_id`, `recipient_user_id`, `profile.username`; that `from` and `wa_id` can be absent when the customer uses a username; the form of the identifier |
| `developers.facebook.com/docs/graph-api/webhooks/getting-started/` | Search extract only | The header `X-Hub-Signature-256`, `sha256=` and a SHA-256 signature of the payload |
| `developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/` | Search extract only | The request and response of sending a text, by `to` (a phone number) and, in an example headed "Send to a BSUID", by `recipient` (a user ID). The user-ID page, read in part, says that if both are given the number takes precedence |
| Several pages with a status example | Search extracts only | `statuses[]` with `id`, `status`, `timestamp`, `recipient_id` |

## What was not found or not read

- **No page that specifies the status webhook was read in full.** The four
  status fixtures follow examples seen in extracts. The error object of a
  failed status (`errors[0].code`) is from an extract too.
- Which HTTP status Meta gives for which error, and which error codes mean
  "try again". The send code treats 429, 408 and 5xx as worth retrying and
  any other refusal as final; that is an assumption.
- The registration check (`hub.mode`, `hub.verify_token`,
  `hub.challenge`) was not re-read today; the code follows
  `docs/compliance.md`.
- Whether `from` is absent every time `wa_id` is. `inbound-text-no-phone.json`
  assumes both are.
- The statement that the signature is computed over a body with non-ASCII
  characters escaped was not found today. `inbound-text-arabic-escaped.json`
  is written that way so that a test can show the signature is checked over
  the bytes as received and not over a re-serialised copy.

## The files

| File | What it stands for |
| --- | --- |
| `inbound-text.json` | A customer's text, with a phone number and a business-scoped user ID |
| `inbound-text-arabic-escaped.json` | The same with Arabic text, as one line with escapes: a raw body |
| `inbound-text-no-phone.json` | A text from a customer who uses a username: no `from`, no `wa_id` |
| `inbound-image.json` | A message of a type this version does not read |
| `status-sent.json`, `status-delivered.json`, `status-read.json` | The three delivery statuses of a sent message |
| `status-failed.json` | A failed message, with an error code |
| `status-unknown.json` | A status this version does not know; invented |
| `two-numbers.json` | One webhook for two receiving numbers |
| `other-field.json` | A webhook field other than `messages`; its content is invented |
