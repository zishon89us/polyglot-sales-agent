# Verification review: state machines

Date 2026-11-16. Files read: `docs/design/state-machines.md`, `docs/design/models/reminder_timing.py` (also run), `docs/requirements/glossary.md`, `docs/requirements/user-stories.md`. Deliberately not read: everything under `docs/reviews/`, `docs/adr/`, `docs/STATUS.md`, any `review-*.md`, git history, issues and pull requests. Two disclosures: (1) my environment placed the content of `AGENTS.md` in my context; I did not use it for any finding. (2) A directory listing I ran to confirm the report folder exists showed the file names (not the contents) of four earlier reviews; I did not open them.

## Summary

| Severity | Count |
| --- | --- |
| High | 4 |
| Medium | 21 |
| Low | 8 |

High findings: V1, V2, V3, V4.

The tables are a real improvement over prose and most of the core paths hold: H1 and H3/S1 survived every counterexample I tried, the nine worked reminder examples match the model exactly, the pseudo-code and the Python implement the same rule, and twelve of the thirteen "Decisions made here" rows agree with the stories and the glossary. The defects cluster in three places: the `followed-up` handover state against the order of checks (H2 can be broken), button replies to a reminder (they have no place in section 1), and the reminder floor (the rule schedules exactly on the floor and then withholds anything a second late). The document's claim that it covers "every state and event pair that can occur" is not yet true; several dashes mark events that can occur.

## Findings

