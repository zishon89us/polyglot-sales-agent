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
| Message class | Every outbound message belongs to exactly one of the five classes in the table "Message classes" below. The class decides whether consent, opt-out and quiet hours apply. |
| Reply | An assistant reply, a system reply or a staff message, as classed below. "First reply" in a metric means the earliest of these in the session. |
| Reply window | The 24 hours after a contact's most recent inbound message or call, during which the channel allows free-form messages. It decides only whether a message may be free-form or must be a template (US-C9). Source: `docs/compliance.md`. |
| Template | A message with fixed, pre-approved wording and variable slots, required by the channel outside the reply window. Each language version is approved separately. |
| Handover | A request for staff attention about one contact. A contact has at most one open handover. While a handover is attached to a session and waiting or in progress, that session is handed over and the assistant does not reply in it. A handover is **answered** once a staff user sends a staff message from it. It ends with exactly one outcome: `handed-back`, `answered` or `closed-unanswered`, the last with a stored reason (one chosen by staff, or `handed-back-unanswered`, `no-response`, `expired`, `contact-deleted`). An unanswered handover does not end when its session ends. Its states and every transition are defined in `docs/design/state-machines.md` section 2, which is the authority. |
| Handover reason | One of `requested`, `repeated-failure`, `sensitive-topic`, `data-request`, `limit`, `unsupported-content`, `late-change`, `provider-failure`, `staff`. |
| Business hours | The weekly hours in which the tenant's staff answer handovers, set at setup. Distinct from opening hours, which are when appointments can be booked. |
| Quiet hours | A daily period in tenant time during which no business-initiated message is sent, except as the rules under "Quiet hours rules" below allow. The start time is inside quiet hours and the end time is outside them: with 22:00 to 08:00, a message may be sent at 21:59 and at 08:00, not at 22:00. |
| Answering | A tenant is answering when it has every required setting and verified channel credentials. Only an answering tenant receives replies (US-C1). Templates do not affect it: a missing or unavailable template withholds only the messages that need it. |
| Slot | A start time at which one service can be booked. Slots for a service fall on a grid: every slot interval, counted from the start of each opening period, for as long as the start plus the service's duration is no later than the end of that period. A booking occupies the interval from its start up to, but not including, its start plus the service's duration. |
| Capacity | For one service: the largest number of bookings of that service whose intervals may overlap at any instant. For the tenant, if the total-concurrent-bookings setting is set: the largest number of bookings of any service whose intervals may overlap at any instant. |
| Free slot | A slot that is not in the past, is no sooner than the minimum notice, is within the booking horizon, whose interval does not overlap a blocked period, and at which one more booking would exceed neither the service's capacity nor the tenant's total at any instant of its interval. |
| Fallback message | A fixed message, sent by code, used when the assistant cannot produce a safe reply. It says the assistant could not answer that and that the customer can ask for a person. It exists in every supported language; for a contact whose language is unknown or unsupported, the tenant's default language is used. |
| Person button | A reply button labelled as talking to a person, attached to the fallback message and to the unsupported-type reply. Tapping it is handled by code, without the model. |
| Grounded fact | A statement of one of these six kinds: a price; a date or time of a slot or booking; a service's name, duration or description; opening hours; a policy the tenant has entered; a detail of the contact's own booking. A grounded fact may be stated only if it is true of the thing it is stated about, according to the tenant's current stored data or a tool result from the same session. Every asserted fact that contains a currency amount, a clock time or a calendar date is checked at run time, claim by claim, whatever its kind (US-C4); facts without such a value, such as a service description, are measured by evals. A value the customer stated, repeated back to them, is not an asserted fact unless the assistant confirms it. |
| Supported language | A language in the eval dataset with a published score. Version 1.0 supports at least six, including Arabic, English, Urdu and Hindi; the full list is fixed in the eval plan (open question OQ-6). The assistant attempts other languages, but nothing is claimed for them. |
| Unsupported message type | Any inbound message that is not text, a button reply, or an image or video caption: voice notes, images, video, documents, locations, stickers, contacts. |
| Pack | The configuration and code for one use case. Version 1.0 has the `booking` pack. |
| Message status | `sent`: accepted by the channel API. `delivered`, `read`: reported by the channel. `failed`: rejected, or reported failed, with the channel's error code. `withheld`: a due business-initiated message that was not attempted, with a reason. |
| Withheld reason | One of `no-consent`, `opted-out`, `no-template`, `template-unavailable`, `limit-reached`, `too-late`. A message delayed by quiet hours is held, not withheld; it becomes `too-late` only under the rules below. |
| Degraded mode | The service state in which the model provider is treated as unavailable (US-C15). |
| Awaiting retry | A mark on a session whose latest customer message could not be answered because the model provider failed, or arrived during degraded mode. It is cleared when the answer is sent, when the session is handed over or ends, or when the message is 15 minutes old, at which point the session is handed over with reason `provider-failure` (US-C15; `docs/design/state-machines.md` section 8). |

## Message classes

