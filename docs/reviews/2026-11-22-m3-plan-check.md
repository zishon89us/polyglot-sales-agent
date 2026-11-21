# Check of the M3 plan, 2026-11-22

The report of a second agent that did not write the plan, unedited, and
below it what the author did about each finding. It reviewed the first
draft, commit `2f84cab`: unit numbers, line numbers and decisions rows in
the report are that draft's. The plan was then rewritten and its units
renumbered (U0 to U18); the decisions page went back to the numbering on
`main` and the new rows became 29 to 35.

## Author's response

| Finding | Done |
| --- | --- |
| P1 buttons and captions unowned | Accepted. A unit of its own (U5), raised as question 6 and row 33 |
| P2 dataset sizes cannot be met | Accepted. Question 5 and row 32; U16's done-when no longer promises the planned minimums |
| P3 seventeen, not sixteen | Accepted. The count was wrong in the plan, STATUS and the commit title. After the rewrite there are nineteen, counted by script from the table. The first commit's title stays wrong in the history |
| P4 four criteria delivered later, not two | Accepted; question 1 reworded |
| P5 person button against the stories; triggers unnamed | Accepted. Question 1 lists every trigger of the policy's section 6, and proposes that US-C11, 4 and US-C12, 4 come into M3 with a yes. That changes the stories file, so it is the maintainer's (row 29) |
| P6 six missing dependencies | Accepted, all six; the order of units changed (handover record before the checks that use it; the real-model run moved to U17). Table and diagram compared by script: no difference |
| P7 #184 part (c) | Accepted; under U12 and U15 |
| P8 tenant answering | Accepted. Question 7 and row 34; the settings and the test in U3, step 8 in U10 |
| P9 criteria column | Accepted. Column redone; the eval-only criteria are under U16; question 8 and row 35 for the parts that need M5. US-C18, 1 to 4: U13 enters their tests in the traceability file and finds any missing |
| P10 pack's claim kinds | Accepted. U9 claims the core's kinds and a registration point; the calendar left U3; U1's ADR covers steps 10 and 13 |
| P11 commitments with no unit | Accepted. O6, O7, `data-request`, hostile-output fake: U9. Turn cap: U12. Operator's switch: U15. Send-time check: U2. Import boundary and `health()`: U4, U14. Size budget: U3, and a tenant at the budget in U16. Lease renewal: U7 |
| P12 AGENTS section 6 | Accepted. Question 3 and row 31 ask for the exception; #163 is taken by U17 |
| P13 other rows built on | Accepted. Question 4 names rows per unit; STATUS no longer says U0 needs no answer |
| P14 fixed texts | Accepted. U8 lists the policy's rows, each as M3 or later; "holding message" was the wrong text |
| P15 renumbering broke references | Accepted, differently: the renumbering was undone, so the earlier review's references are right again, and the page says a row keeps its number |
| P16 migration for sessions | Accepted; in U2's scope and done-when |
| P17 unit sizes | Partly. U0 split in two (findings; the ADR). U0 divides #288, #290 and #295 by item. U10 is said to be two pull requests. U2 not split; named as likely to |
| P18 languages needed by more units | Accepted |
| P19 misfiled issues | Accepted for #132, #189, #99, #242, #210, #230, #284, #278, #219, #220. #209 stays under U9 for its part |
| P20 README table; design notes | Accepted |
| P21 NFR-V6; "recorded" | Accepted; U17's done-when, U14's wording |
| P22 decisions rows' wording | Accepted; rows rewritten, and the page says which rows the earlier check did not see |
| P23 log scan; "listed once" | Accepted |
| P24 what a no to question 1 does | Accepted; in question 1 |
| P25 lost status | Accepted; U13 |
| P26 column heading | Accepted |
| P27 issues per unit | At merge, as the plan now says |
| P28 STATUS heading | Fixed |
| P29 guards for the test tool and the notice writer; SDK logging | Accepted: the test tool exists only in test files; the writer and its guard are U10's; U14 checks its logs |

Not done: the NFRs whose check falls in M3 are not each tied to a unit;
U0 does that. Nothing here was checked against GitHub by the reviewer, and
the issue lists were made from titles and about fifteen issue texts.

## The report

# Review of `docs/plans/m3-ai-core.md`, decisions rows 7–9, and the STATUS entry of 2026-11-22

Reviewed at `2f84cab` (branch `docs/m3-plan`) in a copy at `/tmp/m3review`. Nothing was written to the original repository. No network, no tests run.

## Verdict

