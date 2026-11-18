// The queue and the heartbeat for a process that holds a handle, not a
// connection (ADR 0003, amendment of 2026-11-18). The handle is the
// cross-tenant role's.

import { type Database, poolOf } from "./connect.ts";
import { recordHeartbeat } from "./heartbeat.ts";
import { type JobHandler, type RunOptions, type RunOutcome, runNextJob } from "./jobs.ts";

/** Claims one due job, runs its handler and records the result. See `runNextJob`. */
export function workOnce(
  cross: Database,
  handlers: Readonly<Record<string, JobHandler>>,
  options: RunOptions = {},
): Promise<RunOutcome> {
  return runNextJob(poolOf(cross), handlers, options);
}

/** Records that this worker is alive. */
export function beat(cross: Database, workerId: string): Promise<void> {
  return recordHeartbeat(poolOf(cross), workerId);
}
