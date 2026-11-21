# Check of the fixes to the M3 plan, 2026-11-22

A third agent, which wrote neither the plan nor the first review, checked
commit `3f405e9` against the response in
`2026-11-22-m3-plan-check.md`. Its report is below, unedited; line numbers
are that commit's. What the author did about it comes first. **These last
changes have not been checked by anyone but the author.**

## Author's response

| Finding | Done |
| --- | --- |
| P14, P21, P24 only partly fixed | Now: "booking unchanged" is named as M5's; the licence is in U17's done-when; question 1 says what a no does to U12 and U16 |
| V1 the "no" branch of question 1 | Accepted. Each unit's behaviour on a no is stated; U16's need of U11 is conditional |
| V2 U11's done-when | Accepted. U11 is shown with the triggers that exist then; US-C12, 4 is cited under U10; the later triggers are shown in U12 and U15 |
| V3 a handover after its session ends | Accepted. Question 1 and row 29 propose two more transitions in M3: detached at the session's end, re-attached by a new trigger. This makes a yes larger, and the plan says so |
| V4 default language is stored | Accepted; my statement was false |
| V5 #227 has open parts | Accepted; only its first part is settled, the others go to U4 and U15 |
| V6 #184 parts i, j, l | Accepted; U15, U12, U8 |
| V7 no M3 text carries a stop button | Accepted as an open point: U8 decides, and says what follows if none does |
| V8 booking texts | Accepted |
| V9 OQ-7 | Accepted |
| V10 status line; "in order" | Accepted |
| V11 U14 and the real call | Accepted; the first real call is U17's, and U14 is done without it |
| V12 flags | Accepted; the seven flags are read in U9 and each is passed to a named unit |
| V13 STATUS | Accepted |
| V14 rows 29, 30, 34 | Accepted |
| V15 US-C10 | Accepted; criterion 3 under U18, and U16 says the model's criteria are shown in U17. Criterion 1's "guardrail results" arriving with U9 is not written into the plan |
| V16 quotations | Accepted; the marks are gone or the words are the source's |
| V17 Needs column | Convention stated; the conditional arrows are named in a sentence, not dashed |
| V18 | #278 under U2, U3 and U4; #219 and #220 for U0 to place; the query builder look-again in U0; the dependency check in "How the units are worked" |
| V19 | Fixed |
| Check 4 | Steps 6 and 7 are said to be left out; step 14 is cited under U15; the partial handovers table and the logging writer are in the risks; the tenant limits are said to come from a finding and no story |

## The report

# Verification of the reworked M3 plan (HEAD 3f405e9, branch docs/m3-plan)

Done in a copy at `/tmp/m3verify`; nothing written to the original. No network, no tests, PostgreSQL untouched. No permission was denied.

## Verdict

The response is mostly true. Of 29 findings, 25 are fixed as claimed, P17 and P27 are as the response itself states them (partly; deferred to merge), and three are only partly fixed where the response says "Accepted" (P14, P21, P24). No response misstates what the files hold. The report section of the review file is byte-identical to `/tmp/m3review-report.md`. Counts are right (19 units, 8 questions, 7 new rows), table and diagram agree edge for edge, there is no cycle, all 90 issues sit under a unit, decisions rows 1 to 28 are unchanged from `main`, and the earlier review's row references are right again. The rewrite introduced new errors, none High. Three are Medium and all come from the handover record of question 1: the "no" branch contradicts U12 and leaves U12 and U16 unstated; U11's done-when and two of its criteria cannot be shown when U11 is finished; and what a handed-over contact's next session does in M3 is undefined. The rest are Low: one false statement of fact (a default language "no table holds"; `tenants.default_language` exists), an issue closed as settled with two parts open (#227), M3 parts of #184 and #222 dropped, and loose wording.

## Check 1: P1 to P29

