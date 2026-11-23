# Verification of the fixes to the gate 4 code review of M3 unit U4 (model client)

Verified in `/tmp/u4verify` at `67020e1` (fix commit `ca3f591`, reviewed commit `6220bd6`). I wrote neither the code nor the review.

**Verdict:** 12 of the 18 answers hold as stated. Four are only partly true (G1, G2, G7, G13), one is fixed with a wrong sentence (G17), and G11 is "in part" as the author says. The fixes broke nothing I could find: `make check` passes and `readOutput` gives the same result as the reviewed version on 60,000 fuzzed JSON values. There is no High finding. There is one Medium (V1): a client's `generate` can still be replaced in place, with no cast, and the documents say it cannot.

## What I ran, with the real results

| Command or probe | Result |
| --- | --- |
| `cd /tmp/u4verify && pwd`; `pg_isready -h 127.0.0.1 -p 5432` | `/tmp/u4verify`; accepting connections |
| `make check` (once) | **exit 0**; vitest 35 files, **1127 tests passed**; lint, typecheck, docs, selftest, commitlint and git identity ok. One commitlint warning (`footer-leading-blank`) on the message of `6220bd6`, which predates the fix |
| `pnpm vitest run packages/ai packages/pack-interface packages/packs packages/core/src/model.test.ts tools/names-check.test.ts` | exit 0; 11 files, 124 tests |
| Temporary probe test `packages/ai/src/zz-probe.test.ts` (deleted) | Hostile values into `readOutput`; odd adapters and requests into `bounded`; the fake; 50 prompt folders into `loadPrompt`; 110 strings into `contactDetailsIn` |
| Fuzz: 60,000 random JSON values through `JSON.parse` into `readOutput` | 0 thrown; 9,501 accepted, each deep-frozen, not the input object, and equal to the input with flags de-duplicated (`-0` compared with `Object.is`). Refused: shape 32,843, flag 8,458, claim 5,297, tool-call 3,901 |
| Differential: the same 60,000 values into `readOutput` of `HEAD~2` (temporary copy, deleted) | **0 differences** in result or code |
| `pnpm exec tsc --noEmit -p .` with a temporary `zz-typeprobe.ts` of 17 ways to get a client (deleted) | See (a) |
| Three type mutants of `LlmClient`, each followed by `tsc` | See (a) |
| 61 mutants of code changed in the fix commit, each restored with `git checkout` | 50 killed, 11 survived. Table below |
| 19 single-number changes to the glossary against `model.test.ts` | 7 noticed, **12 not noticed**. See (i) |
| 7 planted files against `providers.test.ts` (each removed) | 6 caught, 1 not (a `.vue` file) |

Final `git status --short` is empty; no file added, nothing committed. Scratch output was written to `/tmp/u4v_*.txt` and `/tmp/u4_makecheck.log`, outside the repository copy.

## G1 to G18

