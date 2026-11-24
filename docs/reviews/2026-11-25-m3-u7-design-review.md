# Design review: M3 U7, the turn and the customer's language

Reviewed: `docs/design/notes/m3-u7-turn.md` as first written (commit
`docs(design): the turn, and the customer's language` on
`feat/306-m3-u7-turn`), before any code, by a second agent that did not
write it, working read-only in a copy of the repository. The report is
unedited. The author's response follows it.

---

# Review of `docs/design/notes/m3-u7-turn.md` (M3 U7) and decisions rows 48, 49

**Read:** the whole note; `packages/ai/src/{types,bounded,batch}.ts` in full, `output.ts` and `fake.ts` in part, `prompts.ts` by grep; `apps/worker/src/{handlers,config,main}.ts`; `packages/db/src/{lease,outbound,profile}.ts`; `packages/core/src/{jobs,environment,model,profile}.ts` in part; architecture "Processing one turn"; state machines section 1; guardrail policy I5, O6, section 9; data model (`sessions`, `messages`, `tool_calls`, retention); plan rows U7–U16; US-C3, C8, C11, C12; NFR-V7; decisions rows 4, 36, 38, 48, 49; Dockerfile. **Not checked:** the U2 and U6 notes, ADR 0005, `packages/pack-interface`, `core/names.ts`, guardrail section 6, whether inbound text can hold control characters, any test run.

## Findings

**D1 — High — sections 3 and 4 (H2): which outbound messages become `assistant` is not defined.**
Section 3 says "what was sent to them", H2 says "an assistant's reply". `messages.class` has five values (`0001_core_tables.up.sql:99-101`): `staff-message`, `system-reply`, `service-notice` and `business-initiated` are covered by no H row. A staff message can hold the contact's name (NFR-V7), and M3 sends it unwrapped as "the model's own words".
*Change:* add an H row: only `class = 'assistant-reply'`, `kind = 'text'`, non-null body; everything else excluded, with a test.

**D2 — High — section 5, M3: unwrapped `assistant` text launders customer text into trusted text.**
`types.ts:14-16` says everything but `assistant` is never instruction. The stand-in's replies are the customer's text verbatim (A3), and M2's echoes are already stored as `assistant-reply`. A real model can also be induced to quote. The `tool-calls` kind, whose arguments the model writes, has no row in the M table at all.
*Change:* wrap `assistant` history and `tool-calls` arguments too, or exclude replies whose `turn_id` is null or made by the stand-in. State the choice.

**D3 — High — section 7: `language` breaks every existing answer, and the sticky mark fires on aliases.**
`output.ts:204` requires exactly `reply, claims, flags, toolCalls`. Answers are built in `output.test.ts`, `bounded.test.ts`, `trace.test.ts` and `apps/worker/src/traces.test.ts`; the note lists none of this. It also does not say whether a tool-call answer (empty reply) must carry `language`. "Two or three letters (ISO 639)" accepts `eng`, `ara`, `fil`, `xx`: under G2 each sets `unsupported_language` for good. `und` also matches the proposed column check.
*Change:* accept only two-letter codes plus `und`, or map known aliases. Do not make a mark that rests on one unverified model word irreversible. Say which answers carry the field.

**D4 — Medium — section 6, L3 against L2: a tool that throws cannot have its row stored in the same transaction.**
L2 puts the lease check, the tool and the row in one transaction. If the tool throws after writing, its changes must roll back, yet L3 stores a `failed` row.
*Change:* specify a savepoint, or a second lease-checked transaction for the `failed` row.

**D5 — Medium — section 6: no bound on a tool's time or result.**
`holdsLease` takes `FOR NO KEY UPDATE` on the conversation, the same lock storing an inbound message takes (`lease.ts:66-73`), so a slow tool blocks the webhook's write. No case covers arguments the tool rejects (`types.ts:23`: "checked where it is run"), a result that is not JSON, or its size in the next request.
*Change:* add a tool timeout, a result size cap, and a `refused` outcome.

**D6 — Medium — S2, L5: retries multiply, and a failed batch is poison.**
`JOB_MAX_ATTEMPTS` is 6 (`core/jobs.ts:15`). Five model calls per try gives up to 30 calls and 96 tool runs per batch. The messages stay unhandled, so the next customer message repeats the whole batch and the cost. U14 lands before U15. The stand-in can trigger this itself: a batch may be 8,000 characters, `REPLY_MAX` is 1,200, and A3 states no cut (`echoReply` cut at 1,000), so a long message gives `invalid-output` six times, forever.
*Change:* make the stand-in cut its reply; do not retry `invalid-output` and `tool-rounds`; say S2 re-runs tools.

**D7 — Medium — section 1 and S2 against architecture steps 2, 4, 7.**
The architecture has a retried turn see completed tool results. The note defers that to M5 but does not say that S3, L4 and S2 therefore run tools twice. The comment at `core/jobs.ts:21-24` (three attempts) no longer describes the longest job: five calls of 20 s plus 5 s trace writes is 125 s before tools, against a 240 s handler timeout.
*Change:* state the worst case and update the constant's reasoning; forbid state-changing tools until step 2 is built.

**D8 — Medium — section 5: "by the client itself" is not what `bounded.ts` does.**
`bounded.ts:466` passes the caller's `request` to the adapter untouched; `FakeLlmAdapter.calls` records it, and `fake.ts:3-4` promises no randomness. `BoundedOptions` has no random source.
*Change:* say the client builds a wrapped copy, add an injectable source of marks, and say what tests see.

