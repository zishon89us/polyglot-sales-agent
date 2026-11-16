# Verification of the 20 Gate 2 High findings

All paths are relative to `/home/claude/polyglot-sales-agent/`. Nothing was edited. Both Python models and `check_openapi.py` were run read-only and pass.

## 1. Verdict per finding

| ID | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| S1 | PARTLY RESOLVED | Lease with token, expiry and token check at store: `docs/adr/0004-job-queue.md` l.52–63; `docs/design/architecture.md` §6 "Processing one turn" steps 1, 7, 8; `docs/design/data-model.md` `conversations` l.163–165 | `architecture.md` §7 l.413–415 still says correctness "rests on row locking for jobs and an advisory lock per conversation (ADR 0004)". Tools are not covered by the token check (V7). |
| S2 | RESOLVED | `architecture.md` "Sending a message once" l.314–335; `state-machines.md` §7 `sending` l.354 and decision 20; US-C1 c9; NFR-R2 | The worker-death case is stated and testable. Gaps in the policy itself are V5 and V6. |
| S3 | PARTLY RESOLVED | Key derivation and feed-back of completed tool calls: `architecture.md` steps 2–4, 7; `data-model.md` `bookings.idempotency_key` l.248 | `tool_calls.call_key` is "unique per tenant" with no "while active" condition, so the same key breaks legitimate repeats (V1). The repeat rule is defined only for create, not for move. |
| S4 | PARTLY RESOLVED | `docs/adr/0012-core-and-pack-boundary.md`; `architecture.md` §5 table l.191, 197 and l.223–239; `state-machines.md` §4 note and decision 21 | The data model and the OpenAPI file still put booking things in core tables and core routes (V8). The package diagram still has no `api → pack` edge, which the original finding named (V9). |
| S5 | RESOLVED | `api.md` §6 l.214–219 and decision 9; `openapi.yaml` `BookingInput` l.2818–2845 (`contact_phone`, `consent`); `data-model.md` l.247; US-C13 c3 | New issues in V10. |
| S6 | RESOLVED | `api.md` §3 l.137, 141–144 and decision 7; `data-model.md` `unparsed_events` l.300 and decision 8; `openapi.yaml` `receiveWebhook` has 200, 401, 413, 429, 503 and no 400; ADR 0011 l.56 says metadata | Low: the "Not drawn" list at `data-model.md` l.54–55 omits `unparsed_events`. |
| S7 | RESOLVED | US-C2 c3 now logs every not-found on an identifier route, which is implementable and testable | Low: `api.md` §2 "Identifiers" (l.59) and `data-model.md` `audit_log` do not mention the new logging. |
| A1 | RESOLVED | `state-machines.md` §8 l.391, 398 and decision 22; US-C15 c1, c6, c10; `threat-model.md` T59 l.171; guardrail policy O1 l.97; glossary l.131 | Retries per message are not capped (15 per message); T59 states the residual. |
| A2 | RESOLVED | ADR 0007 l.70–79 and Amendment; `threat-model.md` §6 l.235–246 and T50; guardrail policy G2, G3, l.51–59, currency row l.128 | No leftover of the "invented price" claim found by grep. Low: `risks.md` R-A1 (l.42) still says the guardrail "blocks values not found in tenant data", and US-C4 c9 states the total rule without O4's exception. |
| A3 | RESOLVED | Guardrail policy l.173–187; glossary "Grounded fact" l.34 | Subject binding is plainly marked as Model. The new calendar limit has its own defect (V12). |
| A4 | RESOLVED | Guardrail policy G13 l.41 and l.194–201; `eval-plan.md` E16 l.78 and §7; `threat-model.md` T60 | E16 has no minimum case count (V13). |
| A5 | PARTLY RESOLVED | Guardrail policy §6 l.266–302; `state-machines.md` step 4a l.32 and decision 23; US-C6 c10; glossary l.25; E17 with 20 cases per language | The `emergency` reason and the urgent mark do not exist in the API, the data model or the handover machine (V2). The staff alert is unthrottled and its limit is stated only in the threat model (V3). Unchanged passages contradict step 4a (V4). |
| A6 | RESOLVED | `eval-plan.md` E2 row l.64 and §5 l.239–256 | The part 1 algorithm is under-specified (V14). |
| A7 | PARTLY RESOLVED | `eval-plan.md` §4 l.182–209 (pooled), §6 l.262–271, §7 l.298–311 (regression rule removed), §8 table l.321–327 | `AGENTS.md` l.329–332 still says CI "regresses beyond a set margin against the stored baseline" and names the old trigger paths. `eval-plan.md` l.162–164 still makes support depend on per-language thresholds, which no longer exist. See V15. |
| A8 | RESOLVED | US-C8 c5 (handover, one behaviour); `eval-plan.md` E9 l.71; guardrail policy O2 l.98 | E9(b) is reported, not gated; this is stated. |
| A9 | RESOLVED | US-C5 c3; guardrail policy G5, G15; E18 fixed gate; §3 "Asks for sensitive data" l.101 | G16 remains ungated, stated as accepted (l.48–49). |
| A10 | RESOLVED | `eval-plan.md` §3 l.98–114: cross-tenant note, canary slot in production, model grader with human check | The canary claim contradicts the guardrail policy (V16). |
| A11 | RESOLVED | `threat-model.md` A7 l.49, items (a) to (h); NFR-L1 l.122; open list l.346 | — |
| A12 | RESOLVED | `state-machines.md` §6 l.338–339 and decision 24; US-C7 c5, c7; guardrail policy G11 l.39 and §8 l.341 | Low: O2 does not say what happens when the opt-in flag is set for a contact who is not opted out. |
| A13 | PARTLY RESOLVED | `architecture.md` steps 3, 4, 6, 7; guardrail policy l.110–114 | US-C4 c10, US-C15 c10 and US-C6 c2 still say the fallback is always sent (V11). US-B2 c2 still says "the assistant confirms". What the model's reply may contain after a booking is not stated. Whether a repeated create queues a second confirmation is undefined (V7). |

