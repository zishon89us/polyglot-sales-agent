# Design note: the business profile, a tenant's settings, and what the model is given (M3 unit U3)

2026-11-23 · issue #302 · written before the code · not yet built

U3 stores what a business says about itself, gives an operator a way to
load it (no dashboard exists before M4), and builds the one function that
hands it to the turn. This is the rule about **what of a business and of
a person may reach the model**, so the cases come first.

Nothing a customer sees changes in U3: the reply is still the echo. U7
puts a model behind it and gives it what U3 assembles.

## 1. What is stored

Migration 0007.

**`services`** (tenant-owned, core; data model): `name`, `description`,
`price_minor`, `active`, `updated_at`. A name is unique within a tenant.
Duration and capacity are the booking pack's and are not here.

**`policies`** (tenant-owned, core): `title`, `body`, `updated_at`. A
title is unique within a tenant.

**Settings, as columns of `tenants`** (data model; decisions row 34):
`currency`, `support_contact`, `notification_email`, `business_hours`,
`opening_hours`. All null until loaded. The others the data model lists
(template languages, quiet hours, escalation, retention, the stored
`answering` mark) arrive with the units that use them.

Hours are stored per weekday as zero or more periods, in the tenant's
time zone:

```json
{ "mon": [["09:00", "13:00"], ["16:00", "21:00"]], "fri": [] }
```

A weekday that is absent or empty is closed. A period's close is later
than its open; `24:00` is allowed as a close; periods of one day do not
overlap; at most four a day. A period that runs past midnight is written
as two.

Limits, enforced by the database and by the loader:

| Field | Limit |
| --- | --- |
| Services per tenant, active or not | 100 |
| Policies per tenant | 30 |
| Service name; policy title | 1 to 80 characters |
| Service description | 0 to 500 characters |
| Policy body | 1 to 2,000 characters |
| Price | A whole number of minor units, 0 to 100,000,000 |
| Currency | Three capital letters (ISO 4217 is not checked against a list) |
| Support contact | 1 to 100 characters |
| Notification email | Contains one `@`, 3 to 254 characters; not verified |

None of these texts may hold a character that cannot be printed.

## 2. What the model is given

One function, `loadBusinessProfile(tenant)`, returns a typed value and
nothing else reads these tables for a prompt. It takes a tenant and no
contact, conversation or session, so **it cannot return anything about a
person**, and it returns the same for every customer of a tenant.

