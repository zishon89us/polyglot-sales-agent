// What the operator's commands do in the database (ADR 0011; M2 unit U9).
// Every function takes the cross-tenant role's handle. This module is
// reached only through the package's `./operator` entry, which only
// `apps/ops` may import: a test fails otherwise, so no route of the API
// can come to call it.

import { randomUUID } from "node:crypto";
import { errorCode } from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";

/** What is recorded of a command: identifiers and short settings, never a name, an address or a number. */
export type OperatorArguments = Readonly<Record<string, string>>;

export interface OperatorCommand {
  /** Such as `tenant create`. */
  readonly command: string;
  /** The name the operator gave with `--as`. A claim, not proof. */
  readonly operatorName: string;
  readonly arguments: OperatorArguments;
}

/** What a command's action hands back: its result, and the row it made or changed, if any. */
export interface ActionResult<T> {
  readonly value: T;
  readonly subjectId?: string;
}

/**
 * Runs an operator's command with its record: one row before the action,
 * committed on its own so that it stands even if the process then stops,
 * and one row after, with `ok` or a short code of what went wrong. If the
 * first row cannot be written the action does not run.
 *
 * The second row is written even when the action fails, and the action's
 * error is then thrown on. If the action was done and the second row
 * cannot be written, the result is still returned, since the work is done
 * and must not be done again, and `incomplete` is called: the record then
 * shows a command that started and never finished.
 */
export async function recorded<T>(
  cross: Database,
  command: OperatorCommand,
  action: () => Promise<ActionResult<T>>,
  incomplete: () => void = () => undefined,
): Promise<T> {
  const pool = poolOf(cross);
  const invocationId = randomUUID();
  await pool.query(
    `INSERT INTO operator_log (invocation_id, phase, command, operator_name, arguments)
     VALUES ($1, 'started', $2, $3, $4)`,
    [invocationId, command.command, command.operatorName, JSON.stringify(command.arguments)],
  );
  const finish = (outcome: string, subjectId: string | undefined) =>
    pool.query(
      `INSERT INTO operator_log (invocation_id, phase, command, operator_name, arguments, outcome, subject_id)
       VALUES ($1, 'finished', $2, $3, $4, $5, $6)`,
      [
        invocationId,
        command.command,
        command.operatorName,
        JSON.stringify(command.arguments),
        outcome,
        subjectId ?? null,
      ],
    );
  let result: ActionResult<T>;
  try {
    result = await action();
  } catch (error) {
    await finish(errorCode(error), undefined).catch(() => undefined);
    throw error;
  }
  await finish("ok", result.subjectId).catch(incomplete);
  return result.value;
}

export interface NewTenant {
  readonly name: string;
  readonly pack: string;
  readonly timeZone: string;
  readonly defaultLanguage: string;
}

/** Creates a tenant and returns its identifier. The owner's invitation is M4's (#201). */
export async function createTenant(cross: Database, tenant: NewTenant): Promise<string> {
  const made = await poolOf(cross).query<{ id: string }>(
    `INSERT INTO tenants (name, pack, time_zone, default_language)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.name, tenant.pack, tenant.timeZone, tenant.defaultLanguage],
  );
  const id = made.rows[0]?.id;
  if (id === undefined) {
    throw Object.assign(new Error("createTenant: no row was made"), { code: "not-created" });
  }
  return id;
}

/**
 * Connects a channel's receiving number to a tenant and returns the new
 * account's identifier. Creating a tenant and connecting its number are
 * the cross-tenant role's (migration 0001).
 *
 * Fails with the database's code if the tenant does not exist (23503) or
 * the number is already connected, to this tenant or another (23505).
 */
export async function connectChannel(
  cross: Database,
  account: { tenantId: string; channel: string; receivingNumberId: string },
): Promise<string> {
  const made = await poolOf(cross).query<{ id: string }>(
    `INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [account.tenantId, account.channel, account.receivingNumberId],
  );
  const id = made.rows[0]?.id;
  if (id === undefined) {
    throw Object.assign(new Error("connectChannel: no row was made"), { code: "not-created" });
  }
  return id;
}

export interface TenantSummary {
  readonly id: string;
  readonly name: string;
  readonly pack: string;
  readonly timeZone: string;
  readonly defaultLanguage: string;
  readonly createdAt: Date;
}

/** Every tenant, oldest first. Nothing of any customer. */
export async function listTenants(cross: Database): Promise<TenantSummary[]> {
  const found = await poolOf(cross).query<{
    id: string;
    name: string;
    pack: string;
    time_zone: string;
    default_language: string;
    created_at: Date;
  }>(
    `SELECT id, name, pack, time_zone, default_language, created_at
     FROM tenants ORDER BY created_at, id`,
  );
  return found.rows.map((row) => ({
    id: row.id,
    name: row.name,
    pack: row.pack,
    timeZone: row.time_zone,
    defaultLanguage: row.default_language,
    createdAt: row.created_at,
  }));
}

export interface DeadJob {
  readonly id: string;
  readonly type: string;
  readonly tenantId: string | null;
  /** How many times it was run before it was given up. */
  readonly attempts: number;
  /** A short code, never a message. */
  readonly lastError: string | null;
  readonly createdAt: Date;
}

/** The jobs that were given up, oldest first, up to a limit. A job holds identifiers only. */
export async function listDeadJobs(cross: Database, limit = 100): Promise<DeadJob[]> {
  const found = await poolOf(cross).query<{
    id: string;
    type: string;
    tenant_id: string | null;
    attempts: number;
    last_error: string | null;
    created_at: Date;
  }>(
    `SELECT id, type, tenant_id, attempts, last_error, created_at
     FROM jobs WHERE state = 'dead' ORDER BY created_at, id LIMIT $1`,
    [limit],
  );
  return found.rows.map((row) => ({
    id: row.id,
    type: row.type,
    tenantId: row.tenant_id,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
  }));
}

/**
 * Puts a dead job back in the queue, due now, with its count of runs at
 * nought so that it has its five retries again. Returns its type, or
 * undefined if there is no dead job with that identifier: one that is
 * queued or running is left alone.
 */
export async function retryDeadJob(cross: Database, jobId: string): Promise<string | undefined> {
  const retried = await poolOf(cross).query<{ type: string }>(
    `UPDATE jobs SET state = 'queued', attempts = 0, run_at = clock_timestamp(), last_error = NULL
     WHERE id = $1 AND state = 'dead' RETURNING type`,
    [jobId],
  );
  return retried.rows[0]?.type;
}

export interface LogRow {
  readonly at: Date;
  readonly invocationId: string;
  readonly phase: "started" | "finished";
  readonly command: string;
  readonly operatorName: string;
  readonly arguments: OperatorArguments;
  readonly outcome: string | null;
  readonly subjectId: string | null;
}

/** The newest rows of the operator's record, newest first. */
export async function readOperatorLog(cross: Database, limit = 50): Promise<LogRow[]> {
  const found = await poolOf(cross).query<{
    at: Date;
    invocation_id: string;
    phase: "started" | "finished";
    command: string;
    operator_name: string;
    arguments: OperatorArguments;
    outcome: string | null;
    subject_id: string | null;
  }>(
    `SELECT at, invocation_id, phase, command, operator_name, arguments, outcome, subject_id
     FROM operator_log ORDER BY at DESC, phase DESC LIMIT $1`,
    [limit],
  );
  return found.rows.map((row) => ({
    at: row.at,
    invocationId: row.invocation_id,
    phase: row.phase,
    command: row.command,
    operatorName: row.operator_name,
    arguments: row.arguments,
    outcome: row.outcome,
    subjectId: row.subject_id,
  }));
}
