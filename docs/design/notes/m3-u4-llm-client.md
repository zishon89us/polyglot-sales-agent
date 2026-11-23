# Design note: the model client, its scripted stand-in, the prompt loader and the pack packages (M3 unit U4)

2026-11-23 · issue #303 · written before the code

U4 builds the seam every later unit calls a model through, with no model
behind it: the interface of ADR 0005, a scripted client for the tests, a
loader for prompt files, the structure a model must answer in, the limits
on one call, and the three packages of ADR 0014. **No provider, no prompt
text and no change to what a customer sees:** the reply is still the
echo. U7 writes the reply prompt and puts the client into the turn.

Two rules here are about people and money, so their cases come first:
which of the model's flags exist (a flag takes a customer's answer away,
or opts them out), and how one call is bounded (each call is paid for).

Decisions that are the maintainer's are rows 44 and 45 of the decisions
page; each is marked **(row)** where it is made.

## 1. Packages

| Package | Holds | May import |
| --- | --- | --- |
| `packages/pack-interface` | The type `Pack` and `PromptFragment`. No pack's name | `packages/core` |
| `packages/packs/registry` | `PACKS`: a map from name to `Pack`, and `packNamed` | Each pack, the interface |
| `packages/packs/faq-only` | A `Pack` with a name and nothing else (row 37) | The interface |
| `packages/packs/booking` | Gains a default export, a `Pack` with a name and nothing else, beside its word list | The interface |
| `packages/ai` | Everything in sections 2 to 6 | `packages/core`, the interface |

`Pack` in U4 is `{ name, promptFragment? }`, where a fragment is a
prompt's name and version. `tools` and `claimKinds` are added by the
units that first use them (U7, U9), as ADR 0014 says of the types.

Registry rules, each with a test:

| # | Case | Result |
| --- | --- | --- |
| R1 | The registry's keys | Exactly `booking` and `faq-only`; each key equals its pack's `name` |
| R2 | A name that is not lower-case letters, digits and hyphens, starting with a letter | The check that the registry's test runs refuses it |
| R3 | A pack named `core`, `interface` or `registry` | Refused by the same check |
| R4 | `packNamed(registry, "unknown")` | `undefined`; the caller (U7) fails the job, as ADR 0014 has it |
| R5 | `packNamed(registry, "__proto__")`, `"constructor"` | `undefined` |
| R6 | The names `ops` accepts (`apps/ops`, its own list) | Equal to the registry's keys, by a test in `apps/ops` that is handed the registry by its test file |

**Nothing imports the registry in U4 but tests.** ADR 0014 lets `main.ts`
of the api and the worker import it and pass it down; the code it would
be passed to is U7's, and an import nothing uses would be decoration.

The boundary test changes as ADR 0014 lists:

| # | Rule | Was |
| --- | --- | --- |
| B1 | The pinned list of scanned folders gains `packages/ai` and `packages/pack-interface`; both are scanned for the booking pack's words | Six folders |
| B2 | `packages/core`, `packages/db` and the channel packages import neither the interface nor the registry | "No file imports anything named `pack-…`" |
| B3 | No scanned file imports a pack by its package name or by a path into `packages/packs/<name>` | The same, kept |
| B4 | Only `apps/api/src/main.ts` and `apps/worker/src/main.ts` may import the registry | New |
| B5 | The same three rules for each scanned package's dependencies | One rule |
| B6 | Each rule is shown to see what it should: a planted line of each kind is matched, and `pack-interface` is told from `pack-booking` | Three planted lines |

## 2. The client

```ts
interface LlmClient {
  generate(request: LlmRequest): Promise<LlmResult>;
  health(): Promise<{ ok: true } | { ok: false; failure: "timeout" | "provider-error" }>;
}
```

A request holds: the system text and the names and versions of the
prompts it was assembled from; the messages; the tools on offer; the
claim kinds allowed; `maxOutputTokens`; `timeoutMs`. The last two are
required: a request without a bound does not type-check, and at run time
a bound that is not a whole number above zero is refused before any
call.

**A request has no field for a contact.** Nothing in it is named for a
phone number or a person's name (NFR-V7). What the turn puts into the
messages is U7's, with its own test.

