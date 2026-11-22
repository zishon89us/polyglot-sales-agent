# Check of the rewrite of ADR 0014, 2026-11-23

A third agent checked commit `96baa57` against the response in
`2026-11-23-adr-0014-review.md`. Its report is below, unedited; what the
author did about it comes first. **These last changes were checked by
the author only.**

## Author's response

| Finding | Done |
| --- | --- |
| D1 "the data model's row stands" overstated | True of what a pack's payload holds; the core side now reads the owner at the front. The row is amended by U5, which builds it; said here, not in the ADR |
| D6, D13, D18, D27 partly fixed | "The core's" is defined; the test changes are completed (X3, X8, X9); every tool runs in a transaction that first checks the lease; reserved names are stated. How a repeated tool call is reported, and a version in the payload, are left to U7 and U5 |
| X1 the amendment to ADR 0012 and row 21 said M3 builds none of those steps | Corrected in both: M3 builds steps 10, 13 and 15 without the pack's part |
| X2 where the name-only packs live | Stated: `booking` gains a default export, `faq-only` is a new package, both name-only in M3; the plan's U4 says so |
| X3 the record contradicted itself on `ops` | `ops` keeps its own list and imports no registry; a test in `apps/ops` compares the two |
| X4 a fragment outside `prompts/` | Fragments live under `prompts/`, in a folder named for the pack; the pack names its prompt. The repeated-text check covers it |
| X5 row 37 overstated | Both cells reworded; the fixtures are out of the argument, and what registering really avoids is stated |
| X6 the unknown-owner tap had no place | It ends where step 6 would be; malformed payloads the same; U10 builds it and writes it into the order of checks |
| X7 two versions in the trace | U6 adds the columns |
| X8 `packages/ai`; "entry point" | Whichever unit creates the folder adds it; `main.ts` is named |
| X9 name collisions | `core`, `interface` and `registry` are reserved and tested |
| X10 a check that no test makes | The claim is reduced to what is checked; U5 and U8 are to add the tests |
| X11 #222's first half | Said to be unchanged |
| X12 U2, U6 and `consent_records` | Named in the ADR's table and the plan's list |
| X13 three or four buttons | Left to U5, and said |
| X14 small errors in STATUS, the decisions header, the architecture and the plan | Corrected. U5's "Needs" is U1 alone |
| X15 types in `packages/ai`; two guesses stated as fact | The option is argued; "bad data" is widened; whether a payload returns intact is U5's to read |

## The report

# Verification of the ADR 0014 rewrite (M3 U1), branch `docs/300-m3-u1-pack-interface` at `96baa57`

Done in a copy at `/tmp/u1verify`. "ADR" alone is `docs/adr/0014-pack-interface.md`; line numbers are at HEAD.

## Verdict

The author's response is mostly true: of 33 findings, 19 are fixed, 7 are deferred as the response says (D1, D4, D5, D9, D10, D11, D20), 6 are partly fixed (D6, D7, D13, D16, D18, D27), and one (D32) needed no response. No response row is false outright, but three overstate (D1 "the data model's row stands", D7 "nothing built changes", D16's amendment). The report section of the review file is byte-identical to `/tmp/u1review-report.md`. The rewrite introduced one false statement that now sits in three places (ADR 0012's new amendment, decisions row 21, and by implication STATUS): "M3 builds none of the steps that would name a pack's button", although the plan and the ADR itself have M3 build steps 10, 13 and 15. Other new gaps: the ADR never says where `faq-only`'s `Pack` object lives or whether `booking` is registered in M3 (the new registry test requires it); it contradicts itself on whether `ops` imports the registry; a pack's prompt fragment is placed outside `prompts/` against `AGENTS.md` section 6; "the trace records both versions" needs a column U6 is not told about; the unknown-owner tap has no place in the order of checks and no unit; row 37's "If no" overstates the cost, because under the ADR's own rule the six fixtures never touch the real registry. Plan table and diagram agree edge for edge (38 edges, acyclic). Nothing blocks U5, U7, U8, U9, U10 or U11 outright; U4 cannot build the registry and its test without three answers (X2, X3, X4). I would fix X1 to X4 before merge; the rest can go to the units' design notes if listed.

## Check 1: the author's response, D1 to D33