| ID | Severity | Location | Finding | Suggested resolution |
| --- | --- | --- | --- | --- |
| V1 | High | §2 transitions, `followed-up` column; §1 steps 5–8; Decision 1; US-C14 c13, c15, c17 | The `followed-up` state is inconsistent with the order of checks. (a) The table says any customer message moves `followed-up` → `waiting`. In §1 a message that ends at step 5 (opt-out or opt-in keyword), step 6 (tenant not answering) or step 7 (contact paused) never reaches step 8, so the handover stays `followed-up` although the customer wrote. (b) Step 4 has already opened the reply window for that message, so the stated reason for the dash in "Staff message / `followed-up`" ("the reply window stays closed until the customer writes, and that message moves the handover to `waiting`") is false; a call also opens the window (glossary "Reply window"). Staff can then send a staff message from a `followed-up` handover and the table gives no result. (c) Decision 1 and US-C14 c15 say a staff message from a `followed-up` handover attaches it to the current session; the table says it cannot occur, and the diagram has no `followed_up → in_progress` edge. (d) The 7-day row is guarded "no customer message". After (a) a customer message exists, so read literally the timer never fires and the handover leaves only by staff close or a later message: a counterexample to H2. Read the other way, the handover is closed `no-response` although the customer did respond. | Decide what "customer message" means for the handover (stored at step 4, or reaching step 8) and state it. Either move the `followed-up` attach before steps 6 and 7 (keeping no reply while not answering or paused), or add explicit rows for "customer message that ended at steps 5–7". Replace the dash with the Decision 1 transition (→ `in-progress`), add the edge to the diagram, and reword the 7-day guard so it is decidable. |
| V2 | High | §1 (no step); §5 "Customer taps Confirm, Reschedule or Cancel"; §4 row 1; US-B3 c8, c9 | Button replies to a reminder are not placed in the "single order". Steps 5 and 10 name only the opt-out/opt-in button and the person button. A Confirm, Reschedule or Cancel tap therefore: ends at step 6 when the tenant is not answering; ends at step 7 when the contact is paused; ends at step 9 in a handed-over session (it only "joins the waiting session"); at step 12 it is undefined whether a button reply is "text" (the glossary says it is a supported type, step 12 tests for "text"), so it may get the unsupported-type reply and count towards `unsupported-content`; at step 13 in degraded mode it is marked `awaiting-retry` and gets the fallback, though US-B3 c8 needs no model. In each case the booking is not confirmed or the cancel is not acted on, while §4 and US-B3 c8 state the transition unconditionally. A customer who taps Cancel in a handed-over session can believe the booking is cancelled when it is not. | Add an explicit step for reminder buttons (by code, like the person button) and decide its position relative to steps 6, 7, 9 and 13. State whether Confirm is applied in a handed-over session, for a paused contact and for a tenant that is not answering. State in step 12 that a button reply is not an unreadable batch. |
| V3 | High | §5 timing rule, send-time check 5; glossary "Reminder lead time" range 1–72 h; US-B3 c5 | There is no tolerance at the 60-minute floor. The timing rule schedules a reminder exactly at `start − 60 min` in ordinary cases: always when the lead time is 1 hour (the allowed minimum; model: booked Mon 10:00 for Tue 15:00 → Tue 14:00), and whenever the result is `Q.end` with `Q.end = start − 60 min` (model: booked Tue 02:00 for Tue 09:00, lead 2 h → Tue 08:00; booked Tue 07:00 for Tue 09:00, lead 1 h → Tue 08:00). Check 5 then withholds the reminder as `too-late` if "the time" is later than 60 minutes before the start. Any real scheduler runs the check at least a moment after the scheduled instant, so with a 1-hour lead time every reminder is withheld, or sent only by accident of clock granularity. The granularity of the comparison (instant, second, minute) is not stated, so the rule cannot be tested at its boundary. In the other direction, check 5 runs before the message is handed to machine 7, where it can be `held` up to 10 seconds behind the previous message and retried after 2 and 8 seconds, so "a reminder is never sent less than 60 minutes before its appointment" is not guaranteed by the tables either. | Compare the scheduled time, not the wall clock, when the reminder was scheduled on time; or define a tolerance (for example, due time truncated to the minute and a stated grace period); or schedule with a margin before the floor. State where the floor is measured (check time or channel acceptance) and add boundary rows to the worked examples. |
| V4 | High | §2 row "Escalation time elapses"; US-C14 c4, c6, c7; glossary "Handover escalation clock" | Escalation is defined only in `waiting` and is a dash in `detached` and `followed-up`. The clock counts business hours only, and a session ends after 24 hours of silence. A handover made when the business is closed for more than 24 hours (Friday evening, weekend closed) is `detached` before any business time has been counted, so by the table it is never marked overdue. US-C14 c4 applies to any "handover with no staff message"; c7 says counting "continues at the next opening time"; c6 ("becomes overdue after the contact's reply window has closed") describes exactly this case and can otherwise occur only in a narrow corner (V5). The handovers that have waited longest are the ones never flagged. Also undefined: whether the clock restarts, continues or stays spent when a handover returns to `waiting` after `detached` or `followed-up` ("once per handover" suggests it is never overdue again). | Define the escalation row for `detached` (mark overdue, no holding message, per c6) and for `followed-up`, or change c4/c6/c7 to say escalation stops when the session ends. Define the clock on re-attachment. |
| V5 | Medium | §2 row "Staff send follow-up"; US-C14 c10 | Follow-up availability is keyed to the state, but the requirement keys it to the reply window. (a) `waiting` with a closed window can occur: the session is extended by any outbound message (the system reply, the holding message, a reminder or booking-change notice sent in that session), the window only by inbound ones. Example: customer writes at T and is handed over; a reminder template goes out at T+20 h; the session now runs to T+44 h, the window closed at T+24 h. For 20 hours staff cannot write (free-form refused, §7) and the follow-up is a dash whose justification ("reply window is open") is false. (b) `detached` with an open window can occur (the customer is talking to the assistant in a later session); the table lets the template go out, c10 requires the window to be closed. | Guard the follow-up row on "reply window closed" and allow it in `waiting`; or state that a session's activity counts inbound messages only for this purpose. |
| V6 | Medium | §2 rows "Staff send follow-up", "14 days"; §7 `held`; US-C14 c18 | A follow-up that is held (quiet hours, daily limit) is neither "sent" nor "withheld or failed". The table does not say what state the handover is in meanwhile, whether the action can be pressed again (two follow-ups), or what happens to the held template if the handover leaves `detached` first (new trigger → `waiting`, staff message → `in-progress`, staff close, 14-day expiry, contact opts out, contact deleted). US-C14 c18 excludes the 14-day expiry while a follow-up is pending; the table has no such guard, so a handover can expire and the template still go out at 08:00. | Add a "follow-up pending" condition (or state) with a row per event; add the c18 guard to the 14-day row. |
| V7 | Medium | §6 row "Opt-out keyword, button, or recognised free-text request"; §1 step 5; US-C7 c2 | §6 says a recognised free-text opt-out is "applied at step 5 … whether or not the tenant is answering". Free text is recognised by the assistant (US-C7 c2), which runs at step 14. It cannot be applied at step 5, and it is never recognised in a handed-over session (step 9), for a `followed-up` contact (step 8), for a paused contact (step 7), while not answering (step 6) or until retry in degraded mode (step 13). US-D3 c7 and §7 ("only messages in the session are opt-out requests") depend on that recognition. The same applies to the free-text opt-in in the next row. | Say that step 5 covers keywords and buttons only, and that free-text requests are recognised at step 14; state what happens to a free-text opt-out in a handed-over session (staff action, or a code-level check). |
| V8 | Medium | §1 step 5 and step 11 | Step 5 is under-defined in two ways. (a) "Is it an … keyword" does not say whether the whole message must equal a keyword or may contain one; with trace B8 the result differs (person request dropped, or handed over). (b) "Ends, unless the batch holds other text": no batch exists at step 5 (it forms at step 11), and "other text" could mean other messages or the rest of the same message. It is also not stated whether the keyword message is passed to the model with the rest of the batch; if it is, the model may recognise it again as a free-text request and a second confirmation is sent (US-C7 c1 says one). | Define the match (exact, after normalisation), define "batch" at step 5 as the unanswered messages waiting at step 11, and say the keyword message is excluded from the model input. |
| V9 | Medium | §1 steps 5 and 7; US-C17 | The rate limit sits after step 5, and nothing says whether messages that end at steps 5 or 6 count towards the 20. A flood of opt-out and opt-in keywords is applied message by message, each with a confirmation and (for opt-in) a new consent record, with no limit: the system-reply and storage cost US-C17 exists to prevent. Applying an opt-out while paused is right; confirming without limit is not. | Keep applying the keyword at step 5 but state that all inbound messages count towards the limit and that confirmations are suppressed while paused or repeated. |
| V10 | Medium | §1 step 7 and "Consequences"; US-C17 c3; §2 `waiting`/`in-progress` "Customer message" | (a) "Not handed over until the pause ends" can mean the request is remembered and acted on when the pause ends, or dropped. The table ("Ends") implies dropped, the sentence implies deferred; the customer gets no feedback either way. (b) Step 7 precedes step 9, so in a handed-over session a paused contact's messages do not "join the waiting session", contradicting the unconditional "Joins the waiting session" cells in §2, and a customer in a fast exchange with staff can receive the rate notice. (c) Whether messages during the pause extend it, and whether the stored messages are answered after it (US-C11 c2 "all unanswered messages"), is not stated. | State that the request is dropped (or deferred); decide whether the pause applies in a handed-over session; state (c). |
| V11 | Medium | §8 table and P1; §1 step 7; US-C15 c3, c4 | P1 holds as worded on the main traces (see section A) but three interactions are undefined. (a) A marked session whose contact becomes paused: the 60-second retry would send a reply and the 15-minute row would create a handover and notification, both forbidden by step 7 and Decision 13; or P1 is broken. (b) "The customer's latest message" is not defined for messages that end before step 13: a voice note (step 12), a keyword (step 5), a message during a pause. If they count, they postpone the handover. (c) Because the clock restarts on every message, a customer who re-asks every 14 minutes during an outage is never handed over; the only way out is the person button. P1 is satisfied by its wording and the customer waits without bound. | Define the clock from the oldest unanswered message, or cap the total wait; add rows for "contact paused" in §8. |
| V12 | Medium | §7 pre-send table; glossary "Message classes", Service notice | The glossary lists three service notices; §7 has rows for two. The "retried answer after a provider failure" is missing, so its checks (blocked if the contact opted out after asking; reply window) are not in the table that claims to cover every class. If the retried answer is blocked by an opt-out, §8 does not say whether the mark clears; by the table the session is then handed over at 15 minutes for a contact who has just opted out. | Add the row; add "retried answer blocked" to §8. |
| V13 | Medium | §5 states and transitions; §7; glossary "Withheld reason"; US-C9 c5 | "Send time reached → `sent` or `withheld`" omits two outcomes the same section and §7 produce: queued for the daily limit (check 4), and send failed (permanent error, three temporary errors, or a later `failed` status). The reminder has no state for either, so "Booking moved" and "Booking cancelled" are undefined for a queued reminder and a failed reminder is neither `sent` nor `withheld`. The reason `limit-reached` exists in the glossary but no path produces it. The `cancelled` state has no column in the transitions table. | Add `queued` and `failed` (or say which existing state each maps to), give `cancelled` a column, and either use or remove `limit-reached`. |
| V14 | Medium | §5 send-time checks; §7 "Business-initiated / Quiet hours: per-kind rule" | Quiet hours are checked at send time only on the queue-release path (check 4). A reminder scheduled for `Q.start − 1 minute` that is processed one minute late for any other reason (worker restart, backlog, the 10-second ordering hold plus retries near the boundary) is sent inside quiet hours; no check stops it. The one-minute margin makes this the likely failure, not a rare one. | Add a quiet-hours check to the send-time list for every path, with the same "hold to the end, then check 5" rule. |
| V15 | Medium | §5 row "Customer taps Confirm, Reschedule or Cancel"; §4 row 1; US-B3 c8 | The row is a dash for `none`, `scheduled` and `withheld`, but the event can occur there: after a move, the sent reminder (with its buttons and the old time) is still in the customer's chat while the reminder state has been recomputed to `none`, `scheduled` or `withheld`. By §4 a Confirm tap on the stale reminder confirms the booking at its new time, which the customer may not have seen (staff moves). §4 also has no row for a Confirm tap after the start (`booked`, `confirmed`, `attended`, `missed`), which a late tap produces. Separately, a reminder can be sent twice for the same appointment time: sent early at `Q.start − 1 min`, booking moved away and back before `due`; the rule schedules again at `Q.end` (model case 2 gives Tue 08:00 after a Mon 21:59 send). | Tie each button to the appointment time it was sent for and define the stale case; add an "after the start" row; record the last time a reminder was sent for and skip a second send for the same start. |
| V16 | Medium | §4 invariant B1 | (a) B1 counts only `booked` and `confirmed`. A 60-minute appointment at 10:00 marked attended at 10:05 stops counting while its interval still runs, so a new booking at 10:30 passes the check although the resource is occupied. (b) B1 says "at every instant", but an owner can lower a service's capacity, lengthen its duration (intervals grow) or lower the tenant total (US-D2 c1, US-D11); no create or move happens, the invariant is broken and no table row covers it. (c) "The check and the write happen in one transaction" does not by itself stop two concurrent creates that each read the same count; that needs serialisable isolation or a lock on the service, and on the tenant when the total is set, because creates on different services share the tenant total. The move case itself is sound: the invariant is evaluated on the state after the move, so a booking does not collide with its own old interval. | Count `attended`/`missed` until the interval ends; restate B1 as "no create or move may increase a violation" with a row for settings changes; name the isolation level or lock. |
| V17 | Medium | §3 marks table; US-C6 c7 | The marks have no behaviour after a hand-back in the same session. The assistant reply count is never cleared and "reaching the turn cap hands over"; after staff hand back at 30, US-C6 c7 says the assistant answers the next message, which makes 31. Likewise the guardrail count at 2 and the unreadable count at 3: the table lists no value beyond the limit and no reset on handover or hand-back. Either every later message hands over again, or the limits stop applying; neither is stated. Also unstated: whether a provider-failure fallback or a system reply between two guardrail fallbacks breaks "consecutive". | Add "handover" or "hand back" to "Cleared by", or state the behaviour above the limit. |
| V18 | Medium | §7 "Sending" table; US-C18 c6 | The ordering rule releases the next message when the previous one is `delivered` or 10 seconds after it was `sent`. If the previous message is `failed` without ever being `sent`, `withheld`, `discarded`, or `held` for quiet hours or the daily limit (a follow-up waiting for 08:00), the condition is never or not soon met; read literally an assistant reply waits behind it. Transitions out of `pending` are not in the table, and out-of-order status events (`read` before `delivered`, `failed` after `delivered`) are not defined. A `sent` message with no status event has no exit and is not marked terminal. | Define "previous message" as the previous one handed to the channel, and add rows for the other predecessor states and for status-event ordering. |
| V19 | Medium | §2 "New handover trigger" row; US-C6 c5, c6; US-C14 c1, c2, c13 | The `followed-up` cells say "tell the customer a person will reply; notify staff". The `detached` + trigger cell, which also hands a session over, says neither, and the absorbed-trigger cells (`waiting`, `in-progress`) do not say whether the customer is told again. US-C6 c5/c6 apply to "any handover" and c6 requires a different message outside business hours (next opening time and support contact); the table's fixed "a person will reply" contradicts c6 for a re-attachment outside business hours. | State the customer message and staff notification for every cell that sets the handed-over mark, by reference to US-C6 c5/c6. |
| V20 | Medium | §6 effective-state table; US-C13 c2, c3 | (a) US-C13 c2 records consent "to messages about that booking"; §6 treats any one record as consent to every business-initiated message. A contact who once booked in chat then gets a reminder for a later manual booking on which staff deliberately did not tick consent (c3: "without the tick no consent is recorded"). (b) The opt-in row has no precondition: an opt-in keyword from a contact who never opted out and never consented adds a consent record. How surprising that is depends on the keyword list, which is not in the files read. | Decide whether consent is per contact or per booking and align c2; restrict the opt-in row to opted-out contacts or state that it applies to all. |
| V21 | Medium | §1 steps 5–6; §5, §7, §9; US-C1 c6 | (a) Nothing says what happens to outbound messages while the tenant is not answering: reminders (send-time checks do not test it; with rejected credentials the send fails and V13 applies), staff messages in a handed-over session that step 6 says is still collecting messages, the holding message, the follow-up. (b) An opt-out keyword sent to a tenant that is not answering ends at step 5 and is never marked `received-while-not-answering`, although US-C1 c6 marks every such message; Decision 3 lists US-C1 as changed but c6 has no exception. | Add a tenant-state row to §7; either mark at step 4 or add the exception to US-C1 c6. |
| V22 | Medium | §2 row "Staff message"; glossary "Handover" (answered) | It is not stated whether `waiting` → `in-progress` happens when the staff message is submitted, accepted by the channel, or delivered, nor what happens if it is blocked (§7: opt-out, closed window) or later `failed`. A handover can end `answered` although the customer received nothing. | Define the event as "staff message reaches `sent`" and add a row for a staff message that fails. |
| V23 | Medium | §4 "Staff move", "Staff cancel"; §7; US-D12 c2, c3 | Booking-change notices have timing, consent and opt-out behaviour but no table. Not covered: a booking moved twice while the first notice is held to the end of quiet hours (two notices, the first stale); a notice for a booking the staff cancel or move after its start (§4 allows both for a `booked` booking with no outcome); whether consent and opt-out are checked at creation or at send, as Decision 11 settles for reminders. | Add a small notice table (states, supersede rule, send-time checks). |
| V24 | Medium | §5 send-time check 3; §7 "Reply window closed: sent as a template"; US-C9 c1–c3 | Check 3 withholds a reminder when no approved template exists. §7 and US-C9 require a template only when the reply window is closed. For a contact whose window is open, the tables give two results: withheld `no-template` (§5) or sent free-form (§7, US-C9 c1). | State whether reminders are always templates; if not, apply check 3 only when the window is closed. |
| V25 | Medium | §5 timing rule; model; US-B5 c5 | US-B5 c5 requires the reminder to be "timed from the appointment's local start time" across a daylight-saving change. The rule says `due = start − lead` without saying whether the subtraction and the quiet-period test are in elapsed or local time, and the model uses naive datetimes, so the criterion is not covered. On a change day the quiet period is 9 or 11 elapsed hours and `Q.end ≤ start − 60 minutes` changes meaning. | State the arithmetic (I suggest: subtract elapsed time, test quiet hours in tenant local time) and add a daylight-saving example to the model. |
| V26 | Low | §2 diagram | Against the table, the diagram omits: the four "contact deleted" edges (three to `closed_unanswered`, one `in_progress → answered`) and "new trigger" on `followed_up → waiting`. The table has no row for creation (`[*] → waiting`). All other edges match the table as written (and so repeat the V1 omission). | Add the edges or a note that deletion is not drawn. |
| V27 | Low | §2 H1, H2 notes | H2's note says the `waiting` ↔ `detached` cycle happens "only when the customer writes again"; a staff take-over (reason `staff`, US-D3 c2) of a session started by an outbound message is also a trigger. H1 has no stated enforcement for two triggers arriving at once for a contact with no open handover (B1 states its transaction; H1 states none). | Reword; state a uniqueness constraint for open handovers. |
| V28 | Low | Model; §5 pseudo-code | Neither the pseudo-code nor the model handles quiet hours set to "none". The model has no way to express it; equal start and end are treated as a 24-hour quiet period (`quiet_period(Tue 03:00, 00:00, 00:00)` returns Tue 00:00 to Wed 00:00). | Add an optional "none" to the model and one example. |
| V29 | Low | §4, §5, glossary | Wording. §4 refers to machine 5 "rescheduled"; the event is named "Booking moved". §5 clears "the booking's confirmed state" in the `scheduled` cell, where it can only be set through a stale button, and not in the `sent` cell, where it normally is (machine 4 clears it in both). The fixed value is still named "Reminder floor after quiet hours" though Decision 10 applies it always. US-B3 c1 says "one reminder is scheduled" for cases where the rule returns `withheld` (c7). "Earlier than the change cut-off" and "inside the cut-off" leave the exact boundary unassigned. Glossary "Message status" lacks `pending`, `held`, `discarded`. | Align the wording. |
| V30 | Low | §8; US-C15 c6, c8 | The emails on entering and leaving degraded mode are in the story and not in §8. C6 says "for one provider"; §8 is service-wide. A failed retry of an already-marked session does not "mark" it again, so by the wording it does not count towards the trigger; whether it should is not stated. Whether a retry is one model call or three is not stated. | Add rows or state they are out of the machine. |
| V31 | Low | §4 | Creation is not an event in the table. Rows for "customer asks to change or cancel" do not cover a booking past its start with no outcome (US-B4 c5 "no future booking" against c6 "starts within the cut-off"). Staff move and cancel have no "before the start" condition. | Add the rows. |
| V32 | Low | §1 step 11; US-C11 c2 | "If another message arrives, restart … and discard any unsent reply" has no bound. The glossary's 10-second cap limits the window, not the discarding during generation, so a customer who sends a message every few seconds is never answered. | State a bound, or that the cap also limits discards. |
| V33 | Low | §5; Decisions 9, 11 | Observations, defined but worth a conscious decision. (a) A booking made 23 h 45 min ahead with a 24-hour lead gets no reminder at all (model: booked Mon 22:30 for Tue 22:15 → none, while Tue 23:00 → Tue 08:00). (b) A reminder withheld `opted-out` or `no-consent` is not reconsidered if the contact opts in or consent is added before the appointment. (c) A `sent` reminder whose booking moves nearer than the lead time becomes `none`; the record that one was sent is lost unless kept elsewhere. (d) Quiet hours or lead time changed after scheduling do not move a scheduled reminder (US-D11 c2), so one can be sent inside the new quiet hours. | Confirm each is intended. |

