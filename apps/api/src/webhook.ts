// The channel webhook (`docs/design/api.md`, section 3). A request does
// four things in this order and nothing else: its size is checked before it
// is read in full, its signature is checked over the body as received, its
// events are handed to the sink, and it is answered.
//
// What the sink does with events (store them and queue their jobs, in one
// transaction) arrives with unit U7. Until then this file is the guard.

import { createHash } from "node:crypto";
import type { Channel, EventBatch } from "@polyglot-sales-agent/channel";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BadSignatureLimiter } from "./bad-signature-limiter.ts";

/** How long the sink may take before the request is answered 503. The agent's proposal. */
export const SINK_DEADLINE_MS = 5_000;

/**
 * Where verified webhooks go. A method that throws, or does not finish in
 * time, makes the answer 503, so that the channel sends again. The signal
 * aborts at that deadline: a sink must stop then, or at least must be safe
 * to run again for the same webhook, because the channel will send it again
 * whether or not this run stored anything.
 */
export interface WebhookSink {
  /**
   * `skipped` counts parts this version does not handle; `malformed` counts
   * messages or statuses that were left out because they did not have the
   * expected form. The hash and size of the body come with them, so that
   * what was left out can be recorded without keeping the body.
   */
  events(
    batches: readonly EventBatch[],
    info: { skipped: number; malformed: number; sha256: string; size: number },
    signal: AbortSignal,
  ): Promise<void>;
  /**
   * A body with a valid signature that could not be read. It gets a hash,
   * its size and a code, and never the body itself, which may hold a
   * stranger's number and text.
   */
  unparsed(
    info: { code: string; sha256: string; size: number },
    signal: AbortSignal,
  ): Promise<void>;
}

export interface WebhookOptions {
  readonly channel: Channel;
  readonly sink: WebhookSink;
  /**
   * Answers the channel's one-time registration check: the challenge to
   * echo if the query is that check and its token is right.
   */
  readonly registration: (query: Readonly<Record<string, unknown>>) => string | undefined;
  /**
   * Who a request is from, for the limit on refused requests. The default
   * is the address the server sees, which is the caller's only if the
   * server is told about every proxy in front of it (`createApiServer`).
   */
  readonly sourceOf?: (request: FastifyRequest) => string;
  readonly limiter?: BadSignatureLimiter;
  /** Defaults to the largest body the channel says it sends. */
  readonly bodyLimit?: number;
  readonly sinkDeadlineMs?: number;
  /** Called with the cause each time a request is answered 503. For a log; it must not throw. */
  readonly onUnavailable?: (error: unknown) => void;
  /** For tests. Milliseconds. */
  readonly now?: () => number;
}

export function problem(
  reply: FastifyReply,
  status: number,
  code: string,
  title: string,
): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: "about:blank", title, status, code });
}

class SinkTooSlow extends Error {
  readonly code = "sink-too-slow";
}

/** Runs the sink with a signal that aborts at the deadline, when the wait ends too. */
function within(work: (signal: AbortSignal) => Promise<void>, ms: number): Promise<void> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new SinkTooSlow());
    }, ms);
  });
  const run = work(abort.signal);
  // If the deadline wins, the sink's own late failure must not go unhandled.
  run.catch(() => undefined);
  return Promise.race([run, late]).finally(() => clearTimeout(timer));
}

/** Registers `GET` and `POST /webhooks/<channel name>` on their own scope of the server. */
export async function registerWebhook(
  app: FastifyInstance,
  options: WebhookOptions,
): Promise<void> {
  const limiter = options.limiter ?? new BadSignatureLimiter();
  const now = options.now ?? Date.now;
  const sourceOf = options.sourceOf ?? ((request: FastifyRequest) => request.ip);
  const deadline = options.sinkDeadlineMs ?? SINK_DEADLINE_MS;
  const path = `/webhooks/${options.channel.name}`;

  await app.register(async (scope) => {
    // The body is wanted exactly as it was sent, whatever it claims to be.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: options.bodyLimit ?? options.channel.maxWebhookBytes },
      (_request, body, done) => done(null, body),
    );

    scope.setErrorHandler((error: { code?: string; statusCode?: number }, request, reply) => {
      // Decided by the framework's own error codes, never by a status an
      // error from the sink might happen to carry.
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        limiter.recordBad(sourceOf(request), now());
        return problem(reply, 413, "too-large", "The body is larger than this endpoint reads");
      }
      if (typeof error.code === "string" && error.code.startsWith("FST_ERR_CTP_")) {
        // The request itself is malformed; sending it again would not help.
        return problem(reply, 400, "malformed", "The request could not be read");
      }
      // Nothing of the error is sent: it can describe the request.
      options.onUnavailable?.(error);
      return problem(reply, 503, "unavailable", "The request could not be handled; send it again");
    });

    // Before the body is read: a source that keeps being refused is refused
    // without costing any more work.
    scope.addHook("onRequest", async (request, reply) => {
      if (limiter.isBlocked(sourceOf(request), now())) {
        return problem(reply, 429, "too-many-refused", "Too many requests from here were refused");
      }
    });

    scope.get(path, async (request, reply) => {
      const challenge = options.registration(request.query as Record<string, unknown>);
      if (challenge === undefined) {
        // Counted, so that the token cannot be guessed at without limit.
        limiter.recordBad(sourceOf(request), now());
        return problem(reply, 403, "forbidden", "The verification token is wrong");
      }
      return reply
        .code(200)
        .type("text/plain")
        .header("x-content-type-options", "nosniff")
        .send(challenge);
    });

    scope.post(path, async (request, reply) => {
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      // Nothing is read out of the body before this check.
      if (!options.channel.verifyWebhook(rawBody, request.headers)) {
        limiter.recordBad(sourceOf(request), now());
        return problem(reply, 401, "bad-signature", "The signature is missing or wrong");
      }
      const parsed = options.channel.parseWebhook(rawBody);
      const sha256 = createHash("sha256").update(rawBody).digest("hex");
      const size = rawBody.length;
      await within(
        (signal) =>
          parsed.ok
            ? options.sink.events(
                parsed.batches,
                { skipped: parsed.skipped, malformed: parsed.malformed, sha256, size },
                signal,
              )
            : options.sink.unparsed({ code: parsed.code, sha256, size }, signal),
        deadline,
      );
      return reply.code(200).type("text/plain").send("");
    });
  });
}
