// Starts the worker: `node --env-file-if-exists=.env apps/worker/src/main.ts`.

import { fileURLToPath } from "node:url";
import { bounded, type LoadedPrompt, loadPrompt, standInEcho } from "@polyglot-sales-agent/ai";
import {
  createWhatsAppChannel,
  DEFAULT_SEND_TIMEOUT_MS,
} from "@polyglot-sales-agent/channel-whatsapp";
import {
  errorCode,
  FIXED_TEXTS_VERSION,
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
import { PACKS } from "@polyglot-sales-agent/packs-registry";
import { readConfig } from "./config.ts";
import { createHandlers } from "./handlers.ts";
import { loadFixedTexts } from "./texts.ts";
import { traceRecorder } from "./traces.ts";
import { REPLY_PROMPT } from "./turn.ts";
import { jobName, runWorker } from "./worker.ts";

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
  const report = (
    event: "loop-error" | "turn-skipped" | "send-failed" | "reply-blocked",
    code: string,
  ): void =>
    // A reply that was held back is a warning: one is expected now and then, many are not.
    log({
      level: event === "turn-skipped" ? "info" : event === "reply-blocked" ? "warn" : "error",
      event,
      code,
    });
  const stop = new AbortController();
  // Finish the job in hand, then let go of the database.
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  log({ level: "info", event: "running" });
  // The prompts are files beside the code; a worker that cannot load them does not start.
  const prompts = fileURLToPath(new URL("../../../prompts/", import.meta.url));
  const fragments: Record<string, LoadedPrompt> = {};
  for (const pack of Object.values(PACKS)) {
    if (pack.promptFragment !== undefined) {
      fragments[pack.name] = loadPrompt(
        prompts,
        pack.promptFragment.name,
        pack.promptFragment.version,
      );
    }
  }
  // The fixed texts likewise: a worker that cannot read them does not start.
  const texts = loadFixedTexts(
    fileURLToPath(new URL("../../../texts/", import.meta.url)),
    FIXED_TEXTS_VERSION,
  );
  const handlers = createHandlers({
    app,
    texts,
    channels: { [whatsapp.name]: whatsapp },
    accessToken: config.whatsappAccessToken,
    report,
    model: {
      // The one adapter there is: a stand-in that calls nothing (config refuses it in production).
      client: bounded(standInEcho(), {
        record: traceRecorder(app),
        prices: config.modelPrices,
      }),
      prompt: loadPrompt(prompts, REPLY_PROMPT.name, REPLY_PROMPT.version),
      fragments,
      canary: config.promptCanary,
      packs: PACKS,
      texts,
    },
  });
  await runWorker({
    cross,
    handlers,
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
        names: [jobName(handlers, job.type)],
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
