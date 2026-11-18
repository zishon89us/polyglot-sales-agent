# Channel rules and data-protection obligations

Status: draft for maintainer review · Issue #37 · Covers NFR-L1 and NFR-L2

**This is engineering guidance, not legal advice.** It records what the
official sources say, as read on the date shown, and what that means for the
design. A lawyer must review the data-protection part before any real
customer data is processed.

## How this was read

All sources were read on **2026-11-16**. Only official publishers were used:
Meta (`developers.facebook.com`, `business.whatsapp.com`, `whatsapp.com`) and
the Saudi Data and AI Authority (`sdaia.gov.sa`, `dgp.sdaia.gov.sa`).

One page was fetched and read in full (S3). The others were read as extracts
returned by a web search restricted to those domains, not as complete pages.
Extracts can omit qualifications, so every statement below should be
re-checked against the full page before it is built on. Two pages could not
be opened at all and are listed under "Not verified".

Each statement carries a source tag (S1 to S26) that maps to the list at the
end. Statements tagged **Inference** are my reading of how a rule applies to
this product, not something a source says.

## Findings that change the plan

These seven matter most, in my judgment. Each contradicts or strains something already in the
requirements.

| # | Finding | Source | What it changes |
| --- | --- | --- | --- |
| 1 | **Every reply now costs a channel fee.** Since 1 October 2026 Meta charges per message for non-template (service) messages, at the same per-market rate as utility messages. Each business number gets 1,000 free service messages a month. Utility templates sent inside the reply window are charged too. | S1, S2 | Assumption A5 and risk R-P6 were written as if replies were free. Cost per conversation must include a channel fee for each assistant message. Message batching (US-C11) and folding the disclosure into the first answer now save money, not only improve the experience. |
| 2 | **Meta now sells its own AI agent for WhatsApp.** Meta Business Agent answers from a business's own knowledge, takes actions such as booking an appointment through connected APIs, and hands off to people. It is priced per token, which Meta estimates at about 4 to 5 US cents a message. | S1, S2, S4, S26 | A first-party competitor to this product's core, absent from the vision and the risk register. It also offers a thread-control API for handover that the design should evaluate. |
| 3 | **Meta's terms restrict "AI Providers".** Providers of AI technologies may not use the platform to offer those technologies when they are the primary functionality, as Meta determines at its sole discretion. A business may retain an AI Provider as its Solution Provider. | S6 | **Inference:** a business answering its own customers with an assistant is a customer-service use, where AI is ancillary, and is the pattern Meta's own policy describes. But the decision is Meta's alone. This needs confirming with Meta or a lawyer before a pilot. |
| 4 | **Chat data may not train AI models.** Platform data, including anonymous, aggregate or derived forms, may not be used to create, develop, train or improve AI models, except to fine-tune a model for the business's exclusive use. | S6 | The model provider must be contractually barred from training on prompts. Real conversations must never enter eval datasets or prompts as examples. This strengthens rules already in `AGENTS.md`. |
| 5 | **Templates are per language, and nothing falls back.** A template is created with one language code; Meta does not translate; the same name in another language is a separate template that is reviewed separately and counts against the account's limit. Sending names one exact language code. | S7, S8, S9 | Confirms finding F12 and review finding R4. "Language-agnostic" cannot apply to reminders, order confirmations or follow-ups. Answers decision D3 below. |
| 6 | **A new account can start conversations with only 250 people a day.** New business portfolios may deliver template messages to 250 unique users per moving 24 hours outside reply windows, rising to 2,000 after business verification or sustained good-quality sending. The limit is shared across all numbers in a portfolio. | S10 | A store with more than 250 cash-on-delivery orders a day cannot confirm them all until its limit rises. Reminders count against the same limit. Needs a requirement for hitting the limit, and affects whose Meta account each tenant uses. |
| 7 | **Message order is not guaranteed.** Meta does not guarantee delivery order; to enforce a sequence, wait for the `delivered` status before sending the next message. An accepted API call does not mean the message was delivered. | S3 | NFR-R7 (replies in order) cannot be met by sending in order alone. Supports review finding R26: "sent" must be defined, and delivery status must be tracked. |

## Part A — WhatsApp Business Platform rules

### Reply window and who may start a conversation

