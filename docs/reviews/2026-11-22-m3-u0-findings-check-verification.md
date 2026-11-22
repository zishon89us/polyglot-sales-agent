# Check of the rework of M3 unit U0, 2026-11-22

A third agent checked commit `cfb46e4` against the response in
`2026-11-22-m3-u0-findings-check.md`. Its report is below, unedited; what
the author did about it comes first. **These last changes were checked by
the author only.**

## Author's response

| Finding | Done |
| --- | --- |
| F8, F11 partly fixed | See W1, W5 and W3 |
| W1 the ADR 0007 amendment was wrong | Accepted. A matching message does not reach the model; the amendment now says the handover it opens ends the checks at step 10. The first reviewer and I both made the wrong inference |
| W2 row 16's figure | Corrected in the row |
| W3 U6's and U5's rows | Both rows carry the test now |
| W4 the plan's lists do not carry what the page assigns | One paragraph in the plan's U0 section says the page overrides and adds to the lists. The unit issues get a comment each after the merge |
| W5 the architecture's sequence | A row: U10's |
| W6 U0's done-when | Reworded in the plan to what a page can deliver; said on the page |
| W7 #230, #221, #229 | #230 to M4; pointers under #221 and #229 |
| W8 NFR table | Accepted, all five |
| W9 "if row 30"; expired messages; the rest of #219 | Accepted |
| W10, W11 | Accepted |
| W12 row 36 | The two sources are told apart, what a yes accepts is stated, and the row says where it is set out |
| W13 STATUS | Accepted |
| W14 the commit says four issues stayed | Five: #82, #85, #199, #219, #226. The commit is not rewritten |

## The report

# Verification of the M3 U0 rework (branch `docs/299-m3-u0-findings`, HEAD cfb46e4)

Worked in a copy at `/tmp/u0verify`; nothing under `/home/claude/polyglot-sales-agent` was written. No network, no tests run, nothing installed. File paths below are relative to `/tmp/u0verify`.

## Verdict

The response is honest: 21 of the 24 answered findings are fixed as claimed, two are partly fixed (F8, F11), one is left and said to be (F25); F23 (a note) has no response row and needs none. The report section of the review file is byte-identical to `/tmp/u0review-report.md`, and `docs/requirements/nfr.md` is identical to `main`. The recount (83 calls, 11 files, 80 + 3) reproduces exactly; the move arithmetic (90 - 10 = 80, plus 19) holds; rows 1 to 35 of the decisions page are unchanged and the table is intact. The rework introduced one error of substance: the ADR 0007 amendment says a message matching step 4a "may still reach the model", which the order of checks contradicts (W1). The rest is smaller: decisions row 16 still tells the maintainer "about fifty calls" (W2); the plan's U6 table row was not widened with its scope (W3); parts the page hands to units are carried by the page alone, not by the plan (W4); one part of #234 (the architecture sequence) still has no end (W5); and U0's "done when" cannot be met by the four answers STATUS and the page say it waits for (W6). Nothing High. W1 should be fixed before merge; the others can be fixed in the same pass.

## Check 1: F1 to F25

