# Design review: M3 unit U5, buttons and captions in the channel (note of 2026-11-24)

Reviewed before any code exists. Read-only, in `/tmp/u5design` (HEAD `c2a017d`). Nothing was changed, installed or run against a database; no network.

**Verdict:** the note covers what the plan and ADR 0014 assign to U5 and stays inside the unit. It should not go to code as written. Four things need fixing first: the rule of section 3 breaks for a message whose send ended `unconfirmed` (D1), and it buys no safety for the core's own buttons while the note proposes to make them depend on it (D2); a malformed tap is dropped unstored, which can lose a stop (D3); and the constraint on `button_payload` can fail the migration and poison a webhook (D4).

## What I read

- The note, `docs/design/notes/m3-u5-buttons-captions.md`, in full; `docs/decisions-needed.md` header and rows 33, 44, 45, 46.
- `docs/plans/m3-ai-core.md`: question 6 (124-132), unit table rows U5, U8, U10, U11 (159-165), 268-276, "### U5" (335-340), U8 (360-373), U10, U11 (388-405).
- `docs/adr/0014-pack-interface.md`: 80-92, 161-163, 195-203, 268-296. `docs/adr/0012`: only the lines that mention buttons.
- `docs/requirements/user-stories.md`: US-C1, US-C7, US-C12, and line 550. `glossary.md` lines 33, 36, 127-131. `nfr.md` NFR-M2.
- `docs/design/state-machines.md`: section 1 table and the paragraphs after it (26-56); section 6 lines 363-366. `data-model.md`: `messages` (254-276), retention (460-468). `threat-model.md`: A7, T7, T47, T58, by search. `architecture.md`: line 317 only.
- Code: `packages/channel/src/index.ts` and `contract.ts` (whole); `packages/channel-whatsapp/src/parse.ts` and `send.ts` (whole); fixtures `2026-11-18/README.md`; `apps/api/src/sink.ts` 30-121; `packages/db/src/inbound.ts` (whole); migrations 0001 (messages table), 0003, 0006 (112-126); `apps/worker/src/handlers.ts` (whole); `packages/core/src/names.ts` 1-40; `echoReply` in `send-policy.ts`; `apps/mock-whatsapp/src/server.ts` 120-160; `packages/channel-mock/src/index.ts` by search only.
- Earlier reviews, where they name U5: `docs/reviews/2026-11-23-adr-0014-review-verification.md` (X11, X13, line 103), `2026-11-23-adr-0014-review.md` D11, `2026-11-22-m3-plan-check-verification.md` V7, `docs/plans/m3-u0-findings.md:100`.

## Findings

### D1. High. Section 3, K table: a tap on a message whose send ended `unconfirmed` can never be matched

- The rule matches `inReplyTo` against the `channel_message_id` of a sent message, once, when the tap is stored.
- A sent message has that identifier only after the worker records the channel's acceptance. `packages/db/src/inbound.ts:163-167` says so for statuses and names the loss (#290).
- A message whose call ended unknown is marked `failed` with `unconfirmed`, and "the customer may have it" (`data-model.md:264`). `send.ts:120-123` also returns `bad-response` on a 200 with no readable identifier. Such a message never gets an identifier.
- So a customer can hold a real fallback with a person button, or a real opt-in question, and their tap is stored with `replies_to` null for good. Under the note's own proposal for U10 (138-144) that tap "does nothing".
- The same happens, briefly, to a tap that arrives between the channel's answer and `recordSend`. A redelivery does not repair it: US-C1 keeps the first row.
- The K table has no case for any of this.

Suggested change:
- Store the raw `inReplyTo` on the tap's row (a checked identifier, at most 128 printable ASCII) and resolve it when the tap is acted on, or store both.
- Add K8 (the answered message has no recorded identifier) and K9 (the identifier is recorded after the tap is stored), with stated results.
- Say that a null `replies_to` means "not matched", not "forged".

### D2. High. Section 3, lines 138-153: the check gives no protection for the core's buttons, and the U10 proposal built on it contradicts the requirements

