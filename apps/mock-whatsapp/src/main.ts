// Runs the mock for development: `node apps/mock-whatsapp/src/main.ts`.
// It listens on this machine only, unless PSA_MOCK_HOST says every
// interface, which is for a container whose port is published to this
// machine alone. It refuses to start in production (#165): its page sends
// messages as any customer.

import { readEnvironment, refuseInProduction } from "@polyglot-sales-agent/core";
import { createMockWhatsApp, MOCK_HOST } from "./server.ts";

try {
  refuseInProduction("mock-whatsapp", readEnvironment(process.env), { developmentOnly: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : "mock-whatsapp: could not start");
  process.exit(1);
}
const host = (process.env["PSA_MOCK_HOST"] ?? "").trim() || MOCK_HOST;
if (host !== MOCK_HOST && host !== "0.0.0.0") {
  console.error("mock-whatsapp: PSA_MOCK_HOST is 127.0.0.1 or 0.0.0.0");
  process.exit(1);
}

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const webhookUrl = process.env["PSA_MOCK_WEBHOOK_URL"];
const app = createMockWhatsApp({
  appSecret: env("PSA_WHATSAPP_APP_SECRET"),
  accessToken: env("PSA_MOCK_ACCESS_TOKEN"),
  ...(webhookUrl === undefined || webhookUrl === "" ? {} : { webhookUrl }),
});
const address = await app.listen({
  host,
  port: Number(process.env["PSA_MOCK_PORT"] ?? 4010),
});
console.log(`mock-whatsapp: listening on ${address}`);
