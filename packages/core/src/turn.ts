// The fixed values of one turn that are not limits on a single call to the
// model (M3 unit U7; design note docs/design/notes/m3-u7-turn.md, sections
// 4 and 6). The two history numbers are that note's own and unmeasured.

/** How long one run of a tool may take: its transaction holds the conversation's row. */
export const TOOL_RUN_TIMEOUT_MS = 5_000;
/** The longest result of a tool, as JSON, that is given back to the model. */
export const TOOL_RESULT_MAX = 4_000;
/** How many earlier messages of a session a request may hold. */
export const HISTORY_MESSAGES_MAX = 30;
/** How much text those messages may hold in all, in UTF-16 units. */
export const HISTORY_TEXT_MAX = 12_000;
/** How a run of a tool ended. */
export const TOOL_OUTCOMES = ["done", "refused", "failed"] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];
