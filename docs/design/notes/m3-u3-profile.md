# Design note: the business profile, a tenant's settings, and what the model is given (M3 unit U3)

2026-11-23 · issue #302 · written before the code · second version, after
a review of the first (`docs/reviews/2026-11-23-m3-u3-design-review.md`)

U3 stores what a business says about itself, gives an operator a way to
load it (no dashboard exists before M4), and builds the one function that
hands it to the turn. This is the rule about **what of a business and of
a person may reach the model**, so the cases come first.

Nothing a customer sees changes in U3: the reply is still the echo. U7
puts a model behind it and gives it what U3 assembles.

Decisions here that are the maintainer's are rows 41 and 42 of the
decisions page; each is marked **(row)** where it is made.

## 1. What is stored

Migration 0007.

**`services`** (tenant-owned, core; data model): `name`, `description`,
`price_minor`, `active`, `updated_at`.

**`policies`** (tenant-owned, core): `title`, `body`, `updated_at`.

**Settings, as columns of `tenants`** (decisions row 34): `currency`,
`support_contact`, `notification_email`, `business_hours`,
`opening_hours`, `opening_hours_updated_at`. All null until loaded. The
other settings of the data model arrive with the units that use them.

Hours have the shape the API design gives them: a list of periods, each
`{ "weekday": 1, "opens": "09:00", "closes": "17:00" }`, weekday 1 being
Monday. They are wall-clock times in the tenant's time zone. A weekday
with no period is closed. `closes` is later than `opens`; `24:00` is
allowed as a close and means the same instant as the next day's `00:00`;
periods of one weekday do not overlap; at most four a weekday. A period
past midnight is written as two. What the changing of the clocks does to
an hour that does not exist is the pack's question, with slots.

**What a text may hold.** Lengths are counted in code points, and are the
API design's:

| Field | Limit | Checked by |
| --- | --- | --- |
| Service name; policy title | 1 to 200 | Database and loader |
| Service description | 0 to 2,000 | Database and loader |
| Policy body | 1 to 4,000 | Database and loader |
| Price | A whole number of the currency's smallest unit, 0 or more, and one JSON carries exactly | Database (0 or more) and loader |
| Currency | A code the platform's own list of currencies holds (`Intl`); the number of decimals comes from the same list, so that 15000 is 150.00 in one currency and 15.000 in another | Loader; the database checks three capital letters |
| Support contact | A phone number in international form, `+` and 8 to 15 digits, or an email address | Loader; the database checks length |
| Notification email | An email address, at most 254; nothing is sent to it in M3 and it is not verified | Loader |
| Services in a profile | 100 | Loader **(row 41)** |
| Policies in a profile | 30 | Loader **(row 41)** |

**Characters.** A name, a title, a contact and an address are one line. A
description and a body may have line breaks. Refused everywhere: control
characters other than a line break, the characters that override the
direction of text (U+202A to U+202E, U+2066 to U+2069), and U+2028 and
U+2029. **Allowed**, because correct Urdu, Persian, Hindi, Bengali and
mixed Arabic and Latin text need them: the zero-width joiner and
non-joiner and the left-to-right, right-to-left and Arabic letter marks.
This is a rule of the loader; the database does not repeat it.

**Names.** Before a name or a title is compared or stored it is put in
Unicode's composed form, trimmed, and its runs of spaces made one. Two
services of a tenant may not have names that are then the same but for
case; likewise two policies' titles. Letters that only look alike are not
folded.

## 2. What the model is given

`loadBusinessProfile(tenant)` returns a typed value, and nothing else
reads these tables for a prompt. It takes a tenant and no contact,
conversation or session, and its one query names `tenants`, `services` and
`policies` and no other table. So it returns **nothing from a contact's
record**, and the same for every customer of a tenant. That is a narrower
promise than "no person's data": see M9.

