# Status

Living progress log. The agent updates this at the end of every session.

## Current milestone: M3 AI core (U1 done; U2 under way; no code yet)

Exit criteria: grounded multilingual answers pass the eval thresholds; the
eval job runs in CI. The plan is `plans/m3-ai-core.md`. M2 is tagged
`m2-walking-skeleton`; its retro says how each of its criteria was shown.

M0 Inception met its exit criteria on 2026-11-16; see
[`retros/m0-inception.md`](retros/m0-inception.md).

## Done

- 2026-11-16 — Repository bootstrapped on `main` with README, MIT licence and
  `.gitignore` (single direct commit, because an empty repository has no
  branch to open a pull request against).
- 2026-11-16 — Labels (phase, area, priority, `needs-human`), the M0
  milestone and issues #1–#7 created.
- 2026-11-16 — Working agreement and repository scaffold opened as a pull
  request for #1; merged by the maintainer as #8.
- 2026-11-16 — Product vision and personas merged by the maintainer as #9.
- 2026-11-16 — Milestones M1–M6 created. 23 MVP user stories written, each
  opened as its own issue (#10–#32) and assigned to its milestone;
  traceability table started. Merged by the maintainer as #33.
- 2026-11-16 — Branch ruleset for `main` set to active by the maintainer.
- 2026-11-16 — Non-functional requirements and risk register merged by the
  maintainer as #34 and #35.
- 2026-11-16 — M1 issues #37–#44 opened. M0 retro merged as #45.
- 2026-11-16 — Author's own requirements review merged as #56: 12 findings,
  9 stories added (32 in total, issues #47–#55), glossary added.
- 2026-11-16 — Named standards and independent phase-gate review adopted,
  with checklists; merged as #60.
- 2026-11-16 — First independent review of the requirements: 44 findings, 9
  High, all accepted. Merged as #62.
- 2026-11-16 — Channel rules and data-protection obligations researched from
  official sources (#37); pull request #63.
- 2026-11-16 — Positioning and v1.0 scope decided (ADR 0001). Requirements
  rewritten to fix the review findings; story issues synced; opened as pull
  request #72 for #61.
- 2026-11-16 — Second independent review (52 findings, 8 High), two narrow
  verification reviews, and their fixes, all in pull request #72. Gate 1
  passed with 62 Medium and Low findings tracked as issues.
- 2026-11-16 — Pull request #72 merged by the maintainer. Design started
  with `design/state-machines.md` (#126): transition tables for eight
  machines and one order of checks for inbound messages. Thirteen decisions
  were made there and applied to the requirements; it resolves #118, #119,
  #123 and #124.
- 2026-11-16 — Independent verification of the state machines: 33 findings,
  4 High. All four fixed. The handover machine now has an executable model
  that explores event sequences and asserts its invariants. 27 findings
  tracked as issues #128 to #147. Version 1.0 now has 219 acceptance
  criteria.
- 2026-11-16 — Second verification of the state machines: no High defect
  open. It also showed that the document overstated the handover model,
  which checks invariant H2 only; corrected. Remaining findings tracked as
  #148 to #150.
- 2026-11-16 — Pull request #127 merged by the maintainer. First decision
  records written in MADR 4.0.0 form (#38): seven decided, two proposed for
  the maintainer (hosting, model provider). ADR 0004 replaces Redis with a
  jobs table in PostgreSQL; `AGENTS.md` section 3 updated to match.
- 2026-11-16 — ADRs merged as #151. Architecture document written against
  the arc42 section list (#39): context, containers, packages, the pack
  interface, three runtime flows and how the four highest risks are met.
- 2026-11-16 — Architecture merged as #152. Data model written (#40): every
  table with its tenant scoping, the constraints that carry invariants, and
  a personal-data inventory with retention and deletion behaviour. One
  open handover per contact is now a database constraint.
- 2026-11-16 — Data model merged as #153. Threat model written (#42): 58
  threats over nine data flows under the STRIDE headings, with the
  AI-specific ones mapped to the titles of the OWASP Top 10 for LLM
  Applications 2026. Thirteen gaps with no requirement behind them were
  opened as issues #154 to #166, labelled `security`.
- 2026-11-16 — Threat model merged as #167. Eval plan written (#43): 15
  dimensions, the red-team set, dataset rules with a held-out set, graders,
  and how thresholds are set from a baseline the maintainer accepts. No eval
  has been run and no score exists. Six languages proposed (#168).
- 2026-11-16 — Guardrail policy written (#44): 16 rules, with the checks
  before and after the model, the handover topics and the fixed texts, each
  naming how it is enforced and tested. It settles findings #120, #121 and
  #122, the reply-content rule #159 and open question OQ-5, and changes
  US-C4 and US-C6; version 1.0 now has 222 acceptance criteria.
- 2026-11-16 — Eval plan and guardrail policy merged as #169 and #170. API
  written (#41): `docs/design/api.md` and `docs/design/openapi.yaml`, with
  43 paths and 55 operations. **No linter has been run on the OpenAPI file**;
  the session was not permitted to download one. A structural check script
  passes. Issue #41 stays open until a linter passes.
- 2026-11-16 — API merged as #171. Pull request #172, from another session,
  added `redocly.yaml` and reports a clean lint of the OpenAPI file. This
  session has not repeated that run. `api.md` now says so, and #41 is closed
  on that basis.
- 2026-11-16 — Keyed hash for suppressed phone numbers defined in the data
  model (#160); the threat model's list of open threats updated.
- 2026-11-16 — ADR 0011 written (#161): the operator works through commands
  run on the server, each recorded in an insert-only log. Whether one tenant
  can be paused is open question OQ-12, for the maintainer.
- 2026-11-16 — Lint status, keyed hash and ADR 0011 merged as #173 to #175.
  Gate 2 review run by two separate agents. Structure review: 44 findings,
  7 High. Threats and AI review: 50 findings, 13 High. Both reports are
  committed unedited in `docs/reviews/`. **Gate 2 is not passed.** No
  finding has been answered or fixed yet.
- 2026-11-16 — Gate 2 findings answered. The maintainer chose to move
  booking out of the core (ADR 0012) and to record channel statements as
  assumptions. All 20 High findings were fixed or answered by withdrawing a
  false claim. A first verification found 14 resolved, 6 partly, and 3 new
  High findings in the fixes; a second found no High finding open. Version
  1.0 has 224 acceptance criteria; the API has 44 paths and 57 operations.
  The regenerated OpenAPI file passes the structural check and has not been
  re-linted.
- 2026-11-17 — Gate 2 pull request merged as #254. README rewritten (#255)
  to say what the product is for, for whom, and that no code exists yet.
- 2026-11-17 — README merged as #256. M1 retro written (#257), with three
  items added to the Gate 2 checklist.
- 2026-11-17 — Retro and README fix merged as #258 and #260. AWS AI-DLC
  evaluated (#59) in ADR 0013: borrow four practices, install nothing.
- 2026-11-17 — M2 planned: ten units of work, issues #262 to #271, in
  `docs/plans/m2-walking-skeleton.md`. Open review findings sorted into the
  milestone that builds their subject. `AGENTS.md` gains the unit loop and
  the halt rule.
- 2026-11-17 — ADR 0013 and the M2 plan merged as #261 and #273. **First
  code.** M2 unit U1 (#262): pnpm workspace, TypeScript 7 in strict mode,
  Biome for format and lint, Vitest, commitlint, and `make check`, with a
  self-test that runs the real checks on deliberately wrong files. The
  first independent code review found 20 defects, two High: the self-test
  did not exercise the project's own configuration, and one commit did not
  pass on its own. Both are fixed; the report is in the pull request.
- 2026-11-17 — The maintainer decided that commits are authored under the
  maintainer's identity, with the agent as co-author. `make identity` sets it,
  `make check` enforces it on the agent's commits, and `AGENTS.md` section 2 records it. Earlier
  commits are not rewritten.
- 2026-11-17 — U1 merged as #274. M2 unit U2 (#263): a CI workflow that
  runs `make check` on Node.js 22 and 26, a dependency audit and a secret
  scan, with actions pinned to commits and a read-only token. Document
  checks added to `make check`: stories against the traceability table,
  decision-record sections, relative links, and the OpenAPI lint, which now
  runs in this session and passes. First real tests: 16, for the document
  checks. CI passed on the pull request. The code review found 15 defects,
  none High; the six Medium ones are fixed or stated as limits.
- 2026-11-17 — U2 merged as #275. M2 unit U3 (#264): the first package,
  `packages/core`, holding the shared names (handover states and reasons,
  message statuses, classes and directions) and a check, with tests, that
  seventeen places that list them agree with it, including the script that
  generates the OpenAPI file. **U3 did less than its plan said:** model
  flags, settings with their units, and several other lists are not
  defined, and the same names still appear unchecked in prose. That work
  is #278; #183, #204 and #249 stay open. The code review found 14 defects,
  two High: the generator restated the lists unchecked, and the shortfall
  against the plan was not stated.

- 2026-11-17 — U3 merged as #277. M2 unit U4 (#265): `packages/db`, with
  three database roles, a migration runner with up and down steps, the
  first migration (six tenant-owned tables and the routing table, with the
  skeleton's columns only), `withTenant`, and a check that reads the
  database's catalogue for known ways of weakening isolation. Tests run
  against PostgreSQL 16.15: as one tenant, reads return none of another
  tenant's rows and writes change none, in every table; the application
  role is refused eighteen ways of going around the policies; a table added
  without its policy fails the check. One thing does leak: whether a row
  identifier exists in another tenant, to a caller who already has it. Building
  it corrected ADR 0003 in two places (#191) and found that foreign keys
  and uniqueness rules ignore row-level security, so they now carry the
  tenant. Not done or not shown: `docker compose` was never started here,
  the query builder is not chosen, and key rotation (#162) waits for stored
  credentials; all in #279. The code review found 17 defects, one High: a
  query handle kept after its transaction ran in the next tenant's
  transaction. **#280 was merged before that review was in**, so the fixes
  are a second pull request, #281: that defect and most of the others,
  then four Medium ones a verifier found in the fixes. 119 database tests
  now. What is not fixed is in #279.

- 2026-11-17 — U4's fixes merged as #281. M2 unit U5 (#266): the job queue,
  the conversation lease and the worker heartbeat, as functions in
  `packages/db` with their rules in `packages/core`. The tests show: a job
  that keeps failing runs six times, after waits of 2, 4, 8, 16 and 32
  seconds, and is then dead with an alert queued; four workers never claim
  the same job; of two workers taking a lease at once exactly one gets it,
  fifty times over; a worker that lost the lease has its result discarded.
  The worker's probe is a command that reads its heartbeat (#187). The code
  review found 15 defects, one High: the application role could not cancel
  or replace a timer, which the design requires, and the plan's item on
  timers (#195) had been dropped without a word. It also found that
  everything compared against each process's own clock. Both are changed:
  timers can be cancelled and replaced, and the database's clock is the
  only one. **Not built:** the worker process that would call these
  functions, and anything that delivers an alert; both in #282, with the
  query builder, deferred once more.

- 2026-11-18 — U5 merged as #283. M2 unit U6 (#267): the channel
  interface; the WhatsApp channel, which checks a signature, reads a
  webhook and sends a text; a second channel that lives in memory; the
  `mock-whatsapp` app that stands in for Meta's servers; and the webhook
  guard in `apps/api`. Contract tests run on dated, synthetic fixtures
  written from Meta's documentation as read that day. A bad signature is
  answered 401 and nothing is handed on; a body over 3 MiB is refused
  before it is read; ten refused requests within a minute block a source
  for a minute. What each mock is for is decided and written in the architecture
  (#202). Reading the documentation turned up a fact the design did not
  assume: **a WhatsApp customer may arrive with no phone number** (#284).
  Not built: the sink that stores, which is U7's; templates and credential
  checks; statuses from the mock. All in #285. The code review found 15
  defects, one High: a test that could not fail. **#286 was merged while the
  verification of those fixes was still running**; what it found (a
  trickled request body was cut off at 90 seconds, not 10; the server
  rewrote every route's client error to 400; a slow sink was never told to
  stop) is fixed in a second pull request, #287.

- 2026-11-18 — U6's fixes merged as #287. M2 unit U7 (#268): the webhook
  stores what it receives. One transaction per receiving number makes the
  contact and the conversation if they are new, stores each message once,
  and queues one job for the conversation. The same message delivered five
  times, one after another or all at once, is one row and one job. A
  refused request (bad signature, oversized body) leaves no row in any
  table. An event for a number no tenant has, and a body that cannot be
  read, are recorded by identifiers or by a hash only, never with a number
  or text. With the database unreachable the answer is 503. The health
  endpoints exist, and the API and the mock were run together by hand: a
  message typed into the mock was stored with its job. What each kind of
  event writes and queues is one table in the architecture (#177).
  **Decided by the agent:** a contact is matched on the channel's own
  identifier first, then on the number (#284); and no query builder for
  now, with SQL kept in one package and a test that keeps it there (ADR
  0003). NFR-P1 measured here, not gated: 300 webhooks, ten at a time,
  median about 34 ms, 99th percentile about 105 ms.
- 2026-11-18 — U7's code review: two High findings and thirteen others
  (`docs/reviews/2026-11-18-gate4-u7-webhook.md`). **W1:** the contact
  rules could put one person's message in another's conversation; they
  are rewritten so that the identifier is the person and a number never
  moves a conversation, and every case is a table in the data model with
  a test each. **W2:** the test said to keep SQL out of the apps caught
  one planted case in six; it is replaced by a rule that can be checked:
  only `packages/db` imports the database driver, and the rest of the code
  gets a handle that cannot run a query. Also fixed: database time limits
  (a held lock no longer holds the API); start-up and `/readyz` check that
  each connection is the role it should be; one log line per webhook
  answered 503; the channel's sent time, a failed status's code and the
  type of an unread message are stored; a large webhook sent again is
  recognised in one query; uniqueness of a channel identifier is per
  direction. Not fixed, in #288: the catalogue check does not pin the
  columns of the unscoped tables (W14); a first delivery too large to
  store in 5 seconds is answered 503 until its first run has committed,
  and 200 after (measured at 12,000 messages: 7.6 s to store, then 32 ms);
  the hash of an unreadable body is not keyed (W10, now stated).
- 2026-11-18 — The fixes were checked by a second agent
  (`docs/reviews/2026-11-18-gate4-u7-verification.md`): no High, nine
  findings. It confirmed the contact rules in code and the time limits,
  and found that the driver boundary still claimed more than its test
  showed (eight of sixteen planted files got through), that a contact
  could be left showing a number that had become someone else's, and that
  a blank `PSA_API_HOST` listened on every interface. All three are fixed:
  the test now covers the eight ways and the decision record says it is a
  guard against accident, not against intent; a number now leaves a
  contact when the channel sends it with another person's identifier; a
  blank host is this machine only. Not fixed, in #288: two webhooks with
  the same two new customers in opposite order deadlock, and the loser is
  answered 503 and succeeds when sent again (X7).

- 2026-11-19 — U7 merged as #289. M2 unit U8 (#269): the worker. A
  customer's message is answered with an echo of its text, once; the same
  message delivered five times gets one reply. What waits in a
  conversation is sent by one job, oldest first, one at a time. The send
  policy is decided by message class and has a row for every class
  (#235, #236): a refusal that can be retried is tried three times; an
  outcome nobody knows (a timeout, a fault on the channel's side, a worker
  that stopped) is followed by one more call for a reply and by none for a
  service notice or a business-initiated message, which end `failed` with
  the code `unconfirmed`. The restart test stops the worker at four
  points, for a reply and for a business-initiated message, and shows one
  copy, one or none, two or one, and one. Two workers with bursts of five
  messages reply once each and in order. The API, the worker and the mock
  were run together by hand: a message sent through the mock came back as
  an echo. **Decided by the agent:** the policy's rows, 5xx as unknown,
  one send job per conversation, `handled_at`, and where `unconfirmed` is
  stored. **Not built:** everything after step 4 of the order of checks,
  templates and pre-send checks, per-tenant credentials (one setting for
  every tenant until then), the delivery wait of NFR-R7 (#290).

- 2026-11-19 — **#291 was merged before its code review had finished**, at
  the commit before the fixes below. They follow in a second pull request.
- 2026-11-19 — U8's code review: no High finding, four Medium, eight Low
  (`docs/reviews/2026-11-19-gate4-u8-worker.md`). In its own runs, with
  four workers and a channel that hung, threw and lied, no reply was
  delivered more than twice and nothing else more than once. Fixed: a
  message that has waited more than 15 minutes is not sent (replies left
  by a dead send job were being sent days late); the down step of
  migration 0004 can be followed by up again; a turn that fails frees its
  conversation; a failed message is reported and stores `unconfirmed`
  whenever the customer may have it; a run of sends stops at the first
  call that is not accepted; a test now shows the job loop working again
  after the database comes back. Not fixed, in #290: nothing sweeps for
  messages whose job died; one worker shares nothing fairly between
  tenants. **For the maintainer:** US-C1 criterion 9 allows a second copy
  of a reply only when a worker stopped; the build also resends after a
  timeout, and the story's text is left as it was.

- 2026-11-19 — The fixes were checked by a second agent
  (`docs/reviews/2026-11-19-gate4-u8-verification.md`): no High, four
  findings, all about the new 15-minute limit. It confirmed every other
  fix. Changed: the limit counts from when a message could first have
  gone, so one put off to a later time is not expired early. Stated, not
  changed: the limit applies whatever kept the message waiting, so after
  15 minutes with no worker running the waiting replies are not sent and
  those customers get no answer; each is reported in the worker's log.

- 2026-11-19 — U8's fixes merged as #292. M2 unit U9 (#270): the
  operator's commands. `ops tenant create`, `tenant list`, `jobs
  list-dead`, `jobs retry` and `log show`, run on the server with the
  cross-tenant role. Each writes two rows to `operator_log`, one before it
  acts and one with how it ended; no role can change or remove a row by a
  plain statement, and the application role cannot even read it. `ops`
  records identifiers and short settings only. A test fails if any file outside
  `apps/ops` imports the operator's functions, and another lists the API's
  routes: there is no operator route. Each command was also run by hand.
  **Decided by the agent:** no privilege at all for the application role
  (ADR 0011 allowed insert and read), the tenant's name not recorded,
  `log show` added. **Not built:** the owner's invitation (M4), a command
  to connect a number to a tenant, tenant state (#293).

- 2026-11-19 — U9's code review: no High finding, five Medium, six Low
  (`docs/reviews/2026-11-19-gate4-u9-ops.md`). Fixed: three ways the
  operator's functions could still be passed to the API unnoticed; the
  operator's role could date a row back, and now cannot set a row's time
  or identifier; a valid time zone written with a plus sign failed with a
  bare database code, and is now refused with a reason; a tenant's name
  could carry characters that reorder a terminal line; a command is now
  checked in full before any connection is made. Stated, not changed: the
  migration role, which owns the log, can remove its guard with a schema
  change, and the pattern on recorded values does not by itself keep
  every personal value out. Two sentences that said more than that are
  corrected.

- 2026-11-19 — The fixes were checked by a second agent
  (`docs/reviews/2026-11-19-gate4-u9-verification.md`): five findings,
  all Low, all fixed. It confirmed every fix from the review, and ran the
  one path that had no test (a command done but half recorded exits 3),
  which now has one.

- 2026-11-20 — U9 merged as #294. M2 unit U10 (#271), the last. One image
  and a compose file start the database, a set-up step, the API, the
  worker and the stand-in for WhatsApp; `tools/e2e.ts` sends a message
  through the stand-in and waits for its echo. A test runs that against
  the real programs as processes, and a CI job runs it against `docker
  compose up`. **The agent's machine has no Docker, so the compose file is
  checked by CI only.** Every process must now be told where it runs
  (`PSA_ENV`, no default); in production the mock refuses to start, and the
  API and the worker refuse the stand-in channel and every placeholder
  secret, each with a test (#165). No worker starts in production until
  each tenant has its own credential. `ops channel connect` gives a tenant
  a number. The boundary test of ADR 0012 is on: the core's code and
  migrations hold none of the booking pack's names but the one stated
  exception, and import no pack. The README says what runs and how to try
  it. The M2 retro is `docs/retros/m2-walking-skeleton.md`.

- 2026-11-20 — U10's code review: one High finding, four Medium, four Low
  (`docs/reviews/2026-11-20-gate4-u10-end-to-end.md`). **High: the stack
  worked once per database.** The stand-in for WhatsApp numbered its
  messages from 1 at every start, so after a restart with the database
  kept, the product took new messages for old ones and answered nothing.
  CI had not seen it because CI always starts empty. Fixed: every start of
  the stand-in has its own part in its identifiers, and the end-to-end
  test now stops and starts it against a used database. Also fixed: the
  placeholder mark is found however it is written; the channel address
  must be Meta's origin exactly; the set-up script runs only in
  development and can be run again after it half-finished; `ops channel
  connect` no longer offers a channel the worker cannot send on; the
  boundary test ignores case and punctuation, has more words, and scans
  every folder but four named ones. Documents that said "every password is
  refused" now say what is true: marked ones are.

- 2026-11-20 — The fixes were checked by a second agent
  (`docs/reviews/2026-11-20-gate4-u10-verification.md`): no High, two
  Medium, five Low. It confirmed the restart fix with real processes: nine
  round trips across seven restarts, none lost. It found that one stray
  percent sign in a value switched the placeholder check's decoding off,
  and that a test did not pin the list of channels; both are fixed. The
  boundary test now also looks at file names.

- 2026-11-21 — U10 merged as #296 and M2 tagged `m2-walking-skeleton` by
  the maintainer. **M2 is done.** The maintainer's working choice for the
  model: Amazon Bedrock, a Claude model, `us-east-1` (ADR 0010,
  amendment). Reading AWS's pages for it turned up that Bedrock's data
  retention differs by model, so only models whose data is neither kept
  nor shared are candidates. Preparation for M3, as the retro asked: the
  decisions waiting for the maintainer are on one page
  (`decisions-needed.md`), and of the hundred open issues left in
  finished milestones, 92 have a proposed milestone and
  8 stay where they are
  (`plans/issue-triage-2026-11-21.md`). No issue is moved until that page
  is merged. A second agent checked the pages against the repository and
  found the decisions page had left out about a third of what the agent
  decided in M2; it is corrected
  (`reviews/2026-11-21-m3-preparation-check.md`).

- 2026-11-22 — #297 merged. The 92 issues were moved as its page says,
  each checked first to be open and where the page said; none was closed.
  M3 now holds 90 open issues, M4 44, M5 49, M6 8. **The M3 plan is
  written** (`plans/m3-ai-core.md`): nineteen units, U0 to U18, from
  sessions and the model client to the eval harness and a measured
  baseline, with every one of the 90 issues named under a unit. A second
  agent checked the first draft and found it short: nothing owned buttons
  in the channel or the test of whether a tenant is answering, the unit
  count was wrong, six dependencies were missing, and the dataset it
  promised cannot exist without tools
  (`reviews/2026-11-22-m3-plan-check.md`). The plan now raises eight
  questions; seven are rows 29 to 35 of the decisions page. A third
  agent checked the rework: 25 of 29 findings fixed as claimed, and 19
  new, lesser ones, three of them about what a handover does in M3
  (`reviews/2026-11-22-m3-plan-check-verification.md`).

- 2026-11-22 — #298 merged; an issue is open for each unit (#299 to
  #317). **M3 U0** (#299), not finished: the document findings are read
  and each part given an end (`plans/m3-u0-findings.md`). Three
  corrections to the glossary and an amendment to ADR 0007; ten issues to
  be moved to M4, M5 and M6 after the merge; the other parts named under
  a unit, which is a promise and not a fix. M2's three leftover issues are
  divided item by item, and the NFRs M3 must check are listed against
  units. A second agent made 25 findings on the first draft, two of
  them High: an issue about to be moved out held exactly what U13 must
  settle, and the count of SQL statements was 52 where it is 83
  (`reviews/2026-11-22-m3-u0-findings-check.md`). A rewording of NFR-V7
  was taken back and made a question, row 36. #299 stays open for rows
  13, 29, 35 and 36.

- 2026-11-23 — #318 merged. Ten issues moved as its page says (M3 now
  holds 99 open: 19 units and 80 others), and each unit's issue carries
  the parts the page gave it. **M3 U1** (#300): ADR 0014, how a pack
  hands its parts to the core. A pack is one typed object in its own
  package, listed in a registry that a program's entry point imports and
  passes down. M3 builds three parts, the prompt fragment, the tool and
  the claim kind, each shown by a pack written in a test; the others wait
  for M5, with a rule M3 keeps for each. No pack code gets a database
  handle in M3. The first draft shaped six parts; its review made 33
  findings, seven of them High (a button's reference undefined and
  against the data model; a database scope against ADR 0003; three steps
  rewritten with behaviour lost and a fourth left out), and the record was rewritten to decide
  less (`reviews/2026-11-23-adr-0014-review.md`). Row 37 asks about
  `faq-only`. The plan's U4 now creates the two packages. No code.

- 2026-11-23 — #319 merged: ADR 0014 is accepted. **M3 U2** (#301)
  begun with its design note, before any code
  (`design/notes/m3-u2-sessions.md`): each case of a session, the reply
  window, the batch and a reply overtaken by a newer message, as a table.
  It departs from the plan in one thing that matters: `handled_at` stays.
  Rows 38 and 39 ask about two rules it proposes.

## Next

1. Maintainer reads the M3 plan (`plans/m3-ai-core.md`) and answers rows 1
   to 6 and 29 to 39 of `decisions-needed.md`, above all rows 1, 4, 29
   and 33. Units also build on rows 7, 8, 18 and 21.
2. The agent goes on to U2, U3, U4 and U5, with U0 still open for four
   answers. U3 builds on rows 34 and 36 as well, and U4 on row 37. U2 builds on rows 1 and 18, U5 is row 33's: a no to any of
   them is cheaper before the unit than after.
3. M3 cannot be called done without the maintainer: the languages, AWS
   credentials, and acceptance of a measured baseline.
4. Before any live use: the emergency phrase lists and text, reviewed by a
   fluent speaker and by a person with clinical or crisis training (#168);
   each channel assumption re-read in full (threat model A7).

## Gate status

**Gate 2 (design) passed on 2026-11-17 on the rule of `AGENTS.md` section
11, when the maintainer merged #254:** no High finding is open. That is all it means.

| Review | Scope | High findings |
| --- | --- | --- |
| Structure review | Architecture, data model, state machines, API, ADRs | 7 |
| Threats and AI review | Threat model, guardrail policy, eval plan, compliance | 13 |
| Verification | The 20 fixes | 3 new; 6 of 20 partly resolved |
| Second verification | Those 9 | 0 |

Three rounds each found defects in the round before, and the last still
added eight Medium findings. 146 `review-finding` issues are open across
both gates. The design is not finished; it is at the point where the
remaining defects are better found by building and testing than by another
round of reading. No person has reviewed any of it in detail.

**Gate 1 (requirements) is passed, on the route agreed with the maintainer**
(`AGENTS.md` section 11): no High finding is open; Medium and Low findings
are tracked as issues.

| Review | Scope | High findings |
| --- | --- | --- |
| First independent review | Whole set | 9 |
| Second independent review | Whole set, after fixes | 8 |
| Verification | The 8 fixes | 2 new |
| Second verification | The 2 fixes and 3 related | 0 |

62 Medium and Low findings remain open. The last verdict rests on one
judgment call: the verifier rated #118 Medium and called it the closest to
High. Reports and responses are in `reviews/`. No human has yet reviewed the
requirements in detail.

## Scope

Decided on 2026-11-16 (`adr/0001-positioning-and-v1-scope.md`): the project
is a portfolio and reference implementation. Version 1.0 is the core engine,
the dashboard and the `booking` pack, with 36 stories and 224 acceptance
criteria, run against a mock channel. The `cod-confirm` pack is deferred to
v1.1.

## Blocked on the maintainer

Everything waiting for a yes, a no or an action is on one page:
[`decisions-needed.md`](decisions-needed.md). Rows 1 to 6 and 29 to 39 are needed
before M3 builds on them; row 4, the supported languages, is the one
nothing can go round.

## Not done yet

- GitHub project board (Backlog, Ready, In progress, In review, Done). The
  agent's session cannot create GitHub Projects; tracked in #6's follow-up
  comment for the maintainer.
- `CODE_OF_CONDUCT.md` and `CHANGELOG.md`.

## Open questions

None yet.
