// The HTTP server every route of `apps/api` is registered on, with the
// settings that must not be left to defaults: how long a request may take
// to arrive, which proxies are trusted to name the caller, and what an
// error or an unknown path is answered with.

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { problem } from "./webhook.ts";

export interface ServerOptions {
  /**
   * The proxies in front of this server, by address or network. The
   * caller's address is then taken from what they report. `false` means
   * there is none and the address of the connection is the caller's.
   *
   * Never "trust every proxy": a caller could then name any address as its
   * own, get the channel's address blocked by the limit on refused
   * requests, and avoid that limit itself. If this is `false` behind a
   * proxy, every caller looks like the proxy: ten refused requests from
   * anyone then block the channel's webhooks for a minute at a time.
   */
  readonly trustedProxies: false | readonly string[];
  /** How long a request may take to arrive in full. The agent's proposal: 10 seconds. */
  readonly requestTimeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 10_000;

export function createApiServer(options: ServerOptions): FastifyInstance {
  const trusted = options.trustedProxies;
  const settings: FastifyServerOptions = {
    logger: false,
    trustProxy: trusted === false ? false : [...trusted],
    // A body that trickles in, or never ends, is cut off.
    requestTimeout: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    connectionTimeout: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    keepAliveTimeout: 5_000,
    // Each route sets its own; this is for a route that forgets to.
    bodyLimit: 64 * 1024,
  };
  const app = Fastify(settings);
  // Neither repeats anything of the request, not even its path.
  app.setNotFoundHandler((_request, reply) => problem(reply, 404, "not-found", "No such route"));
  app.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    const client =
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500;
    return client
      ? problem(reply, 400, "malformed", "The request could not be read")
      : problem(reply, 503, "unavailable", "The request could not be handled; send it again");
  });
  return app;
}
