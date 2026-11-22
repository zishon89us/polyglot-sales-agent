---
status: "proposed by the agent; accepted when the maintainer merges it"
date: 2026-11-23
decision-makers: "agent (proposal), maintainer (approval)"
---

# A pack is one typed object in its own package, listed in a registry the programs read at start-up

## Context and Problem Statement

ADR 0012 decided **what** belongs to the core and what to the booking
pack. It did not decide **how** a pack hands its parts to the core, and
the Gate 2 review called that the project's central bet with no record
(findings S32 and V9; #200, #237). Until now nothing needed the answer:
the pack is a list of names and a test.

M3 needs it. The turn (U7), the output checks (U9), the fixed texts (U8),
the buttons (U5, U10) and the handover record (U11) are each a place
where the booking pack will later put something of its own: a tool, a
claim kind, a text, a button, a reason. If those units are built with no
such place, M5 reopens every one of them. If they are built around a
guess, M5 reworks the guess. This record makes the guess once, in the
open, and says how much of it M3 builds.

## Decision Drivers

- NFR-M1: the trial pack `faq-only` is added at the end of M5 with no
  file changed under `packages/core`.
- ADR 0012's rules for pack code: it never holds the cross-tenant role,
  never calls the channel or the model, and never sends a message except
  by creating one for the core to check and send.
- One real pack exists. Each part of the interface is paid for by that
  pack or by an M3 unit, not by a pack someone might write.
- The boundary test must go on passing: the core names nothing of
  bookings, and no word list can be the only guard.
- What is registered must be knowable without running anything: a
  reviewer, the production guard and the eval harness all need the list.

## Considered Options

- A. A pack is one typed object, exported by its package and listed in a
  registry package that the programs import
- B. Packs are found at run time, by a setting or by scanning a folder
- C. The core raises events and packs subscribe to them

## Decision Outcome

Chosen option: **A**, because every part a pack supplies is then visible
to the type checker and to a reader, a pack that is not listed cannot
run, and nothing is loaded that the image was not built with. B buys
packs that can be added without a build, which nobody has asked for and
which is a way for code to arrive unreviewed. C hides the order in which
things happen, and the order of checks is the part of this system that
must not be hidden.

### The shape

Three places, each with one job:

| Place | Holds | May import |
| --- | --- | --- |
| `packages/pack` | The interface: the type `Pack` and the types of its parts. No pack's name | `core` |
| `packages/packs/<name>` | One pack. Its default export is a `Pack` | `pack`, `core`, and through what it is handed at run time, the database |
| `packages/packs/registry` | The list of packs in this build, by name | Each pack |

`apps/api`, `apps/worker` and `apps/ops` import the registry and nothing
else under `packages/packs`. `core` imports none of the three. The
registry sits under `packages/packs` because it must name the packs, and
that folder is the one the boundary test does not scan for the pack's
words.

A tenant is on exactly one pack, the value of `tenants.pack`, set when
the tenant is created. A program looks the pack up by that name for each
piece of work; a name the registry does not hold is an error at start-up
for the operator's command and a refused job for the worker, never a
silent fall back to no pack.

### The parts

A pack is a plain object. Every part but its name is optional, and a
pack with only a name is a valid pack. Sketched, not final:

```ts
type Pack = {
  name: string;                      // equals tenants.pack
  promptFragments?: PromptFragment[]; // versioned text, loaded like the core's
  tools?: Tool[];
  claimKinds?: ClaimKind[];
  fixedTexts?: FixedText[];
  buttons?: Button[];
  handoverReasons?: string[];
  // Named here so that their place is reserved; shaped in M5:
  // migrations, settings, routes, jobs, templates, profile additions,
  // session outcome, metrics, evals
};
```

| Part | What the pack supplies | What the core does with it | First built |
| --- | --- | --- | --- |
| Prompt fragment | Text with a version, describing the pack's task | The loader puts it after the core's prompt, inside its own delimiters; the trace records both versions | U4, U7 |
| Tool | A name, a description, a schema for its arguments, and a function | Offers it to the model; validates the arguments; calls the function with a context (below); gives the result to the model as data and to the output checks | U7, with a tool that exists only in tests; M5 for a real one |
| Claim kind | A name and a function that says whether a claimed value matches what is stored | Runs it for each claim of that kind. A claim of a kind nobody registered fails. The scan for values with no claim stays the core's | U9, with a kind that exists only in tests |
| Fixed text | A key and its wording per language | Stores and sends it as a system reply, like its own; the key is prefixed with the pack's name | U8 |
| Button | An action name and a function | Builds the payload (`<pack>:<action>:<reference>`), checks on a tap that the reference belongs to the conversation it came from, and calls the function at the steps below | U5 for the payload and the check; U10 and U11 for the steps, with a button that exists only in tests |
| Handover reason | Names of reasons only this pack raises | Accepts them beside its own closed list; stores the name; shows it | U11, if it is built; otherwise M4 |

The context a pack's function receives is made by the core for one piece
of work and holds: the tenant's database scope (never the cross-tenant
one), the conversation, contact and session it concerns, the clock, and
three things it may ask for: a fixed text or template to be sent, a
handover to be opened with a reason, a consent record to be written. It
holds no channel, no model client and no credentials. What a function
asks for is a request: the core's send policy, permission machine and
order of checks decide what happens.

