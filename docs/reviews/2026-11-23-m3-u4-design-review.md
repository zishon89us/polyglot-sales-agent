# Design review: M3 unit U4 design note (`docs/design/notes/m3-u4-llm-client.md`) and decisions rows 44 and 45

Reviewer: independent, read-only, in `/tmp/u4design`. Nothing was changed, installed or run beyond reading files. No code exists for the unit.

**Verdict:** not ready to build as written. Five High findings (D1 to D5) change numbers, lists or decision rows; the rest are corrections and missing cases.

## What I read

- The note in full (319 lines); `docs/decisions-needed.md` header and rows 30 to 45.
- `docs/plans/m3-ai-core.md`: questions 3 to 6, the unit table, sections U1 to U18, "What could make this plan wrong".
- `docs/adr/0005` and `docs/adr/0014` in full; `docs/adr/0007` from line 30; `docs/adr/0012` lines 50 to 68 and grep hits; `docs/adr/0011` lines 70 to 95.
- `docs/ai/guardrail-policy.md` in full; `docs/ai/eval-plan.md` section 8, the canary paragraph and grep hits.
- `docs/requirements`: glossary limits rows, US-C4, US-C8, US-C15, NFR-V6, V7, R4, M1, C2.
- `docs/design/architecture.md` (sequence diagram, "Processing one turn", package table, dependency rule); `state-machines.md` §8; `threat-model.md` T5, T6, T13, T45, T46, T49, T54, T59; `data-model.md` `ai_traces`.
- `AGENTS.md` sections 3, 4, 6; `docs/plans/m3-u0-findings.md` rows naming U4, #227, #199, NFR-V6; `docs/design/notes/m3-u2-sessions.md` lines 195 to 203; grep hits in the U3 note.
- Code: `packages/packs/booking/src/boundary.test.ts` and `names.ts`, `packages/core/src/names.ts`, `apps/ops/src/commands.ts` (PACKS), `tools/names-check.ts`, `Dockerfile`, `.dockerignore`, root `package.json`, `vitest.config.ts`, `tsconfig.json`, `pnpm-workspace.yaml`.

## Findings

### D1. High. Section 4 and row 44: the output-token limit cannot hold what the note says it holds

- **Location:** note lines 170 to 171; `decisions-needed.md:50`.
- **What is wrong:** the note says 1,024 tokens gives "Room for the structure, 20 claims and a reply of the length below in a script that costs several tokens a character". A 1,200-code-point reply at "several tokens a character" is already more than 1,024 tokens, before any structure.
- **The structure's own maxima:** 20 claims with `item` and `value` of up to 200 characters each is up to 8,000 characters. Four tool calls carry `arguments` of unbounded size.
- **Evidence in the repository:** row 41 (`decisions-needed.md:47`) says "a code point is not a token: the same budget costs several times more in Arabic, Urdu, Hindi or Bengali than in English".
- **Effect:** an answer cut at the token limit is broken structure, so `invalid-output`, so the fallback, and two fallbacks hand the session over (guardrail policy line 113 to 114). It falls on exactly the languages the product is for. The limit is unequal by script.
- **Missing case:** no result or code says "the provider stopped at the token limit". It will be reported as `shape` and be indistinguishable from hostile output in U6's traces and U17's measurement.
- **Suggested change:**
  - Derive the token limit from the reply limit with a stated worst-case ratio, or lower the reply and claim maxima until they fit, and show the arithmetic in the note and in row 44.
  - Add a code `truncated` for a stop at the limit.
  - Say in row 44 that the number is unequal by script until U17 measures.

### D2. High. Section 3: `calendar-date` is made a core claim kind; ADR 0012 and the plan give it to the pack

- **Location:** note line 126 ("the core's five").
- **Contradicting sources:**
  - `docs/adr/0012-core-and-pack-boundary.md:53-54`: the core owns "the claim kinds for prices, opening hours, service details and policies"; lines 66 to 67: the booking pack owns "the claim kinds for slot and booking times and for calendar dates".
  - `docs/plans/m3-ai-core.md:377-378`: "the claim checker for the core's kinds (price, opening hours, service details, policies)"; line 320: "dates are the pack's".
  - `docs/design/notes/m3-u3-profile.md:94`: no calendar is given to the model in M3.
  - Row 35 defers US-C4, 14.
