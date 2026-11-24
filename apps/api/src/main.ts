// Starts the API: `node --env-file-if-exists=.env apps/api/src/main.ts`.

import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
  registrationChallenge,
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
import { buildApi } from "./app.ts";
import { readConfig } from "./config.ts";

// Each line to standard output, or to standard error for an error.
const log = logTo("api", (line, level) => {
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
});

try {
  const config = readConfig(process.env);
  const app = openDatabase(APP_ROLE, config.appDatabaseUrl);
  const cross = openDatabase(CROSS_ROLE, config.crossDatabaseUrl, { max: 4 });
  // Wrong addresses, passwords or roles are found now, not at the first webhook.
  if (!(await databaseReady(app))) {
    throw startFailure(
      `api: PSA_DB_APP_URL does not reach the database as ${APP_ROLE}`,
      "database-unreachable",
    );
  }
  if (!(await databaseReady(cross))) {
    throw startFailure(
      `api: PSA_DB_CROSS_URL does not reach the database as ${CROSS_ROLE}`,
      "database-unreachable",
    );
  }
  const server = await buildApi({
    channel: createWhatsAppChannel({
      appSecrets: config.whatsappAppSecrets,
      baseUrl: config.whatsappBaseUrl,
      apiVersion: config.whatsappApiVersion,
      timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
    }),
    registration: (query) => registrationChallenge(query, config.whatsappVerifyToken),
    app,
    cross,
    trustedProxies: config.trustedProxies,
    // Every line in the one shape (NFR-O2): no key of it can hold a sentence.
    report: (event, code) => log({ level: "error", event, code }),
    log,
  });
  await server.listen({ host: config.host, port: config.port });
  log({ level: "info", event: "listening" });
  // Stop taking requests, let those in hand finish, then let go of the database.
  process.once("SIGTERM", () => {
    server
      .close()
      .then(() => Promise.all([closeDatabase(app), closeDatabase(cross)]))
      .catch(() => {
        process.exitCode = 1;
      });
  });
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
