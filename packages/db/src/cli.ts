// Database commands for a person or a deploy step:
//   node packages/db/src/cli.ts bootstrap | up | down | status | check
// Connection strings and passwords come from the environment and are never
// printed.

import { fileURLToPath } from "node:url";
import pg from "pg";
import { ensureRoles, prepareDatabase } from "./bootstrap.ts";
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from "./migrate.ts";
import { findIsolationProblems } from "./policy-check.ts";
import { APP_ROLE, CROSS_ROLE, MIGRATE_ROLE } from "./roles.ts";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function connected<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const commands: Record<string, () => Promise<number>> = {
  async bootstrap() {
    const passwords = {
      [MIGRATE_ROLE]: env("PSA_DB_MIGRATE_PASSWORD"),
      [APP_ROLE]: env("PSA_DB_APP_PASSWORD"),
      [CROSS_ROLE]: env("PSA_DB_CROSS_PASSWORD"),
    };
    await connected(env("PSA_DB_ADMIN_URL"), async (admin) => {
      await ensureRoles(admin, passwords);
      await prepareDatabase(admin);
    });
    console.log("db: roles and database prepared");
    return 0;
  },
  async up() {
    const done = await connected(env("PSA_DB_MIGRATE_URL"), (client) =>
      migrateUp(client, loadMigrations(MIGRATIONS)),
    );
    console.log(done.length === 0 ? "db: nothing to apply" : `db: applied ${done.join(", ")}`);
    return 0;
  },
  async down() {
    const name = await connected(env("PSA_DB_MIGRATE_URL"), (client) =>
      migrateDown(client, loadMigrations(MIGRATIONS)),
    );
    console.log(name === undefined ? "db: nothing to reverse" : `db: reversed ${name}`);
    return 0;
  },
  async status() {
    const status = await connected(env("PSA_DB_MIGRATE_URL"), (client) =>
      migrationStatus(client, loadMigrations(MIGRATIONS)),
    );
    console.log(`db: applied: ${status.applied.join(", ") || "none"}`);
    console.log(`db: pending: ${status.pending.join(", ") || "none"}`);
    return 0;
  },
  async check() {
    const problems = await connected(env("PSA_DB_MIGRATE_URL"), findIsolationProblems);
    for (const problem of problems) {
      console.error(`db: ${problem}`);
    }
    console.log(problems.length === 0 ? "db: no isolation problem found" : "db: check failed");
    return problems.length === 0 ? 0 : 1;
  },
};

const command = commands[process.argv[2] ?? ""];
if (command === undefined) {
  console.error(`usage: cli.ts ${Object.keys(commands).join(" | ")}`);
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await command();
  } catch (error) {
    // The message only: a stack or the error object can carry connection details.
    console.error(`db: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
