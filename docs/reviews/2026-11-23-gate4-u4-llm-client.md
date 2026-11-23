# Gate 4 code review: M3 unit U4 (model client, scripted adapter, output check, call limits, prompt loader, pack packages)

Branch `feat/303-m3-u4-llm-client`, commit `6220bd6`, reviewed in `/tmp/u4review`. Reviewer did not write the code.

**Verdict:** no High finding. The code does what the rewritten note says on every path a real model can reach. There are three Medium findings (G1 to G3), all about guards that are weaker than the documents claim. The rest are Low or Note. The author's response table to the design review was carried out, with two exceptions (G15, G17).

## What I ran, and the real results

| Command | Result |
| --- | --- |
| `cd /tmp/u4review && pwd`; `git show --stat HEAD` | `/tmp/u4review`; 45 files, +3993 −188 |
| `pg_isready -h 127.0.0.1 -p 5432` | accepting connections |
| `pnpm vitest run packages/ai packages/pack-interface packages/packs tools/names-check.test.ts` | exit 0; 9 files, 113 tests passed. Same result when rerun after all mutants |
| `make check` (once) | **exit 0**; vitest reported 33 files, **1116 tests passed**; lint, typecheck, docs, selftest, commitlint and git identity all ok |
| `pnpm exec tsc --noEmit -p .` with a temporary probe file `packages/ai/src/zz-typeprobe.ts` (deleted) | 4 expected errors: an adapter, a hand-made object, and an object with its own symbol are all refused where `LlmClient` is wanted; a request without `timeoutMs` is refused. Two things compiled without error: see G2 and G12 |
| Probe scripts run with `node` from `/tmp/u4probe` (outside the repo, deleted) | About 45 hostile values into `readOutput`; 20 odd adapters into `bounded`; about 95 prompt folders, links and YAML files into `loadPrompt`; 41 planted lines against the three boundary regexes; 26 lines against the provider test's `imported()`; 27 strings into `contactDetailsIn` |
| Fuzz: 300,000 random JSON values through `JSON.parse` into `readOutput` | 0 throws; 4,919 accepted, each deep-frozen and equal to the input with flags de-duplicated; the rest refused (shape 263,113, flag 19,674, claim 9,836, tool-call 2,458) |
| 133 mutants written, 130 applied, each restored with `git checkout` | 106 killed, 24 survived (5 of them equivalent). Table below |

Final `git status --short` is empty. The JSON reporter created `.vitest/` once inside the repo; I removed it.

## Mutants

Three mutants (M79, M80, M90) did not apply because my search pattern was wrong; they were redone as M116 to M118. S = survived, K = killed.

