// The isolation check must fail when isolation is weakened (issue #191: "a
// new table without a policy fails the test"). Each case makes one change as
// the migration role inside a transaction, runs the check, and rolls back.

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DEFINER_FUNCTIONS,
  findIsolationProblems,
  MIGRATE_ROLE,
  SPECIAL_TABLES,
  UNSCOPED_TABLES,
} from "../src/index.ts";
import { createTestDatabase, type TestDatabase } from "./harness.ts";

let database: TestDatabase;
let migrate: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  migrate = await database.client(MIGRATE_ROLE);
}, 30_000);
afterAll(() => database.drop());

async function problemsAfter(change: string, client: pg.Client = migrate): Promise<string[]> {
  await client.query("BEGIN");
  try {
    await client.query(change);
    return await findIsolationProblems(client);
  } finally {
    await client.query("ROLLBACK");
  }
}

const POLICY = "(tenant_id = app_tenant_id())";
const SCOPED = `CREATE TABLE notes (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants (id));
  ALTER TABLE notes ENABLE ROW LEVEL SECURITY; ALTER TABLE notes FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON notes FOR ALL TO psa_app USING ${POLICY} WITH CHECK ${POLICY};
  GRANT SELECT, INSERT ON notes TO psa_app;`;

describe("findIsolationProblems", () => {
  test("finds nothing in the migrated database", async () => {
    expect(await findIsolationProblems(migrate)).toEqual([]);
  });

  test("finds nothing when a table is added the right way", async () => {
    expect(await problemsAfter(SCOPED)).toEqual([]);
  });

  test("the two lists of exceptions hold exactly what this change needs", () => {
    expect(Object.keys(UNSCOPED_TABLES)).toEqual([
      "channel_routes",
      "schema_migrations",
      "worker_heartbeats",
    ]);
    expect(Object.keys(SPECIAL_TABLES)).toEqual(["jobs"]);
    expect(Object.keys(DEFINER_FUNCTIONS)).toEqual(["channel_routes_sync()"]);
  });

  test("finds nothing when the reader's search path leaves out the schema", async () => {
    expect(await problemsAfter("SET LOCAL search_path = pg_catalog")).toEqual([]);
  });

  test.each([
    [
      "a new table with no policy at all",
      "CREATE TABLE notes (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)",
      [
        "table notes: row-level security is not enabled",
        "table notes: row-level security is not forced, so its owner bypasses it",
        "table notes: has 0 policies for psa_app, expected exactly 1",
      ],
    ],
    [
      "a new table with no tenant column",
      "CREATE TABLE notes (id uuid PRIMARY KEY)",
      [
        "table notes: has no tenant_id column that is NOT NULL",
        "table notes: row-level security is not enabled",
        "table notes: row-level security is not forced, so its owner bypasses it",
        "table notes: has 0 policies for psa_app, expected exactly 1",
      ],
    ],
    [
      "a tenant column that may be null",
      `${SCOPED} ALTER TABLE notes ALTER COLUMN tenant_id DROP NOT NULL`,
      ["table notes: has no tenant_id column that is NOT NULL"],
    ],
    [
      "row-level security enabled but not forced",
      "ALTER TABLE messages NO FORCE ROW LEVEL SECURITY",
      ["table messages: row-level security is not forced, so its owner bypasses it"],
    ],
    [
      "row-level security disabled",
      "ALTER TABLE messages DISABLE ROW LEVEL SECURITY",
      ["table messages: row-level security is not enabled"],
    ],
    [
      "the policy dropped",
      "DROP POLICY tenant_isolation ON contacts",
      ["table contacts: has 0 policies for psa_app, expected exactly 1"],
    ],
    [
      "a second policy that admits every row",
      "CREATE POLICY wide ON contacts FOR SELECT TO psa_app USING (true)",
      [
        `table contacts: policy wide is not FOR ALL USING ${POLICY} WITH CHECK ${POLICY}`,
        "table contacts: has 2 policies for psa_app, expected exactly 1",
      ],
    ],
    [
      "a policy for everyone",
      "CREATE POLICY wide ON contacts USING (true)",
      ["table contacts: policy wide applies to public"],
    ],
    [
      "a policy for the application role together with another role",
      "CREATE POLICY wide ON contacts TO psa_app, psa_cross USING (true)",
      ["table contacts: policy wide applies to psa_app,psa_cross"],
    ],
    [
      "the policy without its write check",
      `DROP POLICY tenant_isolation ON contacts;
       CREATE POLICY tenant_isolation ON contacts FOR ALL TO psa_app USING ${POLICY} WITH CHECK (true)`,
      [
        `table contacts: policy tenant_isolation is not FOR ALL USING ${POLICY} WITH CHECK ${POLICY}`,
      ],
    ],
    [
      "the policy for reads only",
      `DROP POLICY tenant_isolation ON contacts;
       CREATE POLICY tenant_isolation ON contacts FOR SELECT TO psa_app USING ${POLICY}`,
      [
        `table contacts: policy tenant_isolation is not FOR ALL USING ${POLICY} WITH CHECK ${POLICY}`,
      ],
    ],
    [
      "the tenant function replaced by one that ignores the setting",
      "CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE RETURN NULL::uuid",
      ["function app_tenant_id: does not return the transaction's tenant setting"],
    ],
    [
      "the tenant function marked immutable",
      "ALTER FUNCTION app_tenant_id() IMMUTABLE",
      [
        // An immutable function is evaluated once, before the setting is made.
        "function app_tenant_id: does not return the transaction's tenant setting",
        "function app_tenant_id: is not STABLE",
      ],
    ],
    [
      "TRUNCATE granted to the application role",
      "GRANT TRUNCATE ON messages TO psa_app",
      ["table messages: psa_app may TRUNCATE it, which ignores row-level security"],
    ],
    [
      "the routing table opened to the application role",
      "GRANT SELECT ON channel_routes TO psa_app",
      ["table channel_routes: has no tenant policy, yet psa_app has a privilege on it"],
    ],
    [
      "a table opened to everyone",
      "GRANT SELECT ON contacts TO PUBLIC",
      ["table contacts: PUBLIC has a privilege on it"],
    ],
    [
      "a view, which reads with its owner's rights",
      "CREATE VIEW all_contacts AS SELECT * FROM contacts",
      ["view all_contacts: views and foreign tables are not covered by these checks"],
    ],
    [
      "single columns of the routing table opened to the application role",
      "GRANT SELECT (receiving_number_id, tenant_id) ON channel_routes TO psa_app",
      ["table channel_routes: has no tenant policy, yet psa_app has a privilege on it"],
    ],
    [
      "a function that runs with its owner's rights",
      `CREATE FUNCTION all_routes() RETURNS SETOF channel_routes LANGUAGE sql SECURITY DEFINER
         AS 'SELECT * FROM channel_routes'`,
      [
        "function all_routes(): runs with its owner's rights and is not on the list of such functions",
      ],
    ],
    [
      "a second function with a listed name, run with its owner's rights",
      `CREATE FUNCTION channel_routes_sync(integer) RETURNS SETOF channel_routes LANGUAGE sql
         SECURITY DEFINER AS 'SELECT * FROM channel_routes'`,
      [
        "function channel_routes_sync(integer): runs with its owner's rights and is not on the list of such functions",
      ],
    ],
    [
      "a function everyone may execute",
      "GRANT EXECUTE ON FUNCTION app_tenant_id() TO PUBLIC",
      ["function app_tenant_id: PUBLIC may execute it"],
    ],
    [
      "default privileges that would open new tables to the application role",
      "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO psa_app",
      ["default privileges: new objects would be granted to psa_app"],
    ],
    [
      "an unscoped table that no longer exists",
      "DROP TABLE channel_routes",
      ["table channel_routes: is on a list of exceptions but does not exist"],
    ],
    [
      "the whole jobs table readable by the application role",
      "GRANT SELECT ON jobs TO psa_app",
      [
        "table jobs: psa_app may read (attempts, created_at, id, last_error, locked_until, payload, run_at, state, subject_id, tenant_id, type), expected (id, state, subject_id, tenant_id, type)",
      ],
    ],
    [
      "a job's payload readable by the application role",
      "GRANT SELECT (payload) ON jobs TO psa_app",
      [
        "table jobs: psa_app may read (id, payload, state, subject_id, tenant_id, type), expected (id, state, subject_id, tenant_id, type)",
      ],
    ],
    [
      "a job's state settable by the application role",
      "GRANT INSERT (state) ON jobs TO psa_app",
      [
        "table jobs: psa_app may set (payload, run_at, state, subject_id, tenant_id, type), expected (payload, run_at, subject_id, tenant_id, type)",
      ],
    ],
    [
      "a job's due time changeable by the application role",
      "GRANT UPDATE (run_at) ON jobs TO psa_app",
      ["table jobs: psa_app may change (run_at), expected nothing"],
    ],
    [
      "jobs changeable by the application role",
      "GRANT UPDATE ON jobs TO psa_app",
      [
        "table jobs: psa_app may change (attempts, created_at, id, last_error, locked_until, payload, run_at, state, subject_id, tenant_id, type), expected nothing",
      ],
    ],
    [
      "the jobs table open to inserts for any tenant",
      "DROP POLICY tenant_insert ON jobs; CREATE POLICY tenant_insert ON jobs FOR INSERT TO psa_app WITH CHECK (true)",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "jobs dated into the past allowed to the application role",
      "DROP POLICY tenant_insert ON jobs; CREATE POLICY tenant_insert ON jobs FOR INSERT TO psa_app WITH CHECK (tenant_id = app_tenant_id() AND type <> 'operator-alert')",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "the alert type open to the application role",
      "DROP POLICY tenant_insert ON jobs; CREATE POLICY tenant_insert ON jobs FOR INSERT TO psa_app WITH CHECK (tenant_id = app_tenant_id())",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "every tenant's jobs visible to the application role",
      "DROP POLICY tenant_select ON jobs; CREATE POLICY tenant_select ON jobs FOR SELECT TO psa_app USING (true)",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "running jobs removable by the application role",
      "DROP POLICY tenant_cancel ON jobs; CREATE POLICY tenant_cancel ON jobs FOR DELETE TO psa_app USING (tenant_id = app_tenant_id())",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "one more policy on the jobs table",
      "CREATE POLICY more ON jobs FOR UPDATE TO psa_app USING (true)",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "a restrictive policy in place of a plain one on the jobs table",
      "DROP POLICY tenant_select ON jobs; CREATE POLICY tenant_select ON jobs AS RESTRICTIVE FOR SELECT TO psa_app USING (tenant_id = app_tenant_id())",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "a policy for everyone on the jobs table",
      "CREATE POLICY wide ON jobs FOR SELECT USING (true)",
      [
        "table jobs: its policies besides psa_cross's must be exactly: INSERT USING null WITH CHECK ((tenant_id = app_tenant_id()) AND (type <> 'operator-alert'::text) AND (run_at >= (now() - '00:01:00'::interval))); SELECT USING (tenant_id = app_tenant_id()) WITH CHECK null; DELETE USING ((tenant_id = app_tenant_id()) AND (state = 'queued'::text)) WITH CHECK null",
      ],
    ],
    [
      "row-level security not forced on the jobs table",
      "ALTER TABLE jobs NO FORCE ROW LEVEL SECURITY",
      ["table jobs: row-level security is not enabled and forced"],
    ],
    [
      "row-level security disabled on the jobs table",
      "ALTER TABLE jobs DISABLE ROW LEVEL SECURITY",
      ["table jobs: row-level security is not enabled and forced"],
    ],
    [
      "the jobs table dropped",
      "DROP TABLE jobs",
      ["table jobs: is on a list of exceptions but does not exist"],
    ],
    [
      "the application role allowed to create tables",
      "GRANT CREATE ON SCHEMA public TO psa_app",
      ["role psa_app: may create objects in schema public"],
    ],
  ])("reports %s", async (_what, change, expected) => {
    expect(await problemsAfter(change)).toEqual(expected);
  });
});

