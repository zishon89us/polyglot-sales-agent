// A stand-in for the model, for development and the end-to-end test (M3
// unit U7; design note docs/design/notes/m3-u7-turn.md, section 2). It
// calls nothing. It answers with the customer's own texts after the word
// "Echo:", as M2's echo did, in the structure a model must answer in.
//
// It must never answer a customer: the worker refuses to start with it in
// production.

import { LANGUAGE_UNKNOWN } from "@polyglot-sales-agent/core";
import type { AdapterAnswer, Health, LlmAdapter, LlmRequest } from "./types.ts";

export const STAND_IN_ECHO = "stand-in-echo";
/** The longest reply it makes: under what the client accepts, whatever it is given. */
export const STAND_IN_REPLY_MAX = 1_000;

/** The text between a mark's two lines, or the text itself if it is not marked. */
function unmarked(text: string): string {
  const found = /^\[\[data:([0-9a-f]{32})\]\]\n([\s\S]*)\n\[\[end:\1\]\]$/.exec(text);
  return found?.[2] ?? text;
}

/**
 * What it answers to a request: the customer's texts at the request's end,
 * after the last message that is not a customer's. A turn's request ends
 * with the batch, after the facts of the turn.
 */
export function standInReply(request: LlmRequest): string {
  let from = 0;
  request.messages.forEach((message, index) => {
    if (message.role !== "customer") {
      from = index + 1;
    }
  });
  const texts = request.messages
    .slice(from)
    .flatMap((message) => (message.role === "customer" ? [unmarked(message.text)] : []));
  return [...`Echo: ${texts.join("\n")}`].slice(0, STAND_IN_REPLY_MAX).join("");
}

export function standInEcho(): LlmAdapter {
  return {
    async generate(request: LlmRequest): Promise<AdapterAnswer> {
      return {
        kind: "answer",
        value: {
          reply: standInReply(request),
          claims: [],
          flags: [],
          toolCalls: [],
          language: LANGUAGE_UNKNOWN,
        },
        truncated: false,
        // It counts nothing, so a call through it has no cost.
        usage: { inputTokens: 0, outputTokens: 0 },
        model: STAND_IN_ECHO,
      };
    },
    async health(): Promise<Health> {
      return { ok: true };
    },
  };
}
