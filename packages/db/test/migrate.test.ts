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
    [
      { "0001_a.up.sql": "CREATE TABLE t ();\nCOMMIT;", "0001_a.down.sql": "" },
      '"0001_a.up.sql" must not end or start a transaction itself',
    ],
    [
      { "0001_a.up.sql": "", "0001_a.down.sql": "  rollback ;" },
      '"0001_a.down.sql" must not end or start a transaction itself',
    ],
    [
      { "0001_a.up.sql": "SELECT 1; COMMIT;", "0001_a.down.sql": "" },
      '"0001_a.up.sql" must not end or start a transaction itself',
    ],
    [
      { "0001_a.up.sql": "CREATE TABLE t ();\nABORT;", "0001_a.down.sql": "" },
      '"0001_a.up.sql" must not end or start a transaction itself',
    ],
  ])("refuses a directory it cannot order: %j", (files, message) => {
    expect(() => loadMigrations(directory(files))).toThrow(message);
  });
  test("the checksum covers the down step as well as the up step", () => {
    const one = loadMigrations(
      directory({ "0001_a.up.sql": "SELECT 1", "0001_a.down.sql": "SELECT 2" }),
    );
    const two = loadMigrations(
      directory({ "0001_a.up.sql": "SELECT 1", "0001_a.down.sql": "SELECT 3" }),
    );
    const three = loadMigrations(
      directory({ "0001_a.up.sql": "SELECT 4", "0001_a.down.sql": "SELECT 2" }),
    );
    expect(new Set([one[0]?.checksum, two[0]?.checksum, three[0]?.checksum]).size).toBe(3);
  });
});

// These tests share one database and run in order: the first applies the
// project's migrations and the rest start from that state and return to it.
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

  test("each down step reverses its own up step, one migration at a time", async () => {
    // Going all the way down would hide a down step that leaves something
    // behind which an earlier down step happens to remove.
    const level: string[] = [];
    level[project.length] = await schemaFingerprint(client);
    for (let applied = project.length - 1; applied >= 0; applied -= 1) {
      await migrateDown(client, project);
      level[applied] = await schemaFingerprint(client);
    }
    for (let applied = 1; applied <= project.length; applied += 1) {
      await migrateUp(client, project.slice(0, applied));
      expect(await schemaFingerprint(client), `after applying ${applied}`).toBe(level[applied]);
      if (applied < project.length) {
        // Up one more and down again must come back to the same place.
        await migrateUp(client, project.slice(0, applied + 1));
        await migrateDown(client, project.slice(0, applied + 1));
        expect(await schemaFingerprint(client), `down from ${applied + 1}`).toBe(level[applied]);
      }
    }
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

  // The loader refuses COMMIT, ROLLBACK and ABORT but cannot refuse END,
  // which function bodies use. These are the runner's own guard.
  test.each([
    ["commits and goes on", "CREATE TABLE half_kept (id integer); END; SELECT 1;", ["half_kept"]],
    [
      "rolls back and goes on",
      "CREATE TABLE lost (id integer); END; BEGIN; CREATE TABLE half_kept (id integer); END; BEGIN; SELECT 1;",
      ["half_kept", "lost"],
    ],
  ])("a step that %s is reported and not recorded", async (_what, up, tables) => {
    const sneaky = { version: project.length + 1, name: "sneaky", up, down: "", checksum: "1" };
    await expect(migrateUp(client, [...project, sneaky])).rejects.toThrow(
      "the step ended its own transaction, so the database may hold part of it and it is not recorded",
    );
    expect(await migrationStatus(client, project)).toEqual({
      applied: project.map((migration) => migration.name),
      pending: [],
    });
    await client.query(`DROP TABLE ${tables.join(", ")}`);
  });

  test("a step that ends its transaction and then fails says both", async () => {
    const sneaky = {
      version: project.length + 1,
      name: "sneaky",
      up: "CREATE TABLE half_kept (id integer); END; SELECT 1 / 0;",
      down: "",
      checksum: "1",
    };
    await expect(migrateUp(client, [...project, sneaky])).rejects.toThrow(
      /the step ended its own transaction.*It then failed: division by zero/,
    );
    await client.query("DROP TABLE half_kept");
  });

  test("a record with a gap is refused, for status, up and down", async () => {
    await client.query("BEGIN");
    try {
      await client.query("UPDATE schema_migrations SET version = version + 100");
      const message = "the record has version 101 where 1 was expected";
      await expect(migrationStatus(client, project)).rejects.toThrow(message);
      await expect(migrateUp(client, project)).rejects.toThrow(message);
      await expect(migrateDown(client, project)).rejects.toThrow(message);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  test("two runners at once apply each migration once", async () => {
    const second = await database.client(MIGRATE_ROLE);
    for (const _ of project) {
      await migrateDown(client, project);
    }
    const results = await Promise.all([migrateUp(client, project), migrateUp(second, project)]);
    expect(results.flat().sort()).toEqual(project.map((migration) => migration.name).sort());
    expect(results.some((names) => names.length === 0)).toBe(true);
  });

  test("a runner gives up when another session keeps the lock, and works once it is released", async () => {
    const holder = await database.client(MIGRATE_ROLE);
    await holder.query("SELECT pg_advisory_lock(1623420815)");
    await expect(migrationStatus(client, project, { lockWaitMs: 300 })).rejects.toThrow(
      "another session holds the migration lock",
    );
    await holder.query("SELECT pg_advisory_unlock(1623420815)");
    expect((await migrationStatus(client, project)).pending).toEqual([]);
  });

  test("the lock is released when a run fails", async () => {
    await expect(migrateUp(client, [])).rejects.toThrow("has no file");
    const other = await database.client(MIGRATE_ROLE);
    expect((await migrationStatus(other, project, { lockWaitMs: 300 })).pending).toEqual([]);
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
