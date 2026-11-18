// Starts the API: `node --env-file-if-exists=.env apps/api/src/main.ts`.

import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
  registrationChallenge,
} from "@polyglot-sales-agent/channel-whatsapp";
import pg from "pg";
import { buildApi } from "./app.ts";
import { readConfig } from "./config.ts";

try {
  const config = readConfig(process.env);
  const app = new pg.Pool({ connectionString: config.appDatabaseUrl });
  const cross = new pg.Pool({ connectionString: config.crossDatabaseUrl, max: 4 });
  // A connection lost while idle must not end the process.
  app.on("error", () => undefined);
  cross.on("error", () => undefined);
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
  });
  const address = await server.listen({ host: config.host, port: config.port });
  console.log(`api: listening on ${address}`);
} catch (error) {
  // The message only: an error object can carry a connection string.
  console.error(error instanceof Error ? error.message : "api: could not start");
  process.exitCode = 1;
}
