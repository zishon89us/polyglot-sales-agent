// The channel webhook (`docs/design/api.md`, section 3). A request does
// four things in this order and nothing else: its size is checked before it
// is read in full, its signature is checked over the body as received, its
// events are handed to the sink, and it is answered.
//
// What the sink does with events (store them and queue their jobs, in one
// transaction) arrives with unit U7. Until then this file is the guard.

import { createHash } from "node:crypto";
import type { Channel, EventBatch } from "@polyglot-sales-agent/channel";
import type { FastifyInstance, FastifyReply } from "fastify";
import { BadSignatureLimiter } from "./bad-signature-limiter.ts";

/**
 * The largest body read. Meta says a webhook payload can be up to 3 MB
 * (read 2026-11-18); this is 3 MiB, which is a little more.
 */
export const WEBHOOK_BODY_LIMIT = 3 * 1024 * 1024;

/** Where verified webhooks go. A method that throws makes the answer 503, so that the channel sends again. */
export interface WebhookSink {
  events(batches: readonly EventBatch[], skipped: number): Promise<void>;
  /**
   * A body with a valid signature that could not be read. It gets a hash,
   * its size and a code, and never the body itself, which may hold a
   * stranger's number and text.
   */
  unparsed(info: { code: string; sha256: string; size: number }): Promise<void>;
}

export interface WebhookOptions {
  readonly channel: Channel;
  readonly sink: WebhookSink;
  /**
   * Answers the channel's one-time registration check: the challenge to
   * echo if the query is that check and its token is right.
   */
  readonly registration: (query: Readonly<Record<string, unknown>>) => string | undefined;
  readonly limiter?: BadSignatureLimiter;
  readonly bodyLimit?: number;
  /** For tests. Milliseconds. */
  readonly now?: () => number;
}

function problem(reply: FastifyReply, status: number, code: string, title: string): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: "about:blank", title, status, code });
}

/** Registers `GET` and `POST /webhooks/<channel name>` on their own scope of the server. */
export async function registerWebhook(
  app: FastifyInstance,
  options: WebhookOptions,
): Promise<void> {
  const limiter = options.limiter ?? new BadSignatureLimiter();
  const now = options.now ?? Date.now;
  const path = `/webhooks/${options.channel.name}`;

  await app.register(async (scope) => {
    // The body is wanted exactly as it was sent, whatever it claims to be.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: options.bodyLimit ?? WEBHOOK_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );

    scope.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
      if (error.statusCode === 413) {
        return problem(reply, 413, "too-large", "The body is larger than this endpoint reads");
      }
      // Nothing of the error is sent: it can describe the request.
      return problem(reply, 503, "unavailable", "The request could not be handled; send it again");
    });

    // Before the body is read: a source that keeps failing the signature
    // check is refused without costing any more work.
    scope.addHook("onRequest", async (request, reply) => {
      if (request.method === "POST" && limiter.isBlocked(request.ip, now())) {
        return problem(
          reply,
          429,
          "too-many-bad-signatures",
          "Too many requests failed the signature check",
        );
      }
    });

    scope.get(path, async (request, reply) => {
      const challenge = options.registration(request.query as Record<string, unknown>);
      return challenge === undefined
        ? problem(reply, 403, "forbidden", "The verification token is wrong")
        : reply.code(200).type("text/plain").send(challenge);
    });

    scope.post(path, async (request, reply) => {
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      if (!options.channel.verifyWebhook(rawBody, request.headers)) {
        limiter.recordBad(request.ip, now());
        return problem(reply, 401, "bad-signature", "The signature is missing or wrong");
      }
      const parsed = options.channel.parseWebhook(rawBody);
      if (parsed.ok) {
        await options.sink.events(parsed.batches, parsed.skipped);
      } else {
        await options.sink.unparsed({
          code: parsed.code,
          sha256: createHash("sha256").update(rawBody).digest("hex"),
          size: rawBody.length,
        });
      }
      return reply.code(200).type("text/plain").send("");
    });
  });
}