A message is one of: `data` (what code gives the model: the profile, the
calendar), `customer`, `assistant`, `tool-result`. The adapter decides
how each is sent to its provider; `data`, `customer` and `tool-result`
are always delimited as data by the turn's assembly, not by the adapter.

A result is one of:

| Result | When | Counts as a provider failure (state machines §8) |
| --- | --- | --- |
| `ok`, with the checked output, token counts and the model's name | The answer matched the structure of section 3 | No |
| `invalid-output`, with a short code and token counts | The provider answered and the answer did not match (O1) | **No** (guardrail policy, A1) |
| `timeout` | No answer within `timeoutMs` | Yes |
| `provider-error`, with a short code | The provider refused or failed | Yes |

A failure never carries the model's text or the provider's message: only
a code from a fixed list, so that nothing a customer typed reaches a log
through an error (U6 logs the code).

**One attempt.** The client never retries (ADR 0005, amendment). The
three attempts and their waits are constants in `packages/core` for the
caller (U7, U15): 20 seconds, 3 attempts, waits of 1 and 4 seconds, as
the glossary has them.

**Every call is bounded in time by one wrapper,** `bounded(client)`,
that every client is used through:

| # | Case | Result |
| --- | --- | --- |
| C1 | The inner client answers in time | Its result, unchanged |
| C2 | The inner client has not answered at `timeoutMs` | `timeout`; the inner call is told to stop through an `AbortSignal` |
| C3 | The inner client answers after the wrapper gave up | Ignored; nothing is thrown, nothing is left unhandled |
| C4 | The inner client throws or rejects | `provider-error` with the code `threw`; never an exception to the caller |
| C5 | `timeoutMs` or `maxOutputTokens` is 0, negative, a fraction, not a number, or above its ceiling (section 4) | A thrown `RangeError` before any call: a caller's fault, not the provider's |
| C6 | `health()` has not answered in the health timeout | `{ ok: false, failure: "timeout" }` |
| C7 | The inner client returns `ok` with output that does not match | `invalid-output`: the wrapper checks every `ok` again, so an adapter cannot pass unchecked output on |

## 3. What the model answers

Four parts, and no other key at any level:

```ts
{ reply: string, claims: Claim[], flags: Flag[], toolCalls: ToolCall[] }
```

| Part | Rule |
| --- | --- |
| `reply` | Text. May be empty here; whether an empty or over-long reply is sent is the output check O7 (U9), which uses the limit of section 4 |
| `claims` | Each `{ kind, item, value }`. `kind` is one of the kinds the request allows: the core's five (`price`, `opening-hours`, `service-detail`, `policy`, `calendar-date`) and those of the tenant's pack. `item` and `value` are text of 1 to 200 characters. At most 20. What a claim must equal is U9's |
| `flags` | Each one of the seven below, none twice |
| `toolCalls` | Each `{ id, name, arguments }`. `name` is one of the tools the request offers; `id` is text of 1 to 100 characters, none twice; `arguments` is an object. At most 4. Whether the arguments fit the tool's own schema is checked where the tool is run (U7) |