| Finding | Status | Evidence |
| --- | --- | --- |
| P1 | Fixed | plan:111–119 (question 6), 144, 291–296 (U5); decisions row 33 |
| P2 | Fixed | plan:31–33, 102–110 (question 5), 155 (U16 done-when); row 32 |
| P3 | Fixed | 19 table rows by script; plan:10, 409; STATUS:397. Commit 2f84cab title still says sixteen, as the response says |
| P4 | Fixed | plan:52–55 matches `user-stories.md:543–550` |
| P5 | Fixed | plan:59–68 lists all eleven rows of policy section 6 (`guardrail-policy.md:238–248`); row 29. See V14 for what the row leaves out |
| P6 | Fixed | (a) U6 needs U2, plan:145; (b) U9 needs U8, :148; (c) U12 needs U8, :151; (d) U10 needs U11, :149; (e) US-C15, 10 under U9, :148; (f) real-model run in U17, which needs U14, :156; U16 needs U11, :155. Script: table and diagram have the same 37 edges |
| P7 | Fixed | plan:357 (U12), 382–383 (U15). Other M3 parts of #184 are missed: V6 |
| P8 | Fixed | plan:120–126, 142, 149, 277–278; row 34. Contains a false statement: V4 |
| P9 | Fixed | US-C7, 2 at plan:149; US-C4 1, 11–13 and US-C8 6 at :155; US-C11, 5 at :146; US-C15, 10 at :148; US-C18 1–4 at :159–160; question 8 at :127–133. Residue: V17 |
| P10 | Fixed | plan:148, 280–281, 327–329, 256–258; matches `adr/0012:52–53, 66–68` |
| P11 | Fixed | O6, O7, `data-request`, hostile fake: plan:148, 330–332. Turn cap :151, 354–355. Switch :382. Send-time check :265–266. Import test, `health()`: :143, 285–289, 370. Budget :142, 279–280, 390–391. Lease :146 |
| P12 | Fixed | plan:86–96; row 31; #163 at :96, 399 |
| P13 | Fixed | plan:97–101; rows 1, 18, 2, 3, 7, 8, 21, 13 say what the plan says of them. STATUS:413–414. STATUS "Next" still omits some: V13 |
| P14 | Partly | plan:316–320 names ten of the twelve rows as M3 and corrects "holding message". "The three booking texts are M5's": section 7 has four booking texts in two rows (confirmed, moved, cancelled; and "Booking unchanged", `guardrail-policy.md:326–327`). "Booking unchanged" is not placed: V8 |
| P15 | Fixed | `git diff main HEAD -- docs/reviews/2026-11-21-m3-preparation-check.md` is empty; its rows 15, 14, 18, 2, 7, 19, 5, 1, 4, 22, 25, 28, 12, 21 match the page; decisions:8–10 says a row keeps its number |
| P16 | Fixed | plan:141, 266–269 |
| P17 | Partly, as the response says | U0 and U1 split (:139–140); leftovers divided by item (:247–250); U10 two pull requests (:341–342); U2 named (:411). U0 still holds 30 issues |
| P18 | Fixed | plan:25 |
| P19 | Fixed, with residue | #132, #189, #99 under U15 (:379–381); #242 U16; #210 U9; #230 to M5 (:244); #284, #278 U2 (:269–270); #219, #220 under U0 to be moved (:241–242). #278 and #219/#220: V21 |
| P20 | Fixed | plan:221–222; design notes list :215–216 |
| P21 | Partly | U14 wording fixed (:153, 371–373). U17's done-when (:156) names terms, prices and model list; `adr/0010:147–152` says NFR-V6 is unmet "until the terms and the licence are read". The licence is not in the done-when (scope text :397 covers it only as "the reading NFR-V6 waits on") |
| P22 | Fixed | decisions:26–29; rows 29, 30 no longer carry the two faults |
| P23 | Fixed | log scan in U18 (:157, 404); plan:230–231 replaces the rule |
| P24 | Partly | plan:76–79 says what U10 and U15 do on a no. plan:418–419 says U12 and U16 change "as that question says"; the question says nothing of either. See V1 |
| P25 | Fixed | plan:362–364 |
| P26 | Fixed | plan:23 "Where it is asked" |
| P27 | As the response says | plan:225; STATUS:412 |
| P28 | Fixed | STATUS:5 |
| P29 | Fixed | plan:39–40, 308–309 (test tool in test files only); :83–84, 340 (writer and guard in U10); :153 (U14 logs) |

## Check 2

