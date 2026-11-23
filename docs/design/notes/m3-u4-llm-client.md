# Design note: the model client, its scripted stand-in, the prompt loader and the pack packages (M3 unit U4)

2026-11-23 · issue #303 · written before the code · second version, after
a review of the first (`docs/reviews/2026-11-23-m3-u4-design-review.md`)

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
| `packages/pack-interface` | The types `Pack` and `PromptFragment`; `packNamed`; the check of a pack's name. No pack's name | `packages/core` |
| `packages/packs/registry` | `PACKS`, a map from name to `Pack`, and nothing else | Each pack, the interface |
| `packages/packs/faq-only` | A `Pack` with a name and nothing else (row 37) | The interface, `packages/core` |
| `packages/packs/booking` | Gains a default export, a `Pack` with a name and nothing else, beside its word list | The interface, `packages/core` |
| `packages/ai` | Everything in sections 2 to 6 | `packages/core`, the interface |

`Pack` in U4 is `{ name, promptFragment? }`, where a fragment is a
prompt's name and version. `tools` and `claimKinds` are added by the
units that first use them (U7, U9), as ADR 0014 says of the types.

Row 37 is not answered. If the answer is no, what U4 built for it is
undone by deleting `packages/packs/faq-only` and its line of the
registry, and taking the name out of `ops`, the data model and the API,
as the row says.

Rules, each with a test:

| # | Case | Result |
| --- | --- | --- |
| R1 | The registry's keys | Exactly `booking` and `faq-only`; each key equals its pack's `name` |
| R2 | A name that is not 1 to 40 of the letters a to z, digits and hyphens, starting with a letter | `packNameProblem` says so; the registry's test runs it on every key, and any test that builds its own registry can |
| R3 | A pack named `core`, `interface` or `registry` | Refused by the same check |
| R4 | `packNamed(registry, "unknown")` | `undefined`; the caller (U7) fails the job, as ADR 0014 has it |
| R5 | `packNamed(registry, "__proto__")`, `"constructor"`, `"toString"` | `undefined` |
| R6 | The names `ops` accepts (`apps/ops`, its own list) | Equal to the registry's keys, by a test in `apps/ops`. `ops` itself does not import the registry; that it does not is checked by the same test file reading the program's sources |

**Nothing imports the registry in U4 but tests.** ADR 0014 lets `main.ts`
of the api and the worker import it and pass it down; the code it would
be passed to is U7's, and an import nothing uses would be decoration.

The boundary test changes as ADR 0014 lists:

| # | Rule | Was |
| --- | --- | --- |
| B1 | The pinned list of scanned folders gains `packages/ai` and `packages/pack-interface`; both are scanned for the booking pack's words | Six folders |
| B2 | `packages/core`, `packages/db` and the channel packages import neither the interface nor the registry, and depend on neither | "No file imports anything named `pack-…`" |
| B3 | No scanned file imports a pack by its package name or by a path into `packages/packs/<name>`, and no scanned package depends on one | The same, kept |
| B4 | Only `apps/api/src/main.ts` and `apps/worker/src/main.ts` may import the registry; only `apps/api` and `apps/worker` may depend on it | New |
| B5 | Each rule is shown to see what it should: a planted line of each kind is matched, and `pack-interface` is told from `pack-booking` and from `packs-registry` | Three planted lines |

The scan matches the booking pack's words as parts of words, in every
line that is not a test's. One of them is the word the eval plan uses for
the place a canary goes. **In `packages/ai` that place is called a
placeholder,** and the other words of the list are kept out of its
names and comments. Nothing scans `prompts/` for those words: that is
U7's, with the first prompt.

## 2. The client

```ts
/** What a provider's adapter implements. */
interface LlmAdapter {
  generate(request: LlmRequest, signal: AbortSignal): Promise<AdapterAnswer>;
  health(signal: AbortSignal): Promise<{ ok: true } | { ok: false; failure: ProviderFailure }>;
}

/** What the rest of the code calls. Made only by `bounded(adapter)`. */
interface LlmClient {
  generate(request: LlmRequest): Promise<LlmResult>;
  health(): Promise<{ ok: true } | { ok: false; failure: ProviderFailure }>;
}
```

