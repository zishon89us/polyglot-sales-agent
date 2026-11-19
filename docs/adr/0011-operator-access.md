---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "agent (proposal), maintainer (approval)"
---

# Operator access through commands run on the server, with an insert-only log

## Context and Problem Statement

The operator creates tenants and is the person who must be able to stop the
assistant when something goes wrong. The design so far says the operator
exists (architecture section 3) and that a separate database role crosses
tenants (ADR 0003, data model), but not how the operator does anything or
how their actions are recorded. The threat model lists this as T39, with no
mitigation, and issue #161 asks for the decision. The audit log is
tenant-owned, so it cannot hold an action that belongs to no tenant.

The operator in v1.0 is one person, the maintainer (glossary; threat-model
assumption A4).

## Decision Drivers

- No dashboard route may reach the cross-tenant role (T39, T27).
- Every action a person takes across tenants leaves a record the application
  cannot change.
- Version 1.0 has one operator. Building accounts, roles and screens for one
  person is cost without benefit.
- Someone must be able to stop the assistant quickly (Gate 3 checklist:
  "who can take over, stop or roll back").
- Nothing here may need an account or cost money that the maintainer has not
  approved (`AGENTS.md`, "when to stop and ask").

## Considered Options

- Commands run on the server by the operator
- An operator area in the dashboard, with its own sign-in
- Configuration files in the repository, applied at deployment

## Decision Outcome

Chosen option: "commands run on the server", because it adds no route that
could be attacked from the internet, needs no second sign-in system, and is
enough for one operator.

The operator runs a small command-line program, `ops`, inside the
deployment. It ships in the same image as `api` and `worker` and uses the
same code for every rule it applies.

| Command | What it does |
| --- | --- |
| `ops tenant create` | Creates a tenant with a name, a pack and an owner email address, and sends the owner's invitation (US-D10 criterion 1) |
| `ops tenant list` | Lists tenants with their state. No customer data |
| `ops service degraded on` / `off` | Puts the whole service into degraded mode and holds it there, or releases the hold. In degraded mode no model is called and customers are offered a person. While the operator holds it, a successful health check does not end it (state machines section 8, amended with this ADR) |
| `ops jobs list-dead` / `retry` | Shows jobs in the dead-letter state, and retries one (NFR-R5) |
| `ops events list-unparsed` | Shows metadata of signed events that could not be parsed (`api.md`, decision 7) |

Rules:

1. **Who may run it.** Whoever can open a shell in the deployment. That
   access is controlled by the hosting platform, which is not chosen
   (ADR 0009). This ADR therefore depends on ADR 0009 naming how shell
   access is granted and logged.