| ID | Status | Evidence |
| --- | --- | --- |
| D1 | Deferred as stated; response partly misstates | ADR:148 fixes owner, action position and character set, not "only an owner". `data-model.md:268` still says the payload is "opaque to the core: the pack that registered the button reads it"; the core now reads the owner and all of its own buttons' payloads. The row does not "stand" unchanged in meaning and is not amended |
| D2 | Fixed | ADR:131-135; ADR 0003 cited at ADR:40 and quoted correctly (`0003*.md:235-236`) |
| D3 | Fixed | No mention of row-level security left in the ADR |
| D4, D5, D9, D10, D11 | Deferred as stated | ADR:148-149. Step 15 exists and names the buttons (`state-machines.md:43`); "steps 6, 10, 13 and 15" is right. Where the unknown-owner rule sits is unsaid (X6) |
| D6 | Partly | Defined at ADR:66-69; importers at ADR:79-81. Bare "the core's" is still used in a third, undefined sense at ADR:119, 121, 149, 150 |
| D7 | Partly | In the decision (ADR:89-102), row 37 (`decisions-needed.md:43`), failed job stated (ADR:89-92). "So nothing built changes" is not true of the ADR: `ops` is to read names from the registry (ADR:202-203), and every api and worker test must be handed a registry (ADR:82-85) |
| D8 | Fixed | Both courses at ADR:93-102 and row 37. The "no" cell is overstated (X5) |
| D12 | Fixed | ADR:82-85 |
| D13 | Partly | Names at ADR:75-77; assertions at ADR:192-207. Checked against the test: the four listed changes are possible. Gaps in X3, X8, X9 |
| D14 | Fixed | ADR:156-168 accounts for all thirteen exactly once (2 + 10 + 1); `architecture.md:243-245`; `0012*.md:243-252` |
| D15 | Fixed | ADR:151. The plan's U2 scope and U1's list of units (plan:293) do not name U2 (X12) |
| D16 | Partly | ADR:150; `0012*.md:253-256`; row 21 (`decisions-needed.md:63`). Done as said, but the sentence used to do it is false (X1). Reasons are still unprefixed; deferred with the part |
| D17 | Fixed | ADR:123-132 |
| D18 | Partly | ADR:120 states the flag, lease check, transaction, `tool_calls` row. Not stated: how a repeat is reported, and the confirmation's send job in the same transaction (`architecture.md:343-346, 358-360`). ADR opens the transaction "if the tool changes state"; the architecture has every tool run in a transaction that first checks the lease (`architecture.md:341-343`) |
| D19 | Fixed, rest deferred as stated | ADR:121, 128-130, 273-274 |
| D20 | Deferred as stated | ADR:147 |
| D21 | Fixed | plan:153, 156, 157, 186, 288-295, 320-329 |
| D22 | Fixed | Sentence gone; ADR:142-152 takes none in M3 |
| D23 | Fixed | Options C and D at ADR:51-54, 232-242. "Types in `packages/ai`", which the review also named, is not considered (X15) |
| D24 | Fixed | ADR:117-121, 209-211. ADR:172-173 says "a test in each" of U4, U7, U9; no U4 test of a pack is named anywhere |
| D25 | Fixed in the ADR | ADR:12-15. The plan's U1 scope still cites "(#200, #237)" for the central bet (plan:288) |
| D26 | Fixed | ADR:86-88; glossary:14 and US-D6 criterion 2 say what is claimed |
| D27 | Partly | ADR:148. No version. A pack named `core` is not forbidden, nor `interface` or `registry` (X9) |
| D28 | Fixed | `architecture.md:216-223`; diagram has `api --> pack`, no registry, no `pack --> core`, no `ops`. "All three" at :223 now follows a list of three undrawn things and reads as those (X14) |
| D29 | Fixed | ADR:277-283 |
| D30 | Fixed | ADR:214-215, 264-266, 286-287; `0012*.md:243`; row 37 |
| D31 | Fixed | Driver absent (ADR:33-43) |
| D32 | No response row | None needed; README line matches the title |
| D33 | Fixed | `STATUS.md:444-446` no longer says U1 builds on row 21 |

## Check 2

`sed -n '45,$p'` of the review file against `/tmp/u1review-report.md`: identical, 28,683 bytes each (`diff` and `cmp` silent).

## Check 3: new findings

