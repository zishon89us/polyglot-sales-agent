# Design review: M3 U11, the handover record

Reviewed: `docs/design/notes/m3-u11-handover.md` as first written (commit
`docs(design): the handover record` on `feat/310-m3-u11-handover-record`),
before any code, by a second agent that did not write it, working
read-only in a copy of the repository. The report is unedited. The
author's response follows it.

---

I read the note, state-machines sections 1-3, US-C6/C8/C11, guardrail policy section 6 and the O2 row, plan question 1 and the U11 scope, data-model `handovers`, U8 sections 2-4, `sessions.ts`, `beginTurn`/`finishTurn`/`claimNextSend`/`recordSend`/`HELD_BACK`, and the flag and tool-loop parts of `turn.ts` and the send handler. I ran nothing, did not read the U9 note or `texts.ts`, and did not confirm from tool definitions that a tool can change a booking (D5 assumes it can).

**D1 — High — sections 4 and 5: `beginTurn` discards the pending handover text before any step-10 check can run.**
- The G1-G5 text is a pending `assistant-reply`. The customer writes again before it is sent, so `HELD_BACK` holds it.
- The next `beginTurn` discards it, reopens the tap or request via `answered_by`, and bumps `reply_discards`. The note never says S1 sits inside `beginTurn` before that discard.
- The hold is not permanent: S1 marking the batch handled releases it, and the two-discard cap ends the loop.
- The "told again" rule is underspecified: are `sending` and pending-with-`unknown_outcomes` "waiting"? Does the re-tell use the emergency text and recompute hours? If not pinned, the customer is told twice or with the wrong text.
- Change: store every handover text as `system-reply`, as G6 already does, so it is never discarded or held. Keep "told again" only for expired or failed sends, with the exact status set written down.

**D2 — High — sections 5 and 8: a customer who keeps writing is silenced indefinitely.**
- `sessionFor` extends `last_message_at` on every inbound message.
- A customer who writes "hello?" once every 23 hours never has the session end, so the handover never detaches and they get nothing after the one text.
- Section 8's "waits until the session ends, 24 hours after their last message" understates this, and nobody exists to reply.
- Change: for M3, cap the silence from `attached_at` (detach after a fixed period, or re-tell every N hours), and state it.

**D3 — High — sections 2 and 8: an emergency in the triggering batch gets the ordinary text.**
- A batch holds a person-button tap plus "he isn't breathing". G1 skips the model, so G5 never fires and the customer gets "a person will reply" or tomorrow's opening time.
- Section 8 admits only the case of an already handed-over session.
- S3 has the same effect: a turn racing a G6 handover returns the `emergency` flag, and the store step refuses and drops it. That race is the only way M3 reaches H-b with H-e, so the row is dead as designed.
- Change: build U10's step 4a before or with U11, or call the model when a G1 batch holds text. In S3, still apply the flags' reasons and the emergency text.

**D4 — High — sections 2 and 4: `lead` overflows its 700-character check.**
- `automated-assistant` (up to 300) plus a filled `handover-out-of-hours` (up to 700) exceeds `CHECK char_length(lead) <= 700`.
- The insert throws, the turn job fails and retries, and the customer gets silence with no handover.
- U8 says "the unit that first sends one must bound it"; the note does not.
- Policy 6.3 requires the emergency text in the tenant default and English when the contact's language is unsupported. The note drops this without saying; done properly it is about 600 before any prefix.
- Change: bound the composed lead with a test over all text files, define a truncation order (drop the `asks-if-person` answer first), and state the emergency-language decision.

**D5 — Medium — section 2: flags after tool calls.**
- Flags are read only on the final answer (`toolCalls.length === 0`), after earlier rounds ran `runTool`.
- A booking is made, the final answer carries `sensitive-topic`, the reply is discarded, and the customer is never told about the booking.
- Change: on a handover after a state-changing tool, send a code-made confirmation, or hand over without discarding.

**D6 — Medium — section 2: G6 in a second transaction.**
- If the worker stops between the two, the handover is lost for good when the next reply passes, because the count resets to 0. "Finds the count at 3" holds only if the model fails again.
- The second transaction acts on a stale count, and the note does not say what happens if the session is over by then.
- `recordSend`'s count update has no session-open guard.
- Change: decide and make the handover inside `recordSend`, under its lock, with a text callback like `disclose`; require `openSession` to return this session.

**D7 — Medium — sections 2 and 5 (S6): the fallback count.**
- An accepted G1-G5 text is a non-fallback `assistant-reply`, so `recordSend` sets `guardrail_fallbacks = 0`. That contradicts "unchanged".
- After G6 the count stays at 2 or more, so in M4 the first fallback after a hand-back hands over at once.
- Change: reset to 0 when a handover attaches, and say so. D1's `system-reply` fix removes the first half.