- **Effect:** a fifth kind goes into `packages/core/src/names.ts` that no M3 prompt can satisfy and that ADR 0012 says the core must not name.
- **Suggested change:** four core kinds. `calendar-date` is registered by the booking pack in M5.

### D3. High. Section 5 against section 2: the fake's loud failure is swallowed by `bounded`

- **Location:** F1 (line 223) and the `throw` step, against C4 (line 110) and line 102 ("that every client is used through").
- **What is wrong:** F1 says more calls than steps is "A thrown error … a test that did not expect a call fails loudly". C4 says a throw from the inner client becomes `provider-error` with code `threw`, "never an exception to the caller".
- **Effect:** through `bounded`, an unexpected call becomes a provider failure. The turn retries it three times and sends a fallback, and the test passes unless it happens to assert on that.
- **Same defect in production:** a programming error inside an adapter (a `TypeError`) is retried and counted as a provider failure.
- **Suggested change:**
  - The fake records an over-run in a field that `remaining()` or a required `assertDone()` reports, or throws an error class that `bounded` rethrows.
  - Decide whether C4 should rethrow non-provider errors.

### D4. High. Section 6 and row 45: "a way back is a setting" contradicts two documents the note does not name, and opens a way round the eval gate

- **Location:** note lines 244 to 248; `decisions-needed.md:51`.
- **Contradiction, not listed under Departures or in row 45:**
  - `docs/ai/guardrail-policy.md:380`: "Maintainer | Roll a prompt back to an earlier version | A configuration change by pull request, then a deployment (ADR 0011)".
  - `docs/adr/0011-operator-access.md:79-82`: "a rollback is a change to that configuration and a deployment, made by pull request like any other change".
  - Row 45 names only `AGENTS.md` section 6. Both documents need an amendment, and the maintainer should see that the row changes who can change the running prompt and how.
- **Gate bypass:** the eval plan gates on paths (`eval-plan.md:326-327`: a pull request touching `prompts/`, `packages/ai/`, …). A setting read at start is not a path. Nothing says:
  - which version the eval job evaluates;
  - that a deployment may only select a version with a passing eval record;
  - that the setting can only go back. As written it selects any version on disk, forwards included.
- **Old versions and new code:** an old prompt version was written for the structure, flags and claim kinds of its time. `meta.yaml` carries no marker of which output structure it fits. "No eval run" on going back therefore means running an unevaluated combination of prompt, code and model.
- **Merges stay blocked:** `eval-plan.md:327` blocks further merges "until it is fixed or the change is reverted". The setting moves a deployment back; `main` stays blocked, and reverting still needs a pull request with a real-model run. Row 45's "no pull request, no provider, no eval run" is true of one deployment only.
- **Pack fragments are outside it:** the note makes a fragment "a prompt's name and version" (line 29 to 30), fixed in the pack's code. ADR 0014:133 has the pack supply "The name of a prompt" only. Going back on a fragment is therefore a code change and a pull request, which row 45 does not say.
- **Immutability:** nothing stops an edit to an existing version folder, which would make `prompt_version` in `ai_traces` mean two texts.
- **Suggested change:** in row 45 and the note, state:
  - the eval job's version rule;
  - that the setting accepts only versions listed as evaluated, or only versions at or below the default;
  - how fragments go back;
  - the amendments to guardrail policy §10 and ADR 0011 rule 6;
  - a check, or an honest "by review", that version folders do not change.

### D5. High. Section 4: the batch limit bounds one turn's batch and nothing else of the input, and its number and rule are unfair at the edges

