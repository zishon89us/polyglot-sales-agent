// The worker's sign of life (Gate 2 finding S18). The worker accepts no
// HTTP, so it writes a row; whatever needs to know whether a worker is
// alive reads it: `cli.ts worker-status`, and later the API's readiness
// answer. Run as the cross-tenant role. The database's clock is used on
// both sides, so a worker with a wrong clock cannot look alive, or make
// others look dead; `now` is for tests.

import { WORKER_READY_WITHIN_MS } from "@polyglot-sales-agent/core";
import type { Queryable } from "./jobs.ts";

const NOW = "coalesce($1::timestamptz, now())";

/** Records that a worker is alive, and forgets workers not seen for a day. */
export async function recordHeartbeat(db: Queryable, workerId: string, now?: Date): Promise<void> {
  await db.query(
    `INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at)
     VALUES ($2, ${NOW}, ${NOW})
     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [now ?? null, workerId],
  );
  await db.query(`DELETE FROM worker_heartbeats WHERE last_seen_at < ${NOW} - interval '1 day'`, [
    now ?? null,
  ]);
}

export interface WorkerReadiness {
  /** At least one worker was seen recently enough. */
  readonly ready: boolean;
  /** When any worker was last seen; undefined if none ever was. */
  readonly lastSeenAt: Date | undefined;
}

/** Whether any worker is alive. It says a worker is running, not that jobs are succeeding. */
export async function workerReadiness(db: Queryable, now?: Date): Promise<WorkerReadiness> {
  const result = await db.query(
    `SELECT max(last_seen_at) AS last,
            coalesce(max(last_seen_at) >= ${NOW} - $2::double precision * interval '1 millisecond', false) AS ready
     FROM worker_heartbeats`,
    [now ?? null, WORKER_READY_WITHIN_MS],
  );
  return { ready: result.rows[0]?.ready === true, lastSeenAt: result.rows[0]?.last ?? undefined };
}
