# Design review: M3 U9, second part, the fallback

Reviewed: `docs/design/notes/m3-u9-fallback.md` as first written (commit
`docs(design): the fallback` on `feat/308-m3-u9b-fallback`), before any
code, by a second agent that did not write it, working read-only in a
copy of the repository. The report is unedited. The author's response
follows it.

---

I read the note, `apps/worker/src/turn.ts`, `beginTurn` / `finishTurn` / `sessionHistory` / `HELD_BACK` / `claimNextSend` in `packages/db/src/outbound.ts`, guardrail policy section 4, the four user stories, state machines section 3, U8 note sections 3-6, migrations 0008-0011, `ReplyCheckInput`, and the plan's U9 row. I did not read the body of `checkReply`, the send job, `m3-u9-output-checks.md` beyond its tail, or the trace client; nothing was run.

**D1 — High — sections 2, 5: a tap on the fallback's button gets silence, not a model answer.**
- A tap is stored as `kind = 'button'` with `body` NULL (0008: `button_payload IS NULL OR body IS NULL`).
- `runTurn` and `buildRequest` take only `kind === "text"`, so a batch that is only a tap ends `no-text` with nothing sent.
- Sequence: reply fails, fallback goes out with `person`, customer taps, nothing happens.
- Section 5's "a button's title included" is false for the same reason.
- Change: send no button until U10/U11 handle the tap, or have this unit map the tap to a fixed text.

**D2 — High — sections 1-3: the fallback's path through `finishTurn` and `beginTurn` is unspecified, and the existing rules only cover `assistant-reply`.**
- `finishTurn` drops for a newer message only when `reply !== undefined`. If the fallback is not passed as `reply`, it is stored for batch 1 while message 2 waits.
- `beginTurn`'s discard and `HELD_BACK` name `assistant-reply` only. A pending `system-reply` fallback is neither held nor discarded, and its batch is never reopened.
- Sequence: batch 1 fails, fallback is pending, customer writes again; they get "could not answer" and then an answer to message 2 only. That contradicts US-C11 criterion 2.
- Change: state that the fallback follows the newer-message drop and the hold-back/discard rules, including `reply_discards` and reopening `answered_by`, and that the count is undone on discard.

**D3 — High — section 3: the count is reset by replies the customer never received, and counts fallbacks never sent.**
- Sequence: F1 is sent (count 1); turn 2 passes and is stored (count 0); customer writes, and `beginTurn` discards that reply; turn 3 fails (count 1). The customer saw two fallbacks in a row and there is no handover.
- The reverse also holds: a fallback that expires after 15 minutes or is refused still counts.
- State machines section 3 says "a fallback sent"; US-C6 criterion 2 says "when the second fallback is sent" and that failed replies with no fallback sent do not count. The note states its rule without admitting the contradiction.
- Change: move the count to send time, or reverse it on discard/expiry, and record the deviation in the note.

**D4 — Medium — section 6: the trace update breaks two stated invariants of 0009.**
- 0009 says "A trace is written once… not changed", and that no column holds free text, each having a pattern.
- Row-level security does confine a column-level `UPDATE` to the tenant and the column. But the application could rewrite any of its tenant's traces at any time, including failed to passed, and an unconstrained JSON column can hold reply text after a later bug.
- I found no trace id in `packages/ai/src`, so `generate` appears not to return one. With several rows per `turn_id` after tool rounds, "the call that gave the answer" has no key.
- Change: an insert-only table keyed by trace id with enumerated code columns (or a CHECK on keys and values plus a null-to-value-only trigger), and have `generate` return the trace id.

**D5 — Medium — section 6: the record and the `reply-blocked` log are written before `finishTurn`, outside its transaction.**
- If `finishTurn` returns `lost-lease`, `newer-message` or `session-over`, the trace says blocked but no fallback or count exists. The next try has a new `turn_id` and records again.
- Blocked-rate figures (E12) would be inflated. Change: log after `finishTurn` returns `stored`, and carry that outcome in the record.

