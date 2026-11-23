// Test support: a fresh database per test file on the PostgreSQL server at
// PSA_TEST_ADMIN_URL, prepared the same way as a real one (bootstrap, then
// migrations), and a seed with one row in every tenant-owned table.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import {
  APP_ROLE,
  CROSS_ROLE,
  ensureRoles,
  loadMigrations,
  MIGRATE_ROLE,
  migrateUp,
  prepareDatabase,
  type Role,
  type RolePasswords,
  withTenant,
} from "../src/index.ts";

// Settings come from the environment (`vitest.config.ts` loads `.env`), and
// otherwise from `.env.example`, whose values match `docker-compose.yml`.
// The roles belong to the whole server, so the tests must use the same
// passwords as a development database on that server, or they would change
// them under it.
const EXAMPLE = parseEnv(
  readFileSync(fileURLToPath(new URL("../../../.env.example", import.meta.url)), "utf8"),
);

function setting(name: string): string {
  const value = process.env[name] ?? EXAMPLE[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set and .env.example has no value for it`);
  }
  return value;
}

const ADMIN_URL = setting("PSA_TEST_ADMIN_URL");
// The tests reset the passwords of three server-wide roles and create and
// drop databases. That is for a server on this machine only.
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(ADMIN_URL).hostname) &&
  process.env["PSA_TEST_ALLOW_REMOTE"] !== "1"
) {
  throw new Error(
    "PSA_TEST_ADMIN_URL does not point at this machine. Set PSA_TEST_ALLOW_REMOTE=1 only for a server you can afford to lose.",
  );
}
const PASSWORDS: RolePasswords = {
  [MIGRATE_ROLE]: setting("PSA_DB_MIGRATE_PASSWORD"),
  [APP_ROLE]: setting("PSA_DB_APP_PASSWORD"),
  [CROSS_ROLE]: setting("PSA_DB_CROSS_PASSWORD"),
};

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../migrations", import.meta.url));

export interface TestDatabase {
  /** A connection string for one of the three roles. */
  url(role: Role): string;
  /** An open client for a role; closed by `drop`. */
  client(role: Role): Promise<pg.Client>;
  /** An open client for the server's administrator, in this database; closed by `drop`. */
  administrator(): Promise<pg.Client>;
  drop(): Promise<void>;
}

async function admin(database?: string): Promise<pg.Client> {
  const url = new URL(ADMIN_URL);
  if (database !== undefined) {
    url.pathname = `/${database}`;
  }
  const client = new pg.Client({ connectionString: url.href });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `No PostgreSQL server answered at PSA_TEST_ADMIN_URL (host ${url.host}). ` +
        `Start one with \`make db-up\`. Cause: ${error instanceof Error ? error.message : error}`,
    );
  }
  return client;
}

export async function createTestDatabase(options: { migrate: boolean }): Promise<TestDatabase> {
  const name = `psa_test_${randomBytes(6).toString("hex")}`;
  const server = await admin();
  try {
    await ensureRoles(server, PASSWORDS);
    await server.query(`CREATE DATABASE ${name}`);
  } finally {
    await server.end();
  }
  const url = (role: Role): string => {
    const target = new URL(ADMIN_URL);
    target.pathname = `/${name}`;
    target.username = role;
    target.password = PASSWORDS[role];
    return target.href;
  };
  const open: pg.Client[] = [];
  const client = async (role: Role): Promise<pg.Client> => {
    const connection = new pg.Client({ connectionString: url(role) });
    await connection.connect();
    open.push(connection);
    return connection;
  };
  const drop = async (): Promise<void> => {
    // A connection that will not close must not stop the database being dropped.
    await Promise.allSettled(open.map((connection) => connection.end()));
    const last = await admin();
    try {
      await last.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await last.end();
    }
  };
  try {
    const database = await admin(name);
    try {
      await prepareDatabase(database);
    } finally {
      await database.end();
    }
    if (options.migrate) {
      await migrateUp(await client(MIGRATE_ROLE), loadMigrations(MIGRATIONS_DIRECTORY));
    }
  } catch (error) {
    await drop();
    throw error;
  }
  return {
    url,
    client,
    async administrator() {
      const connection = await admin(name);
      open.push(connection);
      return connection;
    },
    drop,
  };
}

export interface SeededTenant {
  tenantId: string;
  channelAccountId: string;
  contactId: string;
  conversationId: string;
  /** The conversation's open session. */
  sessionId: string;
  receivingNumberId: string;
}

/**
 * One tenant with at least one row in every tenant-owned table, written the
 * way the product will write them: the tenant and its channel account by the
 * cross-tenant role, the rest by the application role inside `withTenant`.
 * The phone number is from a range reserved for fiction.
 */
