# Retro: M1 Design

Date: 2026-11-17 · Issue #257

## What was delivered

| Item | Evidence |
| --- | --- |
| State machines, with two executable models | #127 |
| Decision records 0001 to 0012; 0009 (hosting) and 0010 (model provider) are proposed and wait for the maintainer | #151, #175, #254 |
| Architecture | #152, amended in #254 |
| Data model | #153, amended in #174, #175, #254 |
| Threat model: 60 threats | #167, amended in #254 |
| Eval plan: 18 dimensions | #169, amended in #254 |
| Guardrail policy: 16 rules | #170, amended in #254 |
| API description and OpenAPI file: 44 paths, 57 operations | #171, #172, #254 |
| Gate 2 review: two reviews, two verifications, responses | #254 |
| README rewritten | #256 |

Exit criteria: "Design documents merged; open questions listed for the
human." Both are met. Gate 2 passed on 2026-11-17 on the rule that no High
finding is open.

Fourteen pull requests were merged in this milestone, one of them (#172)
from a second session the maintainer ran. The repository has 124 commits.

## What went well

- **The independent reviews found what mattered.** Twenty High findings in
  the first pass, among them a guardrail claim that was false, a lock that
  could not work, and a core that was not pack-independent. None of these
  would have been found by the author re-reading its own work.
- **Reports were committed unedited, with a response to every finding.** A
  reader can check what was found against what was done.
- **The maintainer made the two decisions reserved for a person** (moving
  booking out of the core; treating channel statements as assumptions)
  when asked, with the options laid out.
- **Stacking pull requests** kept the work moving while earlier ones waited
  for review, without mixing changes.
- **Tables and executable models converged; prose did not.** The state
  machines were verified twice at Gate 1 and drew few findings at Gate 2.
  The prose documents drew most of them.

## What went wrong

1. **The author described its own documents as sound before any review.**
   Summaries to the maintainer of the threat model, guardrail policy and
   eval plan presented them as complete. The review then found 13 High
   defects in those three. The statement in ADR 0007 that a false price is
   blocked even under full manipulation was wrong and had been repeated in
   three documents.
2. **Fixes introduced new High defects.** Three of them, in one afternoon:
   a key that would have blocked rebooking a cancelled slot; an emergency
   mark added to a requirement but to no machine, table or API; and a
   decision record claiming booking had left the core while core tables
   still held it. Each came from changing one document and not the others
   that state the same fact.
3. **The same fact lives in several documents.** Reason codes, settings and
   their units, message statuses, flag lists and step lists each appear in
   three to five places, kept in step by hand. Most Medium findings are one
   of these drifting.
4. **Review does not converge on prose.** Each of three rounds found
   defects in the round before. The last still added eight Medium findings.
   146 review findings are open as issues across both gates.
5. **Sources were not read as the working agreement requires.** Channel
   rules were read as search extracts; STRIDE, the OWASP list and the NIST
   framework by their headings. Each is disclosed where used, but section
   11 says to read a standard before first using it, and that was not done.
6. **A tool the session could not run.** The OpenAPI linter was run by a
   second session. This session regenerated the file twice afterwards and
   could not re-lint it.
7. **Housekeeping.** Merged branches accumulated until the maintainer
   noticed seventeen of them. The repository shows 200 open issues with no
   code, which reads badly to a visitor.

## What changes in M2

| Change | Why |
| --- | --- |
| **One source for each shared fact.** In M2 the schemas in code become that source: enums, settings and routes are defined once, and the OpenAPI file and the tables in the documents are generated from them or checked against them in CI | Went wrong 2 and 3 |
| **A finding becomes a test where it can.** Each High finding from Gate 2 that describes behaviour gets a named test in the milestone that builds it, listed in the test plan | Went wrong 4: tests converge, reading does not |
| **Before a verification, the author greps for every statement of the fact it changed** and lists the files in the pull request | Went wrong 2 |
| **No summary to the maintainer calls unreviewed work complete.** It says "written, not reviewed" until a review has run | Went wrong 1 |
| **Triage the open findings at the start of M2:** assign each to the milestone that builds its subject, and close those the code will make obsolete | Went wrong 4 and 7 |
| **The linter and other checks run in CI from the first M2 pull request,** so no check depends on which session can run it | Went wrong 6 |
| **Code review (Gate 4) is per pull request and small,** not one large pass at the end | Went wrong 4 |

Three items are added to the Gate 2 checklist in this pull request, as
`AGENTS.md` section 11 asks when a checklist should have caught a defect.

## Not resolved

- Went wrong 5 is not fixed. The sources are still unread in full. It is
  recorded as assumption A7 in the threat model and must be done before any
  live use.
- No person has reviewed the requirements or the design in detail.
- Questions the maintainer has not answered: the commit author identity;
  squash or merge commits (OQ-11); whether one tenant's assistant can be
  paused (OQ-12); the supported languages and reviewers (#168); hosting
  (ADR 0009) and the model provider (ADR 0010). The last two block parts of
  M3 and M6, not M2.