- **Location:** note lines 174, 181 to 195.
- **History is unbounded:** the prompt holds "the session's messages" and every completed tool result (`architecture.md`, "Processing one turn", step 2; guardrail policy I6). A 20,000-point message cut to 4,000 this turn is in the history, whole, next turn. Tool results have no size limit. T54 (`threat-model.md:273`: "very long input, a loop of tool calls, very long output") is therefore not closed on the input side.
- **Missing limits:** total input per call, history length, tool-result size. Or a statement that U7 owns them, with the constant from U4.
- **T3 keeps the first 4,000 code points of the newest message.** The request is often at the end. The number sits just under what I recall as the channel's limit on one text (4,096 characters; unverified, and the note rightly refuses to recall it). If that is right, one legitimate maximal message is always cut. Choose the number after U5 reads Meta's page, at or above the channel's limit for one message.
- **T2 is ambiguous:** "as many as fit" does not say whether it stops at the first message that does not fit or skips it and keeps older, smaller ones, leaving a gap the model cannot see. Say which and add a case.
- **The batch can be large:** it is "the customer's messages since the last answered one" (plan line 302), not "a few messages typed within seconds". After a 15-minute `awaiting-retry` it can hold up to the rate limit's worth. The dropped messages are then marked answered though nothing read them, and the customer learns only if the model chooses to say so (T4). A fixed sentence added by code would not depend on the model.
- **T5 against I2:** T5 keeps "a message with no text" in what the model is given. Guardrail policy I2 (line 68) says only text reaches the model.
- **T6:** it covers surrogate pairs only. A cut inside a combining sequence (Devanagari, Arabic marks, emoji joined by ZWJ) is still possible. Say it is accepted or cut at a grapheme boundary.

### D6. Medium. Section 4 and row 44: four rounds of tool calls is not reconciled with the time and money already stated

- **Location:** note line 172; `decisions-needed.md:50`.
- **Time:** row 38 (`decisions-needed.md:44`) and `m3-u2-sessions.md:200-201` give "the worst a turn may take" as three tries of 20 seconds with waits of 1 and 4, about 65 seconds, one model call per turn. With four rounds a turn is up to five model calls, about 325 seconds, so the customer's worst wait under row 38 becomes about 16 minutes, not 205 seconds.
- **Money:** up to 15 paid attempts per turn, each carrying the whole profile (row 41: up to 40,000 code points) and a prompt of up to 20,000. Row 44 gives the per-call numbers and not this product, which is the figure the maintainer needs.
- **Undefined:** "A fifth answer that again asks for tools is a failed call" does not say failed how. It must be a failed output check, not a provider failure (state machines §8).
- **Suggested change:** state the product in row 44, define the fifth-round failure, and correct or cross-reference row 38.

### D7. Medium. Section 1: `packNamed` cannot live in the registry package

- **Location:** note line 24 against B4 (line 55) and R4 (line 40).
- **Contradicting source:** ADR 0014:78 has the registry hold "A map from name to `Pack`, and nothing else"; line 223 to 224, "the file holds nothing but the map"; line 91, only `main.ts` imports it.
- **What is wrong:** `packNamed(registry, name)` takes the registry as an argument and is called by U7's turn code, which B4 forbids from importing the registry package.
- **Related:** R2 and R3 are checks "the registry's test runs". A registry that a U7 or U9 test builds is not checked unless the check is importable.
- **Suggested change:** put `packNamed` and the name check in `packages/pack-interface`.

### D8. Medium. Section 3: cases missing from the output check, and two stated results that are unsafe or unstated

- **A flag twice is `invalid-output` (O4).** A model that writes `emergency` twice loses the customer the emergency text. One bad or unknown flag beside a valid `emergency` does the same. This follows the policy's order (O1 before O2), but the note should say so plainly as a known cost, or treat a repeated valid flag as set. Collapsing a set is not a guess.
- **U+0000 is the real "cannot be stored" case.** PostgreSQL text and `jsonb` refuse it. O9 covers only lone surrogates. Also undecided: other control characters and bidirectional overrides in `reply`.
- **"A text" in O9 is unscoped.** Does it include strings nested in `arguments`?
- **`arguments` is "an object" with no further rule:** no bound on size or depth, no rule for `__proto__` or `constructor` keys inside it (O8 covers names, not nested keys), and no requirement that it be plain data. Since `raw` takes "any value", a `Map`, a `Date`, a class instance, a cyclic object or one with getters passes "is an object".
  - Suggested: readOutput accepts only JSON-plain values, checks own properties only, bounds serialised size, and returns a fresh frozen copy, not the object it was handed.
