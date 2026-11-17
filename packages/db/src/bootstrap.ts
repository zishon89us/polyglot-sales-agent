// What an administrator runs once per database server and once per
// database, before the first migration. It needs a role that can create
// roles; nothing after it does.

import type pg from "pg";
import { APP_ROLE, CROSS_ROLE, MIGRATE_ROLE, ROLES, type Role } from "./roles.ts";

export type RolePasswords = Readonly<Record<Role, string>>;

// Any constant; it only has to be the same for every caller.
const BOOTSTRAP_LOCK = 4_815_162_342;

/**
 * Creates the three roles if they are missing and sets their attributes and
 * passwords. None can create roles or databases, and none bypasses
 * row-level security. Safe to run again.
 *
 * Roles belong to the server, not to a database, so callers that prepare
 * several databases at once must run this from one database: the lock that
 * keeps two runs apart is per database.
 */
export async function ensureRoles(admin: pg.Client, passwords: RolePasswords): Promise<void> {
  await admin.query("SELECT pg_advisory_lock($1)", [BOOTSTRAP_LOCK]);
  try {
    for (const role of ROLES) {
      const password = passwords[role];
      if (password === "") {
        throw new Error(`bootstrap: the password for ${role} is empty`);
      }
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      const name = admin.escapeIdentifier(role);
      await admin.query(`${exists.rowCount === 0 ? "CREATE" : "ALTER"} ROLE ${name} LOGIN
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
        PASSWORD ${admin.escapeLiteral(password)}`);
    }
  } finally {
    await admin.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK]);
  }
}

/**
 * Prepares the database the client is connected to: only the three roles may
 * connect, the migration role owns the public schema, and the other two may
 * use it but not create in it. Safe to run again.
 */
export async function prepareDatabase(admin: pg.Client): Promise<void> {
  const current = await admin.query<{ name: string }>("SELECT current_database() AS name");
  const database = admin.escapeIdentifier(current.rows[0]?.name ?? "");
  const all = ROLES.map((role) => admin.escapeIdentifier(role)).join(", ");
  await admin.query(`
    REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${database} TO ${all};
    ALTER SCHEMA public OWNER TO ${admin.escapeIdentifier(MIGRATE_ROLE)};
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${admin.escapeIdentifier(APP_ROLE)}, ${admin.escapeIdentifier(CROSS_ROLE)};
  `);
}