describe("findIsolationProblems, changes only the server's administrator can make", () => {
  // Roles belong to the whole server and other test files use them at the
  // same time. Each change here is made in a transaction and rolled back,
  // so no other connection ever sees it.
  let administrator: pg.Client;
  beforeAll(async () => {
    administrator = await database.administrator();
  });

  test.each([
    [
      "a table in another schema",
      "CREATE SCHEMA side; CREATE TABLE side.notes (id uuid)",
      ["table notes: is in schema side, which these checks do not cover"],
    ],
    [
      "a table owned by the application role",
      `${SCOPED} ALTER TABLE notes OWNER TO psa_app`,
      [
        "table notes: psa_app may TRUNCATE it, which ignores row-level security",
        "table notes: is owned by psa_app, not psa_migrate",
      ],
    ],
    [
      "a function owned by the administrator",
      "CREATE FUNCTION public.side_door() RETURNS integer LANGUAGE sql RETURN 1",
      [
        "function side_door: PUBLIC may execute it",
        "function side_door: is owned by postgres, not psa_migrate",
      ],
    ],
    [
      "the application role allowed temporary tables",
      "DO $$ BEGIN EXECUTE format('GRANT TEMP ON DATABASE %I TO psa_app', current_database()); END $$",
      ["role psa_app: may create schemas or temporary tables in this database"],
    ],
    [
      "a tenant set for the application role by default",
      "ALTER ROLE psa_app SET app.tenant_id = '0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77'",
      [
        "role psa_app: has a setting of its own (app.tenant_id=0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77)",
      ],
    ],
    [
      "a tenant set by default for the whole database",
      `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET app.tenant_id = %L', current_database(),
         '0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77'); END $$`,
      ["settings: a default for all roles or for the database sets app.tenant_id"],
    ],
    [
      "row security switched off by default for every role",
      "ALTER ROLE ALL SET row_security = off",
      ["settings: a default for all roles or for the database sets row_security"],
    ],
    [
      "the application role allowed to create databases",
      "ALTER ROLE psa_app CREATEDB",
      ["role psa_app: has CREATEDB"],
    ],
    [
      "the application role allowed to bypass row-level security",
      "ALTER ROLE psa_app BYPASSRLS",
      ["role psa_app: has BYPASSRLS"],
    ],
    [
      "the cross-tenant role allowed to create roles",
      "ALTER ROLE psa_cross CREATEROLE",
      ["role psa_cross: has CREATEROLE"],
    ],
    [
      "the application role made a member of the cross-tenant role",
      "GRANT psa_cross TO psa_app",
      ["role psa_app: is a member of psa_cross"],
    ],
  ])("reports %s", async (_what, change, expected) => {
    expect(await problemsAfter(change, administrator)).toEqual(expected);
  });

  test("reports the application role made a superuser, with everything that follows from it", async () => {
    const problems = await problemsAfter("ALTER ROLE psa_app SUPERUSER", administrator);
    expect(problems).toContain("role psa_app: has SUPERUSER");
    expect(problems).toContain(
      "table messages: psa_app may TRUNCATE it, which ignores row-level security",
    );
  });

  test("finds nothing when run by the administrator on the unchanged database", async () => {
    expect(await findIsolationProblems(administrator)).toEqual([]);
  });
});