| F | Response's claim | Verdict | Evidence |
| --- | --- | --- | --- |
| F1 | #85 stays for U13 | Fixed | `docs/plans/m3-u0-findings.md:92`; not in the move list `:99-101`; NFR-R7 conditioned on it `:153` |
| F2 | 83 in 11 files, pattern stated, decision re-made, "never met" called a search | Fixed | `:176-189`. Rerun: the stated grep gives 80 lines; 3 multi-line typed calls at `packages/db/src/operator.ts:133,167,217`; 11 files. Residue: W2, W10 |
| F3 | #199 stays | Fixed | `:68` |
| F4 | #82 stays for U15 and U10 | Fixed | `:91`. Both parts hang on row 30 and the row does not say so (W9) |
| F5 | Fairness M6 in both; #219 stays for the job's tenant, U2's note | Fixed on the page | `:93`, `:125`. Plan's U2 scope (`docs/plans/m3-ai-core.md:287-298`) says nothing of it (W4) |
| F6 | #220 to M4 | Fixed | `:94`, `:99`, `:126-127`, `:171` |
| F7 | Metrics and the owner's screen are M5's; (b) a question for U2 | Fixed | `:42-45`; also `:58` (#125 M6 split M4/M5) |
| F8 | ADR 0007 amended | Partly | Amendment present, `docs/adr/0007-guardrail-strategy.md:142-147`, in the form of the 2026-11-16 one. Its last clause is wrong (W1); the body `:43-47` is not marked as corrected; the architecture sequence #234 also names is untouched (W5) |
| F9 | NFR-V7 rewording taken back; row 36 with the reviewer's wording; five other places listed | Fixed | `git diff main -- docs/requirements/nfr.md` empty; `docs/decisions-needed.md:42`; page `:30-36`, `:198-200` (threat model, risks, ADR 0005, ADR 0007, guardrail policy: the reviewer's five) |
| F10 | #226 stays; U16's note reads the sources | Fixed on the page | `:73`. Plan's U16 (`m3-ai-core.md:427-433`) does not carry it (W4) |
| F11 | Plan's U6 widened in words; table says what is shown | Partly | Scope widened, `m3-ai-core.md:330-332`; page `:109`, `:168`. U6's row in the units table, `m3-ai-core.md:157`, still reads "US-C10, 1 and 2" and a done-when about traces only (W3) |
| F12 | S1, R1, R2, R5, V5 and the import test added | Fixed | `:149`, `:151`, `:154`, `:157`, `:167`. S1's list of units is short (W8) |
| F13 | "In full" dropped for R4, V7, S7, A5, R6; kept for P5, R7, O4 | Fixed | `:150`, `:159`, `:155`, `:164`, `:152`; kept `:148`, `:153`, `:169`. O2 also qualified, `:168` |
| F14 | STATUS: nothing closed, U0 unfinished | Fixed | `docs/STATUS.md:410-422`, `:429-431` |
| F15 | Glossary statuses | Fixed | `docs/requirements/glossary.md:38`: "The other states", `discarded` "an end", `expired` added. Small loss, W11 |
| F16 | Glossary names the booking pack's replies, how is U1's; plan's U1 gains fixed texts | Fixed | `glossary.md:48`; `m3-ai-core.md:152` and `:281` |
| F17 | Ceiling in the glossary with overflow and source; threat model's two lines are U10's | Fixed as stated | `glossary.md:122` matches `docs/design/state-machines.md:150-154` and `docs/ai/guardrail-policy.md:287-290`; page `:80` |
| F18 | Sentence gone | Fixed | "written by a script" does not occur on the page; `:34-36` gives the real reason. That the script exists on the agent's machine cannot be checked |
| F19 | #184 (h), (k) | Fixed | `:96` |
| F20 | Each missing item has a row or a place | Fixed | #288 `:113`; #290 `:120`, `:124`, `:128`; #295 `:133-137`. All 22 + 28 + 27 checkbox items found |
| F21 | Loose destinations | Fixed | `:111` (M5), `:116` (but for 6 and 7; U5 added), `:132`, `:133` |
| F22 | Smaller misfits | Fixed | `:50`, `:54`, `:59`, `:79`, `:95` |
| F23 | (no response row) | Nothing to do | A note that the arithmetic held; the table skips it without saying |
| F24 | Accepted | Fixed | `:71` |
| F25 | Left to M6, and said | Not fixed, as stated | `:201-202` |

Check 2: `sed -n '/^# Review of M3 U0/,$p' docs/reviews/2026-11-22-m3-u0-findings-check.md | diff - /tmp/u0review-report.md` is empty. Identical.

Check 3: `git diff main -- docs/requirements/nfr.md` is empty.

## New findings

