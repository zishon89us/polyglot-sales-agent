# Verification review 2: state machines

Date 2026-11-16 · Files read: `docs/design/state-machines.md` (in full), `docs/design/models/handover_machine.py`, `docs/design/models/reminder_timing.py`, `docs/requirements/glossary.md` (in full), `docs/requirements/user-stories.md` (US-C14, US-C17, US-B3, US-B4 only) · Commands run: `python3 -I` on each of the two models; one throwaway script `/tmp/vf/t.py` that imports the two models and calls `step`, `explore`, `schedule` and `may_send`; one `wc`/`grep` to locate the four stories · Deliberately not read: everything under `docs/reviews/`, `docs/adr/`, `docs/STATUS.md`, any `review-*.md`, git history, issues and pull requests.

Two disclosures. (1) My environment put the full text of `AGENTS.md` into my context. I did not use it. (2) The `grep` I used to find the four stories also printed three single lines outside them (one criterion each of US-C1 and US-C6, and the story headings). I did not rely on them; no finding below depends on them.

## Summary

| Item | Verdict |
| --- | --- |
| F1 `followed-up` and the order of checks | RESOLVED |
| F2 Reminder buttons in the order of checks | RESOLVED |
| F3 Tolerance at the 60-minute floor | RESOLVED |
| F4 Escalation outside `waiting` | PARTLY RESOLVED: one Medium point remains (R1) |

New defects introduced by the fixes: High 0, Medium 3, Low 7. Remaining from the original reports: Medium 1 (R1, under F4).

No High defect remains open or was introduced.

## F1. `followed-up` and the order of checks

### Current rules