export async function seedTenant(
  cross: pg.Client,
  app: pg.Pool,
  label: string,
  phone: string,
): Promise<SeededTenant> {
  const tenant = await cross.query<{ id: string }>(
    `INSERT INTO tenants (name, pack, time_zone, default_language)
     VALUES ($1, 'faq-only', 'Asia/Riyadh', 'ar') RETURNING id`,
    [`Tenant ${label}`],
  );
  const tenantId = tenant.rows[0]?.id as string;
  const receivingNumberId = `mock-number-${label}`;
  const account = await cross.query<{ id: string }>(
    `INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id)
     VALUES ($1, 'mock', $2) RETURNING id`,
    [tenantId, receivingNumberId],
  );
  const channelAccountId = account.rows[0]?.id as string;
  return withTenant(app, tenantId, async (tx) => {
    const contact = await tx.query<{ id: string }>(
      "INSERT INTO contacts (tenant_id, phone) VALUES ($1, $2) RETURNING id",
      [tenantId, phone],
    );
    const contactId = contact.rows[0]?.id as string;
    const conversation = await tx.query<{ id: string }>(
      `INSERT INTO conversations (tenant_id, contact_id, channel_account_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, contactId, channelAccountId],
    );
    const conversationId = conversation.rows[0]?.id as string;
    const session = await tx.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, conversation_id, started_at, last_message_at)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp()) RETURNING id`,
      [tenantId, conversationId],
    );
    const sessionId = session.rows[0]?.id as string;
    await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, session_id, direction, class, kind, channel_message_id, body, status)
       VALUES ($1, $2, $4, 'inbound', NULL, 'text', $3, 'hello', NULL),
              ($1, $2, $4, 'outbound', 'system-reply', 'text', NULL, 'hello', 'pending')`,
      [tenantId, conversationId, `mock-message-${label}`, sessionId],
    );
    await tx.query(
      `INSERT INTO audit_log (tenant_id, action, subject_type, subject_id)
       VALUES ($1, 'seeded', 'contact', $2)`,
      [tenantId, contactId],
    );
    await tx.query(
      `INSERT INTO services (tenant_id, name, description, price_minor)
       VALUES ($1, $2, 'a description', 1500)`,
      [tenantId, `Service ${label}`],
    );
    await tx.query("INSERT INTO policies (tenant_id, title, body) VALUES ($1, $2, 'a body')", [
      tenantId,
      `Policy ${label}`,
    ]);
    return { tenantId, channelAccountId, contactId, conversationId, sessionId, receivingNumberId };
  });
}

/** The SQLSTATE code of the error a promise rejects with, or "none" if it resolves. */
export async function sqlState(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
    return "none";
  } catch (error) {
    return (error as { code?: string }).code ?? `no code: ${String(error)}`;
  }
}

/** Everything about the public schema that a migration can change, as one string. */
export async function schemaFingerprint(client: pg.Client): Promise<string> {
  const result = await client.query<{ fingerprint: string }>(`
    SELECT jsonb_build_object(
      -- Not the position of a column: one dropped and added again gets a new position.
      'columns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.column_name) FROM (
          SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name <> 'schema_migrations') c),
      'constraints', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS x
          FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conrelid <> 'schema_migrations'::regclass) k),
      'indexes', (SELECT jsonb_agg(indexdef ORDER BY indexdef) FROM pg_indexes
          WHERE schemaname = 'public' AND tablename <> 'schema_migrations'),
      'security', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT relname || ' ' || relrowsecurity || ' ' || relforcerowsecurity AS x FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            AND relname <> 'schema_migrations') s),
      'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname)
          FROM pg_policies p WHERE schemaname = 'public'),
      'grants', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT table_name || ' ' || grantee || ' ' || privilege_type AS x
          FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name <> 'schema_migrations') g),
      'column grants', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT attrelid::regclass::text || '.' || attname || ' ' || attacl::text AS x
          FROM pg_attribute WHERE attacl IS NOT NULL AND attrelid IN
            (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)) a),
      'functions', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT pg_get_functiondef(oid) || coalesce(proacl::text, '') AS x FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace) f),
      'triggers', (SELECT jsonb_agg(x ORDER BY x) FROM (
          SELECT pg_get_triggerdef(oid) AS x FROM pg_trigger t
          WHERE NOT tgisinternal
            AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)) t)
    )::text AS fingerprint`);
  return result.rows[0]?.fingerprint as string;
}

// For tests only: wrap a pool a test made, and reach the pool behind a handle.
export { adopt, poolOf } from "../src/connect.ts";
