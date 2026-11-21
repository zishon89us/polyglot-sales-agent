# Sorting the open issues, 2026-11-21

Status: proposed · follows the M2 retro ("Triage the follow-up issues at the
start of M3")

At the end of M2 there were 203 open issues. 100 of them still
sat in the milestones that are finished (M0, M1, M2), because a review
finding is filed under the milestone whose review found it. This page says
where each of those should go, or that it stays. It is a proposal: **no
issue is moved until this page is merged**, and then the agent sets the milestones as written
here and changes nothing else about any issue.

The other 103 open issues are in M3 or later already
(M3: 53, M4: 16, M5: 29, M6: 1, v1.1: 4) and are not
listed.

## The rule

A finding goes to the milestone that builds what it is about, so that it is
settled in the design note of the unit that would otherwise trip on it.

1. If the finding's "Location" names user stories, it goes to the earliest
   milestone, from M3 on, that any of those stories belongs to
   (`requirements/user-stories.md` has each story's milestone). A finding
   about several stories has to be settled before the first of them is built.
2. If it names none, it was placed by hand, from its title and from what the
   agent knows of the unit it came from. The reason is in the table. These
   are the weaker placements.

The rule was applied by a script to the issues' own text; the agent did not
reread each of the hundred. A finding the rule puts in the wrong milestone
will be seen when that milestone is planned, which is when each of its
findings is read.

## The result

| Goes to | Issues | Meaning |
| --- | --- | --- |
| M3 | 37 | Read while M3 is planned |
| M4 | 28 | Read while M4 is planned |
| M5 | 20 | Read while M5 is planned |
| M6 | 7 | Hardening: how the NFRs are shown, CI, key rotation |
| docs | 5 | The wording of the requirements. Not moved: done in passing |
| now | 2 | The maintainer's; on `decisions-needed.md`. Not moved |
| check | 1 | Built; the maintainer checks and closes. Not moved |

So 92 issues move and 8 stay in the milestone
they are in. After the move, M3 holds 90 open issues,
M4 44, M5 49 and M6
8. That is the size of what the reviews of the
requirements and the design left to settle, not a count of defects in what
runs.

**Nothing is closed by this page.** Some of these are likely done or
overtaken, above all among the design findings of M2 (#178 to #253). Each
is closed, with its reason, when the milestone it now sits in is planned.
An issue placed by the first of several things it lists, such as #165 and
the "what the unit left open" issues, stays open after that milestone for
the rest.

The table was made by `tools/issue-triage.py` from the issues' text as it
was on 2026-11-21.

## Every issue

| Issue | Was in | Goes to | Basis | Title |
| --- | --- | --- | --- | --- |
| #6 | M0 | now | by hand: the maintainer's, on the decisions page | Maintainer: turn on branch protection for main |
| #7 | M2 | now | by hand: the maintainer's; what is still open is on the decisions page | Maintainer: decisions and accounts needed before milestone M2 |
| #10 | M2 | M4 | by hand: US-C1: criteria 6 to 8 (a tenant that is not answering, the dashboard's list, the emails) are not built; criteria 4 and 9 await the maintainer | US-C1: Receive every inbound message exactly once |
| #11 | M2 | check | by hand: US-C2: built in M2; the maintainer checks the criteria and closes | US-C2: Keep each business's data separate |
| #73 | M1 | M5 | names US-B3, US-B4 | Review finding S9: Rescheduling after the reminder was sent is undefined |
| #74 | M1 | M4 | names US-C6, US-D12, US-D5 | Review finding S10: Deletion with a future booking is incomplete |
| #75 | M1 | M5 | names US-C19, US-D4 | Review finding S11: Metrics are undefined for sessions that have not ended |
| #76 | M1 | M3 | names US-C12, US-C18, US-C19, US-C9, US-D12, US-D2, US-D8 | Review finding S12: Stored facts that no criterion produces |
| #77 | M1 | M3 | names US-C8 | Review finding S13: Contradiction |
| #78 | M1 | M3 | names US-B3, US-C13, US-C7, US-D12 | Review finding S14: The scope of consent is inconsistent |
| #79 | M1 | M3 | names US-B3, US-C14, US-C15, US-C17, US-C6, US-C7 | Review finding S15: Inputs handled by code are not defined in the three states where "th… |
| #80 | M1 | M3 | names US-C14, US-C5, US-C6, US-D3 | Review finding S16: Handover reason staff inherits rules written for customer-triggered … |
| #81 | M1 | M4 | names US-C14, US-C6 | Review finding S17: Escalation gaps |
| #82 | M1 | M3 | names US-C14, US-C15 | Review finding S18: A handover recorded inside the 5-minute throttle window: C14.2 does … |
| #83 | M1 | M5 | names US-B3, US-C9, US-D12 | Review finding S19: C9.1 says a free-form message "may be used" inside the reply window |
| #84 | M1 | M4 | names US-C16, US-C9, US-D6 | Review finding S20: Templates are under-specified |
| #85 | M1 | M3 | names US-C18 | Review finding S21: (a) A failed assistant or staff reply is shown only "when staff open… |
| #86 | M1 | M3 | names US-B2, US-C11, US-C17, US-D3 | Review finding S22: "The pending reply is discarded" does not say what happens to tool e… |
| #87 | M1 | M3 | names US-C11, US-C14, US-C17 | Review finding S23: Rate-limit interactions |
| #88 | M1 | M4 | names US-C16, US-C9, US-D3 | Review finding S24: Staff have no way to reach a customer outside the reply window |
| #89 | M1 | M4 | names US-C6 | Review finding S25: Limit semantics beyond the missing number |
| #90 | M1 | M4 | names US-D1, US-D3, US-D7 | Review finding S26: D3.3 says a second staff user "cannot send until it is released", bu… |
| #91 | M1 | M5 | names US-D11 | Review finding S27: "It applies to events scheduled after the change" fits only schedule… |
| #92 | M1 | M3 | names US-C14, US-C15, US-C2, US-C6, US-C7, US-D5, US-D8 | Review finding S28: Terms used without a definition, where the missing definition change… |
| #93 | M1 | M3 | names US-B2, US-B4, US-C3, US-C4, US-C5, US-C6, US-C7, US-C8 | Review finding S29: Criteria about model behaviour are written as absolutes ("then the r… |
| #94 | M1 | M3 | names US-C3, US-C5, US-C9 | Review finding S30: (a) "Supported language: a language in the eval dataset with a publi… |
| #95 | M1 | M4 | names US-C1, US-D10, US-D6 | Review finding S31: The operator is an actor with almost no defined behaviour |
| #96 | M1 | M5 | names US-C1, US-D5 | Review finding S32: Unroutable events (C1.5) contain a message and a phone number but be… |
| #97 | M1 | M5 | names US-B2, US-B3, US-D12, US-D2, US-D8, US-D9 | Review finding S33: The booking record is inconsistent and its states are not listed |
| #98 | M1 | M5 | names US-B2, US-D9 | Review finding S34: Simultaneous booking is covered only by implication |
| #99 | M1 | M3 | names US-C1, US-C15, US-C18 | Review finding S35: C1.6 promises "exactly one reply" after a worker stops mid-processing |
| #100 | M1 | M3 | names US-C7 | Review finding S36: The fixed opt-out and opt-in keyword lists are referred to but exist… |
| #101 | M1 | M4 | names US-D10, US-D7 | Review finding S37: D7.5 turns on "before a removal took effect", but D7.3 allows up to … |
| #102 | M1 | M3 | names US-C6, US-C8 | Review finding S38: Overlap: a request for medical advice must be declined with an offer… |
| #103 | M1 | M4 | names US-C1, US-D6 | Review finding S39: Dependencies on later milestones that the table does not list: C1.5 … |
| #104 | M1 | M6 | by hand: how the NFRs are shown to be met | Review finding S40: The success criterion "the non-functional targets in nfr.md are met … |
| #105 | M1 | docs | by hand: risk rows | Review finding S41: Risk rows left from the two-pack scope or in conflict with the requi… |
| #106 | M1 | docs | by hand: criteria that bundle behaviours | Review finding S42: Many criteria bundle behaviours, against the project's own standard |
| #107 | M1 | M3 | names US-C10, US-C14, US-C17, US-C6, US-C7 | Review finding S43: For several fixed messages it is not stated whether code or the mode… |
| #108 | M1 | M6 | by hand: numbers with one home | Review finding S44: The table says each number has one home, but these fixed numbers liv… |
| #109 | M1 | M6 | by hand: the load test's environment | Review finding S45: NFR-P1's target is relative to "the environment size recorded in the… |
| #110 | M1 | M4 | names US-B4, US-B5, US-D1, US-D2 | Review finding S46: Boundary wording |
| #111 | M1 | M3 | names US-C3 | Review finding S47: NFRs other than the four in "Engineering work with no user story" ha… |
| #112 | M1 | M3 | names US-C12 | Review finding S48: "Any inbound message that is not text, a button reply, or an image o… |
| #113 | M1 | M5 | names US-C19, US-D4 | Review finding S49: Handover rate's numerator can include sessions with no inbound messa… |
| #114 | M1 | M4 | names US-B2, US-D2, US-D6 | Review finding S50: Small gaps in the booking conversation: which five slots are offered… |
| #115 | M1 | M4 | names US-B4, US-D12, US-D6, US-D7 | Review finding S51: The agent role's list does not classify metrics, viewing business da… |
| #116 | M1 | docs | by hand: wording | Review finding S52: Wording |
| #117 | M1 | docs | by hand: low findings on the requirements' text | Low findings from the Gate 1 verification review |
| #125 | M1 | M3 | names US-C1, US-C14, US-C4, US-C6, US-D12 | Low findings from the second Gate 1 verification review |
| #128 | M1 | M4 | names US-C14 | Review finding V6: A follow-up that is held (quiet hours, daily limit) is neither "sent"… |
| #129 | M1 | M3 | names US-C7 | Review finding V8: Step 5 is under-defined in two ways |
| #130 | M1 | M3 | names US-C17 | Review finding V9: The rate limit sits after step 5, and nothing says whether messages t… |
| #131 | M1 | M3 | names US-C17 | Review finding V10: (a) "Not handed over until the pause ends" can mean the request is r… |
| #132 | M1 | M3 | names US-C15 | Review finding V11: P1 holds as worded on the main traces (see section A) but three inte… |
| #133 | M1 | M4 | by hand: the holding message | Review finding V12: The glossary lists three service notices; §7 has rows for two |
| #134 | M1 | M5 | names US-C9 | Review finding V13: "Send time reached → sent or withheld" omits two outcomes the same s… |
| #135 | M1 | M5 | by hand: quiet hours when the business messages first | Review finding V14: Quiet hours are checked at send time only on the queue-release path … |
| #136 | M1 | M5 | names US-B3 | Review finding V15: The row is a dash for none, scheduled and withheld, but the event ca… |
| #137 | M1 | M5 | names US-D11, US-D2 | Review finding V16: (a) B1 counts only booked and confirmed. A 60-minute appointment at … |
| #138 | M1 | M4 | names US-C6 | Review finding V17: The marks have no behaviour after a hand-back in the same session |
| #139 | M1 | M3 | names US-C18 | Review finding V18: The ordering rule releases the next message when the previous one is… |
| #140 | M1 | M4 | names US-C14, US-C6 | Review finding V19: The followed-up cells say "tell the customer a person will reply; no… |
| #141 | M1 | M5 | names US-C13 | Review finding V20: (a) US-C13 c2 records consent "to messages about that booking"; §6 t… |
| #142 | M1 | M4 | by hand: sending while a tenant is not answering | Review finding V21: (a) Nothing says what happens to outbound messages while the tenant … |
| #143 | M1 | M4 | by hand: handover states | Review finding V22: It is not stated whether waiting → in-progress happens when the staf… |
| #144 | M1 | M5 | names US-D12 | Review finding V23: Booking-change notices have timing, consent and opt-out behaviour bu… |
| #145 | M1 | M5 | names US-C9 | Review finding V24: Check 3 withholds a reminder when no approved template exists |
| #146 | M1 | M5 | names US-B5 | Review finding V25: US-B5 c5 requires the reminder to be "timed from the appointment's l… |
| #147 | M1 | M3 | names US-B3, US-B4, US-C11, US-C15, US-D11, US-D3 | Low findings from the state-machines verification review |
| #148 | M1 | M4 | names US-C14 | Review finding W1: Acknowledgement and staff notification skipped at step 7 are never se… |
| #149 | M1 | M5 | names US-B3 | Review finding W2: A Reschedule or Cancel tap during a followed-up handover is not acted… |
| #150 | M1 | M3 | names US-B3, US-C14, US-C17 | Low findings and model gaps from the second state-machines verification |
| #162 | M2 | M6 | by hand: roles are separate (M2); key rotation is not planned | Separate database roles and plan key rotation |
| #163 | M2 | M6 | by hand: CI and supply chain | Harden CI and the dependency supply chain |
| #165 | M2 | M3 | by hand: the guard for a fake model client; it stays open after M3 for logged email (M4) | Refuse to start a deployment with development components |
| #178 | M2 | M4 | by hand: channel credentials set from the dashboard | Review finding S9: `api` calls the channel directly, and API §6 says `setChannelCredenti… |
| #183 | M2 | M4 | names US-D3 | Review finding S14: The API status enum lacks `pending`, `held` and `discarded`, which S… |
| #184 | M2 | M3 | names US-C15, US-C6, US-C9 | Review finding S15: Behaviour that needs stored data with no table or column: (a) failed… |
| #191 | M2 | M4 | by hand: the cross-tenant role and dashboard sign-in | Review finding S22: DM uses the cross-tenant role for webhook routing, authenticating ev… |
| #195 | M2 | M5 | by hand: release of held messages | Review finding S26: Missing from the table: release of messages held for quiet hours (fo… |
| #199 | M2 | M3 | names US-B1, US-B5, US-C13, US-C15, US-C16, US-C5, US-C6, US-C9 | Review finding S30: No document maps every story and NFR to a component or lists what is… |
| #200 | M2 | M3 | by hand: the pack interface has no ADR | Review finding S32: Decisions with no ADR: the pack interface and registration (the "cen… |
| #201 | M2 | M4 | names US-D10, US-D7 | Review finding S33: Invitations, users and auth tokens are US-D10 and US-D7, milestone M4 |
| #204 | M2 | M4 | by hand: names in the API and the data model | Review finding S37: Units and names differ between the API and the data model. |
| #231 | M2 | M4 | names US-C14, US-D2 | Low findings from the Gate 2 structure review |
| #237 | M2 | M3 | by hand: pack hooks, due with the steps that need them | Review finding V9: No `api → pack` edge, and "packs are registered with the worker", alt… |
| #245 | M2 | docs | by hand: one sentence of the architecture | Review finding V18: Quality goal 4 "No message … answered twice" now overstates NFR-R2 |
| #249 | M2 | M5 | names US-D11 | Review finding W5: The glossary table still lists the six booking settings as plain tena… |
| #253 | M2 | M3 | names US-C17 | Leftovers from the second Gate 2 verification |
| #276 | M2 | M6 | by hand: CI and document checks | Low findings from the Gate 4 review of U2 (CI and document checks) |
| #278 | M2 | M3 | by hand: shared lists; the handover reasons a pack may add | M2 U3b: the shared lists U3 did not define, and its Low review findings |
| #279 | M2 | M6 | by hand: the database unit's leftovers: images pinned by digest, the bootstrap's limits | M2 U4b: what the database unit left open |
| #282 | M2 | M4 | by hand: delivering an operator alert | M2 U5b: what the jobs unit left open |
| #284 | M2 | M3 | by hand: who a customer is: awaits the maintainer | A WhatsApp customer may have no phone number: contacts need the channel's own identifier |
| #285 | M2 | M5 | by hand: templates and the channel's leftovers | M2 U6b: what the channel unit left open |
| #288 | M2 | M3 | by hand: sessions, the batching window | M2 U7b: what the webhook unit left open |
| #290 | M2 | M3 | by hand: the worker's leftovers | M2 U8b: what the worker unit left open |
| #293 | M2 | M4 | by hand: the owner's invitation; tenant state | M2 U9b: what the operator commands unit left open |
| #295 | M2 | M3 | by hand: the guard and the pack, continued | M2 U10b: what the end-to-end unit left open |