| # | File | Change | Result | Killed by |
| --- | --- | --- | --- | --- |
| M1 | output.ts | lone surrogates allowed | K | output.test S5 |
| M2 | output.ts | `\r` exempted too | K | S5 |
| M3 | output.ts | symbol-key check skipped | K | S4 |
| M4 | output.ts | non-enumerable properties accepted | K | S4 |
| M5 | output.ts | getters accepted | K | S4, S10 |
| M6 | output.ts | null prototype refused | K | S4 |
| M7 | output.ts | `exactly` without the length check | K | S3, bounded C2 |
| M8 | output.ts | `prototype` not a refused key | K | S10 |
| M9 | output.ts | depth `>` to `>=` | K | "each limit is met exactly" |
| M10 | output.ts | NaN and Infinity allowed | K | S10 |
| M11 | output.ts | copied arrays not frozen | K | S1 |
| **M12** | output.ts | arguments copy has `Object.prototype`, not null | **S** | |
| **M13** | output.ts | hole check on `toolCalls` removed | **S** | |
| **M14** | output.ts | hole check on `claims` removed | **S** | |
| M15 | output.ts | flags not de-duplicated | K | S7 |
| M16 | output.ts | claims `>` to `>=` | K | limits |
| M17 | output.ts | claim value upper bound dropped | K | S8 |
| M18 | output.ts | lengths in UTF-16 units | K | limits |
| M19 | output.ts | claims allowed beside tool calls | K | S11 |
| M20 | output.ts | tool-call count `>=` | K | limits |
| M21 | output.ts | duplicate id allowed | K | S10 |
| M22 | output.ts | arguments size `>=` | K | limits |
| **M23** | output.ts | tool-call object not frozen | **S** | |
| **M24** | output.ts | `toolCalls` list not frozen | **S** | |
| M25 | output.ts | the input's claim object returned | K | S1 |
| M26 | output.ts | keys of arguments not checked as text | K | S5 |
| **M27** | output.ts | claim count checked before flags (precedence broken) | **S** | |
| M28 | output.ts | id length bound dropped | K | S10 |
| M29 | bounded.ts | timer not cleared | K | C1, C5 |
| M30 | bounded.ts | no abort at timeout | K | C3 |
| M31 | bounded.ts | rejection path skips `settle` | K | C5 |
| M32 | bounded.ts | adapter throw becomes a result | K | C5, F1 |
| M33 | bounded.ts | sync throw skips `settle` | K | C5 |
| M34 | bounded.ts | truncated only when `=== true` | K | "breaks its own contract" |
| M35 | bounded.ts | truncated never reported | K | C7 |
| M36 | bounded.ts | ceiling exclusive | K | C6 |
| M37 | bounded.ts | 0 allowed | K | C6 |
| M38 | bounded.ts | tokens checked against the time ceiling | K | C6 |
| M39 | bounded.ts | provider code not checked against the list | K | contract |
| M40 | bounded.ts | negative token counts | K | contract |
| M41 | bounded.ts | empty model name | K | contract |
| M42 | bounded.ts | health uses 60 s | K | C8 |
| M43 | bounded.ts | every health failure reported as timeout | K | F5 |
| M44 | bounded.ts | fixed 20 s, not the request's | K | "the time allowed is the request's own" |
| M45 | bounded.ts | wrong tool names given to the check | K | "what the request offers decides" |
| M46 | bounded.ts | usage zeroed on invalid output | K | C2 |
| M47 | bounded.ts | timeout callback does not set `over` | S (equivalent: a promise settles once) | |
| M48 | fake.ts | over-run returns a provider error | K | F1 |
| M49 | fake.ts | consumes the test's own array | K | F4 |
| M50 | fake.ts | calls not recorded | K | C3, F1, F3 |
| **M51** | fake.ts | `hang` never resolves on abort | **S** | |
| M52 | fake.ts | truncated step says `false` | K | C7 |
| **M53** | fake.ts | `hang` then `reject` does not reject | **S** | |
| M54 | batch.ts | fit `>` to `>=` | K | T1, T2 and 3 more |
| M55 | batch.ts | `continue` in place of `break` (gap) | K | T2 no-gap |
| M56 | batch.ts | cut in UTF-16 units | K | T6 |
| M57 | batch.ts | newest `>=` | K | T1, T5 |
| M58 | batch.ts | `leftOut` off by one | K | T3, T6 |
| M59 | batch.ts | keeps the end | K | T3, T6 |
| M60 | batch.ts | limit validation dropped | K | last batch test |
| M61 | core/model.ts | `BATCH_TEXT_MAX` 4,000 | K | batch T1 |
| **M62** | core/model.ts | `MODEL_OUTPUT_TOKENS_MAX` 1,024 | **S** | |
| **M63** | core/model.ts | `CLAIMS_MAX` 20 | **S** | |
| **M64** | core/model.ts | `REPLY_MAX` 4,000 | **S** | |
| **M65** | core/model.ts | `TOOL_ROUNDS_MAX` 40 | **S** | |
| **M66** | core/model.ts | timeout ceiling 600,000 | **S** | |
| M67 | core/names.ts | a flag renamed in code only | K | names-check.test (23 tests) |
| M68 | core/names.ts | fifth core claim kind in code only | K | names-check.test |
| M69 | prompts.ts | link check dropped | K | P4 |
| **M70** | prompts.ts | `startsWith(home)` without the separator | **S** | |
| **M71** | prompts.ts | root not resolved through links | **S** | |
| M72 | prompts.ts | name allows a dot | K | P3 |
| M73 | prompts.ts | name of 41 | K | P3 |
| M74 | prompts.ts | version up to 99,999 | K | P3 |
| **M75** | prompts.ts | `uniqueKeys: false` | **S** (top level still caught by the key count; a repeat inside `parameters` is not) | |
| M76 | prompts.ts | `merge: true` | S (equivalent: `<<` is refused as a key either way) | |
| M77 | prompts.ts | anchors allowed | K | P5 |
| M78 | prompts.ts | aliases allowed | S (equivalent: an alias needs an anchor) | |
| M81 | prompts.ts | meta name not compared | K | P5 |
| M82 | prompts.ts | owner may be an address | K | P5 |
| M83 | prompts.ts | extra key allowed | K | P5 |
| M84 | prompts.ts | `## 10` satisfies version 1 | K | P6 |
| M85 | prompts.ts | changelog not required | K | P6 |
| M86 | prompts.ts | length `>=` | K | P7 |
| M87 | prompts.ts | control characters allowed | K | P7 |
| M88 | prompts.ts | closing braces not counted | K | P10 |
| M89 | prompts.ts | non-overlapping brace count | K | P10 |
| M91 | prompts.ts | UTF-8 decode not fatal | K | P7 |
| M92 | prompts.ts | canary of 8 | K | P11 |
| M93 | prompts.ts | two placeholders allowed | K | P9 |
| M94 | prompts.ts | fragment placeholder allowed | K | P14 |
| M95 | prompts.ts | one newline between core and fragment | K | P12 |
| M96 | prompts.ts | `instructions` keeps the canary | K | P8, P12 |
| M97 | prompts.ts | scan needs 8 digits | K | scan test |
| M98 | prompts.ts | scan sees ASCII digits only | K | scan test |
| M99 | prompts.ts | scan ignores emails | K | scan test |
| M100 | prompts.ts | any parameter value | K | P5 |
| M101 | prompts.ts | `intended_use` up to 5,000 | K | P5 |
| M102 | prompts.ts | two documents allowed | K | P5 |
| M103 | pack-interface | `packNamed` uses `in` | K | R5 |
| M104 | pack-interface | `registry` not reserved | K | R3 |
| M105 | pack-interface | name of 41 | K | R2 |
| M106 | pack-interface | key and name mismatch not reported | K | "a set is sound" |
| M107 | packs/registry | `faq-only` filed under `faq` | K | R1 |
| M108 | packs/faq-only | named `faq` | K | R1 |
| M109 | packs/booking | gains a fragment | K | R1 |
| M110 | ai/index.ts | imports the registry by path | K | B4 |
| M111 | ai/index.ts | imports a pack by path | K | B3 and the word scan |
| M112 | core/index.ts | imports the interface | K | B2 |
| M113 | ai/batch.ts | comment containing "slot" | K | boundary word scan |
| M114 | pack-interface | comment containing "appointment" | K | boundary word scan |
| **M115** | ai/types.ts | brand removed from `LlmClient` | **S** (tests; I did not rerun `tsc`) | |
| M116 | prompts.ts | quoted version allowed | K | P5 version |
| M117 | prompts.ts | digit pattern dropped | K | P5 version |
| M118 | prompts.ts | byte-order mark allowed | K | P7 |
| M119 | prompts.ts | control characters in meta texts | K | P5 |
| M120 | prompts.ts | whitespace-only prompt accepted | K | P7 |
| M121 | prompts.ts | email scan reads the undated text | S (equivalent: a date holds no `@`) | |
| **M122** | prompts.ts | a tab between digits not ignored | **S** | |
| M123 | prompts.ts | version below 1 | K | P3 |
| M124 | prompts.ts | `prompts` lists only the core | K | P12 |
| M125 | names-check.ts | flags comparison neutralised | K | names-check.test |
| M126 | names-check.ts | claim-kind comparison neutralised | K | names-check.test |
| M127 | boundary.test.ts | `A_PACK` loses the interface lookahead | K | B5 |
| M128 | boundary.test.ts | `A_PACK` loses the registry lookahead | K | B5 |
| **M129** | boundary.test.ts | `MAY_IMPORT_REGISTRY` gains a third file | **S** | |
| **M130** | boundary.test.ts | `KNOWS_NO_PACK` loses `packages/db` | **S** | |
| M131 | ai/package.json | depends on a pack | K | B3 |
| M132 | ai/package.json | depends on the registry | K | B4 |
| M133 | core/package.json | `optionalDependencies: openai` | K | providers.test |