**D6 — Medium — sections 2, 7: the fallback's class cannot carry what the note relies on.**
- `messages_turn_made_a_reply` forbids `turn_id` and `language` on `system-reply`, so the fallback is not linked to its turn or trace.
- `finishTurn` writes `sessions.language`, `unsupported_language` and `contacts.last_language` only alongside a stored reply. The note does not say whether a failed reply's reported language is written.
- If it is, hostile output marks the session unsupported "for good". If it is not, the next fixed text ignores it.
- T6 does not say whether it is one message (lead plus fallback body) or two, or which class.
- Change: decide each of these, relax the constraint if needed, and never persist the language of a failed answer.

**D7 — Medium — section 5: the batch given to the checks is not defined against the code.**
- The model receives `boundBatch(texts).texts`, which may be cut or have messages left out, and `buildRequest` does not expose it.
- O3's exception for a time in the customer's batch would differ if the checker gets the full texts.
- Change: return the bounded texts from `buildRequest` and pass exactly those.

**D8 — Low — sections 3, 7: the cap of 100 as a CHECK with "plus 1" fails the transaction at 101.** The turn would throw and retry indefinitely with nothing sent. Use `least(n + 1, 100)`.

**D9 — Low — section 5: `check-error` has gaps.**
- It is outside `ReplyCheckCode`, and the per-check record has no shape for it.
- Building the inputs (for example "today" for a bad time zone) can throw outside the guarded call and escape as a job retry loop.
- A deterministic checker bug would turn every reply into a counted fallback, which becomes mass handover once U11 lands. Change: wrap input assembly, alert on it, and consider not counting it.

**D10 — Low — section 1, T5/T10.**
- T5 stores an `assistant-reply` with a null body but leaves the count unchanged; the state machine clears on "any assistant reply that passes". Say which holds.
- T10 claims a tenant that no longer answers gets nothing, but `answering` is read only before the model call.

**D11 — Note — section 4 and the plan.**
- Plan line 62 gives the `emergency` flag to U9; the note hands all six flags to "U10, U11".
- T4 sends the model's reply beside `asks-if-person`, where O2 says that reply is discarded. This is inherited from U8 and not admitted here.
- The policy's O1 row and US-C10 criterion 1 are not listed as needing an update.

**Could not fault**
- Crash between the check and the store: the retry calls the model and checks again, and nothing unchecked is persisted.
- Double count on job retry: the count is in the `finishTurn` transaction under the lease.
- Two workers racing on the count: same lock.
- A reply after tool rounds: it goes through the same exit.
- T5 sending model text: the body is null.
- An old pending assistant reply plus a new fallback both going out: the old one is discarded or expired, apart from the pre-existing case at the discard maximum.
- Cross-tenant trace update: the existing policy prevents it.

---

## Author's response

All three High findings are accepted, and the note is rewritten. **The
rewrite has not been reviewed again**; the review of the code reads it.

One change answers D2 and D6 together: the fallback is not a message of
another class. It is **the turn's reply**, stored as every reply is,
whose body is empty and whose fixed part (the `lead` U8 added) is the
fallback text. Every rule a reply already has then holds for it without
being written again.

| Finding | Answer |
|---|---|
| D1 (High) | Accepted: the fallback is sent **without** its button until a tap does something (U10, U11). Its wording still says "tap the button below or ask for a person"; U8 already accepts that text without its button where a channel cannot carry one, and the note says this is the same state |
| D2 (High) | Accepted, by making the fallback the turn's reply: dropped for a newer message, held back and discarded, and its batch reopened, by the rules a reply has |
| D3 (High) | Accepted: the count moves when the channel accepts a message. A fallback accepted is plus 1; any other reply of the assistant accepted is 0. A fallback or a reply that is discarded, refused or expires changes nothing |
| D4 | Accepted: no column on the trace. A table of its own, written once, one row for a turn whose answer was stored, each check a code of a fixed shape |
| D5 | Accepted: the row is written in the transaction that stores the turn's reply, and the log line after it |
| D6 | Accepted: one message for T6; the language a failed answer reported is neither stored nor used |
| D7 | Accepted: the request builder gives back the texts it gave the model, and the checks get exactly those |
| D8 | Accepted |
| D9 | Accepted: building the inputs is inside the guard; the record has a place for the error; a line is reported. It counts: the customer did get the fallback |
| D10 | T5 is a reply of the assistant and sets the count to 0. T10's wording is corrected |
| D11 | The note says the flags are read in one place here and that nothing acts on `emergency` until U11; admits that the reply beside `asks-if-person` is sent where the policy says discarded; and lists the policy's O1 row among the documents |
