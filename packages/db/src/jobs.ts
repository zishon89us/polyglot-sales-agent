// The job queue (ADR 0004): jobs are rows, claimed with row locks that skip
// what another worker holds.
//
// Time: the database's clock is the only clock. Workers on different
// machines must agree on when a claim or a lease has run out, and they
// cannot if each compares against its own clock. Every function takes an
// optional `now`; leave it out in running code. Tests pass it, to step time
// without sleeping.
//
// A job is run at least once, not exactly once: a worker that is slow, not
// dead, may still be running a job when another worker takes it. What a job
// changes must therefore be safe to do twice.

import {
  errorCode,
  JOB_CLAIM_MS,
  JOB_HANDLER_TIMEOUT_MS,
  JOB_MAX_ATTEMPTS,
  JOB_TYPE,
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
  /** What the job is about, if it may have to be found again and cancelled. */
  readonly subjectId?: string;
  /** Identifiers only. */
  readonly payload?: Readonly<Record<string, string>>;
  /** When it is due. Left out: now, by the database's clock. */
  readonly runAt?: Date;
  /** Or: this long from now, by the database's clock. */
  readonly runInMs?: number;
}

export interface Job {
  readonly id: string;
  readonly type: string;
  readonly tenantId: string | null;
  readonly subjectId: string | null;
  readonly payload: Readonly<Record<string, string>>;
  /** How many times it has been claimed, this time included. */
  readonly attempts: number;
}

// `$n::timestamptz` is the caller's time in tests and null in running code.
const NOW = (n: number): string => `coalesce($${n}::timestamptz, now())`;
const MS = (n: number): string => `$${n}::double precision * interval '1 millisecond'`;

/**
 * Queues a job. Call it in the transaction that makes the job necessary, so
 * that both happen or neither (ADR 0004). A type that is not a plain name,
 * or a payload that holds anything but identifiers, is refused; the
 * database refuses the same, for a caller that does not come through here.
 */
export async function enqueueJob(db: Queryable, job: NewJob): Promise<void> {
  // One plain copy is checked and stored, so what is checked is what is stored.
  const payload: unknown = JSON.parse(JSON.stringify(job.payload ?? {}));
  const problems = payloadProblems(payload);
  if (!JOB_TYPE.test(job.type)) {
    problems.unshift("the type is not a plain lower-case name");
  }
  if (problems.length > 0) {
    throw new Error(`enqueueJob: ${problems.join("; ")}`);
  }
  await db.query(
    `INSERT INTO jobs (type, tenant_id, subject_id, payload, run_at)
     VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()) + ${MS(6)})`,
    [
      job.type,
      job.tenantId,
      job.subjectId ?? null,
      JSON.stringify(payload),
      job.runAt ?? null,
      job.runInMs ?? 0,
    ],
  );
}

/**
 * Cancels the queued jobs of one type about one subject, for a timer whose
 * state has moved on. A job that is already running is not stopped; a timer
 * job re-reads the state when it runs (architecture, "Timers"). Returns how
 * many were cancelled.
 */
export async function cancelJobs(
  db: Queryable,
  job: { readonly type: string; readonly tenantId: string; readonly subjectId: string },
): Promise<number> {
  const result = await db.query(
    `DELETE FROM jobs
     WHERE tenant_id = $1 AND type = $2 AND subject_id = $3 AND state = 'queued'`,
    [job.tenantId, job.type, job.subjectId],
  );
  return result.rowCount ?? 0;
}

/**
 * Replaces a timer: cancels the queued jobs of this type about this subject
 * and queues the new one. In one transaction with the change that moves the
 * timer. Two replacements at the same moment can leave two jobs, which is
 * harmless for a timer, since it re-reads the state when it runs.
 */
export async function replaceJob(
  db: Queryable,
  job: NewJob & { readonly tenantId: string; readonly subjectId: string },
): Promise<void> {
  await cancelJobs(db, job);
  await enqueueJob(db, job);
}

// A job whose worker died is still `running` when its claim runs out. If it
// has run as often as it may, it is dead and an alert is queued; otherwise
// it can be claimed again. A dead alert raises no alert of its own.
const CLAIM = `
  WITH lost AS (
    UPDATE jobs SET state = 'dead', locked_until = NULL, last_error = 'worker-lost'
    WHERE state = 'running' AND locked_until <= ${NOW(1)} AND attempts >= $2
    RETURNING id, type
  ), alerts AS (
    INSERT INTO jobs (type, payload, run_at)
    SELECT $4, jsonb_build_object('jobId', id), ${NOW(1)} FROM lost WHERE type <> $4
  ), next AS (
    SELECT id FROM jobs
    WHERE (state = 'queued' AND run_at <= ${NOW(1)})
       OR (state = 'running' AND locked_until <= ${NOW(1)} AND attempts < $2)
    ORDER BY run_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE jobs SET state = 'running', locked_until = ${NOW(1)} + ${MS(3)}, attempts = attempts + 1
  FROM next WHERE jobs.id = next.id
  RETURNING jobs.id, jobs.type, jobs.tenant_id, jobs.subject_id, jobs.payload, jobs.attempts`;

