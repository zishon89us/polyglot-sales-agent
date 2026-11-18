# API

Status: draft for maintainer review · Phase 2 (design) · Issue #41

This document describes the HTTP interface of the `api` process: the webhook
the channel calls, the API the dashboard calls, and two operational
endpoints. The machine-readable contract is
[`openapi.yaml`](openapi.yaml), in the same folder. Where the two differ,
the OpenAPI file is right about shapes and this document is right about
behaviour, and the difference is a defect.

Nothing here is built. The OpenAPI file was linted in pull request #172; see
"How the file was checked".

## Method and sources

- The contract is written as an OpenAPI 3.1.1 description. The list of
  published versions was read on 2026-11-16 from
  <https://spec.openapis.org/oas/v3.1.1>, as a search extract; it also lists
  3.1.2 and 3.2.0. Version 3.1 was chosen because tools that generate and
  lint 3.1 are common, and no feature of 3.2 is needed. The text of the
  specification was not read in full, and no conformance is claimed.
- Errors use the shape of RFC 9457 ("problem details"). That document was
  not read for this work; the shape is used as commonly described.
- From milestone M2 the OpenAPI file is generated from the route schemas
  (ADR 0002). The file here was produced by
  `docs/design/tools/gen_openapi.py`, a script kept only so the design-time
  file can be regenerated; it is retired when the routes exist. The first
  generated file is compared with this one in its pull request, and each
  difference is either fixed or explained.

## 1. Scope

| Surface | Called by | Paths |
| --- | --- | --- |
| Channel webhook | The channel (or `mock-whatsapp`) | `/webhooks/whatsapp` |
| Dashboard API | The dashboard, in a staff user's browser session | `/api/v1/...` |
| Operations | The platform's health checks | `/healthz`, `/readyz` |

The file has 44 paths and 57 operations: 8 public, 30 open to any signed-in
user, and 19 for owners only. Operations that belong to the booking pack
carry `x-pack: booking` (ADR 0012).

Not part of v1.0:

- **The `order.created` webhook** named in issue #41. It belongs to the
  `cod-confirm` pack, deferred to v1.1 (ADR 0001).
- **An operator interface.** The operator works through commands run on the
  server (ADR 0011). No route can create a tenant.
- **An API for third parties.** The only clients are the dashboard and the
  channel.
- **Sign-up.** There is no route that creates an account without an
  invitation (NFR-S8).

## 2. Conventions