An adapter returns what its provider said, unchecked, or a typed
failure. **Only `bounded` turns an adapter into a client,** and it is
`bounded` that checks the answer and keeps the time. The turn's code
takes an `LlmClient`; an adapter does not fit where a client is wanted,
so the bound and the check cannot be left out by forgetting them.

A request holds: the system text and the names and versions of the
prompts it was assembled from; the messages; the tools on offer; the
claim kinds allowed; `maxOutputTokens`; `timeoutMs`. The last two are
required.

**A request has no field for a contact.** Nothing in it is named for a
phone number or a person's name (NFR-V7). What the turn puts into the
messages is U7's, with its own test.

A message is one of: `data` (what code gives the model: the profile, a
note of what was left out), `customer`, `assistant`, `tool-result`. How
each is delimited as data is the prompt's and the turn's (U7).

A result is one of:

| Result | When | Counts as a provider failure (state machines §8) |
| --- | --- | --- |
| `ok`, with the checked output, token counts and the model's name | The answer matched the structure of section 3 | No |
| `invalid-output`, with a code and token counts | The provider answered and the answer did not match | **No** (guardrail policy, check O1) |
| `timeout` | No answer within `timeoutMs` | Yes |
| `provider-error`, with a code | The provider refused or failed | Yes |

The codes, a fixed list:

| Result | Codes |
| --- | --- |
| `invalid-output` | `shape`, `flag`, `claim`, `tool-call` (section 3), and `truncated`: the provider stopped because the output limit was reached |
| `provider-error` | `unavailable`, `rate-limited`, `refused` (the provider would not answer this content), `bad-request`, `not-authorised`, `other` |

Which provider errors are worth another attempt is U15's; U4 only keeps
them apart. A failure never carries the model's text or the provider's
message: only a code, so that nothing a customer typed reaches a log
through an error.

**One attempt.** The client never retries (ADR 0005, amendment). The
three attempts and their waits are constants in `packages/core` for the
caller (U7, U15): 20 seconds, 3 attempts, waits of 1 and 4 seconds, as
the glossary has them.

Cases of `bounded`. Time is the caller's: `bounded` is given the timer
it uses, and the tests give it one they move by hand.

| # | Case | Result |
| --- | --- | --- |
| C1 | The adapter answers in time and the answer matches | `ok`; the timer is cleared |
| C2 | The adapter answers in time and the answer does not match | `invalid-output` with its code and the token counts |
| C3 | The adapter has not answered at `timeoutMs` | `timeout`; the adapter's signal is aborted |
| C4 | The adapter answers, or rejects, after `bounded` gave up | Ignored: nothing is thrown and no rejection is left unhandled |
| C5 | The adapter throws or rejects in time | **The same error, thrown to the caller.** A throw is a fault in this repository's code, not the provider's failing: the job fails and is retried like any job, and nothing is counted against the provider. An adapter turns its provider's errors into `provider-error` itself |
| C6 | `timeoutMs` or `maxOutputTokens` is not a whole number above 0, or is above its ceiling (section 4) | A thrown `RangeError` before the adapter is called |
| C7 | The adapter says the provider stopped at the output limit | `invalid-output`, `truncated`, whatever the cut text looks like |
| C8 | `health()` has not answered in 5 seconds | `{ ok: false, failure: "timeout" }`; a throw is thrown on, as C5 |

Known gap: a call that times out may still be charged for by the
provider, and a `timeout` carries no token counts. U6's cost and U12's
budget will undercount by those calls.

The wrapper that writes a trace (U6) goes outside `bounded`, so that a
timeout is traced too.

## 3. What the model answers

Four parts, and no other key at any level:

```ts
{ reply: string, claims: Claim[], flags: Flag[], toolCalls: ToolCall[] }
```

