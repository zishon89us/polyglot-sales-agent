// Runs the mock for development: `node apps/mock-whatsapp/src/main.ts`.
// It listens on this machine only.

import { createMockWhatsApp, MOCK_HOST } from "./server.ts";

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
  host: MOCK_HOST,
  port: Number(process.env["PSA_MOCK_PORT"] ?? 4010),
});
console.log(`mock-whatsapp: listening on ${address}`);