## A. Machines

Method: for each machine I listed every state against every event in its table and against events from the other sections and the stories that can reach that state.

**Handover (§2).**

- Dashes that hold: hand back in `detached`/`followed-up` (no attached session); "session ends" in `detached`/`followed-up`; staff close in `in-progress` (a product rule, not an impossibility, but stated); removed staff user in `detached`/`followed-up`; follow-up in `followed-up` and `in-progress`; escalation in `in-progress`.
- Dashes that do not hold: staff message in `followed-up` (V1); follow-up in `waiting` (V5); escalation in `detached` and `followed-up` (V4).
- Undefined events: held follow-up (V6); staff message that fails or is blocked (V22); re-attachment messages (V19).
- **H1, attempted counterexamples, all failed.** Person button with a `detached` handover: step 10 → trigger row → re-attach, one handover. `provider-failure` at 15 minutes with a `detached` handover: same. Message with a `followed-up` handover plus person button: step 8 catches it before step 10. Staff take-over while `waiting`: absorbed. New trigger after a terminal state: a new handover, still one open. Contact deleted and the number returns: a new contact. H1 holds on the tables; the only gap is concurrent creation (V27).
- **H2, counterexample found.** `followed-up`; tenant not answering (or contact paused, or the message is a keyword); customer replies to the follow-up. The message ends before step 8, the handover stays `followed-up`, and the 7-day guard "no customer message" is now false. Exits left: staff close, or a later message that reaches step 8. With neither, it never ends (V1). Other states: `waiting` and `in-progress` end with the session at the latest; `detached` ends at 14 days. The cycle `waiting → detached → waiting` needs a new trigger each time, so it is not a liveness failure.
- **H3 / S1, attempted counterexamples, all failed.** Assistant reply in flight when staff take over: `discarded` (§7). Timer retry of a marked session after handover: mark cleared (§8). Late success of a retry started before the 15-minute handover: "does not answer later". Step 13 fallback in a handed-over session: step 9 ends first. The opt-out confirmation and the holding message are sent in a handed-over session, but they are a system reply and a service notice, not assistant replies. `detached` handover while the assistant answers a new session: not attached, so S1 holds. Contact deletion closes or ends every open state. H3 and S1 hold.
- Diagram: 12 edges checked against the table; all 12 agree; 5 table transitions are not drawn (V26); one transition required by Decision 1 is in neither (V1).

