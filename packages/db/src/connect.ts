// How anything outside this package reaches the database: through a handle
// that can be passed to this package's functions and cannot run a query.
// The driver is imported nowhere else (ADR 0003, amendment of 2026-11-18),
// so SQL can only be written here.

import pg from "pg";
import type { APP_ROLE, CROSS_ROLE } from "./roles.ts";

/** A connection pool for one of the two working roles. It has nothing to call. */
export interface Database {
  readonly role: typeof APP_ROLE | typeof CROSS_ROLE;
}

const pools = new WeakMap<Database, pg.Pool>();

/**
 * Times after which the database gives up, so that one stuck statement or
 * one unreachable server cannot hold a request for ever. All are the
 * agent's proposals; each is under the webhook's 5-second deadline.
 */
export const DATABASE_TIMEOUTS = {
  /** To get a connection, new or from the pool. */
  connectMs: 2_000,
  /** For one statement to finish. */
  statementMs: 4_000,
  /** For one statement to wait on another transaction's lock. */
  lockMs: 3_000,
  /** For a transaction to sit open doing nothing. */
  idleInTransactionMs: 10_000,
} as const;

/** Opens a pool for a role. Nothing is connected until the first use. */
export function openDatabase(
  role: Database["role"],
  connectionString: string,
  options: { max?: number } = {},
): Database {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: DATABASE_TIMEOUTS.connectMs,
    statement_timeout: DATABASE_TIMEOUTS.statementMs,
    lock_timeout: DATABASE_TIMEOUTS.lockMs,
    idle_in_transaction_session_timeout: DATABASE_TIMEOUTS.idleInTransactionMs,
  });
  // A connection lost while idle is replaced on next use; it must not end the process.
  pool.on("error", () => undefined);
  return adopt(role, pool);
}

/** Wraps a pool that already exists. For this package and its tests. */
export function adopt(role: Database["role"], pool: pg.Pool): Database {
  const database: Database = Object.freeze({ role });
  pools.set(database, pool);
  return database;
}

/** The pool behind a handle. For this package only: it is not exported from the package. */
export function poolOf(database: Database): pg.Pool {
  const pool = pools.get(database);
  if (pool === undefined) {
    throw new Error("db: this is not a database handle made by openDatabase");
  }
  return pool;
}

export async function closeDatabase(database: Database): Promise<void> {
  await poolOf(database).end();
}

/**
 * True if the database answers within the connection time and the
 * connection is the role the handle says. A pool given the wrong role's
 * address answers, and would then fail every request.
 */
export async function databaseReady(database: Database): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_TIMEOUTS.connectMs + 500);
  });
  const asked = poolOf(database)
    .query<{ name: string }>("SELECT current_user AS name")
    .then(
      (result) => result.rows[0]?.name === database.role,
      () => false,
    );
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}
