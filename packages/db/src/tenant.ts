// The only way application code reaches tenant-owned tables: a transaction
// with the tenant set for that transaction alone (ADR 0003).

import type pg from "pg";

/**
 * What the work inside `withTenant` is given: a way to run queries. Nothing
 * stops SQL text from ending the transaction or setting another tenant, so
 * the text must never come from outside the code (threat model, T33).
 */
export interface Tx {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction that sees only `tenantId`'s rows, then
 * commits. If `work` throws, the transaction is rolled back and the error is
 * rethrown. The tenant setting ends with the transaction, so the pooled
 * connection carries nothing to its next user.
 *
 * The pool must connect as the application role. This sets which tenant the
 * policies admit; it is not a check that the caller may act for that tenant.
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
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tx: Tx = {
      async query(text, values) {
        const result = await client.query(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    };
    const value = await work(tx);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection's state is unknown: do not return it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
