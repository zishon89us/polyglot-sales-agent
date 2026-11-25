# Design review: M3 U8, fixed texts and the disclosure

Reviewed: `docs/design/notes/m3-u8-fixed-texts.md` as first written
(commit `docs(design): fixed texts and the disclosure` on
`feat/307-m3-u8-fixed-texts`), before any code, by a second agent that
did not write it, working read-only in a copy of the repository. The
report is unedited. The author's response follows it.

---

# Review of `docs/design/notes/m3-u8-fixed-texts.md` (U8) and decisions rows 50, 51

**Read:** the note in full; rows 50–51; US-C5, C7, C11; plan rows U8–U12 and the U8/U9 sections; guardrail policy sections 7–9 and G13; `packages/db/src/outbound.ts` (`finishTurn`, `sessionHistory`, `HELD_BACK`, `claimNextSend`, `recordSend`, the discard in `beginTurn`); `send-policy.ts`; the send job in `handlers.ts`; the reply exit in `turn.ts`; `checkButtonMessage`/`checkText`; both channels' limits; `0010_turn.up.sql`; `FORWARD` in `inbound.ts`; `Dockerfile`/`.dockerignore`; prompt v1 and `prompts/README.md`.
**Not checked:** issues #222/#107/#212/#184 (no network), US-C6 criteria 5–6 in depth, `m3-u7-turn.md`, the glossary, state-machines beyond one grep, ADRs. Nothing was run.

## Findings

**D1 — High — section 4, D2/D3: "never not at all" fails on an asynchronous failure.**
D2 marks the session told when the channel *accepts*. `FORWARD` in `packages/db/src/inbound.ts:181-188` later moves a `sent` message to `failed` on a failure receipt. The session stays marked, so the next message carries no disclosure, though the customer got nothing. D3 covers only failures known at the call.
*Change:* when a failure receipt lands on a message with `disclosed = true`, clear `sessions.disclosed_at` in that transaction (unless another disclosed message of the session is sent/delivered/read). Add this as a case.

**D2 — High — section 4, D10, with P4: the "cannot happen" claim is wrong on the mock.**
P4 sends disclosure + automated-assistant text + reply: 400 + 2 + 400 + 2 + 1,200 = 2,004 > `MOCK_LIMITS.textMax` 2,000 (`packages/channel-mock/src/index.ts:38`; `REPLY_MAX` 1,200 at `packages/core/src/model.ts:31`). `bad-body` is not retryable (`refusedUnsent`, `packages/channel/src/index.ts:162`), so the session's first reply is lost. WhatsApp (4,096) is fine; without P4 it is 1,602.
*Change:* have the reader enforce disclosure + automated-assistant + 4 + `REPLY_MAX` ≤ the smallest `textMax`, or drop the automated-assistant text in P4.

**D3 — High — section 2 ("400 and 16 are chosen so that…") and D9: the fit claim is false.**
Disclosure 400 + 2 + buttoned text 400 = 802 > the mock's `bodyMax` 500 (WhatsApp 1,024 is fine). Under D9 the buttons silently go on exactly the first message of a session, e.g. `unsupported-type` answering a first image. Nothing in F1–F8 bounds the sum.
*Change:* add a rule: disclosure + 2 + each buttoned body ≤ the smallest `bodyMax`, per language, tested against every channel's limits.

