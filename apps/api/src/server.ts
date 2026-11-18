// The HTTP server every route of `apps/api` is registered on, with the
// settings that must not be left to defaults: how long a request may take
// to arrive, which proxies are trusted to name the caller, and what an
// error or an unknown path is answered with.

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
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
  /** How long a request may take to arrive in full, body included. The agent's proposal: 10 seconds. */
  readonly requestTimeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * An error a route throws on purpose, answered as it says. Any other error
 * is answered 503 with nothing of it shown.
 */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, title: string) {
    super(title);
    this.status = status;
    this.code = code;
  }
}

export function createApiServer(options: ServerOptions): FastifyInstance {
  const trusted = options.trustedProxies;
  const arrival = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const settings: FastifyServerOptions = {
    logger: false,
    trustProxy: trusted === false ? false : [...trusted],
    // A connection that sends nothing at all is closed by this. It is an
    // idle timer, and a connection is also idle while its request is being
    // handled, so it is longer than a request may take to arrive: the
    // arrival itself has the timer below.
    connectionTimeout: arrival + 10_000,
    keepAliveTimeout: 5_000,
    // Each route sets its own; this is for a route that forgets to.
    bodyLimit: 64 * 1024,
    // No HEAD route is made for a GET route unasked.
    exposeHeadRoutes: false,
    // A path the router cannot decode: answered without repeating it.
    frameworkErrors: (_error, _request, reply) => {
      problem(reply as unknown as FastifyReply, 400, "malformed", "The request could not be read");
    },
  };
  const app = Fastify(settings);

  // The whole request, body included, must arrive within the time allowed,
  // however steadily it trickles in. The server's own timeouts are reset by
  // every byte, or checked only now and then, so this has a timer of its own.
  const timers = new WeakMap<FastifyRequest, ReturnType<typeof setTimeout>>();
  const arrived = (request: FastifyRequest): void => {
    clearTimeout(timers.get(request));
    timers.delete(request);
  };
  app.addHook("onRequest", async (request) => {
    timers.set(
      request,
      setTimeout(() => request.raw.socket.destroy(), arrival),
    );
  });
  app.addHook("preValidation", async (request) => arrived(request));
  app.addHook("onResponse", async (request) => arrived(request));
  app.addHook("onRequestAbort", async (request) => arrived(request));

  // Neither repeats anything of the request, not even its path.
  app.setNotFoundHandler((_request, reply) => problem(reply, 404, "not-found", "No such route"));
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ProblemError) {
      return problem(reply, error.status, error.code, error.message);
    }
    // The framework's own complaints about the request, by its codes. A
    // status that some other error happens to carry decides nothing.
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code.startsWith("FST_ERR_")) {
      const status = (error as { statusCode?: unknown }).statusCode;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return problem(reply, 400, "malformed", "The request could not be read");
      }
    }
    return problem(reply, 503, "unavailable", "The request could not be handled; send it again");
  });
  return app;
}