**Session (§3).** `ended` is terminal and reachable; `active` always exits after 24 hours of silence. A session can be `active` with the reply window closed, because outbound messages extend the session only (used in V5). Counter behaviour after hand-back is undefined (V17). S1 as above.

**Booking (§4).** No unreachable state. `cancelled` is terminal; `attended`/`missed` are not marked terminal and correctly have an event (replace outcome). `booked`/`confirmed` past the start with no outcome have no exit and the text says so. Agreement with US-B4 c1, c3, c6, US-D8 c1–c3, US-D5 c3, c5 and US-B3 c11 confirmed. Gaps: V15, V16, V23, V31. B1 on moves: sound. B1 on concurrent creates and on settings edits: V16.

**Reminder (§5).** See C.

**Contact permission (§6).** The three effective states are exhaustive and exclusive. Opt-out overriding later consent matches US-C13 c4; the hash rule matches US-D5 c4. Gaps: V7, V20.

**Outbound (§7).** V12, V18, V21. The class table otherwise matches the glossary cell for cell (see D).

**Provider and awaiting-retry (§8), P1 traces.**

- `normal`: message at 0:00; three attempts fail by about 1:05 (20 s + 1 s + 20 s + 4 s + 20 s); mark set, fallback sent. Retries at 60-second spacing from the last attempt fail. At 15:00 the mark clears and the session is handed over with `provider-failure`. A retry still in flight at 15:00 that succeeds later is not sent. P1 holds.
- `normal`, second message at 14:00: normal handling fails, the mark stays, no second fallback (15-minute rule), the clock restarts, handover at 29:00. P1 holds by its wording (V11c).
- `degraded`: message at 0:00; no model call; mark; fallback. No 60-second retries (the row requires `normal`). Health check succeeds at 5:00: all marked sessions attempted at once; success answers and clears. If the service stays `degraded`: handover at 15:00. P1 holds.
- `degraded` → `normal` → attempts fail again: 60-second retries, handover at 15:00. P1 holds.
- Marked session handed over by the person button at 3:00: step 10 precedes step 13; mark cleared. P1 holds.
- Not determined by the tables: paused contact, non-text or keyword messages after the mark, opt-out before the retried answer (V11, V12).

