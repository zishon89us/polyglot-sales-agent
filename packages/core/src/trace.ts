// What a trace of one model call may hold, and what the call cost (M3
// unit U6; design note docs/design/notes/m3-u6-traces.md, sections 3 and
// 4). The patterns here are the ones the table checks: the client refuses
// before a call what the table would refuse after it.

/** A prompt's name: the name of its folder. */
export const PROMPT_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** The largest version a prompt may have. */
export const PROMPT_VERSION_MAX = 9_999;
/** How many prompts one request may be assembled from. */
export const PROMPTS_PER_REQUEST_MAX = 8;
/** A tool's name. */
export const TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
/** A model's name as a trace stores it. One that does not fit is stored as `TRACE_MODEL_OTHER`. */
export const TRACE_MODEL_NAME = /^[A-Za-z0-9._:/-]{1,200}$/;
export const TRACE_MODEL_OTHER = "other";

/** How a call ended. `fault` is this repository's code failing, not the provider. */
export const TRACE_OUTCOMES = [
  "ok",
  "invalid-output",
  "timeout",
  "provider-error",
  "fault",
] as const;
export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

/** How long storing a trace may take before the call counts as unrecorded. */
export const TRACE_WRITE_TIMEOUT_MS = 5_000;

/** The largest price: a thousand US dollars for a million tokens. */
export const MODEL_PRICE_MAX = 1_000_000_000;
/** A count over this is not costed: no model makes one, so it is a fault or a slip of units. */
export const COSTED_TOKENS_MAX = 1_000_000_000;
/** How many models the price setting may name. */
export const MODEL_PRICES_MAX = 100;

/** Millionths of a US dollar for a million tokens, in and out. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
}

export type ModelPrices = Readonly<Record<string, ModelPrice>>;

const price = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MODEL_PRICE_MAX;

const costed = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= COSTED_TOKENS_MAX;

/**
 * What a call cost, in millionths of a US dollar, rounded up; or null when
 * it cannot be said (a count that is not costed, a price that is not one).
 * An estimate from two counts and two prices. It is not the provider's bill.
 */
export function modelCostMicros(
  usage: { readonly inputTokens: number; readonly outputTokens: number },
  prices: ModelPrice,
): number | null {
  if (
    !costed(usage?.inputTokens) ||
    !costed(usage?.outputTokens) ||
    !price(prices?.input) ||
    !price(prices?.output)
  ) {
    return null;
  }
  const total =
    BigInt(usage.inputTokens) * BigInt(prices.input) +
    BigInt(usage.outputTokens) * BigInt(prices.output);
  // At most 2 x 10^12, by the two ceilings: a whole number JavaScript holds exactly.
  return Number((total + 999_999n) / 1_000_000n);
}

/**
 * Reads the price setting: JSON, an object of model names to
 * `{"input": n, "output": n}`. Absent, empty and `{}` mean no prices.
 * Anything else that is not exactly that is a problem, named without
 * repeating the setting's text.
 */
export function readModelPrices(
  text: string | undefined,
):
  | { readonly ok: true; readonly prices: ModelPrices }
  | { readonly ok: false; readonly problem: string } {
  if (text === undefined || text.trim() === "") {
    return { ok: true, prices: Object.freeze({}) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: "is not an object of model names to prices" };
  }
  const entries = Object.entries(parsed);
  if (entries.length > MODEL_PRICES_MAX) {
    return { ok: false, problem: `names more than ${MODEL_PRICES_MAX} models` };
  }
  const prices: Record<string, ModelPrice> = Object.create(null);
  for (const [name, value] of entries) {
    if (!TRACE_MODEL_NAME.test(name) || name === TRACE_MODEL_OTHER) {
      return { ok: false, problem: "has a name that is not a model's name" };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, problem: "has a model whose price is not an object" };
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== "input" || keys[1] !== "output") {
      return { ok: false, problem: "has a price that is not exactly an input and an output" };
    }
    const { input, output } = value as { input: unknown; output: unknown };
    if (!price(input) || !price(output)) {
      return {
        ok: false,
        problem: `has a price that is not a whole number from 0 to ${MODEL_PRICE_MAX}`,
      };
    }
    prices[name] = Object.freeze({ input, output });
  }
  return { ok: true, prices: Object.freeze(prices) };
}