| Finding | Verdict | Evidence |
| --- | --- | --- |
| G1 limits tied to nothing | **Partly** | The code side is pinned: M62, M63, M66 and a changed retry wait were all killed by `model.test.ts`. The glossary side is weak: the check is `toContain` on the row's text, and 12 of 19 changed glossary numbers passed (V2) |
| G2 client without `bounded` | **Partly** | The review's reproduction (`{...client, generate}`) is now a compile error, as are an adapter, a literal, `new` and a subclass. But `client.generate = f`, `Object.assign(client, {generate})` and `LlmClient.prototype.generate = f` compile with no cast and work at run time (V1) |
| G3 provider test's walk | **Fixed** | Planted imports in `evals/`, `docs/`, a hidden folder and the root were caught, as was a `package.json` under `infra/x/`. Reverting the walk to three folders fails two tests (V58). `.git` and `node_modules` are not read |
| G4 `readOutput` throws or reads twice | **Fixed** | Every reproduction is now refused with a code and none throws: throwing and revoked proxies, the claims and flags accessors, a list with an extra property, a holed list with a polluted `Array.prototype`, a subclass of a list |
| G5 dead or untested lines | **Fixed** | M12, M23, M24 and M27 redone: all killed. The hole checks are gone |
| G6 `bounded` looser in places | **Fixed** | A bad model name and a bad health are `AdapterFault`; a non-promise answer is accepted; 18 malformed requests are rejected with 0 adapter calls; `generate(null)` rejects. Two residues: V4, V5 |
| G7 the fake | **Partly** | `overran`, `assertDone()`, copies in `calls` and the late end of `hang` are there (V23, V24, V25, V28 killed). M53 is still alive (V26): nothing tells a late rejection from a late answer. The response claims only M51, so it is not untrue, but C4's title is still not held for the rejection |
| G8 YAML forms | **Fixed** | `!!str`, `!!int`, `!!float`, `!custom`, `!!js/function`, a bare `!`, a tag on the root, on a key and on a parameter are all refused. A repeated key in `parameters` is refused (V47 killed). `>` and `\|` get the "one line" message |
| G9 links and changelog | **Fixed** | A link inside the folder is refused (V30, V31 killed). `## 1.5`, `## 1abc`, `## 10` are refused. `## 1` in a code fence still counts, as declared |
| G10 scan refuses ordinary text | **Fixed, with a new cost** | `10:30-11:30`, `09:00–17:00`, `150.00, 200.00`, `1,200,000` pass. The exemptions now let phone-shaped strings through (V3) |
| G11 boundary regexes | **Partly, as stated** | The review's three way-round strings are seen; the three lists are pinned (V52, V53, V54 killed). Nothing fails if the file scan stops using the new rule or if the two new dependency kinds are dropped (V56, V57) |
| G12 `LoadedPrompt` not branded | **Fixed** | A hand-made `{{user_name}} {{canary}}`, a tab, an over-long text and a canary already in core or fragment are refused by `assemblePrompt` (V35 to V38 killed) |
| G13 invisible character; line endings | **Partly** | `prompts.ts:57` is the escape and `git check-attr` gives `eol: lf` under `prompts/`. A raw U+FEFF remains in `prompts.test.ts:388` and in the review file at line 284, which the response says holds none (V7) |
| G14 documents | **Fixed** | T54's first column, `AGENTS.md` section 4, the ADR 0014 amendment, `packages/ai/package.json` without the interface, the recursive read in `ops.test.ts` and the note's 4,096 are all as stated |
| G15 row 44 | **Fixed** | Row 44 has (f); the identifier's 100 is in the glossary row and the note's table |
| G16 tabs and carriage returns | **Fixed** (document) | In "As built" |
| G17 arithmetic | **Fixed but wrong** | The added sentence says 8,000 code points are more than the output limit holds "at any price per code point". That is false below 0.512 tokens a code point (V6) |
| G18 small things | **Not changed, as stated** | `-0` is still kept as `-0` |

## Answers to (a) to (i)

**(a) `LlmClient` as a class**

- **Refused by the compiler:** an adapter, `{generate, health}`, a typed literal, `{...client, generate, health}`, `new`, `extends` (TS2675), assigning the class to a public constructor type.
- **Compile with no cast and give an unbounded client:**
  - `client.generate = generate` (run: `instanceof LlmClient` stays true and `generate(null)` resolved `{kind:"timeout"}`);
  - `Object.assign(client, { generate })`;
  - `LlmClient.prototype.generate = generate`, which changes every client;
  - `Object.create(LlmClient.prototype, {...})` and `Object.setPrototypeOf({...}, LlmClient.prototype)`, which return `any`. `biome ci` on the probe reported formatting only.
- **Compile and are harmless:** `LlmClient.around(adapter, timers)` and `Reflect.construct` give a bounded client; `structuredClone(client)` is typed as a client but is an empty object.
- **Does the type test fail when weakened?**
  - Remove `private` from the constructor: yes, `client-type.test.ts(34,5): error TS2578`, `tsc` exit 1. Vitest alone still passes.
  - Make `#adapter` and `#timers` public fields, constructor still private: **`tsc` exit 0**. The class is then structural and a literal with the four members is a client (V9).
