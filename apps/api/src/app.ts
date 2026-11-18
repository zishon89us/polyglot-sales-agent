// Puts the API together: the server, the health endpoints and the channel
// webhook with the sink that stores. `main.ts` calls this with settings
// from the environment; tests call it with a test database.

import type { Channel } from "@polyglot-sales-agent/channel";
import { databaseAnswers, type Queryable } from "@polyglot-sales-agent/db";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { BadSignatureLimiter } from "./bad-signature-limiter.ts";
import { createApiServer, type ServerOptions } from "./server.ts";
import { createSink } from "./sink.ts";
import { registerWebhook } from "./webhook.ts";

export interface ApiOptions extends ServerOptions {
  readonly channel: Channel;
  /** Answers the channel's registration check. */
  readonly registration: (query: Readonly<Record<string, unknown>>) => string | undefined;
  /** Connects as the application role. */
  readonly app: pg.Pool;
  /** Connects as the cross-tenant role. */
  readonly cross: Queryable;
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

  // The process can do its work: both database roles answer. It says
  // nothing of the worker, which is probed on its own (ADR 0004, amendment).
  server.get("/readyz", async (_request, reply) => {
    const ready = (await databaseAnswers(options.app)) && (await databaseAnswers(options.cross));
    return reply
      .code(ready ? 200 : 503)
      .type("application/json")
      .send({ status: ready ? "ready" : "not-ready" });
  });

  await registerWebhook(server, {
    channel: options.channel,
    registration: options.registration,
    sink: createSink({ channel: options.channel, app: options.app, cross: options.cross }),
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
    ...(options.sinkDeadlineMs === undefined ? {} : { sinkDeadlineMs: options.sinkDeadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return server;
}
