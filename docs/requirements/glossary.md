# Glossary, metric definitions and default settings

Status: draft for maintainer review · Phase 1 (requirements) · Issue #46

The other requirements documents use these terms. Where a document and this
glossary disagree, this glossary is right and the other document has a defect.

## Terms

| Term | Meaning |
| --- | --- |
| Tenant | One business using the product, with its own number, data, users and settings. |
| Contact | One end customer of one tenant, identified by phone number. The same person messaging two tenants is two contacts. |
| Conversation | All messages between one contact and one tenant on one channel. A conversation becomes **inactive** after 24 hours with no message from either side; the next message starts a new **session** in the same conversation. |
| Session | A run of activity in a conversation, from the first message after inactivity to the next inactivity. Metrics count sessions, so one customer returning next month is counted again. |
| Inbound message | A message from a contact to the tenant. |
| Business-initiated message | A message the product sends without the contact having written in the current channel reply window: reminders, order confirmations, follow-ups. Subject to the channel's rules (US-C9) and to consent (US-C13). |
| Handover | The state in which the assistant stops replying in a conversation and staff are responsible for it, until staff hand it back. |
| Fallback message | The fixed, pre-translated message sent when the assistant cannot produce a safe reply. |
| Grounded | A statement whose prices, times, policies or order details all appear in the tenant's stored data or in a tool result from the same turn. |
| Pack | The configuration and code for one use case (`booking`, `cod-confirm`). |
| Supported language | A language included in the eval dataset with published scores. In any other language the assistant still tries to reply in kind, but this is best effort and is not claimed. |
| Unsupported message type | Anything other than text and interactive button replies: voice notes, images, video, documents, locations, stickers, contacts. |

## Metrics

Every metric is computed per tenant for a chosen date range, using session
start time in the tenant's time zone. A metric with a zero denominator is
shown as "no data", never as 0%.

| Metric | Definition |
| --- | --- |
| First-reply time | For each session started by an inbound message: time from the channel timestamp of the first inbound message to the send time of the first reply (assistant or staff). Reported as the median. |
| Inquiry | A session, started by an inbound message, in a tenant using the `booking` pack, in which the contact asked about a service, price or availability or asked to book. Sessions that are only opt-outs, wrong numbers or replies to a reminder are not inquiries. Classified by the assistant and stored; the classifier is covered by evals. |
| Inquiry-to-booking rate | Inquiries in which a booking was created before the session ended ÷ inquiries. |
| No-show rate | Appointments marked missed ÷ appointments marked attended or missed, for appointments whose time is in the range. Appointments with no recorded outcome are excluded and counted separately (US-D8). Cancelled appointments are excluded. |
| Order confirmation rate | Cash-on-delivery orders marked confirmed ÷ orders for which a confirmation message was sent, by order creation time. |
| Time to confirmation | For confirmed orders: time from the confirmation message being sent to the customer confirming. Reported as the median. |
| Refused-delivery rate | Orders reported refused or returned ÷ orders reported delivered, refused or returned. **Cannot be computed by the product as currently scoped**; see open question Q1 in the requirements review. |
| Handover rate | Sessions in which a handover happened ÷ sessions with at least one inbound message. |
| Containment rate | Sessions that ended with the customer's task completed and no handover ÷ sessions with at least one inbound message. "Task completed" means a booking created, changed or cancelled; an order confirmed, changed or cancelled; or an information question answered with a grounded reply and no follow-up request for a person. |
| Cost per conversation | Sum of model cost recorded in traces for a session ÷ 1, reported as the mean and the 95th percentile across sessions. Channel fees are reported separately when the channel reports them. |

## Tenant settings and proposed defaults

Stories refer to "configured" waits and times. These are the settings and
their defaults. The defaults are proposals with no data behind them; a pilot
should adjust them.

| Setting | Default | Used by |
| --- | --- | --- |
| Time zone | Set at setup; required | US-B5, all metrics |
| Default language | Set at setup; required | US-C12 and fallback messages when the contact's language is unknown; business-initiated messages use the contact's last known language, else this default (interim rule, see F12 in the requirements review) |
| Currency | Set at setup; required | Prices in replies |
| Message batching window | 3 seconds after the latest inbound message, capped at 10 seconds from the first | US-C11 |
| Appointment reminder lead time | 24 hours before; skipped if the booking is made less than 24 hours ahead | US-B3 |
| Order confirmation follow-up | One follow-up 4 hours after the confirmation if unanswered; flagged for staff 20 hours after that | US-O4 |
| Handover escalation time | 15 minutes without a staff reply | US-C14 |
| Handover notification method | Dashboard waiting list, plus email to the tenant's notification address | US-C14 (see Q4) |
| Turn cap per session | 30 assistant replies, then handover | NFR-C2 |
| Daily token budget | Set from measured cost in M3 | NFR-C2 |
| Conversation retention | 12 months, then deletion or anonymisation | NFR-V4 |
| Quiet hours for business-initiated messages | None sent between 22:00 and 08:00 tenant time; due messages wait until 08:00 | US-B3, US-O2, US-O4 |
