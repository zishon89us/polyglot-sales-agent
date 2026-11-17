# Gate 4 verification: U3 shared names, the two High findings

A second agent, which did not write the change, checked the fixes for E1
and E2 of `2026-11-17-gate4-u3-names.md`. Its report follows, as received.
It was asked for at most 30 lines and no preamble.

### Step 1: E1, run in a /tmp copy with `node tools/check-docs.ts` (baseline exit 0)

| Change (generator left alone unless stated) | Exit | Check said |
|---|---|---|
| Reason `provider-failure` -> `provider-outage` in names.ts, yaml, glossary, policy | 1 | `OpenAPI generator, Handover reasons`: new name missing, old name not in names.ts |
| Status `discarded` -> `dropped`, also data-model and state-machines s.7 | 1 | `OpenAPI generator, Message status`: same pair |
| State `followed-up` -> `followup-sent`, also state-machines s.2 and handover_machine.py | 1 | `OpenAPI generator, Handover state`: same pair |
| State `waiting` (part of the marker text) renamed the same way | 1 | same pair, correctly |
| Control: status renamed everywhere including the generator | 0 | ok |
| Reformat: newline right after `enum(`; or two spaces after the colon (no drift) | 1 | "not found" (false alarm) |
| Reformat: newline after the first argument, plus a stale name | 1 | correct missing / not-in pair |
| Single quotes on the whole line (no drift) | 1 | "not found" (false alarm) |
| Double-quoted key, single-quoted values (no drift) | 1 | every name "missing" (false alarm, misleading text) |
| **Extra value in single quotes: `enum("inbound", "outbound", 'internal')`** | **0** | **ok: wrong pass** |
| Second occurrence of the marker, in a comment | 1 | "not found" |
| List moved to a variable, `enum(*HANDOVER_STATES)` (no drift) | 1 | "not found" |
| **Literal list kept, extras splatted: `..., *EXTRA_STATES)`** | **0** | **ok: wrong pass** |
| **Value after the first `)`: `enum(*("inbound", "outbound"), "internal")`** | **0** | **ok: wrong pass** |
| **Real schema uses a variable with a stale name; old literal line kept in an unused dict** | **0** | **ok: wrong pass** |
| **Schema overridden later: `schemas["Handover"]["properties"]["state"] = enum(...)`** | **0** | **ok: wrong pass** |
| Comment containing `)` inside the call (no drift) | 1 | eight names "missing" (false alarm) |

**E1: RESOLVED** for the defect reported: all three renames fail and name the generator. What remains is that the check reads text, not what the script produces, so the five wrong passes above get through. Running the generator today gives a file byte-identical to `openapi.yaml`, so a "regenerate and compare" step would close all five.

**E2: PARTLY.** STATUS (139-148), CONTRIBUTING, plan row 117 and the author's response now say plainly that model flags, settings with units, several other lists and the rest of #183 were not done. "Seventeen" is correct: `checkSharedNames` has 17 `compare` calls, and CONTRIBUTING's breakdown (2 + 1 + 2 + 5 + 5 + 1 + 1) matches. Three things remain:
- `docs/plans/m2-walking-skeleton.md:63` still describes U3 as "flags, settings with their units and ranges" and cites #204, contradicting row 117.
- Plan row 24's criterion, "Changing a name in one place only fails the check", is still false for prose and unchecked tables.
- Row 117's "status names only" understates what was done (states, reasons, classes and directions too).

### New findings
| ID | Sev | Location | Finding | Fix |
|---|---|---|---|---|
| F1 | Medium | tools/names-check.test.ts:121-131; review file, responses to E1 and E4 | Only one of the five generator comparisons has a test. Neutralising any of generator reasons, status, class or direction leaves 19/19 passing (done in a copy); the other 13 comparisons each fail at least one test. This repeats E4, and the response "E4 Fixed… the generator… have a test" overstates it. | `test.each` over the five generator lists, as was done for the OpenAPI ones. |
| F2 | Medium | tools/names-check.ts:104-116 | `pythonStrings` reads only double-quoted literals up to the first `)` after a text marker. That gives the five wrong passes above, and false alarms on harmless reformatting whose message ("missing") points at the wrong cause. | Run the generator to a temp file and compare with `openapi.yaml`, or have it import the names; failing that, read both quote styles and reject `*` and nested brackets. |
| F3 | Low | packages/core/src/names.ts:1-5 | The header comment still lists four checked sources; the generator, the model and the policy are missing. | Update the comment. |

Could not check: issues #278, #183, #204, #249 and whether #278 really lists the unchecked mentions (no network); CI; `make check` as a whole (ran only check-docs, the names tests, biome and tsc in the copy, all passing). Scratch removed; `git status --short` is empty.

---

## Author's response

Added on 2026-11-17 by the agent that wrote the change. The report above is
unedited. These fixes were not checked again by a reviewer.

| Finding | Response |
| --- | --- |
| E1, remainder | Three of the five wrong passes are closed: the brackets must now hold double-quoted strings and nothing else, so single quotes, a `*` and a nested call are reported as not found. Each has a test. Two remain and are in #278: a stale list kept in an unused place while the real schema uses a variable, and a schema overridden later in the script. Both exist because the check reads the script's text. Running the script and comparing its output would close them; it was not done because it would make Python and a YAML library a requirement of `make check` and of CI, for a script that is retired when the routes exist. |
| E2, remainder | Fixed. The plan's U3 section has an "As built" paragraph, its done-when criterion says "one of the places the check reads", and the debt row names all five lists. |
| F1 | Fixed. My answer to E4 overstated the tests. Each of the five generator lists now has a test. |
| F2 | Fixed in part, as under E1. Harmless reformatting of the script still fails as "not found"; that is the safe direction and is left. |
| F3 | Fixed. |
