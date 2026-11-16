# Independent review: Gate 1 — Requirements

Date 2026-11-16. Reviewed: `docs/process/review-checklists.md` (reviewer instructions and Gate 1), `AGENTS.md` sections 1 and 11, and `docs/requirements/` `glossary.md`, `vision.md`, `personas.md`, `user-stories.md`, `nfr.md`, `risks.md`, `traceability.md`. Deliberately not read: `docs/requirements/review-2026-11-16.md`, `docs/STATUS.md`, `docs/retros/`, git history, pull requests and issues. No network access was used.

## Summary

| Severity | Count |
| --- | --- |
| High | 9 |
| Medium | 27 |
| Low | 8 |
| Total | 44 |

The set is honest about what is unmeasured, its numbers agree where they are given (batching window, sign-in limit, follow-up waits), and all 32 stories have an issue number, a milestone and a traceability row. It is not complete enough to design from: handover has no exit and no out-of-hours behaviour, the glossary definition of "business-initiated message" lets reminders bypass opt-out, both packs depend on message templates and consent data that no story provides, the `cod-confirm` result never reaches the store, and deletion is undefined for anything other than past messages. Nine findings are High, so by `AGENTS.md` section 11 the gate is not passed until they are fixed or the human accepts their rejection.

## Findings

Locations use the story or NFR ID, or the document heading. "AC" means acceptance criterion.

