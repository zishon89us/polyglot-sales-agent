# Glossary, metric definitions and settings

Status: revised after the independent Gate 1 review · Phase 1 (requirements) · Issues #46, #61

The other requirements documents use these terms. Where a document and this
glossary disagree, this glossary is right and the other document has a defect.
Where a story repeats a number so that it can be read on its own, the
number in this file is the authority.

## Terms

| Term | Meaning |
| --- | --- |
| Tenant | One business using the product, with its own number, data, users, settings and exactly one pack. |
| Operator | Whoever runs an installation of the product and creates tenants. In this project, the maintainer. |
| Contact | One end customer of one tenant, identified by phone number. The same person messaging two tenants is two contacts. |
| Conversation | All messages between one contact and one tenant. It has no end. |
| Session | A run of activity inside a conversation. A session starts with the first message, in either direction, after 24 hours in which neither side sent a message, and ends when 24 hours pass with no message from either side. Disclosure, handover, counters and metrics are all per session. |
| Inbound message | A message from a contact to the tenant. |
| Business-initiated message | A message whose sending is triggered by a schedule or by the system, not written as a reply to the contact's latest inbound message. Reminders are business-initiated. So are messages sent to the customer when staff cancel or move a booking. **It stays business-initiated whether or not the reply window is open**, so consent (US-C13), opt-out (US-C7) and quiet hours always apply to it. |
| Reply | A message sent in answer to the contact's latest inbound message, by the assistant or by staff. |
| Reply window | The 24 hours after a contact's most recent inbound message or call, during which the channel allows free-form messages. It decides only whether a message may be free-form or must be a template (US-C9). Source: `docs/compliance.md`. |
| Template | A message with fixed, pre-approved wording and variable slots, required by the channel outside the reply window. Each language version is approved separately. |
| Handover | The state of a session in which the assistant does not reply and staff are responsible. It ends when staff hand back or when the session ends, whichever is first. A new session never starts handed over. |
| Handover reason | One of `requested`, `repeated-failure`, `sensitive-topic`, `data-request`, `limit`, `unsupported-content`, `late-change`, `staff`. |
| Business hours | The weekly hours in which the tenant's staff answer handovers, set at setup. Distinct from opening hours, which are when appointments can be booked. |
| Quiet hours | A daily period in tenant time during which no business-initiated message is sent. |
| Fallback message | A fixed message, sent by code, used when the assistant cannot produce a safe reply. It says the assistant could not answer that and that the customer can ask for a person. It exists in every supported language; for a contact whose language is unknown or unsupported, the tenant's default language is used. |
| Person button | A reply button labelled as talking to a person, attached to the fallback message and to the unsupported-type reply. Tapping it is handled by code, without the model. |
| Grounded fact | A statement of one of these six kinds: a price; a date or time of a slot or booking; a service's name, duration or description; opening hours; a policy the tenant has entered; a detail of the contact's own booking. A grounded fact may be stated only if it appears in the tenant's stored data or in a tool result from the same session. |
| Supported language | A language in the eval dataset with a published score. Version 1.0 supports at least six, including Arabic, English, Urdu and Hindi; the full list is fixed in the eval plan (open question OQ-6). The assistant attempts other languages, but nothing is claimed for them. |
| Unsupported message type | Any inbound message that is not text, a button reply, or an image or video caption: voice notes, images, video, documents, locations, stickers, contacts. |
| Pack | The configuration and code for one use case. Version 1.0 has the `booking` pack. |
| Message status | `sent`: accepted by the channel API. `delivered`, `read`: reported by the channel. `failed`: rejected, or reported failed, with the channel's error code. `withheld`: a due business-initiated message that was not attempted, with a reason. |
| Withheld reason | One of `no-consent`, `opted-out`, `no-template`, `template-unavailable`, `limit-reached`, `too-late`. |
| Degraded mode | The service state in which the model provider is treated as unavailable (US-C15). |
| Awaiting retry | A session whose last customer message could not be answered because the model provider failed. |

## Metrics

Every metric is computed per tenant for a chosen date range, in the tenant's
time zone. Each row states which timestamp places an item in the range. A
metric with a zero denominator is shown as "no data", never as 0%.