- The sender is fixed by the signed webhook. Stop, start and person act only on the sender's own contact. A forged `core.*` payload can therefore do nothing the sender could not do with a keyword.
- K1 is satisfied by any message the customer was ever sent, and the note says so (150-153). I assume a client knows the identifiers of messages it received. A customer who forges a payload can then also supply a matching `context.id`, so the check stops no forger.
- What it does stop is honest taps, in the cases of D1.
- The proposal "a tap that answers no message of its own conversation does nothing, whatever its payload" contradicts:
  - `user-stories.md:155` (US-C7, 5): an opted-out contact who "tap[s] the opt-in button" has the opt-out lifted, with no condition.
  - `state-machines.md:33` (step 5) and `:39` (step 11): the stop, start and person buttons are applied, with no condition.
  - `adr/0014-pack-interface.md:162`: the taps that are stored and get no reply are those with "another owner, no owner, or an action the core does not have". Provenance is not in that list.
- "Stop is honoured all the same" is a rule about people, written into a unit that "acts on nothing" (note line 11). It is not U5's to propose without a row.

Suggested change:
- Keep the storage (the plan and the ADR ask for it). Remove the proposal from the note, or move it to a decisions row for U10.
- State that for `core.*` buttons provenance is recorded and not a condition, and that the check matters for a pack's payload in M5.

### D3. Medium. Section 4, M8: a malformed tap is dropped unstored, which can lose a stop and contradicts ADR 0014

- M8 leaves out a tap with no payload, an empty one, one over 256 characters or with a control character, or a title that is empty or over 256.
- `adr/0014-pack-interface.md:162` says a tap with "no owner" "is stored, gets no reply, counts towards the rate limit". An empty or absent payload has no owner.
- The title is display only. Dropping the whole tap for a bad title throws away a valid payload, which may be `core.stop`.
- The only trace is an operator alert that holds a hash (`apps/api/src/sink.ts:99-107`). The customer's conversation shows nothing.
- The 256 limit is Meta's for an interactive button's identifier (note line 28). M6 applies it to a template's `button.payload`, for which section 1 reports no limit.

