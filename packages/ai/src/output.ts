// The check of what a model answers (design note, section 3; guardrail
// policy, O1). Nothing is repaired: an answer is taken whole or refused
// with a code.
//
// The value is read once. Every part is first copied into objects and
// lists made here, and every check runs on those copies, so a value that
// answers differently the second time it is asked (an accessor, a proxy)
// cannot pass one check and fail to be what another saw.

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
/** Whether a text can be kept: used for a model's name too. */
export const keepable = (text: string): boolean => !REFUSED.test(text.replaceAll("\n", ""));

const REFUSED_KEYS = ["__proto__", "constructor", "prototype"];

type Fields = Record<string, unknown>;

/**
 * The values of an object made by `{}` or by JSON, read once: no class, no
 * accessor, no symbol, nothing hidden. Undefined for anything else.
 */
function fieldsOf(value: unknown): Fields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return undefined;
  }
  const read: Fields = Object.create(null) as Fields;
  for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in property) || property.enumerable !== true) {
      return undefined;
    }
    read[key] = property.value;
  }
  return read;
}

/**
 * The items of a plain list, read once: an array of the usual kind with an
 * item at every place and nothing else on it. Undefined for anything else.
 */
function itemsOf(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return undefined;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return undefined;
  }
  const properties = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const size = properties["length"]?.value as unknown;
  if (typeof size !== "number" || Object.keys(properties).length !== size + 1) {
    return undefined;
  }
  const items: unknown[] = [];
  for (let index = 0; index < size; index += 1) {
    const property = properties[String(index)];
    if (property === undefined || !("value" in property) || property.enumerable !== true) {
      return undefined;
    }
    items.push(property.value);
  }
  return items;
}

function exactly(fields: Fields, keys: readonly string[]): boolean {
  return Object.keys(fields).length === keys.length && keys.every((key) => key in fields);
}

/** Where a tool call's arguments hold something that is not plain data, or go too deep. */
const NOT_PLAIN = Symbol("not plain data");
type Loose =
  | null
  | boolean
  | number
  | string
  | typeof NOT_PLAIN
  | Loose[]
  | { [key: string]: Loose };

/** A tool call's arguments, read once into values made here. What is not plain data is marked, not refused yet. */
function looseCopy(value: unknown, depth: number): Loose {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (depth > TOOL_ARGUMENTS_DEPTH_MAX) {
    return NOT_PLAIN;
  }
  let items: unknown[] | undefined;
  let fields: Fields | undefined;
  try {
    items = itemsOf(value);
    fields = items === undefined ? fieldsOf(value) : undefined;
  } catch {
    // A value that will not be looked at is not plain data.
    return NOT_PLAIN;
  }
  if (items !== undefined) {
    return items.map((item) => looseCopy(item, depth + 1));
  }
  if (fields !== undefined) {
    const copy: { [key: string]: Loose } = Object.create(null) as { [key: string]: Loose };
    for (const key of Object.keys(fields)) {
      copy[key] = looseCopy(fields[key], depth + 1);
    }
    return copy;
  }
  return NOT_PLAIN;
}

/** Every text in a loose copy, the names of its keys among them. */
function textsIn(value: Loose, found: string[]): void {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      textsIn(item, found);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      found.push(key);
      textsIn(value[key] as Loose, found);
    }
  }
}

/** Plain data, frozen, from a loose copy; undefined if anything in it is not plain data. */
function plainFrom(value: Loose): Plain | undefined {
  if (value === NOT_PLAIN) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const items: Plain[] = [];
    for (const item of value) {
      const inner = plainFrom(item);
      if (inner === undefined) {
        return undefined;
      }
      items.push(inner);
    }
    return Object.freeze(items);
  }
  // No prototype: a key such as `toString` is only what the model wrote.
  const copy: Record<string, Plain> = Object.create(null) as Record<string, Plain>;
  for (const key of Object.keys(value)) {
    if (REFUSED_KEYS.includes(key)) {
      return undefined;
    }
    const inner = plainFrom(value[key] as Loose);
    if (inner === undefined) {
      return undefined;
    }
    copy[key] = inner;
  }
  return Object.freeze(copy);
}

type Refusal = Exclude<InvalidOutputCode, "truncated">;

