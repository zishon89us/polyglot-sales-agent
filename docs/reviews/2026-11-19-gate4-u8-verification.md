# Gate 4 verification: U8 review fixes

A second agent, which had not seen the fixes made, was asked to check the
fixes to `2026-11-19-gate4-u8-worker.md` and try to break them, the new
15-minute expiry first. Its report follows, as received. It checked the
branch `fix/269-worker-review-fixes` at `b97c593`.

| ID | Sev (High/Medium/Low) | Location | Finding (with the reproduction you ran) | Fix |
| --- | --- | --- | --- | --- |
| V1 | Medium | `packages/db/src/outbound.ts:290,323-330` (`claimNextSend`); `send-policy.ts` comment on `SEND_EXPIRES_MS`; architecture "When the send job itself dies" | Expiry is measured from `created_at` with nothing else considered, so it also fires when no job died. Ran: one turn stored a reply, first `claimNextSend` 16 min later (as after a worker outage or a queue backlog) returned `{kind:"none", ended:["expired"]}`; row `failed/expired`, `send_attempts` 0, and 0 inbound rows left unhandled, so nothing ever answers that customer. The code comment "It can only wait so long when the job ... has died" is therefore untrue. Not run, computed: a backlog over 15 min would expire every reply. | Decide and document: either accept (say outage/backlog also expire, and alert on `expired`), or expire only when no live `send-messages` job exists for the conversation / re-open the inbound messages. |
| V2 | Medium (latent) | `outbound.ts:323` vs `:331` (expiry checked before `send_not_before`); `handlers.ts:132` (S8 clamp) | A message scheduled more than 15 min ahead can never be sent. Ran: pending message with `send_not_before` = now + 20 min: claim at t0 gave `wait 1199998`; claim at t+16 min (4 min before due) gave `ended:["expired"]`, `send_attempts` 0. So the S8 scenario (2 h ahead) now ends `expired` at the first look after the clamped hour; the S8 test passes only because it looks once. Not reachable from U8 code (waits are 2 s / 8 s), same standing as S8. | Measure expiry from `greatest(created_at, send_not_before)`, or state that `send_not_before` must stay under 15 min. |
| V3 | Low | `data-model.md:262`; `send-policy.ts` `EXPIRED` comment; `state-machines.md` §7 `failed` row; architecture class table | Documents vs code. (a) Ran: reply refused-retryable at 14:59, claim at 15:02 gave `failed/expired` with `send_attempts` 1; data-model and the code comment say `expired` means "never called for" (architecture's "never left holding it" is right). (b) State machines says a 15-minute message "stores `expired`"; it can store `unconfirmed` (ran: unknown at 14:59 then claim at 15:02 gave `unconfirmed`, attempts 1, unknown 1). (c) From reading: a third retryable refusal after an earlier unknown stores `unconfirmed`, while the architecture table says "then `failed` with the channel's code"; the paragraph below covers only non-retryable refusals. | Correct the three sentences. |
| V4 | Low | tests (`outbound.test.ts`, `worker.test.ts`) | 23 mutants, 20 killed, 3 survived, all in the new code: (M3) stale-and-expired branch disabled, so a reply stuck `sending` by a dead job is called once more however old, which is the late send S2 was about; (M17) `ended.push(decision.code)` removed, so a message ended `failed` when found stale (not expired) is not reported, although S10's response claims it; (M18) a call under way (not stale) ended as `unconfirmed` once the message is 15 min old, letting the next message overtake a live call. | Add: stale + expired assistant reply with `unknown_outcomes` 0 is not called again; stale service notice yields `ended:["unconfirmed"]` and one report; fresh `sending` past 15 min returns `wait`. |

**Confirmed fixed:**

- S2 mechanics: expired pending → `failed/expired`, next message goes; stale + expired → `failed/unconfirmed`, `unknown_outcomes` +1, `sending_at` NULL; fresh `sending` past 15 min → `wait 29996` (not ended); late `accepted` after that → `superseded`; exactly 15:00 still sends. Expiry only removes calls, so NFR-R2 bounds are untouched; no path found that spins (every `wait` is ≥ 1 ms, every `deferMs: 0` follows a message ended or a state change).
- S5, S6, S7, S8, S9, S10, S3, S4: each fix's mutant is killed (M7, M8, M13, M9, M10/M22, M11/M12/M16/M20, M14/M15, M1).
- S6/S10 run through the real handler: 4 messages (stale service notice, expired reply, two refused for good), 6 runs → results `[defer 0, defer 0, done ×4]`, 2 channel calls, exactly 4 reports, one per failed row, codes only (`unconfirmed`, `expired`, `meta-131026` ×2). Wrong tenant: threw `conversation-not-found`.
- S9: `abandonTurn` with an old token left a second worker's lease intact; another tenant could not free it; stale `finishTurn` → `lost-lease`.
- S3: two tenants, each with a `sending`, a `pending` and a `sent` row: after down both `sending` rows `failed/unconfirmed`, others unchanged; `relforcerowsecurity` true before down, after down and after up; `findIsolationProblems` `[]` after down and after up; up returned `["sending"]`; migrate role sees 0 rows afterwards.
- S4: the test fails (10 s timeout) when the job loop returns after its first error.

**Ran:** in a /tmp copy of `b97c593`: core send-policy, db outbound/migrate/isolation tests (127 passed); `apps/worker` tests 10 times (46 passed each, 0 failures, 3.4–4.0 s); 8 scratch experiments via the test harness; 23 mutants against core send-policy, db outbound/migrate/isolation/policy-check and worker tests. Afterwards: /tmp copy removed, no `psa_test_` or `rv_` database left, `git status --short` empty, dev database `psa` untouched.

**Could not check:** `main.ts` writing the `send-failed` line (not run; still untested, as the author says); whether a channel code could ever carry personal data (only saw that `error_code` is limited to 40 characters of letters, digits, `_`, `-`; did not read how `meta-…` codes are built); V1's backlog case at real scale (mechanism only, with a stepped clock); a job that hits the 4-minute handler timeout while its handler keeps running; real 15-minute waits (all times stepped); full `make check`, lint and typecheck (not run).

## Author's response

No finding is High. The changes below were not checked by another agent.

| ID | Response |
| --- | --- |
| V1 | **Accepted and stated; the behaviour is unchanged.** The rule does not tell a dead job from an outage or a backlog, and the documents now say so: after 15 minutes without a worker, the replies that were waiting are not sent, the customers who wrote just before get no answer, and each is reported as `send-failed expired`. The untrue comment is corrected. Re-opening the customer's messages was not done: an echo has nothing to re-think, and what a late reply should be is M3's question (#290) |
| V2 | **Fixed.** The 15 minutes count from when the message could first have gone: when it was stored, or the time it was last put off to. A test puts a message off by 20 minutes and sees it wait, go, and only later expire |
| V3 | **Fixed.** The three sentences are corrected: `expired` may have been called for and refused; a 15-minute message can store `unconfirmed`; a third refusal after an unknown outcome stores `unconfirmed` |
| V4 | **Fixed.** Three tests added: an old reply left being sent is not called for again; a call under way and not yet stale is left alone however old the message; a notice found stale is ended `unconfirmed` and reported once |

Of "Could not check": a `meta-…` code is the word `meta-` and a
non-negative whole number taken from the channel's answer
(`packages/channel-whatsapp/src/send.ts`); anything else in the answer
becomes the fixed word `rejected`.
