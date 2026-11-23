// The fixed values of one call to the model (glossary, "Fixed values";
// design note docs/design/notes/m3-u4-llm-client.md, section 4; issue
// #158; decisions row 44). They are not settings. Nothing here calls a
// model: these are numbers, kept where the glossary's other numbers are.

/** One call waits this long for an answer (US-C15, NFR-R4). */
export const MODEL_CALL_TIMEOUT_MS = 20_000;

/** A failed call is tried this many times in all (US-C15). The caller's, not the client's. */
export const MODEL_CALL_ATTEMPTS = 3;

/** The waits between those attempts (US-C15). */
export const MODEL_RETRY_WAITS_MS = [1_000, 4_000] as const;

/** A check of whether the provider can be reached waits this long. */
export const MODEL_HEALTH_TIMEOUT_MS = 5_000;

/**
 * The most output one call may produce, in the provider's tokens. It
 * assumes a code point costs at most three tokens, which nobody has
 * measured: where a script costs more, a long reply is cut short and the
 * call fails as `truncated`.
 */
export const MODEL_OUTPUT_TOKENS_MAX = 4_096;

/** No request may ask for a longer wait or more output than these, whatever its caller says. */
export const MODEL_CALL_TIMEOUT_CEILING_MS = 60_000;
export const MODEL_OUTPUT_TOKENS_CEILING = 8_192;

/** The longest reply that is sent, in code points (guardrail policy, O7). */
export const REPLY_MAX = 1_200;

/** How many times one reply may ask for tools before it must answer. */
export const TOOL_ROUNDS_MAX = 4;

/** How many tools one answer may ask for. */
export const TOOL_CALLS_PER_ROUND_MAX = 4;

/** A tool call's arguments, written as JSON, in code points; and how deep they may nest. */
export const TOOL_ARGUMENTS_MAX = 2_000;
export const TOOL_ARGUMENTS_DEPTH_MAX = 5;

/** How many claims one answer may make, and the length of a claim's item and of its value, in code points. */
export const CLAIMS_MAX = 30;
export const CLAIM_TEXT_MAX = 100;

/** A tool call's identifier, in code points. */
export const TOOL_CALL_ID_MAX = 100;

/**
 * The most of a batch's customer text one call is given, in code points
 * (guardrail policy, I3). Provisional until the channel's own limit on a
 * message is read (M3 unit U5).
 */
export const BATCH_TEXT_MAX = 8_000;

/** The longest prompt file, in code points. It is paid for on every call. */
export const PROMPT_FILE_MAX = 20_000;
