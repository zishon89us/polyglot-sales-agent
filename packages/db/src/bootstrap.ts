// What an administrator runs once per database server and once per
// database, before the first migration. It needs a role that can create
// roles; nothing after it does.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import type pg from "pg";
import { APP_ROLE, CROSS_ROLE, MIGRATE_ROLE, ROLES, type Role } from "./roles.ts";

export type RolePasswords = Readonly<Record<Role, string>>;

/**
 * What PostgreSQL stores for a SCRAM-SHA-256 password (RFC 5803 form, as in
 * `pg_authid.rolpassword`). Sending this, not the password, keeps the
 * password out of the statement text, and so out of the server's log when a
 * statement fails or statement logging is on.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const iterations = 4096;
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}

// Any constant; it only has to be the same for every caller.
const BOOTSTRAP_LOCK = 4_815_162_342;

/**
 * Creates the three roles if they are missing and sets their attributes and
 * passwords. None can create roles or databases, and none bypasses
 * row-level security. Safe to run again. The passwords are sent as SCRAM
 * verifiers, never as text.
 *
 * Roles belong to the server, not to a database, so callers that prepare
 * several databases at once must run this from one database: the lock that
 * keeps two runs apart is per database.
 */
export async function ensureRoles(admin: pg.Client, passwords: RolePasswords): Promise<void> {
  for (const role of ROLES) {
    if (passwords[role] === "") {
      throw new Error(`bootstrap: the password for ${role} is empty`);
    }
  }
  await admin.query("SELECT pg_advisory_lock($1)", [BOOTSTRAP_LOCK]);
  try {
    for (const role of ROLES) {
      const password = passwords[role];
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      const name = admin.escapeIdentifier(role);
      await admin.query(`${exists.rowCount === 0 ? "CREATE" : "ALTER"} ROLE ${name} LOGIN
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
        PASSWORD ${admin.escapeLiteral(scramVerifier(password))}`);
    }
  } finally {
    await admin.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK]);
  }
}

/**
 * Prepares the database the client is connected to: only the three roles may
 * connect, the migration role owns the public schema, the other two may use
 * it but not create in it, and a function a migration creates is executable
 * by no one until it is granted. Safe to run again.
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
    ALTER DEFAULT PRIVILEGES FOR ROLE ${admin.escapeIdentifier(MIGRATE_ROLE)}
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  `);
}