- Section 1, step 5 (opt keywords and stop/start buttons, **Ends**), step 6 (Confirm button, **Ends**), step 7 (open handover in `followed-up`: attach, → `waiting`, acknowledgement and staff notification only if the tenant is answering and the contact is not paused, **Ends**), step 8 (tenant answering), step 9 (paused for rate).
- Section 1, paragraph after the table: "customer message" means an inbound message that reaches step 7; a call, and a message that ends at step 5 or 6, opens the reply window but is not a customer message. Third listed consequence repeats this for step 7.
- Section 2: state `followed-up` ("no customer message has arrived since"); diagram edges `followed_up --> waiting: customer message / new trigger`, `followed_up --> in_progress: staff message`, `followed_up --> closed_unanswered: staff close / 7 days / contact deleted`; transition rows "Customer message (reaches step 7)", "Staff message, possible only while the reply window is open", and "7 days since the follow-up was accepted, still `followed-up`".
- Decisions 1, 8 and 14. Glossary fixed value "Unanswered follow-up expiry: 7 days after `handover_followup`". US-C14 criteria 14, 15, 16, 17 and 19. Section 7 pre-send row for a staff message (blocked if the contact's only messages in the session are opt-out requests).

### Cases traced

| # | Case | Trace | Result |
| --- | --- | --- | --- |
| 1 | Original (a): customer replies with normal text, tenant not answering | Step 4 stores, opens window. Steps 5, 6 no. Step 7: attach → `waiting`; no acknowledgement, no notification; ends | Handover re-attached. Defined. See W1 |
| 2 | Normal text while paused for rate | Step 7 is before step 9: attach → `waiting`; no acknowledgement or notification; ends | Defined. See W1. Consistent with US-C17 criterion 2 (no handover is created, none notified) |
| 3 | Opt-out keyword only | Step 5 applies it, ends. Not a customer message. Handover stays `followed-up` (row "Contact opts out": stay). Window is open, but a staff message is blocked by section 7 (only messages in the session are opt-out requests). After 7 days: `closed-unanswered`, `no-response` | Defined and consistent |
| 4 | Confirm tap only | Step 6 applies machine 4, ends. Handover stays `followed-up`; window open. Staff may send a message (case 6) or the 7-day timer closes it | Defined |
| 5 | Normal text, tenant answering, not paused | Step 7: attach → `waiting`, customer told, staff notified; escalation clock restarts | Matches US-C14 criteria 14 and 15 |
| 6 | Original (b), (c): staff message from `followed-up` after an opt-in keyword, a Confirm tap or a call opened the window | Table: "Same as `detached`. → `in-progress`", attaching to the contact's current session. Diagram has the edge. Decision 1 and US-C14 criterion 17 say the same. Model: `('followed-up', True, True, False)` + `staff_message` → `in-progress` | Table, diagram, decision, criterion and model agree |
| 7 | Original (d): nobody ever acts | 7-day row is guarded by state only ("still `followed-up`"): → `closed-unanswered`, `no-response` | Decidable; H2 holds |
| 8 | Customer taps Reschedule or Cancel on a reminder while the handover is `followed-up` | Steps 5, 6 no. Step 7: attach, tell the customer a person will reply, ends. Never reaches steps 10 or 15 | Handover behaviour is right; the tap is not acted on and the customer is not told so. See W2 |

### Verdict: RESOLVED

All four parts of the original defect are closed: (a) step 7 now precedes the tenant and rate checks, and messages that end earlier are explicitly not customer messages; (b) the table gives a result for a staff message in `followed-up` and no longer says it cannot occur; (c) table, diagram, decision 1 and criterion 17 agree; (d) the 7-day guard is a state test. The fix leaves W1, W2 (Medium) and W8, W9 (Low), listed below.

## F2. Reminder buttons in the order of checks

### Current rules

- Section 1, step 6 (Confirm: by code, in every tenant, contact and session state; system reply only if the tenant is answering; ends), step 10 (handed over: a Reschedule or Cancel button gets one system reply that the booking is unchanged and a person will deal with it), step 13 (a Reschedule or Cancel button counts as text), step 14 (degraded), step 15 (button given to the model as that request, US-B4). Second and fifth listed consequences.
- Section 4, first two transition rows (Confirm before the start with matching start time; Confirm on a reminder for an earlier start time or after the start). Section 5, transition row "Customer taps Confirm (step 6 of section 1)".
- Decision 15. US-B3 criteria 9 to 12. US-B4 criteria 1 to 6. Glossary: "System reply" class; "Unsupported message type" (a button reply is not one).

### Cases traced

| Button | Tenant not answering | Contact paused | Session handed over | Degraded mode | Normal |
| --- | --- | --- | --- | --- | --- |
| Confirm | Step 6: applied, no reply | Step 6 (before step 9): applied, result sent | Step 6 (before step 10): applied, result sent | Step 6 (before step 14): applied, no model | Step 6: applied, result sent |
| Reschedule | Step 8: stored, marked, no reply | Step 9: no reply, not remembered | Step 10: joins waiting session; system reply "booking unchanged, a person will deal with it" | Step 13 passes (counts as text); step 14: `awaiting-retry`, fallback; section 8 retries or hands over at 15 minutes | Step 15: model treats it as the request; US-B4 applies, including `late-change` |
| Cancel | Same as Reschedule | Same | Same | Same | Same |

Further cases:

- Confirm after the booking was moved: section 4 row 2, `booked`/`confirmed`: no change, customer told the current time. Matches US-B3 criterion 10.
- Confirm after the booking was cancelled: `cancelled` column of both rows: customer told it was cancelled.
- Confirm after the start time: row 2: no change; told the current time (`booked`/`confirmed`), no change (`attended`/`missed`). Defined. The instant exactly equal to the start is covered by neither "before the start" nor "after the start"; this is a one-instant gap and I do not rate it.
- Confirm while a handover is `followed-up`: step 6 precedes step 7; the booking is confirmed and the handover is untouched.
- Original harm (Cancel in a handed-over session believed to have worked): step 10 now sends an explicit reply; US-B3 criterion 12 tests it.

Every one of the 15 cells and the three Confirm variants has exactly one defined result, and Confirm no longer depends on the model, the tenant state, the pause or the handover.

### Verdict: RESOLVED

Remaining from the fix: W2 (Medium), W7 and W8 (Low).

## F3. Tolerance at the 60-minute floor

### Current rules

- Section 5 timing rule (pseudo-code), worked-examples table (13 rows), send-time checks 1 to 5, and the paragraph after them: scheduled no later than 60 minutes before; check 5 "no later than 55 minutes before the start", applied again when released from the daily-limit queue, after a quiet-hours hold, and "immediately before each send attempt".
- Decisions 9, 10 and 16. Glossary: fixed value "Reminder floor"; "Quiet hours rules" rows for the appointment reminder and for a message queued for the daily limit; reminder lead time range 1 to 72 hours. US-B3 criteria 5, 6, 7 and 8.

### Cases traced

| # | Case | Trace | Result |
| --- | --- | --- | --- |
| 1 | Original: lead 1 h, booked Mon 10:00 for Tue 15:00 | `due` = Tue 14:00, not quiet → scheduled 14:00, exactly at the floor. Check 5 run a moment later: limit is 14:05 | Sent. Model: `scheduled 14:00`; `may_send` true |
| 2 | Accepted 4 minutes late | 14:04 ≤ 14:05 | Sent |
| 3 | Accepted 5 minutes late | 14:05 ≤ 14:05 | Sent (model: true) |
| 4 | Accepted 6 minutes late | 14:06 > 14:05 | Withheld `too-late` (model: false; also false at 5 min 1 s) |
| 5 | Released from the daily-limit queue 58 minutes before | Check 4 → check 5: 58 ≥ 55 | Sent. Consistent with decision 16, glossary and criterion 6; contradicts decision 10 (W4) |
| 6 | Released from the queue in quiet hours, quiet end 57 minutes before the start (appointment 08:57) | Check 4: hold to 08:00, check 5 passes → sent. Glossary queue rule: the reminder's own rule applies, end of quiet hours must be at least 60 minutes before → withheld | Section 5 and glossary disagree in the 55-to-60 band (W5) |
| 7 | Held behind an earlier message or retried (machine 7: 10-second wait, retries after 2 and 8 seconds) | Check 5 is applied again before each attempt | The "other direction" of the original report is now covered, to within the latency of one send call (W6) |
| 8 | Random check of the timing rule: 300,000 inputs, lead 60 minutes to 72 hours | 208,516 scheduled; none later than start − 60 min, none before `now`, none inside quiet hours; 49 exactly at the floor | The 60-minute scheduling bound holds for the rule, not only for the 13 examples |

Pseudo-code, worked examples and model: the five branches of the pseudo-code match `schedule()` line for line. All 13 rows of the worked-examples table match the model's output (the table's row order differs from the model's case numbering; results are identical). The model's final loop asserts, for each scheduled example, that the time is at or before the floor and that a send 5 minutes later passes check 5; for the examples at the floor it also asserts that 6 minutes later fails. That is what the document says it asserts. It is an assertion over 13 examples, not over all inputs; my random run supports the general claim for the 60-minute bound.

### Verdict: RESOLVED

A reminder scheduled at the floor is no longer withheld by its own check, the comparison is a plain comparison of instants ("no later than"), and the check is repeated before each attempt. Remaining from the fix: W4, W5, W6 (all Low).

## F4. Escalation outside `waiting`

### Current rules

- Section 2, transition row "Escalation time elapses. The clock counts business hours only, runs in `waiting` and `detached`, and is stopped and reset in every other state": `waiting` — mark overdue, holding message if the window is open and none was sent for this handover; `detached` — mark overdue, no holding message.
- Section 2, the sentence after the table: marked overdue at most once each time it is `waiting` or `detached` without interruption; the mark is cleared when it leaves both.
- "Clock restarts" in the cells for a customer message in `followed-up` and a new trigger in `detached`.
- Decisions 6 and 17. Glossary fixed value "Handover escalation clock"; setting "Handover escalation time" (15 minutes, 5 to 240); "Service notice" class (holding message sent only while the reply window is open). US-C14 criteria 4 to 8.

### Cases traced

| # | Case | Trace | Result |
| --- | --- | --- | --- |
| 1 | Original: handover Friday 18:00, hours Mon–Fri 09:00–17:00, 15 minutes | Clock at 0 (closed). Session ends about Saturday 18:00 → `detached`; clock is not reset in `detached`. Monday 09:00 counting starts; 09:15 marked overdue. Window closed: no holding message | Marked overdue. Matches criteria 4, 7 and 8 |
| 2 | Same, staff send the follow-up Monday 09:05 and the channel accepts it | → `followed-up`; clock stopped and reset. Not overdue at 09:15 | Matches criterion 5 |
| 3 | Case 2, customer replies Tuesday 10:00 | Step 7 → `waiting`, clock restarts from zero; 10:15 overdue; holding message sent (window open, none sent before) | Defined |
| 4 | Follow-up accepted after the handover was already overdue | Leaves both `waiting` and `detached`: mark cleared. On return to `waiting` it can be marked again; no second holding message ("none was sent for this handover") | Defined |
| 5 | `waiting`, overdue, session ends | → `detached`; no interruption, mark kept, not marked twice. Model keeps `overdue=True` | Defined |
| 6 | `detached`, already overdue, new trigger re-attaches it | Cell: "→ `waiting`. Clock restarts." Sentence: it has not left both states, so the mark is not cleared and it cannot be marked again. Model: clears the mark (`('detached', False, False, True)` → `('waiting', True, False, False)`) and allows a second mark | Not consistently defined: R1 |
| 7 | `detached`, customer wrote Sunday 20:00 (assistant answered in a new session), overdue Monday 09:15 | Reply window is open. Table: no holding message. US-C14 criterion 6: overdue while the window is open → the customer receives the holding message | Table and criterion disagree: W3 |

### Verdict: PARTLY RESOLVED

Resolved: a handover made while the business is closed for more than 24 hours is now marked overdue in `detached`; the clock continues from `waiting` into `detached`, stops on a follow-up and restarts from zero on re-attachment; table, glossary, decision 17 and criteria 4, 5 and 8 agree on that.

Remaining:

**R1 (Medium).** For the path `detached` (overdue) → `waiting` by a new trigger, the original question "restarts, continues or stays spent" is answered three ways. The cell says the clock restarts. The sentence after the table says the mark is cleared only when the handover leaves both `waiting` and `detached`, and that it is marked at most once per uninterrupted stay, so the mark stays and the restarted clock can have no effect. The model clears the mark and lets it be set again. A test for "is this handover shown overdue one minute after re-attachment" cannot be written from the document. Suggested resolution: choose one (for example, "re-attachment clears the mark and restarts the clock") and make the sentence, the cell and the model say the same.

## Table, diagram and model compared

Transitions between states: the table gives 21, the diagram shows 21 (6 from `waiting`, 3 from `in-progress`, 6 from `detached`, 6 from `followed-up`), and the model prints the same 21. No state-changing transition differs between table, diagram and model. The exploration is complete at depth 6 (32 model states, unchanged at depth 20), so depth 8 is sufficient.

Differences found, all in details other than the target state:

| # | Where | Difference |
| --- | --- | --- |
| D1 | Overdue mark, `detached` → `waiting` on a new trigger | Document sentence: mark not cleared. Model: cleared, and can be set again. (R1) |
| D2 | New trigger | Model sets the reply window open on every new trigger. The table includes "staff taking over a session" as a trigger, which does not open the window. No reachable state is lost, because the same states are reached through `window_closes`. |
| D3 | Staff message | Model lets staff write whenever the window is open. Section 7 blocks a staff message when the contact's only messages in the session are opt-out requests. The model's comment "it can be sent in every open state whose reply window is open" is therefore not what the document says. |
| D4 | Contact opts out | Table: `handover_followup` becomes unavailable in `waiting` and `detached`. Model: opt-out is not in the state, and a follow-up after opt-out is accepted (`detached` → opt-out → `staff_followup_sent` gives `followed-up`). |
| D5 | Follow-up held | Table: a held follow-up moves the handover later, when the channel accepts it. Model: only an immediate "sent" or "not sent"; a later acceptance, possibly with the window open by then, is not modelled. |
| D6 | "Removed staff user held it" row | Not in the model (no state change in the table). |
| D7 | Escalation row | Holding message, business hours and the clock value are not in the model; only the overdue flag is. |
| D8 | `window_closes` | The two branches (attached, not attached) are identical; the distinction in the comment is not implemented. Harmless. |
| D9 | Diagram | Omits self-loops and the escalation event, as a state diagram normally does. Not a defect. |

What the model's assertions establish:

- **H2: established for the model.** From every reachable open state, firing only `session_ends`, the 7-day timer and the 14-day timer reaches a terminal state, and terminal states have no outgoing transition. This rests on two assumptions the model does not check: that a session always ends, and that the timers fire. D5 does not break it (a late acceptance leads to `followed-up`, which the 7-day timer closes).
- **H1: not established.** The model holds exactly one handover by construction. The assertion only checks that `step(s, "new_trigger")` is not `None` in open states, which restates the code. Nothing models the creation of a handover at steps 11 or 15, so "no second handover is created" is assumed, not shown.
- **H3: not established.** The model has no session and no assistant reply. The two assertions (a customer message keeps `detached`, moves `followed-up` to `waiting`) restate two lines of `step`. That a session is handed over exactly in `waiting` and `in-progress` is the definition of `attached`, not a checked property, and nothing checks the order of checks against it.
- Also established: every state is reachable; at most one follow-up per handover (within the model's notion of "sent"); the edge `detached --escalation_elapses--> detached` exists.

The document's sentences "These are checked mechanically … asserts each invariant" and "each also asserted by the model" are accurate for H2 only (W10).

## New defects introduced by the fixes

| ID | Severity | Location | Defect | Suggested resolution |
| --- | --- | --- | --- | --- |
| W1 | Medium | Section 1 step 7 and third consequence; US-C14 criterion 15 | When a reply to a follow-up arrives while the tenant is not answering or the contact is paused, the handover moves to `waiting` and the session is handed over, but the acknowledgement to the customer and the staff notification are skipped. The text says they "wait on" those conditions, yet no rule sends them later: step 7 fires once, and later messages end at step 8, 9 or 10 with no reply. The customer is in a handed-over session without ever being told, and staff never get the email. | State one of: they are sent when the pause ends or the tenant answers again (and say what triggers it), or they are not sent at all and the waiting list and overdue mark are the only signal. Add a criterion. |
| W2 | Medium | Section 1 steps 7, 8, 9 against US-B3 criteria 11 and 12 | A Reschedule or Cancel tap that arrives while a handover is `followed-up` ends at step 7. The session was not handed over when the customer tapped, so criterion 11 says the tap is treated as the request; instead it is not acted on, and unlike step 10 the customer is not told the booking is unchanged (only "a person will reply", or nothing). This is the original F2 harm in a narrower case. Criterion 11 is also wider than the table for a tenant that is not answering and a paused contact (steps 8 and 9), where the tap gets no reply. | At step 7, send the step-10 "booking unchanged" reply when the message is a Reschedule or Cancel button. Narrow criterion 11 to the states in which the tap reaches step 15, as criterion 9 does for Confirm. |
| W3 | Medium | Section 2 escalation row, `detached` cell, against US-C14 criterion 6 and the glossary "Service notice" row | A `detached` handover can become overdue while the reply window is open (the customer wrote in a later session). The table says no holding message; criterion 6 says a handover that becomes overdue while the window is open gets one. Criterion 6 was written when only `waiting` could be overdue and was not narrowed when escalation was extended. | Keep the table and restrict criterion 6 to a handover attached to a session, or change the cell; make the glossary wording match. |
| W4 | Low | "Decisions made here", rows 10 and 16 | Row 10 still says no reminder is sent less than 60 minutes before the appointment "however it came to be late"; row 16, section 5, the glossary and US-B3 criterion 6 allow sending up to 55 minutes before. | Mark row 10 as superseded by row 16. |
| W5 | Low | Section 5 check 4 against glossary "Quiet hours rules", queued-message row | For a reminder released from the daily-limit queue during quiet hours, the glossary applies the reminder's own rule (end of quiet hours only if at least 60 minutes before the appointment); check 4 holds to the end and applies the 55-minute check. Outcomes differ when quiet hours end between 60 and 55 minutes before the start. | Pick one bound for this path and state it in both places. |
| W6 | Low | Section 5 closing paragraph; US-B3 criterion 6 | Check 5 runs before each send attempt, but the claim and the criterion are about when the channel accepts. An attempt begun at exactly 55 minutes can be accepted a moment later. Criterion 6 also implies withholding at the moment 55 minutes passes, while the table withholds only when a check next runs (for a queued reminder, at release). | Define the bound on the start of the last attempt, and say whether a timer or the next check performs the withholding. |
| W7 | Low | Glossary "System reply" row | The enumerated list of system replies does not include the Confirm result (step 6) or the "booking unchanged" reply (step 10), both of which section 1 calls system replies. Decision 15 does not list the glossary as changed. | Add both to the list. |
| W8 | Low | Section 1 steps 5 to 9; US-C17 criterion 1 | Messages that end at steps 5 to 8 count towards the rate limit, but the pause is started and the notice sent only at step 9 "if this message is the one that crosses the limit". If the crossing message ends at step 5, 6, 7 or 8, it is not stated whether the pause starts. Separately, Confirm results (step 6) are sent to a paused contact without limit, against "does not reply to that contact for 15 minutes". | Start the pause where the count is taken (step 4), and say whether step 5 and 6 replies are exempt from the pause. |
| W9 | Low | US-C14 criterion 19; section 1 steps 7 and 8 | Criterion 19 says "7 days pass with no message from the contact"; the table closes on state alone, so a handover whose contact sent only a keyword or a Confirm tap closes as `no-response` and the criterion does not cover it. Also, a message that ends at step 7 while the tenant is not answering never receives the `received-while-not-answering` mark of step 8, so it is absent from the section 9 list on return to answering (it is on the handover waiting list). | Reword criterion 19 with the defined term "customer message". Say whether the mark is applied at step 7. |
| W10 | Low | Section 2, paragraph after H3 and "Checks against the invariants"; "Models" table | The document says the model asserts H1, H2 and H3. Only H2 is a real check; the H1 and H3 assertions restate the model's own code. The model also differs from the document as listed in D1 to D5. | Say what the model checks (H2, reachability, one follow-up, the 21 transitions) and that H1 and H3 hold by construction of the rules; align D1, D3 and D4. |

Remaining from the original reports, not a new defect: **R1 (Medium)** under F4.

## Not checked

- Anything outside the five permitted files, including whether the story issues and other requirements documents were changed to match, as the decisions table states.
- Stories other than US-C14, US-C17, US-B3 and US-B4, even where section 1 cites them (US-C1, US-C6, US-C7, US-C9, US-D3, US-D5, US-D7).
- Sections 3, 6, 7, 8 and 9 of the design document, except where a traced case passed through them.
- Daylight-saving behaviour of `start - lead`, and quiet-hours settings other than 22:00 to 08:00, in the reminder model.
- Whether the Mermaid diagram renders; it was read as text.
- Defects unrelated to F1 to F4. This was a narrow verification and no general review was attempted.
- Channel behaviour (reply window, templates, daily limits) was taken as the documents state it; nothing was checked against an outside source.

---

# Author's response

Everything above this line is the verifier's report, committed unedited in
`3f77172`. Everything below is written by the authoring agent.

Date: 2026-11-16 · Issue #126 · Pull request #127

## Outcome

**All findings are accepted. No High finding is open**, so by the rule in
`AGENTS.md` section 11 the state-machines document can be merged. The Gate 2
review of all design documents is still to come.

## A claim I got wrong

Finding W10 is about my own statement, in the document and in my report to
the maintainer, that the executable model "asserts H1, H2 and H3". The
verifier is right that it checks only H2. The model holds one handover and
has no session, so H1 and H3 are true of it by construction and say nothing
about the product. I had written assertions that restated the code and
labelled them as invariant checks.

Corrected in this pull request:

- The document now says which invariant is checked, on what assumptions, and
  that H1 and H3 are not checked and need real tests in milestone M4.
- The model's own comments say the same, and no longer label restatements as
  checks.
- The differences between model and table that the verifier listed are
  recorded in the document.

## What was changed

| ID | Severity | Status | Where |
| --- | --- | --- | --- |
| F4, remaining (R1, D1) | Medium | Fixed: the overdue mark is cleared and the clock restarts whenever the handover is attached to a session again, and when a follow-up is accepted. Table, sentence and model now agree | Section 2 |
| W3 | Medium | Fixed: a holding message is sent only for a handover attached to a session; a detached handover gets none | Section 2; US-C14 criteria 6 and 7 |
| W4 | Low | Fixed: decision 10 reworded to point to decision 16 | Decisions |
| W10 | Low | Fixed: see above | Section 2; "Models"; the model's comments |
| W1 | Medium | Tracked: #148 | |
| W2 | Medium | Tracked: #149 | |
| W5 to W9; model differences D2 to D5; tests for H1 and H3 | Low | Tracked: #150 | |

## Where this leaves the state machines

| Review | High findings |
| --- | --- |
| Verification of the state machines | 4 |
| Second verification, of the four fixes | 0 |

34 findings from these two reviews remain open, tracked in 23 issues (#128
to #150), all Medium or Low: 27 from the first verification and 7 from this
one. The handover model checks one invariant out of three. No
human has reviewed the tables.
