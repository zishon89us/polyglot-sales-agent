// Starts the worker: `node --env-file-if-exists=.env apps/worker/src/main.ts`.

import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
} from "@polyglot-sales-agent/channel-whatsapp";
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

try {
  const config = readConfig(process.env);
  const app = openDatabase(APP_ROLE, config.appDatabaseUrl);
  const cross = openDatabase(CROSS_ROLE, config.crossDatabaseUrl, { max: 4 });
  // Wrong addresses, passwords or roles are found now, not at the first job.
  if (!(await databaseReady(app))) {
    throw new Error(`worker: PSA_DB_APP_URL does not reach the database as ${APP_ROLE}`);
  }
  if (!(await databaseReady(cross))) {
    throw new Error(`worker: PSA_DB_CROSS_URL does not reach the database as ${CROSS_ROLE}`);
  }
  const whatsapp = createWhatsAppChannel({
    appSecrets: config.whatsappAppSecrets,
    baseUrl: config.whatsappBaseUrl,
    apiVersion: config.whatsappApiVersion,
    timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
  });
  // One line of JSON per fault: a time, the event and a short code.
  const report = (event: string, code: string): void =>
    console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", event, code }));
  const stop = new AbortController();
  // Finish the job in hand, then let go of the database.
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  console.log("worker: running");
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
  });
  await Promise.all([closeDatabase(app), closeDatabase(cross)]);
  console.log("worker: stopped");
} catch (error) {
  // The message only: an error object can carry a connection string.
  console.error(error instanceof Error ? error.message : "worker: could not start");
  process.exit(1);
}