**D8 — Medium — section 2: no limit on model-driven handovers.**
- A prompt or model regression that sets a flag on every answer silences every customer for 24 hours or more, with nobody replying.
- Change: a per-tenant handover-rate log line or alarm, and an eval gate (U16) before U11 is switched on.

**D9 — Medium — section 3: the emergency 60-minute rule.**
- The note counts per handover; step 4a says per contact; the policy says once per session.
- It does not say whether `emergency_told_at` is set at store or at acceptance. Set at store, a discarded text is suppressed for an hour.
- Change: per contact, set on acceptance.

**D10 — Low — section 3: the unique-index retry.**
- All triggers hold the conversation lock, so the index cannot fire for a one-conversation contact.
- If it did, the violation aborts the transaction, and "tried again as H-b" needs a savepoint or a new transaction.
- The two-connection H1 test would only test the lock.
- The check must be "session non-null exactly in `waiting` and `in-progress`"; the note says "null unless".

**D11 — Low — section 5: step 10's reply is dropped silently.**
- Step 10 sends a system reply to a Reschedule or Cancel tap in a handed-over session ("booking unchanged").
- S1 drops it without listing it in section 8.

**D12 — Low — section 4: hours.**
- "No business hours at all" does not distinguish null (unset) from set-but-always-closed. The latter has no opening in 8 days and sends "a person will reply".
- The unfillable fallback also sends the in-hours text while closed, which is a false statement.
- `detached_at` for a lazily ended session is unspecified (session end or now); it decides H-c against H-d.
- Daylight saving: a 02:30 opening on the spring-forward day is printed as a time that does not exist.

**D13 — Low — section 6: the fallback's button.**
- Disclosure plus `automated-assistant` plus fallback can pass 500, so D9 of U8 strips the person button. F3a does not cover that composition.
- U8's "happens on neither channel" becomes untrue.

**Could not fault**
- `HELD_BACK` does not hold the text forever.
- Lazy session end is consistent, because every path goes through `openSession` under the lock.
- H-d matches the 14-day row in outcome.
- H-f is unreachable.
- Periods cannot cross midnight, and `24:00` is handled.
- The opening value and a validated support contact pass the filler's rules.
- A pending G6 text cannot outlive its session, given the 15-minute expiry.
- The trigger list matches plan question 1 for U11's share.

---

## Author's response

All four High findings are accepted, and the note is rewritten. **The
rewrite has not been reviewed again**; the review of the code reads it.

| Finding | Answer |
|---|---|
| D1 (High) | Accepted: every text that tells of a handover is a message of class `system-reply`, which is never held back or discarded for a newer message. "Told again" is kept only for a telling that failed or expired, with the statuses written down |
| D2 (High) | Accepted: in M3, where nobody can reply, a handover is detached 24 hours after it was attached, whether or not the customer went on writing, and the assistant then answers again |
| D3 (High) | Accepted: when the person button is tapped in a batch that also holds text, the model is called on the text, so that its flags are read; the handover is made whatever it answers. A turn whose reply is refused because the session was handed over meanwhile still has its flags applied. An emergency in a batch with no text beside the tap, or in a session already handed over, still gets nothing until U10: said in section 8 |
| D4 (High) | Accepted, by D1's change: the telling is the body of a system reply and has no 700 limit; the longest is the disclosure, the fixed answer and a filled text, 150 + 2 + 300 + 2 + 700 = 1,154, under every channel's limit, and a test holds it. The emergency text in two languages is not built: only English exists (row 51); said |
| D5 | No tool changes anything in M3. The unit that adds one (M5) must send a confirmation made by code before a handover discards the reply; in the follow-up issue |
| D6 | Accepted: the handover for two fallbacks in a row is made inside the step that records the send, under its lock, only while the session is still the open one |
| D7 | Accepted: the count is set to 0 when a handover is attached; a system reply does not move it |
| D8 | A line `handed-over` with the reason is reported for every handover made, so that a model that hands everyone over is seen. No limit is built; an eval before this is relied on is U16's; in the follow-up issue |
| D9 | Accepted: once in 60 minutes for a contact, counted from a telling that is waiting or was accepted; one that failed or expired does not count |
| D10 | Accepted: the lock is what keeps H1; the index is the table's own guard and is tested as a constraint. The check is "a session exactly in `waiting` and `in-progress`" |
| D11 | Said in section 8: there are no bookings in M3 |
| D12 | The in-hours text says "A person will reply to you here" and nothing about hours, so it is what is sent when no opening can be given; said, with the two other points |
| D13 | Said in section 6: with the fixed answer before it, the fallback can lose its button on the smallest channel; its words still say to ask for a person |
