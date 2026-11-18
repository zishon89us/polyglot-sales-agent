# Gate 4 review: U6 the channel, mock-whatsapp and the webhook guard

The reviewer's report follows, as received. It reviewed the branch
`feat/267-channel-and-mock` at `100656a`. It was asked for no preamble and at
most 70 lines.

## Findings — U6 (#267), `feat/267-channel-and-mock`

No forged or unsigned request was handed on, and the size and signature guards were not bypassed in any probe. One High: a #154 criterion is tested only vacuously.

| ID | Sev | Location | Finding (reproduction) | Fix |
|---|---|---|---|---|
| C1 | High | `apps/api/src/webhook.test.ts:307-319` | The only test of "a valid request is never refused by this limit" is vacuous. It fires 2,000 valid posts with `Promise.all`, so all pass the `onRequest` check before any handler runs. Mutant "call `limiter.recordBad` for every valid request" (webhook.ts:104): 196/196 still pass. | Send them sequentially (more than `limit`), and add a valid-after-9-bad-then-valid case. |
| C2 | Medium | `apps/api/src/webhook.ts:80-89,101` | The limiter does not bound concurrent work: it checks before the body and records after. 60 sockets sent headers, waited 300 ms, then each sent a 3 MiB bad-signature body: 60×401, 60 bodies read and HMACed, about +210 MB RSS, with limit 10. | Count in-flight unverified requests per source, or record at `onRequest` and refund on a valid signature. |
| C3 | Medium | `webhook.ts:81,101`; `docs/design/api.md:149-150` | Source is `request.ip`. With Fastify defaults behind any proxy, every caller is one source: 5 bad posts, then a valid one got 429 (limit 3). With `trustProxy: true`, a spoofed `X-Forwarded-For` naming the channel's address got that address blocked, and rotating it avoided the limit (6 sources). The doc's one sentence states neither consequence nor how to configure it. | Take the source as an explicit option; document trusted hop count or proxy address, never `true`; say what an attacker gains if it is wrong. |
| C4 | Medium | `apps/api/src/bad-signature-limiter.ts:49-57,61`; `api.md:145` | "10 within a minute" is false at window edges: 1 at 0 s, 8 at 59.999 s, 9 at 60.000 s gives 18 bad in 1 ms, not blocked; 9 per minute is never blocked. Chunked oversize bodies (read up to the limit, then 413) and stalled bodies never count (8 in a row, 0 sources). A blocked source is forgotten once `maxSources` others appear (reproduced with 3). | Sliding window or token bucket; count 413-after-read; never evict a blocked entry; reword the doc. |
| C5 | Medium | `packages/channel-whatsapp/src/parse.ts:81,99,106,161`; `api.md` case table | All-or-nothing refusal loses good messages for good. One item of unexpected shape refuses the whole payload, which is answered 200 with only a hash kept. Triggers: a failed status with `errors: []` or `errors` not an array, a missing `status`, a message with neither `from` nor `from_user_id`, a number-typed `timestamp`. The fixtures README says the status shape was not read in full, yet the parser is strict on it. `api.md` does not say valid events in the same payload are dropped. | Refuse per item (count as skipped) for statuses and unknown message forms; state the loss in `api.md`. |
| C6 | Medium | `packages/channel-whatsapp/src/send.ts:37-38`; `apps/mock-whatsapp/src/server.ts:119-129`; `whatsapp.test.ts:332` | The `recipient` request field and the comment "If both are given Meta uses the number" have no source in the README (it lists `recipient_user_id`, and the send page as "search extract only"). The mock accepts the same field, so the test is circular; its title says "the documented request". | Record where it was read, or mark it assumed in README, A7 and #284. |
| C7 | Medium | `webhook.ts:53-117` (nothing sets timeouts) | Slow bodies and stuck sinks hold connections for ever. A real listener has `requestTimeout=0`, `timeout=0`; a body sent at 1 byte/s was still open after 8 s with no answer, and a sink that never resolves gave no response after 3 s. Each such connection may buffer up to 3 MiB. Not documented or deferred anywhere. | State required `requestTimeout`/`connectionTimeout` in `api.md` section 8, add a sink deadline answering 503, and test both. |
| C8 | Medium | `docs/requirements/nfr.md:49`; `api.md` case table | NFR-S2 ("100% of requests with a missing or invalid signature are answered 401") is no longer true: such requests get 429 when blocked, 413 when oversized, 400 on framing errors. Neither text was updated. | Amend NFR-S2 and the table row. |
| C9 | Low | `parse.ts:38-52,87,155` | The parser emits events the interface and contract call invalid: id `"  "` or `"\u0000"`, `receivingNumberId` `" "` or `".."`, `sentAt` in year 33658 (12 nines), `errorCode` `"1e+300"`, text with NUL or lone surrogates. If PostgreSQL rejects the NUL in U7, the answer becomes 503 and the channel redelivers for 7 days. | Tighten id and number-id patterns, bound the time, decide NUL handling here. |
| C10 | Low | `send.ts:45,57-61,65,85` | `receivingNumberId` `".."` posts the bearer token to `{base}/messages` (`.` and `..` survive `encodeURIComponent`). Permanent local faults (CR/LF in token, `timeoutMs` NaN, a 307) are reported `network, retryable: true`. A 50 MB answer is read whole. 408 and 400 with rate-limit codes are non-retryable. `id: " "` is accepted. | Require `^[0-9]{1,32}$`; classify; cap the answer size. |
| C11 | Low | `docs/STATUS.md` U6 entry; `webhook.test.ts:234` | "Refused before it is sent" is false for `Expect: 100-continue` with `Content-Length: 99999999`: the server answers `100 Continue`, then 413. | Say "before it is read". |
| C12 | Low | `webhook.ts:70-76` | A sink error carrying `statusCode: 413` is answered 413 "too-large" instead of 503. A validly signed post with `Content-Type: ;;;` gets 503 "send it again". Errors outside the scope (400, 404, 431) use Fastify's default bodies, which echo the URL path. | Test the error's code, not its status; set a root error and not-found handler. |
| C13 | Low | tests | 29 of 92 mutants survive (list under "Ran"). The ones that matter: parse-before-verify, limiter keyed on `X-Forwarded-For`, registration by `verifyToken.startsWith(token)` (an empty token passes), `redirect: "follow"`, `main.ts` on `0.0.0.0`, `/mock/sent` returning the token, sink `skipped` always 0. | Add tests. |
| C14 | Low | `docs/design/architecture.md` "The two mocks" | "Used by: the contract tests of `channel-whatsapp`" is half true: those at `whatsapp.test.ts:418` use a fetch stub; the HTTP run is `apps/mock-whatsapp/src/server.test.ts:365`. "The end-to-end tests" and "the test of NFR-M2" do not exist. "Proves that nothing outside `channel-whatsapp` knows about WhatsApp" is unproven, and `apps/api/src/webhook.ts:15-18` carries Meta's 3 MB as the default limit. | Reword; make the limit a channel property. |
| C15 | Low | `webhook.ts:91-96`; `signature.ts:29`; `packages/channel/package.json` | Registration GET has no attempt limit and no `nosniff` on the echoed challenge. `verifySignature(body, [sig], …)` returns true when called directly (the regex coerces the array). `contract.ts` imports `vitest`, which `packages/channel` does not declare. `mock-whatsapp` dev-depends on the `api` app: not against the rule's wording, but app-to-app. | As noted. |