| # | Is it in the profile? | |
| --- | --- | --- |
| M1 | The business's name, time zone and currency | Yes. The name can be a person's, a sole trader's; it is what the business calls itself to customers **(row 42)** |
| M2 | Each active service: its identifier, name, description, and price as a number of the smallest unit with the currency and its decimals | Yes |
| M3 | A service that is not active | No. A claim that names one fails (U9) |
| M4 | Each policy: its identifier, title, body | Yes |
| M5 | Opening hours: all seven weekdays once any is set, a closed one marked closed. The weekday's number is the item's identifier | Yes, when set |
| M6 | Business hours (when staff answer) | No. They are no kind of grounded fact, so a reply that stated them could not be checked; code sends them in the handover text (U8). A customer who asks when a person can be reached is told the assistant does not have that **(row 42)** |
| M7 | The support contact | **Yes.** The output checks already name it as a value a reply may carry, and a customer who asks how to reach the business should be told. U9 also needs it, to tell the business's own contact from another **(row 42)** |
| M8 | The notification email | No. Nothing is sent to it but the business's own notices |
| M9 | Anything from a contact's record: number, name, language, consent | No. The function cannot reach it. The session's messages are U7's to add, under row 36 |
| M10 | A phone number, a link or a name that the owner typed into a description or a policy | Yes, as typed: their own, a member of staff's, anyone's they chose to write. It goes to the model provider with the rest, and the assistant may repeat it: a link or a contact that is in the profile passes the output check on links and contacts. In M3 only an operator can put text here; the alarm for a changed link that #209 asks for is M5's, with the owner's screen **(row 42)** |
| M11 | When each item was last updated | **No.** ADR 0006 puts it in the prompt; finding A43 (#228) points out that it puts dates in front of the model that no claim kind covers. It is for the owner's screen (US-D2, 4). ADR 0006 is amended in this pull request **(row 42)** |
| M12 | A calendar of dates | No. Dates are the pack's (ADR 0014); that half of #228 goes to M5 with it |
| M13 | A tenant with nothing loaded | A name and a time zone and nothing else. US-C4, 12 then applies to every question |

Identifiers are the rows' own and the weekday's number. How the profile
is written into a prompt, with what handles in place of long identifiers
and with the owner's text delimited, is U7's.

## 3. The size budget

ADR 0006: "A size budget is set in M3 from measured token counts. A
tenant whose profile would exceed it cannot save more data."

No model is chosen, so no token can be counted. U3 does what can be done
now:

- a profile's **size** is the number of code points in its texts (names,
  descriptions, titles, bodies) and nothing else: not identifiers, not
  hours, not what U7's rendering adds. U3 exports the function that
  measures it and the budget, for the loader, U16 and U17;
- **a provisional budget of 40,000**, which the loader enforces: a file
  over it is refused whole and told its size **(row 41)**;
- U3 writes one realistic profile, a small business with a dozen services
  and a handful of policies, in English and in Arabic, as fixtures, and
  records their sizes here under "As built", so that the number has
  something beside it;
- U17, which measures the candidate models, sets the budget that stays, in
  tokens.

What the number does not say: a code point is not a token. The same
budget costs several times more tokens in Arabic, Urdu, Hindi or Bengali
than in English on the tokenisers in common use, by general knowledge and
not by any measurement here. The budget covers the profile only; the
session's messages and a pack's own part of the prompt are outside it.

## 4. Whether a tenant is answering

A function that returns two things, since the order of checks reads them
apart (step 4a wants only the channel; steps 5 and 8 want both):

- **which required settings are missing** of `currency`,
  `support_contact`, `notification_email`, `business_hours`;
- **whether a channel is connected:** the tenant has a channel account,
  of any channel, the stand-in included.

| # | Case | Settings | Channel |
| --- | --- | --- | --- |
| A1 | All four and a channel | Complete | Connected |
| A2 | Any one setting missing, for each of the four | That one named | — |
| A3 | No channel account | — | Not connected |
| A4 | Business hours set with no period at all | Complete: set is not the same as open | — |
| A5 | Opening hours not set; no services; no policies | Complete | — |

This is weaker than state machines, section 9, which wants the channel's
credentials verified. Nothing reads it in U3. From U10, which builds step
8, a tenant with no profile loaded is not answered: U10 adds a profile to
the development set-up and to the end-to-end test.

