// Starts the worker: `node --env-file-if-exists=.env apps/worker/src/main.ts`.

import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
} from "@polyglot-sales-agent/channel-whatsapp";
import {
  errorCode,
  logTo,
  settingsNamed,
  startFailure,
  startReasons,
} from "@polyglot-sales-agent/core";
import {
  APP_ROLE,
  CROSS_ROLE,
  closeDatabase,
  databaseReady,
  openDatabase,
} from "@polyglot-sales-agent/db";
import { readConfig } from "./config.ts";
import { createHandlers } from "./handlers.ts";
import { runWorker } from "./worker.ts";

// Each line to standard output, or to standard error for an error.
const log = logTo("worker", (line, level) => {
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
});

try {
  const config = readConfig(process.env);
  const app = openDatabase(APP_ROLE, config.appDatabaseUrl);
  const cross = openDatabase(CROSS_ROLE, config.crossDatabaseUrl, { max: 4 });
  // Wrong addresses, passwords or roles are found now, not at the first job.
  if (!(await databaseReady(app))) {
    throw startFailure(
      `worker: PSA_DB_APP_URL does not reach the database as ${APP_ROLE}`,
      "database-unreachable",
    );
  }
  if (!(await databaseReady(cross))) {
    throw startFailure(
      `worker: PSA_DB_CROSS_URL does not reach the database as ${CROSS_ROLE}`,
      "database-unreachable",
    );
  }
  const whatsapp = createWhatsAppChannel({
    appSecrets: config.whatsappAppSecrets,
    baseUrl: config.whatsappBaseUrl,
    apiVersion: config.whatsappApiVersion,
    timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
  });
  // Every line in the one shape (NFR-O2): no key of it can hold a sentence.
  const report = (event: "loop-error" | "turn-skipped" | "send-failed", code: string): void =>
    log({ level: event === "turn-skipped" ? "info" : "error", event, code });
  const stop = new AbortController();
  // Finish the job in hand, then let go of the database.
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  log({ level: "info", event: "running" });
  await runWorker({
    cross,
    handlers: createHandlers({
      app,
      channels: { [whatsapp.name]: whatsapp },
      accessToken: config.whatsappAccessToken,
      report,
    }),
    signal: stop.signal,
    report,
    ran: (job) =>
      log({
        level: job.result === "dead" ? "error" : job.result === "retry" ? "warn" : "info",
        event: "job",
        code: job.result,
        jobId: job.jobId,
        tenantId: job.tenantId,
        conversationId: job.conversationId,
        names: [job.type],
        n: { durationMs: job.durationMs, attempts: job.attempts },
      }),
  });
  await Promise.all([closeDatabase(app), closeDatabase(cross)]);
  log({ level: "info", event: "stopped" });
} catch (error) {
  // The settings the failure names and a code, never its message: an error
  // can carry a connection string.
  log({
    level: "error",
    event: "could-not-start",
    code: errorCode(error),
    names: [
      ...settingsNamed(error instanceof Error ? error.message : undefined),
      ...startReasons(error),
    ],
  });
  process.exit(1);
}