- **"1 to 200 characters" (line 126)** does not say code points, where section 4 does.
- **No precedence among codes** when an answer has two faults; tests need it.
- **Reply and tool calls together:** what a non-empty `reply` beside non-empty `toolCalls` means is not stated, nor whether flags and claims of an intermediate round count. The structure is U4's. `architecture.md` step 5 says the reply comes "After the last tool result".
- **Tool-call `id`:** say it is for pairing results within the loop only. `architecture.md:359` says "The model's call identifier is never used" for recognising a repeat.
- **Case numbering collides with the policy's.** Section 3's cases are O1 to O10, and the same note uses "O6" and "O7" for the policy's checks (lines 125, 171, 264, 274). Rename the note's cases (for example S1 to S10).
- **Wrong citation:** line 89 cites "guardrail policy, A1" for invalid output not being a provider failure. In the policy A1 is "Call only the tools its tenant's pack registers" (line 82); the rule is O1 (line 97). "A1" is the Gate 2 finding's number.
- **Wrong citation:** line 130 cites "sections 4 and 6" for the seven flags. ADR 0005:121 and ADR 0007:134 name section 11, which is where the list is (policy line 408).

### D9. Medium. Section 2: the wrapper

- **Nothing makes `bounded` unavoidable.** "Every client is used through" it is prose. Suggested: callers accept only a branded type that `bounded` returns, or adapters are not exported unwrapped.
- **`health()` has no timeout value** in section 4 and no case for an inner `health()` that throws. C4 is about `generate`.
- **C3** speaks of a late answer; add a late rejection. Add: the timer is cleared when the inner call answers first, and the abort listener is removed.
- **How time is driven in C2, C3 and C6 is not said.** The plan (line 468 to 470) records one flaky timed test in M2. Inject the timer.
- **A call that times out may still be billed.** `timeout` and `provider-error` carry no token counts, so U6's cost and U12's budget undercount. State it as a known gap.
- **The fixed list of failure codes is not given** beyond `threw`, `shape`, `flag`, `claim`, `tool-call`. U14 and U15 need at least to tell a provider's refusal of content or a malformed request from an outage, since US-C15, 1 retries every provider error.
- **Order of wrappers:** ADR 0005 line 55 has a wrapper that writes the trace (U6). Which is outermost is not said.
- **Concurrency of the fake:** steps are consumed "in order". Two overlapping calls, or a `hang` that has timed out, make the order depend on scheduling. F4 holds for sequential use only; say so.

### D10. Medium. Section 6: the loader and `meta.yaml`

- **`yaml` becomes a runtime dependency.** It is a root `devDependency` today (`package.json:32`) and the image installs with `--prod` (`Dockerfile`). The note does not say so (`AGENTS.md:133`, "Never add a dependency without checking…").
- **YAML cases P4 does not cover:**
  - `version` written as `"1"`, `01`, `1.0`, `1e0` or `0x1`;
  - folder `01` against version 1;
  - duplicate keys; anchors and aliases; a second document in the file; `__proto__` as a key;
  - the types and emptiness of `owner`, `model`, `intended_use`;
  - what `parameters` may hold.
- **`model` is required, but there is no model.** U7 writes the first prompt before U17 evaluates any model (ADR 0005:62, "names the model it was evaluated with"). Allow an explicit "not evaluated" value.
- **`meta.yaml` against configuration:** say that `model` and `parameters` in `meta.yaml` are a record and that configuration decides (`AGENTS.md` §6, "Model name and parameters live in config").
- **`name` is added** to the keys `AGENTS.md:324-325` lists. Harmless, but it is a departure.
- **P3:**
  - "lower-case letters" must say ASCII, as must R2 and P8;
  - unlike R2 it does not require a leading letter;
  - no length limit;
  - a symlinked version folder leaves the root without `..`;
  - a version above the safe integer range.
