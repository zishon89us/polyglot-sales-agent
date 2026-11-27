# Gate 4 review: the emergency phrase list and the unsupported-type reply (M3 unit U10, first part)

Date: 2026-11-28. Reviewed: commit `b0a4496` of pull request #340. The
reviewer was an independent agent that did not write the code, working
in a copy of the repository, where it ran the tests and 22 mutants. The
report is below as it was returned, unedited, but for one thing: an
unseen character in finding R7 is written as its escape (`\u200b`).
The author's response follows it.

## The report

**What I ran.** Read the design note, the source diff and the surrounding code (`handover.ts`, `sessions.ts`, `handlers.ts`, `sink.ts`, `parse.ts`, `plainText`); ran `emergency.test.ts` (336 pass) and the U10 describe of `disclosure.test.ts` (30 pass); probed `findEmergency` with about 90 inputs and timings from a script in `/tmp/rv`; ran 22 mutants. **Not checked:** `tools/e2e.test.ts` was read, not run; the full worker file was never run (mutants ran only against the U10 describe, so "alive" means alive there); `claimNextSend`/`recordSend` were not read in full; I cannot judge the Arabic, Urdu, Hindi, Bengali or Tagalog phrases as language.

All mutated files were restored; `git status --short` is empty.

## Findings

**R1 — High — `packages/core/src/emergency.ts:17-51` (en list) with `TAKEN_OUT` line 217.** Removing apostrophes turns the commonest English contractions into words the list lacks. These all return no match: "he isn't breathing", "she isnt breathing", "he's choking", "I'm choking on food". Also missed: "she is overdosing", "he committed suicide", "he had a stroke just now", "send an ambulance please". The first four are the list's own headline cases, lost to its own folding rule. Change: add "isnt/arent/wasnt breathing", "hes/shes/im/theyre choking", "overdosing", "committed suicide", and a test that every contraction of a listed phrase is found.

**R2 — High (product) — same list.** Harmless matches go well beyond the note's one example, and each costs 24 hours of silence. All of these fire:
- "that price nearly gave me a heart attack lol"
- "I could kill myself for forgetting the coupon"
- "the red dye is bleeding badly in the wash"
- "my car engine is choking on idle"
- "do you run unconscious bias training?"
- "I passed out flyers yesterday"
- "caffeine overdose tee in size M?"
- "do you treat chest pain?"
- tl: "Walang Malay version ng menu?" ("walang malay") and "maraming dugo ang karne na binili ko"
- hi: "मैं तुम्हारे लिए जान दे दूं" (as a non-speaker, this looks like a stock hyperbole)

Change: drop or narrow "passed out", "is choking", "bleeding badly", "maraming dugo", "जान दे दूं"/"جان دے دوں"; put this list in decisions row 53 so option (b) is decided on real examples.

**R3 — Medium — `emergency.ts:252-253`, `turn.ts:323-325`.** The space join fires across unrelated messages: ["the parcel I", "passed out to my neighbour"], ["who I am", "choking hazard for toys?"], ["It has not", "breathing fabric?"]. `beginTurn` also re-opens older messages into a batch, which widens this. Change: accept and document it, or match per message plus only the adjacent-pair join.

**R4 — Medium — ar list, `emergency.ts:52-83` and the lookbehind at 238 (non-speaker caveat).** Attached prefixes other than waw/feh defeat the match: "أصيب بنوبة قلبية", "عنده النوبة القلبية", "السكتة الدماغية" and "لا يتنفسون" all miss. Change: list the definite forms and allow ب/ل/ال before a phrase, with a speaker's review. Also missed: Hindi "सांस नही ले रहा" (short-i spelling) and latin "sans nahin aa rahi" (only one of the sans/nahin combinations is listed).