| Part | Rule |
| --- | --- |
| `reply` | Text. May be empty here; whether an empty or over-long reply is sent is the policy's check O7 (U9), with the limit of section 4 |
| `claims` | Each `{ kind, item, value }`. `kind` is one of the kinds the request allows: the core's four (`price`, `opening-hours`, `service-detail`, `policy`; ADR 0012) and those of the tenant's pack. `item` and `value` are text of 1 to 100 code points. At most 30. What a claim must equal is U9's |
| `flags` | Each one of the seven below. A flag written twice is that flag, once |
| `toolCalls` | Each `{ id, name, arguments }`. `name` is one of the tools the request offers. `id` is text of 1 to 100 code points, none twice; it pairs a result with its call inside one reply's loop and is used for nothing else. `arguments` is plain data (below). At most 4 |

**An answer asks for tools or it answers, not both.** With any tool call,
`reply` is empty and there are no claims. Flags may come with either,
and U7 keeps the flags of every round of a reply.

**Text.** In every text of an answer, the ones inside `arguments`
included: no half of a surrogate pair, and no control character but a
line break (U+0000 among them, which the database cannot store). Other
characters, the ones that turn the direction of text among them, are the
output checks' to judge (U9).

**Plain data.** `arguments` is an object whose values are text, finite
numbers, `true`, `false`, `null`, lists and objects of the same, no more
than 5 deep, with no key named `__proto__`, `constructor` or
`prototype`, and no more than 2,000 code points when written as JSON.
Whether it fits the tool's own schema is checked where the tool is run
(U7).

