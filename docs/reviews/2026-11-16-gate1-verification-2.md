# Verification review 2: Gate 1

Date 2026-11-16 · Files read: `docs/requirements/glossary.md` and `docs/requirements/user-stories.md`, both in full · Deliberately not read: everything under `docs/reviews/`, `docs/adr/`, `docs/STATUS.md`, any `review-*.md`, git history, issues, pull requests, and every other requirements document (`nfr.md`, `open-questions.md`, `compliance.md`, `vision.md`, `personas.md`).

Note on context: the environment placed the full text of `AGENTS.md` in my context after I read the two files. I did not ask for it and did not use it; every judgement below rests on the two requirements files alone. I could not see the earlier version of the requirements, so where I say a defect was "introduced by the fix" I am inferring that from the defect reports as given to me.

## Summary

| Item | Reported severity | Verdict | What remains |
| --- | --- | --- | --- |
| E1 | Serious | PARTLY RESOLVED | Medium: a handover answered from a later session has no defined end and leaves the assistant active alongside staff (M1). Medium: handing back an unanswered handover has no outcome (M2). |
| E2 | Serious | PARTLY RESOLVED | Medium: a calendar date the assistant works out itself (for example in an opening-hours answer) can pass under no claim rule, so a correct reply is still blocked (R2). Medium: the claim kind "the contact's booking" has no pass rule (M3). |
| E3 | Moderate | RESOLVED | Nothing from the reported defect. One Low boundary gap noted (R3). |
| E4 | Moderate | PARTLY RESOLVED | Medium: a booking moved to a start nearer than the reminder lead time still gets a reminder time in the past, or none is defined (R4). The "affected appointment" half is resolved. |
| E5 | Moderate | RESOLVED | Nothing from the reported defect. One Medium gap in the touched rule (R5: an opt-out sent while the tenant is not answering) and one Low (R6). |

New defects introduced by the fixes: High 0, Medium 4 (M1 to M4), Low 3 (M5 to M7).
Defects left open in the touched rules that I cannot attribute to the fixes: High 0, Medium 3 (R2, R4, R5), Low 2 (R3, R6).

No High defect remains open or was introduced.

That sentence is a judgement call in one place. M1 is the closest to High: it is the same kind of fault as the original E1 (an outcome that cannot be reached) on a narrower path. I rate it Medium because the customer has been answered by a person on that path, staff have an action that ends the handover, and the gap can be closed with one sentence. If the gate treats "any handover path without a defined automatic end" as untestable, M1 would be High.

## E1: unanswered handover that outlives its session

### Current rules

- Glossary "Handover": answered once a staff user sends a staff message from it; three outcomes (`handed-back`, `answered`, `closed-unanswered`); an unanswered handover does not end with its session; a new session starts handed over only when the contact writes after `handover_followup`; in every other case the assistant answers the next session.
- Glossary "Message classes", Service notice row: `handover_followup` sent at most once per handover, language by US-C9 criterion 2, withheld with the usual reasons if it cannot be sent, blocked by an opt-out made after the request, held to the end of quiet hours.
- Glossary "Fixed values": unanswered follow-up expiry, 7 days after `handover_followup`.
- Glossary "Metrics", Handover rate: shows "the count of handovers that are unanswered or were closed unanswered".
- US-C6 criteria 7 and 8; US-C14 criteria 9 to 16; US-C16 criterion 5; US-D3 criteria 2, 4 and 6; US-D4 criterion 2.

### Cases traced