The plan is not ready to merge as written. Its skeleton is sound: all 90 issues are named, the Needs column matches the diagram, there is no cycle, and the numbers taken from the stories are right. But it has two holes that change the size of M3, and several statements that are false. (1) Nothing in the plan owns buttons or captions in the channel: the channel interface today receives only text or "unsupported" and sends only text, while US-C7, US-C12, steps 5 and 11 and the fixed-text table need stop, start, opt-in and person buttons and caption reading. (2) U14 promises the dataset "at its planned minimum sizes", which the eval plan says the M3 dataset will not have, and a third of those sizes grade things M3 does not build (tools, bookings, inquiry labels); so the plan never says what "pass the eval thresholds" means for a model with no tools. Beyond these: the unit count is 17, not sixteen; the later-delivered table has four entries, not two; six dependencies are missing in fact; step 8 (tenant answering) and several guardrail checks have no owner; #184 is sent to M4 although its part (c) is the storage U10 and U13 need; U6 claims two claim kinds ADR 0012 gives to the booking pack; and the plan raises no question about `AGENTS.md` section 6 ("no change to AI behaviour merges without an eval run") although its own question 3 suspends it.

## Findings

| ID | Sev | Where | What is wrong | Evidence | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| P1 | High | plan:84, 223–229, 231–236 (U8, U9); no unit | **Buttons and captions have no owner.** M3 needs: stop/start button in (step 5, US-C7 c1, c5), opt-in question *with a button* out (US-C7 c7), person button in (step 11, U9) and out on the fallback and unsupported-type reply (guardrail policy §7 "carries the person button"), and a caption read as text (US-C12 c2, claimed by U8). | `packages/channel/src/index.ts:23–25`: `InboundContent` is `text` or `unsupported` only; `:119` the only send is `sendText`; header comment lines 6–8 lists what is still to come and has no buttons. No `caption`, `button` or `interactive` anywhere in `packages/channel-whatsapp/src`, `packages/channel-mock/src`, or `apps/mock-whatsapp/src` (only HTML). `messages.kind` allows `button` in the data model only. | Add a unit before U8/U9 (channel interface, WhatsApp adapter, both stand-ins, dated fixtures, Meta's page read and dated per AGENTS "Verify before you rely on memory"), or state which button criteria move later and add them to the later-delivered table. |
| P2 | High | plan:90, 268–270 | **U14's "planned minimum sizes" contradicts the eval plan and cannot be met in M3.** | `ai/eval-plan.md:181–182`: "These are planned minimums for v1.0, not what exists. The first dataset, in M3, will be smaller". The 1,260 minimum includes E14 inquiry sessions (180; US-C19, M5) and core cases graded on E6, E7, E16 (tools, bookings; M5). NFR-A1/US-C8 c6 need tool-misuse red-team cases at 100% with no tool in M3 (plan:35). | Say which dimensions and parts the M3 dataset and baseline cover, with sizes; say the baseline is re-measured in M5 when tools and the pack's prompt fragment arrive; say what the exit criterion means meanwhile. This is a fifth question (see Q7). |
| P3 | Medium | plan:8, 287; STATUS:396; commit title | **"Sixteen units" is wrong: U0..U16 is 17.** | Units table, plan:76–92, has 17 rows. | "Seventeen", or "sixteen and a documents unit", in all four places. |
| P4 | Medium | plan:48–49 | **"only two criteria are listed as delivered later (US-C11, 4; US-C12, 4)" is false.** Four are listed. | `user-stories.md:545–548`: also US-C7 c3 and US-C18 c5, both to M5. | Correct; the argument survives if worded "only two of the four concern handover". |
| P5 | Medium | plan:85, 235 against 45–54 | **U9 builds the person button (step 11), which is the thing the stories put in M4.** If U9 hands over on a request, US-C11 c4 and US-C12 c4 become deliverable in M3 and the later-delivered table is wrong; if it does not, citing step 11 is wrong. The plan also does not say which handover triggers U9 owns. | `user-stories.md:550`: "Acting on that request is US-C6, in M4". Guardrail policy §6 lists eleven triggers; the plan names three (sensitive topic, provider failure, emergency phrase). Unowned: model emergency flag, free-text person flag, `data-request`, `repeated-failure` (count 2), `limit` (turn cap, token budget), `unsupported-content` (count 3). | List each trigger of §6 as M3 (U9) or M4, and change the later-delivered table to match. Put that list in question 1 and row 7. |
| P6 | Medium | plan:74–124 | **Six dependencies missing in fact** (table and diagram agree with each other, but not with the work). | (a) U4→U1: a trace is "linked to the session" (US-C10 c1; `ai_traces.session_id`), sessions are U1. (b) U6→U7: the fallback is a fixed text of U7 and may be a session's first message, needing the disclosure (US-C5 c1; O8). (c) U10→U7: the rate notice is a fixed text of U7. (d) U8→U9: step 4a "apply the emergency event of machine 2" is an urgent handover plus an email; U8 needs only U1, U7. (e) U13→U6: U13 claims all of US-C15, and c10 (schema mismatch) is "a failed output check" counted by U6's counter. (f) U14→U12: its done-when says "against a real model"; and →U9 if E17/E8 outcomes are to run "the real ... state machines" (`eval-plan.md:343–345`). | Add the edges, or move the criterion to the unit that can show it (c10 to U6; the real-model run to U15). |
| P7 | Medium | plan:161–164 | **#184 is called "stored data for sign-in, M4" and "not M3's". Its part (c) is M3's.** | Body in `/tmp/m3.jsonl`: "(c) per-contact rate counter and degraded-mode trigger (the awaiting-retry mark is cleared, so '5 within 2 minutes' cannot be derived)". That is U10's and U13's storage. The title is cut off after "(a)"; the triage page says it names US-C15. | List #184 under U10 and U13 for (c); move the rest. |
| P8 | Medium | no unit | **Step 8 (tenant answering) and machine 9 have no owner, and M3 criteria read it.** | US-C7 c6 (claimed by U8) and step 5: confirmation "only if the tenant is answering"; step 4a: "If the tenant has verified channel credentials". #290: steps 4a to 15 not built. `tenants` (migration 0001:16–23) has no settings, no notification address, no support contact, no business hours; the handover text "outside business hours" and the tenant notices need them. | Decide and state: a stub predicate in M3 (always answering in development) with the real state in M4, or build it. Raise it as a question. |
| P9 | Medium | plan:77–92 "Stories and criteria" | **Criteria unclaimed, mis-numbered or under the wrong unit.** | Unclaimed in the column: US-C7 c2 (free-text stop; U8's scope text at 226–227 does cover it, the row says "1 and 4 to 7"); US-C4 c11 and c13, US-C8 c6 (evals: U14/U15 cite NFRs, not the criteria); US-C18 c1–c4 (plan:246 says M2 built them, but `traceability.md:24` is empty for US-C18, so nothing records a test). Wrong unit: US-C4 c1 and c12 are model behaviour, claimed by U2 (storage); US-C11 c5 needs the model and the unsupported-type wording, claimed by U1; US-C15 c10 under U13 (see P6e). Not deliverable in M3 and not in the later table: US-C15 c9 (template reminder), US-C5 c1 "including a template", US-C4 c4 and the booking clause of c10, US-C8 c4 "tool result" (only a test tool). | Fix the column; add the M5 parts to "Criteria delivered later". Full table under Q1. |
| P10 | Medium | plan:82, 181–185 | **U6 claims US-C4 c4 and c14, whose claim kinds ADR 0012 gives to the booking pack**; U2 puts "the calendar" in the core's assembly. Built in the core in M3, they trip the boundary test or get moved in M5. | `adr/0012:54` core: "claim kinds for prices, opening hours, service details and policies"; `:66–68` pack: "the claim kinds for slot and booking times and for calendar dates". ADR 0012 amendment: hooks "due (M3 and M5)". Steps 10 and 13 (U9, U8) name Reschedule and Cancel buttons. Decisions row 24's "If no" is "The hooks are built first, in M3". | U6 claims c3, c5–c10, c15 and a registration point for pack claim kinds; c4, c14 go to M5 or wait on U0's ADR. Say in U8/U9 how steps 10 and 13 avoid naming the buttons. |
| P11 | Medium | plan:208–213, 260–264 | **Guardrail and ADR commitments for M3 with no unit.** | Policy §4: O6 (canary string, 12-word repeat), O7 (empty or over-long), O2's `data-request` flag: not in U6's list. §6 `limit`: turn cap (glossary: 30; NFR-C2 "is enforced"). §10: `ops service degraded on` (machine 8; decisions row 18 says not built). State machines §7 send-time checks by class (reply window; #290 "not built") which O8 applies. ADR 0007 Confirmation: "a fake that returns hostile output (another tenant's identifier, a tool call it was not offered, a price with no claim)". ADR 0005 Confirmation: import-boundary test for a provider SDK. ADR 0006: "A size budget is set in M3 from measured token counts" and "an eval set includes a tenant at the size budget". Architecture "Processing one turn" step 1: lease renewed before each model attempt (#290). `health()` (ADR 0005 amendment) is in neither U3 nor U12. | Add each to a unit's scope or name the milestone it goes to. |
| P12 | Medium | plan:60–66; decisions row 9 | **Question 3 does not say it suspends a rule of `AGENTS.md`.** U5–U8 change AI behaviour and merge before any eval can run. | `AGENTS.md:319–320`: "No change to AI behaviour merges without an eval run attached to the pull request." `eval-plan.md:351–353` allows harness-only runs "until a provider is chosen" but does not lift the AGENTS rule. Also U15 relies on #163 (fork secrets), which the triage put in M6. | Put the exception in the question and the row, for the maintainer to accept; say what replaces the eval run until U15. |
| P13 | Medium | plan:67–70; STATUS:404–407 | **Question 4 cites rows 1–3 only; rows 21, 24, 10 and 11 are also built on.** STATUS says U0 "needs no answer". | Row 21 (`handled_at`): "If no: The columns change before M3 builds on them"; U1 removes it. Row 24: "If no: The hooks are built first, in M3". Rows 10, 11: the send policy U11 changes. U0 closes #227 only "if the maintainer says yes to row 16" (plan:166–167). | Name the rows per unit; reword STATUS. |
| P14 | Medium | plan:215–221, 234 | **U7's "Every text code sends" omits three texts, and "holding message" is the wrong text.** | Policy §7 has: handover inside hours, handover outside hours, opt-in question, automated-assistant answer (US-C5 c3, claimed by U7). None is in U7's list. The holding message is the notice for an *overdue* handover (US-C14 c6, M4; glossary:50), not "a person will reply". | List the twelve rows of §7, each as M3 or later. |
| P15 | Low | `reviews/2026-11-21-m3-preparation-check.md:41–49` | **The renumbering broke ten row references.** | Author's response, written for the page on `main`: rows 15, 14, 18, 7, 19, 22, 25, 28, 12, 21 are now 18, 17, 21, 10, 22, 25, 28, 31, 15, 24. Detail under Q9. | A dated note under the response; do not rewrite the record. Better: stop renumbering (append, or number by section). |
| P16 | Medium | plan:171–177 | **No migration plan for sessions.** | `messages` has no `session_id` today (migration 0001:93–115); existing rows need a session or a null; dropping `handled_at` needs a tested down step (NFR-O4) and a rule for messages unanswered at the moment of migration (#290 S3 records the same hazard for 0004). | State it in U1's scope and done-when. |
| P17 | Medium | plan:151–167, 175–177, 255 | **Units too large or loosely bounded.** U0: 32 issues, an ADR on "the central bet", and every other unit waits on it. U1: sessions, reply window, batching, discard, removal of `handled_at`, plus #288 and #290 whole (these hold per-tenant credentials NFR-S5, structured logs NFR-O2, contact merging, operator alerts, 30-day deletion, send-time checks). U12 takes #295 whole (image scan, deployment definition). U8: ten issues, four mechanisms. The plan names only U6 and U14 as likely to split. | Split U0 (findings / ADR) and U8; in U1 and U12 list the items of the leftover issues that are taken, and move the rest in U0. |
| P18 | Low | plan:23 | **The languages are needed by more than U14 and U7's wording.** | Keyword lists "one per supported language, written in M3" (policy §8, U8); emergency phrase lists per supported language (U8); US-C3 c4 needs the supported set at run time (U5). | Add U5 and U8 to "Needed by". |
| P19 | Low | plan:153–272 | **Issues that look misfiled** (list under Q6b): #132, #189, #242, #210, #230, #284, #99, #278, #219, #220. | Titles, and bodies where the title is cut off. | Move, or say why. |
| P20 | Low | plan:131–144, 282–283 | **One retro promise is not carried: the README's state table "is updated in the pull request that changes the state".** The plan mentions the README only in U16. Also, "rule about people or money" arguably covers U2 (what of the contact is sent), U7 (what customers are told), U11 and U15 (spending cap), which get no design note. | `retros/m2-walking-skeleton.md`, "What changes in M3", row 5. | Add the line; reconsider the list of units with a design note. |
| P21 | Low | plan:249–258, 274–278 | **NFR-V6's open part has no owner; "recorded, synthetic answers" is unclear.** | ADR 0010 amendment: "Until the terms and the licence are read and linked here, NFR-V6 is not met"; also prices and the model list "not read". Without credentials nothing can be recorded from Bedrock, so U12's fixtures are written from documentation by the agent. | Put the reading (with dates) in U15's done-when; call U12's fixtures hand-written from a dated page until a real recording exists. |
| P22 | Low | decisions:8–11, rows 7, 8 | Header reads as if the page now shown was checked by the second agent; rows 7–9 were not. Row 7 "Three M3 criteria": two are criteria (US-C8 c5, US-C15 c4), the third is step 4a, and US-C15 c5 also depends on it. Row 8 "If no: ... send no notice until M4" is also the result of a yes (a log line, no email). | Text of the rows. | Reword. |
| P23 | Low | plan:80, 149, 185, 212 | U4's done-when scans "an end-to-end run's logs" before any end-to-end run with a model exists (U16). "An issue under two units is listed where it is first needed" is broken by #13 (U2 and U6). | Plan text. | Move the scan to U16 (or keep both); reword the rule. |
| P24 | Low | plan:292–293 | **A "no" to question 1 does more than "remove U9".** U13 then has no path to U7 (fallback text) in the Needs column; steps 10 and 11, US-C15 c4 and c5, and the handover half of 4a lose their owner; U8's emergency text has nothing to "replace". | Needs column; step 4a. | Say what each unit does on a no. |
| P25 | Low | plan:244–247 | U11 waits for `delivered`, but a status that arrives before the identifier is recorded "matches no message and is lost" (#290, known limits). Every such message then waits the full 10 s. | #290 body. | Name it in U11. |
| P26 | Note | plan:25 | The third cell of the "On `decisions-needed.md`" column points at the eval plan; acceptance of the baseline is not on the decisions page. | Decisions page has no such row. | Add a row or rename the column. |
| P27 | Note | plan:74 | Unlike the M2 plan, no unit has an issue; ADR 0013 says units are recorded "as issues". STATUS:406 says they are opened on merge. | `m2-walking-skeleton.md:20`. | Acceptable if done at merge. |
| P28 | Note | STATUS:5 | "## Current milestone: M1 Design" still heads the file. Not introduced by this commit. | STATUS:5. | Fix in passing. |
| P29 | Note | plan:36, 290–291 | The tool loop is built and tested against "a tool of the tests' own". Nothing says the production guard keeps a test tool or a logging email writer out; question 2's guard has no unit (U8 needs the notice writer before U13 exists). Bedrock SDK debug logging of request bodies is an NFR-V2 risk no unit tests. | Plan text; `apps/worker` guard covers neither yet (#295). | Name the unit that builds the notice writer and its guard; add a log-scan to U12. |

## Q1. Stories, criterion by criterion

"Later" = listed in `user-stories.md:545–548`.

| Story | Criterion | Unit claiming | Comment |
| --- | --- | --- | --- |
| US-C3 | 1–3 | U5 (whole story) | Model behaviour; shown only by evals (E1), U14/U15. Plan:206 says so for US-C8 but not here |
| | 4 | U5 | In done-when. Needs the supported list (P18) |
| US-C4 | 1, 12 | U2 | Wrong unit: needs the model (U5) and evals E4, E5 |
| | 2 | U6 | Schema is U3's |
| | 3, 5, 6, 7, 8, 9, 15 | U6 | OK |
| | 4 | U6 | Pack's claim kind (P10); no tool in M3 |
| | 10 | U6 | Booking clause is M5; not in later table |
| | 11, 13 | none | Evals; U14/U15 cite NFR-A2 and OQ-6 only |
| | 14 | U6 | Pack's claim kind (P10); #240, which limits it, is sent to M5 |
| US-C5 | 1 | U7 | "including a template" is M5; unsupported-type reply (U8), fallback (U6), rate notice (U10) all need it (P6) |
| | 2 | U7 | OK |
| | 3 | U7 | The fixed answer is missing from U7's list (P14) |
| US-C7 | 1 | U8 | Stop button: P1 |
| | 2 | none in the column | Covered in U8's scope text; column mis-numbered |
| | 3 | — | Later, M5 |
| | 4 | U8 | OK |
| | 5 | U8 | Opt-in button: P1 |
| | 6 | U8 | Needs "tenant not answering": P8 |
| | 7 | U8 | Sends a button: P1; fixed question missing from U7 |
| US-C8 | 1–4 | U5 | 1–3 are model behaviour; 4 "tool result" only with the test tool |
| | 5 | U9 | Conditional on question 1; flag handling sits in O2 (U6) |
| | 6 | none | Evals (NFR-A1 under U14/U15); tool-misuse needs tools (P2) |
| US-C10 | 1 | U4 | "linked to the session" needs U1; "guardrail results" arrive with U6 |
| | 2 | U4 | OK |
| | 3 | U4 | No model end-to-end run until U16 (P23) |
| US-C11 | 1, 2, 3 | U1 | OK (with the echo until U5) |
| | 4 | — | Later, M4; but see P5 |
| | 5 | U1 | Wrong unit: needs U5 and the unsupported-type text |
| US-C12 | 1 | U8 | "offers a person": person button, P1 |
| | 2 | U8 | Captions not parsed: P1 |
| | 3 | U8 | Type is already stored (M2); OK |
| | 4 | — | Later, M4; count is U8's |
| US-C15 | 1, 2, 3, 7 | U13 | OK |
| | 4, 5 | U9 and U13 | Conditional on question 1 |
| | 6, 8 | U13 | Emails: question 2. Health check needs `health()` in U3/U12 |
| | 9 | U13 (whole story) | M5; not in later table |
| | 10 | U13 | Belongs with U6 (P6e) |
| US-C17 | 1–4 | U10 | c3 person button: P1, P5. U10's "daily budget stops model calls and says so" is not a criterion of this story; US-C6 c4 says hand over with `limit`, and OQ-7 has not set the number |
| US-C18 | 1–4 | none | Said to be M2's; traceability row empty |
| | 5 | — | Later, M5 |
| | 6 | U11 | OK |

## Q2. The M3 row of `AGENTS.md` section 9

| Item | Unit |
| --- | --- |
| `LlmClient` | U3, U12 |
| Prompt loader | U3 (no unit says where the first prompt itself, policy §9, is written; presumably U5) |
| Retrieval over tenant data | U2 (ADR 0006: no retrieval step; the size budget is unowned, P11) |
| Language handling | U5 |
| Guardrails | U6, U7, U8, U2 (gaps: P11) |
| Provider-failure handling | U13 |
| Batching | U1 |
| Delivery tracking | U11 (and M2) |
| Tracing | U4 |
| Eval harness with first dataset | U14, U15 |

In the plan and not in the row: U0 (justified: findings and an ADR before code); U9, the handover record (M4's subject; raised as question 1); U10 (US-C17 is an M3 story; the tenant limits come from #157, not from a story); the pack interface ADR (justified by #200).

## Q3. Order of checks

| Step | Built by | Plan's citation |
| --- | --- | --- |
| 1, 2, 3 | M2 | — |
| 4 | Store: M2. Session and reply window: U1 | "4 and 12" for U1: right |
| 4a | U8 (phrase list, text). The handover and email it applies: unowned unless U9 and question 2 (P6d) | "4a, 5 and 13" for U8: right |
| 5 | U8 | right; buttons P1 |
| 6 | Left out (Confirm button, M5). Not said | — |
| 7 | Left out (follow-up, M4). Not said | — |
| 8 | **Unowned; M3 needs its predicate** (P8) | not cited |
| 9 | U10 | cited in scope text (plan:240), right |
| 10 | U9 | "10 and 11": right; Reschedule/Cancel part is the pack's |
| 11 | U9 | right as a number; conflicts with the stories (P5) |
| 12 | U1 | right |
| 13 | U8; third-batch handover later (M4) | right |
| 14 | U13 | not cited by number |
| 15 | U5 (model), U6 (output checks), "handover triggers": U9 in part (P5) | "15" for U5: right |

## Q4. Guardrails

ADR 0007 layers: 1 → M2, U1, U8, U9, U10, U13 (step 8 unowned); 2 → U2, U5; 3 → U5 with a test tool only (real tools M5); 4 → U3; 5 → U6, U7, U9 in part; 6 → U14, U15. The ADR's Confirmation (hostile-output fake; policy lists every rule with its test, which is #210, filed under U14) has no unit.

Policy sections: §2 I1–I6 → as layer 1, U3 (I3), U2 (I4, I6), U5 (I5). §3 A1, A2, A6 → U5, U3; A3–A5 M5. §4 → U6, but O2 (`data-request`), O6, O7 are not in its scope list and O8's send-time checks are unowned. §5 → M5. §6 → P5. §7 → U7, incomplete (P14). §8 → U7 (disclosure), U8 (opt-out). §9 (what the prompt must contain) → no unit named. §10 operator's degraded switch → unowned.

Citations: "guardrail policy, section 4" is "After the model" (output checks): right. "sections 7 and 8" are "Fixed texts" and "Disclosure and opt-out": right, though the opt-out half of §8 is U8's.

## Q5. Dependencies

Table against diagram, edge for edge: U0→U1, U0→U2, U0→U3, U3→U4, U1/U2/U3/U4→U5, U5→U6, U5→U7, U1/U7→U8, U1/U7→U9, U1→U10, U1→U11, U3→U12, U5/U9/U12→U13, U6/U8→U14, U12/U14→U15. All match. U16 "All" is drawn as U13, U15, U10, U11 → U16; every other unit reaches U16 through those. No cycle.

Missing in fact: the six of P6.

"U1, U2 and U3 do not depend on each other": true for the tables and the client. Weakly false for U2: it assembles "the batch" (plan:184), a thing U1 defines.

U14 "the same code as production": through U6 and U8 it has U1–U5 and U7. It does not have U9 (the handover a flag or a phrase leads to), U12 (the real model its done-when names), or U13 (not needed: the harness keeps provider errors out of scores). U10 is not needed unless a case exceeds 20 messages in 5 minutes of fixed time.

## Q6. Issues

(a) All 90 numbers in `/tmp/m3.jsonl` are in the plan, each in a scope list (lines 146–284). In the plan and not in the file: **#163** (plan:278; the triage page puts it in M6). No other.

Per unit: U0 32 (21 document findings, 3 for the ADR, 7 "not M3's", #227), U14 11, U8 10, U6 8, U1 7, U10 6, U7 3, U2 2 (#13 "in part"), U4 2, U5 2, U11 2, U12 2, U13 2, U3 1. #13 is in two lists.

(b) Looks misfiled (titles; body read where the title is cut off or says nothing):

| Issue | Listed | Expected | Why |
| --- | --- | --- | --- |
| #132 "P1 holds ... three interactions are undefined" | U0 | U13 (and U10) | P1 is the invariant of machine 8; body cites §8 and US-C15 c3, c4 |
| #189 "First-message versus latest-message clocks disagree" | U1 | U13 | Body: the 15-minute awaiting-retry clock, `awaiting_retry_since` |
| #242 "Part 1 matches digit runs ... no normalisation" | U6 | U14 | Body: `eval-plan.md` §5, the E2 grader |
| #210 "Every guardrail names how it is enforced and tested" | U14 | U6 (or U0) | Guardrail policy §4, not the eval plan; the plan calls the U14 list "findings ... of the eval plan" |
| #230 "session-end inquiry classification is a second model use" | U0 | M5 (US-C19), or U3 | Not a wording finding |
| #284 "contacts need the channel's own identifier" | U8 | U1 (also U8 for opt-out by number) | The plan's own question 4 ties it to U1 |
| #99 "C1.6 promises exactly one reply ..." | U1 | U13 / U5 | Body: how job retries nest with the 3 model attempts |
| #278 "shared lists U3 did not define" | U0 | U1, U3 | Model flags and session states are code lists those units need |
| #219, #220 (cross-tenant credential in `api`; signature before tenant) | U0 | M4 or M6 | Design and code, not wording; neither is M3's subject |
| #209 "stolen owner account ... payment link in a policy" | U6 | M4/M5 threat entry | U6 can settle only O5's part |
| #184 | "not M3's" | U10, U13 for part (c) | P7 |

Plausible and not listed here: the rest.

(c) Titles against "not M3's": #80 (handover reason `staff`) yes, M4. #82 (handover email inside the throttle window) yes, M4. #85 (failed reply shown to staff) yes, M4 with an M5 part. #224 (inviting a user) yes, M4. #222 (forged button naming a booking) yes, M5; note that the stop, opt-in and person buttons of M3 need the same check of whose button it is. #240 ("a booking tool ran") yes, M5, but it limits US-C4 c14, which U6 claims. **#184: no** (P7). #227: the title matches row 16, and the preparation check found no grant to the application role in migration 0005; "settled" is supported.

## Q7. The four questions

1. **Handover.** US-C8 c5 says "handed over with reason `sensitive-topic`": right. US-C15 c4: right. Step 4a: right. "Only two criteria are listed as delivered later": wrong, four (P4). Conflicts: `user-stories.md:550` (P5); state machines §2 says H1 and H3 "must be a test in milestone M4", which a record built in M3 brings forward, to be said. In M3 the customer is told "a person will reply" where no person can; harmless on the stand-in, worth a sentence.
2. **Email.** US-C15 c6 and c8: right (c6 "one email ... to each tenant", c8 "one recovery email"). 4a: right. "No ADR (#200)": the title lists "email sending". Consistent with `architecture.md:97` ("email is written to a log") and with the triage note on #165. No conflict found. Gap: the tenant's notification address does not exist yet (P8), and the guard has no unit (P29).
3. **Evals on pull requests.** Matches `eval-plan.md` §8. Respects the stop-and-ask rule on keys and money. Conflict with `AGENTS.md:319–320` not raised (P12).
4. **Rows 1–3.** The rows say what the plan says. Incomplete (P13).

Questions the plan should have raised: (5) what the M3 dataset, baseline and exit criterion cover with no tools (P2); (6) buttons and captions: build in M3 or move the criteria (P1); (7) the tenant-answering state (P8); (8) the M5-dependent parts of M3 criteria to add to the later-delivered table (P9); (9) pack-owned claim kinds and the Reschedule/Cancel steps against ADR 0012 and row 24 (P10); (10) the suspended eval rule (P12).

No proposal breaks a non-goal or a hard limit: no real number, no real customer text to the model (plan:37–38), no key or spend without the maintainer.

## Q8. Numbers and dates

| Claim | Check | Result |
| --- | --- | --- |
| "sixteen units" (plan:8, 287; STATUS:396) | U0..U16 | **Wrong: 17** |
| "M2's ten" | `m2-walking-skeleton.md` U1–U10 | Right |
| "five days, 2026-11-17 to 2026-11-21" | `git log --merges`: #274 on 11-17, #296 on 11-21 | Right |
| "with a review round each" | Review files exist for U1–U9; U10's in commits `5f2ee52`, `6552538` | Right as far as files show; three were merged before the review ended (retro) |
| Plan dated 2026-11-22; "#297 merged" | `02e0c7b`, 2026-11-22 | Right |
| "92 issues"; "90 / 44 / 49 / 8" | Triage page: 37+28+20+7 = 92; 53+37, 16+28, 29+20, 1+7 | Right against the page; `/tmp/m3.jsonl` has 90. M4–M6 on GitHub not checked |
| "each checked first to be open ...; none was closed" | — | Not checkable offline |
| "every one of the 90 issues named under the unit" | Script over the plan | Right (7 of them only to be moved out) |
| "four questions; three are new rows" | Rows 7, 8, 9; question 4 uses rows 1–3 | Right |
| "rows 1 to 9" (STATUS:404, 460) | Section "Needed before M3 builds on them" is rows 1–9 | Right |
| "row 16" (plan:167) | Row 16: application role has no access to the operator's record | Right |
| "Row 4", "Row 6" | Languages; AWS credentials and limit | Right |
| "twenty-first message in five minutes ... fifteen minutes" | US-C17 c1 | Right |
| "Three failures ... fallback once in fifteen minutes" | US-C15 c1, c2 | Right |
| "five sessions failing in two minutes ... health check" | US-C15 c6 | Right |
| "ten seconds after it was sent" | US-C18 c6, NFR-R7 | Right |
| "provider failure after 15 minutes" | US-C15 c4 | Right |
| "Two or three candidate models" | ADR 0010 | Right |
| "only two criteria are listed as delivered later" | `user-stories.md:545–548` | **Wrong: four** |
| "Three M3 criteria end in 'the session is handed over'" (row 7; plan:292) | Two criteria and one step | Loose |

## Q9. References to a decisions row by number

Searched the whole tree (not `.git`, not `node_modules`) for "row N" and "rows N", and the issue bodies in `/tmp/m3.jsonl`. Compared with `git show main:docs/decisions-needed.md`: old rows 7–28 are now 10–31.

| Reference | Points at | Status |
| --- | --- | --- |
| plan:23 (4), 24 (6), 67 (1–3), 221 (4) | unchanged rows | Right |
| plan:167 (16) | application role | Right (was 13) |
| STATUS:404–405 (1–9; 1, 4, 7), 460–461 (1–9; 4) | — | Right |
| decisions:8 (7–9) | — | Right |
| `reviews/2026-11-21-m3-preparation-check.md:41` "Row 15 ... row 14" | now 18 and 17 | **Stale** |
| `:42` "Row 18" | now 21 | **Stale** |
| `:43` "row 7" | now 10 (Row 2 unchanged) | **Stale** |
| `:44` "Row 19" | now 22 | **Stale** |
| `:48` "Rows 22, 25 and 28" | now 25, 28, 31 | **Stale** |
| `:49` "Rows 12 and 21" | now 15 and 24 | **Stale** |
| `:45–47` rows 5, 1, 4 | unchanged | Right |
| `:13–29` the reviewer's table and "Checked and true" | first version's numbers | Already disclaimed at `:36–38`; that disclaimer now covers one renumbering, not two |

No code comment, README line, triage line or M3 issue body cites a row by number. `data-model.md:170` "row 1" and the other hits are rows of other tables.

## Q10. Overclaims, the retro, stop-and-ask

False or loose statements: P3, P4, P14 ("Every text code sends"), P22, P23, P13 (U0 "needs no answer"), plan:246 "What M2 left of US-C18" (no record that c1–c4 are tested), U14's done-when (P2). "Every open issue ... is in one of these lists" is true.

Retro's seven changes: drafts, yes (plan:134); design note first, yes (list arguably short, P20); decisions page, yes; triage, done before the plan; README state table in the same pull request, **not carried**; name what cannot be run locally, yes (plan:143); edits from files and the control-character check, process, not in the plan.

Stop-and-ask: keys and money are rows 6 and 9; real data is excluded at plan:37–38; scope: the handover record is asked (row 7). Not asked: P1, P2, P8, P12.

## Q11. Other objections

P16 (migration), P17 (size), P24, P25, P29. Also: no test strategy beyond each "Done when" (timed batching tests under NFR-P5 with a fake clock or real time is not said; M2 had a one-in-eight flaky test); no unit updates `traceability.md` or adds the named eval cases the eval plan promises for M3 (`eval-plan.md:401–402`); several NFRs whose verification falls in M3 are never cited (NFR-R4, R6, S7, V2, A5, A6, C2; P2 and P3 need trace spans, #186). What M4/M5 would undo: a partial `handovers` table and step 11 (P5); pack claim kinds and the calendar in the core (P10); the logging email writer; a tool loop shaped by a test tool; a baseline measured without tools (P2).

## What I did not check

- Anything on GitHub: issue states, milestones, that 92 issues were moved and none closed, the M4–M6 counts, pull request #297's text, whether other issues or pull requests cite a decisions row.
- Issue bodies were in `/tmp/m3.jsonl` (field `b`), contrary to the brief; I read about fifteen of the 90, where a title was cut off or unclear. The other placements were judged by title only.
- Whether US-C18 c1–c4 are in fact built and tested in M2: I saw only that status handling exists in `packages/db/src/inbound.ts` and that the traceability row is empty.
- The threat model, `api.md`, `compliance.md`, the glossary beyond four rows, guardrail policy lines 121–211 (O3 in detail), state machines §4, §5, §7, and ADR 0012's "Known exceptions" in full.
- The code was read only for the channel interface, migration 0001 and a grep; no test or program was run, and PostgreSQL was not touched.
- Whether Meta's API offers the buttons P1 needs inside the reply window, and anything about AWS: no network.
- STATUS outside the 2026-11-22 entry, "Next" and "Blocked on the maintainer", except the stale heading at line 5.
