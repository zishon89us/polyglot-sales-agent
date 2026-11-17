import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  loadMigrations,
  MIGRATE_ROLE,
  migrateDown,
  migrateUp,
  migrationStatus,
} from "../src/index.ts";
import {
  createTestDatabase,
  MIGRATIONS_DIRECTORY,
  schemaFingerprint,
  type TestDatabase,
} from "./harness.ts";

const scratch: string[] = [];

/** A directory holding the given files, removed after the test. */
function directory(files: Record<string, string>): string {
  const path = mkdtempSync(join(tmpdir(), "psa-migrations-"));
  scratch.push(path);
  mkdirSync(path, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(path, name), text);
  }
  return path;
}

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("loadMigrations", () => {
  test("reads the project's migrations in order, each with an up and a down step", () => {
    const migrations = loadMigrations(MIGRATIONS_DIRECTORY);
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.version)).toEqual(
      migrations.map((_, index) => index + 1),
    );
  });

  test.each([
    [{ "0001_a.up.sql": "SELECT 1" }, "version 1 needs both an up and a down file"],
    [{ "0001_a.down.sql": "SELECT 1" }, "version 1 needs both an up and a down file"],
    [{ "0002_a.up.sql": "", "0002_a.down.sql": "" }, "expected version 1, found 2"],
    [
      { "0001_a.up.sql": "", "0001_a.down.sql": "", "0003_c.up.sql": "", "0003_c.down.sql": "" },
      "expected version 2, found 3",
    ],
    [{ "0001_a.up.sql": "", "0001_b.down.sql": "" }, 'version 0001 has two names, "a" and "b"'],
    [{ "0001_a.up.sql": "", "0001_a.down.sql": "", "notes.txt": "" }, '"notes.txt" is not named'],
    [{ "1_a.up.sql": "", "1_a.down.sql": "" }, '"1_a.down.sql" is not named'],
  ])("refuses a directory it cannot order: %j", (files, message) => {
    expect(() => loadMigrations(directory(files))).toThrow(message);
  });
});

describe("the migration runner, against PostgreSQL", () => {
  let database: TestDatabase;
  let client: pg.Client;
  const project = loadMigrations(MIGRATIONS_DIRECTORY);

  beforeAll(async () => {
    database = await createTestDatabase({ migrate: false });
    client = await database.client(MIGRATE_ROLE);
  }, 30_000);
  afterAll(() => database.drop());

  test("applies everything once, and a second run applies nothing", async () => {
    expect(await migrateUp(client, project)).toEqual(project.map((migration) => migration.name));
    expect(await migrateUp(client, project)).toEqual([]);
    expect(await migrationStatus(client, project)).toEqual({
      applied: project.map((migration) => migration.name),
      pending: [],
    });
  });

  test("every down step reverses its up step: down to nothing, then up, gives the same schema", async () => {
    const before = await schemaFingerprint(client);
    for (const migration of [...project].reverse()) {
      expect(await migrateDown(client, project)).toBe(migration.name);
    }
    expect(await migrateDown(client, project)).toBeUndefined();
    const empty = await client.query(
      `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
         AND relkind IN ('r', 'v', 'S') AND relname <> 'schema_migrations'
       UNION ALL SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`,
    );
    expect(empty.rows).toEqual([]);
    await migrateUp(client, project);
    expect(await schemaFingerprint(client)).toBe(before);
  });

  test("a migration that fails part-way leaves nothing behind and is not recorded", async () => {
    const next = String(project.length + 1).padStart(4, "0");
    const files: Record<string, string> = {
      [`${next}_broken.up.sql`]: "CREATE TABLE half_made (id integer); SELECT 1 / 0;",
      [`${next}_broken.down.sql`]: "DROP TABLE half_made;",
    };
    const broken = [...project, ...loadMigrations(withProject(files)).slice(project.length)];
    await expect(migrateUp(client, broken)).rejects.toThrow("division by zero");
    const table = await client.query("SELECT to_regclass('public.half_made') AS oid");
    expect(table.rows[0]?.oid).toBeNull();
    expect((await migrationStatus(client, project)).pending).toEqual([]);
  });

  test("a file changed after it was applied is refused", async () => {
    const first = project[0] as (typeof project)[number];
    const changed = [{ ...first, checksum: "0".repeat(64) }, ...project.slice(1)];
    const message = `version 1 (${first.name}) was changed after it was applied`;
    await expect(migrateUp(client, changed)).rejects.toThrow(message);
    await expect(migrateDown(client, changed)).rejects.toThrow(message);
  });

  test("an applied migration with no file is refused", async () => {
    await expect(migrateUp(client, [])).rejects.toThrow("version 1 is applied but has no file");
  });

  /** A copy of the project's migration files plus extra ones. */
  function withProject(extra: Record<string, string>): string {
    const files: Record<string, string> = { ...extra };
    for (const migration of project) {
      const stem = `${String(migration.version).padStart(4, "0")}_${migration.name}`;
      files[`${stem}.up.sql`] = migration.up;
      files[`${stem}.down.sql`] = migration.down;
    }
    return directory(files);
  }
});
