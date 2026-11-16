# Verification review: Gate 1 High findings

Date 2026-11-16 · Files read: `docs/requirements/glossary.md`, `user-stories.md` and `nfr.md` in full, and rows R-T5 and R-C5 of `risks.md` (extracted by pattern; the rest of that file was not read) · Deliberately not read: everything under `docs/reviews/`, `docs/adr/`, `docs/STATUS.md`, any `review-*.md`, git history, issues, pull requests and the author's description of the fixes.

The environment placed the content of `AGENTS.md` in my context without my asking. I did not use it for any judgement below.

## Summary

| Defect | Verdict | What remains |
| --- | --- | --- |
| D1 Handover dropped at session end | PARTLY RESOLVED | The handover now survives, but what happens after staff follow up is incoherent (N1, High); the holding message has no rule once the reply window has closed (N2, Medium) |
| D2 Message classes | PARTLY RESOLVED | Low: a contact who sends other messages and then the opt-out keyword can still be written to by staff for 24 hours |
| D3 Quiet hours | PARTLY RESOLVED | Medium: a rescheduled booking can still get a reminder time in the past; "the affected appointment" is ambiguous for a moved booking |
| D4 Tenant silenced | PARTLY RESOLVED | Medium: messages that arrive while a tenant is not answering are never recovered, and the rule conflicts with US-C14 criterion 6 |
| D5 Slot and capacity | RESOLVED | Low notes only |
| D6 Provider failure | RESOLVED | Low notes only |
| D7 Retention | RESOLVED | Low notes only |
| D8 Output guardrail | PARTLY RESOLVED | The reported cases are fixed, but the new text rule blocks correct replies about opening hours and policies (N3, High) |

New defects introduced by the fixes: 2 High (N1, N3), 1 Medium (N2), 3 Low (N4, N5, N6).