**D9 — Medium — M1: removing the mark is unsound in one pass.**
Deleting a copy can join its neighbours into a new copy. It also silently alters customer text.
*Change:* draw a new mark until no text holds it; remove nothing. Guardrail I5's wording then needs amending.

**D10 — Medium — header: the US-C11/US-C12 correction is wrong.**
US-C12 has four criteria. "A batch that contains text and an unsupported message type" is US-C11 criterion 5, as the plan says (`m3-ai-core.md:161`). R2 repeats the error.

**D11 — Medium — section 6 and row 49: "removed when the conversation's text is" has no moment.**
Retention nulls each message by its own age (`data-model.md:491`); a `tool_calls` row belongs to a session and turn, not a message. The grant "insert and read" cannot do the later removal. The existing `result_at` column and the sentence at `data-model.md:377-378` need replacing explicitly.
*Change:* key removal to the row's own time and to the contact's deletion; note the update grant M5 needs.

**D12 — Low — A2 and section 1: "refuses to start in production".**
True today only through `sharedChannelCredential: true` (`config.ts:83`), which goes with #290. `stand-in-model` is not in `PRODUCTION_REASONS`, and `startReasons` drops unknown names (`environment.ts:66-71, 153-155`). The plan gives this guard to U14.
*Change:* add the reason to the list in this unit and say so.

**D13 — Low — R7.**
`loadBusinessProfile` returns nulls and does not fail (`core/profile.ts:61, 77`); the check is `answering()` (`db/profile.ts:57`). Marking the batch handled without `received_while_not_answering` departs from step 8. Likewise R3 marks a stop tap handled and drops it.

**D14 — Low — settings.**
`PSA_PROMPT_CANARY` is absent from the `secrets` facts (`config.ts:76-81`), so a placeholder would pass. The note does not say how the worker finds `prompts/`; the image has it only through `COPY . .`.

**D15 — Note.** H3 excludes `failed` replies, but `unconfirmed` means the customer may have one (`data-model.md:264`). History rows whose body was nulled by deletion have no case. R5 omits `boundBatch`'s `cut` case.

## Could not fault
- The profile carries no contact field (`core/profile.ts:57-83`); the query runs in the tenant's scope.
- `renewLease` and `holdsLease` exist (`lease.ts:50, 80`); the 120 s lease against 20 s calls is sound; the caps match `core/model.ts:34-37`.
- Traces carry tool names only; `generate` outside a transaction matches `bounded.ts:395-400`.
- A required canary matches `assemblePrompt` and O6.
- Rows 48 and 49 say what the note says; a session's language is consistent with `last_language` being non-personal.
- Per-call marks mean a mark the model leaks is useless afterwards.

---

## Author's response

All three High findings are accepted and the note is rewritten. **The
rewritten note has not been reviewed again.**

| Finding | Answer |
|---|---|
| D1 (High) | Accepted. Only a row of class `assistant-reply`, kind `text`, with a body is the assistant's; a staff message, a fixed text, a notice and a business-initiated message are never in a request. A test puts one of each in a session |
| D2 (High) | Accepted: **every** message's text is marked, the assistant's own earlier replies included. Only the system text is instruction. A tool call's arguments go to an adapter as structure, not as text in a message, and the note says what they are |
| D3 (High) | Accepted. The code is two small letters or `und`, nothing else. Every answer carries the field, a tool-calling one too. The session's mark stays as the story asks, but it no longer rests on a word that is thrown away: each reply's row records the language its turn reported, so the mark can be checked and worked out again. The tests and fakes that build answers are changed with the field |
| D4 | Accepted: a tool that throws, runs out of time or returns too much has its whole transaction undone, and its `failed` row is stored in a second transaction that checks the lease again |
| D5 | Accepted: 5 seconds for a tool, 4,000 characters for its result as JSON, and an outcome `refused` for arguments the tool does not take |
| D6 | Accepted. The stand-in cuts its reply. An `invalid-output` and `tool-rounds` are not tried again: the batch is marked as dealt with, with no reply, until U9 has a fallback to send. A timeout, a provider's failure and an unstored trace are tried again, and the note counts the worst case |
| D7 | Accepted: the worst case is written down, the constant's comment is corrected, and no tool that changes anything may be given to the loop until a later turn can see what an earlier one did |
| D8 | Accepted: the client builds a marked copy for the adapter; the source of marks can be replaced in tests; a scripted adapter records the marked copy |
| D9 | Accepted: nothing is removed from any text. A mark that any text holds is thrown away and another drawn. I5's wording is amended |
| D10 | Accepted, and it was my error: the criterion is US-C11, 5, as the plan said |
| D11 | Accepted: removal is by the row's own age and at a contact's deletion; `result_at` becomes `ended_at`; the grant M5 needs is named; the data model's sentence is replaced |
| D12 | Accepted: `stand-in-model` joins the list of reasons in this unit |
| D13 | Accepted for a tenant that is not answering: the check is `answering()`, and the batch is left as it is, not marked. A batch of taps alone is still marked as dealt with, as today; what a tap does is U10's, and the note says a stop tap is lost until then |
| D14 | Accepted: the canary joins the settings checked for a placeholder; the prompts are found beside the code, and the note says the image must hold them |
| D15 | Accepted: a reply whose send ended `unconfirmed` is included, since the customer may have it; a row with no body is never included; a text cut by `boundBatch` sets `truncated` |