| Class | What it is | Needs recorded consent | Blocked by opt-out | Quiet hours apply |
| --- | --- | --- | --- | --- |
| Assistant reply | Written by the model in answer to the contact's latest inbound message or batch | No | No | No |
| System reply | Fixed text sent by code in direct response to an inbound message: the disclosure, the fallback message, the unsupported-type reply, the rate-limit notice, opt-out and opt-in confirmations, and the message that tells a customer their session has been handed over | No | No | No |
| Staff message | Written by a staff user in the dashboard. Free-form only inside the reply window (US-C9) | No | Yes, when the contact's only messages in the current session are opt-out requests (US-D3) | No |
| Service notice | Sent by code on a timer or event, or by staff choosing a fixed action, about something the contact asked for: the holding message for an overdue handover, sent only while the reply window is open (US-C14); a retried answer after a provider failure (US-C15); and the `handover_followup` template, sent at most once per handover (US-C14). The contact's own request is the basis for sending it. A template service notice follows the language rule of US-C9 criterion 2 and, if it cannot be sent, is recorded as withheld with the same reasons as a business-initiated message | No | Yes, if the contact opted out after making the request | Only for `handover_followup`, which is held to the end of quiet hours |
| Business-initiated message | Any other message triggered by a schedule or an event: appointment reminders, and notices that staff cancelled or moved a booking | Yes (US-C13) | Yes (US-C7) | Yes |

Whether the reply window is open never changes a message's class. It decides
only whether the message may be free-form or must be a template (US-C9).

## Quiet hours rules

| Message | Rule when its due time falls in quiet hours |
| --- | --- |
| Appointment reminder | Set for one minute before those quiet hours begin, if that moment is still in the future when the reminder is scheduled or rescheduled. Otherwise set for the end of those quiet hours, if that is at least 60 minutes before the appointment starts. Otherwise withheld as `too-late`. A reminder is never sent later than 60 minutes before its appointment, however it came to be late. The full rule, with worked examples, is in `docs/design/state-machines.md` section 5 (US-B3). |
| Booking-change notice | Sent at once if the booking's start time, or for a moved booking the earlier of its old and new start times, is within 12 hours. Otherwise sent at the end of quiet hours (US-D12). |
| A message queued for the channel's daily limit | When capacity returns, the message's own rule in this table is applied as if it had just become due (US-C9). |
| `handover_followup` | Held to the end of quiet hours. |

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
| Handover rate | Session start | Sessions with a handover for any reason ÷ sessions with at least one inbound message. The count for each reason, including `staff`, is shown, and so is the count of handovers that are unanswered or were closed unanswered. |
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
| Slot interval | 30 minutes | 5 to 120 minutes | US-B2, US-B5 |
| Total concurrent bookings | Not set (no tenant-wide limit) | 1 to 50, or not set | US-B2, US-B5 |
| Minimum notice for a booking | 1 hour | 0 to 72 hours | US-B5 |
| Change cut-off | 2 hours before the start | 0 to 72 hours | US-B4 |
| Reminder lead time | 24 hours before the start | 1 to 72 hours | US-B3 |
| Quiet hours | 22:00 to 08:00 | Any daily period up to 12 hours, or none | US-B3, all business-initiated messages |
| Handover escalation time | 15 minutes | 5 to 240 minutes | US-C14 |
| Message retention | 12 months | 1 to 36 months | NFR-V4 |

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
| Awaiting-retry attempts | Every 60 seconds and on the customer's next message, until the message is 15 minutes old; at most one provider-failure fallback per session per 15 minutes | US-C15 |
| Age limit of a tool result used to state a slot or booking time | 10 minutes | US-C4 |
| Reminder floor after quiet hours | At least 60 minutes before the appointment | US-B3 |
| Urgent booking-change notice | Appointment starts within 12 hours | US-D12 |
| Credential check | Daily, and on any channel authentication error | US-D6 |
| Degraded-mode trigger and probe | 5 sessions marked awaiting retry within 2 minutes; health check every 30 seconds | US-C15 |
| Send attempts | 3 attempts, waits of 2 and 8 seconds | US-C18 |
| Wait for delivery before the next message | 10 seconds | US-C18, NFR-R7 |
| Unanswered follow-up expiry | 7 days after `handover_followup` | US-C14 |
| Detached handover expiry | 14 days after its session ended | US-C14 |
| Handover escalation clock | Counts only while the tenant is inside business hours | US-C14 |
| Credential check that cannot complete | No state change; retried within the hour | US-D6 |
| Notification email throttle | 1 email per tenant per 5 minutes; 3 send attempts | US-C14 |
| Sign-in lockout | 5 failures in 15 minutes, then 15 minutes | US-D1, NFR-S6 |
| Dashboard session | 60 minutes idle, 12 hours total | US-D1 |
| Invitation and reset links | 7 days and 1 hour, single use | US-D7, US-D10 |
| Password length | At least 12 characters | US-D10 |
| Deletion deadline | 24 hours | US-D5, NFR-V3 |
| Daily token budget per tenant | Not yet set; see open question OQ-7 | US-C6, NFR-C2 |