- **Detached methods:** `const g = client.generate; g(request)` throws synchronously (`TypeError: Cannot read properties of undefined (reading '#timers')`), while `g(null)` rejects. It matters little: nothing unbounded results, but C6 promises rejections (V5).

**(b) `readOutput`'s copies**

- **Nothing plain is wrongly refused.** Accepted: empty lists; `{}`; nested empty objects and lists; keys `length`, `0`, `1`, the empty key, `toString`, `hasOwnProperty`, `valueOf`; `-0`, `1e21`, `5e-324`, `Number.MAX_VALUE`; frozen and null-prototype inputs.
- **Depth is unchanged:** the arguments plus four nested containers pass and a sixth container is refused, for arrays and objects alike, including an empty container at the limit.
- **Nothing thrown** in 60,000 fuzzed values or in the hostile probes.
- **The try/catch hides no bug I could find.** The reviewed version had no catch and agrees on every one of the 60,000 values. Removing the outer catch (V05) or the inner one (V06) fails only the proxy test.
- **One thing to know:** a transparent `new Proxy([], {})` as `claims` is accepted as an empty list. It is read once through its descriptors, so this is consistent.

**(c) `bounded`**

- **No regression in timing.** No timer was left on any path: answer, rejection, synchronous throw, throwing thenable, `AdapterFault`, refused request. Timeout fires at exactly the request's value and aborts the signal then. Late answer and late rejection are dropped. Health waits 5,000. "Truncated not said" is `truncated`. A provider error's extra `message` is dropped.
- **No legitimate model name is refused.** Passed: `anthropic.claude-3-5-sonnet-20240620-v1:0`, a 101-character inference-profile ARN with slashes and colons, an application-inference-profile ARN, `models/gemini-1.5-pro`, `ft:gpt-4o:org::id`, a non-Latin name, 200 characters. Refused: 201 characters, U+0000, a line break, a tab, empty.
- **`timeoutMs` is read twice, not once.** The second read is re-checked and is the one used (getter 50 then 70: timer set to 70; 50 then 1e9: `RangeError`). The comment "read once" is loose; the behaviour is sound.
- **Residue:** `tools` and `claimKinds` are read again after the answer (V4).

**(d) `fake.ts`**

- **`structuredClone` can throw.** A request with a function in `argumentsSchema` or a proxy as `messages` rejects with `DataCloneError`, the call is not recorded, and the step is not consumed. A plain-data request never throws. A class instance is stored without its prototype (V8).
- **`assertDone`:** passes on exact use; throws after an overrun and on an unused health step. Unscripted health calls still pass, by design.
- **`hang`:** ends after the abort with a real answer carrying the step's value, or with a rejection; `endedLate` goes 0 to 1 in both cases.

**(e) `prompts.ts`**

- **Root forms:** a trailing slash, `//`, `x/../`, `/.` and a relative path all load. `realpathSync(root)` normalises them.
- **Tags:** no ordinary untagged form is refused. Loaded: flow map `{}`, flow and block parameter maps, double- and single-quoted strings, quoted keys, numbers, booleans, `>-`, `|-`, multi-line plain, comments, `---`, `...`, `%YAML 1.2`, CRLF.
- **Changelog with CRLF:** loads. Newly refused: `## 1: note`. Accepted: `## 1 (2026-11-23)`, `## 1 - note`, `## 1` followed by a tab or a no-break space.
- **`checkText` in `assemblePrompt` and the canary rule:** both work. A hand-made prompt with `text` missing throws a raw `TypeError`, not `PromptError`; that needs a cast.

**(f) `contactDetailsIn`**