| ID | Sev | Where | What | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| W1 | Medium | `docs/adr/0007-guardrail-strategy.md:146-147` | The amendment ends "so a message that matches may still reach the model". By the design it cannot. A match applies the emergency event, which hands the session over; handling then ends at step 5, 8, 9 or 10, never 15. The ADR body's "The model is not called for any of these" (`:46-47`) therefore stays true of 4a, and the amendment now contradicts it without marking it, where the 2026-11-16 amendment marked what it corrected (`:73`, `:140`). The reviewer's F8 made the same inference; the rework wrote it into an accepted record. It is true only of M3 after a no to row 29 (`m3-ai-core.md:82-84`), which is the plan, not the design the ADR cites. | `state-machines.md:32` "apply the emergency event of machine 2 (reason `emergency`, urgent ...)"; `:146-147` "With no open handover, an emergency opens one in `waiting`"; `:38` step 10 "Session handed over? Yes: the message joins the waiting session; no assistant reply. **Ends.**"; `guardrail-policy.md:285-286` "The session is handed over with its own reason, `emergency`" | End the bullet at "decided entirely by code", or say: "unlike the others it does not end handling itself; the checks continue at step 5 and the handover it opens ends them at step 10" |
| W2 | Low | `docs/decisions-needed.md:57` (row 16) | The page re-makes the query-builder decision "under row 16" on 83 calls, and row 16's "If no" still prices a no at "about fifty calls on 2026-11-21". The maintainer reads the row, not the page. | Row 16: "A query builder is chosen and the statements rewritten: about fifty calls on 2026-11-21"; page `:178` "83 calls" | Correct the figure in row 16 (a changed cell, not a renumbering) |
| W3 | Low | `docs/plans/m3-ai-core.md:157` against `:330-332` | U6's scope gained the log line and its test; U6's row did not. "Stories and criteria" has no NFR-O2 and "Done when" has no log test, so the unit can be called done without it. The same holds for the import test the page gives U5 (`m3-u0-findings.md:167`): U5's row and scope (`m3-ai-core.md:156`, `:319-324`) do not have it. | Row: "Traces and cost \| US-C10, 1 and 2 \| U2, U4 \| Every model call leaves one trace, linked to its session, with no message text, number or name in it" | Add NFR-O2 and "a test of the log line's shape passes for the api and the worker" to U6's row; add the import test to U5's |
| W4 | Low | `docs/plans/m3-ai-core.md:260-271` and the unit lists `:287-433` | The plan was edited in three places but still says U0 moves #82 and #85 to M4 and finds a milestone for #219, and no unit's list names what the page gave it: #85 (U13), #82 (U15, U10), #219 (U2), #226 (U16), #199 (U4, U12, U15), #76 (U2, U3, U7), #222's first half (U5). The plan's rule is that a unit's note reads "each finding listed under a unit" (`:235-238`). The page is the only carrier. Whether the unit issues #300 to #317 carry them could not be checked. | Plan `:261-262` "#80 and #82 (handover rules, M4), #85 (a failed reply shown to staff, M4)"; U13 list `:404` "US-C18 (#67); #139" | One line in the plan's U0 section: the page `m3-u0-findings.md` overrides this list and each unit's design note reads its rows there; or add the numbers to the unit lists |
| W5 | Low | `docs/plans/m3-u0-findings.md:77-79` (#234) | One passage #234 names still omits 4a and has no end: the runtime sequence in the architecture. The reviewer listed it as unchecked; the rework and the response are silent. `architecture.md` does not contain "4a" or "emergency" at all. | `docs/design/architecture.md:275` "W->>W: order of checks, steps 5 to 14 (core)"; #234 location: "`architecture.md` sequence l.258" | Add a row: fixed here (one word in the diagram, and say which program runs 4a), or U10's |
| W6 | Low | `m3-u0-findings.md:16-18`; `docs/STATUS.md:421-422`, `:429-430`; `m3-ai-core.md:151` | "#299 stays open until rows 13, 29, 35 and 36 are answered" implies the four answers finish U0. U0's done-when is "Every finding listed under U0 is closed with its reason or moved". After the four answers #76, #92, #111, #125, #147, #150, #199, #226, #232, #234, #253 are still open in M3 with parts promised to units up to U16. The page's "Not done" (`:193-195`) says the done-when is not met but not that it cannot be by this route. STATUS also sends the agent on to U1, whose "Needs" is U0. | Plan `:151`; page rule `:13-14` | Change U0's done-when in the plan to what the page delivers ("each part has an end; issues with a unit's part stay open for that unit"), or say #299 closes on the four answers by that reading |
| W7 | Low | `m3-u0-findings.md:99-100` (moves) | Three moves sit loosely with the page's own rule and with its treatment of #82. (a) #230 to M5: its last sentence, "Invitation, reset and operator-alert emails also have no failure behaviour", is M4's (sign-in, alerts delivered: page `:110`, `:127`), so the earliest milestone with an open part is M4. (b) #221 to M4: it asks for a "no name, number or text" rule for notification emails; the page keeps #82 in M3 because "what an email may contain is U10's, whose writer logs it" (`:91`). Same subject, opposite ends. The threat model's T38 already says "any email", so the M3 need is small. (c) #229 to M6: it names "GP §7 Disclosure" and an "unchosen provider"; U8 writes the disclosure in every language and U17 chooses model and routing. "Before any live use" is fair, but neither unit is told. No other moved body (#80, #220, #223, #224, #240, #218, #225) holds a part M3 builds. | Issue bodies in `/tmp/m3.jsonl`; `docs/design/threat-model.md` T38 | #230 to M4, or split; a pointer to #221 in the #82 row; a pointer to #229 under U8 and U17. The count of ten is unchanged |
| W8 | Low | `m3-u0-findings.md:154`, `:156`, `:158`, `:151` (NFR table) | (a) NFR-S1 "Each unit that adds a table: U2, U3, U6, U10, U11" omits U12 (stored counters and usage, plan `:396`) and U15 (the stored trigger and which tenants were told, plan `:423`). (b) NFR-V2 omits U10, whose writer logs emails; the page itself gives U10 the email-content question for that reason. (c) NFR-V6 is given to U17 "when the provider's terms and licence are read"; its other half, "0 conversation records in `evals/` or `prompts/`" by a scan in CI, falls on U4's prompts and U16's dataset. (d) NFR-R5 "For that kind": its target includes an alert to the operator's address, and nothing delivers one before M4 (page `:110`). (e) NFR-V1 is not in "Not M3's though M3 touches them" though U10 builds opt-out and `consent_records`. | `docs/requirements/nfr.md` rows S1, V2, V6, R5, V1 | Add the units and the two qualifications |
| W9 | Low | `m3-u0-findings.md:91`, `:120`, `:93` (Stays rows and one item) | (a) #82: both M3 parts exist only on a yes to row 30 (plan `:89-95`); the row does not say so, though `:131` does for the guard. On a no, #82 has no M3 part. (b) "Messages that expired unsent are never re-opened ... U13": row 3 calls re-opening M3 work only "If no"; on a yes there is nothing to build, and re-opening a customer's message is the turn's (U2, U7), not delivery tracking's. (c) #219: only the job's tenant and fairness get an end; the forged-job grants, the poison job and `ops jobs retry` replaying stale work are not placed. All other Stays rows fit the named unit's subject in the plan (#85 U13; #222 U5, U8; #184 c, h, i, j, k, l; #227 U4, U15; #226 U16; #199 U4, U12, U15). | `docs/decisions-needed.md:21`, `:36`; #219 body | Add "if row 30 is a yes"; "U13, only on a no to row 3"; "the rest of #219 is M6's" |
| W10 | Note | `m3-u0-findings.md:178`, `:185` | "83 calls" becomes "83 statements" seven lines later. 8 of the 83 are not SQL of the package's own: `BEGIN`, `COMMIT`, `ROLLBACK` in `tenant.ts:68,85,93` and `migrate.ts:176,184,188`, the `set_config` call at `tenant.ts:69`, and the pass-through at `tenant.ts:77`. | grep of the 80 lines | "83 calls" in both places, or count statements |
| W11 | Note | `docs/requirements/glossary.md:38` | (a) "A message that waited more than 15 minutes to be sent is `failed` with the code `expired`" drops the source's exception. (b) The row now names the state machines as "the authority", while the glossary's head says the glossary is right where they disagree and the state machines say their terms are the glossary's. | `state-machines.md:377` "it stores `expired`, or `unconfirmed` if a call for it had ended unknown"; `glossary.md:5-8`; `state-machines.md:17` | Add the clause; "is where each state is defined" for "is the authority" |
| W12 | Note | `docs/decisions-needed.md:26-31`, `:42` (row 36) | The quotes are accurate: `AGENTS.md:430-431` "Never send a phone number or a contact's name to the model"; `docs/adr/0005-…:55-58` "never adds the contact's phone number or name (NFR-V7). It cannot remove a number the customer typed into their own message; that text is theirs and is passed as written"; `architecture.md:99-101` "with no phone number and no name added by the system (NFR-V7)". Three small faults. (a) "cannot remove" is ADR 0005's alone; the architecture says only "added by the system". (b) The row gives the cost of a no and not what a yes accepts, as row 1 does: typed numbers and names of third parties go to the provider, against `docs/compliance.md:187-188` "Minimisation argues for sending the model only the text needed to answer, not phone numbers or names", which the reviewer cited and the row omits. (c) Row 36 sits under "Raised by the M3 plan ... Each is a question of `plans/m3-ai-core.md`, where it is set out in full"; it is not in the plan (`m3-ai-core.md:46-47` still says rows 29 to 35). "Sent as written" also sits beside the policy's I3 (truncation) and I5 (delimiter copies removed). The "If no" itself is fair. Table intact; rows 1 to 35 unchanged from `main` and from 59d0875 (three hunks: the date line, "These rows", row 36). | As quoted | Attribute the two halves; add "A yes accepts"; say the row is U0's, not the plan's |
| W13 | Note | `docs/STATUS.md:5`, `:429-431` | (a) The head still reads "Current milestone: M3 AI core (planned, not started)" above an entry that says U0 is under way. (b) "Next" 2 names rows for U2 and U5 but not U3, which builds on rows 34 and 36, nor U1 on row 21 (plan `:107-111`). The entry's facts check out: 25 findings (F1 to F25), two High (F1, F2), three glossary corrections, ten issues, rows 13, 29, 35 and 36. "#298 merged" matches c6c24f0; "#299 to #317" open could not be checked. | As cited | Two small edits |
| W14 | Note | commit cfb46e4, message | "Four issues about to be moved out held M3 parts and stay": five left the move list (#82, #85, #199, #219, #226; fifteen became ten). Not in any file. | `git show 59d0875:docs/plans/m3-u0-findings.md` l.81-82 against HEAD `:99-100` | Say five in the pull request's body; the commit need not be rewritten |

Checked and found right, briefly: 4a "Ten issues ... 19 unit issues and 80 others" (90 lines in `/tmp/m3.jsonl`, none above #295); 4c the count; 4d the amendment's form; 4e glossary against `state-machines.md` sections 2 and 7 and `guardrail-policy.md` sections 6 and 7 (all twelve fixed texts of section 7 are now in the system-reply list or its handover clause; the three booking items match steps 6 and 10); 4g "fixed texts" in both places of the plan; 4i decisions rows cited in the item tables (#288: 1, 16, 17; #290: 2, 3, 7, 8, 18; #295: 9, 11, 12, 15; row 10 at `:135`); the tag `m2-walking-skeleton` exists and STATUS `:378` says the maintainer pushed it. 4k: nothing the page calls done was found undone, apart from W1 and W5.

Check 5, ignored and unmentioned: the architecture sequence (W5); F4's "if row 30" (W9a); F11's "change U6's issue" (not checkable). Everything else in the report's check tables was taken up: #77's NFR-V2 (`:48`), #125 M6 (`:58`), #150 W8's second half (`:65`), #253's T5 and note (`:80`), row 10 (`:135`).

## What I did not check

- GitHub: that #299 to #317 exist and are in M3, any issue's present milestone or body, the pull request's body and whether it holds a closing keyword. No network.
- The test suite, `make check`, `tools/docs-checks` and `tools/names-check` against the edited files. I read `names-check.ts` only to see that it reads the handover-reason row and the first column of the message-classes table, both unchanged.
- The bodies of the roughly 60 issues in `/tmp/m3.jsonl` that the page does not name.
- The "Each finding" rows that send parts to M4, M5 or M6 (#125 M7, R3, R6; #147 V28, V31, V33; #150 W5, W6, W9, D2 to D5; #253 S1, S3; #232 A48) against their source documents; taken on the issue text.
- Whether the mock channel can delay delivery events, which NFR-R7's "In full" assumes.
- That the M2 retro and reviews record no renamed-column fault beyond a keyword search (none found).
- That a script for `user-stories.md` exists on the agent's machine (response to F18).
- The eval plan and `compliance.md` beyond the lines quoted.
