// The worker's loop: record a heartbeat, run due jobs one after another,
// and sleep when there is none (ADR 0004, amendment).

import { randomUUID } from "node:crypto";
import { errorCode, HEARTBEAT_INTERVAL_MS, POLL_INTERVAL_MS } from "@polyglot-sales-agent/core";
import { beat, type Database, type JobHandler, workOnce } from "@polyglot-sales-agent/db";

/** One line for the log: what happened, and a short code. Never anything of a message. */
export type WorkerReport = (event: "job-retry" | "job-dead" | "loop-error", code: string) => void;

export interface WorkerOptions {
  /** The cross-tenant role's: claims jobs and records the heartbeat. */
  readonly cross: Database;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  /** Stops the loop after the job in hand. */
  readonly signal: AbortSignal;
  readonly report?: WorkerReport;
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
        const outcome = await workOnce(options.cross, options.handlers);
        if (!outcome.ran) {
          await sleep(pollMs, options.signal);
        } else if (outcome.result === "retry" || outcome.result === "dead") {
          report?.(outcome.result === "dead" ? "job-dead" : "job-retry", outcome.job.type);
        }
      } catch (error) {
        report?.("loop-error", errorCode(error));
        await sleep(pollMs, options.signal);
      }
    }
  };
  await Promise.all([heart(), jobs()]);
}
