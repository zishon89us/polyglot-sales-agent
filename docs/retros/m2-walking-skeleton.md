# Retro: M2 Walking skeleton

Date: 2026-11-20 · Issue #271

Written by the agent in the pull request for the last unit, before that
unit's review. A retro by its author is one view; the maintainer's is
missing from it.

## What was delivered

| Unit | What | Pull requests |
| --- | --- | --- |
| U1 | Workspace, strict TypeScript, the local check | #274 |
| U2 | CI: `make check`, audit, secret scan, document checks | #275 |
| U3 | One source for shared names, checked against 17 places | #277 |
| U4 | Roles, migrations, tenant isolation by row-level security | #280, #281 |
| U5 | Job queue, conversation lease, heartbeat | #283 |
| U6 | Channel interface, WhatsApp and in-memory channels, the stand-in for WhatsApp, the webhook guard | #286, #287 |
| U7 | The webhook stores events once and queues their jobs | #289 |
| U8 | The worker: an echo, and sending under a policy by message class | #291, #292 |
| U9 | The operator's commands and their record | #294 |
| U10 | Compose stack, end-to-end test, production guard, pack boundary test | this pull request |

Exit criteria (`AGENTS.md`, section 9): "`docker compose up` works; an
end-to-end test sends a message and receives the echo; CI green." The
second is met by a test in `make check`. The first is shown by a CI job
only: the agent's machine has no Docker. The third is true of this pull
request's head when it is opened for merge, and is for the reader to check
there.

In numbers, each counted from the repository or from GitHub on the day:
16 pull requests merged since the M1 retro (#258 to #294), 5 migrations,
891 tests, 17 review and verification reports for the code of U1 to U9,
and 215 commits on `main` before this unit.

## What went well

- **Review per pull request, then a check of the fixes.** Every unit with
  code was reviewed by an agent that had not seen it written, and from U4
  on the fixes were checked by another. The STATUS log names five High
  findings in U4 to U7: a transaction handle that outlived its tenant, a
  timer the application could not cancel, a test that tested nothing, a
  message put in the wrong customer's conversation, and a test that did
  not show what a decision record claimed. U8 and U9 drew none.
- **The check of the fixes found something every time.** In U7, U8 and U9
  it found that a fix had gone too far or said too much. The fixes written
  after it were small and are marked as not checked.
- **A finding became a test.** The change M1's retro asked for. Reviewers
  ran mutants, and most Low findings are a named mutant that survived and
  now does not.
- **Claims were cut down to what a test shows.** Three times a document
  said more than its test (the SQL boundary, the operator's record, the
  record's pattern). Each was reworded to the smaller, true claim.
- **Real programs were run, not only functions.** From U7 on, each entry
  point was run by hand or by a test, which found a blank host listening
  on every interface and a time zone that failed with a database code.
- **CI found what the agent's machine did not:** a test that failed one
  run in eight (U8).

## What went wrong

1. **Three pull requests were merged before their review had finished**
   (#280, #286, #291), each while its description said "not ready to
   merge". The fixes followed in #281, #287 and #292, so `main` held
   reviewed-as-wrong code for some hours each time. Nothing was deployed,
   so nothing came of it. The agent offered to open pull requests as
   drafts and did not act on its own offer.
2. **The first fix was often wrong.** A contact rule was rewritten twice
   after review; an expiry was added and then had to be counted from a
   different moment. Each second fix was found by the check of the first,
   which is the method working, and also a sign that the first design was
   decided too fast.
3. **Decisions piled up for the maintainer.** Many choices were
   made by the agent "so as not to stop" and written into follow-up
   issues: the contact identity rule, the send policy, the 15-minute
   limit, time limits, who may read the operator's record, `PSA_ENV`. None
   has been confirmed. Two requirements were reworded (NFR-S2, NFR-O1) and
   one criterion was built wider than written (US-C1, 9).
4. **Follow-up issues grow faster than they close.** Every unit ended with
   an issue of what it left open (#278, #279, #282, #285, #288, #290,
   #293, #295). 30 issues of the milestone are open at its end.
5. **The dependency audit was red for two days** on an advisory with no
   fix. The agent's attempt to have the audit pass over it was refused by
   its permissions, rightly: that was the maintainer's decision. It went
   green when a fix was published.
6. **The session lost its own context twice** and went on from a summary.
   One review report lost its heading that way, and a later edit put raw
   control characters into a test file because of how the agent's commands
   were carried. Both were caught; both are of a kind that could be missed.
7. **No Docker on the agent's machine.** The compose file, the image and
   the M2 exit criterion in its own words rest on a CI job the agent could
   not run before pushing.
8. **The README said "nothing has been built" until this unit.** For nine
   units the front page of a portfolio repository was out of date.

## What changes in M3

| Change | Why |
| --- | --- |
| **Pull requests are opened as drafts** and marked ready only when the review and the check of its fixes are in | Went wrong 1 |
| **A design note before the code, for any rule about people or money** (who a customer is, what is sent twice): the cases as a table first, reviewed before the build | Went wrong 2 |
| **A decisions list for the maintainer, one page, kept current,** with a yes-or-no question for each, in place of items scattered over eight issues | Went wrong 3 |
| **Triage the follow-up issues at the start of M3,** as M1's findings were at the start of M2: assign each to the milestone that builds its subject, close what is done | Went wrong 4 |
| **The README's state table is updated in the pull request that changes the state** | Went wrong 8 |
| **Anything the agent cannot run locally is named in the pull request before the push,** with the CI job that will show it | Went wrong 7 |
| **Edits to files are made from files, with odd characters built in the script,** and a check for raw control characters runs in `make check` | Went wrong 6 |

## Before M3 can start

- The model provider (OQ-9, ADR 0010) is the maintainer's choice and costs
  money: the agent stops and asks.
- The supported languages and a speaker's review of each eval dataset
  (#168).