| Topic | Rule |
| --- | --- |
| Format | JSON in and out. Unknown fields in a request are refused, not ignored |
| Identifiers | UUIDs. An identifier from another tenant is answered exactly as one that does not exist: 404 (US-D1 criterion 2) |
| Time | RFC 3339 in UTC. The dashboard converts to the tenant's time zone, which it reads from the tenant settings |
| Money | An integer in the currency's smallest unit (`price_minor`), with the tenant's currency |
| Lists | `cursor` and `limit` (at most 100) in; `items` and `next_cursor` out. Short lists that are bounded by nature, such as services, are returned whole |
| Versioning | The path carries `v1`. A change that breaks a client needs `v2`; adding a field does not |
| Text from customers and the model | Returned as plain strings. The dashboard must render them as characters, never as markup (threat T25, #155) |
| Phone numbers | Never in a path or query string, so that they do not reach access logs. A contact is found by a POST with the number in the body |
| Updates | Last write wins. There is no version check in v1.0; a tenant has few editors. A decision, listed in section 9 |
| Live updates | None pushed. The dashboard asks again at an interval while a list or a conversation is open. A decision, listed in section 9 |

### Errors

Every error is `application/problem+json` with `type`, `title`, `status` and
a stable `code`. A validation error also lists each field with its problem
and, where there is one, the allowed range (US-D2 criterion 2, US-D11
criterion 3).

| Status | Code | When |
| --- | --- | --- |
| 400 | `malformed` | The body is not valid JSON, or has an unknown field |
| 401 | `unauthenticated` | No session, or it has ended |
| 401 | `sign-in-failed` | Wrong email or password, **or the account is locked**. One answer for all three, so that the response does not show which addresses have accounts or are locked |
| 401 | `bad-signature` | Webhook only |
| 403 | `forbidden-role` | The user's role does not allow the route |
| 403 | `csrf-failed` | The forgery-protection token is missing or wrong |
| 404 | `not-found` | No such resource in this tenant |
| 409 | `not-holder` | Another staff user holds the handover, or nobody does |
| 409 | `reply-window-closed` | Free-form text is not allowed now; the follow-up template may be |
| 409 | `contact-opted-out` | The staff-message block of state machines section 7 applies |
| 409 | `handover-state` | The action is not available in the handover's current state |
| 409 | `followup-unavailable` | Already sent, the window is open, or the contact opted out |
| 409 | `no-capacity` | The slot is full, or the move would exceed capacity |
| 409 | `contains-bookings` | The period to block contains bookings; the response lists them |
| 409 | `not-started` | An outcome cannot be recorded before the start time |
| 409 | `booking-state` | The booking is cancelled or already has an outcome |
| 409 | `last-owner` | The only owner cannot remove or demote themselves |
| 409 | `already-user` | The address already belongs to a user of this tenant |
| 409 | `credentials-rejected` | The channel refused the credentials; nothing was stored |
| 409 | `channel-unavailable` | The check could not complete; the tenant's state is unchanged |
| 409 | `key-reused` | The idempotency key was used before with a different request |
| 410 | `link-invalid` | An invitation or reset link is used, expired or unknown. One answer for all three |
| 413 | `too-large` | Webhook only |
| 422 | `validation-failed` | A value is missing or outside its range |
| 429 | `rate-limited` | Too many requests; `Retry-After` says when to try again |

### Repeating a request safely

Operations that send a message or change a booking require an
`Idempotency-Key` header: `sendStaffMessage`, `sendFollowUp`,
`createBooking`, `moveBooking` and `cancelBooking`. A repeat with the same
key and the same body returns the first result and does nothing more. Keys
are kept for 24 hours; that figure is the agent's proposal.

## 3. The channel webhook

### Registration check — `GET /webhooks/whatsapp`

The channel calls this once when the webhook address is registered. The
verify token in the query is compared with a configured secret, and the
challenge is echoed as plain text. A wrong token gets 403.

### Events — `POST /webhooks/whatsapp`

The request does four things and nothing else (NFR-P1):

1. Refuse a body larger than the limit with 413, before reading it in full
   (#154).
2. Compute the signature over the **raw** body and compare it in constant
   time. If it is missing or wrong: 401, and nothing is stored (NFR-S2).
3. In one transaction: store each event, with the channel's message
   identifier under a unique constraint, and enqueue its job (ADR 0004).
4. Answer 200.

| Case | Answer | Why |
| --- | --- | --- |
| A valid event | 200 | |
| A duplicate of an event already stored | 200 | The channel must stop redelivering it; the unique constraint makes it harmless |
| A valid signature, but the receiving number belongs to no tenant | 200 | Metadata only is stored (data model, decision 1). An error would make the channel retry |
| A valid signature, but a payload this version cannot parse, including a body that is not valid JSON | 200 | Metadata only is stored (`unparsed_events`: a hash, the size and an error code, kept 30 days), and the operator is alerted. The raw event is not kept, because it would hold a stranger's number and text outside tenant scoping |
| A bad or missing signature | 401 | Unless the request was refused before its signature could be read: 413 for a body over the size limit, 429 from a blocked source, 400 for a request that is not well-formed HTTP. In every case nothing is stored |
| A valid signature, and one message or status in the payload that does not have the expected form | 200 | That item is left out and counted; the others in the same payload are read. A group of messages without its receiving number, or an entry that cannot be walked, counts as one however much it held. The count is handed on so that it can be recorded and looked at. What was left out is lost: the channel will not send it again after a 200 |
| The database is unavailable | 503 | The channel redelivers later |

The webhook does not answer 400 or 429 to a validly signed request whose
body it could read as bytes: the first would be pointless, since the channel
cannot repair its own payload, and the second would throttle the channel's
deliveries. (A request that is not well-formed HTTP, such as one with a
content type that cannot be parsed, is answered 400 whatever its signature.)
There is one exception, and it follows from the limit on refused requests
(#154):

- **What counts.** A request with a bad or missing signature, a body over
  the size limit, and a registration check with a wrong token. A validly
  signed request never counts, so the channel's own traffic never starts
  the limit.
- **The limit.** Ten of those from one source within any 60 seconds, and
  that source is refused for the next 60 seconds with 429, before its body
  is read. While that lasts, a validly signed request from the same source
  is refused too. The channel sends it again later.
- **What a source is.** The address the server sees. Behind a proxy, the
  server must be told the proxy's address (`createApiServer`,
  `trustedProxies`), and then the source is the address the proxy reports.
  If it is not told, every caller looks like the proxy, and ten refused
  requests from anyone get the channel's webhooks answered 429 for a minute
  at a time. If it is told to trust any proxy, a caller can name any
  address as its own: it can get the channel's address blocked, and avoid
  the limit itself by naming a new one each time. So the setting is a list
  of addresses, never "all".
- **What the limit does not do.** It does not bound requests that arrive
  together: the check comes before a body is read and the count after, so
  sixty connections that each send a 3 MiB body at the same moment are all
  read. Bounding that takes a limit on connections, which is the
  platform's. An IPv6 caller with a whole network can use a new address
  each time. The count is kept in each API process's memory, for at most
  10,000 sources: with more than that active at once, a source that has
  not yet reached ten is forgotten before it does.

A request must arrive in full, body included, within 10 seconds, or its
connection is closed with no answer; a body that trickles in is cut off at
the same time as one that stops. The sink must finish within 5 seconds, or
the answer is 503 and the sink is told to stop. **A 503 does not mean that
nothing was stored**: a sink that was slow may still have committed. The
channel sends the webhook again either way, so storing must be safe to
repeat. It is: a message is unique by its channel identifier, and the
records of unreadable and unroutable events are unique by what they
describe.

What each kind of event writes and queues is one table, in
`architecture.md`, "What the webhook does with each kind of event".

### Health — `GET /healthz`, `GET /readyz`

`/healthz` answers 200 while the process runs, and checks nothing.
`/readyz` answers 200 if both database roles the API uses can run a query,
and 503 otherwise. Neither says anything of the worker, which is probed on
its own (ADR 0004, amendment), and neither shows a cause.

What is trusted from a signed event: that the channel sent it, the sender's
number and the receiving number (threat-model assumption A1). What is never
trusted: the message text, the profile name, and any media.

The shape of the payload is the channel's and is not restated in the OpenAPI
file. Statements about it come from `docs/compliance.md`; no live event has
been seen. Contract tests in M2 use dated, synthetic fixtures (R-T3).

## 4. Signing in

Decided in ADR 0008; gaps found by the threat model are in #156.

- `signIn` sets a cookie named `__Host-session`: not readable by scripts,
  HTTPS only, same-site. The server stores only a hash of its value. A
  session ends after 60 minutes idle or 12 hours in total (US-D1).
- `getSession` returns the user, the role and a `csrf_token`. Every request
  that is not a GET must send that token in the `X-CSRF-Token` header.
- The tenant is taken from the session row and nowhere else. No request
  carries a tenant identifier.
- `requestPasswordReset` always answers 202 with the same body, for a known
  or an unknown address (US-D10 criterion 4).
- Invitation and reset tokens travel in the request body, not in the path
  the API sees, so they do not reach the API's access log. The link in the
  email points at a dashboard page, which posts the token.
- `changePassword`, and a completed reset, end the user's other sessions.

## 5. Roles

Each operation carries `x-role` in the OpenAPI file: `public`, `agent`
(any signed-in user) or `owner`. A test will fail on any route that has no
declared role (ADR 0008).

| Area | Agent | Owner only |
| --- | --- | --- |
| Tenant | Read the tenant, channel status and template status | Change settings; enter or check channel credentials |
| Users | — | List, invite, change role, remove |
| Business data | Read services, opening hours, policies | Create, change, delete |
| Conversations and handovers | Everything | — |
| Bookings, blocked periods, withheld messages | Everything | — |
| Metrics | — | Read |
| Contact data | — | Find, export, delete |

This follows US-D7 criterion 2. Two readings were needed and are listed as
decisions: agents may **read** business data and settings, because they
answer customers and need the prices; and metrics are owner-only, because
US-D4 gives them to the owner.

## 6. Behaviour worth stating

**Taking over and holding** (US-D3). `takeOver` hands the current session
over with reason `staff`, or takes hold of an open handover that nobody
holds. Only the holder may send. A second user sees `held_by_user_id` and
gets `not-holder` if they try. `releaseHandover` gives up the hold without
ending the handover, which returns it to the waiting list unheld.

**Sending a staff message.** `sendStaffMessage` answers 202 once the message
is stored and queued; the message is sent by the worker, and its `status`
changes as the channel reports. The handover is answered when the channel
accepts the message, not when the request returns (state machines section
2).

**Hand back, close, follow-up.** `handBack`, `closeHandover` and
`sendFollowUp` are the three staff events of the handover machine. Each is
refused with `handover-state` or `followup-unavailable` in a state where the
machine's table does not allow it. `sendFollowUp` may answer 202 with
`followup_status` of `held` (quiet hours) or `withheld`, with the reason
shown on the handover.

**Adding a booking by hand** (US-D9, US-C13). `createBooking` takes a
service and a start time and, optionally, the customer: either an existing
`contact_id` or a `contact_phone`, in the body, which finds or creates the
contact. `consent: true` records that the customer agreed to messages about
this booking; without it no reminder is sent for it. A booking with no
customer attached gets no messages at all.

**Booking routes belong to the booking pack** (ADR 0012): every operation
tagged Bookings, including `listSlots`, the blocked-period routes and the
booking service settings. For a tenant whose pack is not `booking` they
answer 404, as if they did not exist, and `pack_settings` and `pack_metrics`
are empty objects.

**Urgent handovers.** `Handover.urgent` is true once the reason `emergency`
is present; `listHandovers` returns urgent handovers first.

**Blocking time** (US-D9). A period that contains bookings is refused with
`contains-bookings` and the list of them. The client sends it again with
`keep_bookings: true` to block the period and keep them. Nothing is ever
cancelled by blocking.

**Opening hours** (US-D2). Opening hours are core data, so their route knows
nothing about bookings. The change is always saved. The booking pack then
lists future bookings that fall outside the new hours through `listBookings`
with `outside_opening_hours=true`, and the dashboard shows that list after a
save.

**A service's duration and capacity** are the booking pack's
(`setBookingServiceSettings`), not fields of the core service. A service
without them can be described and priced but not booked.

**Pack settings and pack metrics.** `Settings.pack_settings` and
`Metrics.pack_metrics` are objects whose keys the tenant's pack declares;
the OpenAPI file lists the booking pack's. The server validates
`pack_settings` against the pack's schema and answers `validation-failed`
with the field and its range, as for a core setting.

**Settings** (US-D6, US-D11). A PATCH with any subset. One value out of
range saves nothing. Warnings are returned with a successful save. After a
save the tenant's state is evaluated again, and `getTenant` reports
`answering` and what is `missing`.

**Channel credentials** (US-D6). `setChannelCredentials` checks them with
the channel before storing. The access token is write-only: no response
ever contains it, only its last four characters.

**Deleting a service.** A service with bookings is deactivated, not deleted
(data model). Both answer 204.

**Finding a contact** (US-D5). `findContact` answers 404 with the message
that no data is held for that number, both for a number never seen and for
one already deleted.

**Export.** `exportContact` streams the JSON to the owner's session as a
download. Nothing is stored and there is no link to it (#164). It is
rate-limited and written to the audit log without the phone number.

**Deletion.** `deleteContact` needs `confirm: true`, answers 202, and the
work completes within 24 hours.

**Metrics** (US-D4). Each rate is returned with its numerator and
denominator. When the denominator is zero the value is null, and the
dashboard shows "no data".

## 7. Limits on use

| Limit | Value | Source |
| --- | --- | --- |
| Failed sign-ins per account | 5 in 15 minutes, then refused for 15 minutes | NFR-S6 |
| Sign-in and reset requests per source | Not set | #156 |
| Refused webhook requests, per source | 10 within any 60 seconds, then refused for 60 seconds. Counted in each API process's memory | #154; the agent's proposal |
| Time for a request to arrive in full | 10 seconds | The agent's proposal |
| Time for the webhook's sink to finish | 5 seconds, then 503 | The agent's proposal |
| Webhook body size | The channel's own figure. For WhatsApp 3 MiB: Meta says a payload can be up to 3 MB (read 2026-11-18) | #154 |
| Contact exports per tenant | Not set | #164 |
| Any signed-in session | Not set; a general ceiling is added with the code in M4 | — |

## 8. Stories to operations

| Story | Operations |
| --- | --- |
| US-C1, US-C18 Receive messages and statuses | `verifyWebhook`, `receiveWebhook` |
| US-C14 Waiting list and follow-up | `listHandovers`, `sendFollowUp`, `closeHandover` |
| US-D1 Sign in | `signIn`, `signOut`, `getSession`, `changePassword` |
| US-D2 Business information | `getBookingServiceSettings`, `setBookingServiceSettings`, `listServices`, `createService`, `updateService`, `deleteService`, `getOpeningHours`, `setOpeningHours`, `listPolicies`, `createPolicy`, `updatePolicy`, `deletePolicy` |
| US-D3 Conversations and takeover | `listConversations`, `getConversation`, `listMessages`, `takeOver`, `sendStaffMessage`, `releaseHandover`, `handBack` |
| US-D4 Metrics | `getMetrics` |
| US-D5 Export or delete | `findContact`, `exportContact`, `deleteContact` |
| US-D6 Setup and channel | `getTenant`, `updateSettings`, `getChannel`, `setChannelCredentials`, `checkChannel`, `listTemplates` |
| US-D7 Staff access | `listUsers`, `inviteUser`, `changeUserRole`, `removeUser` |
| US-D8 Attendance | `recordOutcome` |
| US-D9 Blocked time and manual bookings | `listBlockedPeriods`, `createBlockedPeriod`, `deleteBlockedPeriod`, `listSlots`, `createBooking` |
| US-D10 Invitation and reset | `acceptInvitation`, `requestPasswordReset`, `confirmPasswordReset` |
| US-D11 Settings | `getTenant`, `updateSettings` |
| US-D12 Bookings and withheld messages | `listBookings`, `moveBooking`, `cancelBooking`, `listWithheldMessages` |
| NFR-O1 Health | `getHealth`, `getReadiness` |

Every operation in the file appears in this table; a script checked it.

## 9. Decisions made here

| # | Decision | Why | Open to challenge because |
| --- | --- | --- | --- |
| 1 | One answer, `sign-in-failed`, for a wrong password, an unknown address and a locked account | The response must not show which addresses exist or are locked | A locked-out user is not told plainly; the message has to say "or too many attempts" |
| 2 | Agents may read business data and settings | They answer customers | US-D7 says only what they cannot edit |
| 3 | No pushed updates; the dashboard asks again at an interval | No second protocol to secure and test in v1.0 | A staff user sees a new message a few seconds late. The interval is set with the dashboard in M4 |
| 4 | Last write wins on edits | Few editors per tenant | Two owners editing the same service can overwrite each other silently |
| 5 | `releaseHandover` exists | US-D3 criterion 3 says "until it is released" | The state machines name no release event; it changes the holder, not the state. For the Gate 2 review |
| 6 | A manual booking may have no contact | A booking made by phone is not a WhatsApp contact; the data model has no free-text field for a name | Staff cannot see whose booking it is. May need a decision in M5 |
| 7 | An unparseable but validly signed event is answered 200 and recorded as metadata only | Otherwise the channel redelivers it forever; and the raw event must not sit outside tenant scoping | Nothing in the requirements covers it; the operator alert is new. With no raw copy, the operator cannot see what the payload was |
| 8 | A contact is found by POST | A phone number must not be in a URL | — |
| 9 | Booking fields are not in core schemas: duration and capacity, booking settings and booking metrics are supplied by the pack | ADR 0012; the boundary test would otherwise fail on the API | Two calls to set up a bookable service instead of one |
| 10 | Staff may attach a manual booking to a phone number and record consent | Without it a phone customer could never get a reminder (Gate 2 finding S5) | The number is typed by staff and is not verified |

Decisions 5, 6 and 7 add behaviour that no story states. Decision 10
implements US-C13 criterion 3.

## 10. How the file was checked, and what is not done

- **Linter.** `pnpm run lint:openapi` lints the file with the recommended
  Redocly rules and one rule turned off (`no-server-example.com`, because
  the file lists only the local development server). It is part of
  `make check` and of CI since M2 unit U2. The file as regenerated for the
  Gate 2 fixes passes it.
- **Structural check.** `docs/design/tools/check_openapi.py` checks that
  every reference resolves, operation names are unique, path parameters
  match their paths, every operation has a success response, every route
  that changes state requires the forgery-protection token, and no schema is
  unused. It passes on the current file.
- The channel's payload is not described.
- Rate limits are mostly unset (section 7).
- Not independently reviewed; Gate 2 covers it.