**The seven flags** (guardrail policy, section 11, with what code does
for each in its sections 4 and 6; ADR 0005 and 0007 as amended; #278).
These are the names code uses, defined once in
`packages/core/src/names.ts`. The policy gains a table of them, and the
names check compares the two.

| Flag | The customer… | Who acts on it |
| --- | --- | --- |
| `asks-for-person` | asks for a person, in free text | U11 |
| `asks-to-stop` | asks to receive no more messages, in free text | U10 |
| `sensitive-topic` | raises a topic on the handover list | U11 |
| `data-request` | asks to see or delete their personal data | U11 |
| `emergency` | describes an emergency | U11 |
| `asks-to-resume` | wishes to receive messages again, in free text | U10 |
| `asks-if-person` | asks whether they are talking to a person | U8 |

U4 only checks that a flag is one of the seven. It acts on none. Three
of the names are also handover reasons, spelt the same; `names.ts` says
so. If row 29 is answered no, the four that U11 acts on have no actor in
M3.

Cases of the check (`readOutput`), each a test. Where an answer has more
than one fault, the code is the first in this order: `shape`, `flag`,
`claim`, `tool-call`.

| # | Given | Result |
| --- | --- | --- |
| S1 | The four parts, each valid | A new, frozen copy of the output; never the object that was handed in |
| S2 | A missing part; `null` for a part; a part of the wrong type | `shape` |
| S3 | A fifth key, at the top or inside a claim or a tool call | `shape` |
| S4 | Not an object at all: text, a number, a list, `null`, `undefined`; or an object that is not plain (a `Map`, a `Date`, one with a getter, one that holds itself) | `shape` |
| S5 | A text with half of a surrogate pair or a control character other than a line break, anywhere | `shape` |
| S6 | A flag that is not one of the seven, `__proto__` and `constructor` among them | `flag` |
| S7 | A flag twice | Accepted as that flag |
| S8 | A claim of a kind the request does not allow; an empty or over-long item or value; more than 30 | `claim` |
| S9 | A claim kind that the tenant's pack registers, in a request that allows it | Accepted; in a request that does not, `claim` |
| S10 | A tool call for a tool not on offer; two with one `id`; arguments that are a list, a text or `null`, too deep, too long, or with a refused key; more than 4 | `tool-call` |
| S11 | Tool calls together with a reply or with claims | `tool-call` |
| S12 | Two faults, one of each of two kinds | The earlier code in the order above |

**A known cost.** One unknown flag makes the whole answer invalid, a
valid `emergency` beside it included: the customer gets the fallback and
not the emergency text. The policy's order has it so (O1 before O2), and
the phrase list of step 4a, which is code, does not depend on the model.
The code never repairs an answer: nothing is trimmed, dropped or guessed
(ADR 0005: "not a best-effort parse"). Reading a repeated flag once is
not a repair; a list of flags is a set.

## 4. The limits on one call (#158) **(row 44)**

Each is a constant in `packages/core` and a row of the glossary.
`packages/core` is "pure rules with no model, prompt or tool in it" (ADR
0014); these numbers and the flags' names are there all the same,
because the glossary's other numbers and the shared names already are.
A change to one therefore touches a path the eval plan gates.

| Limit | Value | Why this number |
| --- | --- | --- |
| A reply's length (O7) | 1,200 code points | Several short paragraphs |
| Output tokens on one call | 4,096 | Below |
| Rounds of tool calls in one reply | 4 | A fifth answer that again asks for tools is a failed output check: the fallback, and nothing counted against the provider |
| Tool calls in one round | 4 | Section 3 |
| Claims in one answer | 30 | A week of opening hours is 14 values; a list of prices beside it fits |
| A batch's customer text | 8,000 code points | Below |
| A prompt file | 20,000 code points | Paid on every call |
| Timeout of one call | 20 seconds (the glossary's) | Not new |
| Timeout of `health()` | 5 seconds | A check of reachability should not take a call's time |
| Ceilings a request may not pass (C6) | `timeoutMs` 60,000; `maxOutputTokens` 8,192 | So that a wrong setting cannot make one call wait or cost without bound |

**The output limit, worked.** No model is chosen and no tokenizer was
run, so this rests on one assumption nobody has measured: **a code point
costs at most three tokens** in any supported script. Then a reply at
its limit is 3,600 tokens. That leaves about 500 for the structure and
a few claims, and not room for a full reply together with 30 claims of
full length in a script at that price. The limit is therefore unequal by
script: where a script costs more than the assumption, a long reply is
cut, the answer is `truncated`, and the customer gets the fallback.
`truncated` is its own code so that U17 can count it per language and
set the number that stays.

**What one reply can cost.** Up to 4 rounds of tools and an answer is 5
calls. With the three attempts of US-C15 that is up to 15 paid attempts,
each carrying the prompt (up to 20,000 code points), the profile (up to
40,000, row 41) and the session so far; and up to about 5 times 65
seconds. Row 38's "about 65 seconds" for the worst a turn may take
assumed one call. How the loop and the retries compose, and what that
does to the wait of row 38, is U7's and U15's to design; the price per
token is not known (ADR 0010 is open), so no amount of money is computed
here.

**The rule for a batch that is too long** (`boundBatch`, a pure
function; U7 calls it). It is given the texts of the batch's messages,
oldest first. A message with no text is not text and is not given to it
(guardrail policy, I2).

| # | The batch's texts, oldest first | What the model is given |
| --- | --- | --- |
| T1 | Together within the limit | All, as typed |
| T2 | Together over it | The newest, then the one before it, and so on while the next still fits whole. It stops at the first that does not fit: what is kept is the end of the batch, with no gap in it |
| T3 | The newest alone is over it | Its first 8,000 code points, and no other |
| T4 | Anything was left out or cut | The result says how many messages were left out and whether one was cut |
| T5 | An empty batch | Nothing kept, nothing left out |
| T6 | Where a cut falls | Between code points, never inside a surrogate pair. It can fall inside a letter with its marks, or inside a joined emoji: accepted |

What T4 reports reaches the model as a `data` message of two numbers,
which the prompt (U7) tells it how to read. **No sentence of instruction
is written in code.** Whether the customer should also be told by a
fixed text that part of what they sent was not read, which would not
depend on the model, is asked in row 44; it is not built here.

T3 keeps the start, though a request is often at the end. The number is
meant to be no smaller than one message the channel can carry, so that
T3 is met only by an abnormal sender; **what the channel's limit is has
not been read**, and U5, which reads Meta's page, confirms or changes
the 8,000.

The messages stay stored whole and are marked answered. The limit is on
what one call is given of the batch. **It bounds nothing else of the
input:** the session's earlier messages and the results of tools are
given to the model too, and their bound is U7's (what of a session a
turn sends) and U12's (the session's token budget). T54 stays partly
open until then.

