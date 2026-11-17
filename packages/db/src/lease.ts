// The per-conversation lease (ADR 0004; architecture, "Processing one
// turn"). A worker takes it before processing a conversation, so two
// workers never process one conversation at once. The work itself happens
// outside any transaction; when its result is stored, the same transaction
// first checks that the lease is still the worker's.
//
// Each function runs inside `withTenant`, as the application role.

import { LEASE_MS } from "@polyglot-sales-agent/core";
import type { Tx } from "./tenant.ts";

/**
 * Takes the lease if nobody holds an unexpired one. Returns the token to
 * present later, or undefined if another worker holds the conversation, in
 * which case the job is left for later.
 */
export async function takeLease(
  tx: Tx,
  conversationId: string,
  now: Date,
): Promise<string | undefined> {
  const result = await tx.query<{ lease_token: string }>(
    `UPDATE conversations SET lease_token = gen_random_uuid(), lease_expires_at = $3
     WHERE id = $1 AND (lease_token IS NULL OR lease_expires_at <= $2)
     RETURNING lease_token`,
    [conversationId, now, new Date(now.getTime() + LEASE_MS)],
  );
  return result.rows[0]?.lease_token;
}

/**
 * Extends the lease, before each model attempt. Returns false if the lease
 * is no longer this worker's; the worker must then stop.
 */
export async function renewLease(
  tx: Tx,
  conversationId: string,
  token: string,
  now: Date,
): Promise<boolean> {
  const result = await tx.query(
    "UPDATE conversations SET lease_expires_at = $3 WHERE id = $1 AND lease_token = $2",
    [conversationId, token, new Date(now.getTime() + LEASE_MS)],
  );
  return result.rowCount === 1;
}

/**
 * True if the lease is still this worker's. Call it first in the
 * transaction that stores a result or runs a tool, and store nothing if it
 * is false. It locks the conversation row until that transaction ends, so
 * another worker cannot take the lease in between.
 *
 * An expired lease that nobody else has taken still counts: the token is
 * what says whose the conversation is.
 */
export async function holdsLease(tx: Tx, conversationId: string, token: string): Promise<boolean> {
  const result = await tx.query(
    "SELECT 1 FROM conversations WHERE id = $1 AND lease_token = $2 FOR UPDATE",
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