`sed -n '50,$p'` of the review file against `/tmp/m3review-report.md`: `diff` and `cmp` report no difference (248 lines).

## New findings

| ID | Sev | Where | What | Evidence | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| V1 | Medium | plan:76–79, 151, 155, 418–419; row 29 | **The "no" branch of question 1 is incomplete and contradicts U12.** "The assistant goes on answering in each of those cases" covers the `limit` row, but U12's done-when says the turn cap and token budget "stop a session" and NFR-C2 says the cap "is enforced". The risk list says a no changes U12 and U16 "as that question says"; the question names only U10 and U15. U16 needs U11 with no "if it is built" (U10, U12, U15 have it). Nothing says what the person button on the fallback and unsupported-type reply does on a no | `nfr.md:85`; plan:66, 151, 155 | State per unit what a no does: U12 (stop without a handover, and what the customer is told), U16 (E8/E17 outcomes without a handover), the person button. Mark U16's need as conditional |
| V2 | Medium | plan:150 (U11) | **U11's done-when and two cited criteria cannot be shown when U11 is finished.** "For any reason in question 1's table" includes `emergency` and `unsupported-content` (detected in U10, which needs U11), `limit` (U12) and `provider-failure` (U15). US-C12, 4 depends on U10's count; US-C15, 4 on U15 | plan:61–67 against the Needs column :149–154 | U11's done-when: the transition, tested with the triggers that exist then (button, flags, two fallbacks). Cite US-C12, 4 under U10 and the `limit` and `provider-failure` handovers under U12 and U15 |
| V3 | Medium | plan:70–74, 150, 346–350 | **What happens to an M3 handover after its session ends is not said.** "Every later transition stays in M4" includes `waiting → detached` on session end. U11's done-when says "never answered by the assistant again"; US-C6, 8 says the assistant answers the customer's next message after the session ends. A second trigger in a later session meets an open handover: H1 and the data model's unique index forbid a second, and the "add the reason, re-attach" transition is M4's. No one can close a handover in M3. #179 (session end effects) is under U2, built before U11 | `user-stories.md:139–140`; `state-machines.md:73–75, 188`; `data-model.md:292–296` | Decide in question 1 and row 29: build `waiting → detached` and "new trigger re-attaches" in M3, or say handed-over contacts stay silent for good in M3. Name it in U11's design note |
| V4 | Low | plan:121–123; row 34 | **"A default language ... that no table holds" is false.** `tenants.default_language` exists | `packages/db/migrations/0001_core_tables.up.sql:22` | Drop "default language" from the missing settings in the plan and the row |
| V5 | Low | plan:244–245, 101 | **#227 is not "settled in M2".** Row 13 settles the role's access. The body also asks for an emergency rollback path for prompts and a statement that operator-held degraded mode hands every active session over after 15 minutes. U15 builds that switch and that handover in M3 | #227 body in `/tmp/m3.jsonl` | Close only the role part; put the mass-handover effect under U15 and the rollback path where it belongs |
| V6 | Low | plan:357, 382–383 | **Only part (c) of #184 is taken; parts (i), (j) and (l) are also M3's.** (i) which tenants were emailed when degraded mode began (US-C15, 8: U15/U10); (j) daily token budget and usage (U12); (l) where fixed texts per language are stored (U8). Nothing says who moves the remaining parts | #184 body | Add (i), (j), (l) to U15, U12, U8; have U0 move the rest |
| V7 | Low | plan:243, 149, 337 | **No M3 message carries a stop button.** #222 is moved whole to M5; its second half ("define where the stop button appears") is M3's. Policy section 7 puts the person button on two texts and the opt-in button on one; none carries a stop button. U5 and U10 build a button nothing sends | #222 body; `guardrail-policy.md:319–331` | Keep that half of #222 under U8 or U10 and decide which text carries the stop button, or say the stop button waits for M5's templates and US-C7, 1's button clause with it |
| V8 | Low | plan:319 | "The three booking texts" does not match section 7 (four texts, two rows). "Booking unchanged" is sent at step 10 in a handed-over session, the step U11 builds | `guardrail-policy.md:326–327`; `state-machines.md:38` | Name "Booking unchanged" as M5's (the pack's button) |
| V9 | Low | plan:355–356 | "The tenant's limits on model calls and new contacts, whose numbers are the maintainer's (OQ-7)": OQ-7 is the daily token budget and cost per session, and its owner is the agent, from measured cost. #157's numbers are a different thing | `open-questions.md:21`; #157 body | Correct the owner and the reference. Say that the budget's number comes from U17's traces, after U12 |
| V10 | Low | plan:3–5, 10–12 | Status line reads as if this plan was checked; the second agent checked the first draft. "In the order they depend on each other" is false of the numbering: U10 needs U11 | review file:5–8; plan:149 | "First draft checked by ..."; renumber or say the numbers are not the order |
| V11 | Low | plan:19–21, 153, 203–204; row 6 | U14's done-when includes the call against the real service, which waits on credentials, and U15, U17 and U18 need U14. Read literally, provider failure waits on credentials, against "everything else can be finished first". "U13 and U14 are off the main line" is not true of U14 (it feeds U15 and U17). Row 6 says credentials are not asked for until the harness exists; U14 comes before U16 | plan:153–157; decisions:24 | Take the real call out of U14's done-when and make it a step of U17, or say U14 is done without it |
| V12 | Low | plan:59–68, 327–333, 335–340 | **Flag handling (O2) has no clear owner.** U9's scope names only the `data-request` flag. The table gives the model's emergency flag to "U10, U11" though it is read after the model. No scope text names the handler of the "are you a person?" flag (US-C5, 3) or of the wish to receive messages again (US-C7, 7; U10's scope lists only the free-text stop) | `guardrail-policy.md:98`; `adr/0007:133–137` (seven flags) | List the seven flags once, each with its unit |
| V13 | Low | STATUS:8–9, 409–411, 466 | "Next" asks for rows 1 to 6 and 29 to 35. The plan's question 4 says units build on rows 7, 8, 18 and 21 too and that a no is cheaper before. "M1 and M2 met theirs": the M1 retro says so; the M2 retro says one criterion is shown by a CI job only and one is "for the reader to check", and no document states M2 met all three. The tag exists | plan:97–101; `retros/m2-walking-skeleton.md:24–29` | Add the four rows to "Next"; cite what shows M2's exit |
| V14 | Low | decisions rows 29, 30, 34 | Row 34's proposal cell is "The test only", while the plan's proposal also stores the settings (plan:123). Row 29 names two criteria coming into M3; the proposal builds the triggers of US-C6, 1 to 4 and 10 and the texts of 5 and 6, which is most of an M4 story, and neither row nor plan says so. Row 30's "If no" does not say that US-C15, 6 and 8, claimed by U15, then slip to M4. No contradiction found between rows 29 to 35 and questions 1 to 3 and 5 to 8 otherwise | decisions:35–36, 40; `user-stories.md:134–141` | Reword the three cells |
| V15 | Low | plan:145, 155 | US-C10 is claimed whole by U6: criterion 1's "guardrail results" exist only after U9, and criterion 3's log scan is U18's. The model-behaviour criteria under U16 can only be shown at U17, since U16 runs the fake client | `user-stories.md:190–192`; plan:155–157 | Cite US-C10, 3 under U18; say U16 writes the cases and U17 shows the criteria |
| V16 | Note | plan:100, 105–106, 124–125, 51–52 | Words in quotation marks that are not the source's: "in M3 and M5" (ADR: "(M3 and M5)"); "a tool that was not offered is not run" (no source; ADR 0007 has "a tool call it was not offered"); "every required setting is present and a channel is connected" (machine 9: "the channel credentials are verified"). Step 4a reads verified credentials, not "answering"; M3 builds no credential check. US-C15, 5 is cited for "provider failure after 15 minutes" and is the other-reason rule; step 4a is cited for the flag and covers the phrase only | `adr/0012:235`; `state-machines.md:32, 440`; `user-stories.md:266` | Quote exactly or drop the marks |
| V17 | Note | plan:149, 162–201 | The Needs column mixes direct and transitive needs: U10 uses U5's buttons and U8's texts and lists neither; U7 lists U2 and U4 beside U6, which already needs both. The diagram draws the three conditional U11 edges as plain ones. No dependency is missing once transitive ones are counted (U8 needs U5: listed; U6 needs U2: listed; U12 reaches U2 through U8 and U7; U16 needs neither U12 nor U14) | plan:145–155 | State the convention; dash the conditional edges |
| V18 | Note | plan:269–270, 241–242, 341, 426–427 | #278 is under U2 only; its model flags are U4's and its settings U3's. #219 and #220 are "moved" with no destination, unlike the other seven. U10's "four mechanisms" lists six. ADR 0003's "look again at the start of M3" (query builder, decisions row 16) is not in the plan. No unit names the dependency check `AGENTS.md` requires for the Bedrock library or a language-identification library | #278 body; `adr/0003:275`; `AGENTS.md:132–133` | Fix in passing |
| V19 | Note | decisions:10 | "At the end of M2 A second agent": the edit left a capital mid-sentence | `git diff main` | Reword |

No proposal conflicts with a hard limit of `AGENTS.md`. The departures from it (section 6's eval rule, the meaning of the M3 exit criterion, handover in M3, #163 from M6) are each put to the maintainer (rows 31, 32, 29; plan:96).

### Check 3, items with nothing wrong

- (a) 19 units; "nineteen", "U0 to U18", "eight questions", "seven are rows 29 to 35", "nearly twice M2's ten" (ten units, merged 2026-11-17 to 2026-11-21 by `git log --merges`) are right.
- (b) Table and diagram: identical edge sets, no cycle. "U2, U3 and U5 do not depend on each other": true.
- (c) Every criterion number in the column and in the questions says what the plan implies, apart from V16. With the later table and question 8, no criterion of an M3 story is without an owner.
- (d) Steps 4, 4a, 5, 8, 9, 10, 11, 12, 13, 15; policy sections 4, 6, 7, 9, 10; state machines sections 3, 7, 8 and machines 6, 9; eval plan sections 7, 8 and the sizes note; NFR-P5, V7, C2, R7, O4, V6, A1 to A4; ADR 0005, 0006, 0010, 0012 ("What the core owns", claim kinds); rows 1, 2, 3, 4, 6, 7, 8, 13, 18, 21: each says what the plan says.
- (e) Question 1's table covers all eleven rows of section 6 with the right triggers.
- (g) All 90 numbers are under a unit; #163 is the only number in the plan not in the file, and the plan says so. The eleven moved issues sit plausibly, apart from V6 and V18.
- (h) `git diff main` on the decisions page: the header paragraph and the inserted section only.
- (i) STATUS: "every one of the 90 issues named under a unit" is true (ten of them only to be moved out); the list of what the check found matches P1, P8, P3, P6, P2.

## Check 4: in the reviewer's report, not acted on and not mentioned in the response

- Q3: steps 6 and 7 are left out of M3 and the plan still does not say so; step 14 is still cited by no unit (U15 builds it).
- Q1: US-C10, 1's "guardrail results" arriving after the trace unit (V15).
- Q11: the partial `handovers` table and the logging email writer as work M4 may undo are not in "What could make this plan wrong" (the tool loop and the baseline are).
- Q1, US-C17 row: the tenant limits of #157 are not a criterion of any story; still in U12 with no question raised.

## What I did not check

- Anything on GitHub: issue states and milestones, that 92 issues moved and none closed, the M4 to M6 counts, whether #163 is still in M6.
- Whether US-C18, 1 to 4 are built and tested in M2 beyond seeing status handling in `packages/db/src/inbound.ts`; the traceability row is empty.
- Issue bodies: read in full for #227, #184, #278, #290; the first 900 characters for 18 others; titles only for the rest.
- Guardrail policy lines 121–211 (O3 in detail) and 253–300 (the topic list); state machines sections 4 and 5; the threat model, `api.md`, `compliance.md`; ADR 0013 beyond its decision table; the data model beyond `tenants`, `sessions`, `handovers`, `services`, `policies`.
- STATUS outside the heading, the 2026-11-22 entry, "Next" and "Blocked on the maintainer".
- Code, beyond migration 0001's `tenants` table and a grep of the channel packages. No test or program was run.
- What Meta or AWS say today: no network.