**Where each limit is enforced:**

| Limit | Enforced by | In |
| --- | --- | --- |
| Output tokens, timeout | The request's required fields, `bounded` | U4 |
| Tool calls in one round, claims, arguments | `readOutput` | U4 |
| A prompt file | The loader | U4 |
| A batch's text | `boundBatch` | U4 (the function), U7 (its use) |
| Rounds of tool calls | The turn's loop | U7, with the constant from U4 |
| A reply's length | Output check O7 | U9, with the constant from U4 |

## 5. The scripted client

`FakeLlmAdapter` is given a script: a list of steps, one for each call,
in order. Used through `bounded`, like any adapter, it is the only
client in unit, integration and end-to-end tests (ADR 0005).

| Step | The call returns |
| --- | --- |
| `answer`, with any value and, if wanted, token counts | That value, for `bounded` to check: a valid output, or whatever malformed thing a test states |
| `truncated` | An answer the provider cut at the output limit |
| `provider-error`, with a code | That failure |
| `hang` | Nothing, until its signal is aborted: for C3 and C4 |
| `throw` | A thrown error: for C5 |

| # | Case | Result |
| --- | --- | --- |
| F1 | More calls than steps | A thrown error that says so. Through `bounded` it reaches the caller (C5), so a test that did not expect a call fails |
| F2 | Steps left over | `remaining()` is not 0; a test asserts it |
| F3 | What was asked | `calls` holds each request, so a test can read what the model was given |
| F4 | The same script twice, calls made one after another | The same results: no clock, no randomness. Calls that overlap take steps in the order they start, which a test should not rely on |
| F5 | `health()` | Scripted the same way, by its own list; `ok` when the list is empty |

