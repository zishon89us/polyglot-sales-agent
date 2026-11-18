// Starts the API: `node --env-file-if-exists=.env apps/api/src/main.ts`.

import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
  registrationChallenge,
} from "@polyglot-sales-agent/channel-whatsapp";
import {
  APP_ROLE,
  CROSS_ROLE,
  closeDatabase,
  databaseReady,
  openDatabase,
} from "@polyglot-sales-agent/db";
import { buildApi } from "./app.ts";
import { readConfig } from "./config.ts";

try {
  const config = readConfig(process.env);
  const app = openDatabase(APP_ROLE, config.appDatabaseUrl);
  const cross = openDatabase(CROSS_ROLE, config.crossDatabaseUrl, { max: 4 });
  // Wrong addresses, passwords or roles are found now, not at the first webhook.
  if (!(await databaseReady(app))) {
    throw new Error(`api: PSA_DB_APP_URL does not reach the database as ${APP_ROLE}`);
  }
  if (!(await databaseReady(cross))) {
    throw new Error(`api: PSA_DB_CROSS_URL does not reach the database as ${CROSS_ROLE}`);
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
    // One line of JSON per webhook turned away: a time, the event and a short code.
    report: (event, code) =>
      console.error(
        JSON.stringify({ time: new Date().toISOString(), level: "error", event, code }),
      ),
  });
  await server.listen({ host: config.host, port: config.port });
  console.log(`api: listening on ${config.host}, port ${config.port}`);
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
  // The message only: an error object can carry a connection string.
  console.error(error instanceof Error ? error.message : "api: could not start");
  process.exit(1);
}
