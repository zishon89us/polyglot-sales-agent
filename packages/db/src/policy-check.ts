// Reads the database's own catalogue and reports anything that would let a
// row be seen across tenants: a table without the tenant policy, a policy
// that admits too much, a privilege that goes around the policies, or a role
// with more power than it should have. An empty result means none was found
// by these checks; it does not prove isolation, which the tests attempt.

import type pg from "pg";
import { APP_ROLE, CROSS_ROLE, ROLES, UNSCOPED_TABLES } from "./roles.ts";

interface TableRow {
  schema: string;
  name: string;
  rls: boolean;
  forced: boolean;
  tenant_column_not_null: boolean | null;
  app_truncate: boolean;
  app_any: boolean;
}

interface PolicyRow {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

/** The column that holds the tenant: its own `id` for `tenants`, `tenant_id` elsewhere. */
export function tenantColumn(table: string): string {
  return table === "tenants" ? "id" : "tenant_id";
}

/** Every table that must be tenant-scoped: all tables of the public schema except the allow-list. */
export async function tenantOwnedTables(client: pg.ClientBase): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
  );
  return result.rows.map((row) => row.name).filter((name) => !(name in UNSCOPED_TABLES));
}

async function tableProblems(client: pg.ClientBase): Promise<string[]> {
  const tables = await client.query<TableRow>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls,
            c.relforcerowsecurity AS forced,
            (SELECT a.attnotnull FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
            ) AS tenant_column_not_null,
            has_table_privilege($1, c.oid, 'TRUNCATE') AS app_truncate,
            has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS app_any
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
     ORDER BY 1, 2`,
    [APP_ROLE],
  );
  const policies = await client.query<PolicyRow>(
    `SELECT tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
     FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
  );
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const table of tables.rows) {
    const where = `table ${table.name}`;
    if (table.schema !== "public") {
      problems.push(`${where}: is in schema ${table.schema}, which these checks do not cover`);
      continue;
    }
    seen.add(table.name);
    if (table.app_truncate) {
      problems.push(`${where}: ${APP_ROLE} may TRUNCATE it, which ignores row-level security`);
    }
    if (table.name in UNSCOPED_TABLES) {
      if (table.app_any) {
        problems.push(`${where}: has no tenant policy, yet ${APP_ROLE} has a privilege on it`);
      }
      continue;
    }
    if (table.name !== "tenants" && table.tenant_column_not_null !== true) {
      problems.push(`${where}: has no tenant_id column that is NOT NULL`);
    }
    if (!table.rls) {
      problems.push(`${where}: row-level security is not enabled`);
    }
    if (!table.forced) {
      problems.push(`${where}: row-level security is not forced, so its owner bypasses it`);
    }
    const expected = `(${tenantColumn(table.name)} = app_tenant_id())`;
    let appPolicies = 0;
    for (const policy of policies.rows.filter((row) => row.tablename === table.name)) {
      const roles = policy.roles.join(",");
      if (roles === CROSS_ROLE) {
        continue;
      }
      if (roles !== APP_ROLE) {
        problems.push(`${where}: policy ${policy.policyname} applies to ${roles}`);
        continue;
      }
      appPolicies += 1;
      if (
        policy.permissive !== "PERMISSIVE" ||
        policy.cmd !== "ALL" ||
        policy.qual !== expected ||
        policy.with_check !== expected
      ) {
        problems.push(
          `${where}: policy ${policy.policyname} is not FOR ALL USING ${expected} WITH CHECK ${expected}`,
        );
      }
    }
    if (appPolicies !== 1) {
      problems.push(`${where}: has ${appPolicies} policies for ${APP_ROLE}, expected exactly 1`);
    }
  }
  for (const name of Object.keys(UNSCOPED_TABLES)) {
    if (!seen.has(name)) {
      problems.push(`table ${name}: is on the list of unscoped tables but does not exist`);
    }
  }
  return problems;
}

