// The worker's sign of life (Gate 2 finding S18). The worker accepts no
// HTTP, so it writes a row; whatever needs to know whether a worker is
// alive reads it: `cli.ts worker-status`, and later the API's readiness
// answer. Run as the cross-tenant role.

import { WORKER_READY_WITHIN_MS } from "@polyglot-sales-agent/core";
import type { Queryable } from "./jobs.ts";

const DAY_MS = 24 * 60 * 60_000;

/** Records that a worker is alive, and forgets workers not seen for a day. */
export async function recordHeartbeat(db: Queryable, workerId: string, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at) VALUES ($1, $2, $2)
     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = $2`,
    [workerId, now],
  );
  await db.query("DELETE FROM worker_heartbeats WHERE last_seen_at < $1", [
    new Date(now.getTime() - DAY_MS),
  ]);
}

export interface WorkerReadiness {
  /** At least one worker was seen recently enough. */
  readonly ready: boolean;
  /** When any worker was last seen; undefined if none ever was. */
  readonly lastSeenAt: Date | undefined;
}

/** Whether any worker is alive. It says a worker is running, not that jobs are succeeding. */
export async function workerReadiness(db: Queryable, now: Date): Promise<WorkerReadiness> {
  const result = await db.query("SELECT max(last_seen_at) AS last FROM worker_heartbeats");
  const last: Date | null = result.rows[0]?.last ?? null;
  return {
    ready: last !== null && now.getTime() - last.getTime() <= WORKER_READY_WITHIN_MS,
    lastSeenAt: last ?? undefined,
  };
}
