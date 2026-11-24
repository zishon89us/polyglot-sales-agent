// The worker's loop: record a heartbeat, run due jobs one after another,
// and sleep when there is none (ADR 0004, amendment).

import { randomUUID } from "node:crypto";
import { errorCode, HEARTBEAT_INTERVAL_MS, POLL_INTERVAL_MS } from "@polyglot-sales-agent/core";
import { beat, type Database, type JobHandler, workOnce } from "@polyglot-sales-agent/db";

/** One line for the log: what happened, and a short code. Never anything of a message. */
export type WorkerReport = (event: "loop-error", code: string) => void;

/** What a log line names a job by when this worker has no handler for its type. */
export const UNKNOWN_JOB = "unknown-job";

/**
 * The name a log line gives a job: its type if this worker has a handler
 * for it, and otherwise one fixed word. A type is stored text; only the
 * types this worker knows are written.
 */
export function jobName(handlers: Readonly<Record<string, unknown>>, type: string): string {
  return typeof type === "string" && Object.hasOwn(handlers, type) ? type : UNKNOWN_JOB;
}

/** What is said of every job the worker runs (design note M3 U6, L4). */
export interface JobLine {
  readonly jobId: string;
  readonly type: string;
  readonly tenantId: string | null;
  /** The conversation the job is about, if it names one. */
  readonly conversationId: string | null;
  readonly result: "done" | "deferred" | "retry" | "dead" | "not-held";
  readonly attempts: number;
  /** From looking for a job to its outcome being recorded. */
  readonly durationMs: number;
}

export interface WorkerOptions {
  /** The cross-tenant role's: claims jobs and records the heartbeat. */
  readonly cross: Database;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  /** Stops the loop after the job in hand. */
  readonly signal: AbortSignal;
  readonly report?: WorkerReport;
  /** Called once for every job that was run, whatever its outcome. */
  readonly ran?: (line: JobLine) => void;
  readonly workerId?: string;
  readonly pollMs?: number;
  readonly heartbeatMs?: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Runs until the signal aborts, then resolves once the job in hand has
 * ended. A fault of the loop itself, such as a database that cannot be
 * reached, is reported and tried again after the poll interval: the worker
 * does not exit. The heartbeat has a loop of its own, so that a long job
 * does not make a live worker look dead; a worker that cannot reach the
 * database records none, which is what tells anyone.
 */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const workerId = options.workerId ?? randomUUID();
  const pollMs = options.pollMs ?? POLL_INTERVAL_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const report = options.report;

  const heart = async (): Promise<void> => {
    while (!options.signal.aborted) {
      try {
        await beat(options.cross, workerId);
      } catch (error) {
        report?.("loop-error", errorCode(error));
      }
      await sleep(heartbeatMs, options.signal);
    }
  };
  const jobs = async (): Promise<void> => {
    while (!options.signal.aborted) {
      try {
        const began = Date.now();
        const outcome = await workOnce(options.cross, options.handlers);
        if (!outcome.ran) {
          await sleep(pollMs, options.signal);
        } else {
          try {
            options.ran?.({
              jobId: outcome.job.id,
              type: outcome.job.type,
              tenantId: outcome.job.tenantId,
              conversationId: outcome.job.payload["conversationId"] ?? null,
              result: outcome.result,
              attempts: outcome.job.attempts,
              durationMs: Math.max(0, Date.now() - began),
            });
          } catch {
            // A line that cannot be written does not stop the work.
          }
        }
      } catch (error) {
        report?.("loop-error", errorCode(error));
        await sleep(pollMs, options.signal);
      }
    }
  };
  await Promise.all([heart(), jobs()]);
}
