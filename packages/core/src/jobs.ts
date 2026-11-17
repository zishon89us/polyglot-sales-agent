// The rules of the job queue that need no database: how often a job is
// retried and how long each wait is (NFR-R5), and the fixed times the
// queue, the conversation lease and the worker's health check use.
//
// NFR-R5 gives the retries and the first wait; ADR 0004 gives the lease.
// The other times are the agent's proposals, recorded in ADR 0004's
// amendment.

export const JOB_STATES = ["queued", "running", "dead"] as const;
export type JobState = (typeof JOB_STATES)[number];

/** A job is retried this many times after its first run (NFR-R5). */
export const JOB_RETRIES = 5;
/** So it runs at most this many times before it is dead. */
export const JOB_MAX_ATTEMPTS = JOB_RETRIES + 1;
/** The wait before the first retry; each later wait is twice the one before (NFR-R5). */
export const JOB_FIRST_RETRY_MS = 2_000;

/**
 * How long a claimed job stays claimed. A worker that dies leaves its job
 * claimed; after this long another worker takes it. It must be longer than
 * any job runs: the longest is a turn, three model attempts of 20 seconds
 * with waits of 1 and 4 seconds (glossary).
 */
export const JOB_CLAIM_MS = 5 * 60_000;

/** How long a conversation lease lasts unless renewed (ADR 0004). */
export const LEASE_MS = 2 * 60_000;

/** How often an idle worker looks for a due job. Well under the 3-second batching window (ADR 0004). */
export const POLL_INTERVAL_MS = 500;

/** How often a worker records that it is alive. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** A worker is ready if it was seen within this long: three missed heartbeats. */
export const WORKER_READY_WITHIN_MS = 3 * HEARTBEAT_INTERVAL_MS;

/** The job type of the alert raised when a job is dead (NFR-R5). */
export const OPERATOR_ALERT_JOB = "operator-alert";

/**
 * The wait before the next run, given how many times the job has run:
 * 2, 4, 8, 16 and 32 seconds. Undefined when it has run as often as it may,
 * which means it is dead.
 */
export function retryDelayMs(attempts: number): number | undefined {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("retryDelayMs: attempts must be a whole number of at least 1");
  }
  return attempts >= JOB_MAX_ATTEMPTS ? undefined : JOB_FIRST_RETRY_MS * 2 ** (attempts - 1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][A-Za-z]*Id$/;

/**
 * A job payload holds identifiers only: the jobs table is outside tenant
 * scoping, so it must never hold message text, a phone number or a name
 * (data model, decision 2). Each key ends in `Id` and each value is a UUID.
 * Returns the problems found; none means the payload is acceptable.
 */
export function payloadProblems(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return ["the payload is not an object"];
  }
  const problems: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!KEY.test(key)) {
      problems.push(`key "${key}" does not name an identifier (it must end in Id)`);
    } else if (typeof value !== "string" || !UUID.test(value)) {
      // The value is not shown: it may be the very thing that must not be stored.
      problems.push(`the value of "${key}" is not a UUID`);
    }
  }
  return problems;
}

/**
 * What to record when a job fails: a short code, never the message, which
 * can carry customer text. The error's own `code` if it looks like one,
 * otherwise the name of its class.
 */
export function errorCode(error: unknown): string {
  const safe = /^[A-Za-z0-9_.-]{1,64}$/;
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && safe.test(code)) {
      return code;
    }
    const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string" && safe.test(name)) {
      return name;
    }
  }
  return "unknown";
}
