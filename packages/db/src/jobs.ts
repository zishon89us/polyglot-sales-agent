// The job queue (ADR 0004): jobs are rows, claimed with row locks that skip
// what another worker holds. Every function takes the time as an argument,
// so tests and callers decide what "now" is; nothing here reads a clock.

import {
  errorCode,
  JOB_CLAIM_MS,
  JOB_MAX_ATTEMPTS,
  OPERATOR_ALERT_JOB,
  payloadProblems,
  retryDelayMs,
} from "@polyglot-sales-agent/core";

/** Anything that runs a query: a `Tx` from `withTenant`, a client or a pool. */
export interface Queryable {
  // biome-ignore lint/suspicious/noExplicitAny: rows are narrowed where they are read
  query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface NewJob {
  readonly type: string;
  /** Null for work that belongs to no tenant. The application role can only queue for its own tenant. */
  readonly tenantId: string | null;
  /** Identifiers only. */
  readonly payload?: Readonly<Record<string, string>>;
  readonly runAt: Date;
}

export interface Job {
  readonly id: string;
  readonly type: string;
  readonly tenantId: string | null;
  readonly payload: Readonly<Record<string, string>>;
  /** How many times it has been claimed, this time included. */
  readonly attempts: number;
}

/**
 * Queues a job. Call it in the transaction that makes the job necessary, so
 * that both happen or neither (ADR 0004). A payload that holds anything but
 * identifiers is refused.
 */
export async function enqueueJob(db: Queryable, job: NewJob): Promise<void> {
  const problems = payloadProblems(job.payload ?? {});
  if (problems.length > 0) {
    throw new Error(`enqueueJob: ${problems.join("; ")}`);
  }
  await db.query("INSERT INTO jobs (type, tenant_id, payload, run_at) VALUES ($1, $2, $3, $4)", [
    job.type,
    job.tenantId,
    JSON.stringify(job.payload ?? {}),
    job.runAt,
  ]);
}

// A job whose worker died is still `running` when its claim runs out. If it
// has run as often as it may, it is dead and an alert is queued; otherwise
// it can be claimed again. A dead alert raises no alert of its own.
const CLAIM = `
  WITH lost AS (
    UPDATE jobs SET state = 'dead', locked_until = NULL, last_error = 'worker-lost'
    WHERE state = 'running' AND locked_until <= $1 AND attempts >= $2
    RETURNING id, type
  ), alerts AS (
    INSERT INTO jobs (type, payload, run_at)
    SELECT $4, jsonb_build_object('jobId', id), $1 FROM lost WHERE type <> $4
  ), next AS (
    SELECT id FROM jobs
    WHERE (state = 'queued' AND run_at <= $1)
       OR (state = 'running' AND locked_until <= $1 AND attempts < $2)
    ORDER BY run_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE jobs SET state = 'running', locked_until = $3, attempts = attempts + 1
  FROM next WHERE jobs.id = next.id
  RETURNING jobs.id, jobs.type, jobs.tenant_id, jobs.payload, jobs.attempts`;

/**
 * Claims the due job that has waited longest, or returns undefined when
 * none is due. Two workers never get the same job. Run as the cross-tenant
 * role.
 */
export async function claimJob(db: Queryable, now: Date): Promise<Job | undefined> {
  const result = await db.query(CLAIM, [
    now,
    JOB_MAX_ATTEMPTS,
    new Date(now.getTime() + JOB_CLAIM_MS),
    OPERATOR_ALERT_JOB,
  ]);
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : {
        id: row.id,
        type: row.type,
        tenantId: row.tenant_id,
        payload: row.payload,
        attempts: row.attempts,
      };
}

/**
 * Removes a finished job. Returns false, and removes nothing, if the job is
 * no longer this worker's: its claim ran out and another worker took it.
 */
export async function completeJob(db: Queryable, job: Job): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM jobs WHERE id = $1 AND state = 'running' AND attempts = $2",
    [job.id, job.attempts],
  );
  return result.rowCount === 1;
}

/**
 * Records a failed run. The job is queued again after the wait of NFR-R5,
 * or, after its last run, becomes dead and an operator alert is queued in
 * the same statement. Only a short code of the error is stored. Returns
 * what happened, or "not-held" if the job is no longer this worker's.
 */
export async function failJob(
  db: Queryable,
  job: Job,
  error: unknown,
  now: Date,
): Promise<"retry" | "dead" | "not-held"> {
  const wait = retryDelayMs(job.attempts);
  const result = await db.query(
    `WITH failed AS (
       UPDATE jobs SET state = $3, locked_until = NULL, last_error = $4, run_at = coalesce($5, run_at)
       WHERE id = $1 AND state = 'running' AND attempts = $2
       RETURNING id, type, state
     ), alerts AS (
       INSERT INTO jobs (type, payload, run_at)
       SELECT $6, jsonb_build_object('jobId', id), $7 FROM failed
       WHERE state = 'dead' AND type <> $6
     )
     SELECT state FROM failed`,
    [
      job.id,
      job.attempts,
      wait === undefined ? "dead" : "queued",
      errorCode(error),
      wait === undefined ? null : new Date(now.getTime() + wait),
      OPERATOR_ALERT_JOB,
      now,
    ],
  );
  const state = result.rows[0]?.state;
  return state === undefined ? "not-held" : state === "dead" ? "dead" : "retry";
}

/** What a worker does with a job of one type. Throwing means the run failed. */
export type JobHandler = (job: Job) => Promise<void>;

export type RunOutcome =
  | { readonly ran: false }
  | {
      readonly ran: true;
      readonly job: Job;
      readonly result: "done" | "retry" | "dead" | "not-held";
    };

/**
 * Claims one due job, runs its handler and records the result. `clock` is
 * read again after the handler, because the handler takes time. A job of a
 * type with no handler is failed like any other, so it ends dead with an
 * alert and is not lost.
 */
export async function runNextJob(
  db: Queryable,
  handlers: Readonly<Record<string, JobHandler>>,
  clock: () => Date,
): Promise<RunOutcome> {
  const job = await claimJob(db, clock());
  if (job === undefined) {
    return { ran: false };
  }
  try {
    const handler = handlers[job.type];
    if (handler === undefined) {
      throw Object.assign(new Error("no handler"), { code: "no-handler" });
    }
    await handler(job);
  } catch (error) {
    return { ran: true, job, result: await failJob(db, job, error, clock()) };
  }
  return { ran: true, job, result: (await completeJob(db, job)) ? "done" : "not-held" };
}
