// The only way application code reaches tenant-owned tables: a transaction
// with the tenant set for that transaction alone (ADR 0003).

import type pg from "pg";
import { APP_ROLE } from "./roles.ts";

/**
 * What the work inside `withTenant` is given: a way to run queries, usable
 * only until that work settles. Nothing stops SQL text from ending the
 * transaction or setting another tenant, so the text must never come from
 * outside the code (threat model, T33).
 */
export interface Tx {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Connections already seen to be the application role's.
const checked = new WeakSet<pg.PoolClient>();

/**
 * Runs `work` in one transaction that sees only `tenantId`'s rows, then
 * commits. If `work` throws, or the transaction cannot be committed, it is
 * rolled back and the call rejects. The tenant setting ends with the
 * transaction, so the pooled connection carries nothing to its next user.
 *
 * The pool must connect as the application role; any other role is refused,
 * because the policies would not apply to it in the same way. This sets
 * which tenant the policies admit. It is not a check that the caller may act
 * for that tenant.
 *
 * Do not call `withTenant` inside `work` on a pool with no free connection:
 * the inner call waits for one for ever.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) {
    throw new Error("withTenant: the tenant identifier is not a UUID");
  }
  const client = await pool.connect();
  let broken: Error | undefined;
  let open = true;
  try {
    if (!checked.has(client)) {
      const who = await client.query<{ name: string }>("SELECT current_user AS name");
      if (who.rows[0]?.name !== APP_ROLE) {
        throw new Error(`withTenant: the pool must connect as ${APP_ROLE}`);
      }
      checked.add(client);
    }
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tx: Tx = {
      async query(text, values) {
        // A handle kept after its transaction would run in whichever
        // tenant's transaction the connection serves next.
        if (!open) {
          throw new Error("withTenant: this transaction has ended");
        }
        const result = await client.query(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    };
    const value = await work(tx);
    open = false;
    // If a statement failed and `work` swallowed the error, the server
    // answers COMMIT with ROLLBACK and no error. That is not a commit.
    const end = await client.query("COMMIT");
    if (end.command !== "COMMIT") {
      throw new Error("withTenant: the transaction was rolled back, not committed");
    }
    return value;
  } catch (error) {
    open = false;
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection's state is unknown: do not return it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    if (broken === undefined) {
      try {
        // In case SQL inside `work` set the tenant for the whole session.
        await client.query("RESET app.tenant_id");
      } catch (resetError) {
        broken = resetError instanceof Error ? resetError : new Error(String(resetError));
      }
    }
    client.release(broken);
  }
}
