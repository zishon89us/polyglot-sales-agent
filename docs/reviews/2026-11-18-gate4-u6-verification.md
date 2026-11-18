# Gate 4 verification: U6, the High finding and the fixes around it

A second agent, which did not write the change, checked the fix for C1 of
`2026-11-18-gate4-u6-channel.md` and the fixes beside it, at `d9fc7d7`. Its
report follows, as received. It was asked for at most 40 lines and no
preamble.

**C1: RESOLVED.** In a /tmp copy, calling `limiter.recordBad` for every valid request fails `valid requests never count: a hundred in a row…` (1 failed of 44). Other breakages — killed: limiter keyed on `X-Forwarded-For`, no `isBlocked` for POST (5 fail), none for GET, 413 not counted. **Survive (44/44 pass):** count when the body is signed but unparsed (sink `unparsed` path); count when the sink throws or is slow (503 path); count valid requests that carry a message, or have `skipped`/`malformed` > 0; count the 400 path. The test only sends `status-delivered.json`, so "valid never counts" is shown for that one shape.

| Step | Result | Reproduction |
|---|---|---|
| 2 limiter | Sliding window correct for sequential refusals: 1@0+9@59 999 blocks; 1@0+9@60 000 does not; the old C4 case blocks at 60 000; 9 per window ×1000 never blocks. A blocked source's further refusals get 429 at `onRequest` and do not extend the block (401 again at exactly 60 000, over HTTP). Refusals already in flight do extend it (10@0 + 10@59 999 → blocked to 119 999). Map never exceeds `maxSources`. Clock stepping back lengthens a block (`Date.now`). | `recordBad`/`isBlocked` scripts |
| 2 eviction | A source at 9 refusals is forgotten when `maxSources` newer sources appear: 10 001 addresses round-robin, 200 020 refusals in 200 ms, 0 blocks (10 000 addresses: all blocked). With every slot blocked, a new source evicts the oldest blocked one (`b0` unblocked). So "ten … within any 60 seconds" holds only while fewer than 10 000 sources are active. | same |
| 3 proxies | `false`: `request.ip` is the socket address for every XFF tried. `["192.0.2.10"]` and a request from 198.51.100.66 with XFF: header ignored, the caller is blocked, not the named victim. Chain `a, b` from the proxy: source is `b` (right-most); rotating `a` does not avoid the block. `0.0.0.0/0` throws. | real listener + `inject` |
| 3 timeouts | Silent connection, partial headers and stalled body close at the timeout (1 004–1 009 ms at 1 s). Idle keep-alive closes at 6 s. **Trickled body is not cut at 10 s — D1.** | raw sockets |
| 3 errors | Root handler: thrown 500/502/plain → 503 with nothing shown; thrown `statusCode` 401, 403, 404, 409, 422, 429 **all → 400 "malformed"** (D3). Scoped handler still wins on the webhook (413, 400, 503). | routes added in a script |
| 4 sink | After the 503 (104–148 ms at a 100 ms deadline) the sink settled at ~400 ms, resolving or rejecting: no unhandled rejection, no late write. Consequence for U7 not stated anywhere (D4). | real listener |
| 5 parser | (a) good/bad/good → 2 events, `malformed=1`. (b) metadata missing in one change → its 3 messages lost, `malformed=1`. (c) non-object in `entry` and (d) one entry without `changes` → **whole payload refused `bad-shape`** (D5). No double count; no case found with `malformed=0` and a silent drop. | 26 payloads |
| 6 send | 301/302/303/307/308 with `redirect:"manual"`: status as sent, `type:"basic"`; all → `redirected`, second server got 0 requests (300 and 304 also say `redirected`). 204 → `bad-response`; exactly 64 KiB accepted, +1 byte refused; stream error mid-way → `bad-response`; invalid UTF-8 → **accepted, id `wamid.��`**. Trailing-slash base posts to `//v27.0/…`, which a local server served; no valid base or version wrongly refused. | real HTTP servers |

**New findings**
- **D1 Medium** `apps/api/src/server.ts:35-37`, `docs/design/api.md:172-173`. A body trickled at 1 byte/s (or 1 byte/9 s) with the default 10 s settings was closed with 408 after **90 004 ms**; connections started 25 s and 45 s into the server's life lasted 65 s and 75 s. Plain `node:http` with the same two settings closes at 30 s. `connectionTimeout` is an idle timer a trickle resets; `requestTimeout` is only checked every 30 s, and under Fastify fired at about 60 s of age (cause not found). Removing `requestTimeout` fails no test. Fix: a deadline of its own on reading the body (or a lower `connectionsCheckingInterval`), a trickle test, and reword the doc.
- **D2 Low** `server.ts:42-43`. `GET /webhooks/+15550142%zz` → 400 `"'/webhooks/+15550142%zz' is not a valid url component"`: Fastify's `FST_ERR_BAD_URL` body still echoes the path. Bad request line, 431 and 408 also use Fastify's bodies (no echo). Fix: `frameworkErrors` and a `clientErrorHandler`.
- **D3 Medium (trap for the next unit)** `server.ts:44-50`. Any route that throws with `statusCode` 401/403/404/409/429 is answered 400 "malformed"; `api.md` section 2 promises codes such as 409 `contact-opted-out`. Removing the root handler fails no test. Fix: map only `FST_ERR_*` to 400, pass through a typed problem error, add tests.
- **D4 Medium** `apps/api/src/webhook.ts:71-77,143-157`. The sink is not cancelled at the deadline (no signal in `WebhookSink`), so it can commit after the 503; the channel then redelivers, and each redelivery during a stall starts another sink. Events are covered by the unique constraint, but `unparsed` has no stated deduplication (double rows, double alerts). Fix: pass an `AbortSignal`, and state in `api.md` that a 503 does not mean "not stored".
- **D5 Low** `packages/channel-whatsapp/src/parse.ts:181-185`. One entry without `changes`, or a non-object entry, refuses the good entries beside it (200, hash only) — the loss C5 was about, one level up. `api.md` does not say that a group without metadata counts as 1 whatever it held. Fix: walk entries with `attempt`.
- **D6 Low** tests. Survivors: `malformed: 0` to the sink (only `skipped` is asserted); removing the `before` guard (a malformed status counted twice); `trustProxy: true` for a list (no test of a non-proxy caller carrying XFF with a proxy declared); answer cap `>=`.
- **D7 Low** `packages/channel-whatsapp/src/index.ts:36,42`. Accepted, then every send fails as `network, retryable: true`: `https://:pw@host` (only `username` is checked), a base with spaces around it, `timeoutMs` 0.5 or 2^40. `?x=1` in the base is accepted and posts to `/?x=1/v27.0/…`. A timeout while reading a 200's body is `bad-response`, not retryable (501 ms measured).
- **D8 Low** `webhook.ts:126`. `HEAD /webhooks/whatsapp` (auto-exposed) answers 403 and counts as a wrong token.