- **`CHANGELOG.md` is in the layout and never checked.**
- **P7:** say what happens to an unmatched `{{`, to `{{ canary }}` with spaces, and to `}}` alone, which nested JSON examples in a prompt will contain.
- **P8:** where the canary comes from is not said (a per-deployment setting or made at start), nor whose it is.
- **P9 and T4 each have code write a line of instruction.** `AGENTS.md:326-327` says "no prompt strings inline in application code". Those lines are in no prompt version and no trace. Put them in the prompt files or list the departure.

### D11. Medium. The word "slot" will fail the boundary test

- **Location:** note P5, P6, P11; B1.
- **What is wrong:** B1 adds `packages/ai` to the folders scanned for the pack's words. `BOOKING_WORDS` contains `"slot"`, matched as a substring of any non-test line (`packages/packs/booking/src/names.ts`). The note and the eval plan both call the canary placeholder a "slot". An identifier or comment such as `canarySlot` or "the one slot" in `packages/ai` fails the test. So do "capacity" and "horizon".
- **Suggested change:** choose another word now ("placeholder") and say so.
- **Related:** `prompts/` is under neither `apps` nor `packages`, so nothing checks that the core prompt names nothing of bookings.

### D12. Medium. Things ADR 0014 and the surrounding documents assign to U4 that the note omits

- **`AGENTS.md` section 4:** "it is brought up to date in U4" (ADR 0014:306-307). Not in the note.
- **The names check:** the note defines the flags and kinds "once in `packages/core/src/names.ts`". That file's header says `tools/names-check.ts` fails if a document disagrees. The note does not say whether the check is extended, or against which document. The policy lists the flags in prose only. #278 is cited in the plan for this.
- **Documents that say "once #158 sets the number":** guardrail policy I3, A6, O7 and line 107 to 108; `threat-model.md:273` and `:341` ("Open until #158"). The note updates only the glossary.
- **Row 37 is unanswered.** The plan (line 113) says a "no" is cheaper before the unit. The note builds `faq-only` without saying what a "no" would undo.
- **Small differences from ADR 0014:**
  - packs may import `packages/core` as well (ADR 0014:77); the note's table says the interface only;
  - `ops` not importing the registry outside its test is unenforced, since `apps/ops` is outside the scan;
  - B5's "same three rules" cannot hold for `apps/api` and `apps/worker`, which may depend on the registry package.

### D13. Medium. The scan of `prompts/` (NFR-V6)

- **"A run of seven or more digits" is weaker than the policy's own rule.** O5 is "7 or more digits, ignoring spaces and punctuation", with every Unicode digit normalised (policy lines 136, 215). `0300-123-4567` and Arabic-Indic digits pass the note's scan.
- **The transcript rule forbids every worked example.** A line beginning `Customer:` or `Assistant:` is refused, so a synthetic few-shot example cannot be written. That is a constraint on how U7 may write the prompt, decided here without saying so.
- **An email address in `owner` fails the scan.** `AGENTS.md` requires an owner in `meta.yaml`.

### D14. Medium. Decisions made without a row (question 8)

Row 44 lists four numbers. The note also fixes, with effect on a customer or on cost:

- at most 20 claims; a 21st value sends the fallback, and a week's opening hours is already 14 times;
- 200 characters for `item` and `value`;
- the ceilings of 60,000 ms and 4,096 tokens;
- a prompt of up to 20,000 code points, paid on every call;
- a canary of 16 to 64 characters;
- the health timeout, which has no value at all.

Also unrowed:

- the fifth claim kind (D2);
- a repeated flag being invalid (D8);
- the ban on examples (D13);
- the change to how a prompt is rolled back in ADR 0011 and the policy (D4);
- the departure from ADR 0005's "a prompt name and version". It is listed under Departures, but the ADR is still "awaiting maintainer review" and is not amended.

The "Evals" section relies on row 31, which is unanswered. The note says so, which is right.

### D15. Low. Limits and flags in `packages/core`

