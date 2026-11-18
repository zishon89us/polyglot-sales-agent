// Puts the API together: the server, the health endpoints and the channel
// webhook with the sink that stores. `main.ts` calls this with settings
// from the environment; tests call it with a test database.

import type { Channel } from "@polyglot-sales-agent/channel";
import { errorCode } from "@polyglot-sales-agent/core";
import { type Database, databaseReady } from "@polyglot-sales-agent/db";
import type { FastifyInstance } from "fastify";
import type { BadSignatureLimiter } from "./bad-signature-limiter.ts";
import { createApiServer, type ServerOptions } from "./server.ts";
import { createSink } from "./sink.ts";
import { registerWebhook } from "./webhook.ts";

/** One line for the log: what happened, and a short code. Never anything of a request. */
export type Report = (event: "webhook-unavailable", code: string) => void;

export interface ApiOptions extends ServerOptions {
  readonly channel: Channel;
  /** Answers the channel's registration check. */
  readonly registration: (query: Readonly<Record<string, unknown>>) => string | undefined;
  /** The application role's. */
  readonly app: Database;
  /** The cross-tenant role's. */
  readonly cross: Database;
  /** Told of each webhook answered 503. Without it nothing says why the channel is being turned away. */
  readonly report?: Report;
  readonly limiter?: BadSignatureLimiter;
  readonly sinkDeadlineMs?: number;
  /** For tests. Milliseconds. */
  readonly now?: () => number;
}

export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const server = createApiServer(options);

  // The process is up. Nothing is checked: a platform restarts what fails this.
  server.get("/healthz", async (_request, reply) =>
    reply.code(200).type("application/json").send({ status: "ok" }),
  );

  // The process can do its work: each database handle answers, in time,
  // as the role it is meant to be. It says nothing of the worker, which is
  // probed on its own (ADR 0004, amendment).
  server.get("/readyz", async (_request, reply) => {
    const [app, cross] = await Promise.all([
      databaseReady(options.app),
      databaseReady(options.cross),
    ]);
    const ready = app && cross;
    return reply
      .code(ready ? 200 : 503)
      .type("application/json")
      .send({ status: ready ? "ready" : "not-ready" });
  });

  const report = options.report;
  await registerWebhook(server, {
    channel: options.channel,
    registration: options.registration,
    sink: createSink({ channel: options.channel, app: options.app, cross: options.cross }),
    ...(report === undefined
      ? {}
      : { onUnavailable: (error: unknown) => report("webhook-unavailable", errorCode(error)) }),
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
    ...(options.sinkDeadlineMs === undefined ? {} : { sinkDeadlineMs: options.sinkDeadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return server;
}