2. **Which database role.** `ops` connects with the cross-tenant role, whose
   credential is supplied only to processes that need it. It goes through
   the one module allowed to use that role (data model, "access before the
   tenant is known"); the import-boundary test covers `ops` too.
3. **The record.** Every command writes a row to a new table,
   `operator_log`, before it acts and updates nothing afterwards: the
   command, its arguments, the name the operator gave with `--as`, the time
   and the outcome as a second row. The table is outside tenant scoping.
   The application and cross-tenant roles may insert into it and read it;
   neither may update or delete.
4. **No personal data in the record.** Arguments that are personal, such as
   the owner's email address, are recorded as the identifier of the row they
   created, not as the value.
5. **No customer data on screen.** No command prints message text, a phone
   number or a contact's name.
6. **Rolling back a prompt** is not a command. The prompt version is
   configuration (`AGENTS.md` section 6), so a rollback is a change to that
   configuration and a deployment, made by pull request like any other
   change.

### What this does not give

- **One tenant cannot be paused.** The operator can stop the assistant for
  everyone (degraded mode) but not for one business, and an owner cannot
  switch it off for their own business except by taking conversations over
  one at a time (guardrail policy, section 10). Adding a pause changes the
  tenant state machine and US-D6, so it is a change of scope. It is listed
  as open question OQ-12 for the maintainer; the agent's recommendation is
  to add it before any live use.
- **The record can be bypassed** by anyone who can open a shell and connect
  to the database directly. The log shows what was done through `ops`, not
  everything a person with that access did. Only the platform's own access
  log can show the rest (ADR 0009).
- **`--as` is a claim, not proof.** With one operator this is acceptable. A
  second operator makes it inadequate.

### Consequences

- Good, because the internet-facing surface does not grow: there is no
  operator route, sign-in or session to attack.
- Good, because tenant creation uses the same code as the rest of the
  system, including sending the invitation.
- Good, because T39 now has a mitigation and a stated remainder.
- Bad, because operating the service needs shell access, which is a strong
  permission to hand out.
- Bad, because the record depends on people using `ops` and not the database
  directly.
- Bad, because it does not suit more than one operator. An operator area
  with real accounts would then be needed, and this ADR superseded.

### Confirmation

By the end of milestone M2: `ops tenant create` exists and is the only way a
tenant is created outside tests; a test shows each command writes its two
`operator_log` rows; a test connects as the application role and fails to
update or delete a row of `operator_log`; the import-boundary test includes
`ops`; the route inventory (NFR-S8) shows no operator route. The remaining
commands exist by the milestone that first needs them: degraded mode in M3,
dead-letter commands in M2.

## Pros and Cons of the Options

### Commands run on the server

- Good, because there is nothing new to reach from the internet.
- Good, because it is small to build and test.
- Neutral, because it relies on the platform to control who has a shell.
- Bad, because the record is only as complete as people's use of the tool.

### An operator area in the dashboard

- Good, because actions are tied to a signed-in person and can require a
  second factor.
- Good, because it would suit several operators.
- Bad, because it puts a route to the cross-tenant role on the internet,
  which is the most damaging thing in the system to get wrong (R-T2).
- Bad, because it needs a second kind of account, session and role check for
  one user.

### Configuration files applied at deployment

- Good, because every change is a reviewed pull request.
- Bad, because a tenant's owner email address would be committed to the
  repository, which is personal data in version control.
- Bad, because stopping the assistant in an incident would wait for a
  deployment.

## More Information

- Threat model: T39, and assumption A4.
- Data model: `operator_log` is added under "Tables outside tenant scoping".
- Issue #162 covers the separation of database roles this relies on.
- Issue #161, which this closes, also asked whether an owner can switch the
  assistant off; that part moves to OQ-12.

## Amendment, 2026-11-19: as built in M2 unit U9

Made while building the commands (issue #270). The decision is unchanged.
Each point is the agent's and awaits the maintainer.

- **The application role gets nothing on `operator_log`.** Rule 3 said the
  application and cross-tenant roles "may insert into it and read it".
  Nothing the application role does needs either, and it is the role that
  serves requests from the internet, so it is granted no privilege on the
  table. Only the cross-tenant role, which `ops` connects as, may insert
  and read. No role may update, delete or truncate: besides the missing
  privileges, a trigger refuses all three, the owner's included.
- **What a row holds.** `invocation_id` ties a command's two rows.
  `arguments` holds identifiers and short settings only, and the database
  refuses anything else: a value with a space, an `@` or a `+` in it does
  not fit. A tenant's name is therefore not recorded, since a business's
  name can be a person's; the finished row has the tenant's identifier in
  `subject_id`. `outcome` is `ok` or a short code.
- **The first row is committed before the action**, on its own. If it
  cannot be written the action does not run. If the process stops after
  the action and before the second row, the record shows a command that
  started and never finished.
- **Commands built:** `tenant create` (the tenant only: name, pack, time
  zone, default language; no owner and no invitation until M4, #201),
  `tenant list`, `jobs list-dead`, `jobs retry`, and `log show`, which was
  added so that the record can be read without SQL. Commands that only
  read are recorded too. `service degraded` and `events list-unparsed` are
  not built.
- **Rule 2, the one module.** The operator's functions are an entry of
  their own in the database package, and a test fails if any file outside
  `apps/ops` imports it. The package's main entry, which the API and the
  worker import, has none of them. This is the same kind of guard as the
  driver boundary of ADR 0003: against a shortcut taken by accident.
- **The route inventory** is a test: the API answers on `/healthz`,
  `/readyz` and `/webhooks/whatsapp`, and on nothing else.
- **"The only way a tenant is created outside tests"** holds in that no
  other code path creates one. Nothing stops a person with the database
  doing it by hand, as the decision already says of the record.

What is not built is listed in #293.