- **Evidence:** ADR 0014:63-64 and its option D say `packages/core` is "pure rules with no model, prompt or tool in it".
- **What is wrong:** the note puts the model's flags, the claim kinds, the token limit and the retry constants there. Flags in `names.ts` is #278's direction and probably right, but it is a tension the note should name.
- **Side effect:** every later change to a limit touches `packages/core`, which is an eval-gated path.

### D16. Low. Deferring the first prompt and importing the registry nowhere (question 7)

- **Sound, and within the plan.** U7's section (line 353 to 354) owns "The first prompt". The done-when "a prompt is loaded by name and version" is met by tests on written folders. ADR 0014's B4 can be shown on planted lines.
- **Not shown in U4:**
  - that `prompts/` reaches the image. `Dockerfile` has `COPY . .` and `.dockerignore` does not exclude `prompts/`, so it will, but the claim "an earlier one is still in the image" has no test;
  - how `root` is found at run time.
- **Suggested change:** say both are U7's.
- **"No provider's library outside its adapter" is a denylist of names kept in a test.** An unknown SDK or a plain HTTP call passes. It meets the done-when only vacuously today. Say so, or allowlist dependencies per package.

### D17. Low. Over-design (question 9)

Little. Candidates:

- `maxOutputTokens` as a per-request field with a ceiling, when one constant is used everywhere. The timeout as a caller parameter is ADR 0005's; the token field is not.
- The `reply` and `raw` steps overlap; one step taking any value would do.
- C7's second validation of every `ok`. It is cheap, and justified only if D9's branded type is not adopted.