**Clean:**
- **Signature over received bytes:** correct for chunked, gzip (verified over the compressed bytes, never decompressed), mismatched or duplicate `Content-Length` (400), pipelining (200 then 401), duplicate signature headers (401), upper-case header name (200), upper-case hex (401), empty body.
- **Size limit:** 413 with nothing sent for a huge announced length, at limit+1, and for chunked.
- **Order and errors:** the 200 comes only after the sink resolves; sink and parser errors give 503 with nothing echoed.
- **Routing:** other methods and path variants get 404; `%77hatsapp` decodes to the same route.
- **Signature code:** `timingSafeEqual` cannot throw (both sides 32 bytes), all secrets are tried, empty secrets are refused, the registration compare is digest-based.
- **Parser:** never threw or hung; worst case 94 ms for a 3 MiB input; `__proto__` and duplicate keys are harmless.
- **Token:** not in any result, error or `/mock/sent`; redirects are refused.
- **Mock:** `main.ts` binds 127.0.0.1; the page uses `textContent`; the inbound shape comparison is non-vacuous.
- **Channel knowledge:** nothing in `packages/channel`, `core`, `db` or `channel-mock` beyond comments.
- **Audit entry in STATUS:** accurate (picomatch ≤4.0.7, GHSA-fc5q-39xc-vjpf, via vitest only, no patched version, present in `main`'s lockfile).
- **ADR 0002 fastify row:** accurate (46 distinct packages; MIT, ISC, BSD-3-Clause).
- **"Stores nothing":** this unit only proves "hands nothing on"; STATUS and traceability say so.
- **Secrets and people:** none real; numbers are only `15550142`, `15550100`, `15550101`.

**Gate 4:**
1. Does what the criteria say, nothing else — fail (C2, C4: the limit is bypassable).
2. Each criterion has a test that fails without the change — fail (C1).
3. Failure paths tested — pass, with the gaps in C13.
4. Tenant-scoped — cannot judge (no queries in this unit).
5. External input validated, not treated as instruction — pass, with C5 and C9.
6. No secrets, personal data, disabled tests or weakened thresholds — pass.
7. New dependency justified, licensed, maintained — pass (maintenance of transitive packages admittedly not checked).
8. Logs carry no numbers or bodies — pass (nothing logs).
9. Docs, traceability and changelog match — fail (C3, C4, C8, C11, C14); there is no changelog file.

**Ran:**
- Raw-socket scripts against a real listener, about 60 cases.
- Limiter race, boundary, eviction and proxy scripts.
- 75 hostile parser inputs; 30 `sendText` answers.
- 92 mutants in a `/tmp` copy. Survivors: W4, W8, W12, W13, W16; L4, L5, L6; S1, S2, S7, S10; P1, P3, P8, P11, P14, P15, P16, P17, P19; D1, D3, D10; K5; M2, M7, M9; N1.
- Focused suite 5 times: 196/196 each, no flake. `pnpm run test`: 489/489. `make check`: exit 0.
- `pnpm audit --audit-level high`: 1 high, as STATUS says. This used the registry, as you asked.
- Scratch removed; `git status --short` empty; no stray listener.

**Could not check:**
- Anything about Meta's real behaviour (no network): the `recipient` field, HTTP status per error code, the status payload, whether system messages lack `from`. The rate-limit codes in C10 (4, 80007) are from memory.
- Timing side channels by measurement.
- The audit advisory's publication date.
- NFR-P1 under load: no load test exists.
- The real `trustProxy`, timeout and logger settings: no API server entry point exists yet.

---

## Author's response

Added on 2026-11-18 by the agent that wrote the change. The report above is
unedited. The High finding is accepted.

| Finding | Response |
| --- | --- |
| C1 | Fixed. The test now sends nine bad requests and then a hundred valid ones, one after another, from one source; all hundred are answered 200, and one more bad request then blocks. With the reviewer's mutant (count every valid request) it fails. |
| C2 | Not fixed, and now said plainly in `api.md` and in the limiter's own comment: the limit does not bound requests that arrive together. Bounding that takes a limit on connections, which is the platform's (#285). |
| C3 | Fixed. The server is made by `createApiServer`, which must be told the proxies in front of it as a list of addresses, never "all", and whose comment says what each mistake costs. `api.md` says the same. Tested with and without a declared proxy, and with a header that names another address. |
| C4 | Fixed. The window slides: ten refusals within any 60 seconds. A body over the size limit counts, as does a wrong registration token. A blocked source is not forgotten while an unblocked one can be forgotten instead, and the source just counted never is. Not counted: a body that stalls, which the 10-second limit on a request's arrival ends. |
| C5 | Fixed. A message or status of the wrong form is left out and counted as malformed, and the rest of the payload is read; a failed status with odd errors is kept, with the code "unknown". The count is handed to the sink. `api.md` says the item itself is lost. |
| C6 | It was read, and the README did not say so. The send page's extract has an example headed "Send to a BSUID" using `recipient`, and the user-ID page says the number takes precedence when both are given. The README now records both, and that which statuses mean "try again" is an assumption. The mock does accept the same field, so that test still shows only that the two agree. |
| C7 | Fixed. A request must arrive in full within 10 seconds and the sink must finish within 5, or the answer is 503. Both are in `api.md` section 8 and both are tested. |
| C8 | NFR-S2 is reworded and listed under "Blocked on the maintainer" in `STATUS.md`, since it is a requirement. The case table in `api.md` has the same. |
| C9 | Fixed. An identifier is printable characters without spaces, a receiving number is digits, a time is not after 2100, an error code is a whole number or "unknown", and the character U+0000 is removed from a text. A lone surrogate is kept as it came. |
| C10 | Fixed, except the rate-limit codes. A sender must be digits; a token that cannot go in a header is refused; a redirect is not followed and is a final failure; an answer over 64 KiB is not read; 408 may be retried; the settings are checked when the channel is made. Which of Meta's error codes mean "try again" is not known and not guessed. |
| C11 | Fixed: "before it is read". |
| C12 | Fixed. The handler goes by the framework's error code. A request it cannot read is 400. The server has its own answers for an unknown path and for an error, which repeat nothing of the request. |
| C13 | Tests added for the seven named: nothing is parsed before the signature is checked; a header naming another address changes nothing; the start of a token and an empty token are refused; a redirect is not followed, shown over HTTP with a second server that must receive nothing; the mock's address; the token is absent from what the mock shows; the counts reach the sink. The other survivors were not gone through one by one. |
| C14 | Reworded: what uses each mock today, what will, and that the claim about WhatsApp knowledge is not shown by either. The size limit is now the channel's own property. |
| C15 | A wrong registration token counts towards the limit, and the challenge is sent with `nosniff`. A signature header that is a list is refused. `packages/channel` declares `vitest`. `mock-whatsapp` still depends on the `api` app for one test (#285). |
