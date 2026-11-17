// The migration runner. Migrations are plain SQL files, one pair per
// version: `0001_name.up.sql` and `0001_name.down.sql` (ADR 0003, NFR-O4).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  /**
   * Of both steps. A file changed after it was applied is refused, for up
   * and for down. To reverse a migration whose file was changed, restore the
   * file as it was applied; the record holds no copy of it.
   */
  readonly checksum: string;
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

/** Reads a directory of migrations. Throws on anything it cannot order with certainty. */
export function loadMigrations(directory: string): Migration[] {
  const parts = new Map<number, { name: string; up?: string; down?: string }>();
  for (const file of readdirSync(directory).sort()) {
    const match = FILE.exec(file);
    if (match === null) {
      throw new Error(`migrations: "${file}" is not named NNNN_name.up.sql or NNNN_name.down.sql`);
    }
    const version = Number(match[1]);
    const name = match[2] as string;
    const step = match[3] as "up" | "down";
    const entry = parts.get(version) ?? { name };
    if (entry.name !== name) {
      throw new Error(
        `migrations: version ${match[1]} has two names, "${entry.name}" and "${name}"`,
      );
    }
    const text = readFileSync(join(directory, file), "utf8");
    // Each step runs in a transaction the runner opens and commits.
    // END is not refused: function bodies use it. The runner's own guard catches it.
    if (
      /(^|;)\s*(COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/im.test(text)
    ) {
      throw new Error(`migrations: "${file}" must not end or start a transaction itself`);
    }
    entry[step] = text;
    parts.set(version, entry);
  }
  const versions = [...parts.keys()].sort((a, b) => a - b);
  return versions.map((version, index) => {
    const entry = parts.get(version) as { name: string; up?: string; down?: string };
    if (version !== index + 1) {
      throw new Error(`migrations: expected version ${index + 1}, found ${version}`);
    }
    if (entry.up === undefined || entry.down === undefined) {
      throw new Error(`migrations: version ${version} needs both an up and a down file`);
    }
    return {
      version,
      name: entry.name,
      up: entry.up,
      down: entry.down,
      checksum: createHash("sha256")
        .update(entry.up)
        .update("\n-- down --\n")
        .update(entry.down)
        .digest("hex"),
    };
  });
}

// Any constant; two runners on one database must not interleave.
const MIGRATE_LOCK = 1_623_420_815;

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

async function applied(client: pg.Client): Promise<AppliedRow[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const result = await client.query<AppliedRow>(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  );
  return result.rows;
}

/**
 * Fails if the record is not versions 1 to n with no gap, if it holds a
 * migration the files do not, or one whose file has changed.
 */
function compare(rows: AppliedRow[], migrations: Migration[]): void {
  rows.forEach((row, index) => {
    if (row.version !== index + 1) {
      throw new Error(
        `migrations: the record has version ${row.version} where ${index + 1} was expected`,
      );
    }
  });
  for (const row of rows) {
    const file = migrations.find((migration) => migration.version === row.version);
    if (file === undefined) {
      throw new Error(`migrations: version ${row.version} is applied but has no file`);
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `migrations: version ${row.version} (${row.name}) was changed after it was applied`,
      );
    }
  }
}

export interface RunnerOptions {
  /** How long to wait for another runner to finish. Default 30 seconds. */
  readonly lockWaitMs?: number;
}

async function locked<T>(
  client: pg.Client,
  options: RunnerOptions,
  work: () => Promise<T>,
): Promise<T> {
  // Any role that can connect can take this lock, so do not wait for ever.
  const deadline = Date.now() + (options.lockWaitMs ?? 30_000);
  for (;;) {
    const got = await client.query<{ got: boolean }>("SELECT pg_try_advisory_lock($1) AS got", [
      MIGRATE_LOCK,
    ]);
    if (got.rows[0]?.got === true) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error("migrations: another session holds the migration lock");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK]);
  }
}

/** The current transaction, or undefined when it has failed and nothing more can run in it. */
async function transactionId(client: pg.Client): Promise<string | undefined> {
  try {
    const result = await client.query<{ id: string }>("SELECT pg_current_xact_id()::text AS id");
    return result.rows[0]?.id;
  } catch {
    return undefined;
  }
}

const ESCAPED =
  "the step ended its own transaction, so the database may hold part of it and it is not recorded";

/**
 * Runs one step and then its record in a single transaction. If the step's
 * SQL ended that transaction, nothing is recorded and the error says so,
 * whether or not the step also failed.
 */
async function inTransaction(
  client: pg.Client,
  step: string,
  record: () => Promise<void>,
): Promise<void> {
  await client.query("BEGIN");
  const id = await transactionId(client);
  try {
    await client.query(step);
    if ((await transactionId(client)) !== id) {
      throw new Error(`migrations: ${ESCAPED}`);
    }
    await record();
    await client.query("COMMIT");
  } catch (error) {
    // A failed transaction answers nothing (undefined): it is still the one we opened.
    const now = await transactionId(client);
    await client.query("ROLLBACK");
    if (
      now !== undefined &&
      now !== id &&
      !(error instanceof Error && error.message.includes(ESCAPED))
    ) {
      throw new Error(
        `migrations: ${ESCAPED}. It then failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

/** Applies every migration not yet applied, each in its own transaction. Returns their names. */
export function migrateUp(
  client: pg.Client,
  migrations: Migration[],
  options: RunnerOptions = {},
): Promise<string[]> {
  return locked(client, options, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    const done: string[] = [];
    for (const migration of migrations.slice(rows.length)) {
      await inTransaction(client, migration.up, async () => {
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum],
        );
      });
      done.push(migration.name);
    }
    return done;
  });
}

/** Reverses the most recent migration. Returns its name, or undefined if none is applied. */
export function migrateDown(
  client: pg.Client,
  migrations: Migration[],
  options: RunnerOptions = {},
): Promise<string | undefined> {
  return locked(client, options, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    const last = migrations[rows.length - 1];
    if (last === undefined) {
      return undefined;
    }
    await inTransaction(client, last.down, async () => {
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [last.version]);
    });
    return last.name;
  });
}

/** The names of applied and of pending migrations. Changes nothing but creates the record table. */
export function migrationStatus(
  client: pg.Client,
  migrations: Migration[],
  options: RunnerOptions = {},
): Promise<{ applied: string[]; pending: string[] }> {
  return locked(client, options, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    return {
      applied: migrations.slice(0, rows.length).map((migration) => migration.name),
      pending: migrations.slice(rows.length).map((migration) => migration.name),
    };
  });
}
