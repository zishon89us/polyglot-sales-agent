# M3, unit U0: the document findings

2026-11-22 · issue #299 · unit U0 of [`m3-ai-core.md`](m3-ai-core.md) ·
reviewed by a second agent (`reviews/2026-11-22-m3-u0-findings-check.md`)

U0 has no code. It reads the findings the triage sorted into M3 that are
about what the documents say, and gives each part one of four ends:
**fixed here**; **a unit's**, named, to be answered in that unit's design
note; **moved** to the milestone that builds what it is about; or
**already answered**. Nothing is closed, by the agent or by this pull
request. The moves are made after the merge, as the triage's were.

One rule for a finding with several parts: the issue stays in the earliest
milestone that still has an open part, and each unit ticks its own part.

**U0 is not finished by this page.** Its issue (#299) stays open until
rows 13, 29, 35 and 36 of the decisions page are answered: they decide
#227's first part, the table of criteria delivered later, and NFR-V7.

## What changed in the documents

| File | Change | Finding |
| --- | --- | --- |
| `requirements/glossary.md`, "Message status" | Adds the states `pending`, `held`, `sending` and `discarded`, and the code `expired`, as the outbound machine has them | #147, V29 |
| `requirements/glossary.md`, "System reply" | Adds the opt-in question, the automated-assistant answer, the emergency text and the booking pack's fixed replies | #234; #150, W7 |
| `requirements/glossary.md`, fixed values | Adds the ceiling on urgent handover emails, which the state machines and the guardrail policy carried | #253, A5 |
| `adr/0007`, amendment | Says that the first layer includes step 4a, and that 4a does not end the checks | #234 |
| `plans/m3-ai-core.md` | U6 takes the shape of a log line (NFR-O2); U1's ADR also covers a pack's fixed texts | #288; this page's review |

**NFR-V7 is not changed.** The first draft of this page reworded it, to
say that what a customer types inside a message is sent to the model as
written. That is what ADR 0005 and the architecture already say, but
`AGENTS.md` section 7 says "Never send a phone number or a contact's name
to the model" without exception, so the wording is the maintainer's: row
36. No story's wording is changed either; those changes wait on rows 29
and 35 or are made by the unit that builds the story.

## Each finding

| Issue | Part | End |
| --- | --- | --- |
| #76 | (a) fees stored | Moved with the metrics that read them (M5) |
| | (b) first-reply time and fees kept on the session | U2 says whether `sessions` has the columns from the start; the metrics are M5's |
| | (c) a contact's last known language | U7 |
| | (d) nobody can enter a service's description or a policy | U3, by the operator's file; the owner's screen is M5's |
| | (e) past appointments with no outcome | M5 |
| #77 | US-C8, 4 named a contact's profile name | Already answered: the criterion no longer does |
| | NFR-V7 and NFR-V2 on what a customer typed | NFR-V2 needs nothing: message bodies are barred from logs and traces whole. NFR-V7 waits on row 36. **Stays open** |
| #92 | "assistant reply", "system reply" | Already answered: both are defined as message classes |
| | "turn" | U7, and its cap U12 |
| | "trace", "guardrail" | U6, U9: each adds its term when it builds the thing |
| | "stop button" | U8 (with #222) |
| | "audit log", "waiting list", "affected tenant", "setup complete", appointment against booking | M4, M5 |
| #111 | NFRs with no traceability row | For M3's, the table below, and each unit adds its row to `traceability.md`; the others (NFR-U1 to U3, P4, O3, M4, L1, L2) in the milestone that checks them, M4 to M6 |
| | What reads the `unsupported-language` mark | U7 |
| #125 | M5, what "the same value" means in the output checks | U9 |
| | M5 (the glossary's handover sentence), M7, R3, R6 | M4 |
| | M6, a withheld follow-up shown nowhere | M4 for the handover, M5 for the list |
| #147 | V26, V27: the handover diagram; no stated guard against two open handovers | U11, if it is built, for the guard; the deleted-contact and take-over edges are M4's |
| | V29: statuses missing from the glossary | Fixed here; the rest of V29 is M5's |
| | V30: degraded mode's emails; what counts towards the trigger; one call or three | U15 |
| | V32: a customer who writes every few seconds is never answered | U2 |
| | V28, V31, V33 | M5 |
| #150 | W7 | Fixed here |
| | W8: where the rate pause starts | U12; replies to a Confirm tap while paused are M5's |
| | "H1 and H3 need real tests" | U11 for the first transition, if it is built; M4 |
| | W5, W6, W9, D2 to D5 | M5, M4 |
| #199 | No map of stories and NFRs to components | M3's stories are mapped to units by the plan and M3's NFRs below; the flags are already answered by ADR 0007's amendment. Degraded emails U15, token budget U12, the output schema U4. The dashboard and the rest are M4's. **Stays in M3** until the three are done |
| #218 | STRIDE gaps | Moved (M6) |
| #221 | Notification email may carry identifiers | Moved (M4) |
| #223 | A number's new holder can reach the old holder's bookings | Moved (M5). The same holder joining the old conversation is row 1's, and U2's note takes it with #284 |
| #225 | The compliance notes overstate what was read | Moved (M6) |
| #226 | Standards not read before use, against `AGENTS.md` section 11 | **Stays in M3.** U16 builds the red-team set on the eval plan, which rests on the unread sources: U16's design note reads them and dates the reading, as section 11 says. The threat model's half is then M6's |
| #229 | What a person must be told about where their data goes | Moved (M6); before any live use |
| #232 | A49 (the eval plan's parts), A50 | U16 |
| | A48, the rest of A49 | M6 |
| #234 | The glossary's list | Fixed here |
| | ADR 0007's first layer omits 4a | Fixed here, by an amendment |
| | Does the handover text follow the emergency text; a second emergency message | Already answered in the state machines (step 4a and section 2). What is left: the guardrail policy says the text is sent once per session, the state machines once in 60 minutes per contact. U10 |
| #253 | A5: the rate pause's exception for an emergency | The ceiling is in the glossary now. The criterion's wording is U12's; the threat model's two lines (T5, the note on urgent emails) are U10's |
| | V8 / S4: where the core still names bookings | U1 |
| | A13: does a failed reply with no fallback reset the counter | U9; the rest of A13 is M5's |
| | S3, S1 | M5, M4 |

Issues the plan listed as not M3's:

| Issue | End |
| --- | --- |
| #80, #224 | Moved (M4) |
| #230, #240 | Moved (M5) |
| #82 | **Stays.** Whether degraded mode's emails share the throttle is U15's; what an email may contain is U10's, whose writer logs it. The rest is M4's |
| #85 | **Stays.** Part (b), a first message that fails and stalls the queue, and (c), the error classes, are U13's. (a) and (d), the list, are M5's |
| #219 | **Stays.** A job's tenant taken from its payload is every new job's concern: U2's note sets the rule for the units after it. Fairness between tenants is M6's, here and in #290 |
| #220 | Moved (M4): one signing secret or one per tenant is settled with per-tenant credentials, US-D6 |
| #222 | Stays: whose conversation a tap came from is U5's; where the stop button appears is U8's. Then M5 |
| #184 | Stays: (c) U12 and U15, (h) U9, (i) U15, (j) U12, (k) U13, (l) U8. The other parts are M4's and M5's |
| #227 | Stays for U4 and U15; its first part is row 13's |

**Moves to make after the merge:** to M4: #80, #220, #221, #224. To M5:
#223, #230, #240. To M6: #218, #225, #229. Ten issues. M3 then holds its
19 unit issues and 80 others, if nothing else has changed.

## M2's three leftover issues, item by item

| Issue | Item | Goes to |
| --- | --- | --- |
| #288 | The batching window | U2 |
| | Two contacts that turn out to be one person | U2's design note, with #284 |
| | Structured logs (NFR-O2) | U6, widened by this page |
| | Operator alerts delivered; `/readyz` and the worker (#282) | M4 |
| | Deletion of unparsed and unroutable events | M5, with the retention job |
| | Which modules may hold the cross-tenant handle (#162); review items W3, W10, W12, W13, W14, X7, X8; NFR-P1; the entry point under test | M6 |
| | Meta's real batch sizes | Only a live webhook shows them: before any live use |
| | "Nothing reads the queued jobs" | Done in M2 by the worker |
| | The four decisions | Rows 1, 16 and 17 of the decisions page |
| #290 | Steps 4a to 15, but for 6 and 7; sessions and the reply window | U2, U5, U7 to U12, U15, as the plan gives them. Steps 6 and 7 are M5's and M4's |
| | The pre-send check of the reply window; `discarded` | U2 |
| | Templates; the other pre-send checks; `held` for quiet hours; the withheld list | M5 |
| | The delivery wait; a status that arrives too early; what a dead send job leaves; a stale `sending` | U13 |
| | Messages that expired unsent are never re-opened (row 3 calls it M3's work) | U13 |
| | The trace of a turn | U6 |
| | Renewing the lease | U7 |
| | Migration 0004's way back | U2, whose migration replaces the column |
| | The echo cut at 1,000 characters | Ends with the echo, in U7 |
| | No fairness between tenants | M6, with #219 |
| | Per-tenant credentials (NFR-S5) | M4, US-D6 |
| | Alerts delivered; dead jobs removed | M4 |
| | The worker's unused app secret; what the heartbeat shows; separate-process and killed-process tests; the entry point under test | M6 |
| | The other decisions | Rows 2, 3, 7, 8 and 18 |
| #295 | The guard for a fake model client | U14 |
| | The guard for emails that are only logged | U10, if row 30 is a yes |
| | The pack's registry and hooks; the two exceptions in documents | U1 decides; U9, U10 and U11 keep to it; M5 builds the rest |
| | The boundary test's word list; "a name, not an idea" | U1's pull request, if its ADR changes the list; otherwise M5 |
| | `docker compose up` never run on the agent's machine | Still so: U18 says it again |
| | No worker can start in production | M4, with per-tenant credentials (row 10) |
| | The image, the deployment, `dev-setup.sh`, `ops` and `PSA_ENV`, the placeholder mark, `ops channel connect` and other channels, the stand-in's memory | M6 |
| | The tag for M2 | Done: the maintainer pushed it |
| | The decisions | Rows 9, 11, 12 and 15 |

The three issues stay in M3 until their M3 items are done; the rest is
then carried into one issue per later milestone.

## NFRs whose check falls in M3

| NFR | Unit | How far M3 can show it |
| --- | --- | --- |
| NFR-P2, P3 | U6 records the spans; U17 reads them | From eval runs only; "in staging" needs a deployment |
| NFR-P5 | U2 | In full |
| NFR-R1, R2 | U2, U7, U18 | Again: M2's proof rests on `handled_at` and the echo, which these units replace |
| NFR-R4 | U15 | With a scripted client. Not US-C15, 9 (M5); the emails are logged, and only on a yes to row 30; the handover only on a yes to row 29 |
| NFR-R5 | Each unit that adds a kind of job | For that kind |
| NFR-R6 | U2, U13 | Order with batches (U2) and the wait (U13); workers in separate processes still not tried |
| NFR-R7 | U13 | In full, once #85's failed case is settled |
| NFR-S1 | Each unit that adds a table: U2, U3, U6, U10, U11 | The tests that try to cross tenants, for each new table |
| NFR-S7 | U12 | The limit and the pause. Where the pause starts (#150, W8) and the exception's wording are open; steps 6 and 7 are not built |
| NFR-V2 | U6, U14, U18 | For what M3 writes: traces, the adapter's logs, an end-to-end run |
| NFR-V5 | U16 | The dataset holds no real number or conversation |
| NFR-V6 | U17 | When the provider's terms and licence are read |
| NFR-V7 | U3 for the business's data, U7 for the prompt | As row 36 is answered; a tool's result is M5's |
| NFR-A1 | U16, U17 | Prompt disclosure and cross-tenant exposure; tool misuse only as far as row 32 allows |
| NFR-A2 | U16, U17 | Prices; slot and booking times are M5's |
| NFR-A3 | U17 | Thresholds are set there, for the dimensions M3 has |
| NFR-A4, A6 | U16 | The dataset's inventory and the report |
| NFR-A5 | U6 | For M3's calls; the inquiry label is a second use of the model, in M5 |
| NFR-C2 | U12 | The turn cap; the token budget's number waits on U17 |
| NFR-C3 | U17 | A first measured figure |
| NFR-M2 | U5 | Both channels implement the wider interface; the test on imports that `traceability.md` says is not written is U5's |
| NFR-O2 | U6 | The shape of a line and a test of it for the api and the worker; `ops` prints for a person and is left |
| NFR-O4 | U2 and every unit with a migration | In full |

Not M3's though M3 touches them: NFR-S5 (per-tenant credentials, M4),
NFR-C1 (needs the dashboard), NFR-M1 (the trial pack, M5).

## The query builder, looked at again

ADR 0003 said to look again at the start of M3 with the count of
statements, and counted about forty on 2026-11-18. On 2026-11-22 the
files of `packages/db/src` not named as tests hold 83 calls to `query`
in 11 files: 80 lines matching `\.query(<[^(]*>)?\(` and 3 whose type
argument runs over a line. The first draft of this page said 52, from a
search that missed every typed call. The two counts were not made the
same way, so "doubled in four days" is not shown either.

**Kept as it is,** the agent's choice under row 16. The ADR's reason was
that the SQL can be read in one sitting; at 83 statements in 11 files
that is still so, and less so with each unit. The cost it named, a
renamed column found by a test and not the compiler, is not recorded in
the M2 retro or its reviews; that is a search of them, not proof. U6's
pull request counts again, the same way.

## Not done

- U0's own "done when" is not met: no finding is closed, and the table of
  criteria delivered later is unchanged. See the top of this page.
- Each part given to a unit above is a promise, not a fix.
- The parts moved to later milestones were sorted by what they are about,
  from the issue's text.
- The threat model, risks register, ADR 0005, ADR 0007 and guardrail
  policy repeat NFR-V7's present wording; they change with it, after row
  36.
- #232's four one-line tidies of the threat model and risks are left to
  M6.