**Flakiness:** focused suite 5×: 252/252 each, about 2.0 s, none. `pnpm run test`: 545/545, 13 files, 9.4 s; PostgreSQL was reachable and left untouched. The slow-body test passes on the idle timer alone.

**False claims**
- `api.md:172` "must arrive in full within 10 seconds or its connection is closed": false for a trickle (D1). Response C7 "both are tested": the request timeout is not; "or the answer is 503" is wrong for slow arrival (closed or 408).
- C7 and `bad-signature-limiter.ts:10` cite "`api.md` section 8"; the limits table is section 7 (8 is "Stories to operations").
- `api.md` "never answers 400 … to a validly signed request": a validly signed post with `Content-Type: ;;;` gets 400.
- NFR-S2's list (401, 413, 429, 400) omits 408 and 431, both observed for unsigned requests.
- C12 and `server.ts:42` "repeat nothing of the request": false for D2. C13 "the counts reach the sink": only `skipped` is asserted. C3 "tested with … a declared proxy": not the spoofing case. C4's "any 60 seconds": subject to eviction (step 2).
- Checked true: C1, C5, C9, C10 (except D7), C11, C14, C15; the counts 252 and 10/60 s/60 s/10 000.

**Could not check:** Meta's real behaviour (`//v27.0` on graph.facebook.com, 429 redelivery, `recipient`), why Fastify's request timeout fires at about 60 s, and behaviour behind a real proxy or over IPv6. Scratch removed; `git status --short` empty; no listener or process of mine left.

---

## Author's response

Added on 2026-11-18 by the agent that wrote the change. The report above is
unedited. It found no High defect, and three Medium ones, two of them in my
fixes. Five sentences in my first response were wrong, as it lists; the
corrections are below. These second fixes were not checked again by a
reviewer.

| Finding | Response |
| --- | --- |
| C1, remainder | Fixed. A further test sends twelve valid requests of each kind from one source: with a message, with a part left out, with a malformed message, unreadable, and while the sink fails. After all sixty the source is not blocked. |
| D1 | Fixed. A request has a timer of its own from its first byte to the end of its body; at the deadline the connection is cut, whether the body stopped or trickled. Tested with a body sent a byte every 50 ms, and with a request that arrived in time and whose sink then took longer than the deadline, which must not be cut. My earlier "both are tested" was false: the slow-body test passed on the idle timer alone. |
| D2 | Fixed. A path that cannot be decoded is answered 400 without repeating it. Tested. The framework's own answers to a bad request line, to headers that are too large and to its own timeout are left; the reviewer found they repeat nothing. |
| D3 | Fixed. A route answers a client error by throwing `ProblemError`, which is passed on as it says. Any other error is 503 whatever status it carries; only the framework's own complaints about a request become 400. Tested. |
| D4 | Fixed in the interface, and stated. The sink gets a signal that aborts at the deadline, and `api.md` says a 503 does not mean nothing was stored, so storing must be safe to repeat; for the record of an unreadable body that is unit U7's to make true. Tested: the signal aborts at the deadline and not before, and a sink that fails afterwards causes no unhandled rejection. |
| D5 | Fixed. An entry that cannot be walked is counted and the entries beside it are read. `api.md` says a group or an entry counts as one however much it held. Tested. |
| D6 | Tests added for each: the malformed count reaches the sink; a malformed status is counted once and as malformed only; a caller that is not the proxy cannot name another address; the answer cap at exactly 64 KiB and one byte over. |
| D7 | Fixed, except the last. The base address must be exactly a scheme and a host; the timeout a whole number of milliseconds up to two minutes. An identifier in a success must be plain printable characters. A failure while reading a 200's body stays "bad-response" and is not retried, on purpose: Meta has accepted the message, and sending again would send twice. The code now says so. |
| D8 | Fixed. No HEAD route exists. Tested. |
| Eviction | Not fixed; now stated in `api.md` and in the limiter's comment: the limit holds for at most 10,000 sources at once. Also not fixed: a clock that steps back lengthens a block (#285). |
| Claims | Corrected. The limits table is in section 7, and the code now points to section 3, where the limit is described. `api.md` no longer says the webhook never answers 400 to a validly signed request without the exception. NFR-S2 no longer lists statuses that left two out; it names the kinds of refusal. |
