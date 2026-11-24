// The record of each call to the model (US-C10; M3 unit U6; design note
// docs/design/notes/m3-u6-traces.md). A trace is inserted once, in a
// transaction of its own, and never changed.

import { type Database, poolOf } from "./connect.ts";
import { withTenant } from "./tenant.ts";

/**
 * One call, as it is stored. The same fields as the model client's record
 * of a call; it is written out here because this package does not depend
 * on that one. No field holds free text.
 */
export interface TraceToStore {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly turnStartedAt: Date;
  readonly startedAt: Date;
  readonly latencyMs: number;
  readonly prompts: readonly { readonly name: string; readonly version: number }[];
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costMicros: number | null;
  readonly priceInput: number | null;
  readonly priceOutput: number | null;
  readonly toolNames: readonly string[];
  readonly outcome: string;
  readonly outcomeCode: string | null;
}

/** Stores one trace and returns its identifier. Rejects if the table refuses it or cannot be reached. */
export async function storeTrace(app: Database, trace: TraceToStore): Promise<string> {
  return withTenant(poolOf(app), trace.tenantId, async (tx) => {
    const made = await tx.query<{ id: string }>(
      `INSERT INTO ai_traces (tenant_id, session_id, turn_id, turn_started_at, started_at,
                              latency_ms, prompt_names, prompt_versions, model, input_tokens,
                              output_tokens, cost_micros, price_input, price_output, tool_names,
                              outcome, outcome_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::integer[], $9, $10, $11, $12, $13, $14,
               $15::text[], $16, $17)
       RETURNING id`,
      [
        trace.tenantId,
        trace.sessionId,
        trace.turnId,
        trace.turnStartedAt,
        trace.startedAt,
        trace.latencyMs,
        trace.prompts.map((prompt) => prompt.name),
        trace.prompts.map((prompt) => prompt.version),
        trace.model,
        trace.inputTokens,
        trace.outputTokens,
        trace.costMicros,
        trace.priceInput,
        trace.priceOutput,
        [...trace.toolNames],
        trace.outcome,
        trace.outcomeCode,
      ],
    );
    return made.rows[0]?.id as string;
  });
}

/** What a session's model calls cost, with what that number leaves out. */
export interface SessionCost {
  /** How many calls the session has a trace of. */
  readonly calls: number;
  /** The sum of the costs that are known, in millionths of a US dollar. An estimate, not a bill. */
  readonly costMicros: number;
  /** How many of the calls have no cost: out of time, failed, or made with a model that had no price. */
  readonly uncosted: number;
}

/**
 * The one place a session's costs are summed, so that the sum is never
 * given without the count of calls it leaves out (design note, C15).
 */
export async function costOfSession(
  app: Database,
  tenantId: string,
  sessionId: string,
): Promise<SessionCost> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const found = await tx.query<{ calls: number; cost: string; uncosted: number }>(
      `SELECT count(*)::int AS calls,
              coalesce(sum(cost_micros), 0)::text AS cost,
              count(*) FILTER (WHERE cost_micros IS NULL)::int AS uncosted
       FROM ai_traces WHERE session_id = $1`,
      [sessionId],
    );
    const row = found.rows[0];
    const costMicros = Number(row?.cost);
    if (row === undefined || !Number.isSafeInteger(costMicros)) {
      throw Object.assign(
        new Error("costOfSession: the sum is not a whole number that can be held"),
        {
          code: "cost-out-of-range",
        },
      );
    }
    return { calls: row.calls, costMicros, uncosted: row.uncosted };
  });
}