/**
 * Claims the due job that has waited longest, or returns undefined when
 * none is due. Two workers never get the same job at the same time. Run as
 * the cross-tenant role.
 */
export async function claimJob(db: Queryable, now?: Date): Promise<Job | undefined> {
  const result = await db.query(CLAIM, [
    now ?? null,
    JOB_MAX_ATTEMPTS,
    JOB_CLAIM_MS,
    OPERATOR_ALERT_JOB,
  ]);
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : {
        id: row.id,
        type: row.type,
        tenantId: row.tenant_id,
        subjectId: row.subject_id,
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
 * Puts a claimed job back without counting the run, to be tried again after
 * a wait: for a job that found its conversation held by another worker
 * (ADR 0004: "leaves the job for later"). Returns false if the job is no
 * longer this worker's.
 */
export async function deferJob(
  db: Queryable,
  job: Job,
  waitMs: number,
  now?: Date,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE jobs SET state = 'queued', locked_until = NULL, attempts = attempts - 1,
            run_at = ${NOW(3)} + ${MS(4)}
     WHERE id = $1 AND state = 'running' AND attempts = $2`,
    [job.id, job.attempts, now ?? null, waitMs],
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
  now?: Date,
): Promise<"retry" | "dead" | "not-held"> {
  const wait = retryDelayMs(job.attempts);
  const result = await db.query(
    `WITH failed AS (
       UPDATE jobs SET state = $3, locked_until = NULL, last_error = $4,
              run_at = CASE WHEN $3 = 'dead' THEN run_at ELSE ${NOW(5)} + ${MS(6)} END
       WHERE id = $1 AND state = 'running' AND attempts = $2
       RETURNING id, type, state
     ), alerts AS (
       INSERT INTO jobs (type, payload, run_at)
       SELECT $7, jsonb_build_object('jobId', id), ${NOW(5)} FROM failed
       WHERE state = 'dead' AND type <> $7
     )
     SELECT state FROM failed`,
    [
      job.id,
      job.attempts,
      wait === undefined ? "dead" : "queued",
      errorCode(error),
      now ?? null,
      wait ?? 0,
      OPERATOR_ALERT_JOB,
    ],
  );
  const state = result.rows[0]?.state;
  return state === undefined ? "not-held" : state === "dead" ? "dead" : "retry";
}

/**
 * What a worker does with a job of one type. Throwing means the run failed.
 * Returning `{ deferMs }` puts the job back without counting the run. The
 * signal aborts when the run has taken too long; a handler should pass it
 * to whatever it waits on.
 */
export type JobHandler = (
  job: Job,
  signal: AbortSignal,
  // biome-ignore lint/suspicious/noConfusingVoidType: a handler that returns nothing is the usual case
) => Promise<void | { deferMs: number }>;

export type RunOutcome =
  | { readonly ran: false }
  | {
      readonly ran: true;
      readonly job: Job;
      readonly result: "done" | "deferred" | "retry" | "dead" | "not-held";
    };

export interface RunOptions {
  /** For tests: the time to use in place of the database's clock. Read again after the handler. */
  readonly clock?: () => Date;
  /** How long a handler may run. Default: a minute less than the claim. */
  readonly timeoutMs?: number;
}

/**
 * Claims one due job, runs its handler and records the result. A job of a
 * type with no handler is failed like any other, so it ends dead with an
 * alert and is not lost. A handler that takes too long is failed with the
 * code `handler-timeout`; it may still be running, which is one more reason
 * a job must be safe to run twice.
 */
export async function runNextJob(
  db: Queryable,
  handlers: Readonly<Record<string, JobHandler>>,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const job = await claimJob(db, options.clock?.());
  if (job === undefined) {
    return { ran: false };
  }
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // biome-ignore lint/suspicious/noConfusingVoidType: as JobHandler
  let wish: void | { deferMs: number };
  try {
    // Not `handlers[type]`: that would find `toString` on an empty object.
    const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
    if (handler === undefined) {
      throw Object.assign(new Error("no handler"), { code: "no-handler" });
    }
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(Object.assign(new Error("timeout"), { code: "handler-timeout" }));
      }, options.timeoutMs ?? JOB_HANDLER_TIMEOUT_MS);
    });
    wish = await Promise.race([handler(job, abort.signal), late]);
  } catch (error) {
    return { ran: true, job, result: await failJob(db, job, error, options.clock?.()) };
  } finally {
    clearTimeout(timer);
  }
  if (typeof wish === "object") {
    const deferred = await deferJob(db, job, wish.deferMs, options.clock?.());
    return { ran: true, job, result: deferred ? "deferred" : "not-held" };
  }
  return { ran: true, job, result: (await completeJob(db, job)) ? "done" : "not-held" };
}

/** How many jobs are dead, and how many of those are alerts nobody received. */
export async function deadJobs(db: Queryable): Promise<{ dead: number; deadAlerts: number }> {
  const result = await db.query(
    `SELECT count(*)::int AS dead, count(*) FILTER (WHERE type = $1)::int AS alerts
     FROM jobs WHERE state = 'dead'`,
    [OPERATOR_ALERT_JOB],
  );
  return { dead: result.rows[0]?.dead ?? 0, deadAlerts: result.rows[0]?.alerts ?? 0 };
}
