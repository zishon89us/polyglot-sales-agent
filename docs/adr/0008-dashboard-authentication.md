---
status: "accepted by the agent; awaiting maintainer review"
date: 2026-11-16
decision-makers: "the maintainer, on the agent's proposal"
---

# Email and password with server-side sessions

## Context and Problem Statement

Owners and staff sign in to the dashboard. Accounts are created by invitation
only (ADR 0001, US-D10), with two roles (US-D7), sessions that expire
(US-D1), lockout after failed attempts (NFR-S6) and no open sign-up
(NFR-S8). How are users authenticated and sessions kept?

## Decision Drivers

- Version 1.0 must run from a fresh clone with no external account
  (NFR-M4, ADR 0001).
- US-D7: removing a user must end their sessions within 60 seconds.
- A session must carry the tenant, so that the database's row-level security
  (ADR 0003) is set from it and not from anything the browser sends.
- Authentication is security-critical code; as little of it as possible
  should be original.
- Persona P1 will not manage an authenticator app or a separate identity
  account.

## Considered Options

- Email and password, with sessions stored on the server
- Email and password, with signed tokens held by the browser
- A managed identity provider
- Sign-in by emailed link only, no password

## Decision Outcome

Chosen option: "email and password with server-side sessions", because it
needs no outside service and lets a session be ended at once by deleting a
row.

Specifics:

- Passwords are hashed with a memory-hard algorithm from a maintained
  library; the algorithm and parameters are recorded when the library is
  chosen in M4. Minimum length is in the glossary. No composition rules.
- A session is a row holding a random identifier's hash, the user, the
  tenant, creation time and last-used time. The browser holds only the random
  identifier, in a cookie that scripts cannot read, sent only over HTTPS and
  only to the same site.
- Each request looks the session up, enforces the idle and total lifetimes
  from the glossary, and sets the tenant for the database transaction from
  the session row. The browser never names the tenant.
- Removing a user deletes their session rows, which satisfies the 60-second
  rule immediately.
- Invitation and password-reset links carry a random token whose hash is
  stored, are single-use, and expire as the glossary says. The reset endpoint
  answers the same way whether or not the address exists (US-D10).
- State-changing requests are protected against cross-site request forgery.
- Roles are checked on the server for every route; a test enumerates routes
  and fails on one with no declared role.
- The API owns authentication. The Next.js dashboard is a client of it and
  holds no secrets.

### Consequences

- Good, because the local stack is self-contained.
- Good, because revocation is immediate and simple to test.
- Good, because the tenant comes from the server's own session row, which
  closes one route to cross-tenant access.
- Bad, because this project then owns password storage, reset flows and
  session handling, which are easy to get subtly wrong. They need dedicated
  tests and a place in the threat model (#42).
- Bad, because there is no second factor in v1.0. An owner account protected
  only by a password guards customers' conversations. This is a stated
  limitation, to be listed in the system card.
- Bad, because every request costs a database lookup. At dashboard traffic
  levels this is negligible.
- Bad, because sending invitation and reset emails needs an email service in
  any real deployment; locally, emails are written to a log.

### Confirmation

By the end of M4: tests cover lockout, both session lifetimes, single use and
expiry of links, identical reset responses for known and unknown addresses,
session deletion on user removal, and the route-role enumeration; the threat
model has entries for credential stuffing, session theft, reset-link abuse
and cross-site request forgery; NFR-S8's route inventory test passes.

## Pros and Cons of the Options

### Server-side sessions

- Good, because they are revocable at once and self-contained.
- Bad, because this project owns the code.

### Signed tokens held by the browser

- Good, because no lookup per request.
- Bad, because a token stays valid until it expires, so the 60-second removal
  rule needs a denylist, which is server-side state again.

### Managed identity provider

- Good, because password storage, reset and second factors are someone
  else's well-tested code.
- Bad, because it needs an outside account and network access to run the
  project at all, against NFR-M4, and adds a provider to the data-protection
  picture.
- Neutral, because it is the right choice for a real deployment with paying
  customers; the session design here does not prevent moving to one.

### Emailed link only

- Good, because there is no password to store.
- Bad, because every sign-in depends on email delivery, which is slow or
  unreliable for the persona, and the mailbox becomes the only factor.

## More Information

- Second-factor authentication is the first addition if the project is ever
  used with real data; note it in the system card.
- The hashing library is a choice to be verified in M4.