Suggested change:
- A bad title: keep the tap, with `body` null.
- A bad or absent payload: store the message as an unread kind (`interactive`, or the channel's type), not as nothing.
- Keep "malformed" for a message with no usable identifier, sender or time, as M2 does.

### D4. Medium. Section 4, line 161: "present exactly when `kind` is `button`" can fail the migration, break outbound rows, and poison a webhook

- Existing rows: before 0008 a template quick-reply tap (Meta's type `button`) is stored by `sink.ts:45` as `kind = 'button'` with no payload. Any such row makes the new CHECK fail when the migration runs.
- Outbound: `data-model.md:262` lists `button` and `template` as kinds without a direction. If U8 stores a text with buttons as an outbound row of kind `button`, the constraint refuses it. The note does not limit the constraint to inbound rows.
- Poison: `sink.ts:45` writes `kind` from `channelType` for anything unsupported. The WhatsApp parser cannot emit `button` after U5, but the mock channel and any later channel can. That insert would violate the constraint, fail the transaction, and the channel would redeliver the webhook without end.

Suggested change:
- Scope the constraint: `direction = 'inbound' AND kind = 'button'` exactly when `button_payload IS NOT NULL`.
- Have the migration rename existing inbound `button` rows, and say so.
- Reserve `text`, `button` and `template` as values of `channelType`, in the sink or in the contract tests.
- Add CHECKs on the new columns: `button_payload` length and no control characters; `caption_of IN ('image','video')` only on inbound text; `replies_to` only on inbound `button`.

### D5. Medium. Section 4, `replies_to`: the key is not specified, and "same conversation" is not enforced

- Every reference in this schema carries the tenant, because "a foreign-key check is not subject to row-level security" (`0006_sessions.up.sql:115-122`; `answered_by` is `(tenant_id, answered_by)`). The note gives no key for `replies_to`.
- Nothing would stop a row whose `replies_to` points to another conversation's message, or to an inbound one. K2 and K6 would rest on one query being right.

Suggested change: `FOREIGN KEY (tenant_id, replies_to) REFERENCES messages (tenant_id, id)` at least. Better, add `UNIQUE (tenant_id, conversation_id, id)` and reference `(tenant_id, conversation_id, replies_to)`. Retention nulls `body` and keeps the row (`data-model.md:468`), so no delete rule is needed; say so.

### D6. Medium. Section 1, row 2 and the "not found" list: the ADR's question is answered from an example

- `adr/0014:162` asks U5 to read "whether the channel returns a payload as it was sent". The note's evidence is "In the page's example the `id` is the one that was set" (line 29). An example is not a statement.
- The "not found" list admits doubt only for non-ASCII identifiers (42-44). `readButtonPayload` depends on an exact return for ASCII too: case, surrounding spaces, length.
- Other claims relied on more than the list admits:
  - `context.id` is present on every tap, and is the same identifier the send call returned. All of section 3 rests on this.
  - "A count that can only be stricter than Meta's 'characters'" (85-86). That holds if Meta counts code points or graphemes, and fails if it counts bytes. Not read.
  - The uniqueness rule for titles (case, spaces) is not read.
  - From my own memory, which I could not check: Meta refuses an identifier or title with leading or trailing spaces. S3 does not.
- "Each page was fetched and questioned through a reader that answers from the page; none was read by eye" is weaker than the 2026-11-18 README's "Fetched in full". Limits reported by a summariser are the kind of number that gets invented.
- "The fixtures of that date say the same, page by page" (23-24): only `fixtures/2026-11-18` exists.
- I found no contradiction with the 2026-11-18 README.

Suggested change: move "returned as sent" to the not-found list as "seen in an example only"; add the three assumptions above; give the page URLs and the reading method per page, as the README does; make the fixtures sentence future tense.

### D7. Medium. Sections 3 and "Not in U5": the halves of #222 are named differently from the plan

- Note 146-148: "The second half of #222, that a booking named in a payload belongs to the customer who tapped, is the booking pack's (M5)".
- `plans/m3-ai-core.md:273-274`: "#222 (a forged button naming a booking, M5; its second half, where the stop button appears, is U8's)", and again at `:368`. `plans/m3-u0-findings.md:100` agrees with the plan.
- So #222 has three parts: whose conversation (U5), where the stop button appears (U8), and the booking's owner (M5). The note drops U8's part.
- This matters for row 46, which says "The core then has three buttons: stop, start, person". No M3 text is known to carry a stop button: `guardrail-policy.md:346-355` puts the person button on two texts and the opt-in button on one, and review V7 said the same.

Suggested change: name the three parts as the plan does. In the note and row 46, say `core.stop` is defined and that whether anything sends it is U8's.

### D8. Medium. Section 4, line 165: a tap's `body` is a title the client supplies

- The title in the webhook is whatever the client sent. The ADR's own review raised this (`2026-11-23-adr-0014-review.md` D11). M8 accepts up to 256 characters with no check for control characters, against a `titleMax` of 20.
- `body` is defined as "The text" of the customer (`data-model.md:269`; `IncomingMessage.body`, `inbound.ts:24-25`). Today only `handlers.ts:120` tells text by `kind`. Later code that reads `body` for the emergency phrases (step 4a), the keywords (step 5) or the model's batch would treat a title as typed text.
- The effect stays within the sender's own conversation, so it is not an attack on others. It is a trap for U7 and U10, and a wrong record for T7: "the words the customer chose" is not what the business showed.

Suggested change: write the rule into the note and the data model: only `kind = 'text'` is customer text; a tap's `body` is the channel's echo of a label and never goes to the keyword check, the emergency check or the model. Apply the text rules to it (U+0000 removed, control characters refused). Or leave `body` null and let U8's record of what was sent supply the label.

### D9. Medium. Whole note: the documents this unit must change are not listed

The note changes the meaning of documents that are the authority, and names none of them:
- `data-model.md:262` (`kind`), `:269` (`body` "Null for unsupported types"), `:270` (`button_payload` "Opaque to the core: the pack that registered the button reads it", where the note has the core reading owner and action), plus the two new columns.
- `inbound.ts:22-25` and `packages/channel/src/index.ts:22` ("Only text is read").
- `glossary.md:131` and row 44 (d): both say the 8,000 limit is provisional until U5 reads the channel's limit. U5 read and did not find it, so both now point at nothing.
- `state-machines.md:33` and `:365`: one name for the start and opt-in button, if row 46 is a yes.
- `architecture.md:317`; threat model A7 (the new assumptions) and T7.
- `decisions-needed.md:8`: the header still says rows 36 to 42, with rows up to 46 on the page.

Suggested change: add a "Documents changed with this unit" list.

### D10. Medium. Plan exit criterion missing from the note

- `plans/m3-ai-core.md:159` ends U5's criterion with "a test keeps channel-specific imports out of the core". The note never mentions it. I did not check whether an existing test already does this; `boundary.test.ts` B2 covers the pack interface, which is another rule.
- `adr/0014:200` gives U5 "a test of the owner part" of payloads. The B table tests reading. It does not say that every payload the core builds begins `core.`.
- `plan:338-339` asks for "dated fixtures". The note lists no fixture files.

Suggested change: name the import test, the owner test and the fixture files.

### D11. Medium. Section 2, S table and contract tests: gaps and one untestable case

- Dispatch is not stated. Say it is on `type` alone. Then cover: `type: "interactive"` with `interactive.type: "button_reply"` and no `button_reply` object; `type: "button"` with no `button` object; both `interactive` and `button` present; `type: "text"` that also carries `interactive`; a `context.id` that is present but not an identifier (K5 null, or malformed?); a caption that is not a string or is over 65,536.
- S3 says a title "the same as another's". Say how compared. Exact comparison passes `Yes` and `yes`, composed and decomposed forms, and `"OK"` and `"OK "`. Compare after NFC, case-fold and trim, which can only be stricter.
- S3 checks control characters in a payload and not in a title. A title of spaces only passes. A title with a line break passes.
- "One button too many is refused without a call" (201-202): the contract cannot see whether a call was made (`contract.ts:19-27` has no counter). Assert the result (`accepted: false, retryable: false, mayHaveArrived: false`, code `bad-buttons`) in the contract, and "no call" in each channel's own test.
- `contract.ts:60` expects exactly one message and one status from `signed()`. The subject needs new makers for a tap and a caption; say so.
- "As M2's check of a text's length is" (85-86): there is no such check in the channel. `send.ts:64-88` sends any body; the only length check is the stand-in's, `apps/mock-whatsapp/src/server.ts:142`. So `sendButtons` validates before the call and `sendText` does not, and the 4,096 the note "now read" goes nowhere in the interface.
- B table: "printable ASCII" includes the space, which B3 refuses; say which. Say the split is at the first two full stops, so the rest may hold more. B2's example contains `…`, which is not ASCII.
- K table: add the same button tapped twice (two identifiers, two rows, both K1), so that U10 knows it must be safe to repeat.

### D12. Low. Section 2, the interface: sound, with three changes that would spare U8 a reopening

- A second method `sendButtons` is consistent with the interface's own plan (`index.ts:6-8` foresees a separate template send). I would keep it.
- The channel cannot be asked whether a text fits without sending it. U8 must check every fixed text in every language against every channel's limits, in UTF-16 units, while the rest of the system counts code points (`glossary.md:128`). Export a pure check from `packages/channel` (limits, body, buttons → ok or a code), used by `sendButtons` and by U8's test.
- "The limits are whole numbers above 0" forces every later channel to have buttons (NFR-M2). Allow `null`, or `max: 0`.
- `buttons` names both the limits object and the argument. `buttonLimits` reads better. Add the text limit to the same object.
- `captionOf?: string` should be `"image" | "video"`.
- Not U5's, but nothing says it: what a caller does when a text has more buttons than `max`, or a title too long in one language. The worker today refuses any kind but `text` (`handlers.ts:83`), so after U5 nothing can call `sendButtons`. The plan's "a text with buttons can be sent" is met at the channel only. Say so.
- The core's 256 for a payload is Meta's number inside `packages/core`. A channel with a smaller `payloadMax` would refuse a valid core payload. Low.

### D13. Low. Decisions: row 46 is the right question, but three other choices are made without a row

- Row 46 is fair and its "If no" is honest. Its last sentence asserts three buttons (see D7).
- Made without a row:
  - (a) the U10 proposal of section 3 (D2);
  - (b) a malformed tap is dropped (D3);
  - (c) a tap's title is stored as `body` (D8).
- Not needing a row, in my view: reading a template's quick-reply as a tap in M3 (it avoids a clash of names and nothing acts on it); a document with a caption staying unread (`glossary.md:36` and US-C12, 2 name pictures and videos only). The second is worth one line to the maintainer: a PDF with a typed question gets "I can only read text".
- Row 33 is still unanswered and the unit is built on a yes. The note says so openly.

### D14. Note. Over-design

- Little. Reading M6 (template quick-reply), the general `<owner>.<action>.<rest>` form and a limit of 3 buttons are each asked for by the plan or the ADR, or are cheap.
- No M3 text carries more than one button (`guardrail-policy.md:346-355`).
- `caption_of` has no reader in M3. It is justified only by US-C12, 3 ("stored with its type"), and it does satisfy that; I see no conflict there.
- `replies_to` has no M3 reader that should depend on it (D2).
- The mock's limit of 2 is a good idea and conflicts with nothing in M3.

### D15. Note. Things that are right

- Outbound and inbound identifiers cannot collide: `0003_inbound_events.up.sql:21-24` makes the identifier unique per tenant and direction, and the note looks among sent messages only.
- K3 is testable through row-level security.
- A tap on a message from an ended session, a staff message or a template still matches K1: a conversation is one per tenant and contact (`inbound.ts:155`).
- A tap alone gets no echo (`handlers.ts:120`; `echoReply`), and a caption is answered as text.
- A tap opens the reply window and the session, as `state-machines.md:48-51` says of a message that ends at step 5.

## What I did not check

- Meta's pages. Every fact in section 1 is taken as the author's claim. My two remarks from memory (spaces at the ends of identifiers and titles; whether a client knows message identifiers) are unverified.
- Issue #222's own text, #304, and any GitHub state. I used the plan's and the reviews' descriptions.
- `packages/channel-mock/src/index.ts` and `apps/mock-whatsapp/src/server.ts` beyond the lines listed; the mock's test page; `apps/api` webhook code other than `sink.ts`.
- `packages/db/src/outbound.ts` (`recordSend`, `claimNextSend`) beyond two comment lines. The `unconfirmed` behaviour in D1 is taken from `data-model.md:264` and those comments, not traced in code.
- `sessions.ts` (`beginTurn`, `finishTurn`): that a batch of taps alone is marked handled without a reply is inferred from `handlers.ts`.
- Whether an existing test already keeps channel packages out of the core (D10).
- `AGENTS.md` and its rule for what must be a decisions row; ADR 0012 beyond a search; `architecture.md` beyond line 317; threat model entries beyond a search.
- Contacts whose number or identifier changes hands (#284) in combination with a tap.
- NFR-P1: the cost of one more query per tap in the webhook request.
- Nothing was executed: no tests, no type-check, no migration.

---

## Author's response

The note was rewritten (second version, same file). **The rewritten note
has not been reviewed again;** the review of the code checks it.

| Finding | Answer |
| --- | --- |
| D1 a tap on a message with no recorded identifier | Accepted. The tap keeps the identifier it named, as text; nothing is resolved when it is stored. A function finds the message it answers at the time it is asked, so a send recorded later is found. A message that never got an identifier is never found, and "not found" is said to mean only that |
| D2 the check protects nothing of the core's buttons | Accepted. The proposal for U10 is removed. The note says that for the core's own buttons what a tap answers is a record and not a condition, and why; and that the check is for a pack's payloads (M5) |
| D3 a malformed tap dropped | Accepted. A tap whose payload cannot be kept is stored as an unread message; nothing of a tap's title is kept at all (D8), so a bad title costs nothing |
| D4 the constraint | Accepted: scoped to messages from a customer; rows an earlier version stored under the name are renamed by the migration; the three names this system uses for kinds are not taken from a channel; checks on the new columns |
| D5 the key of `replies_to` | No longer applies: there is no such column (D1) |
| D6 what Meta's pages are relied on for | Accepted: "returned as set" is under "not found" as seen in an example only, with the other assumptions; the pages and how each was read are a table of the fixtures' README; titles and payloads with a space at either end are refused |
| D7 the parts of #222 | Accepted: three parts, named as the plan names them. `core.stop` is defined; whether anything sends it is U8's. Row 46 is reworded |
| D8 a tap's `body` | Accepted, by the second suggestion: `body` is null for a tap and the title is not kept or passed on. The data model says only a `text` message's body is the customer's text |
| D9 documents changed | Accepted: the note lists them |
| D10 exit criteria | Accepted: the import test, the owner test and the fixture files are named |
| D11 gaps in the tables | Accepted: dispatch on `type` alone, with the cases; titles compared after normalising, folding case and trimming; no control character or blank in a title; the contract asserts the result and each channel's own test the absence of a call; `sendText` checks a length too; the B table corrected; a button tapped twice |
| D12 the interface | Accepted: a pure check exported from `packages/channel`; limits that may say "no buttons"; one limits object with the text's limit; `captionOf` is one of two words. The note says nothing in M3 calls `sendButtons` until U8 stores a text with buttons |
| D13 decisions without a row | (a) and (c) are gone; (b) is no longer a drop. A document with a typed question staying unread is said in the pull request |
| D14, D15 | Noted |
