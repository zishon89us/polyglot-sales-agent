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
 * any job runs: the longest is a turn. As M3 unit U7 built it, a turn is
 * at most five calls to the model of 20 seconds, five traces of 5 seconds
 * and sixteen runs of a tool of 5 seconds: 205 seconds (design note
 * m3-u7-turn, S2b). The three attempts with waits of 1 and 4 seconds that
 * the glossary gives a failed call are a later unit's (U15).
 */
export const JOB_CLAIM_MS = 5 * 60_000;

/** How long one run of a handler may take before it is failed. Less than the claim, so the failure is recorded while the job is still this worker's. */
export const JOB_HANDLER_TIMEOUT_MS = JOB_CLAIM_MS - 60_000;

/** A job type is lower-case letters and hyphens, so it cannot carry a number. */
export const JOB_TYPE = /^[a-z][a-z-]{0,39}$/;

/** A handler may put its job back for at most this long at a time. */
export const JOB_MAX_DEFER_MS = 60 * 60_000;

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
const KEY = /^[a-z][A-Za-z]{0,37}Id$/;
const MAX_KEYS = 20;

/**
 * A job payload holds identifiers only: the jobs table is outside tenant
 * scoping, so it must never hold message text, a phone number or a name
 * (data model, decision 2). At most 20 keys, each of at most 40 letters
 * ending in `Id`, each value a UUID. The table applies the same rule.
 * Returns the problems found; none means the payload is acceptable.
 */
export function payloadProblems(payload: unknown): string[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Object.getPrototypeOf(payload) !== Object.prototype
  ) {
    return ["the payload is not a plain object"];
  }
  const problems: string[] = [];
  if (Object.keys(payload).length > MAX_KEYS) {
    problems.push(`the payload has more than ${MAX_KEYS} keys`);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!KEY.test(key)) {
      // The key is not shown either: data can be put in a key.
      problems.push("a key does not name an identifier (it must be letters ending in Id)");
    } else if (typeof value !== "string" || !UUID.test(value)) {
      // The value is not shown: it may be the very thing that must not be stored.
      problems.push(`the value of "${key}" is not a UUID`);
    }
  }
  return problems;
}

/**
 * What to record when a job fails: a short code, never the message, which
 * can carry customer text. The error's own `code` if it is a plain name or
 * a five-character SQLSTATE, otherwise the name of its class if that is
 * letters only, otherwise "unknown". Digits are allowed only in a SQLSTATE,
 * so that a number cannot ride along. Never throws.
 */
export function errorCode(error: unknown): string {
  try {
    if (typeof error === "object" && error !== null) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && /^([A-Za-z][A-Za-z_-]{0,39}|[0-9A-Z]{5})$/.test(code)) {
        return code;
      }
      const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
      if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) {
        return name;
      }
    }
  } catch {
    // A getter or a proxy that throws: fall through.
  }
  return "unknown";
}