Used by a later M3 unit and therefore not over-design: `health()` (U15), `hang` (C2), the fragment path (U7's test pack), O10 (U9).

### D18. Note. Flag names (question 4)

- **They match the policy.** The seven names match line 408 to 410 and the plan's routing (line 380 to 382).
- **No conflicting name** in `names.ts`, the OpenAPI file, the data model or the state machines.
- **Three coincide with handover reasons:** `sensitive-topic`, `data-request` and `emergency` are spelt exactly as three `HANDOVER_REASONS`, while `asks-for-person` maps to `requested`. That is not a conflict, but a grep for one finds the other. Say so in `names.ts`.
- **If row 29 is a "no",** the four flags routed to U11 have no actor in M3.

## Answers to the nine questions, briefly

1. **Missing or misplaced:** D12 (AGENTS §4, names check, policy and threat-model updates, row 37). Misplaced: `packNamed` (D7), `calendar-date` (D2).
2. **Contradictions:** D2, D3, D4, D5 (T5 against I2), D7, D8 (two citations), D10 (inline instruction lines).
3. **Case tables:** D3, D5, D8, D9, D10, D11, D13.
4. **Flags and kinds:** flags match (D18); kinds should be four (D2).
5. **Limits:** not coherent (D1, D6); the truncation rule is ambiguous and unfair at the edges, and input is otherwise unbounded (D5).
6. **Row 45:** conflicts with guardrail policy §10 and ADR 0011 rule 6; "a setting" is true of one deployment, not of `main` or of fragments, and it opens a way round the gate (D4). The trace columns fit.
7. **Deferral:** sound (D16).
8. **Silent decisions:** D14.
9. **Over-design:** little (D17).

## What I did NOT check

- The bodies of issues #158, #227, #278, #165 and #303. No network, and nothing outside `/tmp/u4design` was read. What #158 asks for is inferred from the policy and the threat model only.
- Token counts in any script. No tokenizer was run; D1 rests on the note's own sentence and row 41.
- WhatsApp's limit on a text. The 4,096 in D5 is from memory and unverified.
- Whether the `yaml` library's defaults reject duplicate keys, aliases or multiple documents. Not run.
- The order of checks (state machines §1) step by step, state machines other than §8, the OpenAPI file beyond a grep for flag and kind names, ADR 0006, ADR 0010, ADR 0012 beyond the lines cited.
- The eval plan outside section 8 and the canary paragraph.
- `docs/requirements/traceability.md` and whether U4 owes it a row.
- Whether existing tests pass. Nothing was executed.
- The earlier design reviews of U2 and U3 for the form of findings.
- Biome or TypeScript configuration effects of the new packages.

---

## Author's response

The note was rewritten (second version, same file). **The rewritten note
has not been reviewed again;** the review of the code checks it.

| Finding | Answer |
| --- | --- |
| D1 output tokens cannot hold the reply | Accepted. The limit is 4,096, from stated arithmetic and one stated assumption that nobody has measured (at most three tokens to a code point); the structure's maxima are lowered and `arguments` is bounded. A stop at the limit is its own code, `truncated`. Row 44 says the number is unequal by script until U17 measures |
| D2 `calendar-date` in the core | Accepted. Four core kinds |
| D3 the fake's loud failure swallowed | Accepted, by the wider change: `bounded` rethrows whatever the inner client throws. A throw is a fault in this repository's code, not the provider's failing; an adapter turns its provider's errors into typed results itself |
| D4 "a way back is a setting" | Accepted: withdrawn. Which version runs is a constant in code, changed by pull request, as ADR 0011 and the policy have it. What row 45 keeps is one folder per version, so that going back is a one-line pull request and a version in a trace means one text; that a version folder is not edited is by review. #227's point, that going back waits on the provider through the eval gate, stays open and is said so |
| D5 input otherwise unbounded; the rule's edges | Accepted. The rule now stops at the first message that does not fit, so no gap; takes texts only; says the cut is in code points and can fall inside a combining sequence. The number is 8,000, provisional until U5 reads the channel's limit. What was left out is given to the model as data, with no sentence written in code; a fixed sentence to the customer is put to the maintainer in row 44. History, tool results and the whole input are U7's and U12's, and T54 stays partly open: said in the note |
| D6 rounds against time and money | Accepted. Row 44 gives the product (up to 5 calls a reply, 15 attempts with retries, about 5 minutes) and says row 38's 65 seconds assumed one call. A fifth round is a failed output check. How the turn's loop and the retries compose is U7's and U15's |
| D7 `packNamed` in the registry | Accepted: it and the name check are in `packages/pack-interface` |
| D8 the output check | Accepted, all: a repeated flag is the flag; an unknown flag is invalid and its cost is stated; control characters and half pairs refused in every text, nested ones included; `arguments` is plain data, bounded in size and depth; lengths in code points; a precedence; a round asks for tools or answers, not both; the `id` pairs results only; cases renamed S; both citations corrected |
| D9 the wrapper | Accepted. An adapter is a different type from a client, and `bounded` is the only way from one to the other; the timer is injected; a health timeout; late answers and rejections; the codes; the trace goes outside; the fake is for calls one after another. A timed-out call that was billed is a stated gap |
| D10 the loader | Accepted. `yaml` becomes a dependency of `packages/ai` (recorded in the pull request); the cases of YAML; `not-evaluated`; `meta.yaml` is a record; ASCII, a leading letter, lengths, links out of the root; the changelog checked; braces; the canary is the caller's argument and its source is U7's; no line of instruction is written by code |
| D11 the word the boundary test knows | Accepted: "placeholder". That nothing scans `prompts/` for the pack's words is U7's, with the first prompt |
| D12 omitted work | Accepted: `AGENTS.md` section 4; the flags and kinds as a table in the guardrail policy, compared by the names check; the policy's and the threat model's lines on #158; what a no to row 37 undoes; the three small differences |
| D13 the scan | Accepted. Digits as the policy counts them; the transcript rule is dropped, since it cannot tell a written example from a real conversation; an owner is a name, not an address |
| D14 decisions without a row | Accepted: row 44 lists every number; row 45 is rewritten. The departure from ADR 0005 is an amendment to it in this pull request |
| D15 limits and flags in `packages/core` | Named in the note. They are there because the glossary's numbers and the shared names already are |
| D16 deferral | The two things not shown are listed as U7's. The provider test is said to be a list of names |
| D17 over-design | One step for any answer; the second check is gone with D9. `maxOutputTokens` stays a field: an adapter needs it on each call |
| D18 flag names | The coincidence with handover reasons is written in `names.ts` |