| Rule | Source |
| --- | --- |
| A 24-hour customer service window starts when a user messages or calls the business. Each new user message or call resets it to 24 hours. | S3 |
| Inside the window the business may send non-template messages. Outside it, only approved template messages. | S3, S11 |
| A business may only initiate a conversation with an approved template, used for its designated purpose. Meta may review, approve, pause or reject any template at any time. | S11 |
| Messages sent from the WhatsApp Business phone app are outside these window rules and do not affect them. | S12 |

Design effect: the window length is 24 hours (this value was missing; review
finding R28). The channel adapter must track the window per contact from the
last inbound message or call.

### Consent and opt-out

| Rule | Source |
| --- | --- |
| A business may contact a person only if the person gave their phone number and the business has received opt-in permission confirming they wish to receive messages from it. | S11, S13 |
| The opt-in must state clearly that the person is opting in to receive communication from the business, and must name the business. It need not be specific to WhatsApp, provided local law is met. | S13 |
| The business alone is responsible for choosing the opt-in method and for its legality. Website, SMS, phone and in-person or paper are given as examples. | S13 |
| The business must honour every user request to stop or opt out of some or all message types. | S14 |
| Users can block or report a business. Poor quality over time leads to rate limiting. | S3, S13 |

Design effect: supports US-C13 and US-C7. Consent "arriving with an order"
(review finding R5) is acceptable only if the store's checkout showed wording
that names the business and the purpose; the `order.created` payload must
carry the consent wording version and time, and the product must refuse to
message without it.

### Automation and handover

| Rule | Source |
| --- | --- |
| Automation may be used when replying inside the window, but the business must have prompt, clear and direct escalation paths. | S11 |
| The paths named are: in-chat transfer to a human agent, phone number, email, web support, in-store visits, or a support form. | S11 |
| The business profile must show customer-support contact information and at least one of email, website or phone number, kept accurate. | S11 |

Design effect: handover is a policy requirement, not only a product choice.
An out-of-hours handover (review finding R2) can meet the rule by giving a
phone number or email when no person is available, since the listed paths are
alternatives. Tenant setup (US-D6) must collect a support contact.

### Templates

| Rule | Source |
| --- | --- |
| Each template has a category: marketing, utility or authentication. | S7, S15 |
| Utility requires both: no promotional or persuasive content, and either specific to or requested by the user (their order, account, service or transaction) or essential to them. | S15 |
| Mixed content, such as an order update with a promotion, is marketing. So is a template whose content is unclear, such as one that is only a variable. | S15 |
| Order confirmation, update and cancellation messages with specific order details are given as utility examples. | S15 |
| Meta may move a template approved as utility to marketing, with one day's notice. | S15 |
| Templates are reviewed automatically on creation and after editing. Only `APPROVED` templates can be sent. | S7 |
| A template can be paused for repeated negative feedback or low read rates, and disabled permanently after repeated pauses. | S7, S16 |
| An approved template can be edited once in 24 hours and ten times in 30 days. | S9 |
| An unverified business portfolio is limited to 250 templates per account; each language version counts. | S7 |
| Supported template languages include Arabic, English, Urdu and Hindi, among many others. | S8 |
| Templates may carry quick-reply buttons with a payload returned to the business. | S17 |

Design effect:

- **Inference:** an appointment reminder with the customer's own date and time
  fits the utility definition (specific to the user's service). Meta's
  examples include a reservation confirmation as utility but not a reminder
  specifically, so this must be confirmed by submitting one for review.
- Templates must contain no promotional wording at all, or they are priced
  and treated as marketing.
- A template that is only variables would be judged "unclear". Fixed wording
  must carry the meaning, with variables for the details.
- Confirm, change and cancel can be quick-reply buttons on the template,
  which gives a deterministic reply that does not depend on the model
  (relevant to review finding R19).
- The product must listen for template status changes and stop scheduling a
  message whose template is paused, rejected or recategorised, flagging it to
  staff (review findings R4 and R5).

### Pricing

| Rule | Source |
| --- | --- |
| Meta charges per delivered message, by category and by the recipient's country code. User-to-business messages are free. | S1 |
| Since 1 October 2026, service messages are charged per message at the utility and authentication rate for the market, with no volume tiers. | S1, S2 |
| Each business phone number has 1,000 free service messages a month; the count resets monthly and does not roll over. | S1 |
| Utility messages sent inside an open window, free from 1 July 2025, are charged again from 1 October 2026. | S1, S2 |
| When a user arrives through a click-to-WhatsApp advert and the business replies within 24 hours, a 72-hour free entry point window opens in which marketing, utility, authentication and service messages are not charged. | S1 |
| Meta may update rates up to quarterly. | S2 |

No rate for Saudi Arabia was read. The only figure seen was Meta's own
example of 0.68 US cents per utility message to Brazil. **The rate card for
the target market must be read before any pricing or cost target is set**
(NFR-C3).

Design effect: with a 1,000-message free tier, a tenant sending three
assistant messages per conversation passes the free tier at about 330
conversations a month. That arithmetic is mine; it assumes three replies per
conversation, which is unmeasured.

### Webhooks and delivery

| Rule | Source |
| --- | --- |
| If the endpoint does not return HTTP 200, Meta retries with decreasing frequency for up to 7 days. Retries can produce duplicate notifications. | S5 |
| Payloads can be up to 3 MB. | S5 |
| A successful send call means the request was accepted, not delivered. Delivery status arrives by webhook. | S3 |
| Non-authentication messages have a default time-to-live of 30 days. If no `delivered` status arrives before it expires, assume the message was dropped. | S3 |
| Delivery order is not guaranteed. | S3 |
| Interactive reply buttons allow up to three predefined replies. List messages, location requests and address requests are also available as service messages. | S3 |
| Policy violations lead to template sending blocks of 1 or 3 days, full sending blocks of 5, 7 or 30 days, an account lock, and finally permanent disabling. An `account_update` webhook reports them. | S16 |

Design effect: there is no difference in Meta's behaviour between a "retry"
and a "replay"; a redelivered webhook is byte-identical. Review finding R25 is
resolved by deduplicating on message ID and always returning 200 for a validly
signed duplicate. Signature verification rejects forged requests; it does not
reject replays, and no timestamp tolerance is documented.

## Part B — Saudi Arabia, Personal Data Protection Law

Read from the English texts published by SDAIA. These are translations; the
Arabic texts were not read.

| Point | Source |
| --- | --- |
| The law applies to processing of personal data of individuals that takes place in the Kingdom, and to processing of personal data of individuals residing in the Kingdom by any party outside it. | S18 |
| Consent may be obtained in any appropriate form, including written, verbal or electronic. It must be given freely, not through misleading methods, and the purposes must be clear, specific and explained before or when consent is requested. | S19 |
| Where consent is the basis for processing sensitive data, it must be explicit. | S20 |
| At collection, the person must be told, among other things, who collects the data, to whom it will be disclosed, and whether it will be transferred, disclosed or processed outside the Kingdom. | S18 |
| Personal data may be transferred outside the Kingdom for listed purposes, which include performing an obligation to which the data subject is a party, and others set by regulation, such as providing a service or benefit to the data subject. | S18, S21 |
| Conditions on a transfer: no prejudice to national security or the Kingdom's vital interests; an adequate level of protection at the destination; and only the minimum data needed. | S18 |
| Without an adequate level of protection, the controller may rely on appropriate safeguards: standard contractual clauses in SDAIA's model form, binding common rules, or a certificate of accreditation. | S21, S22 |
| A risk assessment is required before transfers that rely on those safeguards, and for continuous or large-scale transfer of sensitive data. | S21 |
| The controller must keep records of processing activities, including data categories, retention periods, recipients and any transfers outside the Kingdom with their legal basis. | S19 |
| Anonymised data is no longer personal data. | S19 |

Design effect (all **Inference**; each needs a lawyer's confirmation):

- Each tenant is likely the controller of its customers' data, the product's
  operator a processor, and the model provider and the hosting provider
  further processors. The contracts between them matter as much as the code.
- Sending message text to a model provider outside Saudi Arabia, or hosting
  outside it, is a transfer outside the Kingdom. It needs a permitted
  purpose, minimisation and either an adequacy decision or standard
  contractual clauses. This makes the **hosting region and the model
  provider's processing location** design decisions with legal weight
  (issue #7), and supports keeping the provider a configuration choice
  (risk R-C3).
- Minimisation argues for sending the model only the text needed to answer,
  not phone numbers or names.
- The privacy notice a tenant shows its customers must say that an automated
  assistant processes their messages and whether data leaves the Kingdom. The
  product should supply tenants with the facts needed to write it.
- The records the law requires map directly onto the data model: categories,
  retention periods, recipients. `docs/design/data-model.md` should be
  written so that it can serve as that record.
- A clinic's appointment and service type may be health data and so
  sensitive, requiring explicit consent (risk R-C5). The definition of
  sensitive data was not read; see "Not verified".

## What this means for the open decisions

| Decision | Position after this research |
| --- | --- |
| **D3** Languages for business-initiated messages at launch | Each language is a separate template needing separate approval, so the set must be small and fixed. **Recommendation:** every pack ships its templates in Arabic and English; a tenant enables one or both and names one as default. The first message to a contact uses the contact's last known language if a template exists in it, otherwise the tenant default. Further languages are added per tenant on request. The assistant's free-form replies inside the window remain in whatever language the customer writes. |
| **Q3** Should the order webhook carry a language? | Yes, as an optional field, used only to choose between the tenant's enabled template languages. |
| **D1** Order outcomes | Unchanged. Meta's order-management examples support sending confirmation and update messages as utility templates. |
| **D2** Owner accounts | Raises a new question below: whose Meta account does a tenant use? |
| **Q5** Quiet hours | No channel rule requires them. They remain a product choice. |

## New questions for the maintainer

1. **Whose Meta account does each tenant use?** If each tenant brings its own
   WhatsApp Business account, each has its own limits, templates, billing and
   policy standing, but must do Meta's setup, which persona P1 will not. The
   alternative is for the product's operator to become a Meta Tech Provider
   and onboard tenants through Embedded Signup, which requires Meta's App
   Review and Advanced access to manage accounts the operator does not own
   (S23). **Recommendation:** tenant-owned accounts with a guided setup for
   the MVP and pilot; Tech Provider status is a business step for after a
   pilot.
2. **Does Meta Business Agent change the plan?** Three honest options: build
   on it (the product becomes configuration, evaluation and a dashboard on
   top of Meta's agent); compete with it on control, grounding guarantees,
   multi-channel reach and data location; or treat this repository purely as
   a portfolio piece, where the competitor does not matter. The answer shapes
   M1.
3. **Confirm the AI Providers reading** (finding 3) with Meta or a lawyer
   before a pilot.

## Changes this requires elsewhere

Tracked in #61 unless noted.

- `vision.md`: add Meta Business Agent to the description of existing
  products; revise assumption A5 for per-message service fees.
- `risks.md`: add risks for the first-party competitor, the AI Providers
  clause, the 250-recipient limit, template pausing and recategorisation, and
  account enforcement; re-score R-P6.
- `nfr.md`: set the reply-window length to 24 hours; restate NFR-R7 in terms
  of delivery status; make NFR-C1 and NFR-C3 include channel fees; add a
  requirement that no conversation data is used to train or evaluate models.
- `user-stories.md`: template provisioning per language and status handling;
  behaviour at the messaging limit; a support contact at tenant setup; consent
  wording carried in `order.created`; delivery-status tracking.
- `glossary.md`: define "sent", "delivered" and "dropped".
- ADRs in #38: hosting region and model-provider location as decisions with
  legal weight; whether to use Meta's thread-control API for handover.

## Re-read on 2026-11-18, for the channel code

Made while writing the webhook fixtures of M2 unit U6. What was read, and
how, is listed in `packages/channel-whatsapp/fixtures/2026-11-18/README.md`.

| Finding | What it changes |
| --- | --- |
| **A customer may have no phone number in a webhook.** Since early April 2026 every messages webhook carries a business-scoped user ID, and a customer who uses a username arrives without `from` and `wa_id`, unless the business and the customer were in touch through that number in the last 30 days or the customer is in the business's contact book. A business can send to the identifier in place of the number. | The design identifies a customer by number throughout. Issue #284; to be decided before a contact is stored. |
| A webhook payload can be up to 3 MB. | The webhook's size limit is 3 MiB (`docs/design/api.md`, section 8). |
| A webhook that is not answered 200 is sent again with decreasing frequency for up to 7 days, and this can cause duplicates. | Confirms threat-model assumption A7 (c) as to redelivery; the page does not say the identifier is the same, though deduplicating by it is Meta's own advice elsewhere. |
| The signature header is `X-Hub-Signature-256`, `sha256=` and a SHA-256 signature made with the app secret. | Agrees with A7 (a) and (b). Read as a search extract, not in full. |

## Not verified

- **The WhatsApp Business Messaging Policy was not read in full.** Its page
  redirected to another domain and was not followed. Sections on regulated
  verticals, health-related messaging, and data use were read only as short
  extracts. Whether the policy restricts health-related businesses such as
  clinics, beyond a rule that regulated-vertical messaging may not go to
  under-18s, is **not known**.
- **The template categorisation page was read as extracts only**, not in
  full.
- **Webhook signature scheme.** Meta documents an `X-Hub-Signature-256`
  header (HMAC-SHA256 of the payload with the app secret) for its webhooks on
  the Messenger, Instagram and WhatsApp Flows pages (S24). The extract of the
  WhatsApp webhooks overview did not show it. Assumed to apply; confirm on
  the WhatsApp page.
- **Message-type names in inbound webhooks**, and how unsupported types are
  reported. A changelog entry says the unsupported-message webhook now names
  the actual type (S25); the payload was not read.
- **Per-market rates**, including Saudi Arabia.
- **PDPL details not read:** the definition of sensitive data and whether it
  includes health data; breach-notification duties and deadlines; data-subject
  rights and response deadlines; rules on processors and sub-processors;
  penalties; whether registration in the National Register of Controllers
  applies; which countries have an adequacy decision.
- **Which transfer regulation is in force.** Two English versions of the
  Regulation on Personal Data Transfer outside the Kingdom were found on
  SDAIA sites, with different article numbering (S21, S22). The version on
  the Data Governance Platform appears to be the later one. Confirm.
- **Other target markets.** Only Saudi Arabia was researched. Tenants or
  customers elsewhere (for example the UAE or Pakistan) bring other laws.
- **Standards.** EARS and ISO/IEC/IEEE 29148, named in `AGENTS.md` section
  11, have still not been read from source.

## Questions for a lawyer

1. Is the tenant the controller and the product's operator a processor, and
   what must the contract between them contain?
2. Is sending customer message text to a model provider outside Saudi Arabia
   a permitted transfer, on what basis, and are standard contractual clauses
   required?
3. Does a clinic's appointment and service type count as sensitive data, and
   what consent wording is then needed?
4. What must the customer be told, and when, about automated processing of
   their messages?
5. Can an opt-out be kept as a hashed suppression record after the person
   asks for deletion (decision D5)?
6. What retention period is defensible for conversations, and for audit logs?
7. Does the operator or the tenant need to register with SDAIA?
8. Does Meta's AI Providers clause reach a product like this one?

## Sources

All read 2026-11-16. "Extract" means read as a search extract, not in full.

| Tag | Source | How read |
| --- | --- | --- |
| S1 | [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) | Extract |
| S2 | [Pricing updates for Meta Business Agent, service and utility messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) | Extract |
| S3 | [Service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) | Full page, summarised by the fetch tool |
| S4 | [Meta Business Agent Platform overview](https://developers.facebook.com/documentation/meta-business-agent/overview) | Extract |
| S5 | [WhatsApp webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/) | Extract |
| S6 | [WhatsApp Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms) | Extract |
| S7 | [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) | Extract |
| S8 | [Supported languages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages) | Extract |
| S9 | [Template management](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management/) | Extract |
| S10 | [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) | Extract |
| S11 | [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) | Extract |
| S12 | [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/) | Extract |
| S13 | [Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in) | Extract |
| S14 | [WhatsApp Terms for WhatsApp Business Platform](https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-Platform) | Extract |
| S15 | [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) | Extract |
| S16 | [Policy and spam enforcement](https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement) and [error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) | Extract |
| S17 | [Messages reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/) | Extract |
| S18 | [Personal Data Protection Law, English text (SDAIA)](https://sdaia.gov.sa/en/SDAIA/about/Documents/Personal%20Data%20English%20V2-23April2023-%20Reviewed-.pdf) | Extract |
| S19 | [Implementing Regulation of the Personal Data Protection Law (SDAIA)](https://sdaia.gov.sa/en/SDAIA/about/Documents/ImplementingRegulationPersonalDataProtectionLaw.pdf) | Extract |
| S20 | Guide to the Saudi Personal Data Protection Law for controllers and processors (SDAIA Data Governance Platform, `dgp.sdaia.gov.sa`) | Extract |
| S21 | [Implementing Regulation and Regulation on Personal Data Transfer outside the Kingdom (SDAIA)](https://sdaia.gov.sa/en/SDAIA/about/Documents/ImplementingRegulation.pdf) | Extract |
| S22 | Regulation on Personal Data Transfer outside the Kingdom, and Standard Contractual Clauses (SDAIA Data Governance Platform, `dgp.sdaia.gov.sa`) | Extract |
| S23 | [WhatsApp permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions/) | Extract |
| S24 | [Implement endpoints for Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint) | Extract |
| S25 | [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) | Extract |
| S26 | [Meta Business Agent: end-to-end setup](https://developers.facebook.com/documentation/meta-business-agent/get-started) | Extract |