- **Still caught:** `555.0100`, `12:34:56:78`, `+1 555.010.0123`, `555.123.4567`, `06.12.34.56.78`, `0171.234.567`, `044 668.18.00`, `0300-123-4567`, `01:23:45:67:89`.
- **Now pass, and should not** (V3):
  - as a number with thousands: `1,234,567,890`, `+1,234,567,890`, `+92 300,123,456`, `770,090,012`;
  - as an amount inside a number: `0300 123.45 67`, `0300 123.456 7`, `0171 234.567`, `06 1234.567`, `5550.100`, `555-01.00`, `01 23 45 67.89`, `98765 43.210`, `077.00 900.12`, `300.12 345.67`, and the Arabic-digit form of the first;
  - as clock times: `12:34 56:78`, `07:70 09:00 12:34`, twelve Arabic digits in three pairs, `call 12:34 56:78 90:12`.
- **Ordinary text still refused:** `1.200.000`, `1 200 000`, `1000000`, `23/11/2026`, `23.11.2026`, `step 1. 2. 3. 4. 5. 6. 7.` on one line, `version 1.2.3.4.5.6.7` (the test now asserts this one is flagged).

**(g) `providers.test.ts`**

- It does not read `.git` or `node_modules`, and it catches what it caught (V58 to V60 killed).
- It reads everything else, including ignored build output: a planted `dist/bundle.js` failed the test (V11).
- "It sees a comment inside `import(…)`" holds for one plain block comment. Not seen: two comments, a comment containing `*`, a `//` comment before the string, `require.resolve("openai")`.

**(h) `boundary.test.ts`**

- No false positive on existing code: the test passes and none of the test's own interface, registry or neutral lines match `A_WAY_ROUND`.
- The pins sit beside the lists in the same file, so a change must be made twice; that is the whole of what they guarantee.

**(i) `model.test.ts` and the glossary**

Yes, it can pass while the glossary states a different number. Not noticed:

- `waits of 2 and 14 seconds`; `120 seconds, 13 attempts`;
- `5 rounds` (the other 4 satisfies it); `40 calls`;
- `14,096 tokens`; health `15 seconds`; claims `300`; claim text `1100`;
- reply `11,200`; ceiling `600 seconds`; `18,192`; prompt `120,000`.

Noticed: health 6; claim text 1,000; reply 1,300; depth 6; identifier 200; batch 80,000; prompt 25,000.

## Mutants

K = killed, S = survived. All against the command of step 3, except T1 to T3 (`tsc`) and V61 (`output.test.ts` only).