## 2. New findings

| ID | Severity | Location | Finding | Suggested resolution |
| --- | --- | --- | --- | --- |
| V1 | High | `data-model.md` `tool_calls` l.272 and l.331; `architecture.md` step 4 and §8 "Idempotency"; guardrail policy A4 | `tool_calls.call_key` is "unique per tenant" and is the key "made from what the call does". A customer who books, cancels and books the same slot again produces the same create key. A move A→B, B→A, A→B produces the same move key. The second call either violates the constraint or returns a stale result. Read-only tools have no defined key. `bookings.idempotency_key` is "unique among active bookings" at l.248 but plain "Unique" at l.331. | Make `call_key` unique only per turn or batch, or drop its uniqueness and let the booking constraint carry idempotency. Define the repeat rule for move. State that read-only tools are never deduplicated. |
| V2 | High | `openapi.yaml` `Handover` l.2717–2730; `data-model.md` `handovers`; `state-machines.md` §2; `handover_machine.py` | The `reasons` enum has no `emergency`, and there is no urgent field or sort order on the handover list. Machine 2 never defines the urgent mark or its effect on escalation, the holding message or staff actions. US-C6 c10 ("the waiting list shows first") therefore has no API and cannot be tested. | Add the enum value, an `urgent` field and the list order. Define the mark in §2: when it is set, whether it is ever cleared, and its effect on the escalation clock. |
| V3 | Medium | `state-machines.md` step 4a; guardrail policy l.283–286; `threat-model.md` l.211–215, T5, T6; glossary l.138 | Step 4a runs before the rate pause and emails staff "outside the throttle". Only the threat-model note says the email is once per session; the state machines, which are the authority, do not. Many numbers sending a phrase from a list kept in the repository each produce an immediate unthrottled email and an urgent handover. A repeat after hand-back in the same session produces another. T5 ("limit applied before any … handover or notification"), the §1 consequence at l.63–65 and decision 13 are now false. No threat entry covers it. | State the once-per-session rule in step 4a and set a per-tenant ceiling for urgent emails. Add a threat. Correct T5, decision 13 and the glossary throttle row. |
| V4 | Medium | Guardrail policy I1 l.67 and §6 table l.235–245; ADR 0007 layer 1; `architecture.md` sequence l.258; glossary l.48; decision 23 | Passages that list the order of checks omit 4a. The handover-reason table has no `emergency` row. The glossary's system-reply list omits the emergency text, the opt-in question, the automated-assistant answer and the booking confirmation. It is not stated whether the ordinary handover text (US-C6 c5, c6) also follows the emergency text. Decision 23 says "before every other step", but 4a follows steps 1–4. A second emergency message in the same session gets no text and no alert. | Update each list. State the message sequence for step 4a. |
| V5 | Medium | `architecture.md` "Sending a message once"; `state-machines.md` §7 l.377; NFR-R2 | The policy covers only a worker that dies. A send call that times out has the same unknown outcome, but §7 retries "a temporary error" three times for every class. A reminder template can then arrive up to three times, beyond NFR-R2's "at most 1 of a template". | Say whether a timeout counts as temporary. For templates, treat an unknown outcome as `unconfirmed` and do not retry. |
| V6 | Medium | Same passages; `data-model.md` `messages`; glossary l.38–39; `state-machines.md` §5 | The two `sending` rows do not cover every message: the free-form holding message, the retried answer, an in-window booking-change notice and the fixed booking confirmation are neither "a reply" nor "a template". "Never a third" (US-C1 c9) needs a resend counter and no column exists. `unconfirmed` is in neither the glossary's statuses nor its withheld reasons, and the reminder machine has no state for a reminder whose message is `unconfirmed`. A message stuck in `sending` is never `sent`, so the next held message has no release condition and can overtake it (NFR-R6, NFR-R7). | Decide the policy by message class rather than by reply or template. Add the counter and the reason. Define ordering behind a stuck message. |
| V7 | Medium | `architecture.md` steps 3, 4, 6, 7 | Only the store step checks the lease token. A worker whose lease expired can still run a state-changing tool and queue its confirmation while a second worker runs the same turn. It is not stated whether a repeated create that "returns the first booking" queues the confirmation again, or counts as "succeeded in this turn" for step 6. If it counts, a failed reply gets neither fallback nor confirmation. | Check the token inside the tool transaction. State that a repeat queues nothing and does not count as a success for step 6. |
| V8 | High | `data-model.md` `tenants` l.68, l.217–224, l.334–335, `consent_records` l.125–126, `sessions` l.176, `messages` l.188; `openapi.yaml` `Service`/`ServiceInput` l.2353–2417, settings l.2223–2245, `OpeningHoursResult.affected_bookings`, metrics l.2944–2969; ADR 0012 Confirmation | ADR 0012's boundary test would fail on the design as written. Core tables hold `consent_records.booking_id` and source `chat-booking`, `sessions.booking_outcome`, and booking settings columns on `tenants` with check constraints. The ADR says the core "stores the values" of pack settings, but no store is defined. `booking_service_settings` has no definition and is not in the diagram. Core routes require `duration_minutes` and `capacity` on every service, carry booking settings and `affected_bookings`, and return booking metrics. No route edits a service's duration or capacity. No operation is marked as pack-owned. | Define the pack-settings store and `booking_service_settings`. Move the booking fields out of the core schemas or mark them as pack extensions. Say what a `faq-only` tenant sees for each. |
| V9 | Medium | `architecture.md` diagram l.156–187, l.201–203, §8 "Time" l.441–444; `data-model.md` l.18–19; `state-machines.md` §1 steps 10, 13, 15, §6 l.334–335; glossary l.25, l.60, l.78 | No `api → pack` edge, and "packs are registered with the worker", although packs now supply routes. "Reminders … are in `core`" is stale. Core rules still name booking things: the Reschedule and Cancel buttons in the order of checks, booking events in the permission machine, the `late-change` reason, the reminder quiet-hours rule, and "booking created" in the containment metric. | Fix the diagram and the stale sentences. Either route these through pack hooks or list them as accepted exceptions in ADR 0012. |
| V10 | Medium | `api.md` l.214–219; `openapi.yaml` l.2833–2841; `state-machines.md` §5 check 1 and §6; `data-model.md` l.128–132 | "Without it no reminder is sent for it" is per booking, but the send-time check is per contact: a contact with any earlier consent record gets the reminder anyway. It is not stated that a contact created from a typed number is checked against `suppressed_numbers`; §6 covers only a number that "messages again". `consent: true` with no contact, and both `contact_id` and `contact_phone` together, are not rejected by the schema. A mistyped number sends a template to a stranger, and no threat entry covers it. | Choose per-booking or per-contact consent and make the check match. Apply the suppression lookup on every contact creation. Add validation and a threat. |
| V11 | Medium | US-C4 c10; US-C15 c10; US-C6 c2; US-B2 c2; `architecture.md` step 6 | The criteria say the fallback is sent whenever a check fails. Step 6 sends none after a successful state-changing tool. The criteria are the tests of the tables, so they would fail a correct build. | Add the exception to the criteria and reword US-B2 c2. |
| V12 | Medium | Guardrail policy l.182–185; US-C4 c14 | "A turn in which a booking tool ran" does not say whether finding free slots counts. A correct reply that names a non-slot date beside a slot ("closed on 20/11, free on 21/11 at 10:00") is now blocked. US-C4 c14 does not carry the limit. | Define the term. Add the blocked form to E12 and the limit to c14. |
| V13 | Medium | `eval-plan.md` §4 l.188–200, §5 l.233–237, §8 l.324 | E2, E3 and E16 are fixed gates with no minimum case count, so "every case" can be a handful. They sit in core cases of which half are held out, yet every fixed-gate case runs on every pull request and blocks it. Most held-out core cases are therefore exposed during prompt work. Fixed gates on a model grader need a person to read at least 50 passes "per run that … checks a gate", which a per-pull-request gate cannot meet without being "unchecked". | Give E2, E3 and E16 minimum counts and bounds. Say which set the pull-request gate uses and whether it is model-grader-only. |
| V14 | Medium | `eval-plan.md` §5 l.245–253 | Part 1 matches digit runs "with their separators" and uses no normalisation. `150.00` against `150`, `5 pm` against `17:00`, and date orders each need every written form in the allowed set, which is not required. Any incidental number (a list index, "2 options") fails a "0 wrong" gate. | State the minimal normalisation the grader does itself, or require the allowed set to list forms. Exclude or allow counts. |
| V15 | Medium | `eval-plan.md` l.162–164 against l.298–304; §9 l.354–359 against §8 l.332–335; l.300–301; `AGENTS.md` l.329–332, l.459 | A language is "supported" when it "meets its thresholds", but thresholds are now never per language. §9 puts every failed case in the pull-request table; §8 keeps held-out failures out of it. "Never less than 5 points below *p*" reads either as a floor or a cap on the margin. The 15-point per-language alarm rests on cells of about 10 to 30 cases, the same noise A7 described. `AGENTS.md` still describes the old gate. | Define "supported" as accepted by the maintainer at baseline. Reconcile §8 and §9. Reword the margin. Update `AGENTS.md`. |
| V16 | Medium | `eval-plan.md` l.110–114; guardrail policy O6 l.102, G6 l.34 | The eval plan says O6 blocks a reply containing the canary. The policy defines O6 only as 12 consecutive words of the instructions and has no canary. | Add the canary to O6 and G6, or remove the claim. |
| V17 | Medium | `eval-plan.md` E17 l.79; guardrail policy l.266–277 | E17 passes a case caught by the phrase list or the model flag. In a handed-over, paused or degraded session only the list acts, which was the core of A5(b). The list-only catch rate is neither gated nor reported, so a list that catches little can sit behind a clean E17. | Report and gate the list-only rate separately, per language. |
| V18 | Low | Various | Quality goal 4 "No message … answered twice" now overstates NFR-R2. `risks.md` R-A1 still says "deterministic grader". `api.md` decisions are numbered 7, 9, 8. The `Booking` response has no consent field, so staff cannot see what was ticked. E15 and the 60 Latin-letter cases have no stated dimensions. | Tidy. |