**Tenant (§9).** Both states reachable and left by re-evaluation. Agrees with US-D6 c4–c6, US-C1 c7, c8 and the fixed values. No defect in the machine itself; its effect on outbound messages is V21.

## B. Order of checks

| # | Message | Trace | Ends at | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Opt-out keyword, tenant not answering | 1–3 pass; 4 stores, starts the session, opens the window; 5 applies it, no confirmation | Step 5 | Right for opt-out (US-C7 c6). The message is not marked `received-while-not-answering` (V21b). |
| 2 | Opt-out keyword in a handed-over session | 5 applies it and sends the confirmation | Step 5 | Right. Consistent with §2 "Contact opts out" (stay; follow-up unavailable) and §7 (holding message blocked; staff may reply because other messages exist in the session). The message is stored but does not pass through step 9. |
| 3 | Person button, contact paused | 5 no; 6 answering; 7 paused | Step 7 | Matches US-C17 c3. Whether the request is dropped or deferred is not defined (V10a). |
| 4 | Text, handover `followed-up`, tenant not answering | 4 opens a new session and the window; 5 no; 6 marks it; the new session is not handed over, so nothing joins | Step 6 | Wrong or undefined: §2 says this message moves the handover to `waiting`; it stays `followed-up` with the window open (V1). |
| 5 | Voice note in a handed-over session | 5 no; 6; 7; 8 no (handover is `waiting`/`in-progress`); 9 joins | Step 9 | Right. No unsupported-type reply and no count; matches US-C14 c8. |
| 6 | Text in degraded mode, `detached` handover | 5–10 no; 11 window; 12 has text; 13 mark, fallback | Step 13 | Right. Matches §2 `detached` "the assistant answers it in a new session". At 15 minutes `provider-failure` is a trigger in `detached` → re-attach → `waiting`; H1 holds. A typed request for a person is not seen (it needs the model); the fallback's person button covers it. |
| 7 | Two texts 2 s apart, second is an opt-out keyword | First waits at 11. Second: 4; 5 applies and confirms; "unless the batch holds other text" is true, so it continues; 6–10 no; 11; 14 answers | Step 14 | Plausible result (confirmation, then an answer to the first text; US-C7 c4 allows the answer). Not fully defined: what "batch" means at step 5, and whether the keyword reaches the model (V8). |
| 8 | Text that asks for a person and contains an opt-in keyword | Depends on the matching rule | Step 5 or 14 | Undefined. If "contains" matches and step 5 ends, the request for a person is dropped; if it continues, step 14 hands over, as US-C11 c4 expects; if only exact matches count, step 14 does both through the model (V8). |