| # | File | Change | Result |
| --- | --- | --- | --- |
| V01 | output.ts | a subclass of `Array` accepted | K |
| V02 | output.ts | extra property on a list ignored | K |
| **V03** | output.ts | symbol check on lists removed | **S** |
| V04 | output.ts | an accessor item is read | K |
| V05 | output.ts | outer try/catch removed | K |
| V06 | output.ts | inner try/catch removed | K |
| V07 | output.ts | M12 again: arguments copy has a prototype | K |
| V08 | output.ts | M23 again: call object not frozen | K |
| V09 | output.ts | M24 again: `toolCalls` not frozen | K |
| V10 | output.ts | `fieldsOf` copy has a prototype | K |
| V11 | output.ts | depth `>` to `>=` | K |
| V12 | bounded.ts | model name: `keepable` dropped | K |
| V13 | bounded.ts | model name: line-break check dropped | K |
| V14 | bounded.ts | model name: 200 to 201 | K |
| V15 | bounded.ts | unknown health becomes `provider-error` | K |
| V16 | bounded.ts | any failure text passed | K |
| V17 | bounded.ts | no `Promise.resolve` | K |
| V18 | bounded.ts | `tools` not validated | K |
| V19 | bounded.ts | `claimKinds` items not validated | K |
| V20 | bounded.ts | second read of `timeoutMs` not re-checked | K |
| V21 | bounded.ts | null request not caught | K |
| V22 | bounded.ts | system, prompts, messages not validated | K |
| V23 | fake.ts | `calls` holds the caller's object | K |
| V24 | fake.ts | `overran` never counted | K |
| V25 | fake.ts | M51 again: `hang` never ends | K |
| **V26** | fake.ts | M53 again: `hang` then `reject` answers | **S** |
| **V27** | fake.ts | `assertDone` ignores unused health steps | **S** |
| V28 | fake.ts | `assertDone` ignores overrun | K |
| **V29** | fake.ts | late answer of `hang` drops the step's value | **S** |
| V30 | prompts.ts | a link inside the folder allowed | K |
| V31 | prompts.ts | `startsWith(home)` in place of equality | K |
| V32 | prompts.ts | tag not refused | K |
| **V33** | prompts.ts | parser warnings ignored | **S** (probably redundant: the tag rule caught every warning case I tried) |
| V34 | prompts.ts | changelog heading with any suffix | K |
| V35 | prompts.ts | core text not re-checked | K |
| V36 | prompts.ts | fragment text not re-checked | K |
| V37 | prompts.ts | canary in core allowed | K |
| V38 | prompts.ts | canary in fragment allowed | K |
| V39 | prompts.ts | clock-time exemption removed | K |
| **V40** | prompts.ts | clock-time exemption without its lookarounds | **S** |
| V41 | prompts.ts | thousands exemption removed | K |
| **V42** | prompts.ts | thousands exemption without its lookbehind | **S** |
| **V43** | prompts.ts | amount of 2 to 4 decimals (`555.0100` exempt) | **S** |
| V44 | prompts.ts | amount: following dot allowed | K |
| V45 | prompts.ts | M122 again: tab between digits | K |
| V46 | prompts.ts | byte-order-mark check broken | K |
| V47 | prompts.ts | M75 again: `uniqueKeys: false` | K |
| V48 | core/model.ts | M62 again: output tokens 1,024 | K |
| V49 | core/model.ts | M63 again: claims 20 | K |
| V50 | core/model.ts | M66 again: ceiling 600,000 | K |
| V51 | core/model.ts | retry waits 2,000 and 4,000 | K |
| V52 | boundary.test.ts | M130 again: `KNOWS_NO_PACK` loses `packages/db` | K |
| V53 | boundary.test.ts | M129 again: third file in `MAY_IMPORT_REGISTRY` | K |
| V54 | boundary.test.ts | `apps/ops` in `MAY_DEPEND_ON_REGISTRY` | K |
| V55 | boundary.test.ts | way round without `node_modules` | K |
| **V56** | boundary.test.ts | B3's scan uses `A_PACK` only | **S** |
| **V57** | boundary.test.ts | optional and peer dependencies not read | **S** |
| V58 | providers.test.ts | walk only `apps`, `packages`, `tools` | K |
| V59 | providers.test.ts | path into `node_modules` not seen | K |
| V60 | providers.test.ts | comment inside `import()` not seen | K |
| V61 | output.ts | M27 again: claim count before flags | K |
| T1 | bounded.ts | `private` off the constructor | K (`tsc` TS2578) |
| **T2** | bounded.ts | `#` fields made public, constructor private | **S** (`tsc` exit 0) |
| T3 | bounded.ts | both | K (`tsc` TS2578) |

## New findings

### V1. Medium. A client's `generate` can be replaced in place, with no cast
- **Where:** `packages/ai/src/bounded.ts:206-253`; claimed otherwise in the note's "As built" and the ADR 0005 amendment ("a class nothing else can construct, copy with a method replaced or write by hand").
- **Reproduction:** `const c = bounded(adapter); c.generate = async () => ({ kind: "timeout" }); turn(c);` compiles and lints. So do `Object.assign(c, { generate })` and `LlmClient.prototype.generate = generate`. At run time the replaced method ran with no bound and no check.
- **Why it matters:** this is G2's own scenario, the U6 wrapper that replaces a method; only the spelling changed from a copy to an assignment.
- **Suggested fix:** make the two methods `readonly` arrow properties, `Object.freeze(this)` in the constructor, and freeze the prototype. Add the three lines above to `client-type.test.ts` as expected errors or run-time throws. Arrow properties also fix V5.

