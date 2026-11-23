// The check of what a model answers (design note, section 3; guardrail
// policy, O1). Nothing is repaired: an answer is taken whole or refused
// with a code.

import {
  CLAIM_TEXT_MAX,
  CLAIMS_MAX,
  MODEL_FLAGS,
  type ModelFlag,
  TOOL_ARGUMENTS_DEPTH_MAX,
  TOOL_ARGUMENTS_MAX,
  TOOL_CALL_ID_MAX,
  TOOL_CALLS_PER_ROUND_MAX,
} from "@polyglot-sales-agent/core";
import type { Claim, InvalidOutputCode, LlmOutput, Plain, ToolCall } from "./types.ts";

export type OutputRead =
  | { readonly ok: true; readonly output: LlmOutput }
  | { readonly ok: false; readonly code: Exclude<InvalidOutputCode, "truncated"> };

const length = (text: string): number => [...text].length;

// A control character other than a line break, or half of a surrogate
// pair. The first cannot all be stored (U+0000), the second cannot be
// sent whole.
const REFUSED = /[\p{Cc}\p{Cs}]/u;
const fine = (text: string): boolean => !REFUSED.test(text.replaceAll("\n", ""));

const REFUSED_KEYS = ["__proto__", "constructor", "prototype"];

/** An object made by `{}` or JSON, holding values only: no class, no getter, no symbol. */
function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (property) => "value" in property && property.enumerable === true,
  );
}

function exactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Every text inside a value that could be plain data, as far down as plain data may go. */
function textsIn(value: unknown, depth: number, found: string[]): void {
  if (typeof value === "string") {
    found.push(value);
  } else if (depth <= TOOL_ARGUMENTS_DEPTH_MAX && Array.isArray(value)) {
    for (const item of value) {
      textsIn(item, depth + 1, found);
    }
  } else if (depth <= TOOL_ARGUMENTS_DEPTH_MAX && plainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      textsIn(item, depth + 1, found);
    }
  }
}

/** A copy of plain data, frozen, or undefined if the value is not plain data within the bounds. */
function plainCopy(value: unknown, depth: number): Plain | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth > TOOL_ARGUMENTS_DEPTH_MAX) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items: Plain[] = [];
    // Not `map`: a list with holes has no value where JSON would need one.
    for (let index = 0; index < value.length; index += 1) {
      const item = plainCopy(value[index], depth + 1);
      if (item === undefined) {
        return undefined;
      }
      items.push(item);
    }
    return Object.freeze(items);
  }
  if (!plainObject(value)) {
    return undefined;
  }
  const copy: Record<string, Plain> = Object.create(null) as Record<string, Plain>;
  for (const [key, item] of Object.entries(value)) {
    if (REFUSED_KEYS.includes(key)) {
      return undefined;
    }
    const inner = plainCopy(item, depth + 1);
    if (inner === undefined) {
      return undefined;
    }
    copy[key] = inner;
  }
  return Object.freeze(copy);
}

/**
 * Checks an answer against the structure. `allowed` is what the request
 * offered: its claim kinds and the names of its tools. Where an answer has
 * more than one fault the code is the first of `shape`, `flag`, `claim`,
 * `tool-call`.
 */
export function readOutput(
  value: unknown,
  allowed: { readonly claimKinds: readonly string[]; readonly tools: readonly string[] },
): OutputRead {
  const refused = (code: Exclude<InvalidOutputCode, "truncated">): OutputRead => ({
    ok: false,
    code,
  });

  // Shape: the four parts, each of its type, no other key at any level, no text that cannot be kept.
  if (!plainObject(value) || !exactly(value, ["reply", "claims", "flags", "toolCalls"])) {
    return refused("shape");
  }
  const { reply, claims, flags, toolCalls } = value;
  if (
    typeof reply !== "string" ||
    !Array.isArray(claims) ||
    !Array.isArray(flags) ||
    !Array.isArray(toolCalls)
  ) {
    return refused("shape");
  }
  const texts: string[] = [reply];
  for (const claim of claims as unknown[]) {
    if (
      !plainObject(claim) ||
      !exactly(claim, ["kind", "item", "value"]) ||
      typeof claim["kind"] !== "string" ||
      typeof claim["item"] !== "string" ||
      typeof claim["value"] !== "string"
    ) {
      return refused("shape");
    }
    texts.push(claim["kind"], claim["item"], claim["value"]);
  }
  for (const flag of flags as unknown[]) {
    if (typeof flag !== "string") {
      return refused("shape");
    }
    texts.push(flag);
  }
  for (const call of toolCalls as unknown[]) {
    if (
      !plainObject(call) ||
      !exactly(call, ["id", "name", "arguments"]) ||
      typeof call["id"] !== "string" ||
      typeof call["name"] !== "string"
    ) {
      return refused("shape");
    }
    texts.push(call["id"], call["name"]);
    textsIn(call["arguments"], 1, texts);
  }
  // A list with holes has fewer entries than its length says.
  if (
    Object.keys(claims).length !== claims.length ||
    Object.keys(flags).length !== flags.length ||
    Object.keys(toolCalls).length !== toolCalls.length
  ) {
    return refused("shape");
  }
  if (!texts.every(fine)) {
    return refused("shape");
  }

  // Flags: each one of the seven. A list of flags is a set: one written twice is that flag.
  const set: ModelFlag[] = [];
  for (const flag of flags as string[]) {
    const known = MODEL_FLAGS.find((name) => name === flag);
    if (known === undefined) {
      return refused("flag");
    }
    if (!set.includes(known)) {
      set.push(known);
    }
  }

  // Claims.
  if (claims.length > CLAIMS_MAX) {
    return refused("claim");
  }
  const made: Claim[] = [];
  for (const claim of claims as Record<string, string>[]) {
    const kind = claim["kind"] as string;
    const item = claim["item"] as string;
    const stated = claim["value"] as string;
    if (
      !allowed.claimKinds.includes(kind) ||
      length(item) < 1 ||
      length(item) > CLAIM_TEXT_MAX ||
      length(stated) < 1 ||
      length(stated) > CLAIM_TEXT_MAX
    ) {
      return refused("claim");
    }
    made.push(Object.freeze({ kind, item, value: stated }));
  }

  // Tool calls. An answer asks for tools or it replies, not both.
  if (toolCalls.length > TOOL_CALLS_PER_ROUND_MAX) {
    return refused("tool-call");
  }
  if (toolCalls.length > 0 && (reply !== "" || claims.length > 0)) {
    return refused("tool-call");
  }
  const asked: ToolCall[] = [];
  for (const call of toolCalls as Record<string, unknown>[]) {
    const id = call["id"] as string;
    const name = call["name"] as string;
    const given = call["arguments"];
    if (
      !allowed.tools.includes(name) ||
      length(id) < 1 ||
      length(id) > TOOL_CALL_ID_MAX ||
      asked.some((earlier) => earlier.id === id) ||
      !plainObject(given)
    ) {
      return refused("tool-call");
    }
    const copy = plainCopy(given, 1);
    if (copy === undefined || length(JSON.stringify(copy)) > TOOL_ARGUMENTS_MAX) {
      return refused("tool-call");
    }
    asked.push(Object.freeze({ id, name, arguments: copy as { readonly [key: string]: Plain } }));
  }

  return {
    ok: true,
    output: Object.freeze({
      reply,
      claims: Object.freeze(made),
      flags: Object.freeze(set),
      toolCalls: Object.freeze(asked),
    }),
  };
}
