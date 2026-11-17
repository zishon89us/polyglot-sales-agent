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
  /** Of the up step. A file changed after it was applied is refused. */
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
    entry[step] = readFileSync(join(directory, file), "utf8");
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
      checksum: createHash("sha256").update(entry.up).digest("hex"),
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

/** Fails if the database holds a migration the files do not, or one whose file has changed. */
function compare(rows: AppliedRow[], migrations: Migration[]): void {
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

async function locked<T>(client: pg.Client, work: () => Promise<T>): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK]);
  try {
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK]);
  }
}

async function inTransaction(client: pg.Client, work: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await work();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Applies every migration not yet applied, each in its own transaction. Returns their names. */
export function migrateUp(client: pg.Client, migrations: Migration[]): Promise<string[]> {
  return locked(client, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    const done: string[] = [];
    for (const migration of migrations.slice(rows.length)) {
      await inTransaction(client, async () => {
        await client.query(migration.up);
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
): Promise<string | undefined> {
  return locked(client, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    const last = migrations[rows.length - 1];
    if (last === undefined) {
      return undefined;
    }
    await inTransaction(client, async () => {
      await client.query(last.down);
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [last.version]);
    });
    return last.name;
  });
}

/** The names of applied and of pending migrations. Changes nothing but creates the record table. */
export function migrationStatus(
  client: pg.Client,
  migrations: Migration[],
): Promise<{ applied: string[]; pending: string[] }> {
  return locked(client, async () => {
    const rows = await applied(client);
    compare(rows, migrations);
    return {
      applied: migrations.slice(0, rows.length).map((migration) => migration.name),
      pending: migrations.slice(rows.length).map((migration) => migration.name),
    };
  });
}