## Findings

### G1. Medium. No test or check ties the limit constants to the glossary, the note, the policy or row 44
- **Where:** `packages/core/src/model.ts:24-58`.
- **What:** five constants were changed one at a time with nothing failing (M62 to M66): `MODEL_OUTPUT_TOKENS_MAX`, `CLAIMS_MAX`, `REPLY_MAX`, `TOOL_ROUNDS_MAX`, `MODEL_CALL_TIMEOUT_CEILING_MS`.
  - `REPLY_MAX`, `TOOL_ROUNDS_MAX`, `MODEL_CALL_ATTEMPTS` and `MODEL_RETRY_WAITS_MS` are referenced by no file but `model.ts`.
  - The note says each limit is "a constant in `packages/core` and a row of the glossary". `tools/names-check.ts` compares names only, so these are numbers a customer's fallback and the cost per call depend on, with no guard.
- **State today:** I compared them by hand and they agree across the note's section 4, `model.ts`, the glossary, the policy's I3, A6 and O7, and row 44.
- **Fix:** a test in `packages/core` that pins every value literally, or extend the names check to read the glossary rows.

### G2. Medium. An `LlmClient` can be made without `bounded` and without a cast, and nothing tests the brand
- **Where:** `packages/ai/src/types.ts:150-161`.
- **Reproduction:** `turn({ ...realClient, generate: async () => ({ kind: "timeout" }) })` compiles. The spread carries the brand, and the replaced `generate` is unbounded and unchecked.
- **Why it matters:** this is exactly the form the U6 trace wrapper will take ("goes outside `bounded`"), so the first real wrapper will either spread or cast. The note's "the bound and the check cannot be left out by forgetting them" is then true only of adapters.
- **No test:** M115 removed the brand and all 113 tests passed. There is no `@ts-expect-error` line anywhere under `packages/ai`.
- **Fix:**
  - Add a type test: `// @ts-expect-error` on passing an adapter and on passing a literal.
  - Decide now how U6 wraps: for example `bounded(adapter, timers, { observe })`, or a second exported function that takes an `LlmClient` and returns one, so that no caller builds the object.