1. **Original scenario.** Customer asks for a person (US-C6 c1); nobody answers; session ends. Handover stays listed as unanswered (US-C6 c8, US-C14 c9). Staff choose follow-up (US-C14 c10): template sent once, handover "stays open and unanswered", so the follow-up is not an answer. Customer replies: session handed over under the same handover, customer told a person will reply, staff notified, assistant silent (US-C14 c12). Staff reply: answered (c14). Then hand back gives `handed-back`, or session end gives `answered` (US-C6 c7). Coherent.
2. **Customer replies after 2 days.** The template started its own session, which ended after 24 hours. The reply starts a new session, handed over under the same handover (c12, glossary). Then as case 1. Coherent. If the reply comes within 24 hours it falls in the session the template started; c12 covers it ("the session that message belongs to"), although the glossary says "a new session starts handed over" (M5, Low).
3. **Customer never replies.** 7 days after the template was sent: `closed-unanswered`, reason `no-response` (c15). One outcome.
4. **Customer replies on day 8.** Handover already ended; c12 does not apply; the assistant answers. Defined. The template invited a reply "so that a person can answer" and the assistant answers instead, but the customer can ask again. Acceptable.
5. **Customer replies to the follow-up, staff still do not answer, session ends.** Handover unanswered; the follow-up cannot be sent again (c11); the 7-day expiry no longer applies because the contact did write. Every later message from that contact is handed over under the same handover (c12) until staff answer or close it. Defined, ends only by staff action. See M7.
6. **No follow-up; customer writes in a new session; staff then message them.** Assistant answers the new session (c13). Staff send a message "from" the old handover inside the reply window: handover answered (c14). From here the rules run out:
   - The new session is not handed over (glossary: "in every other case the assistant answers"), so when the customer replies to the staff member, the assistant answers. Staff and assistant talk at once.
   - `answered` is defined as "its session ends after staff answered". Its session ended before staff answered, and the new session does not belong to the handover (only the follow-up path attaches a later session). No event produces `answered`.
   - `closed-unanswered` is not available: c15 requires an unanswered handover.
   - `handed-back` remains, if hand-back is allowed for a handover whose current session is not handed over (US-D3 c4 presupposes "a handed-over session").
   Result: if staff answer and walk away, the usual case, the handover stays open and answered for ever. This is M1.
