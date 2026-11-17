// Reads the database's own catalogue and reports what it knows would let a
// row be seen across tenants: a table without the tenant policy or a policy
// that admits more; a view; the application role able to truncate, or to
// reach an unscoped table; a role with a power, a membership or a setting
// it should not have; an object not owned by the migration role; a function
// that runs with its owner's rights or that PUBLIC may execute; default
// privileges for the wrong roles.
//
// It does not judge which table privileges each role holds (a test compares
// those with a fixed list), and an empty result does not prove isolation.

import type pg from "pg";
import {
  APP_INSERT_ONLY_TABLES,
  APP_ROLE,
  CROSS_ROLE,
  DEFINER_FUNCTIONS,
  MIGRATE_ROLE,
  ROLES,
  UNSCOPED_TABLES,
} from "./roles.ts";

interface TableRow {
  schema: string;
  name: string;
  kind: string;
  rls: boolean;
  forced: boolean;
  tenant_column_not_null: boolean | null;
  app_truncate: boolean;
  app_any: boolean;
  app_beyond_insert: boolean;
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

/** Every table that must be tenant-scoped: all tables of the public schema except the two lists. */
export async function tenantOwnedTables(client: pg.ClientBase): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
  );
  return result.rows
    .map((row) => row.name)
    .filter((name) => !(name in UNSCOPED_TABLES) && !(name in APP_INSERT_ONLY_TABLES));
}

async function tableProblems(client: pg.ClientBase): Promise<string[]> {
  const tables = await client.query<TableRow>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
            c.relrowsecurity AS rls,
            c.relforcerowsecurity AS forced,
            (SELECT a.attnotnull FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
            ) AS tenant_column_not_null,
            has_table_privilege($1, c.oid, 'TRUNCATE') AS app_truncate,
            (has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
              OR has_any_column_privilege($1, c.oid, 'SELECT, INSERT, UPDATE')) AS app_any,
            (has_table_privilege($1, c.oid, 'SELECT, UPDATE, DELETE')
              OR has_any_column_privilege($1, c.oid, 'SELECT, UPDATE')) AS app_beyond_insert
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
  // The catalogue writes the function with its schema when the reader's
  // search path does not include it.
  const plain = (text: string | null): string | null =>
    text === null ? null : text.replaceAll("public.app_tenant_id()", "app_tenant_id()");
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const table of tables.rows) {
    const where = `table ${table.name}`;
    if (table.schema !== "public") {
      problems.push(`${where}: is in schema ${table.schema}, which these checks do not cover`);
      continue;
    }
    seen.add(table.name);
    if (table.kind !== "r" && table.kind !== "p") {
      // A view reads with its owner's rights unless told otherwise; none is needed yet.
      problems.push(`view ${table.name}: views and foreign tables are not covered by these checks`);
      continue;
    }
    if (table.app_truncate) {
      problems.push(`${where}: ${APP_ROLE} may TRUNCATE it, which ignores row-level security`);
    }
    if (table.name in UNSCOPED_TABLES) {
      if (table.app_any) {
        problems.push(`${where}: has no tenant policy, yet ${APP_ROLE} has a privilege on it`);
      }
      continue;
    }
    const policiesOf = policies.rows.filter((row) => row.tablename === table.name);
    if (table.name in APP_INSERT_ONLY_TABLES) {
      const check = "(tenant_id = app_tenant_id())";
      const forApp = policiesOf.filter((row) => row.roles.join(",") !== CROSS_ROLE);
      const only = forApp[0];
      if (!table.rls || !table.forced) {
        problems.push(`${where}: row-level security is not enabled and forced`);
      }
      if (table.app_beyond_insert) {
        problems.push(`${where}: ${APP_ROLE} may do more than add rows to it`);
      }
      if (
        forApp.length !== 1 ||
        only === undefined ||
        only.roles.join(",") !== APP_ROLE ||
        only.permissive !== "PERMISSIVE" ||
        only.cmd !== "INSERT" ||
        plain(only.with_check) !== check
      ) {
        problems.push(
          `${where}: must have exactly one policy besides ${CROSS_ROLE}'s: FOR INSERT TO ${APP_ROLE} WITH CHECK ${check}`,
        );
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
    for (const policy of policiesOf) {
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
        plain(policy.qual) !== expected ||
        plain(policy.with_check) !== expected
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
  for (const name of [...Object.keys(UNSCOPED_TABLES), ...Object.keys(APP_INSERT_ONLY_TABLES)]) {
    if (!seen.has(name)) {
      problems.push(`table ${name}: is on a list of exceptions but does not exist`);
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
     SELECT 'role ' || r.rolname || ': may create schemas or temporary tables in this database'
       FROM pg_roles r WHERE r.rolname = ANY($1)
         AND has_database_privilege(r.oid, current_database(), 'CREATE, TEMP')
     UNION ALL
     SELECT 'role ' || r.rolname || ': has a setting of its own (' || array_to_string(s.setconfig, ', ') || ')'
       FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = ANY($2)
     UNION ALL
     -- A default for every role, or for this database, that the policies or the roles rest on.
     SELECT 'settings: a default for all roles or for the database sets ' || split_part(c, '=', 1)
       FROM pg_db_role_setting s, unnest(s.setconfig) c
       WHERE s.setrole = 0
         AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
         AND split_part(c, '=', 1) IN ('app.tenant_id', 'row_security', 'role', 'session_authorization')
     UNION ALL
     SELECT 'table ' || c.relname || ': is owned by ' || pg_get_userbyid(c.relowner) || ', not ' || $3
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         AND pg_get_userbyid(c.relowner) <> $3
     UNION ALL
     SELECT 'function ' || p.proname || ': is owned by ' || pg_get_userbyid(p.proowner) || ', not ' || $3
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND pg_get_userbyid(p.proowner) <> $3
     UNION ALL
     SELECT 'function ' || p.oid::regprocedure::text || ': runs with its owner''s rights and is not on the list of such functions'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND p.prosecdef
         AND NOT (n.nspname = 'public' AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = ANY($4))
     UNION ALL
     SELECT 'function ' || p.proname || ': PUBLIC may execute it'
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND has_function_privilege('public', p.oid, 'EXECUTE')
     UNION ALL
     SELECT DISTINCT 'default privileges: new objects would be granted to '
              || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
       FROM pg_default_acl d, aclexplode(d.defaclacl) a
       WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) = ANY($1)
     UNION ALL
     SELECT DISTINCT 'table ' || table_name || ': PUBLIC has a privilege on it'
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee = 'PUBLIC'
     ORDER BY 1`,
    [[APP_ROLE, CROSS_ROLE], [...ROLES], MIGRATE_ROLE, Object.keys(DEFINER_FUNCTIONS)],
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