The fake is not refused in production here. That guard is U14's, with
the adapter (#165).

## 6. Prompts

```text
prompts/
  README.md
  <name>/
    CHANGELOG.md          one heading for each version
    <version>/            a whole number, 1 or more
      prompt.md
      meta.yaml
```

**Each version has its own folder (row 45).** Which version runs is
named in code and changed by pull request, as ADR 0011's rule 6 and the
guardrail policy's section 10 have it: nothing here changes who may
change the running prompt or how. What the folders give is that going
back is a pull request of one line, and that a version written in a
trace means one text for good. **That a merged version's folder is not
edited afterwards is kept by review;** no test can know what was merged
before. The second part of review finding #227, that going back waits on
the provider because the eval plan runs a real model on any such pull
request, is not solved by this and stays open.

A pack's fragment is a prompt like any other, in the folder named for
the pack; the pack's object names its name and version, so it goes back
the same way.

`meta.yaml` has exactly these keys:

| Key | Is |
| --- | --- |
| `name`, `version` | Equal to the folders'. `version` is written as plain digits |
| `owner` | Text, 1 to 100 code points: a name or a handle, not an address |
| `model` | Text: the model the version was evaluated with, or `not-evaluated`. A record; the model a deployment uses comes from configuration |
| `parameters` | A map from names to numbers, texts or booleans; may be empty. A record, like `model` |
| `intended_use` | Text, 1 to 500 code points |

`AGENTS.md` section 6 lists the keys without `name`; it is added so that
a folder copied under another name is caught.

`loadPrompt(root, name, version)` and `assemblePrompt(core, fragment,
canary)`:

| # | Case | Result |
| --- | --- | --- |
| P1 | A prompt that is there and well formed | Its text and its `meta` |
| P2 | A name or a version that is not there | An error that names both; no fallback to another version |
| P3 | A name that is not 1 to 40 of a to z, digits and hyphens, starting with a letter; a version that is not a whole number from 1 to 9,999 | Refused before the disk is touched: no `..`, no path |
| P4 | A folder or file that, followed through links, is outside `root` | Refused |
| P5 | `meta.yaml` missing; not YAML; with a key twice, an anchor, an alias or a second document; missing a key or with another; a value of the wrong kind; `version` written as `"1"`, `01`, `1.0`, `1e0` or `0x1`; a name or version that is not its folder's | An error that names the file and the key |
| P6 | `CHANGELOG.md` missing, or with no heading for this version (`## <version>`) | Refused |
| P7 | A prompt file that is empty, not UTF-8, over 20,000 code points, or with a control character other than a line break | Refused |
| P8 | The core prompt, assembled | Its text with the canary in place of the one placeholder, written exactly `{{canary}}` |
| P9 | A core prompt with no placeholder, or with two | Refused: the canary check (O6) would be blind |
| P10 | `{{` or `}}` anywhere else in a prompt or a fragment, `{{ canary }}` with spaces included | Refused: nothing else is ever filled in, so no customer's or owner's text can enter the instructions (T13). An example that needs two braces together writes them apart; the README says so |
| P11 | A canary that is not 16 to 64 of the letters a to z, A to Z and digits | Refused |
| P12 | A pack with a fragment | The core's text, an empty line, the fragment's text. No line is written by code. The result lists both names and versions, for the trace (U6) |
| P13 | A pack with no fragment | The core's text alone |
| P14 | A fragment with a placeholder | Refused, by P10 |
| P15 | The same inputs twice | The same text, byte for byte |

The canary is the caller's argument. Where a deployment's canary comes
from, and how `root` is found in the image, are U7's. The assembled
result also carries the instruction text without the canary, which the
repetition check (O6, U9) compares a reply with.

**No prompt is added in U4.** `prompts/` holds its README. The loader is
tested on folders its tests write. That `prompts/` reaches the image is
not tested until there is a prompt (U7).

**A scan of `prompts/`** (NFR-V6, "pattern scan in CI"): a test fails if
any file under `prompts/` holds an email address, or seven or more
digits in a run when spaces and punctuation between them are ignored, in
any script's digits. It is shown to find each on planted files. It shows
that something like a contact's detail is there. **It cannot tell a
conversation from an example written for the prompt,** so it does not
look for one; that no real conversation is copied into a prompt is kept
by review.

**No provider's library outside its adapter** (ADR 0005, Confirmation):
a test reads every source file and every `package.json` of the
workspace. A known provider's or model framework's package may be
imported only under `packages/ai/src/adapters/`, and be a dependency
only of `packages/ai`. It is a list of names kept in the test, shown to
see each on planted lines: a library it does not know, or a plain HTTP
call to a provider, passes. No adapter exists yet, so today it finds
none.

## Dependency

`yaml` 2.9.1 is in the repository as a tool's dependency. The loader
reads `meta.yaml` at run time, so it becomes a dependency of
`packages/ai` at the same version. Its licence, upkeep and advisories
are recorded in the pull request.

## Departures, and what is amended

- ADR 0005 says the interface takes "a prompt name and version". The
  request takes the assembled text and the names and versions: the
  adapter does not read files. ADR 0005 is amended in this pull request,
  with the split into an adapter and a client and with C5.
- The issue says "prompts under `prompts/` with a version and a
  `meta.yaml`". The format and the loader are built; the first prompt is
  U7's, where its wording can be reviewed with the turn that uses it.
- `AGENTS.md` section 6 has one folder per prompt with a version in
  `meta.yaml`, and no `name` key. Row 45.
- ADR 0014 has a pack supply "the name of a prompt"; here it supplies
  the name and the version.
- Brought up to date in this pull request: `AGENTS.md` section 4 (the
  new packages); the guardrail policy's I3, A6 and O7 and the threat
  model's T54, which wait on #158; the glossary.

## Evals

This pull request changes `packages/ai`, `packages/core` and a pack,
which the eval plan's section 8 says runs the subset against a real
model. There is no harness and no model (rows 31 and 32, not answered).
What is attached instead is the run of the tests against the scripted
client; no score exists.

## Not in U4

A provider's adapter and the guard against the fake (U14); traces and
cost (U6); the reply prompt, the turn's loop, tools, what of a session a
call is given, where the canary comes from (U7); the output checks and
what a claim must equal (U9); acting on any flag (U8, U10, U11); the
session's token budget (U12); retries and degraded mode (U15).