**D4 — Medium — section 5, P2: `system-reply` does not fit the existing code or schema.**
- `messages_turn_made_a_reply` (`0010_turn.up.sql:19-22`) allows `turn_id`/`language` only on `assistant-reply`, so the P2 message cannot name its turn (trace link, G1's "language its own turn reported"). Section 7 lists no constraint change.
- `finishTurn` inserts only `assistant-reply` (`outbound.ts:268-270`).
- `turn.ts:235-236` exits `empty-reply` before any flag is read.
- Discard and `HELD_BACK` apply only to `assistant-reply` (`outbound.ts:167`, `:552`), so a P2 message is not dropped for a newer message (US-C11, 2) while P1 is.
- `sessionHistory` excludes `system-reply` (`outbound.ts:346`), so the next turn sees the question unanswered.

*Change:* store P2 as `assistant-reply` with an empty body and a lead, or spell out the constraint change, discard rule and history rule.

**D5 — Medium — section 6 with D9: the record can say buttons were shown when they were not.**
`messages.buttons` is stored at write time "because what the customer saw should be on record"; D9 strips buttons at send time. The send job today calls only `sendText` (`handlers.ts:86`).
*Change:* record at send whether buttons went (a column, or null `buttons` under D9).

**D6 — Medium — sections 5 and 1: prompt v2 with no eval contradicts `AGENTS.md` section 6.**
"No change to AI behaviour merges without an eval run attached to the pull request" (AGENTS.md ~l.320-321). The note says no eval exists, but no decisions row asks for the exception; row 51 covers only English. Guardrail section 9 point 7 ("say it is an automated assistant if asked") must also change; section 8 does list this.
*Change:* add a decisions row for the waiver, or keep v1 and prefix the text regardless.

**D7 — Medium — section 5: other flags and unchecked reply text before U9.**
P1 sends the model's reply beside the fixed text with no output check; the reply may itself say what G13 forbids. The note is silent on `asks-if-person` together with `emergency`, `asks-to-stop` and the rest.
*Change:* state that other flags are ignored until U9/U10, and list the unchecked reply under section 9.

**D8 — Medium — section 2, placeholders: limits and missing values after filling.**
F3 bounds the template, not the filled text. `support_contact` may be 254 characters (`0007_profile.up.sql:60`), is owner-supplied, and is null until a profile is loaded (`data-model.md:72-73`). So `handover-out-of-hours` can exceed 400, and "a place not given is refused" means no message at all. Only `{{` is refused in a value; control characters and line breaks are not.
*Change:* apply F3's character rules and a stated maximum to the filled text, and say what is sent when the contact is null.

**D9 — Low — D4 against D5: a kept lead can disclose twice in a session.**
A reply given its lead, refused retryably, returns to `pending` and can be held back (`outbound.ts:551-560`). A newer message is then sent with the disclosure and marks the session; the first is later sent with its kept lead. A discarded row also keeps `disclosed = true`.
*Change:* recompute the disclosure part at each claim; keep `disclosed` meaningful only for accepted rows.

**D10 — Low — section 3: `contacts.last_language`.**
The data model already has it (`data-model.md:125`) but no migration does; fine. "Set with the session's" copies an unsupported language (`finishTurn` stores any non-`und`, `outbound.ts:281-286`), wiping a supported one known earlier.
*Change:* set it only for supported languages.

**D11 — Low — F7.** "No digit" is undefined: ASCII or any `\p{Nd}` (Arabic-Indic, Devanagari, Bengali)? State `\p{N}`.

**D12 — Low — units.** The channel checks count UTF-16 `.length` (`index.ts:92-93`, `:132-133`). F3/F6 say "characters" without a unit; say the same one.

**D13 — Note — `.dockerignore` excludes `docs`.** `texts/` is copied (`COPY . .`), but the `texts/README.md` gap-list test cannot rely on anything under `docs/` in the image.

**D14 — Note — D7.** A staff member's first message would be prefixed "an automated assistant is replying", untrue for that message. US-C5, 1 does say "any kind"; flag it for M4.

**D15 — Note — row 50 / table.** The fallback and unsupported-type texts carry the person button, but U11 is conditional (plan row U11) and acting on it is M4 (user-stories l.550). The note does not say what a tap does if U11 is not built.

## Could not fault

- Unknown outcome, superseded `recordSend`, worker death, stale `sending`, retry and expiry: each leaves the session unmarked or resends with the lead. A receipt cannot match before the record (`inbound.ts:176-179`).
- One message per conversation in flight (`OLDEST_WAITING` with the conversation lock).
- Row 51 and G3 state the US-C5, 2 gap honestly; row 50 states the US-C7, 1 limit and agrees with the plan.
- The eleven names match the plan's U8 list and guardrail section 7.
- Title limit 16 fits both channels; F6 reuses the channel's check.
- The worker can find `texts/` the way it finds `prompts/` (`main.ts:67`).

---

## Author's response

All three High findings are accepted and the note is rewritten. **The
rewritten note has not been reviewed again.**

| Finding | Answer |
|---|---|
| D1 (High) | Accepted. When a failure arrives later for a message that carried the disclosure, the session's mark is taken off in that transaction, unless another message of the session that carried it has reached the customer. A new case, D2a |
| D2 (High) | Accepted: the claim was wrong. The limits are now 150 for the disclosure and 300 for every other text, the reader checks the sums against the smallest channel, and a test ties those numbers to both channels' own limits. The longest first message is 150 + 2 + 300 + 2 + 1,200 = 1,654, under 2,000 |
| D3 (High) | Accepted: with the same limits, the disclosure and a text with buttons are 452 at most, under 500, and the reader refuses a file where they are not |
| D4 | Accepted: there is no `system-reply` here. The message is the assistant's reply with the fixed text as its lead, and an empty body when the model wrote nothing; the flag is read before the empty-reply exit. The history holds bodies only, so a later turn does not see the fixed answer; said |
| D5 | Accepted: when the buttons are not sent, the row's `buttons` is set to null in the transaction that records the send |
| D6 | Accepted, by the reviewer's second way: **the prompt is not changed.** Version 1 stays; code puts the fixed text before whatever the model replied. The model's own reply may say the same again; that is the price of not changing a prompt that cannot be evaluated yet |
| D7 | Accepted: the note says the other flags are still dropped and the reply beside the fixed text is still unchecked, until U9 and U10 |
| D8 | Accepted: a filled-in value is at most 254 characters with no line break or control character, the filled text at most 700, and a value that is missing is refused, so no message with an open place is sent. What U11 sends for a tenant with no support contact is U11's; a tenant that answers has one, since it is a required setting |
| D9 | Accepted: the disclosure is its own column, set or cleared each time the message is taken to be sent, never kept from an earlier try |
| D10 | Accepted: only a supported language becomes the contact's last |
| D11, D12 | Accepted: any character Unicode calls a number; lengths are UTF-16 units, as the channels count |
| D13 | The list of gaps is in `texts/README.md` and its test reads nothing under `docs/` |
| D14 | Noted for M4 in the note: a staff member's first message would be prefixed as the story's words ask, which is untrue of that message |
| D15 | Noted: this unit sends no text with a button. What a tap on the person button does is U10's and U11's |
