# Decisions waiting for the maintainer

One page, kept current. Each row is a choice the agent made so as not to
stop, or a thing only the maintainer can do. Answer with the row's number
and "yes", "no", or a few words; a "no" tells the agent what to change.
"If no" says what a no would cost, as far as the agent can tell.

Last brought up to date: 2026-11-23, with the M3 plan (rows 29 to 35) and its first units (rows 36 and 37;
a row keeps its number for good, so new rows take the next numbers
wherever they sit on the page). At the end of M2 a second agent
checked the first version against the repository and found it left out a
third of what it should hold; this is the corrected page
(`reviews/2026-11-21-m3-preparation-check.md`).

## Needed before M3 builds on them

| # | Question | What was done, and what a yes accepts | If no |
| --- | --- | --- | --- |
| 1 | **Is a customer the channel's own identifier first, and the phone number second?** WhatsApp may now send a customer with no number, only an identifier (#284) | A contact is found by identifier first. A number belongs to the identifier it last arrived with. Every case is a table in `design/data-model.md`, "Which contact a message belongs to". **A yes accepts** that nothing merges two contacts, so one person seen first by number and later by identifier can stay two; and that a contact known by number alone is taken by the first identifier that arrives with that number, so the new holder of a passed-on number can join the old holder's conversation | The contact rules and their tests are rewritten; everything M3 stores per customer waits on it |
| 2 | **May a reply be sent a second time after a timeout,** not only after a worker stopped? US-C1 criterion 9 allows only the second (#290) | An assistant reply, a system reply and a staff message are each sent once more after an outcome nobody knows: a timeout, a broken connection, a fault on the channel's side (HTTP 5xx or 408), an unreadable answer, or a call with no recorded result after 2 minutes. A service notice or a message the business starts is never sent twice. Three calls for one message at most, the resend included | Either the criterion's text changes, or replies are not resent after a timeout and a customer may get no answer |
| 3 | **Is a message that waited over 15 minutes to be sent dropped,** not sent late? (#290) | It is marked `expired` and reported in the worker's log. After an outage that long, customers who wrote just before it get no answer | Another limit, or late sending, or re-opening the customer's message for a fresh answer, which is M3 work |
| 4 | **Are these the six languages of v1.0: Arabic, English, Urdu, Hindi, Bengali, Tagalog?** And who, for each, reads its test conversations as a speaker would (#168) | The first four are required by NFR-A4. Bengali and Tagalog are the agent's proposal, on an assumption about who lives in the first target market that no source was read for (`ai/eval-plan.md`, section 4). The evals cannot be written until the list is fixed | Name the languages; fewer than six leaves NFR-A4 unmet, and v1.0 says so |
| 5 | **Bedrock, a Claude model, `us-east-1`** as the working choice (ADR 0010, amendment). You said "likely" of both | Recorded as a working choice, confirmed or changed by the first eval run. **Decided by the agent on top of it:** the first real model adapter is for Bedrock; the model is chosen by measuring two or three; only models whose data Bedrock neither keeps nor shares are candidates; the default routing keeps processing inside the United States, which by AWS's description uses `us-east-2` and `us-west-2` as well as `us-east-1`; region, routing and model are settings | Say which part; each is a setting or a line of the record |
| 6 | **AWS credentials and a spending limit** for the first eval run against a real model | Nothing; the agent does not ask for them until the eval harness exists | — |

## Raised by the M3 plan; nothing is built on them yet

Each is a question of `plans/m3-ai-core.md`, where it is set out in full.
These rows were added after the second agent's check of this page;
the check of the plan (`reviews/2026-11-22-m3-plan-check.md`) read rows of
an earlier draft.

| # | Decision | What the agent proposes | If no |
| --- | --- | --- | --- |
| 29 | **May M3 build the handover record,** though handover is M4's? (question 1) | M3 marks the session handed over for each reason it can detect, stops the assistant answering it and sends the handover text. Two criteria the stories file leaves to M4 (US-C11, 4; US-C12, 4) then come into M3, and with them most of the triggers of US-C6, an M4 story. When the session ends the handover is detached and the assistant answers the next message. The queue and everything staff see stay in M4. In M3 no person can reply; nothing is live | Those criteria and three more are delivered in M4, and in M3 the assistant goes on answering a session it should have handed over |
| 30 | **May M3 queue its notices to tenants and only log them,** real email being M4's? (question 2) | The production guard refuses the logging writer | The notices of US-C15, 6 and 8 are not built until M4. Either way no email is sent before M4 |
| 31 | **May pull requests that change AI behaviour merge without an eval score until the harness and a real model exist,** against `AGENTS.md` section 6? And after that, evals against the real model on each such pull request, which spends money on each push? (question 3) | Until then each such pull request attaches its tests' run against the scripted client and says no score exists. After: as the eval plan says, once you have put the key in the repository's secrets and set a cap | Say what should be attached instead, or when the real model should run: on merge only, or by hand |
| 32 | **What M3's evals cover with no tools** (question 5) | The M3 dataset, baseline and thresholds cover only what needs no tool, listed by dimension in the harness's design note; measured again in M5; the M3 tag says so | M3 cannot be tagged until M5's tools exist |
| 33 | **Build buttons and captions in the channel in M3** (question 6)? M2 built text only, and M3's opt-out, opt-in and person buttons need them | A unit of its own, from Meta's pages read and dated then | The button criteria of US-C7 and the caption of US-C12 move to a later milestone, and M3 has keywords only |
| 34 | **A tenant's settings and the test "is this tenant answering"** in M3 (question 7): business hours, support contact, notification address, loaded by an operator's command | The settings and the test; credential checks and their emails stay in M4, so the test is weaker than the design's | Steps 4a, 5 and 8 of the order of checks treat every tenant as answering until M4 |
| 35 | **Add to the stories file's table of criteria delivered later** the parts of M3 criteria that need bookings, templates or real tools (question 8) | US-C4, 4 and 14 and the booking clause of 10; US-C5, 1 for a template; US-C8, 4 for a real tool; US-C15, 9 | Say which of them M3 should deliver, and how without the booking pack |
| 36 | **May what a customer types inside a message go to the model as written, a phone number or a name included?** `AGENTS.md` section 7 says never to send a phone number or a contact's name to the model; the architecture says the system adds none, and ADR 0005 adds that it cannot remove what a customer typed. NFR-V7's wording should say which (#77; set out in `plans/m3-u0-findings.md`, not in the M3 plan). A yes accepts that numbers and names a customer types, their own or another person's, go to the model provider, where `compliance.md` argues for sending only the text needed to answer | Nothing is changed. Proposed: NFR-V7 reads "no phone number or name of the contact, from the contact's record or the channel's profile, is put into a prompt; the messages of the session are sent as written", and `AGENTS.md` section 7 is reworded by you to match | Typed numbers and names must be found and removed before the model sees a message, which is new work for U7 and will sometimes remove what the customer meant to say |
| 37 | **Register `faq-only` now as a pack with a name and nothing else** (ADR 0014)? `ops` already accepts the name and the data model and the API list it, but it has no package, so a tenant created on it would get no answers once the worker looks packs up | Proposed. Its prompt and evals are still added at the end of M5, and NFR-M1 is still measured then on `packages/core`; the trial no longer includes adding a line to the registry | The name is taken out of `ops`, the data model and the API until M5, so that the trial adds the pack whole. A built command changes |

## Made in M2; a yes closes them

| # | Question | What was done | If no |
| --- | --- | --- | --- |
| 7 | The send policy's numbers: a refusal the channel says can be retried is tried three times in all, after 2 and 8 seconds; one run of the send job makes at most 20 calls and stops at the first that is not accepted; a send times out after 10 seconds (#290, ADR 0004) | As asked | The policy is one function with a test for every sequence; a change is small |
| 8 | One job sends a conversation's messages, oldest first, one at a time (#290) | As asked | Ordering needs a rule of its own |
| 9 | `PSA_ENV` has no default: a process not told where it runs does not start (#295) | As asked | A default of `development` would let a forgotten setting run development parts for real |
| 10 | No worker starts in production until each tenant has its own WhatsApp credential (#295) | The guard refuses | The guard's last rule is removed, one credential serves every tenant in production, and NFR-S5 is unmet there |
| 11 | The stand-in for WhatsApp may listen on every interface inside a container (#295) | It says so loudly and never starts in production | The compose stack needs another way for containers to reach it |
| 12 | In production a secret is refused only if it carries the mark `local-only`, which the example file's placeholders have, and the channel's address must be exactly `https://graph.facebook.com` (#295) | As asked. The mark is a net for a copied example, not a test of a secret | Say what else should be refused |
| 13 | The application role, which serves the internet, has no access at all to the operator's record. ADR 0011 had allowed insert and read (#293) | As asked | One grant is added |
| 14 | A tenant's name is not written to the operator's record, because a business's name can be a person's; the tenant is recorded by its identifier (#293) | As asked. The database refuses any recorded value with a space, an `@` or a `+` | An argument is added and the database's rule on recorded values is loosened |
| 15 | The rest of how `ops` behaves (ADR 0011, amendment): `ops log show` and `ops channel connect` were added; commands that only read are recorded too; the first row of the record is committed before the command acts; a command done but half recorded exits with status 3; a time zone written with a plus sign is not taken; `ops service degraded` and `ops events list-unparsed` are not built | As listed | Say which |
| 16 | No query builder: SQL is fixed text in one package, and only that package imports the database driver (ADR 0003, amendment) | As asked | A query builder is chosen and the statements rewritten: 83 calls on 2026-11-22 (an earlier "about fifty" came from a search that missed typed calls) |
| 17 | Database time limits: 2 s to connect, 4 s a statement, 3 s for a lock, 10 s idle in a transaction (#288) | As asked | Other numbers; one constant each |
| 18 | `messages.handled_at` marks a customer's message that a turn has dealt with, until sessions and batches exist; a message to send has a count of calls and of unknown outcomes; `unconfirmed` and `expired` are codes on a failed message, not statuses (`design/data-model.md`, decisions 18 and 19) | As asked | The columns change before M3 builds on them |
| 19 | **NFR-S2 as reworded, and US-C1 criterion 4 with it.** A request with a missing or bad signature is refused and nothing is stored, but not always with 401: an oversized body gets 413, a source that keeps sending bad signatures gets 429, a malformed or too-slow request gets another 4xx or a closed connection, some of these before the signature can be read. Criterion 4 still says "HTTP 401 is returned" | The NFR was reworded; the criterion was not. A yes means the criterion is reworded to match | Say which answers are acceptable |
| 20 | NFR-O1 as reworded: the worker is probed by a command that reads its heartbeat, since it serves no HTTP | As asked | Say how it should be probed |
| 21 | The pack boundary test went on without the three known exceptions being routed through pack hooks first, as the plan had said: one is a pinned name in the core, two are in documents only because their steps are not built. Four folders are outside "the core" for the test: the packs, `apps/ops`, and the two stand-ins (ADR 0012, amendment) | As listed | ADR 0014, which leaves the hooks to M5, is reworked so that they are built in M3 with the steps they belong to |

## Only the maintainer can do

| # | Thing | Why it matters |
| --- | --- | --- |
| 22 | Turn on branch protection for `main` and require the CI checks; turn on private vulnerability reporting; make the project board (#6) | Nothing stops a push to `main` or a merge while a check is red; `SECURITY.md` points at a reporting form that may not be on |
| 23 | Say whether pull requests should be merged by squash or by merge commit (OQ-11). `AGENTS.md` says squash; every merge so far was a merge commit | The history's shape; the document or the habit changes |
| 24 | Delete the three leftover branches (`feat/265-…`, `feat/267-…`, `feat/269-…`). Each holds nothing that is not in `main`; the agent's session may not delete branches | Tidiness |
| 25 | The copyright holder's name in `LICENSE`, currently the GitHub handle; whether the commit identity is as you want it (#7) | Before anyone else uses the code |
| 26 | Check US-C2's criteria against what M2 built, and close #11 | The agent does not close a story on its own word |
| 27 | Whether one tenant's assistant can be paused (OQ-12) | Before any live use |
| 28 | Whether the proposed defaults of the settings are right (OQ-10). They are the agent's proposals with no data behind them | No deadline; from a pilot |

## Not needed until there is a real deployment

A hosting target and its account (ADR 0009); a Meta developer app and a
verified business number; the emergency phrase lists and text, read by a
fluent speaker and by a person with clinical or crisis training (#168); a
lawyer's reading of the points marked as inference in `compliance.md`,
above all sending message text to a model outside the customer's country.
None blocks v1.0 on the stand-in channel.