## 5. Loading a profile

`ops profile load --tenant <id> --file <path or -> --as <name>`

The file is JSON (no new dependency) and is the **whole** profile. `-`
reads it from standard input. A profile file holds a business's contact
details: it is not committed; the fixtures use `example.com` and 555
numbers.

```json
{
  "settings": {
    "currency": "SAR",
    "support_contact": "+15550100",
    "notification_email": "owner@example.com",
    "business_hours": [{ "weekday": 7, "opens": "09:00", "closes": "17:00" }],
    "opening_hours": [{ "weekday": 7, "opens": "09:00", "closes": "21:00" }]
  },
  "services": [{ "name": "Consultation", "description": "30 minutes", "price_minor": 15000 }],
  "policies": [{ "title": "Cancellation", "body": "Free up to 24 hours before." }]
}
```

| # | Case | What happens |
| --- | --- | --- |
| L1 | A valid file | In one transaction that first locks the tenant's row: the settings are replaced; each service in the file is added, or updated in place if one of that name exists; each policy likewise by title |
| L2 | A service or a policy the tenant has that the file does not name | Deleted. Nothing can point at one before M5; from M5 the pack decides what a service with rows of its own becomes. A service can be kept and hidden with `"active": false` |
| L3 | An item whose values are the same as stored | Not touched: its `updated_at` stays. Opening hours likewise |
| L4 | A service renamed in the file | A new service and the old one gone: its identifier changes. Renaming in place is the owner's screen's, in M5 |
| L5 | `settings` without one of the four required keys | Refused: a load never leaves a tenant with less than it needs to answer. `opening_hours` may be absent, and is then cleared |
| L6 | Not JSON; an unknown key; a key twice in one object; two services of one name; a limit broken; a price that is not a whole number; a file over 1 MB; bytes that are not UTF-8; a byte-order mark | Nothing is written; each problem is named by its place in the file (`services[2].name`), never by repeating what was typed; exit code 2, before the database is reached |
| L7 | A file over the size budget, or over 100 services or 30 policies | As L6, with the size and the budget |
| L8 | A tenant that does not exist | Nothing is written; exit code 1 |
| L9 | Two loads for one tenant at once | One waits for the other on the tenant's row |
| L10 | A turn reads the profile while a load is committing | The profile is read in one statement, so it is wholly the old one or wholly the new |
| L11 | The record | Two rows in the operator's log, as for every command, with the tenant, the SHA-256 of the file and the counts of services and policies added, changed and removed. Never the file's name or anything in it. And one row in the tenant's own audit log, saying that an operator loaded a profile, with the same counts and the operator's record it belongs to, so that from M5 the owner can see their prices were changed and by what |

`ops profile show --tenant <id> --as <name>` prints the profile as
`loadBusinessProfile` returns it, each price also written out in its
currency, the profile's size against the budget, what section 4 returns,
and **every link, email address and run of seven or more digits found in
the texts**, since those are what the assistant will be allowed to send.
It is recorded like every command. What it prints passes through the
same filter as all of `ops`'s output.

**Which role writes.** Every command of `ops` so far uses the
cross-tenant role and nothing else. Giving that role the right to write
`services`, `policies` and the settings would let a fault under it, in
the API or the worker, which hold the same credential, rewrite every
tenant's prices. So `profile load` and `profile show` use **the tenant's
own role, inside that one tenant's scope**, for everything but the
operator's log: `ops` is given `PSA_DB_APP_URL` as well. The tenant's
role gains what the owner's screen will need in M5 anyway: to read and
write `services` and `policies`, and to update the six settings columns of
its own `tenants` row. The cross-tenant role gains nothing.

## 6. Where the code lives

- `packages/core`: the types of a profile; the pure functions that check
  a file, normalise a name, measure a size, list the contact-like strings,
  and say what is missing to answer; the limits as constants.
- `packages/db`: migration 0007; one query that reads a profile; the
  function that replaces one. SQL nowhere else (ADR 0003).
- `apps/ops`: the two commands.