| Metric | Counted by | Definition |
| --- | --- | --- |
| First-reply time | Session start | For sessions started by an inbound message that received a reply: time from the channel timestamp of the first inbound message to the `sent` time of the first reply, by the assistant or staff. Reported as the median. Sessions that received no reply are excluded and their count is shown beside the figure. |
| Inquiry | Session start | A session, started by an inbound message, in which the contact asked about a service, a price or availability, or asked to book. Sessions that are only an opt-out, a wrong number, or an answer to a reminder are not inquiries. Set by the model when the session ends (US-C19). |
| Inquiry-to-booking rate | Session start | Inquiries in which a booking was created before the session ended ÷ inquiries. |
| No-show rate | Appointment start | Appointments marked missed ÷ appointments marked attended or missed. Cancelled appointments and appointments with no recorded outcome are excluded; the count with no outcome is shown beside the figure. |
| Handover rate | Session start | Sessions with a handover for any reason ÷ sessions with at least one inbound message. The count for each reason, including `staff`, is shown. |
| Contained session | Session start | A session with at least one inbound message, no handover, and either a booking created, changed or cancelled, or at least one assistant reply and no fallback message. Derived by code from recorded events (US-C19). |
| Containment rate | Session start | Contained sessions ÷ sessions with at least one inbound message. |
| Model cost per session | Session start | Sum of model cost in the session's traces. Reported as the mean and the 95th percentile across sessions that had at least one model call. |
| Channel fees per session | Session start | Sum of the fees the channel reports for the session's outbound messages. Reported as the mean. Shown as "not reported" when the channel sends no pricing data. |

Deletion of a contact (US-D5) does not change any metric for a past period:
sessions and bookings are kept without personal fields.

## Tenant settings

Stories refer to these by name. Defaults are proposals with no data behind
them; a pilot should adjust them. An owner changes them under US-D11, within
the allowed range.

| Setting | Default | Allowed range | Used by |
| --- | --- | --- | --- |
| Time zone | Required at setup | Any IANA time zone | US-B5, all metrics |
| Default language | Required at setup | A supported language that is also an enabled template language | US-C5, US-C9, US-C12, fallback message |
| Enabled template languages | Default language | Arabic, English, or both | US-C9, US-C16 |
| Currency | Required at setup | Any ISO 4217 code | US-B1 |
| Support contact | Required at setup | A phone number or an email address | US-C6, US-C14 |
| Notification email address | Required at setup | One email address | US-C14, US-C15 |
| Business hours | Required at setup | Per weekday, zero or more periods | US-C6, US-C14 |
| Opening hours | Required before bookings | Per weekday, zero or more periods | US-B5, US-D2 |
| Booking horizon | 60 days | 7 to 365 days | US-B2 |
| Minimum notice for a booking | 1 hour | 0 to 72 hours | US-B5 |
| Change cut-off | 2 hours before the start | 0 to 72 hours | US-B4 |
| Reminder lead time | 24 hours before the start | 1 to 72 hours | US-B3 |
| Quiet hours | 22:00 to 08:00 | Any daily period up to 12 hours, or none | US-B3, all business-initiated messages |
| Handover escalation time | 15 minutes | 5 to 240 minutes | US-C14 |
| Conversation retention | 12 months | 1 to 36 months | NFR-V4 |

## Fixed values

Not configurable in v1.0. Stated here so that each number has one home.

| Value | Number | Used by |
| --- | --- | --- |
| Session inactivity | 24 hours | Session definition |
| Reply window | 24 hours | US-C9; set by the channel |
| Message batching window | 3 seconds after the latest inbound message, at most 10 seconds after the first | US-C11, NFR-P5 |
| Turn cap | 30 assistant replies per session | US-C6, NFR-C2 |
| Future bookings per contact | 3 | US-B2 |
| Slots offered at once | 5 | US-B2 |
| Per-contact rate limit | 20 inbound messages in 5 minutes, then a 15-minute pause | US-C17, NFR-S7 |
| Model call timeout and attempts | 20 seconds, 3 attempts, waits of 1 and 4 seconds | US-C15, NFR-R4 |
| Degraded-mode trigger and probe | 5 sessions awaiting retry within 2 minutes; health check every 30 seconds; retry sessions up to 15 minutes old | US-C15 |
| Send attempts | 3 attempts, waits of 2 and 8 seconds | US-C18 |
| Wait for delivery before the next message | 10 seconds | US-C18, NFR-R7 |
| Notification email throttle | 1 email per tenant per 5 minutes; 3 send attempts | US-C14 |
| Sign-in lockout | 5 failures in 15 minutes, then 15 minutes | US-D1, NFR-S6 |
| Dashboard session | 60 minutes idle, 12 hours total | US-D1 |
| Invitation and reset links | 7 days and 1 hour, single use | US-D7, US-D10 |
| Password length | At least 12 characters | US-D10 |
| Deletion deadline | 24 hours | US-D5, NFR-V3 |
| Daily token budget per tenant | Not yet set; see open question OQ-7 | US-C6, NFR-C2 |