| ID | Sev | Where | What | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| X1 | High | `0012*.md:253-256`; `decisions-needed.md:63` | "M3 builds none of the steps that would name a pack's button" is false. M3 builds steps 10 and 11 (U11), 13 (U10) and 15 (U7); only step 6 is not built. The ADR itself says so ("the code M3 writes for steps 10, 13 and 15 names no button but the core's own"). Row 21's "If no" no longer states a cost: it says the hooks are built first and, in the next sentence, that an unmerged ADR leaves them to M5 | plan:159, 162, 163, 173-175; ADR:149; U0 page:121 ("Steps 4a to 15, but for 6 and 7 ... U2, U5, U7 to U12") | Both places: "M3 builds steps 10, 13 and 15 without the pack's part; a tap that is not the core's ends before them." Row 21 "If no": "ADR 0014 is reworked so the hooks are built in M3" |
| X2 | High | ADR:93-96, 76-77, 205-207; plan:327-328 | Where `faq-only`'s `Pack` lives is not said, and `booking` is not mentioned at all. The new test requires the registry's keys to equal the names `ops` accepts, so `booking` must be registered in M3 too. The table says a pack is `packages/packs/<name>` with a default export; `packages/packs/booking` exports `./src/names.ts` as `.` and has no default export. The plan's U4 creates "the two packages", which leaves no package for `faq-only`; an object written inside the registry contradicts "one pack per `packages/packs/<name>`" | `packages/packs/booking/package.json`; `ls packages/packs` (only `booking`); first draft said "the booking pack in M3 is an empty Pack", the rewrite dropped it | Say: both are name-only in M3; whether each is a package or a literal in the registry; what `pack-booking`'s entry becomes |
| X3 | High | ADR:79-83, 198-207; `architecture.md:218-220` | Self-contradiction on `ops`. ADR:79-80 lets `ops` import the interface only. ADR:82 "only a program's entry point imports the registry". ADR:199-200 "only the entry points of `api` and `worker`". ADR:202-203 "once it reads them from the registry". ADR:205 compares the registry with "the names `ops` accepts", which is a tautology if `ops` reads the registry and a second list if it does not. In `ops`, `PACKS` is a module constant used by the constant `USAGE` and by `prepare` in `commands.ts`, not in the entry point `main.ts`: reading it from a registry passed down rewrites a built command and its tests, the cost the `faq-only` decision says it avoids (ADR:100-102) | `apps/ops/src/commands.ts:23, 50, 216`; `apps/ops/src/main.ts:10`; `ops.test.ts:405` | Choose: `ops` keeps `PACKS` and the test compares (no change to `ops`), or `ops` imports the registry (say which file, and that a built command changes). Say where the comparing test lives: a test under `packages` importing `apps/ops` breaks "no package imports from `apps`" |
| X4 | Medium | ADR:119 | A pack's fragment is "a file in the pack's own folder". `AGENTS.md` section 6 says each prompt lives in `prompts/<name>/` with a template, `meta.yaml` and `CHANGELOG.md`. The U0 page gives U4 a CI scan of `prompts/` for NFR-V6; a fragment elsewhere is outside it. Not said, no decisions row. Also unsaid: whether O6's "12 consecutive words of the instruction text" covers the fragment | `AGENTS.md:324-325`; `m3-u0-findings.md` NFR-V6 row; `guardrail-policy.md:102` | Put fragments under `prompts/` by owner, or state the exception and add a row; say O6 covers it |
| X5 | Medium | `decisions-needed.md:43`; ADR:93-102 | Row 37's "If no" and the ADR's reason overstate. Under ADR:82-85 no api, worker or db test can import the real registry; each passes its own. The six fixtures insert by SQL into a column whose only check is `pack <> ''`. So they work unchanged under either answer, and are not a reason to register the name. What a no really costs: `ops` refuses the name, two documents and `gen_openapi.py` change. What is true and unsaid: without registration a tenant an operator creates on `faq-only` today becomes dead jobs | `0001_core_tables.up.sql:20`; the six fixtures (`app.test.ts:61`, `worker.test.ts:52`, `harness.ts:167`, `inbound.test.ts:48`, `outbound.test.ts:45, 586`); `gen_openapi.py:64` | Reword both cells; drop the fixtures from the argument |
| X6 | Medium | ADR:148 | "A tap whose owner is not `core` is stored, gets no reply, counts towards the rate limit, and ends" has no step and no unit. To count, it must end at steps 5 to 9 (`state-machines.md:45-46`); to get no reply it must end before step 13, which would send the unsupported-type reply to a batch with no text. Placed where step 6 is, it never "joins the waiting session" (step 10), is not marked `received-while-not-answering` (step 8), and is not a "customer message" for the handover machine (:48-51). None of this is in the state machines, which the document says are the authority. Also unsaid: a payload with no owner, a malformed one, `core.` with an unknown action | `state-machines.md:13-15, 33-41, 45-51` | "Ends in the place of step 6, before 7 to 15; built by U10", and one line in section 1 or U10's note. Give the malformed case the same end |
| X7 | Medium | ADR:119; plan:293 | "The trace records both versions." `ai_traces` has one `prompt_name` and one `prompt_version`. U6 creates the table before U7 and is not among the units told to keep a rule | `data-model.md:372-373`; plan:158, 293 | Name U6 and the column, or say how one field carries both |
| X8 | Low | ADR:195-196 | "Changed in U4" assumes U4 creates `packages/ai`. U3 builds the function that assembles what the model sees, which the architecture puts in `ai`, and U3 does not need U4; whichever unit creates the folder trips the pinned list first. "Entry point" is not a file: `api` and `worker` each have `main.ts` and `index.ts` | `boundary.test.ts:85-92`; `architecture.md:196`; `ls apps/*/src` | "The unit that creates a folder adds it"; name `main.ts` |
| X9 | Low | ADR:75-77, 148 | Name collisions the layout creates and the ADR does not forbid: a pack named `interface` is `@polyglot-sales-agent/pack-interface`; a pack named `registry` is the registry's folder; a pack named `core` owns `core.` keys and payloads. The new import rule must tell `pack-interface` from `pack-<name>` by an exception on a name, which the driver at ADR:41-42 wanted to avoid. Verified: the present pattern matches `pack-interface` and does not match `packs-registry` | `node -e` with the test's pattern on five strings | Reserve the three names in the registry test |
| X10 | Low | ADR:184-185 | "Only the owner part of keys and payloads ... are checked by code." No such test is in Confirmation or in any unit's done-when | ADR:190-211; plan:157, 160 | Name the test and its unit, or drop the claim |
| X11 | Low | ADR:272-273; U0 page:100; plan:129-130 | #222 is sent whole to M5 as "whose button a tap is". The U0 page keeps half of it in M3: "whose conversation a tap came from is U5's", and the plan's question 6 says a tap is checked for it. The ADR does not say U5's half stands. An owner-prefixed `core.stop` carries no reference to the message it was sent on | as cited | "U5's half of #222 is unchanged" |
| X12 | Low | plan:293, 297-308; ADR:151, 152 | The ADR gives U2 a rule (create `pack_outcome`); the plan's U2 scope and U1's list of units do not carry it. The second exception in documents, "contact books in chat" (machine 6, which U10 builds), is covered only by "consent asked for by a pack: nothing in M3"; whether U10 creates `subject_type` and `subject_id` is not said, unlike the session column | `state-machines.md:353`; `data-model.md:188-189`; U0 page:137 | Add U2 and U6 to plan:293; one clause for `consent_records` |
| X13 | Low | ADR:148; plan:124-126 | "The stop, start, person and opt-in buttons": four. Step 5 has "stop or start button"; machine 6 and US-C7 have "opt-in button" for what clears an opt-out. Start and opt-in look like one button under two names; the ADR fixes four owners' actions without saying | `state-machines.md:33, 357-358`; `user-stories.md:155, 157` | Say three or four |
| X14 | Low | `STATUS.md:434-435`; `decisions-needed.md:8`; `architecture.md:223`; plan:111, 157 | STATUS: "four steps rewritten with behaviour lost"; the first draft rewrote three (6, 10, 13) and left out the fourth. Decisions header is dated 2026-11-22 and now covers a row added on 11-23. Architecture's "all three" (X-ref D28). Plan question 4 still says "U1 and U9 on row 21". U5's Needs "U0, U1" breaks the plan's own rule for the column (plan:172-173), since U1 needs U0; table and diagram do agree | `git show ca6ce86:docs/adr/0014-pack-interface.md` lines 118-125 | Reword each |
| X15 | Low | ADR:53-54, 63-64, 238-242 | Option D is argued only for `packages/core`. Types in `packages/ai`, which already holds the model, prompts and tools, is the nearer alternative and has no row. Stated as fact and not checked by the ADR: "it can happen only through bad data" (ADR:91-92; a deployment that drops a pack does it too); that a payload chosen by the sender comes back intact on a tap (only its length is marked unknown) | review D23; ADR:148 | Add the option or a line; mark the second as U5's to read |