Comments in the core's files and migrations speak of "a pack's rows", not
of the booking pack's words: the boundary test reads them.

## Departures

| From | What | Why |
| --- | --- | --- |
| ADR 0006: the profile carries each item's last-updated time | It does not (M11) | #228. Amended in this pull request; row 42 |
| ADR 0006: a budget in tokens, from measured counts; "the editor says so" | In code points, provisional; the loader says so | No model is chosen; no editor before M5 |
| The plan, U3: "its size is measured" | Two fixture profiles are measured, in code points | The same |
| The plan, U3: "opening hours as core tables" | Columns of `tenants`, as the data model has them | A weekday is the item a claim names |
| The data model: `answering` is "derived and stored" | Derived only | The stored mark is for M4's emails |
| ADR 0011 and `.env.example`: `ops` holds the cross-tenant credential and no other | It holds the application role's too, for these two commands | Section 5, "Which role writes". ADR 0011 is amended in this pull request |
| The data model: a service "is deactivated, not deleted" | Deleted when a file no longer names it (L2) | Nothing can point at one before M5 |
| The data model and the API: names and titles are free | Unique within a tenant after normalising, whatever the case | The file names an item by its name |
| US-D2, 1 and the API: a price is "zero or more" | Also at most what JSON carries exactly | A larger number would be changed in reading |

## Tests

- **The file,** on the pure function, each with the place of its problem
  and nothing typed repeated: each limit at its edge; each row of L5 to
  L7, the twice-given key and the byte-order mark among them; names that
  differ only in case, in composed form or in spaces; text in Urdu, Hindi
  and Bengali with joiners and marks accepted; a direction override
  refused; a currency the list does not hold; a currency with three
  decimals and one with none; `24:00`; overlapping periods.
- **L1 to L4, L8 to L11** against the database, by name; L9 with a third
  connection holding the tenant's row; L10 by a profile read inside a
  transaction that began before a load.
- **M1 to M13** on a profile built from rows. For M9: the tenant is
  seeded with a contact, a conversation and messages whose number, name
  and text are known strings, and the profile's every string is searched
  for them; and the reading role is shown to need no table but the three.
  Every item has an identifier (ADR 0006's own confirmation).
- **A1 to A5.**
- **The size:** a profile at the budget accepted, one code point more
  refused; the two fixtures' sizes.
- **The migration** both ways with rows (the way back loses them, and
  says so); the tenant-crossing tests for `services` and `policies`; what
  each role may do, column by column for `tenants`; that the cross-tenant
  role gained nothing.
- **The commands:** usage text; exit codes 0, 1, 2 and 3; what is
  recorded and that nothing of the file is; what `show` prints for text
  with terminal escapes in it.

Existing tests that change: the lists of privileges and of tables in the
tenant-crossing tests, and their rule that only two tables have grants by
column; the operator's usage text.

## From the plan and U0's page

| Item | Here |
| --- | --- |
| US-C4 (#13), the storage | Built. Criteria 1 and 12 are the model's, shown in U16 and U17 |
| #228 | The last-updated half: M11 and the amendment. The calendar half: M5, with the pack |
| #76 (d): nobody can enter a description or a policy | An operator can, by the file. The issue stays open for the owner's screen and its missing criterion, M5 |
| #278: settings with their ranges as one shared list | The limits are constants in `packages/core`, used by the loader. The check of that list against the glossary and the API file is not built; #278 stays open for it |
| NFR-V7 | M9's test; a row in `traceability.md`. The session's messages are U7's |
| NFR-S1, NFR-O4 | The tests above; rows in `traceability.md` |
| "A tenant at U3's size budget" for U16 | The exported function and constant |
| The default language is stored | True; whether it is a supported language is U7's to check |

## Not in U3

- Anything the owner's screen does (US-D2): M5.
- A pack's settings, and what a pack adds to a service: M5.
- The prompt, its handles and delimiting: U7. Claims and their checks,
  among them how `24:00` compares with `00:00` and which weekday a period
  past midnight belongs to: U9.
- Step 8 of the order of checks, and a profile for the development
  set-up: U10.