| # | Is it in the profile? | |
| --- | --- | --- |
| M1 | The business's name, time zone and currency | Yes |
| M2 | Each active service: its identifier, name, description, price | Yes |
| M3 | A service that is not active | No |
| M4 | Each policy: its identifier, title, body | Yes |
| M5 | Opening hours, a weekday at a time; the weekday is the item's identifier | Yes, when set |
| M6 | Business hours (when staff answer) | No. They are for the handover text, which code sends (U8) |
| M7 | The support contact and the notification email | No. The first is sent by code in a fixed text; the second is never sent to anyone but the business |
| M8 | Anything of a contact: number, name, language, consent, messages | No. The function has no way to reach it. The session's messages are U7's to add, under row 36 |
| M9 | A phone number, a link or a name that the owner typed into a description or a policy | Yes, as typed. It is the business's own text about itself; U7 delimits it as data, and U9's checks on links and contact details in a reply are what stop the model repeating one that is not the business's |
| M10 | When each item was last updated | **No.** ADR 0006 puts it in the prompt. Finding A43 (#228) points out that it puts dates in front of the model that no claim kind covers. It is for the owner's screen (US-D2, 4) |
| M11 | A calendar of dates | No. Dates are the booking pack's (ADR 0014); the other half of #228 goes to M5 with it |
| M12 | A tenant with nothing loaded | A profile with a name and a time zone and nothing else. US-C4, 12 then applies to every question: the assistant says it does not have that and offers a person |

Identifiers are the rows' own (`services.id`, `policies.id`) and the
weekday's three-letter name. U9's claim checker looks a claim's item up by
them.

How the profile is written into a prompt, and how the owner's text is
delimited, is U7's. U3 fixes one plain rendering for measuring size.

## 3. The size budget

ADR 0006: "A size budget is set in M3 from measured token counts. A
tenant whose profile would exceed it cannot save more data."

No model is chosen, so no token can be counted yet. U3 does what can be
done now:

- the limits of section 1 bound a profile at about 125,000 characters;
- a profile's size is measured as the characters of its plain rendering;
- **a provisional budget of 40,000 characters**, which the loader
  enforces: a file over it is refused whole;
- U17, which measures the candidate models, turns it into tokens and sets
  the number that stays; U16's dataset has a tenant at the budget.

Forty thousand is the agent's number, with no measurement behind it: at a
few characters to a token it is in the region of ten thousand tokens on
every call, which is already a real cost. It is row 41.

## 4. Whether a tenant is answering

A function, not a stored mark: true when `currency`, `support_contact`,
`notification_email` and `business_hours` are all set and the tenant has a
channel connected. It also says what is missing.

| # | Case | Answering |
| --- | --- | --- |
| A1 | All four settings and a channel | Yes |
| A2 | Any one missing | No, and the one is named |
| A3 | Business hours set with every day closed | Yes: set is not the same as open |
| A4 | Opening hours not set | Yes: they are needed for bookings, not for answering |
| A5 | No services or policies | Yes |

This is weaker than state machines, section 9, which also wants the
channel's credentials verified, and nothing reads it in U3: step 8 is
U10's. The stored mark, the daily check and the emails are M4's.

## 5. Loading a profile

`ops profile load --tenant <id> --file <path> --as <name>`

The file is JSON (no new dependency) and is the **whole** profile:

```json
{
  "settings": {
    "currency": "SAR",
    "support_contact": "front desk, 09:00 to 17:00",
    "notification_email": "owner@example.com",
    "business_hours": { "sun": [["09:00", "17:00"]] },
    "opening_hours": { "sun": [["09:00", "21:00"]] }
  },
  "services": [{ "name": "Consultation", "description": "30 minutes", "price_minor": 15000 }],
  "policies": [{ "title": "Cancellation", "body": "Free up to 24 hours before." }]
}
```

| # | Case | What happens |
| --- | --- | --- |
| L1 | A valid file | In one transaction: the settings are replaced; each service in the file is added, or updated in place if one of that name exists; each policy likewise by title |
| L2 | A service the tenant has that the file does not name | Made inactive, not deleted: from M5 a booking may point at it |
| L3 | A policy the tenant has that the file does not name | Deleted |
| L4 | An item whose values are the same as stored | Not touched: its `updated_at` stays |
| L5 | A service renamed in the file | A new service, and the old one inactive. Its identifier changes. Renaming in place is the owner's screen's, in M5 |
| L6 | An inactive service named again in the file | Active again, the same row |
| L7 | A file that breaks any limit, has an unknown key, or is not JSON | Nothing is written; every problem is named with its place in the file; exit code 2, before the database is reached |
| L8 | A file over the size budget | As L7, with the size and the budget |
| L9 | A tenant that does not exist | Nothing is written; exit code 1 |
| L10 | The record of the command | Two rows in the operator's log, as for every command, with the tenant and the counts of services and policies. Never the file's name or anything in it: a path can hold a person's name |
| L11 | A hundred services already, some inactive, and the file adds one | Refused: the limit counts inactive ones, since they are never deleted |

`ops profile show --tenant <id>` prints the profile as the model would be
given it, its size against the budget, and whether the tenant is
answering and what is missing. It writes nothing, and is not recorded,
like `tenant list`.

The loader runs as the cross-tenant role, as every operator's command
does. That role gains what it needs on these tables and no more: to read
and write `services` and `policies`, and to update the five settings
columns of `tenants`. The tenant's own role can read all three and write
none until the owner's screen exists.

## Departures

| From | What | Why |
| --- | --- | --- |
| ADR 0006: the profile carries each item's last-updated time | It does not (M10) | #228. ADR 0006 is amended in this pull request |
| ADR 0006: a budget in tokens, from measured counts | In characters, provisional | No model is chosen |
| The plan, U3: "opening hours as core tables" | Columns of `tenants`, as the data model has them | A weekday is the item a claim names; nothing needs a row per period |
| The data model: `answering` is "derived and stored" | Derived only | The stored mark is for the emails, in M4 |
| ADR 0012 and the architecture: packs are named in `ops` only for creating a tenant | Unchanged; the loader knows nothing of packs | A pack's own settings are M5's |

## Tests

- The file's rules: one test for each limit and each row of L7, on the
  pure function that reads a file, with the place of each problem.
- L1 to L11 against the database, by name.
- M1 to M12: the profile built from fixture rows; M8 by showing the
  function has no contact to be given, and returns the same value whatever
  contacts and messages the tenant has.
- A1 to A5.
- The size: a profile at the budget is accepted and one character more is
  refused.
- The migration both ways with rows; the tenant-crossing tests for
  `services` and `policies`; what each role may and may not do, column by
  column for `tenants`.
- The operator's log: what is recorded, and that nothing of the file is.

## Not in U3

- Anything the owner's screen does (US-D2): M5.
- A pack's settings, and duration and capacity of a service: M5.
- The prompt itself, and delimiting: U7. Claims and their checks: U9.
- Step 8 of the order of checks: U10.