### G3. Medium. The provider-library test does not read "every source file of the workspace"
- **Where:** `packages/ai/src/providers.test.ts:83`; claimed in note section 6 and the ADR 0005 amendment.
- **What:** the walk is `apps`, `packages` and `tools`. Root files (`vitest.config.ts`, `commitlint.config.js`) are not read.
- **Why it matters:** `AGENTS.md` section 4 promises `evals/` and `infra/`. `evals/` is the likeliest place for a provider SDK import, and it will not be walked. The manifest check also knows only the root, `apps/*`, `packages/*` and `packages/packs/*`.
- **Evasions the note already admits** (a list of names): unknown packages such as `@openai/agents`, `@azure/ai-inference`, `@openrouter/sdk`, `node-llama-cpp`, `litellm` pass.
- **Evasions not stated:** `import(/* c */ "openai")` and `import x from "../../node_modules/openai/index.mjs"` both pass.
- **Fix:** walk every top-level folder except a pinned exclusion list, as the boundary test does with `NOT_CORE`. Or correct the sentence in the note and the ADR.

### G4. Low. `readOutput` throws, or reads a value twice, on values that are not JSON data
- **Where:** `packages/ai/src/output.ts:32-46` (`plainObject`), `138-167`, `197-210`.
- **Reproductions:**
  - A `Proxy` with a throwing `getPrototypeOf` or `ownKeys`, a revoked proxy, or a proxy array as `claims`: throws `Error` or `TypeError`, not `shape`.
  - `claims` whose index 0 is an accessor returning a valid claim on the first read and `{item: {…}}` on the second: `TypeError: text is not iterable`.
  - `flags` whose index 0 returns `"emergency"` then `"asks-to-stop"`: accepted, and the output holds `asks-to-stop`, a value the shape pass never saw.
  - `arguments: { l: arr }` where `arr = [1,2]; arr.extra = "x\u0000"`: accepted, with `extra` silently dropped.
  - `[1, , 3]` with `Array.prototype[1] = 2`: accepted as `[1,2,3]`.
- **Cause:** arrays are never checked for plainness; only objects are. The list is read once for shape and again for content.
- **Reach:** none from `JSON.parse` (fuzz: 0 throws in 300,000). Through `bounded` a throw becomes a rejection, which C5 treats as a fault of the adapter. But S4 says "not plain … → `shape`", and the header says "nothing is repaired".
- **Fix:** one function that copies an array only if it has `Array.prototype`, only index keys and data properties, used for all four lists; run every later check on the copies. Wrap the body in `try … catch → shape`.

### G5. Low. Dead or untested lines in `readOutput`
- **Hole checks (M13, M14):** `output.ts:168-175`. A hole is already caught in the loops above (`undefined` is not a plain object or a string). What these lines actually catch is an extra non-index property on a list, which no test plants.
- **Freezing (M23, M24):** the `toolCalls` list and each call object are not asserted frozen. S1 checks claims, flags and arguments only.
- **Precedence (M27):** S12 has no case of "more than 30 claims and an unknown flag", so a count check moved first is not seen.
- **Null prototype (M12):** the null prototype of the copied arguments is asserted nowhere. A consumer calling `args.hasOwnProperty(...)` on the copy will throw; say so in the `ToolCall` type's comment or test it.

### G6. Low. `bounded` passes the adapter's `model` string through unchecked, and `health()` is looser than `generate()`
- **Where:** `packages/ai/src/bounded.ts:48-60`, `166-180`.
- **`model`:** `model: "customer said: hello\u0000"` comes back in an `invalid-output` result as given. The note says a failure carries "only a code", and U+0000 is the character the note singles out as unstorable (U6 will write this to `ai_traces`). Fix: the same `fine()` test and a length bound, else `AdapterFault`.
- **`health()` returning `null`:** raw `TypeError: Cannot read properties of null`, not `AdapterFault`.
- **`health()` returning `{}`, `{ok: "yes"}` or `{ok: false, failure: "the provider said X"}`:** silently `{ok: false, failure: "provider-error"}`. `generate` throws `AdapterFault` for the same class of mistake.
- **A function that returns a non-promise:** `TypeError: pending.then is not a function`.
- **Request shape:** `tools` and `claimKinds` are not validated before the call. With `tools: undefined` the adapter is called (and paid) and the `TypeError` comes after the answer. A getter on `timeoutMs` is read twice (validated at 50, used at 1e9). Only reachable with casts.
- **Null request:** `generate(null)` throws synchronously, where C6 rejects.

