---
status: "proposed by the agent; accepted when the maintainer merges it"
date: 2026-11-23
decision-makers: "agent (proposal), maintainer (approval)"
---

# A pack is one typed object, listed in a registry; M3 builds three of its parts and reserves the rest

## Context and Problem Statement

ADR 0012 decided **what** belongs to the core and what to the booking
pack. It did not decide **how** a pack hands its parts over. The Gate 2
structure review listed "the pack interface and registration" among
decisions with no record (finding S32, #200), and until now nothing
needed the answer: the pack is a list of names and a test.

M3 builds the turn (U7), the output checks (U9), the fixed texts (U8),
buttons in the channel (U5) and perhaps the handover record (U11). Each
is a place where the booking pack will later put something of its own.
Built with no thought for that, M5 reopens each of them. Built around a
full interface designed today, M5 reworks a guess: one real pack exists
and it is not written.

The first draft of this record took the second road and shaped six parts
at once. Its review found most of them under-decided or wrong
(`docs/reviews/2026-11-23-adr-0014-review.md`). This version decides
less: how a pack is registered, the three parts an M3 unit actually
exercises, and a short list of rules that keep M3 from closing the door
on the others.

## Decision Drivers

- NFR-M1: the trial pack `faq-only` is completed at the end of M5 with
  no file changed under `packages/core`.
- ADR 0012: the pack interface "must not grow machinery that only a
  hypothetical second pack would use". The same holds for machinery only
  a not-yet-written first pack would use.
- ADR 0012's rules for pack code: no cross-tenant role, no call to the
  channel or the model, no message sent except through the core's checks.
- ADR 0003, as amended: SQL is written in `packages/db` only.
- The boundary test must go on passing, and must be changed on purpose,
  not by accident of a package's name.
- What is registered must be knowable without running anything.

## Considered Options

- A. One typed object per pack, listed in a registry package; the whole
  interface shaped now
- B. The same registration, but only the parts M3 exercises are shaped
  now; the others are named, with the rules M3 must keep for them
- C. No interface in M3: M3's units are built with whatever seams they
  need, and the interface is written in M5 with the pack
- D. The parts' types live in `packages/core` or in `packages/ai`, with
  no package for the interface
- E. Packs are found at run time, or subscribe to events the core raises

## Decision Outcome

Chosen option: **B**. A was the first draft and decided things nobody
can check yet. C leaves each M3 unit to invent its own seam, and the
plan already commits U7 and U9 to prove a tool and a claim kind through
one; without a record they would be five private guesses. D would put
types that speak of prompts and tools into `packages/core`, which the
architecture keeps free of both, or into `packages/ai`, which every pack
would then import whole, provider client and all. E hides what runs and in what order.

In this record **"the core side"** means every package and program that
is not under `packages/packs`: `packages/core`, `db`, `channel`, the
`ai` package M3 adds, and the programs. `packages/core` alone is written
as such, and "the core's" below means the core side's.

### Registration

| Place | Package name | Holds | May import |
| --- | --- | --- | --- |
| `packages/pack-interface` | `@polyglot-sales-agent/pack-interface` | The type `Pack` and the types of its parts. No pack's name | `packages/core` |
| `packages/packs/<name>` | `@polyglot-sales-agent/pack-<name>` | One pack. Its default export is a `Pack` | The interface, `packages/core` |
| `packages/packs/registry` | `@polyglot-sales-agent/packs-registry` | A map from name to `Pack`, and nothing else | Each pack, the interface |

- Pack names are lower-case letters, digits and hyphens. `core`,
  `interface` and `registry` are not pack names; the registry's test
  refuses them.
- **In M3 `booking` and `faq-only` are both packs with a name and
  nothing else.** `packages/packs/booking` gains a default export beside
  its word list; `packages/packs/faq-only` is a new package (see below,
  and row 37).
- `packages/core` imports none of the three. `packages/ai`, `apps/api`
  and `apps/worker` may import the interface. `db` and the channel
  packages do not; where a channel package needs the owner of a button's
  payload it takes it from `packages/core`.
- **Only `main.ts` of `api` and of `worker` imports the registry,** and
  passes it to the code it starts. `ops` does not import it: it keeps
  its own list of accepted names, as built, and a test in `apps/ops`
  compares that list with the registry's keys. Everything below takes the registry as an
  argument, so a test passes its own, holding a pack written in that
  test's files. No shared test pack is kept anywhere.
- A tenant is on exactly one pack, the value of `tenants.pack`, as the
  glossary and US-D6 already have it. Nothing in v1.0 changes a tenant's
  pack after it is created, and this record adds no way to.
- Work for a tenant whose pack is not in the registry is a failed job:
  retried and then dead, with its alert, like any job that cannot be
  done (NFR-R5). The customer gets no reply. It happens through bad data
  or a build that left a pack out.
- **`faq-only`** is accepted by `ops` today and is a value of
  `tenants.pack` in the data model and the API; it has no package. A
  tenant an operator creates on it today would, once the worker looks
  packs up, be nothing but dead jobs. It is registered in M3 as a pack
  with a name and nothing else.
  Its prompt fragment and its evals are still added at the end of M5,
  and NFR-M1 is still measured then, on `packages/core`. What that trial
  loses is the act of adding a line to the registry. The other course,
  removing the name from `ops`, the data model and the API until M5, was
  the first draft's; it changes a built command for the sake of a
  cleaner trial. (Six test fixtures also use the name. They write it by
  SQL and are handed a registry by their test, so neither course touches
  them.) **This is put to the maintainer as row 37.**

### The three parts M3 builds

A pack with only a name is valid. Sketched, not final:

```ts
type Pack = {
  name: string;                        // equals tenants.pack
  promptFragment?: PromptFragment;
  tools?: Tool[];
  claimKinds?: ClaimKind[];
};
```

| Part | The pack supplies | The core side does | Built in |
| --- | --- | --- | --- |
| Prompt fragment | The name of a prompt. The prompt itself lives under `prompts/`, in a folder named for the pack, in the form `AGENTS.md` section 6 gives every prompt | The loader adds it to the system prompt after the core's text. It is instruction written by this repository, not data, and is not wrapped as data; the output check on repeated instruction text covers it. A pack with none adds nothing. The trace records the fragment's name and version beside the core prompt's, in columns U6 adds to `ai_traces` | U4 (loader), U6, U7 |
| Tool | A name unique in the pack, a description, a schema for its arguments, whether it changes state, and a function | Offers it to the model; validates the arguments; runs every tool in a transaction that first checks the lease, as the architecture has it; calls the function; writes the `tool_calls` row; gives the result to the model as data and to the output checks. "A state-changing tool succeeded" is known from the tool's own flag and its result | U7, with a tool written in its tests |
| Claim kind | A name unique in the pack and not one of the core's, and a function that says whether a claim of that kind holds | Runs it for each claim of that kind. A claim of a kind nobody registered fails. Finding values in a reply, normalising them, and the scan for values with no claim stay the core side's: a pack cannot add a kind of value to look for | U9, with a kind written in its tests |

What a pack's function is given, in M3:

- A **tool** gets its validated arguments, the identifiers of the
  tenant, conversation, contact and session, and the time. It returns a
  result or a refusal.
- A **claim kind** gets the claim, the normalised value, and the tool
  results of this session with their times. It returns yes or no. It is
  given nothing it could change.
- **Neither is given a database handle, a channel, a model client or a
  credential.** No pack has a table in M3, and how a pack will read and
  write its own tables cannot be settled without amending ADR 0003: SQL
  outside `packages/db`, or a pack's SQL inside a package the boundary
  test scans. That is M5's decision, made with the first real table.

Because a tenant's pack decides its tools and claim kinds, the output
schema's lists of both are built per tenant, not fixed.

### What is reserved, and the rules M3 keeps for it

None of these is built or shaped in M3. Each has a rule so that an M3
unit does not have to be reopened for it.

| Later part | The rule M3 keeps | Shaped in |
| --- | --- | --- |
| Fixed texts of a pack | Every fixed-text key has an owner part: `core.<key>` now, `<pack>.<key>` later. U8 stores no text in a way that assumes one owner. Placeholders and a text that carries a pack's button are not designed | M5 |
| Buttons of a pack | Every button payload begins with an owner: `core.` for the core's own buttons (stop, start or opt-in, person: U5 says whether start and opt-in are one), a pack's name later. What follows the owner and the action is the owner's. In M3 a tap whose payload has another owner, no owner, or an action the core does not have is stored, gets no reply, counts towards the rate limit, and ends where step 6 would be, before steps 7 to 15: it does not join a waiting session and is not a customer message for the handover machine. U10 builds this and writes it into the order of checks. Whether the channel returns a payload as it was sent, and its limit on length, are not known: U5 reads both from Meta's pages. U5's check of whose conversation a tap came from (#222, first half) is unchanged | M5 |
| A pack's part in the order of checks | Steps 6, 10, 13 and 15 name the booking pack's buttons in the document. The code M3 writes for steps 10, 13 and 15 names no button but the core's own, and step 6 is not built. What a handed-over session answers to a pack's button, what the model is given for one, and whether one counts as text are decided with the Confirm, Reschedule and Cancel buttons | M5 |
| Handover reasons of a pack | `late-change` stays in `packages/core/src/names.ts` as the one known exception, as ADR 0012's amendment has it. U11, if it is built, raises only the core's reasons and adds no database constraint that would stop a pack's reason being stored later | M5 |
| Session outcome | U2 creates `sessions.pack_outcome` as the data model has it, a text the core side does not read. Nothing writes it | M5 |
| Consent asked for by a pack | U10 creates `consent_records` with `subject_type` and `subject_id` as the data model has them; in M3 only the core's own events write a record | M5 |
| Templates; templates; jobs; migrations; settings; routes; metrics; dashboard sections; a pack's evals | Nothing in M3 | M5 |

### How this maps onto the parts listed before

The architecture lists nine parts and ADR 0012 adds four. Against this
record:

| Listed before | Here |
| --- | --- |
| Tools; prompt fragments | Built in M3 |
| (not listed) claim kinds | Built in M3. ADR 0012 gave the booking pack claim kinds without making them a part |
| Buttons; templates; scheduled events and timers; session labels; migrations; settings; routes; dashboard sections; evals | Reserved, M5. "Session labels" is the session outcome; "scheduled events" and "timers" are a pack's jobs |
| Profile schema | Superseded by ADR 0012: the business profile is the core's. Whether a pack adds to it is M5's |
| (not listed) fixed texts; handover reasons; consent requests; metrics | Reserved, M5. Each is a thing ADR 0012 or the design gives the pack without naming a part for it |

The architecture's table is not rewritten here; it carries a note
pointing to this record.

### Consequences

- Good, because U4, U7 and U9 build to one stated seam, with a test of
  the registry in U4 and of a part in U7 and U9.
- Good, because the list of what can run is a file, and tests do not
  depend on it.
- Good, because the parts nobody can check yet are not decided yet.
- Bad, because three parts are still shaped before the pack that will
  use them is written. A tool written in a test exercises the loop and
  says nothing about whether booking fits what a tool is given. With no
  database handle, the booking pack's tools cannot be written against
  this interface as it stands: M5 must widen it.
- Bad, because M5 carries most of the interface, and the rules reserved
  above are promises a later unit can break without a test noticing.
  The absence of the pack's words in the core side is checked by code
  today; a test of the owner part is for U5 (payloads) and U8 (keys) to
  add; the rest is checked by review.
- Bad, because adding a pack is a change to the registry, so "no core
  change" is true of `packages/core` and not of the repository.
- Neutral, because one pack per tenant is kept, not decided here.

### Confirmation

The boundary test (`packages/packs/booking/src/boundary.test.ts`) is
changed on purpose, in these places, by U4 unless said:

- Its pinned list of scanned folders gains `packages/pack-interface`,
  and `packages/ai` in whichever unit creates that folder. Both are
  scanned for the pack's words like the rest.
- Its import rule, today "no file imports anything named `pack-…`",
  becomes three: `packages/core`, `db` and the channel packages import
  neither the interface nor the registry; no scanned file imports a pack
  by name or by path; only `main.ts` of `api` and of `worker` imports
  the registry. The rule has to tell `pack-interface` from `pack-<name>`
  by its name, which is why `interface` is not a pack's name. The
  package-dependency rule changes to match.
- `apps/ops` stays outside the scan: it still names the packs.
- New tests. In the registry's folder: each pack's `name` equals its
  key, no key is a reserved name, and the file holds nothing but the
  map. In `apps/ops`: its list of accepted names equals the registry's
  keys.

In U7 and U9, a test registers a pack written in that test and shows the
part working through the registry passed in. The fragment is shown in
U7. The trial pack at the end of M5 remains the real check (NFR-M1), and
`cod-confirm` in v1.1 the first against a different use case.

Nothing in this record was run. It was checked against the documents and
the code it names.

## Pros and Cons of the Options

### A. Registry, and the whole interface now

- Good, because every unit would know every part.
- Bad, because its first draft could not say what a button's reference
  is, what a pack may do with the database, or what the model is given
  for a tap, without contradicting a document that M5 owns.

### B. Registry, the three parts M3 exercises, rules for the rest

- Good, because what is decided is used and tested in the same
  milestone.
- Bad, because the rules for reserved parts are prose.

### C. No interface until M5

- Good, because nothing is guessed.
- Bad, because the plan's tool loop and claim checker are still built in
  M3, each with a seam of its own making, and M5 reconciles them.

### D. Types in `packages/core` or `packages/ai`

- Good, because there is one package fewer.
- Bad, in `packages/core`, because it is pure rules with no model,
  prompt or tool in it, and the pack's types name all three.
- Bad, in `packages/ai`, because a pack would depend on the package that
  holds the provider's client in order to name a tool's type.

### E. Found at run time, or subscribed to events

- Good, because a deployment could add a pack without a build, or the
  core side could know nothing of packs.
- Bad, because what runs would depend on a setting or on what is on
  disk; because the order of checks would be spread over subscribers;
  and because nothing asks for either.

## More Information

- ADR 0012 and its amendment of 2026-11-20; ADR 0003 and its amendment;
  `architecture.md`, "What a pack provides" and "Processing one turn";
  state machines, sections 1 and 6; guardrail policy, sections 2 to 4
  and 7; data model, `messages.button_payload`.
- Findings S32 (#200) and V9 (#237); #278; #253 (V8 / S4); #295; #222;
  #240.
- `docs/plans/m3-ai-core.md`, unit U1, changed with this record: U4
  creates the packages and changes the boundary test, and U5 follows
  this record's rule for payloads.

**What would reopen this:** a part M3 builds that the booking pack
cannot use in M5 without changing its shape; a second pack per tenant;
packs written outside this repository.

### Not settled here

- The types themselves: each is written and reviewed in the unit that
  first uses it.
- Everything in the "reserved" table, and with it #222 (whose button a
  tap is), #240 (rules across claim kinds and about the turn), and the
  slot and calendar-date rules of the guardrail policy.
- How a pack reaches its own tables (ADR 0003), and how its migrations
  are kept apart from the core's.
- The places ADR 0012 lists where documents still name bookings, the
  state machines among them: M5, with the code they describe. #253 and
  #237 stay open for them. The package diagram does have the edge from
  `api` to `pack` that both findings report missing; it lacks the
  registry, the edge from the interface to `packages/core`, and `ops`.
- The boundary test's word list and "a name, not an idea" (#295): the
  list does not change here; M5.
- The other decisions #200 lists with no ADR: each in the milestone that
  builds it; #200 stays open.
- `AGENTS.md` section 4 does not list the two new packages; it is
  brought up to date in U4, when they exist.
- The threat model's entries on what pack code can reach (T39, T48) are
  not changed, because M3 gives pack code nothing to reach. M5 revisits
  them with the database question.

## Amendment, 2026-11-23 (M3 unit U4)

Proposed by the agent with the code.

- **A prompt fragment is a prompt's name and its version,** where the
  table above has "the name of a prompt". The pack's object names both,
  so that a trace says exactly which text ran and a fragment goes back
  to an earlier version by a pull request, like the core's prompt
  (decisions row 45).
- **Built in U4:** `packages/pack-interface` (the type, the lookup by
  name, the check of a name), `packages/packs/registry`, and `booking`
  and `faq-only` as packs with a name. `tools` and `claimKinds` are not
  in the type yet. Nothing imports the registry but tests: the two
  `main.ts` files will when the turn exists (U7).
- **`apps/ops` depends on the registry for its test only.** The program
  does not import it, and a test reads its sources to show that.

## Amendment, 2026-11-24 (M3 unit U5)

Proposed by the agent with the code. It answers what the table above
asked of U5.

- **Whether start and opt-in are one button:** one, `core.start`
  (decisions row 46). The core defines three payloads, `core.stop`,
  `core.start` and `core.person`. Which messages carry which button is
  U8's.
- **Whether the channel returns a payload as it was sent, and its limit
  on length:** Meta's page on reply buttons, read on 2026-11-24, gives a
  button an identifier of at most 256 characters and shows it returned in
  the tap. No live tap has been seen. A payload is therefore 1 to 256
  printable ASCII characters without spaces, the same in the interface,
  the core and the table, and a channel may carry less: the in-memory
  channel carries 100.
- **The owner test:** `packages/core/src/buttons.test.ts` shows that
  every payload the core builds begins `core.` and reads back as its
  action, and that a payload of another owner is not one of the core's
  buttons.
- **Whose conversation a tap came from (#222, first part):** a tap is
  stored in the conversation of the customer who sent it, with the
  identifier of the message it names. Whether that message was sent in
  the same conversation is found when asked, and is a record: for the
  core's buttons it is not a condition, since each of them acts only on
  the sender's own conversation. A pack whose button names something of
  value must check that the thing belongs to the sender (M5).
