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
- D. The parts' types live in `packages/core`, with no package for the
  interface
- E. Packs are found at run time, or subscribe to events the core raises

## Decision Outcome

Chosen option: **B**. A was the first draft and decided things nobody
can check yet. C leaves each M3 unit to invent its own seam, and the
plan already commits U7 and U9 to prove a tool and a claim kind through
one; without a record they would be five private guesses. D would put
types that speak of prompts and tools into a package the architecture
keeps free of both. E hides what runs and in what order.

In this record **"the core side"** means every package and program that
is not under `packages/packs`: `packages/core`, `db`, `channel`, the
`ai` package M3 adds, and the programs. `packages/core` alone is written
as such.

### Registration

| Place | Package name | Holds | May import |
| --- | --- | --- | --- |
| `packages/pack-interface` | `@polyglot-sales-agent/pack-interface` | The type `Pack` and the types of its parts. No pack's name | `packages/core` |
| `packages/packs/<name>` | `@polyglot-sales-agent/pack-<name>` | One pack. Its default export is a `Pack` | The interface, `packages/core` |
| `packages/packs/registry` | `@polyglot-sales-agent/packs-registry` | A map from name to `Pack`, and nothing else | Each pack, the interface |

- `packages/core` imports none of the three. `packages/ai`, `apps/api`,
  `apps/worker` and `apps/ops` may import the interface. `db` and the
  channel packages do not.
- **Only a program's entry point imports the registry,** and passes it
  to the code it starts. Everything below takes the registry as an
  argument, so a test passes its own, holding a pack written in that
  test's files. No shared test pack is kept anywhere.
- A tenant is on exactly one pack, the value of `tenants.pack`, as the
  glossary and US-D6 already have it. Nothing in v1.0 changes a tenant's
  pack after it is created, and this record adds no way to.
- Work for a tenant whose pack is not in the registry is a failed job:
  retried and then dead, with its alert, like any job that cannot be
  done (NFR-R5). The customer gets no reply. It can happen only through
  bad data, given the next point.
- **`faq-only`** is accepted by `ops` today, is a value of `tenants.pack`
  in the data model and the API, and is used by six test fixtures; it
  has no package. It is registered in M3 as a pack with a name and
  nothing else, which is what the registry needs to match what exists.
  Its prompt fragment and its evals are still added at the end of M5,
  and NFR-M1 is still measured then, on `packages/core`. What that trial
  loses is the act of adding a line to the registry. The other course,
  removing the name from `ops`, the fixtures and two documents until M5,
  was the first draft's; it changes a built command for the sake of a
  cleaner trial. **This is put to the maintainer as row 37.**

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
| Prompt fragment | A file in the pack's own folder, in the form of the core's prompts: text, and a `meta.yaml` with its version | The loader adds it to the system prompt after the core's text. It is instruction written by this repository, not data, and is not wrapped as data. A pack with none adds nothing. The trace records both versions | U4 (loader), U7 |
| Tool | A name unique in the pack, a description, a schema for its arguments, whether it changes state, and a function | Offers it to the model; validates the arguments; checks the lease; opens the transaction if the tool changes state; calls the function; writes the `tool_calls` row; gives the result to the model as data and to the output checks. "A state-changing tool succeeded" is known from the tool's own flag and its result | U7, with a tool written in its tests |
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
| Buttons of a pack | Every button payload begins with an owner: `core.` for the stop, start, person and opt-in buttons, a pack's name later. Names are lower-case letters, digits and hyphens; what follows the owner and the action is the owner's. In M3 a tap whose owner is not `core` is stored, gets no reply, counts towards the rate limit, and ends. The channel's limit on a payload's length is not known: U5 reads it from Meta's pages | M5 |
| A pack's part in the order of checks | Steps 6, 10, 13 and 15 name the booking pack's buttons in the document. The code M3 writes for steps 10, 13 and 15 names no button but the core's own, and step 6 is not built. What a handed-over session answers to a pack's button, what the model is given for one, and whether one counts as text are decided with the Confirm, Reschedule and Cancel buttons | M5 |
| Handover reasons of a pack | `late-change` stays in `packages/core/src/names.ts` as the one known exception, as ADR 0012's amendment has it. U11, if it is built, raises only the core's reasons and adds no database constraint that would stop a pack's reason being stored later | M5 |
| Session outcome | U2 creates `sessions.pack_outcome` as the data model has it, a text the core side does not read. Nothing writes it | M5 |
| Consent asked for by a pack; templates; jobs; migrations; settings; routes; metrics; dashboard sections; a pack's evals | Nothing in M3 | M5 |

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

- Good, because U4, U7 and U9 build to one stated seam, and a test in
  each uses it.
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
  Only the owner part of keys and payloads, and the absence of the
  pack's words in the core side, are checked by code.
- Bad, because adding a pack is a change to the registry, so "no core
  change" is true of `packages/core` and not of the repository.
- Neutral, because one pack per tenant is kept, not decided here.

### Confirmation

The boundary test (`packages/packs/booking/src/boundary.test.ts`) is
changed in U4, on purpose, in these places:

- Its pinned list of scanned folders gains `packages/pack-interface` and
  `packages/ai`. Both are scanned for the pack's words like the rest.
- Its import rule, today "no file imports anything named `pack-…`",
  becomes three: `packages/core`, `db` and the channel packages import
  neither the interface nor the registry; no scanned file imports a pack
  by name or by path; only the entry points of `api` and `worker` import
  the registry. The package-dependency rule changes to match.
- `apps/ops` is outside the scan today because it names the packs. Once
  it reads them from the registry, whether it can be scanned is looked
  at in U4.
- A new test: the registry's keys are exactly the names `ops` accepts,
  each pack's `name` equals its key, and the registry file holds nothing
  but the map.

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

### D. Types in `packages/core`

- Good, because there is one package fewer.
- Bad, because `packages/core` is pure rules with no model, prompt or
  tool in it, and the pack's types name all three.

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