**R5 — Medium — `packages/db/src/outbound.ts`, `raiseEmergency` session-over branch (about 588-593); `handlers.ts:181-186`.** The comment says "The batch is left, and the next turn reads it again". That is false: `openSession` (`sessions.ts:71-88`) has by then ended the session and marked its inbound messages handled, and the transaction commits. An emergency batch is closed with no text and no handover, and the handler logs only `turn-skipped session-over`. The window is narrow (the session's 24 hours lapsing between `beginTurn` and this transaction). Mutant M15 (branch removed) survives. Change: correct the comment, add a test, and consider sending the text in this case.

**R6 — Low — `handlers.ts:169-175` with `turn.ts:341`.** `raiseEmergency` returns `reasons` every time, so an E4 batch (`made: "added"`, `told: null`) logs `handed-over` once for every reason the handover already has. The line counts batches, not handovers. Change: set `handedOver` only when `made !== "added"` or a reason was new.

**R7 — Low — `plainText` before folding.** Zero-width characters are removed before word splitting, so "heart\u200battack" becomes "heartattack" and misses. The prime "′" is not an apostrophe to the code ("can′t breathe" misses). Change: turn ignorables into a space in `emergencyFolded`; add U+2032.

**R8 — Low — tests, `disclosure.test.ts:1980`.** `test.each(UNREADABLE_KINDS)` iterates the constant under test, so removing "contacts" stays green (M8b). Change: a literal list in the test. Other gaps:
- No test for the handed-over-meanwhile race in `answerUnreadable` (M14 alive).
- Keheh→kaf and nukta removal are untested (M10b, M10d alive) and are not in note 2.2 step 3; noon ghunna is not in the note either.
- I found no named test for E6, E7, E8, N7 or N9 (I did not read every test body).

**R9 — Low — cost.** Matching is linear: about 15-40 ms per 100 kB, with no blow-up on any hostile shape tried. The only bound found is 65,536 characters per message (`parse.ts:89,146`); I found none on messages per batch. 50 × 64 kB took about 1.0 s synchronously in the worker. Change: cap the joined text, for example the last 20 kB.

**R10 — Note.**
- `turn.ts:218`: the doc comment "How a turn with the model ended." now sits above `UNREADABLE_KINDS`.
- Migration 0014 allows 3, but the code never stores more than 2.
- `AND_BEFORE` applies feh to Urdu too ("فدل کا دورہ" matches); note 2.2 says Arabic only.
- A `followed-up` handover on the same session would make the N2 trigger return `added`: no text, count stuck at 2. Probably unreachable before M4.
- Docs: `data-model.md` says the count resets "for a batch with text"; the note's N3 says "text or a tap" (the effect is the same, through the trigger). Guardrail policy section 6, state-machines 4a/13, STATUS and row 53 otherwise match the code as far as I read.

## Mutants

| Mutation | Result |
| --- | --- |
| M1 drop detach before trigger | killed (worker) |
| M2 drop tapped's reason | killed (worker) |
| M3 skip marking batch | killed (worker, 5 tests) |
| M4 `>=` to `>` | killed (worker) |
| M5 remove reset in trigger | killed (worker) |
| M6 remove reset in `finishTurn` | killed (worker) |
| M7 remove `answering` condition | killed (worker) |
| M8 remove "sticker" | killed (worker) |
| M8b remove "contacts" | **alive** |
| M9 drop "and" prefix | killed (core) |
| M10 drop teh marbuta fold | killed (core) |
| M10b drop keheh→kaf | **alive** |
| M10c drop noon ghunna | killed (core) |
| M10d nukta not taken out | **alive** |
| M11 remove lookbehind | killed (core) |
| M12 remove lookahead | killed (core) |
| M13 lookbehind without digits | killed (core) |
| M14 drop already-handed-over check in `answerUnreadable` | **alive** |
| M15 drop session-over check in `raiseEmergency` | **alive** |
| M16 reply without button | killed (worker) |
| M17 count not incremented | killed (worker) |
| M18 drop longest-first sort | alive (equivalent: alternation backtracks) |

## Could not fault

- No path found where a batch with a matched phrase reaches the model, loops unmarked, or gets two texts; `raiseEmergency` is one transaction under `holdsLease`, as `finishTurn` and `joinHandover` are.
- Detach-then-trigger for waiting under and over 24 hours; in-progress is left attached and gets `added`.
- E3: the emergency check comes before the `answering` check.
- N1, N2, N4, N5, N6: the code matches the rows.
- The stored `system-reply` goes out with its button through `call()`; the test asserts the disclosure and the button.
- `UNREADABLE_KINDS` matches what `sink.ts` and `parse.ts` store (a caption-less image or video keeps its channel name; a caption becomes `text`).
- No phrase fails rule 2.1, duplicates after folding, mixes scripts or holds stray characters.
- Boundaries hold inside longer words in Latin and Arabic script; no Spanish or Indonesian collision found in the few sentences tried.

## Author's response

**These fixes are checked by the author only.** No second agent read
them or ran the mutants again.

| Finding | Response |
| --- | --- |
| R1 | Fixed: the contracted forms, "overdosing", "committed suicide", "had a stroke" and "send an ambulance" are listed, with a test of each sentence the reviewer gave |
| R2 | Partly fixed. Taken out or narrowed: "passed out", "unconscious" alone (now "is unconscious" and the like), "is choking" (now with who is choking), "bleeding badly", the two Tagalog phrases, and the Hindi and Urdu phrase the reviewer took for a figure of speech. Kept, and they still fire: "heart attack", "kill myself", "overdose", "chest pain". A test holds both lists. The examples are in decisions row 53, question (b) |
| R3 | Accepted and said in the note (2.2), with a test that shows it. Not changed: a phrase over two messages is the commoner case |
| R4 | Mostly fixed: the definite forms are listed, the one-letter "with" may stand before a phrase, the plural is listed; the Hindi short spelling and the missing Latin spellings are listed. The one-letter "for" is still not allowed. No speaker has read any of it (row 53) |
| R5 | The comment is corrected and the miss is said in the note (2.4). No test, and the text is not sent in that case: #341 |
| R6 | Fixed: a phrase that adds nothing and sends nothing is not reported as a handover; a test holds it |
| R7 | The prime is taken out as an apostrophe. An unseen character inside a word is still taken out and not made a space, so that a word split by one is read: said in the note (2.2) |
| R8 | The kinds are a literal list in a test; the Urdu kaf and the dot below a Hindi letter have tests; the note names every folding. Not done: a test of the race in `answerUnreadable` (M14), and named tests for E7, E8, N7 and N9: #341 |
| R9 | Fixed: of a batch over 20,000 characters the first and the last 10,000 are read; said in the note, with a test |
| R10 | The comment is moved; the note says the Arabic and the Urdu list; the data model's wording is corrected. Left: the range 0 to 3 (the state machines' own), and a followed-up handover, which nothing can make before M4 (#341) |

Of the 22 mutants, 6 were alive, one of them equivalent. Three of the
five others (M8b, M10b, M10d) now have a test written for them; M14 and
M15 are #341's.
