// The isolation check must fail when isolation is weakened (issue #191: "a
// new table without a policy fails the test"). Each case makes one change as
// the migration role inside a transaction, runs the check, and rolls back.

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findIsolationProblems, MIGRATE_ROLE, UNSCOPED_TABLES } from "../src/index.ts";
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

  test("the list of unscoped tables is exactly the two this change needs", () => {
    expect(Object.keys(UNSCOPED_TABLES)).toEqual(["channel_routes", "schema_migrations"]);
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
      [
        "table all_contacts: has no tenant_id column that is NOT NULL",
        "table all_contacts: row-level security is not enabled",
        "table all_contacts: row-level security is not forced, so its owner bypasses it",
        "table all_contacts: has 0 policies for psa_app, expected exactly 1",
      ],
    ],
    [
      "an unscoped table that no longer exists",
      "DROP TABLE channel_routes",
      ["table channel_routes: is on the list of unscoped tables but does not exist"],
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
        "role psa_app: owns notes",
      ],
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
