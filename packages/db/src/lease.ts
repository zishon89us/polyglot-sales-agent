// The per-conversation lease (ADR 0004; architecture, "Processing one
// turn"). A worker takes it before processing a conversation, so two
// workers never process one conversation at once. The work itself happens
// outside any transaction; when its result is stored, the same transaction
// first checks that the lease is still the worker's.
//
// Each function runs inside `withTenant`, as the application role. As in
// the job queue, the database's clock decides when a lease has run out,
// read at each statement; `now` is for tests.

import { LEASE_MS } from "@polyglot-sales-agent/core";
import type { Tx } from "./tenant.ts";

const NOW = "coalesce($2::timestamptz, clock_timestamp())";
const LEASE = "$3::double precision * interval '1 millisecond'";

/**
 * Takes the lease if nobody holds an unexpired one. Returns the token to
 * present later, or undefined if another worker holds the conversation, in
 * which case the job is put back for later (`deferJob`). Throws if the
 * tenant has no such conversation, which is a fault, not a busy signal.
 */
export async function takeLease(
  tx: Tx,
  conversationId: string,
  now?: Date,
): Promise<string | undefined> {
  const result = await tx.query<{ lease_token: string }>(
    `UPDATE conversations SET lease_token = gen_random_uuid(), lease_expires_at = ${NOW} + ${LEASE}
     WHERE id = $1 AND (lease_token IS NULL OR lease_expires_at <= ${NOW})
     RETURNING lease_token`,
    [conversationId, now ?? null, LEASE_MS],
  );
  const token = result.rows[0]?.lease_token;
  if (token === undefined) {
    const exists = await tx.query("SELECT 1 FROM conversations WHERE id = $1", [conversationId]);
    if (exists.rowCount === 0) {
      throw Object.assign(new Error("takeLease: no such conversation in this tenant"), {
        code: "conversation-not-found",
      });
    }
  }
  return token;
}

/**
 * Extends the lease, before each model attempt. Returns false if the lease
 * is no longer this worker's; the worker must then stop.
 */
export async function renewLease(
  tx: Tx,
  conversationId: string,
  token: string,
  now?: Date,
): Promise<boolean> {
  const result = await tx.query(
    `UPDATE conversations SET lease_expires_at = ${NOW} + ${LEASE}
     WHERE id = $1 AND lease_token = $4`,
    [conversationId, now ?? null, LEASE_MS, token],
  );
  return result.rowCount === 1;
}

/**
 * True if the lease is still this worker's. Call it first in the
 * transaction that stores a result or runs a tool, and store nothing if it
 * is false. It locks the conversation row against another worker taking the
 * lease until that transaction ends. Since M3 unit U2 it is also the lock
 * that storing a customer's message takes (`sessions.ts`, `lockConversation`),
 * so a message being stored and a turn that is ending wait for each other:
 * neither can miss the other.
 *
 * Call it first: a transaction that writes and only then calls this makes
 * others wait behind it for longer than they need to.
 *
 * An expired lease that nobody else has taken still counts: the token is
 * what says whose the conversation is.
 */
export async function holdsLease(tx: Tx, conversationId: string, token: string): Promise<boolean> {
  const result = await tx.query(
    "SELECT 1 FROM conversations WHERE id = $1 AND lease_token = $2 FOR NO KEY UPDATE",
    [conversationId, token],
  );
  return result.rowCount === 1;
}

/** Gives the lease back. Does nothing if it is no longer this worker's. */
export async function releaseLease(tx: Tx, conversationId: string, token: string): Promise<void> {
  await tx.query(
    `UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL
     WHERE id = $1 AND lease_token = $2`,
    [conversationId, token],
  );
}