| ID | Severity | Location | Finding | Suggested resolution |
| --- | --- | --- | --- | --- |
| R1 | High | `glossary.md` Terms, "Business-initiated message"; US-C7 AC2; US-C13; US-B3 AC3; NFR-V1; glossary setting "Quiet hours" | The glossary defines a business-initiated message as one sent "without the contact having written in the current channel reply window". Opt-out (US-C7 AC2), consent (US-C13) and quiet hours apply only to business-initiated messages. So a reminder, follow-up or order confirmation that falls due while the reply window is open is, by definition, not business-initiated and escapes all three. The opt-out message itself is an inbound message that opens the window, so a reminder due in the hours after an opt-out would be sent. This conflicts with US-B3 AC3 ("no reminder is sent") and the intent of NFR-V1, and the glossary states that it wins where documents disagree. | Define the term by who starts the exchange (scheduled or system-triggered, not a reply to the contact's latest message), independent of the channel window. Keep the window only as the rule for free-form versus template (US-C9). |
| R2 | High | Glossary "Handover"; US-C6; US-C14 AC2, AC3; US-D3 AC1; setting "Handover escalation time" | Handover ends only when staff hand back. Nothing defines staff working hours, what the customer is told out of hours, what "escalated once" means or who receives it, or what happens after the single escalation and single holding message. Because a conversation is lifelong (glossary "Conversation") and the assistant "stays silent" (US-C14 AC3), a handover that nobody picks up silences the assistant for that contact indefinitely, including in later sessions when the customer returns to book. | Add criteria for: an out-of-hours message with an expected reply time; what escalation does and to whom; a maximum handover duration or an automatic return rule (for example at the start of a new session); and whether handover is per session or per conversation. |
| R3 | High | NFR-R4; US-C6 AC2; glossary "Fallback message"; `risks.md` (no entry) | Model-provider failure is defined only by one NFR row: 3 retries "with backoff" (no durations), then fallback and handover. No story covers it. During an outage of minutes, every conversation that receives a message is handed over, and by R2 each stays silent until staff hand it back one by one; there is no recovery rule, no cap on handovers or notifications (US-C14 AC1 sends one per handover), and no rule for messages that arrive during the retries. US-C6 AC2 gives a different rule for failure (hand over only after two failures in a row, on the next message). Provider outage is not in the risk register. | Add a story for provider failure with: backoff values and a total time bound; behaviour for messages arriving meanwhile; a tenant-wide degraded state instead of per-conversation handover; automatic resumption when the provider recovers; one notification per incident. Reconcile with US-C6 AC2 and add a risk. |
| R4 | High | US-C9 AC2; US-B3 AC1; US-O2 AC1; US-O4 AC1; US-D6; `vision.md` Constraints | Outside the reply window "only an approved template is sent, or nothing if none applies". Every first order confirmation and most reminders and follow-ups are outside the window, so both packs depend on approved templates. No story covers creating, submitting, approving or selecting templates, which languages they exist in, or what a tenant sees when none applies; US-D6 setup does not mention them. "Nothing" is a silent drop with no log or flag required. US-O2 AC1 requires items, total and address "in the customer's language", which cannot be met by a template that exists only in some languages. | Add a story for template provisioning per pack and per language, with setup incomplete (US-D6 AC3) until required templates are approved; define language fallback for templates; require a logged reason and a staff-visible flag when a due message is not sent. |
| R5 | High | US-C13 AC1, AC2; US-O1; US-O2; US-O4; US-C7 AC2; glossary "Order confirmation rate" | A due business-initiated message can be suppressed (no consent, opted out, no template, quiet hours) or fail to send, but no story defines what then happens to the order or booking. US-O4 flags only "a confirmation with no reply"; an order whose confirmation was never sent is neither confirmed nor flagged, and is outside the confirmation-rate denominator. "Consent arrived with an order" is not defined: US-O1 specifies no payload fields at all (phone, items, total, address, payment method, consent, language), no validation, and no behaviour for a missing or invalid phone number, a non-cash-on-delivery order or an unknown tenant. If the store sends no consent field, US-C13 AC1 stops the whole pack. | Specify the `order.created` payload and its validation in US-O1, including how consent is carried. Add a criterion that any order whose confirmation is suppressed or fails is flagged in US-O4 with the reason. |
| R6 | High | `personas.md` P2 "What they need"; US-O2 AC2; US-O3 AC1, AC2; US-O4; `vision.md` MVP scope and "Not a persona"; `AGENTS.md` section 1 MVP boundaries | P2 needs "the result written back so that only confirmed orders are shipped". No story sends the result to the store or gives the owner a list or export of confirmed, changed and cancelled orders; US-O4 lists only orders that need a person. The only store integration in scope is the inbound `order.created` webhook. The pack's job ("confirmed with address before shipping") therefore cannot be finished. US-O3's precondition "an unshipped order" cannot be evaluated because the product never learns that an order has shipped, and behaviour for a shipped order is not defined. | Add a story for how the outcome reaches the owner (order list with status and export at minimum, or an outbound signed webhook), and define the cut-off for change and cancel in terms the product can know (for example a time limit or a staff "shipped" mark). |
| R7 | High | US-D5 AC1, AC2; NFR-V3; NFR-V4; glossary setting "Conversation retention"; US-C7; US-C13; US-C10; `vision.md` principle 6 | Deletion covers "the contact's messages and personal fields" for "a contact with conversations" and nothing else. Undefined: a future booking (cancelled, slot freed, or kept without a person) and its scheduled reminder; an open order; the opt-out record (if deleted, a later order or message recreates the contact with fresh consent and the opt-out is forgotten, against NFR-V1); consent records; trace rows (US-C10), which may hold message text; the audit log's own personal data. "Deleted or anonymised" allows two outcomes with no rule for which. NFR-V3 "within one job run" is not a time bound. Retention (NFR-V4) has the same gaps for bookings, opt-outs and traces. There is no path for the customer's own request: a customer who asks the assistant to delete their data has no defined response, and US-D5 starts only from the owner. Export has no stated contents or format. | Define per data type (messages, contact, bookings, orders, consent, opt-out, traces, audit log) what deletion and retention do; keep a minimal suppression record for opt-out or state why not; define behaviour for future bookings and open orders; give a time bound; add a criterion for a deletion request made in chat (for example handover with reason). |
| R8 | High | Glossary Metrics "Inquiry", "Inquiry-to-booking rate", "Containment rate"; US-D4; `traceability.md` | The glossary says inquiries are "classified by the assistant and stored; the classifier is covered by evals", but no story or criterion requires the classification, its storage or its evaluation, and no traceability row covers it. Inquiry-to-booking rate is the primary metric of the `booking` pack. Containment rate needs each session judged for "task completed", including "an information question answered with a grounded reply and no follow-up request for a person"; no story produces that judgment, and US-D4 does not show the metric although `vision.md` says the product reports it. Neither metric can be computed from data a story produces, and neither is testable as written. | Add criteria (to US-B1/US-B2 or a new story) for classifying and storing inquiry and task-completion per session, with eval cases; add containment to US-D4 or remove it from `vision.md`. |
| R9 | High | US-D1; US-D6 AC1; US-D7; US-O1 AC1; `personas.md` P2 "Technical comfort" | Scenario 1 cannot start. US-D6 begins "Given a new owner account" and US-D1 covers only signing in; no story defines how an owner account is created (self-service or provisioned), how identity is verified, the authentication method, password reset, session lifetime, or controls on open sign-up. US-D7 says the owner "invites" staff but no criterion covers the invitation, its expiry or acceptance. US-O1 requires a "correctly signed" webhook and P2 pastes a webhook URL, but no story generates or shows the tenant's webhook URL and signing secret, or rotates it. | Add stories or criteria for account creation and recovery, staff invitation, and store webhook credential provisioning; state session lifetime and sign-up abuse controls. |
| R10 | Medium | `user-stories.md` Summary (milestones); US-C4 AC2, US-C5 AC2, US-C8 AC2, US-C12 AC1 and AC3 (M3); US-C6, US-C14 (M4); US-D1, US-D3 (M5); NFR-R4; NFR-C2 | Milestones conflict with dependencies. M3 stories offer a person or hand over (US-C12 AC3) but handover is M4. US-C14 AC1 (M4) requires "the dashboard's waiting list" but the dashboard and sign-in are M5. Handover exists from M4, but staff can reply and hand back only in M5 (US-D3). These criteria cannot be met in their own milestone. | Re-sequence, or state for each affected criterion which part is delivered in which milestone. |
| R11 | Medium | US-O2 AC1; glossary setting "Default language" | US-O2 AC1 says the first order confirmation is "in the customer's language". A new order contact has never written, so the language is unknown. The glossary gives a different rule (last known language, else tenant default) and labels it an "interim rule" pending item F12 in a document outside this review. The story and the glossary disagree and the rule is not final. | Rewrite US-O2 AC1 to the glossary rule and settle the rule; state whether the order payload may carry a language. |
| R12 | Medium | US-O2 AC2; US-O3 AC1, AC2; US-O4; `personas.md` P2; glossary "Order confirmation rate", "Time to confirmation" | Order states after confirmation are undefined: whether an address change on a confirmed order keeps it confirmed; whether "updated, read back, and confirmed" means the customer or the order status; whether a confirmed-then-cancelled order counts as confirmed in the metric; how long after the message a reply is still accepted (after the 24-hour flag, days later); which order a reply refers to when a contact has several open orders. P2 expects changed addresses in the needs-a-person list; US-O4 flags only no-reply and unclassifiable answers. | Add an order state model with allowed transitions and expiry; align US-O4 with P2 or change P2; state the metric rule for cancelled-after-confirmed. |
| R13 | Medium | US-B3; US-B4; glossary setting "Appointment reminder lead time"; `AGENTS.md` section 1 "First two packs" | Reminder lifecycle is undefined when the booking changes: after a reschedule (US-B4 AC1) whether a second reminder is sent, whether the "confirmed" mark is cleared, and whether the "booked less than 24 hours ahead" skip applies to the new time; after a cancellation, that the pending reminder is cancelled. `AGENTS.md` and the US-B3 story text promise a way to change the appointment from the reminder, but no US-B3 criterion covers a reschedule or cancel reply, or no reply at all. | Add criteria for reminder handling on reschedule and cancel, and for each reply to a reminder including none. |
| R14 | Medium | US-B2 AC1, AC2; US-B4 AC1; US-B5 AC2; US-D2; `personas.md` P1 ("two chairs"); `risks.md` R-T5 | Booking rules run out: no criterion for "no free slots exist" or an unknown service (the false branch of US-B2 AC1); capacity is undefined (one booking per slot versus per chair or staff member), though R-T5 assumes uniqueness per slot; no booking horizon, minimum notice or change cut-off; no limit on bookings per contact, so one contact can fill the calendar; US-B4 does not say which booking is meant when a contact has several, what happens when the chosen new slot is taken in the meantime, or that the old slot is released only if the new one is obtained. Service duration is used by US-B5 AC2 but no story lets the owner enter it. | Add criteria for each case and a per-contact booking limit; define capacity; add duration to US-D2. |
| R15 | Medium | US-D8; US-D9 AC1, AC3; US-D2; US-C13 | Staff-side calendar gaps: no story lets staff see upcoming bookings, or cancel or move one from the dashboard; blocking a period that already contains bookings, or changing opening hours so that existing bookings fall outside them, is undefined (customer notified? booking kept?). US-D9 AC3 assumes "a contact with consent" for a phone or walk-in booking, but no story lets staff record consent, so such contacts would never receive reminders (US-C13 AC1). | Add a booking list and staff cancel/move criteria; define conflicts with existing bookings; add a way to record consent with its source. |
| R16 | Medium | US-D7 AC2; US-D3; US-C14 AC2 | Scenario 9: removing a user ends their sessions, but nothing says what happens to conversations that user had taken over. Conversations have no stated owner; a conversation the removed agent had already replied in is not caught by the US-C14 AC2 escalation (it triggers only on "no staff reply") and stays silent (see R2). Also undefined: a reply being sent at the moment of removal, how quickly "sessions end", and removal of the last owner or of oneself. | State that such conversations return to the waiting list, give a time bound for session termination, and forbid removing the last owner. |
| R17 | Medium | US-D3 AC1, AC2; US-C9; US-C7; `personas.md` P3 | Takeover gaps: "an open conversation" is not a defined term; an assistant reply already being generated when staff take over is not addressed; two agents acting on one conversation is not addressed; hand-back has no criterion (does the assistant answer messages that arrived during handover, and does it use staff messages as context?); staff replies are not stated to be subject to the reply window and templates (US-C9) or to opt-out. P3 needs history "readable even when the customer wrote in another language"; no criterion provides translation. | Add criteria for each case; either add translation to US-D3 or remove the need from P3. |
| R18 | Medium | Glossary "Tenant settings and proposed defaults"; US-D2; US-D6 AC1; US-D7 AC1; US-C14 AC1, AC2 | Stories refer to "configured" values and US-D7 mentions "settings", but no story lets an owner view or change the settings in the glossary table (reminder lead time, follow-up waits, escalation time, quiet hours, retention, batching). No allowed range is given for any. The handover notification goes to "the tenant's notification address", which US-D6 setup does not collect; email is an external dependency with no failure behaviour. Whether a tenant has exactly one pack or may have both is not stated ("choose a pack"). | Add a settings story with ranges, collect the notification address at setup, define behaviour when the email fails, and state the pack cardinality. |
| R19 | Medium | US-C6 AC1; US-C7 AC1; US-B1 AC1; glossary "Supported language"; `vision.md` principle 2 | "In any language" cannot be verified and conflicts with the glossary, which claims behaviour only for supported languages and calls the rest best effort. For opt-out this matters most: a missed opt-out in an unsupported language breaks NFR-V1, and there is no deterministic route (keyword or button) required. | Replace "any language" with "any supported language", and add a deterministic opt-out route that does not depend on the model. |
| R20 | Medium | Glossary "Grounded"; US-C4 AC1, AC3; NFR-A2; `vision.md` principle 1; `risks.md` R-P4, R-A1 | Grounding is specified four ways: glossary (prices, times, policies, order details), US-C4 AC3 and NFR-A2 (price, time, policy), vision (price, time slot, order detail). "Tool result from the same turn" makes a correct restatement of an earlier turn's booking time ungrounded. "Matches the stored value exactly" is not defined for a translated reply (numerals, currency format, translated service names or policy text), and a deterministic check that a "policy" statement is traceable is not described. R-P4 says the assistant "hands over when data is missing"; US-C4 AC2 says it only offers a person. | Use one list everywhere; define the match rule for numbers, dates and translated text; widen "same turn" or justify it; align R-P4 with US-C4. |
| R21 | Medium | US-C6 AC2, AC3; US-C12 AC3; NFR-C2; `risks.md` R-A3 | US-C6 AC2: "cannot complete the task" is undefined, and "twice in a row, when the next message arrives" can mean handover at the second failure or on a third message. AC3 depends on topics "defined in the guardrail policy", which is not part of the set, so it cannot be tested yet. R-A3's "hand over on low confidence" has no criterion or threshold. Only US-C6 AC1 says the customer is told about the handover; AC2, AC3, US-C12 AC3 and NFR-C2 (turn cap, budget) do not. | Define the failure counter and trigger precisely; list or reference a dated topic list; add or remove the confidence rule; state the customer message for every handover cause. |
| R22 | Medium | Glossary "Fallback message"; US-C4 AC3; NFR-R4 | The fallback message has no story. Its wording intent (does it offer a person?), the set of languages it is "pre-translated" into, and the rule when the contact's language is known but has no translation are not given; the glossary covers only "language unknown". | Add criteria: content, language set (at least the supported languages), and the fallback-of-the-fallback rule. |
| R23 | Medium | US-C5 AC1; glossary "Conversation"; US-O2 AC1; US-C12 AC1 | Disclosure is required on the assistant's first message in "a new conversation". A conversation lasts for the life of the contact, so a customer returning after months gets no disclosure. It is unclear whether the first message being a template (order confirmation, reminder), the unsupported-type reply or the fallback must carry the disclosure. | State whether disclosure is per conversation or per session, and that it applies to every kind of first outbound message. |
| R24 | Medium | US-C11 AC1; US-C12 AC1, AC3; glossary "Message batching window" | Interaction undefined: an unsupported message and text messages in one batching window (US-C12 says one reply on receipt; US-C11 says one reply for the batch); whether "three unsupported messages in a row" resets on a text message or on a new session; a batch that contains both a question and a request for a person; an image with a text caption. | Add criteria for mixed batches and define the counter. |
| R25 | Medium | US-C1 AC2, AC3; NFR-S2; NFR-R2; US-O1 AC2; US-C2 | NFR-S2 requires replayed requests to be "rejected"; US-C1 AC2 and NFR-R2 require a repeated delivery of the same message ID to be accepted and answered once. The difference between a replay and a legitimate channel retry is not defined and no timestamp tolerance is given. US-O1 AC2 "rejected or ignored" permits two responses. A signed message for a number that maps to no tenant is not covered by US-C1, US-C2 or US-D6 AC3. | Define replay versus retry with a number; give one response per case (status code); add the unknown-number case. |
| R26 | Medium | US-C9; US-B3 AC1; US-O2 AC1; NFR-R5; `risks.md` R-D3 | Outbound failure is undefined: channel API error or rate limit, a number that is not on the channel, and delivery-status events (failed, undelivered). NFR-R5 speaks of "exhausted jobs" but gives no retry count, and its alert has no recipient (R-D3 notes nobody may be watching). "Sent" in the metric definitions is ambiguous between attempted and delivered. | Add criteria for send failure with retry numbers and a staff-visible outcome; define "sent". |
| R27 | Medium | US-C8 AC1, AC3; NFR-A1; NFR-C2; US-O1; US-C14 AC1 | Abuse cases are thin. US-C8 AC1 is three behaviours in one, uses untestable terms ("no rule is broken", "unintended tool"), and does not say what the assistant does in response (reply, decline, hand over). Only tool misuse has a fixed threshold; prompt disclosure and data exposure do not. Customer-controlled text also arrives through the order webhook (name, address, item text) and owner-entered data, which US-C8 does not cover. There is no per-contact inbound rate limit: the only bound is the 30-reply turn cap, which ends in a handover and a staff notification, so one sender can generate cost and flood the waiting list and notification email. | Split and reword US-C8 AC1 with a defined response; extend it to all untrusted text; add an NFR for per-contact rate limiting and notification throttling. |
| R28 | Medium | NFR-A3; NFR-C2 and glossary "Daily token budget"; NFR-C3; NFR-M3; US-C9 AC1 ("free-reply window"); NFR-R4 ("backoff"); NFR-S6 and US-D1 AC3; NFR-P4; `vision.md` Success criteria | Values referred to without a number: AI quality thresholds (deferred to an eval plan, and a v1.0.0 success criterion depends on them); daily token budget and its reset time; cost target; coverage floor; reply-window length; backoff intervals; how long sign-in stays rate limited after 5 failures; the "mid-range phone connection" profile. Most are openly deferred, which is honest, but the set is not bounded at this gate. | For each, give the number or name the document, milestone and issue that will set it, and mark dependent criteria as not yet testable. |
| R29 | Medium | Glossary Metrics (introduction and rows); NFR-C1, NFR-C3; `vision.md` MVP scope | Metric definitions are inconsistent. The introduction says every metric uses session start time, but no-show rate uses appointment time and order confirmation rate uses order creation time. "Cost per conversation" is computed per session ("÷ 1"), NFR-C3 speaks of a "completed conversation" (undefined), and vision glosses containment as "conversations finished". First-reply time does not say how sessions that never receive a reply are treated. Whether a staff takeover without a prior assistant handover (US-D3 AC1) counts in handover rate is not stated. | Correct the introduction; use "session" consistently or rename; state the treatment of unanswered sessions and staff-initiated takeovers. |
| R30 | Medium | Glossary "Refused-delivery rate"; `vision.md` MVP scope and assumption A3; `risks.md` R-P3; `AGENTS.md` section 1 | The refused-delivery rate is declared not computable, yet remains a success metric of `cod-confirm` in `AGENTS.md` and a supporting metric in vision, and the mitigation of R-P3 and validation of A3 rely on it. The question (Q1) is open at the gate. | Decide before design: add a way to record delivery outcome (staff mark or store event) or remove the metric from the product and state that the pilot measures it outside the product. |
| R31 | Medium | US-D4 AC1; `vision.md` MVP scope; NFR-P2; glossary Metrics | US-D4 shows four metrics. Vision and the glossary define more that the product is said to report: containment rate, time to confirmation, the 95th-percentile cost, and (NFR-P2) reply time "reported on the dashboard". No-show rate appears only in US-D8. No criterion covers choosing the date range that the glossary assumes. | List in US-D4 every metric shown per pack and the range selector, or cut the others from vision and NFR-P2. |
| R32 | Medium | US-C10 AC1, AC2; NFR-V2; NFR-A5 | US-C10 AC2 inspects "logs and traces" but requires redaction only "from logs". Whether traces hold message text and phone numbers is not stated, which decides their treatment under deletion and retention (R7). The fields named in the story (prompt version, model, tokens, cost, latency, guardrail results) are not required by any criterion. | State what a trace may contain and list the required fields in a criterion. |
| R33 | Medium | NFR-R4; NFR-C2; NFR-V4; NFR-M1; `traceability.md`; `risks.md` R-P4, R-A3, R-C3, R-C5 | Functional behaviour lives only in NFR rows with no story, issue or traceability row: provider-failure handling, turn cap and budget handover, daily retention job, and the "trial third pack" (unnamed, in no story although v1.0.0 success depends on it). Several risk mitigations have no requirement behind them: "last updated" dates (R-P4), handover on low confidence (R-A3), provider as a configuration choice (R-C3), storing "appointment and service type only" (R-C5; no story limits what a booking stores, and free-text health details in messages are kept for 12 months regardless). | Give each behaviour a story or an explicit engineering issue with a traceability row; add requirements for the mitigations or reword the risks. |
| R34 | Medium | US-C7; US-C13 AC2, AC3 | Re-consent is undefined. After opt-out, the documents do not say whether the assistant still answers the contact's own later messages, whether a later message or a new order restores consent, or how a contact opts back in. US-C13 AC3 says opt-out overrides "earlier" consent and is silent on later consent. Staff are not told that a reminder was withheld. | Add criteria for replies to an opted-out contact, for opting back in, and for staff visibility of withheld messages. |
| R35 | Medium | US-B3 AC2; US-B4 AC1, AC2; US-O2 AC2; US-D5 AC1, AC2; US-D8 AC1; US-D2 AC1; US-O1 AC1 | Criteria with no stated behaviour when the precondition is false, beyond those in R14: customer declines or ignores the reminder (US-B3); no existing booking, or a past one (US-B4); a "confirm" with no open order or after cancellation (US-O2); export or deletion for a contact with no conversations or already deleted (US-D5); marking a future appointment, or correcting an outcome (US-D8). US-D2 AC1 "afterwards" and US-O1 AC1 "a confirmation is scheduled" give no time. | Add the else-branch to each and state the times. |
| R36 | Medium | Glossary Metrics "Refused-delivery rate", settings "Default language" and "Handover notification method"; `vision.md` MVP scope | Three definitions point to open items Q1, Q4 and F12 "in the requirements review", a document that an independent reviewer is told not to read. The glossary is the authority for the set, yet these entries are provisional and their status cannot be judged from the files under review. | Record open questions in a requirements document that is part of the reviewed set, with an owner and a decision deadline, or resolve them. |
| R37 | Low | US-C2, US-C4, US-C8, US-C9, US-C10, US-D1 to US-D7 ("As a clinic owner"); US-B5 title | Core and dashboard stories are written for "a clinic owner" (P1), although the core is meant to know no niche and store owners (P2) use the same dashboard. | Use "business owner" for core and dashboard stories. |
| R38 | Low | `nfr.md` Reliability | NFR-R7 is listed before NFR-R6. | Reorder or renumber. |
| R39 | Low | US-C1 AC1; US-B2 AC1; US-C6 AC1; US-O3 AC1; US-C11 AC2; US-B5 AC2; US-D2 AC2; US-D7 AC1 | Not singular: several criteria bundle three or more responses or conditions; US-C11 AC2 allows two alternatives ("or answered next"); US-D2 AC2 uses "such as" in place of a list of validation rules. | Split the criteria; list the validation rules. |
| R40 | Low | `vision.md` Problem | The problem statement and the description of existing products are written as fact with no source, while the same document says nothing has been tested with real businesses. Assumptions A1 to A6 do not cover the claims about competitors. | Mark as assumptions or cite sources with the date read. |
| R41 | Low | `vision.md` principles 1 and 2; glossary "Supported language" | "Grounded or silent" describes replying that it does not know, not silence. "No language is special-cased" sits beside a defined set of supported languages (NFR-A4 names four). | Reword the two principles. |
| R42 | Low | `AGENTS.md` section 1 MVP boundaries; `personas.md` P1, P3; US-D1 to US-D9 | `AGENTS.md` fixes the dashboard language as English. No requirements document states this, and P1 ("will not read documentation") and a receptionist fluent in one language may not read English. | State the dashboard language in the requirements and record it as an assumption to validate. |
| R43 | Low | NFR-U1; NFR-U2; NFR-U3; NFR-P4 | "Display correctly", "main screens", "critical violations" and "mid-range phone connection" have no definition. | Name the screens, the checking tool's severity level, the expected rendering and the throttling profile. |
| R44 | Low | Glossary setting "Quiet hours" and "Message batching window"; US-B3, US-O2, US-O4, US-C11 AC1; NFR-P5 | Quiet hours are "used by" three stories that never mention them, and no rule covers a message that would be delayed past the event it concerns. The batching window is stated in both the glossary and NFR-P5 (the values agree today), and US-C11 cites only `nfr.md`. | Reference quiet hours from the stories; add the late-message rule; keep each number in one place. |

## Checklist results

**Each requirement or acceptance criterion is:**

| Item | Result | Findings |
| --- | --- | --- |
| Necessary | Pass, with exceptions. Every story names a persona and maps to a persona goal, a metric or an `AGENTS.md` rule. Exceptions are needs with no story, not stories with no need. | R6, R17, R33 |
| Unambiguous | Fail | R1, R12, R19, R20, R21, R25, R29, R39, R43 |
| Singular | Fail | R27, R39 |
| Verifiable | Fail | R8, R19, R20, R21, R27, R28, R43 |
| Feasible within scope and non-goals | Fail | R4, R6, R10 |
| Clear trigger, precondition and response, including the false precondition | Fail. Given/When/Then form is used throughout; the false branch is often missing. | R14, R35, R6 |

**The set as a whole is:**

| Item | Result | Findings |
| --- | --- | --- |
| Complete | Fail | R2, R3, R4, R5, R6, R7, R9, R13, R14, R15, R16, R17, R18, R22, R23, R24, R26, R27, R34, R35 |
| Consistent | Fail | R1, R3, R10, R11, R12, R20, R25, R29, R30, R31, R41 |
| Bounded | Fail | R18, R28 |
| Defined | Fail | R1, R17 ("open conversation"), R20, R29, R36, R44 |
| Traceable | Fail. All 32 stories have an issue number, a milestone and a traceability row, and the summary table and `traceability.md` agree. The metric half of the item fails. | R8, R30, R33 |
| Honest | Pass, with one Low exception. Personas, defaults, NFR targets and risk scores are all stated as unmeasured or invented; the refused-delivery limitation is disclosed. | R40 |

## Scenario walkthroughs

**1. A new business signs up and receives its first customer message.**
1. Owner account is created: not covered (R9).
2. Setup with name, time zone, default language, currency, pack: US-D6 AC1. Notification address and other settings not collected (R18); one pack or two unclear (R18).
3. Channel credentials verified and stored: US-D6 AC2, NFR-S5.
4. Business data entered: US-D2. Service duration missing (R14). Templates: not covered (R4). Store webhook secret: not covered (R9).
5. "Setup complete" is not defined; incomplete setup: US-D6 AC3. Message to an unmapped number: not covered (R25).
6. Inbound message received once: US-C1, NFR-P1, NFR-R1, NFR-R2. Tenant resolved: US-C2. Consent recorded: US-C13 AC2.
7. Batching: US-C11, NFR-P5. Language: US-C3. Disclosure: US-C5 AC1 (scope unclear, R23).
8. Grounded answer or "do not know": US-C4, US-B1; trace: US-C10. Offer of a person in M3 before handover exists (R10).
9. Metrics: first-reply time computable; inquiry classification not covered (R8).

**2. A customer books, is reminded, reschedules, and does not attend.**
1. Asks and books: US-B1, US-B2, US-B5. No free slots, capacity, horizon, limits: not covered (R14).
2. Reminder due 24 hours before: glossary setting, US-B3 AC1, US-C9 AC2. Needs a template (R4); language rule from the glossary; quiet hours from the glossary only (R44); may bypass opt-out and quiet hours inside the window (R1).
3. Customer replies to the reminder: confirm is US-B3 AC2; reschedule or cancel from the reminder and no reply are not covered (R13).
4. Reschedule: US-B4 AC1. Which booking, slot taken meanwhile, cut-off: not covered (R14). Second reminder and confirmed status: not covered (R13).
5. Does not attend: US-D8 AC1, glossary "No-show rate". Staff view of appointments not covered (R15); correcting an outcome not covered (R35).
6. Metric: no-show rate computable from US-D8; date basis conflicts with the glossary introduction (R29).

**3. A store order is confirmed, then the address is changed, then cancelled.**
1. Store webhook: US-O1, NFR-S2. Payload, validation and consent undefined (R5); secret provisioning not covered (R9).
2. Confirmation sent: US-O2 AC1, US-C9 AC2, glossary quiet hours. Template (R4); language conflict (R11); suppressed or failed send has no outcome (R5, R26).
3. Customer confirms: US-O2 AC2. Late reply and several open orders not covered (R12).
4. Address changed: US-O3 AC1. "Unshipped" cannot be known (R6); resulting state unclear (R12); not flagged though P2 expects it (R12).
5. Cancelled: US-O3 AC2. Same precondition problem (R6); metric treatment of confirmed-then-cancelled undefined (R12).
6. Owner or store learns the outcome: not covered (R6).

**4. A customer who opted out is due a reminder.**
1. Opt-out recorded, one confirmation: US-C7 AC1. Non-supported languages and no deterministic route (R19).
2. Reminder falls due: not sent and logged per US-C7 AC2, US-B3 AC3, US-C13 AC3, NFR-V1. But by the glossary definition a reminder inside the reply window is not business-initiated, so the block does not apply (R1).
3. Staff told the reminder was withheld: not covered (R34, R5).
4. The booking itself: unchanged; nothing stated.
5. Customer writes again later or wants reminders back: not covered (R34).
6. Contact is later deleted: opt-out record fate undefined (R7).

**5. Two customers ask for the same slot at the same moment.**
1. Both are offered the slot: US-B2 AC1, US-B5 AC2 (no hold between offer and choice, which is consistent with AC2).
2. Both choose it: US-B2 AC2, NFR-R3, R-T5: one booking, the other is offered other slots.
3. Capacity above one per slot (two chairs): not defined (R14).
4. No other slots left for the loser: not covered (R14).
5. One of the two is a reschedule (US-B4) or a manual booking (US-D9 AC2): reschedule race not covered (R14); manual overlap refused by US-D9 AC2.
6. Reply ordering per conversation: US-C11 AC3, NFR-R7.

**6. A customer sends a voice note, then three short texts, then asks for a person at 03:00.**
1. Voice note: US-C12 AC1, AC2; glossary "Unsupported message type". Whether this reply carries the disclosure (R23).
2. Three texts: US-C11 AC1, NFR-P5 (3 s after the latest, 10 s cap). Voice note and texts in one window: not covered (R24).
3. Reply: US-C3, US-C4, NFR-P2.
4. Asks for a person: US-C6 AC1. Request mixed into a batch with a question: not covered (R24).
5. Staff notified: US-C14 AC1, glossary notification method (email dependency and address, R18; open item Q4, R36).
6. 03:15, nobody answers: US-C14 AC2, one escalation and one holding message. Out-of-hours behaviour, meaning of escalation, anything after it: not covered (R2).
7. Customer writes again: assistant silent, US-C14 AC3, with no end (R2).

**7. The model provider is down for ten minutes.**
1. Inbound messages still received and acknowledged: US-C1, NFR-P1, NFR-R1.
2. Model call fails: trace stored, US-C10 AC1; 3 retries with backoff, NFR-R4. Backoff values and total time not given (R3, R28).
3. Fallback sent: glossary "Fallback message"; content and languages undefined (R22).
4. Conversation handed over: NFR-R4, conflicting with US-C6 AC2 (R3). Each handover notifies staff, US-C14 AC1; no throttling (R3).
5. Messages arriving during retries: US-C11 AC2 only in general terms (R3).
6. Provider recovers: nothing returns conversations to the assistant (R2, R3).
7. Reminders and confirmations due during the outage: whether they need the model is not stated (R3). Job exhaustion: NFR-R5, retry count and alert recipient undefined (R26).

**8. A customer writes instructions aimed at the assistant itself.**
1. Message received and treated as data: US-C8 AC1, NFR-A1, R-A2.
2. What the assistant replies: not defined (R27).
3. Asks for another tenant's data: US-C2 AC2, NFR-S1.
4. Asks for an invented discount: US-C4 AC3 guardrail, then fallback (R22).
5. Repeats the attempt: US-C6 AC2 (ambiguous, R21); turn cap of 30 then handover, NFR-C2; no rate limit or notification throttle (R27).
6. Same text arriving through an order's address field: not covered (R27).

**9. Staff remove a colleague's access while that colleague has a conversation open.**
1. Owner removes the user: US-D7 AC2, sessions end and sign-in is refused. No time bound (R16).
2. Colleague's reply in flight: not covered (R16).
3. The taken-over conversation: remains in handover per the glossary; no owner concept, no return to the waiting list (R16, R2).
4. Escalation: US-C14 AC2 applies only if there was no staff reply (R16).
5. Customer writes again: assistant silent, US-C14 AC3 (R2).
6. Audit of the removal and of who sent which staff message: not required by any criterion.

**10. A customer asks for all their data to be deleted while they have a future booking.**
1. Customer asks in chat: no criterion; possibly a "sensitive topic" under US-C6 AC3, which depends on an unwritten policy (R7, R21).
2. Owner performs deletion: US-D5 AC2, US-D7 AC1 (owner only), NFR-V3. Time bound missing; "deleted or anonymised" undecided (R7).
3. Future booking and its slot: not covered (R7).
4. Scheduled reminder: with the contact gone there is no consent, so US-C13 AC1 would withhold it, but this is by accident, not stated (R7).
5. Opt-out and consent records, traces, audit log, open orders: not covered (R7, R32).
6. Customer messages again afterwards: becomes a new contact; disclosure and consent start again by implication only (R23).
7. Metrics for past periods after deletion: not stated (R7).

## Not checked

- `docs/requirements/review-2026-11-16.md`, although it sits under `docs/requirements/` and the glossary and vision point to it for open items Q1, Q4 and F12. Excluded by instruction; the content and status of those items could not be judged (R36).
- Whether issues #10 to #32 and #46 to #55 exist, match the stories, and carry the stated milestones: no network access and issues were excluded. Only the consistency of the numbers between `user-stories.md` and `traceability.md` was checked; they agree.
- Milestone definitions and exit criteria (`AGENTS.md` section 9) and all other `AGENTS.md` sections: outside the files allowed. The milestone conflict in R10 is judged only from the story order and dependencies.
- Documents the requirements defer to but which were not in scope or may not exist yet: the guardrail policy, `docs/ai/eval-plan.md`, `docs/compliance.md`, `docs/test-plan.md`, the load-test report. Criteria that depend on them are reported as unbounded (R21, R28), not assessed.
- Any statement about the real channel's rules (reply-window length, template approval, what a template may contain, pricing) and about data-protection law in Saudi Arabia: not verifiable without sources, and the documents rightly do not assert details. Feasibility of an itemised order confirmation as a template is therefore "cannot judge".
- Whether the EARS and ISO/IEC/IEEE 29148 standards were read in current form and the link and date recorded, as `AGENTS.md` section 11 requires: no such record appears in the files reviewed; it may be in a file outside scope.
- Git history, pull requests, status log and retros: excluded by instruction, so nothing is said about how the documents were produced.

---

# Author's response

Everything above this line is the reviewer's report, committed unedited in
`dc9fedf`. Everything below is written by the authoring agent.

Date: 2026-11-16 · Issue #58

## Outcome

**All 44 findings are accepted; none is rejected.** I checked each against the
documents and found no finding that misreads them. Gate 1 is **not passed**:
nine High findings are open, and no requirement has been changed yet.

This review found far more than my own review earlier the same day (12
findings), including a contradiction my review introduced: R1, where the
glossary definition I wrote would let a reminder reach a customer who had
just opted out. That is the argument for independent review.

Fixes are not in this pull request, for two reasons. Several High findings
need the maintainer's decision first, and the fixes interact, so writing them
once after the decisions avoids rewriting the same criteria twice. The fixes
are tracked in #61.

## Notes on the review itself

- The reviewer reported that after it finished writing, its environment
  placed the full text of `AGENTS.md` in its context, and that it did not
  revise the report afterwards. Its findings cite only sections 1 and 11.
- The reviewer could not confirm that EARS and ISO/IEC/IEEE 29148 were read
  from their current published form. They were not. `AGENTS.md` section 11
  requires this before a standard is first applied; it is added to #61.
- Excluding my own review document made three glossary entries unjudgeable
  (R36). Open questions now move into the reviewed set.

## Decisions needed from the maintainer

Each has a recommendation. D1 to D3 change scope or depend on outside facts,
so they wait for an answer. For D4 to D8 the recommendation will be applied
in #61 unless the maintainer says otherwise.

| ID | Findings | Decision | Recommendation |
| --- | --- | --- | --- |
| D1 | R6, R30, R12 | How does the cash-on-delivery result reach the owner, and how does the product learn an order shipped or was refused? | A dashboard order list with status and export, plus staff marks for shipped, delivered and refused. A store event for outcomes can follow later. This replaces the earlier question Q1. |
| D2 | R9 | How are owner accounts created? | Invitation only in the MVP: an operator creates the tenant and invites the owner by email. No open sign-up, which removes a class of abuse. |
| D3 | R4, R11 | Which languages must business-initiated messages support at launch, given templates need approval? | Cannot be decided until the channel's current template rules are verified in #37. Interim: tenant default language only. |
| D4 | R2, R3 | When does a handover end? | When staff hand back, or automatically when a new session starts. Add business hours and an out-of-hours message. A provider outage puts the tenant in a degraded state with one notification, not one handover per conversation. |
| D5 | R7, R32 | What does deletion do? | Delete messages and personal fields; cancel future bookings and free their slots; cancel open orders' pending messages; keep only a hashed suppression record so an opt-out survives deletion; traces hold no message text or phone number. Needs a lawyer's view before a pilot. |
| D6 | R14 | What is booking capacity? | A whole-number capacity per service and time slot, default 1. No staff or room scheduling in the MVP. |
| D7 | R18 | One pack per tenant, or both? | Exactly one pack per tenant in the MVP. |
| D8 | R17, R42 | Is conversation history translated for staff, and what language is the dashboard in? | No translation in the MVP; dashboard in English. Record both as assumptions to validate, and correct persona P3. |

## Scope warning

Fixing these findings properly adds an estimated 8 to 10 stories to the 32
that exist, on top of the 9 added earlier today. That estimate is mine and is
rough. The maintainer should decide whether the MVP still holds two packs, or
whether v1.0.0 ships the core, the dashboard and the `booking` pack, with
`cod-confirm` following as v1.1. Two of the nine High findings (R5, R6)
concern only `cod-confirm`, and R4 weighs most heavily on it.

## Response to each finding

"Decision" means the fix waits for the decision named. "Direct" means the fix
needs no decision and will be made in #61.

| ID | Severity | Response | Fix |
| --- | --- | --- | --- |
| R1 | High | Accepted. The definition I wrote is wrong and contradicts US-B3 and NFR-V1. | Direct: define by who starts the exchange; the window decides only free-form versus template. |
| R2 | High | Accepted. | Decision D4. |
| R3 | High | Accepted. Provider outage is also missing from the risk register. | Decision D4; new story; new risk. |
| R4 | High | Accepted. | Decision D3; new story for template provisioning; a due message that is not sent is logged and flagged. |
| R5 | High | Accepted. | Direct: specify the `order.created` payload and validation; flag any order whose confirmation is suppressed or fails. |
| R6 | High | Accepted. Persona P2's main need had no story. | Decision D1. |
| R7 | High | Accepted. | Decision D5; add a criterion for a deletion request made in chat. |
| R8 | High | Accepted. I defined the metric in the glossary and gave no story the job of producing its data. | Direct: criteria for classifying and storing inquiry and task completion, with eval cases; add containment to US-D4. |
| R9 | High | Accepted. | Decision D2; criteria for invitation, recovery, session lifetime and webhook secret provisioning. |
| R10 | Medium | Accepted. | Direct: re-sequence milestones or split the affected criteria by milestone. |
| R11 | Medium | Accepted. | Decision D3. |
| R12 | Medium | Accepted. | Decision D1; add an order state model. |
| R13 | Medium | Accepted. | Direct: reminder lifecycle on reschedule, cancel and each reply including none. |
| R14 | Medium | Accepted. | Decision D6; add the false branches, booking horizon, per-contact limit and service duration. |
| R15 | Medium | Accepted. | Direct: staff booking list, cancel and move; conflicts with existing bookings; staff-recorded consent. |
| R16 | Medium | Accepted. | Direct: conversations return to the waiting list; time bound; last owner cannot be removed. |
| R17 | Medium | Accepted. | Direct for takeover cases; decision D8 for translation. |
| R18 | Medium | Accepted. | Decision D7; new settings story with allowed ranges; collect the notification address at setup. |
| R19 | Medium | Accepted. | Direct: "any supported language"; add a deterministic opt-out route that does not depend on the model. |
| R20 | Medium | Accepted. | Direct: one list of grounded fact types everywhere; a match rule for numbers, dates and translated text. |
| R21 | Medium | Accepted. | Direct: define the failure counter; the topic list is written with the guardrail policy (#44), and the criterion is marked not yet testable until then. |
| R22 | Medium | Accepted. | Direct: fallback message content, languages and its own fallback. |
| R23 | Medium | Accepted. | Direct: disclosure per session and on every kind of first outbound message. |
| R24 | Medium | Accepted. | Direct: mixed batches and the unsupported-message counter. |
| R25 | Medium | Accepted. | Direct: define retry versus replay with a number; one response per case; unknown-number case. |
| R26 | Medium | Accepted. | Direct: send-failure criteria with retry numbers; define "sent". |
| R27 | Medium | Accepted. | Direct: split US-C8 AC1; cover all untrusted text; per-contact rate limit and notification throttling. |
| R28 | Medium | Accepted in part. Some values cannot honestly be set before code or a dataset exists. | Direct: give the number where one can be given; otherwise name the document, milestone and issue that sets it, and mark dependent criteria not yet testable. |
| R29 | Medium | Accepted. | Direct: correct the glossary introduction and use "session" consistently. |
| R30 | Medium | Accepted. | Decision D1. |
| R31 | Medium | Accepted. | Direct: list every metric and the date-range selector in US-D4. |
| R32 | Medium | Accepted. | Decision D5; list the required trace fields in a criterion. |
| R33 | Medium | Accepted. | Direct: give each NFR-only behaviour a story or an engineering issue with a traceability row; back each risk mitigation with a requirement or reword the risk. |
| R34 | Medium | Accepted. | Direct: replies to an opted-out contact, opting back in, staff visibility of withheld messages. |
| R35 | Medium | Accepted. | Direct: add the else-branch and the times to each criterion listed. |
| R36 | Medium | Accepted. | Direct: move open questions into `docs/requirements/open-questions.md`, inside the reviewed set, with an owner for each. |
| R37 | Low | Accepted. | Direct: "business owner" for core and dashboard stories. |
| R38 | Low | Accepted. | Direct: reorder. |
| R39 | Low | Accepted. | Direct: split the bundled criteria; list validation rules. |
| R40 | Low | Accepted. | Direct: mark the problem statement and competitor description as assumptions. |
| R41 | Low | Accepted. | Direct: reword the two principles. |
| R42 | Low | Accepted. | Decision D8. |
| R43 | Low | Accepted. | Direct: name the screens, tool severity level and throttling profile. |
| R44 | Low | Accepted. | Direct: reference quiet hours from the stories; add the late-message rule; keep each number in one place. |

## What happens next

1. The maintainer answers D1 to D3 and the scope question, and objects to any
   of D4 to D8 they disagree with.
2. #37 (verifying the channel's rules from official sources) proceeds now. It
   is research, not design, and D3 depends on it.
3. #61 applies the fixes to the requirements and to the story issues.
4. A second independent review checks the fixed set. Gate 1 passes only when
   that review has no open High finding.
5. The remaining M1 design issues (#38 to #44) stay blocked until then.