7. **Customer opted out after asking for a person.** Inside the session staff can still reply (US-D3 c6 blocks only when the session's only messages are opt-outs). After the session ends, the follow-up is blocked and recorded as withheld `opted-out`. Nothing was sent, so no 7-day timer runs; staff must close it (c15) and it ends `closed-unanswered`. One outcome. What staff see when the follow-up is withheld is not stated (M6, Low).
8. **Staff hand back after answering.** `handed-back` (US-C6 c7); assistant answers the next message (US-D3 c4). One outcome.
9. **Staff hand back without answering** (for example a `staff` takeover under US-D3 c2, read and returned, or a `limit` handover that needs no reply). US-D3 c4 allows it. `handed-back` is defined as "after answering" and US-C6 c7 has "staff have answered" as its precondition. No outcome is defined: read literally the assistant resumes and the handover stays on the waiting list as unanswered until someone also closes it. This is M2.
10. **Staff answer inside the original session, never hand back, session ends.** `answered`. One outcome.

### Minor points from the report

- Template unapproved: follow-up unavailable and the dashboard says why (c11). Resolved.
- Language: US-C9 criterion 2 (c10 and glossary). Resolved.
- Frequency: once per handover (c10, c11, glossary). Resolved.
- Does the follow-up count as answering: no (c10; it is a service notice, not a staff message). Resolved.

### Is the "unanswered" count computable?

Yes for every state the rules define: a handover is open and unanswered, open and answered, or ended with one outcome, and the metric counts the first state plus `closed-unanswered`. Two small points: the open-and-answered handover of M1 is in neither count and never leaves that state; and US-D4 c2 says "the count of unanswered handovers" while the glossary says "unanswered or were closed unanswered" (the glossary governs).

### Verdict: PARTLY RESOLVED

The reported scenario and all four minor points are fixed, and the fix is well made on the follow-up path. What remains is M1 (Medium) and M2 (Medium): two paths on which a handover reaches no defined outcome.

## E2: output guardrail blocked correct replies about opening hours and policies

### Current rules

- Glossary "Grounded fact": six kinds; every asserted fact containing a currency amount, clock time or calendar date is checked at run time "claim by claim, whatever its kind"; facts without such a value are measured by evals; a customer's value repeated back is not an asserted fact unless the assistant confirms it.
- Glossary "Fixed values": tool result age limit 10 minutes.
- US-C4 criteria 2 to 13; US-C6 criterion 2 (two guardrail fallbacks hand the session over).

### Consistency of story and glossary

The contradiction reported is gone. The glossary now says such values are checked at run time for every kind and US-C4 c2 lists the same six kinds. Criterion 13 leaves value-free statements to evals, as the glossary says. Two differences remain: the glossary says a fact may be stated only if "true of the thing it is stated about", while c5 and c6 check something weaker (see cases 2 and 3); and the glossary says every such fact is checked at run time while c11 admits one case is not (M4).

### Cases traced

1. **Correct opening hours** ("Monday 09:00 to 18:00", stored the same). Two claims of kind opening hours for Monday; both equal a stored time (c5); both values covered (c8); sent. Criterion 7 states this outright. Fixed.
2. **Wrong opening time** ("we open at 08:00", stored 09:00). With a claim: fails c5, fallback. Without a claim: uncovered under c8, fallback. Blocked. Exception: c5 accepts the opening or the closing time, so "we close at 09:00" passes; left to evals (c13). Low, noted under M5.
3. **Policy sentence with a fee and a number of hours** ("cancel less than 24 hours before and there is a 50 SAR fee"). 50 SAR: policy claim, value appears in the stored policy text (c6), passes. "24 hours" is a duration and is not checked (c8). Sent. Fixed. Weakness: c6 tests presence only, so swapping two fees that both appear in one policy passes; left to evals.
4. **Reply repeating the customer's requested time** (customer: "Friday at 15:00?"; assistant: "Which service would you like at 15:00 on Friday?"). 15:00 appears in the customer's messages; passes c8 with no claim. Fixed. If the customer wrote the time in words or another format, the match depends on normalisation that is not specified (M5).
5. **Correct price for the right service.** Price claim equals the stored price of the named service (c3); sent. A price claimed for the wrong service fails c3.
6. **Customer suggests a wrong price and the assistant agrees** ("it's 50, right?" "Yes, 50 SAR", stored 80). If the model returns a price claim, c3 fails and the reply is blocked. If it returns none, c8 passes the value because it is in the customer's message. Criterion 11 acknowledges this and relies on evals. See M4.
7. **The customer's own booking** ("your appointment is Friday 20 November at 10:00"). As kind "slot or booking time" with a fresh tool result it passes c4. As kind "the contact's booking", which c2 offers, no criterion says when it passes. See M3.
8. **Opening hours on a date** (customer: "are you open tomorrow?"; assistant: "Yes, tomorrow, Friday 20 November, 09:00 to 18:00"). The two times pass c5. The date is a calendar date, is not in the customer's messages, and no claim rule can pass it: c5 compares only times for a weekday, and there is no tool result. Under c8 and c10 the correct reply is replaced by the fallback, and a second such reply hands the session over (US-C6 c2). This is the reported defect surviving for one kind of value. See R2.
9. **A total** ("both together are 130 SAR"). Not sent (c9), and uncovered under c8 in any case. As intended.

### Verdict: PARTLY RESOLVED

The reported cases (opening hours, policy with amount, time or date) now pass, and story and glossary agree on the principle. Remaining: R2 (Medium), M3 (Medium), M4 (Medium), M5 (Low).

## E3: holding message due after the reply window closed

### Current rules

- US-C14 criteria 4 to 7; glossary Service notice row ("the holding message for an overdue handover, sent only while the reply window is open"); US-C9 criterion 1 for the boundary of the window.

### Cases traced

1. **Original scenario.** Handover Friday 20:00, business hours Monday to Friday 09:00 to 17:00, escalation 15 minutes. Counted from Monday 09:00 (c7); overdue Monday 09:15; window closed Saturday 20:00; marked overdue, no holding message (c6). The customer already has the next opening time and the support contact (US-C6 c6). Defined.
2. **Short gap.** Handover 08:50, opening 09:00: overdue 09:15, window open, one holding message (c5).
3. **Exactly 24 hours.** By US-C9 c1 and c2 the window is open at less than 24 hours and closed at 24 hours or more, so at exactly 24 hours c6 applies. Unambiguous.
4. **Customer writes again while waiting** (Sunday 22:00 in case 1). Message joins the waiting session (c8) and reopens the window; Monday 09:15 the holding message is sent (c5). Consistent.
5. **Follow-on.** After c6 the handover is unanswered with a closed window, which is exactly the precondition for the follow-up (c10). The two fixes fit together.
6. **Escalation time runs out after closing** (handover 16:55, closing 17:00, 15 minutes). Criterion 4 marks overdue only "when that time passes inside business hours"; criterion 7 covers only sessions handed over outside business hours. This handover is never marked overdue by the text. See R3.

### Verdict: RESOLVED

The reported gap is closed and glossary and story agree. R3 (Low) is a neighbouring gap, not part of the reported defect.

## E4: reminder quiet hours on reschedule; "affected appointment"

### Current rules

- US-B3 criteria 1 to 4 and 8; glossary "Quiet hours rules", rows Appointment reminder and Booking-change notice; "Fixed values" rows Reminder floor and Urgent booking-change notice; US-D12 criteria 2 and 3.

### Cases traced (quiet hours 22:00 to 08:00, lead time 24 hours)

1. **New booking,** made Monday 10:00 for Wednesday 07:00. Due Tuesday 07:00, in quiet hours; Monday 21:59 is in the future; set for Monday 21:59 (c3).
2. **Reschedule before quiet hours,** Tuesday 21:00, moved to Thursday 07:00. Due Wednesday 07:00; Tuesday 21:59 still ahead; set for 21:59 (c3, c8).
3. **Reschedule during quiet hours,** Tuesday 22:30, moved to Thursday 07:00. Tuesday 21:59 has passed; end of quiet hours Wednesday 08:00 is 23 hours before the start; set for Wednesday 08:00 (c4). This is the reported case and it now works.
4. **Reschedule to a start inside the lead time, due time in quiet hours.** Tuesday 09:00, moved to Wednesday 07:30. New due time Tuesday 07:30, already past, inside Monday's quiet hours. Criterion 3: Monday 21:59 is past. Criterion 4: "the end of those quiet hours" is Tuesday 08:00, more than 60 minutes before the start, so the reminder is set for Tuesday 08:00, which is in the past. The defect as reported still occurs.
5. **Same move made at Tuesday 23:00.** Same result, Tuesday 08:00. If an implementer sends a past-due reminder at once, it goes out during quiet hours.
6. **Reschedule to a start inside the lead time, due time outside quiet hours.** Tuesday 12:00, moved to Wednesday 10:00. Due Tuesday 10:00, past. Criterion 8 says the reminder "is rescheduled for the new time"; criterion 2 (no reminder inside the lead time) speaks only of a booking "made" then. Send now, or no reminder? Not stated.
7. **Staff move a booking from tomorrow 09:00 to next week, at 23:00.** Earlier of old and new start is 10 hours away; notice sent at once (US-D12 c3). Correct: the customer must not turn up.
8. **Staff move a booking from next week to tomorrow 09:00, at 23:00.** New start within 12 hours; sent at once.
9. **Staff cancel at 23:00 a booking for 12:00 next day.** 13 hours; sent at 08:00.

### Verdict: PARTLY RESOLVED

- "Affected appointment": resolved. US-D12 c3 and the glossary table say the same thing in the same words. (The Fixed values row still says only "Appointment starts within 12 hours"; not a conflict.)
- Reminder time in the past: fixed for the branch "one minute before quiet hours has passed" (case 3), not fixed when the new start is nearer than the lead time (cases 4 to 6). This is R4, Medium: the outcome is undefined or a past time, and one reading sends a business-initiated message in quiet hours.

## E5: messages received while the tenant is not answering

### Current rules

- US-C1 criteria 5 to 8; glossary "Answering"; US-C14 criterion 8.

### Cases traced

1. **Original scenario.** Credentials fail; customer writes. HTTP 200; stored in its conversation marked `received-while-not-answering`; no reply (c6). Owner and operator are emailed (c8). On recovery the assistant does not answer the old messages and the conversations are listed in the dashboard as unanswered (c7). Kept and shown. "Unroutable" is now used only for a number that maps to no tenant (c5), where there is no one to show it to.
2. **Handed-over session during an outage.** Message is marked and "also joins the waiting session (US-C14)" (c6). US-C14 c8 says the same. The conflict is gone.
3. **Outage ends, customer writes again in the same session.** The assistant answers the new message; the marked ones are not answered on their own (c7). Workable. When a conversation leaves the unanswered list is not stated (R6).
4. **Long outage.** Listed conversations are older than 24 hours. Staff cannot send free-form (US-C9 c4) and no template covers this; `handover_followup` needs a handover. Staff can see the customer and nothing more through the product. Part of R6.
5. **Customer sends an opt-out keyword during the outage.** Criterion 6 stores it and sends no reply. Nothing says the contact is marked opted out (US-C7 c1 has processing and confirmation in one "then"). Criterion 7 says only that the assistant does not answer. If the opt-out is not applied, reminders resume to someone who said stop. See R5.

### Verdict: RESOLVED

Both parts of the reported defect are fixed. R5 (Medium) and R6 (Low) are gaps in the same criteria that the report did not name.

## New defects introduced by the fixes

| ID | Severity | Location | Defect | Suggested resolution |
| --- | --- | --- | --- | --- |
| M1 | Medium | US-C14 c14; glossary "Handover"; US-C6 c7 | A handover answered from a later session ("in any session") has no defined end unless staff hand it back: `answered` needs "its session" to end after the answer, and that session has already ended. The later session is also not handed over, so the assistant answers the customer's reply to the staff member. | State that a staff message sent from an unanswered handover hands the current session over under that handover; `answered` then follows when that session ends. |
| M2 | Medium | Glossary "Handover"; US-C6 c7; US-D3 c4 | Handing back a handover that staff never answered has no outcome: `handed-back` is defined only "after answering". The assistant resumes while the handover stays listed as unanswered. Origin uncertain; it sits in the outcome definitions the fix rewrote. | Either let `handed-back` apply without an answer, or state that hand-back of an unanswered handover ends it as `closed-unanswered` with a reason. |
| M3 | Medium | US-C4 c2 against c3 to c6 | Criterion 2 lets a claim have kind "the contact's booking", but no criterion says when such a claim passes. Read with c10, a correct statement of the customer's own booking time is either always blocked or untestable. | Fold that kind into c4 (booking time from a tool result no more than 10 minutes old), or add its own pass rule. |
| M4 | Medium | US-C4 c8 and c11; glossary "Grounded fact" | The exemption for values in "the customer's own messages in this session" matches the value alone, anywhere in the session. A wrong price or time the customer suggested, or mentioned earlier for another purpose, passes at run time whenever the model returns no claim for it. Criterion 11 admits the confirm case and leaves it to evals; the glossary still says every such fact is checked at run time. | Narrow the exemption (for example: only the latest customer batch, and never for currency amounts), or state the residual risk in the glossary and name the eval that carries it. |
| M5 | Low | US-C4 c5, c6, c8; glossary "Handover" against US-C14 c12 | Loose wording in the new checks: "normalising numerals and formats" and "the same value" are not defined (times in words, month names across languages, whether a date and a time are one value or two); c5 accepts opening or closing time interchangeably and does not say how several periods in a day are treated; c6 checks presence only. Separately, the glossary says "a new session starts handed over" while a reply within 24 hours of the template falls in the session the template started. | Define normalisation and matching in the design or eval plan and reference it from c6 and c8; reword the glossary sentence to match c12. |
| M6 | Low | Glossary Service notice row; US-C14 c11; US-D12 c4 | A `handover_followup` that is withheld (opted out, template unavailable, limit) or fails is "recorded" but shown nowhere: the withheld list covers business-initiated messages only, and c11 explains only two reasons. Whether a failed send starts the 7-day timer is not stated. | Show withheld or failed follow-ups on the handover and say whether the action becomes available again. |
| M7 | Low | US-C6 c8 against US-C14 c12; US-C14 c12 and c15 | Criterion C6.8 says without exception that the assistant answers the customer's next message, which c12 contradicts once the follow-up was sent (the glossary governs, so this is a wording defect). Also, once a contact has replied to the follow-up, the handover has no automatic end and every later session is handed over until staff act; and c12 does not say which handover applies if a contact has two unanswered ones. | Add "unless `handover_followup` was sent (US-C14)" to C6.8; consider an expiry or a staff prompt for the replied-but-unanswered state; name the most recent handover in c12. |

Defects left open in the touched rules, not attributable to the fixes:

| ID | Severity | Location | Defect | Suggested resolution |
| --- | --- | --- | --- | --- |
| R2 | Medium | US-C4 c5, c8, c10 | A calendar date the assistant works out itself (a relative day or weekday turned into a date, typically in an opening-hours answer) can pass under no claim rule, so a correct reply is replaced by the fallback and a second one hands the session over. | Add a rule that a date passes if it is the correct date for a weekday or relative day in the customer's message in the tenant's time zone, or exclude such dates from c8. |
| R3 | Low | US-C14 c4 and c7 | A session handed over inside business hours whose escalation time runs out after closing is never marked overdue. | Count the remaining escalation time from the next opening time. |
| R4 | Medium | US-B3 c2, c4, c8; glossary "Quiet hours rules" | A booking moved to a start nearer than the reminder lead time gets a reminder time in the past (when the due time fell in quiet hours) or has no defined result (when it did not). | Apply c2 to rescheduling: no reminder if the new start is nearer than the lead time; and require in c4 that the end of quiet hours is still in the future. |
| R5 | Medium | US-C1 c6 and c7; US-C7 c1 | An opt-out sent while the tenant is not answering is stored but nothing says it is applied, so business-initiated messages can resume to a contact who asked to stop. | State that opt-out and opt-in keywords and buttons are applied by code even when the tenant is not answering, with the confirmation withheld. |
| R6 | Low | US-C1 c7 | Nothing says when a conversation leaves the unanswered list or what staff can do about one older than 24 hours. | State the clearing rule (staff dismiss, or a later reply) and that contact outside the window is by the tenant's own means. |

## Not checked

- Anything outside the two files: numeric targets (NFR-A2, NFR-P5 and others cited), open questions OQ-5 to OQ-7, the compliance source for the reply window, the eval plan, the guardrail policy, the wording of any template including `handover_followup`.
- The earlier version of the requirements and the earlier reviews. I therefore cannot confirm which defects are new and which were already present; the split between the two tables above is an inference.
- Stories and glossary entries that do not bear on E1 to E5. I read them but did not review them, and the absence of a comment is not a finding of soundness.
- Whether the story count and criterion count stated at the top of `user-stories.md` are correct.
- Channel behaviour assumed by the rules (for example that a template message starts a session, or how the channel reports a failed template send).
- Nothing was executed; all traces are by reading.