function read(
  value: unknown,
  allowed: { readonly claimKinds: readonly string[]; readonly tools: readonly string[] },
): OutputRead {
  const refused = (code: Refusal): OutputRead => ({ ok: false, code });

  // Shape: the four parts, each of its type, no other key at any level, no text that cannot be kept.
  const top = fieldsOf(value);
  if (top === undefined || !exactly(top, ["reply", "claims", "flags", "toolCalls"])) {
    return refused("shape");
  }
  const reply = top["reply"];
  const claimItems = itemsOf(top["claims"]);
  const flagItems = itemsOf(top["flags"]);
  const callItems = itemsOf(top["toolCalls"]);
  if (
    typeof reply !== "string" ||
    claimItems === undefined ||
    flagItems === undefined ||
    callItems === undefined
  ) {
    return refused("shape");
  }
  const texts: string[] = [reply];

  const claims: Claim[] = [];
  for (const item of claimItems) {
    const claim = fieldsOf(item);
    if (claim === undefined || !exactly(claim, ["kind", "item", "value"])) {
      return refused("shape");
    }
    const { kind, item: about, value: stated } = claim;
    if (typeof kind !== "string" || typeof about !== "string" || typeof stated !== "string") {
      return refused("shape");
    }
    texts.push(kind, about, stated);
    claims.push(Object.freeze({ kind, item: about, value: stated }));
  }

  const flags: string[] = [];
  for (const flag of flagItems) {
    if (typeof flag !== "string") {
      return refused("shape");
    }
    texts.push(flag);
    flags.push(flag);
  }

  const calls: { id: string; name: string; given: Loose }[] = [];
  for (const item of callItems) {
    const call = fieldsOf(item);
    if (call === undefined || !exactly(call, ["id", "name", "arguments"])) {
      return refused("shape");
    }
    const { id, name } = call;
    if (typeof id !== "string" || typeof name !== "string") {
      return refused("shape");
    }
    const given = looseCopy(call["arguments"], 1);
    texts.push(id, name);
    textsIn(given, texts);
    calls.push({ id, name, given });
  }
  if (!texts.every(keepable)) {
    return refused("shape");
  }

  // Flags: each one of the seven. A list of flags is a set: one written twice is that flag.
  const set: ModelFlag[] = [];
  for (const flag of flags) {
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
  for (const claim of claims) {
    if (
      !allowed.claimKinds.includes(claim.kind) ||
      length(claim.item) < 1 ||
      length(claim.item) > CLAIM_TEXT_MAX ||
      length(claim.value) < 1 ||
      length(claim.value) > CLAIM_TEXT_MAX
    ) {
      return refused("claim");
    }
  }

  // Tool calls. An answer asks for tools or it replies, not both.
  if (calls.length > TOOL_CALLS_PER_ROUND_MAX) {
    return refused("tool-call");
  }
  if (calls.length > 0 && (reply !== "" || claims.length > 0)) {
    return refused("tool-call");
  }
  const asked: ToolCall[] = [];
  for (const call of calls) {
    if (
      !allowed.tools.includes(call.name) ||
      length(call.id) < 1 ||
      length(call.id) > TOOL_CALL_ID_MAX ||
      asked.some((earlier) => earlier.id === call.id) ||
      typeof call.given !== "object" ||
      call.given === null ||
      Array.isArray(call.given)
    ) {
      return refused("tool-call");
    }
    const copy = plainFrom(call.given);
    if (copy === undefined || length(JSON.stringify(copy)) > TOOL_ARGUMENTS_MAX) {
      return refused("tool-call");
    }
    asked.push(
      Object.freeze({
        id: call.id,
        name: call.name,
        arguments: copy as { readonly [key: string]: Plain },
      }),
    );
  }

  return {
    ok: true,
    output: Object.freeze({
      reply,
      claims: Object.freeze(claims),
      flags: Object.freeze(set),
      toolCalls: Object.freeze(asked),
    }),
  };
}

/**
 * Checks an answer against the structure. `allowed` is what the request
 * offered: its claim kinds and the names of its tools. Where an answer has
 * more than one fault the code is the first of `shape`, `flag`, `claim`,
 * `tool-call`. It never throws: a value that cannot even be looked at (a
 * proxy that refuses) is a fault of shape.
 */
export function readOutput(
  value: unknown,
  allowed: { readonly claimKinds: readonly string[]; readonly tools: readonly string[] },
): OutputRead {
  try {
    return read(value, allowed);
  } catch {
    return { ok: false, code: "shape" };
  }
}