Further traces: `followed-up` contact, paused → step 7, same defect as trace 4. Reminder Confirm tap in a handed-over session → step 9, not applied (V2). Keyword flood → every message handled at step 5, never limited (V9). Paused contact in a handed-over session → step 7, does not join (V10b).

Sections that assume a different order: §6 (free text at step 5; V7) and §2 (`followed-up` customer-message cell and its dash assume step 8 is always reached; V1; `waiting`/`in-progress` "joins" cells assume step 9 is reached; V10b). The three stated "consequences" under the table are each correct as far as they go.

## C. Reminder

**Model output against the worked-examples table.** I ran the model. All nine rows match exactly (the document lists them in a different order from the model):

| Document row | Model |
| --- | --- |
| Mon 10:00 for Wed 07:30, 24 h → Mon 21:59 | case 1: Mon 21:59 |
| Mon 23:00 for Wed 07:30, 24 h → Tue 08:00 | case 2: Tue 08:00 |
| Mon 21:59:30 for Wed 07:30, 24 h → Tue 08:00 | case 8: Tue 08:00 |
| Tue 07:00 for Tue 08:30, 1 h → withheld, too-late | case 3: withheld too-late |
| Tue 06:00 for Tue 09:30, 2 h → Tue 08:00 | case 9: Tue 08:00 |
| Mon 12:00 for Mon 20:00, 24 h → none | case 4: none |
| Moved Tue 09:00 to Tue 15:00, 24 h → none | case 5: none |
| Mon 10:00 for Wed 22:00, 24 h → Tue 21:59 | case 6: Tue 21:59 |
| Mon 10:00 for Wed 08:00, 24 h → Tue 08:00 | case 7: Tue 08:00 |

**Pseudo-code against the model.** Line for line the same rule: `due < now` → none; not quiet → `due`; `Q.start − 1 min > now` (strict) → that time; `Q.end <= start − 60 min` → `Q.end`; otherwise withheld. The quiet period is start-inclusive and end-exclusive in both, as the glossary defines. Neither handles "none" (V28) or daylight saving (V25). The glossary's "Quiet hours rules" row and US-B3 c6, c7 state the same rule.

