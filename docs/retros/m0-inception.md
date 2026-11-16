# Retro: M0 Inception

Date: 2026-11-16 · Issue #36

## What was delivered

| Item | Evidence |
| --- | --- |
| Repository bootstrapped with README, MIT licence, `.gitignore` | Commit `85fc41f` on `main` |
| Working agreement, contributing guide, security policy, templates, `CODEOWNERS`, status log | #8 |
| Product vision and personas | #9 |
| 23 MVP user stories, one issue each (#10–#32), traceability table | #33 |
| 43 non-functional requirements | #34 |
| 30 risks, scored and owned | #35 |
| Labels, milestones M0–M6, branch ruleset on `main` | Repository settings |

Exit criteria: "Requirements merged; every MVP story exists as an issue with
acceptance criteria." Both are met.

## What went well

- Every change after the bootstrap commit went through an issue and a pull
  request, and the maintainer reviewed and merged each one.
- The user stories and their issues were generated from one data source, so
  the document and the tracker matched at creation.
- Requirements documents avoid unverified claims. Market assumptions are
  listed as assumptions; unmeasured targets are labelled as unmeasured.

## What went wrong

- **A wrong number in a commit message.** The risk-register commit says 31
  risks; the document has 30. The count was written from memory instead of
  from the file. The pull request description was corrected, but the commit
  message is permanent, because history is not rewritten.
- **A grammar slip reached 11 issues** ("As a end customer") before it was
  noticed and patched.
- **Branch protection was assumed, not checked.** The `main` ruleset existed
  with enforcement disabled for two pull requests before the agent looked.
- **Merge style differs from the working agreement.** `AGENTS.md` says squash
  merge; the five pull requests were merged with merge commits. Neither is
  wrong, but the document and the practice should agree.
- **The bootstrap commit went straight to `main`.** Unavoidable for an empty
  repository, and recorded in the commit message, but it is an exception to
  the rule and is listed here for that reason.

## Still open from M0

- #6: project board, private vulnerability reporting, and whether the agent
  may merge any category of pull request.
- Commit identity: commits are authored as "Claude" with a co-author trailer.
  The maintainer has not said whether to change this (#7).

## Changes for M1

1. Any number written in a commit message or pull request description is
   computed from the files first (a count command, not memory).
2. Generated text is read once in rendered form before it is posted to the
   tracker.
3. Settings the agent depends on are checked through the API, not assumed
   from a message saying they are done.
4. The maintainer decides between squash and merge commits; `AGENTS.md` is
   updated to match in its own pull request.
5. M1 depends on external rules (channel policy, data-protection law). Each
   such statement carries a source link and the date read, or is marked as an
   assumption.

## Process numbers

Counted from the repository on 2026-11-16, before this retro's own pull
request: 5 pull requests merged, 39 issues opened (of which 5 closed by
merged pull requests), 1 direct commit to `main`.