### Where the order of checks meets a pack

The order of checks names the booking pack's buttons in three steps
(ADR 0012, known exceptions). In code those steps name no button:

| Step | In the document | In code |
| --- | --- | --- |
| 6 | The Confirm button of a reminder | A tap on a button whose pack marked it "handled by code in every state". The pack's function runs. **Ends.** |
| 10 | In a handed-over session, a Reschedule or Cancel tap gets "booking unchanged" | In a handed-over session, a tap on a pack's button: the pack's function is told the session is handed over and answers with a fixed text or nothing |
| 13 | A Reschedule or Cancel tap counts as text | A tap on a pack's button that is not handled by code counts as text, and reaches the model as the button's label |

The contact-permission machine's event "contact books in chat" is, in
code, "a pack asked for a consent record", with the subject the pack
names. The handover reason `late-change` is the booking pack's and
leaves `packages/core/src/names.ts` in the unit that builds the handover
record (#278, E8); the check of shared names then reads a pack's list
as well as the core's.

### What M3 builds, and what it does not

M3 builds the three packages, the six parts in the table, and the
context. It builds them for its own units' sake and proves each with a
**pack that exists only in test files**: one tool, one claim kind, one
fixed text, one button, one reason. The booking pack in M3 is its name,
its word list and an empty `Pack`. A tenant on it is answered from the
business profile with no tools.

M3 does not build migrations, settings, routes, jobs, templates, profile
additions, session outcome, metrics or evals for packs. ADR 0012 lists
what the core does with each; their types are written in M5, with the
pack that needs them.

### Consequences

- Good, because M3's units have one answer to "where would the pack put
  its part", and it is checked by a test in each unit.
- Good, because the list of what runs is a file.
- Good, because the three known exceptions of ADR 0012 that are rules
  (steps 6, 10 and 13; the consent event; `late-change`) each have a
  stated way out, and two are taken in M3.
- Bad, because six parts are shaped by a pack that has not been written.
  A tool that exists only in tests exercises the loop and says nothing
  about whether booking fits the context it is given. M5 will change
  some of this, and this record is amended when it does.
- Bad, because a pack's function runs in the core's process with the
  tenant's database scope: a faulty pack can read and write every table
  of its tenant, the core's included. Row-level security holds it to one
  tenant and nothing holds it to its own tables. Packs are first-party
  code in this repository, reviewed like the core; this is not a way to
  run someone else's code.
- Bad, because adding a pack is a change to the registry, so "no core
  change" (NFR-M1) is true of `packages/core` and not of the repository.
- Neutral, because one pack per tenant is kept. Two packs for one tenant
  would need rules for whose prompt, whose tools and whose buttons, and
  nothing asks for it.

### Confirmation

- **Import tests,** extended in the unit that creates the packages (U4):
  `core` imports nothing of the three places; `pack` imports no pack;
  the programs import the registry only. The boundary test's word scan
  covers `packages/pack` as it covers the core.
- **A test pack in each unit that builds a part** (U7, U8, U9, U10,
  U11): the part is used through the interface and through nothing else.
- **A registry test:** every name `apps/ops` accepts for a new tenant is
  in the registry, and each pack's `name` equals its key. Today `ops`
  accepts `faq-only`, which has no package. U4 takes that name out of
  what `ops` accepts until M5 adds the pack; adding it now as an empty
  pack would empty the trial of NFR-M1.
- **The trial pack, end of M5,** remains the real check (NFR-M1), and
  `cod-confirm` in v1.1 the first one against a different use case.

## Pros and Cons of the Options

### A. One typed object per pack, listed in a registry

- Good, because the compiler checks every part.
- Good, because it is the least machinery: an object and a map.
- Bad, because a new pack needs a build and a change outside its folder.

### B. Packs found at run time

- Good, because a deployment could add a pack without a new image.
- Bad, because what runs then depends on a setting or on what is on
  disk, which the production guard would have to police.
- Bad, because nothing needs it: every pack is in this repository.

### C. The core raises events and packs subscribe

- Good, because the core would know nothing about packs at all.
- Bad, because the order of checks would be spread over subscribers, and
  whether a step "ends" would depend on who was listening.
- Bad, because a tool, a claim kind and a route are not events.

## More Information

- ADR 0012, with its amendment of 2026-11-20; `architecture.md`, "What a
  pack provides"; state machines, sections 1 and 6.
- Findings S32 (#200) and V9 (#237); #278; #253 (V8 / S4); #295.
- `docs/plans/m3-ai-core.md`, unit U1.

### What this record does not settle

- **The types themselves.** The sketch above is not an API. Each part's
  type is written, and reviewed, in the unit that first uses it.
- **Pack migrations, and how a pack's tables are kept apart from the
  core's** in one schema. M5.
- **Whether a pack's reasons, texts and buttons can collide** with
  another pack's. With one pack per tenant and a prefix on keys and
  payloads they cannot at run time; nothing checks it at build time yet.
- **The documents ADR 0012 lists as still naming bookings** (the API's
  descriptions, the glossary's metrics, three sentences in the design):
  M5, with the code they describe. #253 stays open for them.
- **The other decisions #200 lists with no ADR** (email sending,
  credential encryption, the phone hash, polling, the dashboard's
  framework, packaging, the mocks, the licence): each in the milestone
  that builds it; #200 stays open.