**Further cases** (run by calling the model's `schedule` function with the arguments shown; quiet hours 22:00–08:00 unless stated):

| Case | Result | Comment |
| --- | --- | --- |
| Due exactly at quiet start: booked Tue 10:00 for Tue 23:00, 1 h | Tue 21:59 | Correct; 22:00 is quiet. |
| Due one minute before quiet start: for Tue 22:59, 1 h | Tue 21:59 | Correct; not quiet, sent at due. |
| Due exactly at quiet end: booked Tue 07:00 for Tue 09:00, 1 h | Tue 08:00 | Correct by rule; exactly on the floor (V3). |
| Booked inside quiet hours: Tue 02:00 for Tue 09:00, 2 h | Tue 08:00 | `Q.end = start − 60 min`, exactly on the floor (V3). |
| Same for Tue 08:59, 2 h | Withheld, too-late | Correct by rule. |
| Booked Tue 02:00 for Tue 08:30, 1 h | Withheld, too-late | Correct by rule. |
| Lead 1 h, no quiet hours involved: Mon 10:00 for Tue 15:00 | Tue 14:00 | Exactly on the floor (V3). |
| Lead 1 h, booked exactly 60 min before | Scheduled now | On the floor at creation (V3). |
| Lead 1 h, booked 59 min 59 s before | None | Correct by rule. |
| Quiet 13:00–15:00: Mon 10:00 for Wed 14:00, 24 h | Tue 12:59 | Correct; a period that does not cross midnight works. |
| Quiet 13:00–15:00: Tue 13:30 for Tue 15:30, 1 h | Withheld, too-late | Correct by rule. |
| Quiet 13:00–15:00: Tue 13:30 for Tue 16:00, 2 h | Tue 15:00 | On the floor. |
| Quiet 13:00–15:00: due exactly 13:00 / exactly 15:00 | Tue 12:59 / Tue 15:00 | Boundaries correct. |
| Quiet "none" | Not expressible | Equal start and end give a 24-hour quiet period (V28). |
| Quiet 20:00–08:00 (12 h): Mon 21:00 for Tue 09:00, 2 h | Tue 08:00 | Correct. |
| Lead 72 h: Mon 10:00 for Fri 07:00 | Mon 21:59 | Correct. |
| `Q.start − 1 min` equal to now: booked Mon 21:59:00 for Wed 07:30 | Tue 08:00 | Strict comparison, as the glossary's "still in the future". |
| Moved twice: created Mon 10:00 for Thu 10:00 → Wed 10:00; moved Mon 11:00 to Wed 07:30 → Mon 21:59; moved Mon 23:00 to Wed 09:00 → Tue 09:00 | As shown | Each move replaces the schedule; consistent. |
| Moved after sending: sent Tue 09:00 for Wed 09:00; moved Tue 10:00 to Wed 07:30 | None | `sent` → `none` (V33c). |
| Sent Tue 09:00 for Wed 09:00; moved Tue 09:30 to Thu 09:00, then Tue 09:40 to Wed 09:45 | Wed 09:00, then Tue 09:45 | A second reminder for a new time; intended by the table. |

**Questions asked.**

- Later than 60 minutes before the appointment by any path? At the check, no: check 5 is on every path, including queue release and the hold to the end of quiet hours. After the check, yes by seconds: the ordering hold and the retries in §7 follow check 5 (V3). The more serious effect is the opposite one: on-time reminders withheld (V3).
- Twice for the same appointment time? Yes, by one path: sent early at `Q.start − 1 min`, moved away, moved back before `due` (V15). Not possible when the first was sent at `due` or at `Q.end`, because moving back gives `due < now` → none (model: sent Tue 12:00 for Wed 12:00, moved away and back at Tue 12:40 → none). `sent` + "send time reached" is correctly a dash.
- A `sent` reminder when the booking moves nearer than the lead time? The rule returns `none`; no second reminder; machine 4 returns the booking to `booked`. The old message's buttons stay live while the row says taps cannot occur (V15).
- Send-time checks against the transitions table: V13 (queued and failed outcomes missing), V14 (quiet hours), V24 (template when the window is open).

## D. Consistency

**"Decisions made here", row by row.**

| # | Checked against | Result |
| --- | --- | --- |
| 1 | Glossary "Handover"; US-C14 c15 | Glossary and story agree with the decision. The §2 table contradicts it for `followed-up` (dash) (V1). |
| 2 | Glossary "Handover" (reason listed); US-D3 c5; US-C6 c7 | Agree. |
| 3 | US-C7 c6; US-C1 c6 | US-C7 agrees. US-C1 c6 has no exception for keywords (V21b). |
| 4 | Glossary "Handover"; US-C6 c9 | Agree. |
| 5 | Fixed values "Detached handover expiry"; US-C14 c18 | Agree on 14 days and on restarting from the last session end. c18's "no follow-up is pending" is missing from the table (V6). |
| 6 | US-C14 c4, c7; fixed values | Agree on business hours. The table limits escalation to `waiting` (V4). |
| 7 | US-C14 c12 | Agree. |
| 8 | US-C6 c8; US-C14 c13, c14 | Agree. |
| 9 | US-B3 c1, c2; glossary "Quiet hours rules" | Agree. c1's "one reminder is scheduled" is loose where the rule withholds (V29). |
| 10 | US-B3 c5; glossary rule and fixed value | Agree; the fixed value's name is out of date (V29). US-C9 c5 ("after the event it concerns") is looser than check 5 and `limit-reached` is unused (V13). |
| 11 | US-B3 c3, c4, c13; US-C7 c3; US-C13 c1 | Agree. |
| 12 | US-D6 c6; fixed values | Agree. |
| 13 | US-C17 c2, c3 | Agree; "until the pause has ended" carries the ambiguity of V10a. |

**Stories, reverse check.**

- US-C6: c1, c2, c4, c7, c8, c9 covered and consistent. c5/c6 against re-attachment cells: V19. c3 is step 14, outside these tables.
- US-C7: c1, c3, c4, c5, c6 consistent. c2 against §6: V7.
- US-C14: c1–c3 (list, email, throttle) are not state and not tabled; no contradiction. c4, c6, c7: V4. c5, c8, c9, c11–c14, c16, c17, c19 consistent. c10: V5. c15: V1. c18: V6.
- US-C15: c1–c5, c7, c9 consistent with §8. c6, c8 emails not tabled (V30). The retried answer's class: V12.
- US-C17: c1–c4 consistent with step 7; V9 and V10 are gaps, not contradictions.
- US-B3: c1–c7, c11–c13 consistent with §5. c8, c9: V2, V15. c10 consistent ("no second reminder" concerns an unanswered reminder; the second reminder after a move falls under c1).
- US-B4: c1–c3, c6 consistent with §4; c4, c5 are assistant behaviour. Boundary wording: V29, V31.
- US-D3: c2 (trigger `staff`, reply discarded), c4, c5, c6, c7 consistent with §2 and §7. c3 (holding and release) appears in §2 only as "removed staff user".
- US-D6: c4, c5, c6 consistent with §9.
- US-D12: c2 consistent with §4; c3 consistent with the glossary rule; c4 consistent with §7. No table for the notice itself (V23).

**Glossary tables.**

- "Message classes" against §7: assistant reply, system reply, staff message, holding message, `handover_followup` and business-initiated rows agree in every column. The retried answer is missing from §7 (V12).
- "Quiet hours rules" against §5 and §7: the reminder row, the queued-message row and the follow-up row agree with §5 check 4 and §7. Booking-change notice: referenced by "per-kind rule" only (V23).
- "Fixed values" against §§1–9: session 24 h, batching window, turn cap 30, rate limit 20 in 5 minutes with a 15-minute pause, 3 model attempts, awaiting-retry 60 s and 15 minutes, 60-minute floor, 5 sessions in 2 minutes and 30-second health check, 3 send attempts with waits of 2 and 8 s, 10-second delivery wait, 7 and 14 days, escalation clock, credential checks: all agree.

## Not checked

- The output check, guardrail policy, eval plan, `nfr.md`, `compliance.md`, `open-questions.md`, personas and vision: not read, so references into them (NFR-P5, NFR-R7, OQ-5 to OQ-7, the opt-out and opt-in keyword lists) are unverified.
- Whether the story issues on GitHub were changed to match, as the document says: not checked (issues and pull requests were out of scope).
- Stories outside the ten named in the task were read but checked only where a table touched them (US-C1, US-C9, US-C11, US-C12, US-C13, US-C18, US-D5, US-D7, US-D8, US-D11).
- Daylight-saving behaviour was reasoned about, not run: the model has no time zones.
- The model was exercised by calling its `schedule` function with other arguments from a one-off script that wrote no file; the model file itself was not changed.
- Concurrency was assessed from the text only (H1, B1, step 11); there is no executable model for it.
- Channel behaviour (what opens the reply window, daily limits, status-event ordering) was taken as the glossary states it and not verified against the channel's documentation.

---

# Author's response

Everything above this line is the verifier's report, committed unedited in
`a340423`. Everything below is written by the authoring agent.

Date: 2026-11-16 · Issue #126 · Pull request #127

## Outcome

**All 33 findings are accepted.** The four High findings are fixed in this
pull request and are being re-verified. Two Medium findings (V5, V7) were
fixed by the same edits. The other 19 Medium findings and the 8 Low findings
are tracked as issues.

## A change of method

This is the fourth review in a row to find serious defects in a document
written to fix earlier ones. Tables were better than prose: these findings
are narrower and more concrete than before. But I had checked the handover
invariants by reading my own table, and that check was wrong: finding V1 is a
counterexample to H2.

So the handover machine now has an executable model,
`docs/design/models/handover_machine.py`. It is a copy of the transition
table as code. It explores every sequence of events to a depth of 8 and
asserts the invariants, so they no longer rest on anyone reading a table
correctly. Writing it exposed one more mismatch between my table and my own
intent (a new trigger in `followed-up`), which is corrected. The reminder
model gained boundary cases and an assertion of the floor.

A model checks only what it encodes. It is a second statement of the same
design by the same author, so an error of understanding can be in both. It
does remove a class of error that review kept finding: a table whose cells do
not add up to the property claimed for it.

## High findings

| ID | Fix | Where |
| --- | --- | --- |
| V1 | "Customer message" for the handover is now defined by a step in the order of checks, and the `followed-up` attach is moved before the tenant-answering and rate checks, so a customer's reply to a follow-up always re-attaches the handover. A staff message from `followed-up` moves it to `in-progress`. The 7-day rule is stated on the state, so it is decidable. Invariant H2 is asserted by the model. | Section 1 steps 5 to 9; section 2; model |
| V2 | A reminder's Confirm button has its own step and is applied by code in every state. Reschedule and Cancel count as text and go to the assistant; in a handed-over session the customer is told the booking is unchanged. A tap on a reminder for an earlier start time does not confirm. | Section 1 steps 6, 10, 13, 15; sections 4 and 5; US-B3 criteria 9 to 12 |
| V3 | Two bounds, not one: a reminder is scheduled no later than 60 minutes before the appointment and accepted by the channel no later than 55 minutes before. The 5 minutes are the stated grace for checks, ordering and retries. Boundary cases are in the worked examples, and the model asserts both bounds. | Section 5; US-B3 criteria 5 and 6; glossary "Reminder floor"; model |
| V4 | The escalation clock runs in `detached` as well as `waiting`, so a handover made while the business is closed is still marked overdue. It stops when a follow-up is sent and restarts on re-attachment. The model asserts that a detached handover can become overdue. | Section 2; US-C14 criteria 4 and 5; glossary |

## Medium and Low findings

| ID | Severity | Status |
| --- | --- | --- |
| V5 | Medium | Fixed: follow-up availability is keyed to the reply window, including in `waiting` |
| V7 | Medium | Fixed: free-text opt-out is recognised by the model at step 15; keyword and button at step 5 |
| V6 | Medium | Tracked: [#128](https://github.com/zishon89us/polyglot-sales-agent/issues/128) |
| V8 | Medium | Tracked: [#129](https://github.com/zishon89us/polyglot-sales-agent/issues/129) |
| V9 | Medium | Tracked: [#130](https://github.com/zishon89us/polyglot-sales-agent/issues/130) |
| V10 | Medium | Tracked: [#131](https://github.com/zishon89us/polyglot-sales-agent/issues/131) |
| V11 | Medium | Tracked: [#132](https://github.com/zishon89us/polyglot-sales-agent/issues/132) |
| V12 | Medium | Tracked: [#133](https://github.com/zishon89us/polyglot-sales-agent/issues/133) |
| V13 | Medium | Tracked: [#134](https://github.com/zishon89us/polyglot-sales-agent/issues/134) |
| V14 | Medium | Tracked: [#135](https://github.com/zishon89us/polyglot-sales-agent/issues/135) |
| V15 | Medium | Tracked: [#136](https://github.com/zishon89us/polyglot-sales-agent/issues/136) |
| V16 | Medium | Tracked: [#137](https://github.com/zishon89us/polyglot-sales-agent/issues/137) |
| V17 | Medium | Tracked: [#138](https://github.com/zishon89us/polyglot-sales-agent/issues/138) |
| V18 | Medium | Tracked: [#139](https://github.com/zishon89us/polyglot-sales-agent/issues/139) |
| V19 | Medium | Tracked: [#140](https://github.com/zishon89us/polyglot-sales-agent/issues/140) |
| V20 | Medium | Tracked: [#141](https://github.com/zishon89us/polyglot-sales-agent/issues/141) |
| V21 | Medium | Tracked: [#142](https://github.com/zishon89us/polyglot-sales-agent/issues/142) |
| V22 | Medium | Tracked: [#143](https://github.com/zishon89us/polyglot-sales-agent/issues/143) |
| V23 | Medium | Tracked: [#144](https://github.com/zishon89us/polyglot-sales-agent/issues/144) |
| V24 | Medium | Tracked: [#145](https://github.com/zishon89us/polyglot-sales-agent/issues/145) |
| V25 | Medium | Tracked: [#146](https://github.com/zishon89us/polyglot-sales-agent/issues/146) |
| V26 to V33 | Low | Tracked: [#147](https://github.com/zishon89us/polyglot-sales-agent/issues/147) |