Checked and found right: every count in the ADR ("three parts", "nine ... and four", "six test fixtures", "steps 6, 10, 13 and 15", "five private guesses" against the five places in Context); the quotes from ADR 0012 ("(M3 and M5)" at :235, "thirteen" at :92, the machinery driver at :28-29, the rules for pack code at :83-85); `faq-only` in `ops`, the data model (:71) and the API (`openapi.yaml:2246`); glossary and US-D6; "no pack has a table in M3"; `sessions.pack_outcome` as the data model has it (:251); the per-tenant schema against ADR 0005 (:45, the call takes the tools on offer and a schema) and guardrail A1; the diagram edge that #253 and #237 report missing is there. "Nothing in v1.0 changes a tenant's pack": I found nothing that does (no API operation writes `pack`); a search, not proof. MADR: every template section present; "Chosen option: **B**" lacks the template's "because" in the same sentence, the reasons follow. STATUS: "33 findings, seven of them High" is right (D1 to D7); rows 21 and 37 exist; "U4 on row 37" agrees with plan:156. Plan against diagram: 38 edges each, identical, acyclic.

## Check 4: what each unit still cannot know

- **U4.** Real blockers: where the two name-only packs live and what `pack-booking`'s entry becomes (X2); whether `ops` imports the registry or is compared with it, and where that test lives (X3); where a fragment file lives against `AGENTS.md` (X4). Also waits on row 37, as its done-when says. Not blockers: the shape of `PromptFragment` (path or loaded text) is U4's own to write.
- **U5.** No blocker. To settle in its note: whether its half of #222 stands (X11); three or four core actions (X13); which package builds and parses the owner, since the channel packages may not import the interface (ADR:80-81); what a payload with no owner becomes.
- **U7.** No blocker; its done-when can be met with a tool in test files and no database. It cannot show the "same transaction" property of a state-changing tool, which the ADR concedes. To settle: transaction for every tool or only state-changing ones (D18); how a repeat is marked in a result; the second version in the trace (X7, which is U6's table).
- **U8.** No blocker. The owner part of a key is enough; the separator is `.` by the examples.
- **U9.** No blocker. To settle: who refuses a pack kind named like a core kind, and when; whether O6 covers the fragment (X4).
- **U10.** One gap: it is the natural owner of the unknown-owner tap and is not told so, nor where it sits (X6). Otherwise none.
- **U11.** No blocker. "No database constraint against a pack's reason" and "only the core's reasons" are enough; `names-check` and the API enum are untouched because `late-change` stays.
- **Also U6** (not asked): X7. **U2:** the column, said only in the ADR (X12).

## What I did not check

- Nothing was run but read-only `git`, `grep`, `sed`, `diff`, `cmp`, one `python3 -I` that printed issue texts, and one `node -e` that applied the boundary test's import pattern to five strings. No test suite, `make check`, `names-check` or `check-docs`.
- GitHub: #318's merge, the ten moved issues, "99 open: 19 units and 80 others", the unit issues' texts. Offline; only `/tmp/m3.jsonl` (90 issues; #200, #222, #237, #240, #253, #278, #295 read in full).
- Meta's pages: whether a sender chooses a button's payload, its length limit and allowed characters, whether it returns intact. Nothing above assumes a value.
- The task named "#278 E8, `late-change`" as a U0-page row for U11. The U0 page does not mention #278 or `late-change`; E8 is in the issue only, so there is no promise there to contradict.
- ADRs 0005 and 0007 by search for schema, claims and tools only; ADR 0003 only its amendment; guardrail policy sections 2 to 4 and 7 read, the rest not; threat model only T39 and T48 by search; `api.md` and `openapi.yaml` by search for `pack`.
- Whether an import-boundary test for "no package imports from `apps`" exists.
- No tool permission was denied. Nothing under `/home/claude/polyglot-sales-agent` was written.