High defects remain: N1 (the life of an unanswered handover after its session ends, US-C14 criteria 8 and 10 with the glossary's "Handover"), N3 (US-C4 criterion 5 blocks correct replies that state opening hours or policy amounts, dates and times).

## D1. Handover dropped when the session ends

**Current rules.** Glossary "Handover" (answered; outcomes `handed-back`, `answered`, `closed-unanswered`; "An unanswered handover does not end when its session ends"; "A new session never starts handed over"). US-C6 criteria 7 and 8. US-C14 criteria 4, 5, 6, 7, 8, 9, 10. Message classes: "Service notice" (holding message, `handover_followup`). Quiet hours rules: `handover_followup` held to the end of quiet hours. US-C16 criterion 5. Metric "Handover rate" shows the count unanswered or closed unanswered.

**Case 1, the original scenario.** Business hours end 18:00 Friday and resume 09:00 Monday; escalation time 15 minutes.

| Time | Event | Rule |
| --- | --- | --- |
| Fri 19:00 | Customer asks for a person. Handed over, reason `requested`. Customer is told the next opening time and the support contact | US-C6 1, 6 |
| Sat 19:00 | 24 hours with no message: the session ends and the reply window closes | Glossary "Session", "Reply window" |
| Sat 19:00 onward | The handover stays on the waiting list, marked unanswered, with the date of the request | US-C6 8, US-C14 7 |
| Mon 09:15 | Escalation time, counted from the next opening time, passes. The handover is marked overdue. A holding message is required | US-C14 4, 5 |
| Mon 10:00 | Staff choose to follow up: `handover_followup` is sent as a service notice; no consent needed | US-C14 8 |

The handover is no longer dropped, staff have a template, and an outcome is stored. Those three parts of the report are fixed.

Two problems appear in this trace.

- At Mon 09:15 the holding message is due 38 hours after the customer's last inbound message. It is a free-form service notice with no template, so the channel will not accept it, and no rule says it is withheld or replaced. A tenant that closes one day a week reaches this every week (handover at Sat 18:30, next opening Mon 09:00 is 38.5 hours later). This is N2.
- After Mon 10:00 the rules stop making sense; see case 2.

**Case 2, the customer replies to the follow-up.** At Mon 10:05 the customer answers the template: "Yes, I wanted to ask about my refund."

1. The follow-up was the first message after 24 quiet hours, so it started a new session S2 (glossary "Session").
2. S2 is not handed over: "A new session never starts handed over, so the assistant answers the customer's next message even while an old handover is still listed as unanswered." US-C6 criterion 8 says the same.
3. So the assistant answers a customer who was just invited "to reply so that a person can answer" (US-C14 8).
4. No handover is recorded in S2, so US-C14 criteria 1 and 2 do not fire: staff get no waiting-list change and no email saying the customer replied. US-C14 criterion 6 does not apply either, because S2 is not handed over.
5. The old handover H1 cannot reach any of its three outcomes. `answered` is "the session ends after staff answered", but its session ended on Saturday. `handed-back` needs staff to hand back a session that is not handed over. `closed-unanswered` is defined as closing "without contacting the customer", which is false here.
6. It is also unstated whether sending the follow-up makes H1 "answered" (the definition is "a staff user sends a message in it"; the follow-up is a service notice sent by code), and whether a staff message typed into S2 belongs to H1 or creates a second handover with reason `staff` under US-D3 criterion 2.

US-C14 criterion 10 ("stored with one outcome") cannot be tested for this path, and the unanswered count in the handover-rate metric is undefined for it. This is N1, High.

**Case 3, a new session while the old handover is unanswered, without a follow-up.** Customer writes again on Sunday 11:00. New session, the assistant answers (US-C6 8). H1 stays listed. On Monday staff see H1 with its date, read the conversation, and close it with a reason (US-C14 9). This works.

**Case 4, opt-out.** Customer asks for a person, then sends the opt-out keyword. The holding message and the follow-up are service notices "blocked by opt-out if the contact opted out after making the request": both are suppressed. A contact who had opted out earlier and then asked for a person can still get them, which is right, because the request is the basis. This works.

**Verdict: PARTLY RESOLVED.** The silent drop is gone. What remains is N1 (High) and N2 (Medium).

## D2. Message classes

**Current rules.** Glossary "Message class", "Reply", "Reply window", and the "Message classes" table with the sentence "Whether the reply window is open never changes a message's class." US-C7 criteria 3, 4; US-C9 criteria 1, 2, 4; US-C13 criteria 1, 4; US-D3 criteria 5, 6; NFR-V1.

**Each class tested.**

| Class | Case | Result |
| --- | --- | --- |
| Assistant reply | Opted-out contact asks a price | Answered; no consent or opt-out applies (US-C7 4). Correct |
| System reply | Handover message at 03:00 after a customer's request | Sent; quiet hours do not apply. Correct |
| Staff message | Typed at 23:30 inside the window, not answering the latest inbound message | Its class is fixed by who wrote it, so it is defined; sent free-form (US-D3 5). Part (b) of the report, "in no defined class", is fixed |
| Service notice | Holding message for a contact with no recorded consent | Sent; "the contact's own request is the basis". Part (a) of the report is fixed |
| Business-initiated | Reminder due 2 hours after the contact's last message, contact has no consent | Still business-initiated, because the window does not change the class; withheld `no-consent` (US-C13 1). Correct. With consent it may be free-form (US-C9 1) |

**Opt-out and staff messages.**

- A reminder template goes out; the contact's only reply is the opt-out keyword. Their only messages in the session are opt-out requests, so staff are blocked (US-D3 6). The reported hole is closed for this, the commonest, case.
- The contact writes "hi" at 10:00 and the opt-out keyword at 10:05. Their messages in the session are not only opt-out requests, so staff may send free-form text until 10:05 the next day. The window was already open, but the opt-out message extends it by five minutes and does not close it. US-C7 criterion 4 limits opt-out to business-initiated messages, so this is consistent with the rules as written; whether a business should be able to write to someone who has just said stop is a product decision the text does not state. Low.

**Verdict: PARTLY RESOLVED.** Both reported parts are fixed. Remaining, Low: the staff-message block applies only when the opt-out is the contact's sole content in the session. State that this is intended, or block staff messages after any opt-out until the contact writes something else.

The holding message's behaviour when the window has closed is recorded under D1 as N2.

## D3. Quiet hours

**Current rules.** Glossary "Quiet hours" (start inside, end outside: 21:59 and 08:00 allowed, 22:00 not), "Withheld reason" (held is not withheld), the "Quiet hours rules" table, fixed values "Reminder floor after quiet hours" (60 minutes) and "Urgent booking-change notice" (12 hours). US-B3 criteria 1, 2, 3, 4, 8; US-D12 criteria 2, 3; US-C9 criterion 5.

**Case 1, the original scenario.** Lead time 24 h, quiet hours 22:00 to 08:00, booking made Mon 23:00 for Wed 07:30.

- Made 32.5 h before the start, which is at least 24 h: a reminder is scheduled (US-B3 1).
- Due time = Wed 07:30 − 24 h = Tue 07:30, inside the quiet hours Mon 22:00 to Tue 08:00.
- One minute before those quiet hours begin = Mon 21:59. Later than creation at Mon 23:00? No.
- End of those quiet hours = Tue 08:00. At least 60 minutes before Wed 07:30? Yes, 23.5 h.
- Sent Tue 08:00. Correct; the send time is after the booking exists.

**Case 2, a booking made during quiet hours for an appointment soon after they end.** Lead time 1 h, booking made Tue 07:00 for Tue 08:30.

- 1.5 h ≥ 1 h: a reminder is scheduled. Due 07:30, in quiet hours.
- Mon 21:59 is not later than creation.
- Tue 08:00 is 30 minutes before the appointment, under the 60-minute floor: withheld `too-late`. Defined.

**Case 3, boundaries.** Due time exactly 08:00: not quiet, sent at 08:00. Due time exactly 22:00: quiet; moved to 21:59 if the booking was created before 21:59. Defined.

**Case 4, a booking created in the last minute before quiet hours.** Created Mon 21:59:30, due time in the following quiet hours. 21:59:00 is not later than creation, so US-B3 criterion 3 does not apply. Criterion 4 requires "quiet hours that began before the booking was created", which is false (22:00 is after 21:59:30). Neither story criterion applies. The glossary's "Otherwise scheduled for the end" does cover it, and the glossary is the authority, so behaviour is defined, but the story text has a one-minute hole. This is N5, Low.

**Case 5, reschedule (US-B3 criterion 8).** Booking created the previous week. On Mon 23:00 the customer moves it to Wed 07:30.

- New due time Tue 07:30, in quiet hours.
- One minute before those quiet hours begin = Mon 21:59. Later than "the booking's creation time" (last week)? Yes.
- The reminder is scheduled for Mon 21:59, which is 61 minutes in the past.

This is the reported defect again by another route: the rule compares with the creation time, not with the time the reminder is being scheduled. The result is either a reminder sent at once at 23:00, inside quiet hours, or one never sent. The same happens when staff move a booking (US-D12 2). Remaining, Medium.

**Case 6, booking-change notice.** Staff at Tue 23:00 move a booking from Wed 07:00 to the following Monday. "Sent at once if the affected appointment starts within 12 hours." The old start is 8 hours away; the new start is not. If the new start is used, the notice waits until Wed 08:00, an hour after the customer has arrived for the old time. The rule does not say which start time is meant. A cancellation has only one time and is clear. Remaining, Medium (ambiguous, and one reading causes harm).

**Case 7, queued message.** A reminder queued for the daily limit, released at 02:00 for an 08:10 appointment, is held to 08:00 and sent 10 minutes before, although a reminder delayed directly by quiet hours needs 60 minutes. An urgent change notice that was queued is likewise held, although the direct rule sends it at once. This is N6, Low.

**Verdict: PARTLY RESOLVED.** Boundaries are stated, every message kind has a rule, and the original example now works. Remaining, Medium: (a) the reminder rule must compare with the time of scheduling, not the booking's creation time; (b) "the affected appointment" must be defined for a moved booking as the earlier of the old and new start.

## D4. Tenant silenced by incomplete setup

**Current rules.** Glossary "Answering" ("Templates do not affect it"). US-C1 criteria 5, 6. US-D6 criteria 4, 5, 6. US-C16 criteria 3, 4. Fixed value "Credential check: daily, and on any channel authentication error".

**Case 1, the original scenario.** Tenant has all settings and verified credentials; the reminder template is still pending. It is answering (US-D6 4). The setup screen shows it cannot send that message in that language and says answering is not affected (US-C16 3). A due reminder is withheld and listed (US-C9 3). Fixed.

**Case 2, a template is paused.** Messages using it are withheld `template-unavailable` and listed; one email to the tenant (US-C16 4). The tenant keeps answering. Fixed.

**Case 3, re-evaluation.** Triggers are: a setting saved, a credential check completing, a channel authentication error; plus a daily check (US-D6 5). Defined. A credential failure sends one email to the tenant and one to the operator (US-C1 6). Fixed.

**Case 4, credentials fail mid-handover.** A session is handed over at 10:00. At 10:20 a send fails with an authentication error; the tenant stops answering; both emails go out. At 10:30 the customer writes again.

- US-C1 criterion 5: the message is "stored as unroutable, and no reply is sent".
- US-C14 criterion 6: a message in a handed-over session "is added to the waiting session".

The two disagree about where the message goes. At 14:00 the owner saves new credentials; the tenant is answering again. Nothing says the unroutable events from 10:20 to 14:00 are processed, attached to their conversations, or listed for staff. Customers who wrote in those hours are never answered and appear nowhere a staff user looks, which is hard to square with NFR-R1 ("No inbound message is lost once acknowledged").

**Case 5, a check that cannot complete.** The daily check runs during a channel outage. The rules do not separate "credentials rejected" from "could not verify". If the second counts as a failure, the tenant is silent until the next trigger, up to 24 hours, with nothing to recover it sooner. Low.

**Verdict: PARTLY RESOLVED.** The three reported points (template dependency, re-evaluation triggers, notification) are fixed. Remaining, Medium: the fate of inbound messages, and of open handovers, while a previously answering tenant is not answering. State that such messages are attached to their conversations and processed, or listed for staff, when the tenant is answering again, and reconcile US-C1 criterion 5 with US-C14 criterion 6.

## D5. Slot and capacity

**Current rules.** Glossary "Slot", "Capacity", "Free slot"; settings "Slot interval" (30 min, 5 to 120) and "Total concurrent bookings" (not set, or 1 to 50). US-B2 criteria 1, 2, 3; US-B5 criteria 2, 3, 4; US-D2 criterion 1 (duration 5 to 480 minutes, capacity 1 to 50); US-D9 criteria 1 to 4. Risk R-T5.

**Case 1, the worked example in US-B5 criterion 4.** Service of 60 minutes, capacity 2, interval 30. Existing bookings occupy [10:00, 11:00) and [10:30, 11:30).

| Candidate | Interval | Greatest overlap with one more booking | Free? |
| --- | --- | --- | --- |
| 09:30 | [09:30, 10:30) | [10:00, 10:30): 1 existing + 1 = 2 | Yes |
| 10:00 | [10:00, 11:00) | [10:30, 11:00): 2 existing + 1 = 3 | No |
| 10:30 | [10:30, 11:30) | [10:30, 11:00): 2 existing + 1 = 3 | No |
| 11:00 | [11:00, 11:30) | [11:00, 11:30): 1 existing + 1 = 2 | Yes |

09:30 does not touch the 10:30 booking and 11:00 does not touch the 10:00 booking, because the interval excludes its end. My result matches the story's, including its stated reason.

**Case 2, the grid.** Opening period 09:00 to 13:00, interval 30, duration 45. Starts 09:00, 09:30, … Last start s with s + 45 ≤ 13:00: 12:00 (ends 12:45) qualifies, 12:30 (ends 13:15) does not. Eight slots, 09:00 to 12:00. Defined and testable. A duration longer than the period gives no slots, which is right.

**Case 3, the tenant-wide limit, the two-chair clinic.** Service A 30 minutes, capacity 2; service B 60 minutes, capacity 2; total concurrent bookings 2. Existing: A at 10:00 [10:00, 10:30) and B at 10:00 [10:00, 11:00).

- Candidate A at 10:00: service A count 1 + 1 = 2, within capacity; tenant count 2 + 1 = 3, over the total. Not free. Correct.
- Candidate A at 10:30 [10:30, 11:00): service count 0 + 1; tenant count 1 (B) + 1 = 2. Free. Correct.
- Candidate B at 10:30 [10:30, 11:30): tenant count in [10:30, 11:00) is 1 + 1 = 2. Free. Correct.

With the setting left at its default, "not set", each service still fills independently, so the clinic in the report must set it. That is a documented setting, not a defect; a setup prompt would help.

**Case 4, R-T5.** The uniqueness mitigation is gone; it is now a transaction that locks "the affected service and time range", tested against the free-slot definition. No contradiction with a capacity above 1.

**Low notes, none blocking.**

- R-T5's lock names the service. With a tenant-wide total, two simultaneous bookings of different services can each pass. The stated test against the glossary definition would expose it; word the lock as covering the tenant's time range when the total is set.
- A reschedule: with capacity 1 and a booking at 10:00, moving it to 10:30 is not possible by the literal definition, because the booking being moved counts against itself. Say whether it is excluded.
- A booking's interval uses "the service's duration", so editing a duration changes the intervals of existing bookings.

**Verdict: RESOLVED.** The definitions are complete enough to compute and test availability, and the worked example is correct.

## D6. Provider failure

**Current rules.** Glossary "Awaiting retry", "Degraded mode", "Fallback message", handover reason `provider-failure`; fixed values "Model call timeout and attempts", "Awaiting-retry attempts", "Degraded-mode trigger and probe". US-C15 criteria 1 to 9; US-C6 criterion 2; NFR-R4.

**Case 1, one failed session on a quiet installation, provider down throughout.** Worst-case timings (every call times out at 20 s).

| Time | Event | Rule |
| --- | --- | --- |
| 12:00:00 | Customer message | |
| 12:00:03 | Batching window closes; attempt 1 | Fixed values |
| 12:00:23 | Attempt 1 times out; wait 1 s | US-C15 1 |
| 12:00:44 | Attempt 2 times out; wait 4 s | US-C15 1 |
| 12:01:08 | Attempt 3 times out. Session marked `awaiting-retry`; fallback sent with the person button | US-C15 2 |
| 12:02:08 | 60 s since the last attempt: attempted again; fails. No second fallback (one per session per 15 minutes) | US-C15 3, 2 |
| every 60 s after the previous attempt | Further attempts | US-C15 3 |
| 12:15:00 | The message is 15 minutes old: mark cleared, handed over with reason `provider-failure`; customer told a person will reply; staff emailed | US-C15 4, US-C6 5 or 6, US-C14 1, 2 |

Only one session is marked, so degraded mode never starts, and the customer is still either answered or handed over within 15 minutes. The central reported defect is fixed.

**Case 2, the provider recovers at 12:05.** The attempt after 12:05 succeeds; the answer is sent as a service notice; the mark is cleared (US-C15 3). If the customer sent the opt-out keyword at 12:03, the retried answer is blocked ("opted out after making the request"). Consistent.

**Case 3, degraded mode.** Five sessions marked between 12:00 and 12:02: degraded mode begins at the fifth; tenants with a marked session are emailed (US-C15 6), which defines "affected tenant". A message arriving at 12:04 is marked without a model call and gets the fallback under the 15-minute rule (US-C15 7). The 15-minute handover in criterion 4 has no "outside degraded mode" condition, so a session marked at 12:00 is handed over at 12:15 even if degraded mode lasts an hour: nothing is dropped. A health check succeeds at 12:20: every session still marked (those under 15 minutes old) is attempted at once (US-C15 8).

**Case 4, handed over while awaiting retry.** Customer taps the person button at 12:03: handed over with reason `requested`, mark cleared, never answered by the assistant later (US-C15 5). Defined.

**Case 5, fallbacks and US-C6 criterion 2.** Provider fallbacks do not count toward `repeated-failure`. Defined.

**Low notes, none blocking.**

- The 15 minutes run from the latest customer message, so a customer who writes every 10 minutes during a long low-traffic outage is never handed over automatically. The person button on each fallback is the way out.
- Whether a 60-second re-attempt is one model call or a full cycle of three is not stated.
- A tenant whose sessions are first marked after degraded mode began gets neither the start nor the recovery email; it does get handover emails.

**Verdict: RESOLVED.**

## D7. Retention

**Current rules.** NFR-V4. Glossary "Conversation" (no end), settings "Message retention" (12 months, 1 to 36) and "Booking horizon" (60 days, 7 to 365). US-D5 criteria 3, 4, 5. Risk R-C5.

**Case 1, the returning customer.** Retention 12 months. Messages on 2025-01-10, 2025-12-20 and 2026-11-10. On 2026-11-16 the job deletes the 2025-01-10 message (22 months old) and keeps the other two (under 12 months), "whatever the age of the conversation's other messages". The 2025-12-20 message goes on 2026-12-20. Each message lives at most the retention period. Fixed. R-C5 now says the same.

**Case 2, the never-messaging contact.** Created by a manual booking that started 2025-10-01; no messages. Conditions on 2026-11-16: no message within the period (true); no future booking (true); no booking that started within the period, with age "counted from the latest booking start" (2025-10-01 is over 12 months ago, true). Name and phone number are deleted. Fixed.

**Case 3, a booking beyond the retention period.** Retention 1 month, booking horizon 60 days. Customer books on 2026-11-16 for 2027-01-10. On 2026-12-17 their messages are over a month old and are deleted, but the contact has a future booking, so the name and number are kept. The reminder on 2027-01-09 can be sent. After the appointment, the contact is kept until 2027-02-10 (a booking that started within the period), then purged. Fixed.

**Case 4, an opted-out contact is purged.** The hashed opt-out record is kept, consistent with US-D5 criterion 4. Past bookings and sessions are kept without personal fields, so metrics do not change.

**Low notes, none blocking.**

- Whether a cancelled booking counts as a "future booking" or as "a booking that started" is not stated.
- US-C1 stores each webhook event, and unroutable events, separately from messages; NFR-V4 names only messages. Say whether stored events fall under the same job.
- An unanswered handover (D1) that staff never act on stays listed after its contact's number has been purged; a follow-up is then impossible.

**Verdict: RESOLVED.**

## D8. Output guardrail

**Current rules.** Glossary "Grounded fact" (six kinds; prices and slot or booking times checked at run time, the rest by evals; a value the customer stated and repeated back is not an asserted fact unless confirmed), fixed value "Age limit of a tool result" (10 minutes). US-C4 criteria 1 to 10. US-C6 criterion 2. NFR-A2, NFR-A3.

**Case 1, a correct reply quoting the customer's time.** Customer: "Can I come at 17:00 tomorrow?" Reply: "17:00 is not free, but 18:00 is."

- 18:00: a claim names the slot and the availability result, 2 minutes old. Passes criterion 4.
- 17:00: not claimed, but the same value is in the customer's message. Passes criterion 5.
- "tomorrow": relative, not checked.
- Sent. The over-block is fixed.

**Case 2, a correction.** Customer: "It's 200, right?" Stored price 250. Reply: "It is 250, not 200." 250 is claimed against the named service and equals its stored price (criterion 3); 200 is in the customer's message (criterion 5). Sent. Fixed.

**Case 3, a wrong price for the right service.** Service A is 250, service B is 200. Reply: "A costs 200", with a claim naming A. 200 ≠ 250: fails criterion 3; fallback (criterion 7). Under the old rule this passed because 200 existed in tenant data. Fixed. A price changed five minutes ago fails too, because the check is against the "current stored price".

**Case 4, a stale slot.** The reply states a slot from a result 11 minutes old: fails criterion 4. Fixed.

**Case 5, the customer asks to confirm a wrong price.** Customer: "It's 200, right?" Reply: "Yes, 200."

- If the model returns a claim, 200 ≠ 250 and the reply is blocked.
- If it returns no claim, 200 is in the customer's message and the reply passes.

Criterion 8 says openly that the run-time check cannot catch this and puts it on the eval suite, where NFR-A2 requires 0 with a grader that compares against labelled facts for the named service and is independent of the run-time check. The reported flaw, the grader sharing the guardrail's comparison, is fixed, and the limit is stated instead of hidden. Acceptable.

**Case 6, opening hours. This fails.** Customer: "What time do you open on Saturday?" Stored opening hours: 09:00 to 18:00. Reply: "We are open 09:00 to 18:00 on Saturday."

- Criterion 5: each clock time in the reply text "passes only if it is covered by a claim that passed, or the same value appears in the customer's own messages".
- Claims exist only for a price or a slot or booking time (criteria 2, 3, 4). Opening hours are neither, so no claim can cover 09:00 or 18:00.
- The customer did not type either value.
- The reply does not pass. The fallback is sent (criterion 7). The customer asks again; second fallback; the session is handed over with reason `repeated-failure` (US-C6 2).

The same happens for a policy that contains an amount or a date ("a deposit of 50 is taken", "closed on 23 September") and for a computed time ("you can cancel until 15:00"). This contradicts criterion 1 (a grounded fact that exists is stated), criterion 10 and the glossary, which say opening hours and policies are "measured by evals", not blocked at run time. Under the earlier rule this reply passed, because 09:00 was a value in tenant data, so the fix introduced it. It affects one of the most common questions a business receives. This is N3, High.

**Smaller points.**

- A value passes the text check if it appears anywhere in the customer's messages in the session, for any purpose: "my budget is 200", then later "the facial costs 200" with no claim, passes. It needs the model to omit the claim; the evals are the backstop. Low.
- How "the same value" is matched across "5 pm", "17:00", Arabic-Indic digits and number words is left to design. Low.

**Verdict: PARTLY RESOLVED.** Every over-block and under-block in the report is fixed, the grader is independent, and the glossary and the guardrail now agree on scope in the claim rules. But criterion 5 reintroduces over-blocking of correct replies in a new place (N3, High).

## New defects introduced by the fixes

| ID | Severity | Location | Defect | Suggested resolution |
| --- | --- | --- | --- | --- |
| N1 | High | Glossary "Handover"; US-C6 criterion 8; US-C14 criteria 8, 10 | An unanswered handover that outlives its session has no coherent end. The follow-up template invites a reply "so that a person can answer", but the reply falls in a new session that "never starts handed over", so the assistant answers it and staff are not notified. The old handover can then reach none of its outcomes: `answered` depends on a session that has already ended, and `closed-unanswered` is defined as not contacting the customer. Whether sending the follow-up counts as answering is not stated. Criterion 10 is untestable on this path and the unanswered count in the handover-rate metric is undefined | Define the outcome in terms of the handover, not its session. State that when staff send the follow-up, or a message, from an unanswered handover whose session has ended, the handover attaches to the contact's current session, which becomes handed over; the customer's reply is then added to the waiting list and staff are notified. State when such a handover ends as `answered` |
| N2 | Medium | Message classes "Service notice"; US-C14 criteria 4, 5 | The holding message is free-form and has no template. When the escalation time is counted from the next opening time and that is more than 24 hours after the customer's last message (any tenant closed one day a week), it is due after the reply window has closed, and no rule says what happens | State that a holding message due outside the reply window is not sent and the handover is only marked overdue, or send `handover_followup` in its place |
| N3 | High | US-C4 criterion 5, against criteria 1, 10 and glossary "Grounded fact" | Every currency amount, clock time and calendar date in a reply must be covered by a claim, but claims exist only for prices and slot or booking times. A correct reply stating opening hours, or a policy containing an amount, date or time, is blocked and replaced by the fallback; a second attempt hands the session over. The glossary says these kinds are measured by evals, not blocked | Either limit criterion 5 to amounts and times that are not opening hours or entered policy text, or add a claim kind for opening hours and policies that passes when the value equals the current stored item. Add an opening-hours case to the criteria |
| N4 | Low | US-C14 criterion 8; glossary "Message status", "Withheld reason" | `handover_followup` is a service notice, but withheld statuses and the withheld list are defined only for business-initiated messages, and the language rule in US-C9 criterion 2 likewise. Nothing says what staff see if the template is unapproved, which language is used, or how often it may be sent for one handover | Extend the withheld statuses and the language rule to template service notices; limit follow-ups per handover |
| N5 | Low | US-B3 criteria 3, 4 against the glossary's quiet hours rule | A booking created in the minute before quiet hours begin matches neither criterion; only the glossary's "otherwise" covers it | Reword criterion 4 as "otherwise", as the glossary does |
| N6 | Low | Glossary quiet hours rules, row "queued for the channel's daily limit" | A queued reminder released in quiet hours can be sent at their end less than 60 minutes before the appointment, and a queued urgent change notice is held, both unlike the direct rules for the same messages | Apply the message's own quiet-hours rule when it is released from the queue |

Defects that remain from the original findings, not new, are stated in their sections: D2 (Low), D3 (Medium, two points), D4 (Medium).

## Not checked

- Anything outside D1 to D8: this was not a full review of the requirement set.
- `risks.md` apart from rows R-T5 and R-C5; `personas.md`, `vision.md`, `open-questions.md`, `traceability.md` and `docs/compliance.md`. Statements that depend on them (channel rules for the reply window and templates, OQ-5, OQ-6, OQ-7) were taken as written.
- Whether the issues for each story match the text read here.
- The author's account of the fixes, earlier reviews, ADRs, status file and history, by instruction. I therefore cannot say whether a remaining point was knowingly accepted.
- Daylight-saving behaviour in the quiet-hours and slot rules, and month arithmetic in retention.
- Whether the channel in fact rejects free-form messages outside the window in the way N2 assumes; that rests on the glossary's "Reply window" entry.
- Pre-existing gaps noticed in passing but outside the fixes, for example an escalation time that passes outside business hours for a handover made inside them.
