// The one shape of a log line (NFR-O2; M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md, section 5). The api and the worker
// write lines through this and nothing else.
//
// There is no key for a sentence. A line cannot carry a message's text, an
// error's message or a phone number, because nothing in its shape holds
// one: a value that does not fit its pattern is written as `invalid`.

export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SERVICES = ["api", "worker"] as const;
export type LogService = (typeof LOG_SERVICES)[number];

/** Everything a line can say happened. */
export const LOG_EVENTS = [
  "listening",
  "running",
  "stopped",
  "could-not-start",
  "request",
  "job",
  "loop-error",
  "webhook-unavailable",
  "turn-skipped",
  "send-failed",
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

/** The numbers a line can carry. Each is worked out by the code, never read from what arrived. */
export const LOG_NUMBERS = ["status", "durationMs", "attempts", "port"] as const;
export type LogNumber = (typeof LOG_NUMBERS)[number];

export const LOG_NUMBER_MAX = 1_000_000_000;
export const LOG_NAMES_MAX = 20;
export const LOG_INVALID = "invalid";

export interface LogFields {
  readonly level: LogLevel;
  readonly service: LogService;
  readonly event: LogEvent;
  /** A failure's code as `errorCode` gives it, or a job's outcome. */
  readonly code?: string | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly tenantId?: string | null | undefined;
  readonly conversationId?: string | null | undefined;
  readonly jobId?: string | null | undefined;
  /** Settings a failure to start named, or a job's type. */
  readonly names?: readonly string[] | undefined;
  readonly n?: Readonly<Partial<Record<LogNumber, number>>> | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * As `errorCode` makes one: a plain name, or the five characters of a
 * database's error class. Or the channel's own number for a refused send,
 * as the WhatsApp channel writes it: six digits at most, which no phone
 * number is.
 */
const CODE = /^([A-Za-z][A-Za-z_-]{0,39}|[0-9A-Z]{5}|meta-[0-9]{1,6})$/;
/** A setting's name, or a job's type. Neither can hold a digit. */
const NAME = /^(PSA_[A-Z_]{1,60}|[a-z][a-z-]{0,39})$/;

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | typeof LOG_INVALID =>
  (list as readonly unknown[]).includes(value) ? (value as T) : LOG_INVALID;

const fitting = (pattern: RegExp, value: unknown): string | null =>
  value === undefined || value === null
    ? null
    : typeof value === "string" && pattern.test(value)
      ? value
      : LOG_INVALID;

/** The settings a failure's message names, for a `could-not-start` line. */
export function settingsNamed(message: unknown): string[] {
  if (typeof message !== "string") {
    return [];
  }
  const found = message.match(/\bPSA_[A-Z_]{1,60}\b/g) ?? [];
  return [...new Set(found)].slice(0, LOG_NAMES_MAX);
}

/**
 * One line: a JSON object with the same keys every time, null where there
 * is none. Never throws: a line that cannot be written must not take down
 * what it was written about.
 */
export function logLine(fields: LogFields, now: Date = new Date()): string {
  let time: string;
  try {
    time = now.toISOString();
  } catch {
    time = LOG_INVALID;
  }
  const names: string[] = [];
  const numbers: Partial<Record<LogNumber, number>> = {};
  let level: string = LOG_INVALID;
  let service: string = LOG_INVALID;
  let event: string = LOG_INVALID;
  let code: string | null = LOG_INVALID;
  const ids: (string | null)[] = [LOG_INVALID, LOG_INVALID, LOG_INVALID, LOG_INVALID];
  try {
    level = oneOf(LOG_LEVELS, fields.level);
    service = oneOf(LOG_SERVICES, fields.service);
    event = oneOf(LOG_EVENTS, fields.event);
    code = fitting(CODE, fields.code);
    ids[0] = fitting(UUID, fields.requestId);
    ids[1] = fitting(UUID, fields.tenantId);
    ids[2] = fitting(UUID, fields.conversationId);
    ids[3] = fitting(UUID, fields.jobId);
    if (Array.isArray(fields.names)) {
      for (const name of fields.names.slice(0, LOG_NAMES_MAX)) {
        names.push(typeof name === "string" && NAME.test(name) ? name : LOG_INVALID);
      }
    }
    if (typeof fields.n === "object" && fields.n !== null) {
      for (const key of LOG_NUMBERS) {
        const value = fields.n[key];
        if (
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= LOG_NUMBER_MAX
        ) {
          numbers[key] = value;
        }
      }
    }
  } catch {
    // What was read before the fault is kept; the rest stays `invalid`.
  }
  return JSON.stringify({
    time,
    level,
    service,
    event,
    code,
    requestId: ids[0],
    tenantId: ids[1],
    conversationId: ids[2],
    jobId: ids[3],
    names,
    n: numbers,
  });
}

/** What a service gives of a line; the service itself is added for it. */
export type LogEntry = Omit<LogFields, "service">;
/** Writes a service's lines. */
export type Log = (entry: LogEntry) => void;

/**
 * A service's log, written by `write`. A line that cannot be written is
 * dropped; it must not take down what it was written about.
 */
export function logTo(service: LogService, write: (line: string, level: LogLevel) => void): Log {
  return (entry) => {
    try {
      write(logLine({ ...entry, service }), entry?.level);
    } catch {
      // Dropped.
    }
  };
}