async function roleProblems(client: pg.ClientBase): Promise<string[]> {
  const problems: string[] = [];
  const roles = await client.query<{ name: string; powers: string[] }>(
    `SELECT rolname AS name, array_remove(ARRAY[
       CASE WHEN rolsuper THEN 'SUPERUSER' END, CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
       CASE WHEN rolcreaterole THEN 'CREATEROLE' END, CASE WHEN rolcreatedb THEN 'CREATEDB' END,
       CASE WHEN rolreplication THEN 'REPLICATION' END], NULL) AS powers
     FROM pg_roles WHERE rolname = ANY($1) ORDER BY 1`,
    [[...ROLES]],
  );
  for (const role of ROLES) {
    const row = roles.rows.find((candidate) => candidate.name === role);
    if (row === undefined) {
      problems.push(`role ${role}: does not exist`);
    } else if (row.powers.length > 0) {
      problems.push(`role ${role}: has ${row.powers.join(", ")}`);
    }
  }
  const members = await client.query<{ member: string; of: string }>(
    `SELECT m.rolname AS member, r.rolname AS of FROM pg_auth_members a
     JOIN pg_roles m ON m.oid = a.member JOIN pg_roles r ON r.oid = a.roleid
     WHERE m.rolname = ANY($1) ORDER BY 1, 2`,
    [[...ROLES]],
  );
  for (const row of members.rows) {
    problems.push(`role ${row.member}: is a member of ${row.of}`);
  }
  const rest = await client.query<{ problem: string }>(
    `SELECT 'role ' || r.rolname || ': may create objects in schema public' AS problem
       FROM pg_roles r WHERE r.rolname = ANY($1) AND has_schema_privilege(r.oid, 'public', 'CREATE')
     UNION ALL
     SELECT 'role ' || r.rolname || ': owns ' || c.relname
       FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE r.rolname = ANY($1) AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     UNION ALL
     SELECT 'role ' || r.rolname || ': owns function ' || p.proname
       FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = ANY($1)
     UNION ALL
     SELECT DISTINCT 'table ' || table_name || ': PUBLIC has a privilege on it'
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee = 'PUBLIC'
     ORDER BY 1`,
    [[APP_ROLE, CROSS_ROLE]],
  );
  problems.push(...rest.rows.map((row) => row.problem));
  return problems;
}

/**
 * The policies rest on this function, so it is checked by what it returns.
 * The setting is made for one statement only, so this needs no transaction
 * of its own and can run inside the caller's.
 */
async function functionProblems(client: pg.ClientBase): Promise<string[]> {
  const probe = "0b7e3c1a-5d2f-4e8a-9c41-6f0a2d9b8e77";
  const exists = await client.query("SELECT to_regprocedure('public.app_tenant_id()') AS oid");
  if (exists.rows[0]?.oid === null) {
    return ["function app_tenant_id: does not exist"];
  }
  const result = await client.query<{ set: string | null; empty: string | null; kind: string }>(
    `SELECT (SELECT public.app_tenant_id() FROM set_config('app.tenant_id', $1, true)) AS set,
            (SELECT public.app_tenant_id() FROM set_config('app.tenant_id', '', true)) AS empty,
            (SELECT provolatile::text FROM pg_proc
              WHERE oid = 'public.app_tenant_id()'::regprocedure) AS kind`,
    [probe],
  );
  const row = result.rows[0];
  const problems: string[] = [];
  if (row?.set !== probe || row.empty !== null) {
    problems.push("function app_tenant_id: does not return the transaction's tenant setting");
  }
  if (row?.kind !== "s") {
    problems.push("function app_tenant_id: is not STABLE");
  }
  return problems;
}

/** Every problem found. Run as the migration role, after migrating. */
export async function findIsolationProblems(client: pg.ClientBase): Promise<string[]> {
  return [
    ...(await tableProblems(client)),
    ...(await roleProblems(client)),
    ...(await functionProblems(client)),
  ];
}
