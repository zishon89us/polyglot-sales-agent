# Decisions waiting for the maintainer

One page, kept current. Each row is a choice the agent made so as not to
stop, or a thing only the maintainer can do. Answer with the row's number
and "yes", "no", or a few words; a "no" tells the agent what to change.
"If no" says what a no would cost, as far as the agent can tell.

Last brought up to date: 2026-11-21, at the end of M2.

## Needed before M3 builds on them

| # | Question | What was done | If no |
| --- | --- | --- | --- |
| 1 | **Is a customer the channel's own identifier first, and the phone number second?** WhatsApp may now send a customer with no number, only an identifier (#284) | A contact is found by identifier first. A number belongs to the identifier it last arrived with. Every case is a table in `design/data-model.md`, "Which contact a message belongs to" | The contact rules and their tests are rewritten; everything M3 stores per customer waits on it |
| 2 | **May a reply be sent a second time after a timeout,** not only after a worker stopped? US-C1 criterion 9 allows only the second (#290) | A reply is sent once more after any outcome nobody knows. A notice or a message the business starts is never sent twice | Either the criterion's text changes, or replies are not resent after a timeout and a customer may get no answer |
| 3 | **Is a message that waited over 15 minutes to be sent dropped,** not sent late? (#290) | It is marked `expired` and reported in the worker's log. After an outage that long, customers who wrote just before it get no answer | Another limit, or late sending, or re-opening the customer's message for a fresh answer, which is M3 work |
| 4 | **Supported languages** for v1.0, and who checks each language's test conversations (#168) | Nothing. The evals cannot be written without it | — |
| 5 | **Bedrock, a Claude model, `us-east-1`** as the working choice (ADR 0010, amendment) | Recorded as you said it on 2026-11-21. The model is chosen by measuring two or three; only models whose data Bedrock neither keeps nor shares are candidates | — |
| 6 | **AWS credentials and a spending limit** for the first eval run against a real model | Nothing; the agent does not ask for them until the eval harness exists | — |

## Made in M2; a yes closes them

| # | Question | What was done | If no |
| --- | --- | --- | --- |
| 7 | The send policy's other rows: a refusal that can be retried is tried three times, after 2 and 8 seconds; a fault on the channel's side counts as "unknown", not as a refusal (#290) | As asked | The policy is one function with a test for every sequence; a change is small |
| 8 | One job sends a conversation's messages, oldest first, one at a time (#290) | As asked | Ordering needs a rule of its own |
| 9 | `PSA_ENV` has no default: a process not told where it runs does not start (#295) | As asked | A default of `development` would let a forgotten setting run development parts for real |
| 10 | No worker starts in production until each tenant has its own WhatsApp credential (#295) | The guard refuses | The guard's last rule is removed and one credential serves every tenant |
| 11 | The stand-in for WhatsApp may listen on every interface inside a container (#295) | It says so loudly and never starts in production | The compose stack needs another way for containers to reach it |
| 12 | The application role, which serves the internet, has no access at all to the operator's record. ADR 0011 had allowed insert and read (#293) | As asked | One grant is added |
| 13 | A tenant's name is not written to the operator's record; the tenant is recorded by its identifier (#293) | As asked | One argument is added |
| 14 | `ops log show` and `ops channel connect` were added; commands that only read are recorded too (#293, #295) | As asked | They are removed |
| 15 | No query builder: SQL is fixed text in one package, and only that package imports the database driver (ADR 0003, amendment) | As asked | A query builder is chosen and the statements rewritten, about fifty of them |
| 16 | Database time limits: 2 s to connect, 4 s a statement, 3 s for a lock, 10 s idle in a transaction (#288) | As asked | Other numbers; one constant each |
| 17 | NFR-S2 as reworded: a request with a bad signature is refused and not stored, but not always with 401; an oversized or throttled one gets 413, 429 or a closed connection | As asked | Say which answers are acceptable |
| 18 | NFR-O1 as reworded: the worker is probed by a command that reads its heartbeat, since it serves no HTTP | As asked | Say how it should be probed |

## Only the maintainer can do

| # | Thing | Why it matters |
| --- | --- | --- |
| 19 | Turn on branch protection for `main`, and require the CI checks (#6) | Nothing stops a push to `main` or a merge while a check is red |
| 20 | Say whether pull requests should be merged by squash or by merge commit (OQ-11). `AGENTS.md` says squash; every merge so far was a merge commit | The history's shape; the document or the habit changes |
| 21 | Delete the three leftover branches (`feat/265-…`, `feat/267-…`, `feat/269-…`). Each holds nothing that is not in `main`; the agent's session may not delete branches | Tidiness |
| 22 | The copyright holder's name in `LICENSE`, currently the GitHub handle (#7) | Before anyone else uses the code |
| 23 | Check US-C2's criteria against what M2 built, and close #11 | The agent does not close a story on its own word |
| 24 | Whether one tenant's assistant can be paused (OQ-12) | Before any live use |

## Not needed until there is a real deployment

A hosting target and its account (ADR 0009); a Meta developer app and a
verified business number; a lawyer's reading of the points marked as
inference in `compliance.md`, above all sending message text to a model
outside the customer's country. None blocks v1.0 on the stand-in channel.
