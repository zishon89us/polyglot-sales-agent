# M3, unit U0: the document findings

2026-11-22 · issue #299 · unit U0 of [`m3-ai-core.md`](m3-ai-core.md)

U0 has no code. It reads the findings the triage sorted into M3 that are
about what the documents say, and gives each one of four ends: **fixed
here**; **a unit's**, named, to be answered in that unit's design note;
**moved** to the milestone that builds what it is about; or **already
answered**. Nothing is closed by the agent: the pull request closes #77
when the maintainer merges it, and the moves are made after the merge, as
the triage's were.

One rule for a finding with several parts: the issue stays in the earliest
milestone that still has an open part, and each unit ticks its own part.

## What changed in the documents

| File | Change | Finding |
| --- | --- | --- |
| `requirements/nfr.md`, NFR-V7 | Says that the system puts no number or name into a prompt, and that what a customer typed inside a message is sent as part of it. Before, a strict reading made the test impossible to pass | #77 |
| `requirements/glossary.md`, "Message status" | Adds `pending`, `held`, `sending` and `discarded`, as the outbound machine has them | #147, V29 |
| `requirements/glossary.md`, "System reply" | Adds the opt-in question, the automated-assistant answer, the emergency text and a pack's fixed replies | #234; #150, W7 |
| `requirements/glossary.md`, fixed values | Adds the ceiling on urgent handover emails, which only the guardrail policy carried | #253, A5 |

`user-stories.md` is written by a script from a list of criteria, so no
story's wording is changed here; the two wording changes findings ask for
(US-C17, 2 and the table of criteria delivered later) are made by the unit
that builds the story, and the second waits on row 35 of the decisions
page.

## Each finding