### V2. Low. The glossary check matches digits inside other numbers
- **Where:** `packages/core/src/model.test.ts:110-114`.
- **Reproduction:** change the glossary to `120 seconds, 13 attempts`, or `14,096 tokens`, or `5 rounds`; the test passes (12 of 19 such changes did).
- **Suggested fix:** match each number with `(?<![\d,.])…(?![\d,])`, and for a row that states the same number twice require that many matches.

### V3. Low. The scan's new exemptions let phone-shaped strings through
- **Where:** `packages/ai/src/prompts.ts:343-345`.
- **Reproduction:** `contactDetailsIn("0300 123.45 67")`, `("1,234,567,890")`, `("0171 234.567")`, `("12:34 56:78")` all return `[]`. Full list under (f).
- **Tests do not hold the edges:** V40, V42 and V43 survived, the last making `555.0100` exempt.
- **Suggested fix:** do not exempt a time, amount or thousands group that has another digit group next to it across a space; cap the thousands form at three groups; add the strings above as "still found" tests.

### V4. Low. `tools` and `claimKinds` are read again after the answer
- **Where:** `packages/ai/src/bounded.ts:90-93`, `238`.
- **Reproduction:** start a call, set `request.tools = undefined` while it waits, let the adapter answer: `TypeError: Cannot read properties of undefined (reading 'map')` after the paid call. A caller that reuses and changes one `tools` array between rounds gets its answer checked against the later list. No cast is needed, since a mutable array is assignable to a `readonly` one.
- **Suggested fix:** copy the tool names and claim kinds once in `generate`, beside `timeoutMs`, and give `resultOf` the copies.

### V5. Low. A detached method throws synchronously
- **Where:** `packages/ai/src/bounded.ts:221-252`.
- **Reproduction:** `const g = client.generate; g(validRequest)` throws `TypeError` before any promise exists; `g(null)` rejects.
- **Suggested fix:** as V1 (arrow properties), or state in C6 that methods are not to be detached.

### V6. Low. The note's sentence for G17 is not true
- **Where:** `docs/design/notes/m3-u4-llm-client.md:505-508`.
- **What:** "8,000 code points, far more than the output limit holds at any price per code point". 4,096 tokens hold 8,000 code points at any price up to 0.512 tokens each. The review said it "at the note's own three tokens a code point".
- **Suggested fix:** say "at the price this note assumes".

### V7. Low. A raw byte-order mark remains in two files, one of which says it holds none
- **Where:** `docs/reviews/2026-11-23-gate4-u4-llm-client.md:284` (inside the quotation marks after "Write"); `packages/ai/src/prompts.test.ts:388` (template literal; not added by the fix commit).
- **What:** the author's response says the mark "is written here as its escape, so that this file holds no invisible character". The file holds one.
- **Suggested fix:** write the escape (a backslash, `u`, `FEFF`) in both; in the test a stripped mark would fail loudly, so that one is cosmetic.

### V8. Low. The fake's copy of a request can throw an unrelated error
- **Where:** `packages/ai/src/fake.ts:96` (`structuredClone(request)`).
- **Reproduction:** a request whose `argumentsSchema` holds a function rejects with `DataCloneError: () => true could not be cloned`; `calls.length` is 0 and `remaining()` is still 1. It reads as an adapter fault.
- **Suggested fix:** catch it and throw an error that says the request is not plain data; say in F3 that a copy has no class.

### V9. Note. The type test does not hold the private fields
- **Where:** `packages/ai/src/client-type.test.ts:28-35`.
- **What:** with the `#` fields made public, `tsc` passes (T2), and a literal with the four members is then a client.
- **Suggested fix:** one more expected error: assigning a `Pick<LlmClient, keyof LlmClient>` to `LlmClient`.