**The seven flags** (guardrail policy, sections 4 and 6; ADR 0005 and
0007 as amended; #278). The policy names what each means; these are the
names code uses, defined once in `packages/core/src/names.ts`:

| Flag | The customer… | Who acts on it |
| --- | --- | --- |
| `asks-for-person` | asks for a person, in free text | U11 |
| `asks-to-stop` | asks to receive no more messages, in free text | U10 |
| `sensitive-topic` | raises a topic on the handover list | U11 |
| `data-request` | asks to see or delete their personal data | U11 |
| `emergency` | describes an emergency | U11 |
| `asks-to-resume` | wishes to receive messages again, in free text | U10 |
| `asks-if-person` | asks whether they are talking to a person | U8 |

U4 only checks that a flag is one of the seven. It acts on none.

Cases of the check (`readOutput`), each a test:

| # | Given | Result |
| --- | --- | --- |
| O1 | The four parts, each valid | The output |
| O2 | A missing part; `null` for a part; a part of the wrong type | `invalid-output`, code `shape` |
| O3 | A fifth key, at the top or inside a claim or a tool call | `shape` |
| O4 | A flag that is not one of the seven; a flag twice | `flag` |
| O5 | A claim of a kind the request does not allow; a claim with an empty or over-long item or value; more than 20 | `claim` |
| O6 | A tool call for a tool not on offer; two with one `id`; arguments that are an array, a string or `null`; more than 4 | `tool-call` |
| O7 | Not an object at all: text, a number, an array, `null`, `undefined` | `shape` |
| O8 | `__proto__` or `constructor` as a key, a flag, a kind or a tool's name | Refused like any other unknown name |
| O9 | A text with half of a surrogate pair | `shape`: it cannot be stored or sent whole |
| O10 | A claim kind that the tenant's pack registers, in a request that allows it | Accepted; in a request that does not, `claim` |

The code never repairs an answer: nothing is trimmed, dropped or guessed
(ADR 0005: "not a best-effort parse").

## 4. The limits on one call (#158) **(row 44)**

Each is a constant in `packages/core` and a row of the glossary.

| Limit | Value | Why this number |
| --- | --- | --- |
| Output tokens on one call | 1,024 | A reply is short (guardrail policy §9, 8). Room for the structure, 20 claims and a reply of the length below in a script that costs several tokens a character |
| A reply's length (O7) | 1,200 code points | Several short paragraphs. WhatsApp's own limit on a text is higher; U5 reads it from Meta's page, and it is not recalled here |
| Rounds of tool calls in one reply | 4 | A booking is a search and a write. A fifth answer that again asks for tools is a failed call |
| Tool calls in one round | 4 | In the structure, section 3 |
| A batch's customer text | 4,000 code points | A batch is a few messages typed within seconds |
| Timeout of one call | 20 seconds (the glossary's) | Not new |
| Ceilings a request may not pass (C5) | `timeoutMs` 60,000; `maxOutputTokens` 4,096 | So that a wrong setting cannot make one call wait or cost without bound |

The provider's price per token is not known (ADR 0010 is open), so what
these numbers cost is not computed here. U17 measures.

**The rule for a batch that is too long** (`boundBatch`, a pure function;
U7 calls it):

| # | The batch's texts, oldest first | What the model is given |
| --- | --- | --- |
| T1 | Together within the limit | All, as typed |
| T2 | Together over it | The newest are kept whole, as many as fit; the older ones are left out |
| T3 | The newest alone is over it | Its first 4,000 code points, and no other |
| T4 | Anything was left out or cut | The result says how many messages were left out and whether one was cut. U7 tells the model in a line of its own, written by code, so that it can say it did not read everything |
| T5 | An empty batch; a message with no text | Nothing kept, nothing left out; a message with no text counts as length 0 and is kept |
| T6 | A cut would fall inside a surrogate pair | It cannot: the count and the cut are in code points |

The messages stay stored whole. The limit is on what one call is given,
not on what a customer may send. The turn cap and the token budget of a
session are U12's.

**Where each limit is enforced:**

| Limit | Enforced by | In |
| --- | --- | --- |
| Output tokens, timeout | The request's required fields, `bounded` | U4 |
| Tool calls in one round, claims | `readOutput` | U4 |
| A batch's text | `boundBatch` | U4 (the function), U7 (its use) |
| Rounds of tool calls | The turn's loop | U7, with the constant from U4 |
| A reply's length | Output check O7 | U9, with the constant from U4 |

## 5. The scripted client

`FakeLlmClient` is given a script: a list of steps, one for each call,
in order. It is the only client in unit, integration and end-to-end
tests (ADR 0005).

| Step | The call returns |
| --- | --- |
| `reply`, with an output and, if wanted, token counts | `ok`, after the output passes `readOutput` like any adapter's |
| `raw`, with any value | What `readOutput` makes of it: this is how a test states malformed output |
| `timeout`, `provider-error` | That failure |
| `hang` | Nothing, until the call is told to stop: for the tests of `bounded` |
| `throw` | A thrown error: for C4 |

| # | Case | Result |
| --- | --- | --- |
| F1 | More calls than steps | A thrown error that says so: a test that did not expect a call fails loudly |
| F2 | Steps left over when the test asks | `remaining()` is not 0; a test asserts it |
| F3 | What was asked | `calls` holds each request, so a test can read what the model was given |
| F4 | The same script twice | The same results: no clock, no randomness |
| F5 | `health()` | Scripted the same way, by its own list; `ok` when the list is empty |

The fake is not refused in production here. That guard is U14's, with
the adapter (#165).

## 6. Prompts

```text
prompts/
  README.md
  <name>/
    CHANGELOG.md
    <version>/            a whole number, 1 or more
      prompt.md
      meta.yaml
```

Each version has its own folder, so that an earlier one is still in the
image. **A way back for a prompt (#227, its second part) is then a
setting, not a pull request:** which version a deployment uses is read
at start, and going back to an earlier one needs no provider and no eval
run. The setting itself is U7's, with the first prompt **(row 45)**.

`meta.yaml` has exactly: `name`, `version`, `owner`, `model`,
`parameters`, `intended_use` (`AGENTS.md` section 6). `name` and
`version` equal the folders'.

`loadPrompt(root, name, version)` and `assemblePrompt(core, fragment,
canary)`:

| # | Case | Result |
| --- | --- | --- |
| P1 | A prompt that is there and well formed | Its text and its `meta` |
| P2 | A name or a version that is not there | An error that names both; no fallback to another version |
| P3 | A name that is not lower-case letters, digits and hyphens; a version that is not a whole number above 0 | Refused before the disk is touched: no `..`, no path |
| P4 | `meta.yaml` missing, not YAML, missing a key, with another key, or with a name or version that is not its folder's | An error that names the file and the key |
| P5 | The core prompt, assembled | Its text with the canary in the one slot `{{canary}}` |
| P6 | A core prompt with no slot, or with two | Refused: the canary check (O6) would be blind |
| P7 | Any other `{{…}}` in a prompt or a fragment | Refused: no variable is filled from anything else, so no customer's or owner's text can enter the instructions (T13) |
| P8 | A canary that is not 16 to 64 letters and digits | Refused |
| P9 | A pack with a fragment | The fragment's text after the core's, under a line that code writes; the result lists both names and versions, for the trace (U6) |
| P10 | A pack with no fragment | The core's text alone |
| P11 | A fragment with a canary slot | Refused: one slot, the core's |
| P12 | A prompt file that is empty, not UTF-8, or over 20,000 code points | Refused |
| P13 | The same inputs twice | The same text, byte for byte |

The assembled result also carries the instruction text without the
canary, which the repetition check (O6, U9) compares a reply with.

**No prompt is added in U4.** `prompts/` holds its README. The loader is
tested on folders its tests write.

**A scan of `prompts/`** (NFR-V6, "pattern scan in CI"): a test fails if
any file under `prompts/` holds an email address, a run of seven or more
digits, or a line that begins like a transcript (`Customer:`, `User:`,
`Assistant:` and the like). It is shown to find each on planted files.
It can show that something like a conversation or a contact is there;
it cannot show that a paraphrased real conversation is not.

**No provider's library outside its adapter** (ADR 0005, Confirmation):
a test reads every source file and every `package.json` of the
workspace. A known provider's or model framework's package may be
imported only under `packages/ai/src/adapters/`, and be a dependency
only of `packages/ai`. The list of names is in the test; it is shown to
see each on planted lines. No adapter exists yet, so today it must find
none.

## Departures

- ADR 0005 says the interface takes "a prompt name and version". The
  request takes the assembled text and the names and versions: the
  adapter does not read files.
- The issue says "prompts under `prompts/` with a version and a
  `meta.yaml`". The format and the loader are built; the first prompt is
  U7's, where its wording can be reviewed with the turn that uses it.
- `AGENTS.md` section 6 has one folder per prompt with a version in
  `meta.yaml`. Here each version has a folder (row 45).

## Evals

This pull request changes `packages/ai`, `packages/core` and a pack,
which the eval plan's section 8 says runs the subset against a real
model. There is no harness and no model (rows 31 and 32). What is
attached instead is the run of the tests against the scripted client;
no score exists.

## Not in U4

A provider's adapter and the guard against the fake (U14); traces and
cost (U6); the reply prompt, the turn's loop, tools and the prompt
setting (U7); the output checks and what a claim must equal (U9); acting
on any flag (U8, U10, U11); the session's token budget (U12); retries
and degraded mode (U15).