### G7. Low. The fake can leave a test silently wrong in four ways
- **Where:** `packages/ai/src/fake.ts`.
- **Over-run looks like a completed script:** `remaining()` is 0 both when the script was consumed exactly and when it was over-run. The only signal is the thrown `FakeScriptOver`. Code under test that catches errors broadly (a job runner, U7's turn) hides it. Fix: an `assertDone()` that also fails when `calls.length` exceeds the script, or an `overran` counter.
- **Health over-run is `ok`:** an empty or exhausted health list answers `{ok: true}` (F5 by design). A test of degraded mode that makes one call too many passes.
- **`calls` holds the caller's objects:** mutating `request.messages` after the call changes `calls[0]` (reproduced: length 1 became 2). Fix: `structuredClone`.
- **`hang` with `then: "answer"` returns a provider error, not an answer.** C4's title says "an answer or a rejection that comes after the timeout". M51 and M53 survived: the test does not show that the adapter settled late at all. Fix: return a real answer, and assert in C4 that the adapter's promise settled.
- **Usage defaults to zero tokens.** Fine for now; U6 cost tests must state usage.

### G8. Low. Loader: three YAML forms pass that P5 says are refused
- **Where:** `packages/ai/src/prompts.ts:73-126`.
- **Version with a tag:** `version: !!str 1` and `version: !!float 1` are accepted. The check reads `source` and `type`, not the tag or the value. P5 refuses `"1"`.
- **Unknown tags:** `owner: !!js/function 'function(){}'` and `owner: !custom x` are accepted as text. `document.warnings` is ignored. Harmless today, since nothing is executed.
- **Fix for both:** refuse any node whose `tag` was written explicitly, or refuse when `document.warnings.length > 0`.
- **Block scalars:** `intended_use: >` or `|-` over two lines is refused with "has a control character" (the line break). Only `>-` works. The message misleads. Allow `\n` there or say "one line".
- **Not tested:** a repeated key inside `parameters` (M75).
- **No size bound before parsing:** `meta.yaml` and `CHANGELOG.md` are read whole. A 5 MB file and a 20,000-deep flow list were both refused quickly, so this is a note.

### G9. Low. Loader: links and the changelog
- **Links inside the root are followed.**
  - `reply/1/prompt.md` linked to `other/1/prompt.md` loads the other prompt's text under the identity `reply` v1.
  - `real/1 → real/7` loads version 7 as version 1.
  - P4 promises only "outside root", so the code meets the note. But row 45's "a version written in a trace means one text" then rests on review alone.
  - Fix: require the real path to equal `home/name/version/file`, or refuse any symbolic link under `prompts/`.
- **Two link cases have no test:** the sibling-prefix case (M70; `prompts-evil/` beside `prompts/`) and a linked root (M71). Both behave correctly today; I checked by hand.
- **Changelog heading:** `## 1.5` and `## 1abc` satisfy version 1, as does `## 1` inside a code fence. Fix: `^## ${version}(\s|$)`.
- **The scan skips symbolic links:** `prompts.test.ts:481` uses `entry.isFile()`, which is false for a link, so a linked file under `prompts/` is never scanned.

### G10. Low. `contactDetailsIn` will refuse ordinary prompt text
- **Where:** `packages/ai/src/prompts.ts:309-322`.
- **Reproductions:**
  - `"10:30-11:30"` is flagged (8 digits). So is any `09:00-17:00` or `09:00–17:00`.
  - Two prices, `150.00, 200.00`, are flagged.
  - `1,200,000` and `version 1.2.3.4.5.6.7` are flagged.
- **Why it matters:** the "leaves alone" test covers `09:00 to 17:30` and one price only. U7's reply prompt will hold opening-hours and price examples and will hit this on day one. It fails safe, but the cost should be known.
- **Misses** (the note claims only "something like"):
  - digits split by a newline;
  - a zero-width space inside a number (the second half is still found if it is 7 or more digits);
  - `a＠b.co` and `a [at] b.co`.
- **Tab between digits:** untested (M122).
- **Fix:** exempt `HH:MM` pairs and decimal amounts explicitly, with tests.

### G11. Low. Boundary regexes: lines that reach a pack and are seen only as "the registry" or "the interface"
- **Where:** `packages/packs/booking/src/boundary.test.ts:171-187`.
- **Seen as the registry only**, so allowed in the two `main.ts` files and never counted as a pack:
  - `"../packs/registry/../booking/src/index.ts"`
  - `"@polyglot-sales-agent/packs-registry/node_modules/@polyglot-sales-agent/pack-booking"`
- **Seen as the interface only:** `"@polyglot-sales-agent/pack-interface/../pack-booking"`.
- **Seen by no rule:**
  - `"@polyglot-sales-agent/" + "pack-booking"`;
  - a template literal with the name in a variable;
  - `"@polyglot-sales-agent/pack-booking"`;
  - Windows `..\\packs\\booking`;
  - `"../Packs/booking/…"` (resolves on a case-insensitive disk);
  - `"../packs"`;
  - a package named `packs-registry-two`.
- **Wrongly caught as a pack** (coarse but safe): any string or comment holding `/packs/`, for example `"see docs/packs/overview.md"`, `"/packs/"`, `// see '../packs/booking'`.
- **Seen correctly:** `require`, re-exports (`export * from`), template literals with the full name, an import split over two lines.
- **Allow-lists are not pinned** as `CORE` and `NOT_CORE` are: `MAY_IMPORT_REGISTRY`, `KNOWS_NO_PACK` and `MAY_DEPEND_ON_REGISTRY` can be widened or shortened with nothing failing (M129, M130).
- **`dependencies()` reads two of four dependency kinds:** not `optionalDependencies` or `peerDependencies`, which the providers test does read.
- **Package rules are otherwise right:** B3 (`/pack-` except the interface), B2 (`/packs?-`), B4 (`/packs-registry` only for api and worker). `packages/packs/booking/package.json` depends on the interface only.
- **Fix:** refuse any import string containing `/../` after a package name or after `packs/registry`; pin the three lists.

### G12. Low. `LoadedPrompt` is a plain interface, so `assemblePrompt` accepts text no file holds
- **Where:** `packages/ai/src/prompts.ts:30-34`, `272`.
- **Reproduction:** a hand-written `{ name, version, text: "{{user_name}} {{canary}}", meta }` type-checks and assembles. The brace rule, the length limit and the control-character rule live only in `loadPrompt`.
- **Why it matters:** "no prompt strings inline in application code" (`AGENTS.md` section 6) is therefore not enforced by the type, unlike the client.
- **Fix:** brand `LoadedPrompt` the way `LlmClient` is, or re-run the text rules in `assemblePrompt`.
- **Also unchecked:** a prompt whose text already contains the canary's value (`"aaaaaaaaaaaaaaaa {{canary}}"` with that canary assembles to two copies).
- **P12 wording:** with files that end in a newline (every file a formatter touches), the result has two empty lines between core and fragment, not "an empty line". It is deterministic.

### G13. Low. An invisible character in the source, and no line-ending rule for `prompts/`
- **Byte-order mark literal:** `packages/ai/src/prompts.ts:57` is `text.startsWith("<U+FEFF>")` with a raw byte-order mark inside the string literal (bytes `EF BB BF`). An editor or tool that strips it turns the test into `startsWith("")`, which refuses every prompt. Write `"﻿"`.
- **Line endings:** the repository has no `.gitattributes`. `prompt.md` with CRLF is refused ("a tab and a carriage return are two"), so a Windows checkout with `core.autocrlf` loads no prompt. `meta.yaml` and `CHANGELOG.md` with CRLF load. Add `prompts/** text eol=lf` with the first prompt (U7).

### G14. Low. Documents that disagree with themselves or the code
- **Threat model T54** (`docs/design/threat-model.md:273`): the mitigation column still says "limits per call do not [exist]"; the last column says "Partly closed".
- **`AGENTS.md`:** the section 4 tree now says "one folder per prompt and per version". Section 6 still says `prompts/<name>/` with `meta.yaml (version, owner, model, parameters, intended use)`. Row 45 is not answered, so section 4 was changed ahead of the decision and the file contradicts itself.
- **ADR 0014 line 133** still has a fragment as "the name of a prompt". The note lists the departure; ADR 0005 got an amendment and 0014 did not.
- **Unused dependency:** `packages/ai/package.json` depends on `@polyglot-sales-agent/pack-interface`, and no file in `packages/ai/src` imports it. The note says of the registry that "an import nothing uses would be decoration"; the same applies here.
- **B4 against `apps/ops`:** the note says "only `apps/api` and `apps/worker` may depend on it". `apps/ops` now has the registry as a devDependency. The boundary test does not look at `apps/ops`; R6 implies it. Say so in B4.
- **R6's source check is shallow:** it reads only the files directly in `apps/ops/src` (`readdirSync` without `recursive`).
- **The channel's limit:** the note says it "has not been read". `apps/mock-whatsapp/src/server.test.ts:157` already encodes "a text over 4096 characters" as refused. 8,000 is above that, so T3 is consistent with the repository's own mock. The note could say so.

### G15. Low. Response D14: "row 44 lists every number" is not so
- **Not in row 44:** 100 code points for a claim's item and value; 2,000 code points and 5 levels for arguments; 100 for a tool-call id; 16 to 64 for the canary; 9,999 for a version; 100 and 500 for the meta texts.
- **Where they are instead:** the first three are in the glossary. The id's 100 is in neither the glossary nor the note's section 4 table (only section 3). The canary and version limits are in the note's P cases only.

### G16. Note. Line breaks and tabs in an answer
- `reply: "a\r\nb"` and `reply: "a\tb"` are `shape` (tested, and as the note says).
- A model that writes a tab in a list or CRLF loses the customer the whole answer, and two fallbacks hand the session over.
- This is a stated rule, not a defect. It is the same kind of "known cost" as the unknown flag and deserves the same sentence in section 3, and a count in U17.
- Accepted as text: U+2028, U+202E, U+FEFF and U+FFFE (left to U9, as stated).
- In a prompt file, accepted: a byte-order mark in mid-file, bidirectional overrides, a zero-width space between two braces (`{<ZWSP>{name}<ZWSP>}`), and full-width braces. Nothing fills them, so the T13 rule holds; a reviewer cannot see them.

### G17. Note. Response D1: the worked arithmetic leaves out a round of tools
- Four calls of 2,000 code points of arguments are 8,000 code points, which is 24,000 tokens at the note's own three tokens a code point, against a limit of 4,096.
- The per-call maxima cannot all be met in one answer in any script at that price. The result is `truncated`, so it fails safe.
- The note says this for claims and not for tool calls.

### G18. Note. Small things
- `-0` in arguments is kept as `-0` in the copy and measured as `0` by `JSON.stringify`.
- Two ids that differ only by Unicode normalisation (`é` and `e` + U+0301) are two ids.
- `flags` has no maximum count (2,000,000 copies of `emergency` are accepted as one flag); it is bounded only by the output tokens.
- `readOutput` with `claimKinds` passed as a string matches substrings (`"ric"` in `"price"`). The type forbids it.
- A parameter key `constructor` is accepted in `meta.yaml` and becomes an own property; harmless.
- `loadPrompt` with version `1.0000000000000001` is version 1 (the same number in JavaScript).

## Checked and found sound

- **`readOutput` on anything `JSON.parse` can produce:** never throws; never returns the input object; output deep-frozen. Prototype pollution is closed: `__proto__`, `constructor` and `prototype` are refused at any depth, including an own `__proto__` made by `defineProperty`, and the copy has a null prototype. Code precedence is as S12 says. "Tools or a reply, not both" holds, including a reply of one space. Lone surrogates and control characters are refused in every text, keys of arguments included. Duplicate ids are refused. Depth 5 passes and 6 fails, for arrays and objects alike. Sizes are in code points.
- **`bounded`:**
  - timer cleared on every path (answer, rejection, synchronous throw, `AdapterFault`, `RangeError`);
  - no double settle;
  - late answer and late rejection dropped with no unhandled rejection, checked with real timers too;
  - signal aborted at the timeout;
  - `RangeError` raised before the adapter is called, for every bad value tried;
  - truncated wins over a well-formed value, and "not said" counts as truncated;
  - a provider error with an extra `message` field comes back as the code only;
  - the same error object is rethrown.
- **Types:** an adapter, a literal object and an object with its own symbol are all refused where `LlmClient` is wanted. `LlmRequest` requires both bounds and has no contact field.
- **`boundBatch`:** T1 to T6 hold, including the limit met exactly, an older small message not kept past a gap, an empty text, and a cut never inside a pair. All seven mutants killed.
- **Loader:**
  - `..`, upper case, a trailing newline and an object with `toString` as a name are refused before the disk is read;
  - links out of the root are refused for the file, the folder, `meta.yaml` and `CHANGELOG.md`;
  - the sibling-prefix case and a linked root are both right;
  - a directory in place of a file is refused;
  - duplicate keys (quoted or not), anchors, aliases, `<<`, a second document, an empty or comment-only file, `%YAML 1.1` with `yes`, a `__proto__` key and a byte-order mark are refused;
  - `01`, `1.0`, `1e0`, `0x1`, `+1` and `1_0` are refused as a version;
  - the brace rule holds, including a third brace on either side and `{{Canary}}`;
  - 20,000 passes and 20,001 fails;
  - no error message carries file contents (tried with a link to `/etc/passwd`).
- **`assemblePrompt`:** the canary is `[A-Za-z0-9]{16,64}` only, so it cannot add a line or a brace. A fragment with a placeholder and a core with 0 or 2 are refused. `instructions` is the text without the canary.
- **Names check:** both new comparisons fail for a rename, an addition and a missing table (M67, M68, M125, M126).
- **Booking words:** no hit in `packages/ai` or `packages/pack-interface`, and the scan covers both (M113 and M114 killed; `CORE` is pinned to eight folders).
- **Registry:** exactly two packs, key equals name. `packNamed` returns `undefined` for `__proto__`, `constructor` and `toString`. `core`, `interface` and `registry` are reserved names.
- **Design-review responses D1 to D18:** carried out in the note and the code, except as G15 and G17 say. Specifically verified:
  - four core claim kinds;
  - `truncated` code;
  - rethrow (C5);
  - row 45 withdrawn to folders only;
  - the no-gap rule;
  - `packNamed` in the interface package;
  - S-numbering;
  - an injected timer;
  - "placeholder" as the word;
  - a policy table compared by the names check;
  - the transcript rule dropped;
  - the ADR 0005 amendment;
  - the handover-reason note in `names.ts`.
- **Numbers:** the note's section 4, `model.ts`, the glossary, the policy's I3, A6 and O7, and row 44 agree on every value they share.

## Not checked

- The full suite against mutants: each mutant ran only against the 9 files of the unit plus `names-check.test.ts`. The constants of G1 were checked by grep for other users, not by a full run.
- `tsc` against M115. I showed by probe that the brand works; I did not rerun the type check with it removed.
- `apps/ops/src/ops.test.ts` beyond reading its diff and seeing it pass in `make check`.
- Whether `prompts/` reaches the Docker image; the lockfile diff; `yaml` 2.9.1's licence and advisories (no network).
- Windows and macOS behaviour: CRLF and case-insensitive paths are reasoned, not run.
- Real provider output. No model exists; "hostile output" was hand-made values and a JSON fuzz.
- ADR 0012, the eval plan, the state machines and the OpenAPI file beyond grep. ADR 0014 was read only at the lines about the registry and imports.
- Issues #158, #227, #278 and #303 (no network).
- `docs/STATUS.md`, `README.md` and the traceability row beyond reading the diff; the pull-request number 325 is taken on trust.
- Performance of `readOutput` on very large replies beyond one 5 MB reply and one list of 2,000,000 flags.

---

## Author's response

Everything below is in the same pull request (#325). **The fixes have
been checked by the author only.** A check by another agent was started
and stopped before it reported; it is still to be run, and the pull
request stays a draft until it has been.
The mutants the review found alive were run again by the author after the
fixes; the result is beside each.

One change to the report as saved: in G13 the reviewer wrote the
byte-order mark itself between the quotation marks of the suggested fix.
It is written here as its escape, so that this file holds no invisible
character.

| Finding | Answer |
| --- | --- |
| G1 limits tied to nothing | Fixed. `packages/core/src/model.test.ts` writes every value out a second time and reads the glossary's rows. M62 to M66: two rerun (M64, M65), both killed; the others are pinned by the same assertion |
| G2 a client made without `bounded` | Fixed. `LlmClient` is a class with a private part: an adapter, a hand-written object, a copy with a method replaced and `new` are each a compile error, held by `client-type.test.ts`. With the private part taken off, the type check fails (M115). What U6 puts around a call is added in `bounded.ts`; the note and ADR 0005 say so |
| G3 the provider test's walk | Fixed. It walks the repository from its root, files at the root included, and reads every `package.json`. It sees a comment inside `import(…)` and a path into `node_modules`. It is still a list of names, and says what it cannot see |
| G4 `readOutput` throws or reads twice | Fixed. A value is read once into copies made there; a list must be an ordinary array with an item at every place and nothing else on it; the function never throws. Tests for an accessor that answers differently, a list with something on it, a subclass of a list, and proxies that refuse |
| G5 dead or untested lines | Fixed: the hole checks are gone with G4; the calls and their list are asserted frozen, and the copy's missing prototype asserted (M12, M23, M24 killed); the precedence has its case of too many (M27 killed) |
| G6 `bounded` looser in places | Fixed: the model's name is checked; a health that is neither ok nor one of the two failures is an `AdapterFault`; an adapter that answers with no promise has still answered; a request is checked before the call, its bound read once; a request that is not an object is a rejection |
| G7 the fake could leave a test wrong | Fixed: `overran` and `assertDone()`; `calls` holds copies; a hang ends late with a real answer or a rejection, and C4 asserts that it ended (M51 killed). An unscripted health is still ok, by design; `healthRemaining()` and `assertDone()` count the scripted ones |
| G8 YAML forms | Fixed: a tag is refused, and a warning from the parser; a repeated key inside `parameters` has its test (M75 killed); a text is one line and says so. A file's size is not bounded before it is parsed: left in #326 |
| G9 links and the changelog | Fixed: every link is refused, inside the folder or out; the folder itself may be a link. The heading is `## <version>` alone or followed by a space. The scan reads a link. `## 1` inside a code fence still counts: left in #326 |
| G10 the scan refuses ordinary text | Fixed: a clock time, an amount with two or three decimals and a number with its thousands marked are left alone, with tests in two scripts; a tab between digits has its test (M122 killed). Digits split by a line break, a zero-width space and a full-width at-sign are still missed: #326 |
| G11 boundary regexes | Fixed in part: a string that begins as the interface or the registry and then leaves it counts as a pack; the three lists are pinned (M129 killed); all four kinds of dependency are read. A name put together from parts, backslashes and another case are not seen, and the test says so |
| G12 `LoadedPrompt` not branded | Fixed otherwise: `assemblePrompt` runs the loader's rules on the text itself, and refuses a canary already in the text. The wording of P12 is corrected |
| G13 an invisible character; line endings | Fixed: the mark is written as its escape; `.gitattributes` checks `prompts/**` out with line feeds. The check for raw control characters in sources, promised by the M2 retro, is still not built: #326 |
| G14 documents | Fixed: T54's first column; `AGENTS.md` section 4 says one folder per prompt again, until row 45 is answered; ADR 0014 has its amendment; `packages/ai` no longer depends on the interface; the note says what `apps/ops` depends on and why; R6 reads the program's folders all the way down; the note names the stand-in's 4,096 |
| G15 row 44 did not list every number | Fixed: row 44 has an (f); the identifier's 100 is in the glossary and the note's table |
| G16 tabs and carriage returns in an answer | Written into "As built" as a known cost, for U17 to count |
| G17 the arithmetic leaves out tool calls | Written into "As built" |
| G18 small things | Not changed. Left in #326 |