| Issue | Part | End |
| --- | --- | --- |
| #76 | (a), (b) fees and first-reply time stored on the session | Moved with the metrics that read them (M4) |
| | (c) a contact's last known language | U7 |
| | (d) nobody can enter a service's description or a policy | U3, by the operator's file; the owner's screen is M4's |
| | (e) past appointments with no outcome | M5 |
| #77 | US-C8, 4 named a contact's profile name | Already answered: the criterion no longer does |
| | NFR-V7 on what a customer typed | Fixed here. **Closed by this pull request** |
| #92 | "assistant reply", "system reply" | Already answered: both are defined as message classes |
| | "turn", "trace", "guardrail" | U2, U6, U9: each adds its term when it builds the thing |
| | "stop button" | U8 (with #222) |
| | "audit log", "waiting list", "affected tenant", "setup complete", appointment against booking | M4, M5 |
| #111 | NFRs with no traceability row | The table below, for M3's; each unit adds its row to `traceability.md` |
| | What reads the `unsupported-language` mark | U7 |
| #125 | M5, what "the same value" means in the output checks | U9 |
| | M5 (the glossary's handover sentence), M6, M7, R3, R6 | M4 |
| #147 | V26, V27: the handover diagram; no stated guard against two open handovers | U11 |
| | V29: statuses missing from the glossary | Fixed here; the rest of V29 is M5's |
| | V30: degraded mode's emails; what counts towards the trigger; one call or three | U15 |
| | V32: a customer who writes every few seconds is never answered | U2 |
| | V28, V31, V33 | M5 |
| #150 | W7 | Fixed here |
| | W8: where the rate pause starts | U12 |
| | "H1 and H3 need real tests" | U11 for the first transition, if it is built; M4 |
| | W5, W6, W9, D2 to D5 | M5, M4 |
| #199 | No map of stories and NFRs to components | M3's stories are mapped to units by the plan and M3's NFRs below. What it lists as not designed: degraded emails U15, token budget U12, the output schema U4, the flags (already answered by ADR 0007's amendment). The rest, the dashboard above all, is moved (M4) |
| #218 | STRIDE gaps | Moved (M6) |
| #221 | Notification email may carry identifiers | Moved (M4) |
| #223 | A number's new holder can reach the old holder's bookings | Moved (M5) |
| #225 | The compliance notes overstate what was read | Moved (M6) |
| #226 | Standards not read before use | Moved (M6). It is a breach of `AGENTS.md` section 11 that stays open until then, and the page says so |
| #229 | What a person must be told about where their data goes | Moved (M6); before any live use |
| #232 | A49 (the eval plan's parts), A50 | U16 |
| | A48, the rest of A49 | M6 |
| #234 | The glossary's list | Fixed here |
| | ADR 0007's first layer | Already answered: it says steps 1 to 14, and 4a lies between 4 and 5 |
| | Does the handover text follow the emergency text; a second emergency message | U10 |
| #253 | A5: the rate pause's exception for an emergency | The ceiling is fixed here; the criterion's wording is U12's |
| | V8 / S4: where the core still names bookings | U1 |
| | A13: does a failed reply with no fallback reset the counter | U9; the rest of A13 is M5's |
| | S3, S1 | M5, M4 |

Not M3's by what they are about, and moved whole: #80, #82, #85, #224
(M4); #230, #240 (M5); #219, #220 (M6, with per-tenant credentials). #222
stays for U8's half and is then M5's. #184 stays for parts (c), (i), (j)
and (l), which U12, U15 and U8 take; its other parts are M4's and M5's.
#227 stays for U4 and U15; its first part is row 13's.

**Moves to make after the merge:** to M4: #80, #82, #85, #199, #221, #224.
To M5: #223, #230, #240. To M6: #218, #219, #220, #225, #226, #229.
Fifteen issues; M3 then holds its 19 unit issues and 74 others, if #77 is
closed and nothing else has changed.

## M2's three leftover issues, item by item

| Issue | Item | Goes to |
| --- | --- | --- |
| #288 | The batching window | U2 |
| | Two contacts that turn out to be one person | U2's design note, with #284 |
| | Structured logs (NFR-O2) | U6 |
| | Operator alerts delivered; `/readyz` and the worker (#282) | M4 |
| | Deletion of unparsed and unroutable events | With the retention job, not M3 |
| | Which modules may hold the cross-tenant handle (#162); review items W3, W10, W12, W13, W14, X7, X8; NFR-P1; the entry point under test | M6 |
| | "Nothing reads the queued jobs" | Done in M2 by the worker |
| | The four decisions | Rows 1, 16 and 17 of the decisions page |
| #290 | Steps 4a to 15; sessions and the reply window | U2, U7 to U12, U15, as the plan gives them |
| | The pre-send check of the reply window; `discarded` | U2 |
| | Templates; the other pre-send checks; `held` for quiet hours; the withheld list | M5 |
| | The delivery wait; a status that arrives too early; what a dead send job leaves; a stale `sending` | U13 |
| | The trace of a turn | U6 |
| | Renewing the lease | U7 |
| | Migration 0004's way back | U2, whose migration replaces the column |
| | No fairness between tenants | U12 |
| | Per-tenant credentials (NFR-S5); alerts delivered; dead jobs removed; separate-process and killed-process tests; the entry point under test | M6, M4 |
| | The ten decisions | Rows 2, 3, 7, 8 and 18 |
| #295 | The guard for a fake model client | U14 |
| | The guard for emails that are only logged | U10, if row 30 is a yes |
| | The pack's registry and hooks; the two exceptions in documents | U1 decides; M5 builds |
| | The boundary test's word list | U1 |
| | The image, the deployment, `dev-setup.sh`, `ops` and `PSA_ENV`, the placeholder mark | M6 |
| | The five decisions | Rows 9 to 12 and 15 |

The three issues stay in M3 until their M3 items are done; the rest is
then carried into one issue per later milestone.

## NFRs whose check falls in M3

| NFR | Unit | How far M3 can show it |
| --- | --- | --- |
| NFR-P2, P3 | U6 records the spans; U17 reads them | From eval runs only; "in staging" needs a deployment |
| NFR-P5 | U2 | In full |
| NFR-R4 | U15 | In full, with a scripted client |
| NFR-R6 | U2 | As M2 showed it, now with batches; workers in separate processes still not tried |
| NFR-R7 | U13 | In full |
| NFR-S7 | U12 | In full |
| NFR-V2 | U6, U14, U18 | For what M3 writes: traces, the adapter's logs, an end-to-end run |
| NFR-V6 | U17 | When the provider's terms and licence are read |
| NFR-V7 | U3 | In full |
| NFR-A1 | U16, U17 | Prompt disclosure and cross-tenant exposure; tool misuse only as far as row 32 allows |
| NFR-A2 | U16, U17 | Prices; slot and booking times are M5's |
| NFR-A3 | U17 | Thresholds are set there, for the dimensions M3 has |
| NFR-A4, A6 | U16 | The dataset's inventory and the report |
| NFR-A5 | U6 | In full |
| NFR-C2 | U12 | The turn cap; the token budget's number waits on U17 |
| NFR-C3 | U17 | A first measured figure |
| NFR-M2 | U5 | Both channels implement the wider interface |
| NFR-O2 | U6 | In full |
| NFR-O4 | U2 and every unit with a migration | In full |

Not M3's though M3 touches them: NFR-S5 (per-tenant credentials), NFR-C1
(needs the dashboard), NFR-M1 (the trial pack, M5).

## The query builder, looked at again

ADR 0003 said to look again at the start of M3 with the count of
statements. On 2026-11-22 the files of `packages/db/src` not named as
tests make 52 calls to `.query(` in 10 files; the ADR counted about forty on
2026-11-18. **Kept as it is,** the agent's choice under row 16: nothing
in M2 went wrong for lack of a builder, and the cost named in the ADR, a
renamed column found by a test and not the compiler, was not met once.
U2, U3 and U6 add the most tables; U6's pull request counts again.

## Not done

- The table of criteria delivered later is not changed: it waits on rows
  29 and 35.
- Each part given to a unit above is a promise, not a fix.
- The parts moved to later milestones were sorted by what they are about,
  from the issue's text; nobody checked the sorting but the author until
  this page's review.