### V10. Note. Other survivors
- V03 (symbol on a list), V27 (`assertDone` and health), V29 (the hang's value), V56 and V57 (nothing plants a line or a manifest to show B3 uses the new rule and the new dependency kinds), V33 (probably redundant).

### V11. Note. The provider walk reads ignored build output and misses some comment forms
- **Where:** `packages/ai/src/providers.test.ts:73-80`, `60`.
- **What:** `dist/` is in `.gitignore` but is walked; once an adapter is bundled, a local build will fail the test. Two comments, a `//` comment or `require.resolve` before the name are not seen.
- **Suggested fix:** add `dist`, `build`, `coverage` to `NOT_OURS`, or walk `git ls-files`.

### V12. Note. Numbers that do not agree, or are in one place only
- **"Five equivalent":** `STATUS.md` repeats the review's sentence. The review's table marks four as equivalent (M47, M76, M78, M121). The other STATUS figures agree with the review: 18 findings, 0 High, 3 Medium, 24 of 130 alive.
- **The model name's 200** is in the note's "As built" and `bounded.ts:32` only, not in row 44 (f) or the glossary.
- **Limits otherwise agree** across `model.ts`, the glossary, the note's section 4 and row 44 for every value they share (read by hand for row 44 and the note).

## Not checked

- The full suite against any mutant; each ran against the 11 files of the step 3 command only.
- `apps/ops/src/ops.test.ts` beyond its diff and its pass in `make check`.
- The linked-root and sibling-prefix cases of the loader by my own probe; I relied on the existing tests and V30, V31.
- Real timers in `bounded`; all timing probes used a hand timer.
- Windows, macOS and case-insensitive disks; `.gitattributes` was checked with `git check-attr`, not a checkout.
- The guardrail policy (I3, A6, O7), ADR 0012, the eval plan and the state machines.
- The lockfile diff, issue #326 and pull request #325 (no network).
- G18's items other than `-0`.
- Any real model output; everything hostile was hand-made or fuzzed JSON.

---

## Author's response

In the same pull request (#325). **These last fixes were checked by the
author only:** `make check`, and the mutants named below.

One change to the report as saved: in V7 the reviewer wrote the
byte-order mark itself in the suggested fix. It is described in words
here, so that this file holds no invisible character.

| Finding | Answer |
| --- | --- |
| V1, G2 a call replaced in place | Fixed. The two calls are read-only members of the client itself, the client is frozen and so is the class's prototype. An assignment is a compile error and throws; `Object.assign` and `defineProperty` throw. With either freeze removed a test fails. Not closed, and said in the note: a cast, and `Object.create` on the prototype, which the compiler types as anything |
| V2, G1 the glossary check | Fixed. Each row's numbers are read whole and must be exactly the code's, in any order. `14,096` and `5 rounds` now fail the test |
| V3, G10 the scan's exemptions | Fixed. A run of digits is left alone only if the whole of it is a time or a span of two, an amount or a list of amounts, or a number of at most three groups of thousands. Every string of (f) is found again but one: `5550.100` is written exactly like an amount of three decimals and is taken for one; the test says so |
| V4 tools and claim kinds read again | Fixed: copied once when the call is made, with a test that changes the request while the call waits (with the copy of the claim kinds removed, it fails) |
| V5 a detached call | Fixed with V1: a call taken off its client works and refuses by a rejection, with a test |
| V6 the sentence for G17 | Fixed: "at the price this note assumes", with the arithmetic |
| V7, G13 the byte-order mark | Fixed in both files. The first review's response now says what happened. The check that would have caught it is still #326 |
| V8 the fake's copy can throw | Fixed: an error that says the request is not plain data, with a test |
| V9 the type test and the private fields | Fixed: an object with every public member of a client is an expected error. With the two fields made public, the type check now fails |
| V10 other survivors | V26: the fake records how each hung call ended, and C4 compares (killed). V27 and V29 have a test each. V03, V33, V56 and V57 are left: #326 |
| V11 the provider walk | `dist`, `build` and `coverage` are not walked. The comment forms it misses are left: #326 |
| V12 numbers | STATUS says what the review counts and what it marks. The model name's 200 is in row 44 (f) |
| G7 a late rejection | Fixed, as V26 |