Clean, with no new defect found: A11 (assumption A7 and NFR-L1), A8, A9, S6, S7 beyond the Low notes above.

## 3. What I could not check

- **Reading scope breach.** My extraction of the A-rows also printed rows A14 to A43 of the second report (Medium findings, reviewer's text, no author response). I did not use them as findings, but I saw them. A grep also showed two lines of `docs/STATUS.md`.
- `docs/compliance.md` was not read, so I did not verify that assumption A7 lists every channel statement the design relies on.
- The OpenAPI linter was not run (no network); only the repository's structural check.
- Nothing is built, so every "tested by" is a plan. No eval number can be checked against data.
- `threat-model.md`, `api.md` and `openapi.yaml` were read only in the passages the fixes touch. ADRs 0003, 0005, 0006, 0010 and 0011 were only grepped.
- The Python handover model does not model the emergency reason, the urgent mark or `sending`, so it gives no evidence about them.

## 4. Summary

14 RESOLVED, 6 PARTLY RESOLVED (S1, S3, S4, A5, A7, A13), 0 NOT RESOLVED; new findings: 3 High (V1, V2, V8), 14 Medium, 1 Low.

---

## Author's response

Added on 2026-11-16 by the agent that wrote the documents under review. The
report above is unedited.

All three new High findings were accepted. Each was a defect in a fix made
the same day. The six partly resolved findings were mostly sentences
elsewhere that still stated the old design; those named are corrected.

| Finding | Response |
| --- | --- |
| V1 | Fixed. `tool_calls` has no unique key; a partial unique index on active bookings, a conditional move and an idempotent cancel recognise a repeat. The second verification found two stale sentences, now corrected, and leftovers tracked in #246 and #253. |
| V2 | Fixed; confirmed resolved by the second verification. The urgent mark and the `emergency` reason are in the handover machine, the data model and the API. |
| V3 | Tracked as #233. |
| V4 | Tracked as #234. |
| V5 | Tracked as #235. |
| V6 | Tracked as #236. |
| V7 | Fixed. A tool checks the lease token in its own transaction; a repeat queues nothing and does not count as a success. |
| V8 | Fixed for tables, settings, metrics and API schemas. The second verification showed ADR 0012's summary claim was still too wide; the ADR now lists every place the core still names bookings and says the boundary test would fail on them. Tracked in #237 and #253. |
| V9 | Tracked as #237. |
| V10 | Tracked as #238. |
| V11 | Tracked as #239. |
| V12 | Tracked as #240. |
| V13 | Tracked as #241. |
| V14 | Tracked as #242. |
| V15 | Tracked as #243. |
| V16 | Fixed. The canary is part of O6 and G6. |
| V17 | Tracked as #244. |
| V18 | Tracked as #245. |

The reviewer's scope breach (rows A14 to A43 were visible to it) is noted.
It did not change which findings were checked.
