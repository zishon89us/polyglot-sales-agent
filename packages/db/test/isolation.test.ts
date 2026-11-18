// Tenant isolation (US-C2, NFR-S1, ADR 0003 "Confirmation", issue #162).
// The attempts run against every table the database's catalogue lists. A
// table added later fails two tests until it is added to the expected list
// and given a seeded row, and from then on the attempts cover it.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MESSAGE_CLASSES, MESSAGE_DIRECTIONS, MESSAGE_STATUSES } from "../../core/src/index.ts";
import {
  APP_ROLE,
  CROSS_ROLE,
  ensureRoles,
  MIGRATE_ROLE,
  scramVerifier,
  type Tx,
  tenantColumn,
  tenantOwnedTables,
  withTenant,
} from "../src/index.ts";
import {
  createTestDatabase,
  type SeededTenant,
  seedTenant,
  sqlState,
  type TestDatabase,
} from "./harness.ts";

/** Every table privilege the two working roles hold. A change here is a decision, not a detail. */
const PRIVILEGES = {
  psa_app: {
    audit_log: "INSERT,SELECT",
    channel_accounts: "SELECT",
    contacts: "INSERT,SELECT,UPDATE",
    conversations: "INSERT,SELECT,UPDATE",
    jobs: "DELETE",
    messages: "INSERT,SELECT,UPDATE",
    tenants: "SELECT",
  },
  psa_cross: {
    channel_accounts: "INSERT,SELECT",
    channel_routes: "SELECT",
    jobs: "DELETE,INSERT,SELECT,UPDATE",
    tenants: "INSERT,SELECT",
    worker_heartbeats: "DELETE,INSERT,SELECT,UPDATE",
  },
};

const REFUSED = "42501"; // insufficient_privilege: no table privilege, or a row-level security check

let database: TestDatabase;
let app: pg.Pool;
let cross: pg.Client;
let migrate: pg.Client;
let a: SeededTenant;
let b: SeededTenant;
let tables: string[];

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 4 });
  cross = await database.client(CROSS_ROLE);
  migrate = await database.client(MIGRATE_ROLE);
  a = await seedTenant(cross, app, "a", "+15550100");
  b = await seedTenant(cross, app, "b", "+15550101");
  tables = await tenantOwnedTables(migrate);
}, 30_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

/** What tenant B can see of one table, as a count and a digest of every row. */
function snapshotOfB(table: string): Promise<{ n: number; digest: string }> {
  return withTenant(app, b.tenantId, async (tx) => {
    const result = await tx.query<{ n: number; digest: string }>(
      `SELECT count(*)::int AS n,
              md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id::text), '')) AS digest
       FROM ${table} t`,
    );
    return result.rows[0] as { n: number; digest: string };
  });
}

/** Runs one statement as tenant A. Returns the rows it affected, or the SQLSTATE it was refused with. */
async function asA(text: string, values: unknown[]): Promise<number | string> {
  try {
    return await withTenant(app, a.tenantId, async (tx) => (await tx.query(text, values)).rowCount);
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

describe("the seed covers every tenant-owned table", () => {
  test("the catalogue lists the tables this change creates", () => {
    expect(tables).toEqual([
      "audit_log",
      "channel_accounts",
      "contacts",
      "conversations",
      "messages",
      "tenants",
    ]);
  });

  test("each table has a row for each tenant, or the tests below would prove nothing", async () => {
    for (const table of tables) {
      for (const tenant of [a, b]) {
        const rows = await withTenant(app, tenant.tenantId, (tx) =>
          tx.query(`SELECT 1 FROM ${table}`),
        );
        expect(rows.rowCount, `${table} has no seeded row`).toBeGreaterThan(0);
      }
    }
  });
});

describe("without a tenant, the application role reaches nothing", () => {
  test("every table reads as empty", async () => {
    for (const table of tables) {
      const result = await app.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(result.rows[0]?.n, table).toBe(0);
    }
  });

  test("a write is refused", async () => {
    expect(
      await sqlState(
        app.query("INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550102')", [a.tenantId]),
      ),
    ).toBe(REFUSED);
    expect(
      (await app.query("UPDATE contacts SET phone = NULL")).rowCount,
      "an update without a tenant must touch no row",
    ).toBe(0);
  });
});

describe("as tenant A, tenant B's rows cannot be read or changed", () => {
  test("read: only A's rows are visible in every table", async () => {
    for (const table of tables) {
      const column = tenantColumn(table);
      const seen = await withTenant(app, a.tenantId, (tx) =>
        tx.query<{ mine: number; others: number }>(
          `SELECT count(*) FILTER (WHERE ${column} = $1)::int AS mine,
                  count(*) FILTER (WHERE ${column} <> $1)::int AS others FROM ${table}`,
          [a.tenantId],
        ),
      );
      expect(seen.rows[0]?.others, `${table}: rows of another tenant are visible`).toBe(0);
      expect(seen.rows[0]?.mine, `${table}: A cannot see its own rows`).toBeGreaterThan(0);
      const direct = await withTenant(app, a.tenantId, (tx) =>
        tx.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [b.tenantId]),
      );
      expect(direct.rowCount, `${table}: B's rows returned when asked for by tenant`).toBe(0);
    }
  });

  test("write: update, delete, insert and moving a row are each stopped, and B's rows are unchanged", async () => {
    for (const table of tables) {
      const column = tenantColumn(table);
      const before = await snapshotOfB(table);
      expect(before.n).toBeGreaterThan(0);
      const privileges = await migrate.query<{ insert: boolean; update: boolean }>(
        `SELECT has_table_privilege($1, $2, 'INSERT') AS insert,
                has_table_privilege($1, $2, 'UPDATE') AS update`,
        [APP_ROLE, table],
      );
      const may = privileges.rows[0] as { insert: boolean; update: boolean };

      const update = await asA(`UPDATE ${table} SET created_at = created_at WHERE ${column} = $1`, [
        b.tenantId,
      ]);
      // With the privilege, the statement runs and the policy hides B's rows. Without, it is refused.
      expect(update, `${table}: update of B's rows`).toBe(may.update ? 0 : REFUSED);

      const remove = await asA(`DELETE FROM ${table} WHERE ${column} = $1`, [b.tenantId]);
      expect([0, REFUSED], `${table}: delete of B's rows`).toContain(remove);

      // A copy of one of A's own rows, with a new id and B as its tenant.
      const insert = await asA(
        `INSERT INTO ${table}
         SELECT (jsonb_populate_record(NULL::${table},
                   to_jsonb(src) || jsonb_build_object('id', gen_random_uuid())
                                 || jsonb_build_object($2::text, $1::uuid))).*
         FROM ${table} src LIMIT 1`,
        [b.tenantId, column],
      );
      expect(insert, `${table}: insert of a row for B`).toBe(REFUSED);

      const move = await asA(`UPDATE ${table} SET ${column} = $1`, [b.tenantId]);
      expect(move, `${table}: moving A's rows to B`).toBe(REFUSED);

      expect(await snapshotOfB(table), `${table}: B's rows changed`).toEqual(before);
    }
  });

  test("where A may write, it is the policy that refuses, not a missing privilege", async () => {
    const error = await withTenant(app, a.tenantId, (tx) =>
      tx.query("INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550103')", [b.tenantId]),
    ).catch((caught: Error) => caught.message);
    expect(error).toContain("row-level security policy");
  });

  test("a row cannot point at another tenant's row", async () => {
    // Foreign-key checks are not subject to row-level security; the keys include the tenant.
    expect(
      await asA(
        "INSERT INTO conversations (tenant_id, contact_id, channel_account_id) VALUES ($1, $2, $3)",
        [a.tenantId, b.contactId, a.channelAccountId],
      ),
    ).toBe("23503");
    expect(
      await asA(
        `INSERT INTO messages (tenant_id, conversation_id, direction, kind) VALUES ($1, $2, 'inbound', 'text')`,
        [a.tenantId, b.conversationId],
      ),
    ).toBe("23503");
  });
});

describe("a pooled connection carries no tenant to its next user", () => {
  test("two tenants, then no tenant, on one connection", async () => {
    const one = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 1 });
    try {
      const contacts = (tenantId: string) =>
        withTenant(one, tenantId, async (tx) =>
          (await tx.query<{ id: string }>("SELECT id FROM contacts")).rows.map((row) => row.id),
        );
      expect(await contacts(a.tenantId)).toEqual([a.contactId]);
      expect(await contacts(b.tenantId)).toEqual([b.contactId]);
      // After a transaction the setting reads as an empty string, which must mean "no tenant".
      expect((await one.query("SELECT id FROM contacts")).rows).toEqual([]);
      expect((await one.query("SELECT app_tenant_id() AS tenant")).rows[0]?.tenant).toBeNull();
    } finally {
      await one.end();
    }
  });

  test("forty interleaved transactions on two connections each see only their tenant", async () => {
    const two = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 2 });
    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) => {
          const tenant = index % 2 === 0 ? a : b;
          return withTenant(two, tenant.tenantId, async (tx) => {
            const rows = await tx.query<{ tenant_id: string }>(
              "SELECT tenant_id FROM messages, pg_sleep(0.005)",
            );
            return rows.rows.every((row) => row.tenant_id === tenant.tenantId) && rows.rowCount > 0;
          });
        }),
      );
      expect(results).toEqual(results.map(() => true));
    } finally {
      await two.end();
    }
  });

  test("when the work throws, nothing it wrote is kept and the error is passed on", async () => {
    const failure = withTenant(app, a.tenantId, async (tx) => {
      await tx.query("INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550104')", [
        a.tenantId,
      ]);
      throw new Error("stop here");
    });
    await expect(failure).rejects.toThrow("stop here");
    const kept = await withTenant(app, a.tenantId, (tx) =>
      tx.query("SELECT 1 FROM contacts WHERE phone = '+15550104'"),
    );
    expect(kept.rowCount).toBe(0);
  });

  test("a handle kept after its transaction cannot be used in the next tenant's", async () => {
    const one = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 1 });
    try {
      let kept: Tx | undefined;
      await withTenant(one, a.tenantId, async (tx) => {
        kept = tx;
      });
      const late = await withTenant(one, b.tenantId, async () =>
        (kept as Tx).query("SELECT id FROM contacts").catch((error: Error) => error.message),
      );
      expect(late).toBe("withTenant: this transaction has ended");
      // Also when the work failed, and when it is merely late.
      await withTenant(one, a.tenantId, async (tx) => {
        kept = tx;
        throw new Error("stop");
      }).catch(() => undefined);
      await expect((kept as Tx).query("SELECT 1")).rejects.toThrow("this transaction has ended");
    } finally {
      await one.end();
    }
  });

  test("work that swallows a failed statement is not reported as committed", async () => {
    const result = withTenant(app, a.tenantId, async (tx) => {
      await tx.query("INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550105')", [
        a.tenantId,
      ]);
      await tx.query("SELECT 1 / 0").catch(() => undefined);
      return "done";
    });
    await expect(result).rejects.toThrow("rolled back, not committed");
  });

  test("a tenant set for the whole session inside the work does not outlive it", async () => {
    const one = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 1 });
    try {
      await withTenant(one, a.tenantId, (tx) => tx.query(`SET app.tenant_id = '${b.tenantId}'`));
      expect((await one.query("SELECT id FROM contacts")).rows).toEqual([]);
    } finally {
      await one.end();
    }
  });

  test("a connection lost during the work rejects the call and the pool carries on", async () => {
    const one = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 1 });
    one.on("error", () => undefined);
    try {
      await expect(
        withTenant(one, a.tenantId, (tx) =>
          tx.query("SELECT pg_terminate_backend(pg_backend_pid())"),
        ),
      ).rejects.toThrow();
      const after = await withTenant(one, a.tenantId, (tx) => tx.query("SELECT id FROM contacts"));
      expect(after.rowCount).toBeGreaterThan(0);
    } finally {
      await one.end();
    }
  });

  test("a pool that connects as another role is refused", async () => {
    for (const role of [CROSS_ROLE, MIGRATE_ROLE] as const) {
      const wrong = new pg.Pool({ connectionString: database.url(role), max: 1 });
      try {
        await expect(withTenant(wrong, a.tenantId, async () => 1)).rejects.toThrow(
          "the pool must connect as psa_app",
        );
      } finally {
        await wrong.end();
      }
    }
  });

  test("a tenant identifier that is not a UUID is refused before any query", async () => {
    for (const bad of ["", "abc", `${a.tenantId}' OR '1'='1`, `${a.tenantId} `]) {
      await expect(withTenant(app, bad, async () => 1)).rejects.toThrow("is not a UUID");
    }
  });
});

describe("the application role cannot go around the policies", () => {
  let session: pg.Client;
  beforeAll(async () => {
    session = await database.client(APP_ROLE);
  });

  test("it connects as the application role and nothing more", async () => {
    const who = await session.query(
      "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(who.rows).toEqual([{ name: APP_ROLE, rolsuper: false, rolbypassrls: false }]);
  });

  test.each([
    ["switch off row security for a query", "SET row_security = off; SELECT * FROM contacts"],
    ["disable row-level security", "ALTER TABLE contacts DISABLE ROW LEVEL SECURITY"],
    ["stop forcing it", "ALTER TABLE contacts NO FORCE ROW LEVEL SECURITY"],
    ["drop the policy", "DROP POLICY tenant_isolation ON contacts"],
    ["add a policy", "CREATE POLICY wide ON contacts USING (true)"],
    [
      "replace the tenant function",
      "CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql RETURN NULL::uuid",
    ],
    ["create a table", "CREATE TABLE scratch (id integer)"],
    ["create a temporary table", "CREATE TEMPORARY TABLE scratch (id integer)"],
    ["become the cross-tenant role", `SET ROLE ${CROSS_ROLE}`],
    ["become the migration role", `SET ROLE ${MIGRATE_ROLE}`],
    ["change session authorization", `SET SESSION AUTHORIZATION ${CROSS_ROLE}`],
    ["empty a table", "TRUNCATE messages"],
    ["read the routing table", "SELECT * FROM channel_routes"],
    ["read the migration record", "SELECT * FROM schema_migrations"],
    [
      "create a tenant",
      "INSERT INTO tenants (name, pack, time_zone, default_language) VALUES ('x', 'x', 'x', 'x')",
    ],
    ["delete a contact", "DELETE FROM contacts"],
    ["change an audit entry", "UPDATE audit_log SET action = 'changed'"],
    ["delete an audit entry", "DELETE FROM audit_log"],
  ])("refused: %s", async (_what, statement) => {
    expect(await sqlState(session.query(statement))).toBe(REFUSED);
    await session.query("RESET row_security");
  });

  test("known limit: SQL run as the application role can name another tenant", async () => {
    // The policies stop a query that forgot its filter. They do not stop SQL
    // text that sets the tenant itself, so query text must never come from
    // outside the code (threat model, T33).
    const seen = await withTenant(app, a.tenantId, async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [b.tenantId]);
      return tx.query<{ id: string }>("SELECT id FROM contacts");
    });
    expect(seen.rows).toEqual([{ id: b.contactId }]);
  });
});

describe("privileges", () => {
  test("the two working roles hold exactly the table privileges listed, and privileges by column on one table only", async () => {
    const grants = await migrate.query<{ grantee: string; table_name: string; privileges: string }>(
      `SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee <> $1 GROUP BY 1, 2`,
      [MIGRATE_ROLE],
    );
    const held: Record<string, Record<string, string>> = {};
    for (const row of grants.rows) {
      held[row.grantee] = { ...held[row.grantee], [row.table_name]: row.privileges };
    }
    expect(held).toEqual(PRIVILEGES);
    const columns = await migrate.query(
      `SELECT attrelid::regclass::text AS "table", attname FROM pg_attribute
       WHERE attacl IS NOT NULL AND attrelid IN
         (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)`,
    );
    // The one table with privileges by column (ADR 0004, amendment).
    expect([...new Set(columns.rows.map((row) => row.table))]).toEqual(["jobs"]);
    expect(columns.rows.map((row) => row.attname).sort()).toEqual(
      ["id", "payload", "run_at", "state", "subject_id", "tenant_id", "type"].sort(),
    );
  });

  test("the functions are executable only by the roles that need them", async () => {
    const result = await migrate.query(
      `SELECT p.proname AS name, p.prosecdef AS definer, p.proconfig AS settings,
              has_function_privilege('psa_app', p.oid, 'EXECUTE') AS app,
              has_function_privilege('psa_cross', p.oid, 'EXECUTE') AS "cross",
              has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`,
    );
    expect(result.rows).toEqual([
      {
        name: "app_tenant_id",
        definer: false,
        settings: null,
        app: true,
        cross: true,
        everyone: false,
      },
      {
        name: "channel_routes_sync",
        definer: true,
        settings: ["search_path=pg_catalog, public"],
        app: false,
        cross: false,
        everyone: false,
      },
      {
        name: "job_payload_ok",
        definer: false,
        settings: null,
        app: true,
        cross: true,
        everyone: false,
      },
    ]);
  });

  test("a password is stored and sent as a verifier, and the wrong one is refused", async () => {
    const fixed = scramVerifier("pencil", Buffer.from("0123456789abcdef"));
    expect(fixed).toMatch(
      /^SCRAM-SHA-256\$4096:MDEyMzQ1Njc4OWFiY2RlZg==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/,
    );
    expect(fixed).not.toContain("pencil");
    expect(scramVerifier("pencil", Buffer.from("0123456789abcdef"))).toBe(fixed);
    // Characters the server would prepare differently are refused, not guessed at.
    for (const password of ["", "caf\u00e9", "soft\u00adhyphen", "tab\there"]) {
      expect(() => scramVerifier(password)).toThrow("must be printable ASCII");
    }
    const wrong = new URL(database.url(APP_ROLE));
    wrong.password = "not-the-password";
    const client = new pg.Client({ connectionString: wrong.href });
    expect(await sqlState(client.connect())).toBe("28P01");
    await client.end().catch(() => undefined);
  });

  test("an empty password is refused before anything is changed", async () => {
    const administrator = await database.administrator();
    await expect(
      ensureRoles(administrator, { psa_migrate: "x", psa_app: "", psa_cross: "x" }),
    ).rejects.toThrow("the password for psa_app is empty");
    // The roles still accept the passwords they had.
    const still = new pg.Client({ connectionString: database.url(MIGRATE_ROLE) });
    await still.connect();
    await still.end();
  });
});

describe("the other two roles", () => {
  test("the migration role owns the tables and still reads no rows", async () => {
    for (const table of tables) {
      const result = await migrate.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(result.rows[0]?.n, table).toBe(0);
    }
  });

  test("the cross-tenant role sees every tenant, and only the tables it was granted", async () => {
    const all = await cross.query<{ id: string }>("SELECT id FROM tenants");
    expect(all.rows.map((row) => row.id).sort()).toEqual([a.tenantId, b.tenantId].sort());
    for (const statement of [
      "SELECT * FROM contacts",
      "SELECT * FROM messages",
      "SELECT * FROM audit_log",
      "DELETE FROM tenants",
      "INSERT INTO channel_routes VALUES ('x', gen_random_uuid())",
      "DELETE FROM channel_routes",
      "CREATE TABLE scratch (id integer)",
    ]) {
      expect(await sqlState(cross.query(statement)), statement).toBe(REFUSED);
    }
  });

  test("the routing table follows the channel accounts", async () => {
    const routes = await cross.query(
      "SELECT receiving_number_id, tenant_id FROM channel_routes ORDER BY 1",
    );
    expect(routes.rows).toEqual([
      { receiving_number_id: a.receivingNumberId, tenant_id: a.tenantId },
      { receiving_number_id: b.receivingNumberId, tenant_id: b.tenantId },
    ]);
    expect(
      await sqlState(
        cross.query(
          "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
          [b.tenantId, a.receivingNumberId],
        ),
      ),
      "one receiving number cannot belong to two tenants",
    ).toBe("23505");
  });

  test("the routing table follows a changed number, a moved account and a removed one", async () => {
    // No working role may change or remove a channel account yet, so the
    // administrator does it, in a transaction that is rolled back.
    const administrator = await database.administrator();
    const route = async (number: string) =>
      (
        await administrator.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM channel_routes WHERE receiving_number_id = $1",
          [number],
        )
      ).rows.map((row) => row.tenant_id);
    await administrator.query("BEGIN");
    try {
      const account = await administrator.query<{ id: string }>(
        `INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id)
         VALUES ($1, 'mock', 'mock-number-spare') RETURNING id`,
        [a.tenantId],
      );
      const id = account.rows[0]?.id;
      expect(await route("mock-number-spare")).toEqual([a.tenantId]);
      await administrator.query(
        "UPDATE channel_accounts SET receiving_number_id = 'mock-number-renamed' WHERE id = $1",
        [id],
      );
      expect(await route("mock-number-spare")).toEqual([]);
      expect(await route("mock-number-renamed")).toEqual([a.tenantId]);
      await administrator.query("UPDATE channel_accounts SET tenant_id = $1 WHERE id = $2", [
        b.tenantId,
        id,
      ]);
      expect(await route("mock-number-renamed")).toEqual([b.tenantId]);
      await administrator.query("DELETE FROM channel_accounts WHERE id = $1", [id]);
      expect(await route("mock-number-renamed")).toEqual([]);
    } finally {
      await administrator.query("ROLLBACK");
    }
  });
});

describe("constraints the skeleton relies on", () => {
  test("a contact has one conversation", async () => {
    expect(
      await asA(
        "INSERT INTO conversations (tenant_id, contact_id, channel_account_id) VALUES ($1, $2, $3)",
        [a.tenantId, a.contactId, a.channelAccountId],
      ),
    ).toBe("23505");
  });

  test("the database accepts exactly the names of packages/core for a message", async () => {
    const constraints = await migrate.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'messages'::regclass AND contype = 'c'`,
    );
    const allowed = (column: string): string[] => {
      const found = constraints.rows.filter((row) =>
        row.definition.startsWith(`CHECK ((${column} = ANY`),
      );
      expect(found, `one check on ${column}`).toHaveLength(1);
      return [...(found[0]?.definition ?? "").matchAll(/'([^']+)'::text/g)].map(
        (match) => match[1] as string,
      );
    };
    expect(allowed("direction")).toEqual([...MESSAGE_DIRECTIONS]);
    expect(allowed("class")).toEqual(Object.keys(MESSAGE_CLASSES));
    expect(allowed("status")).toEqual([...MESSAGE_STATUSES]);
  });

  test("a channel message is stored once per tenant (US-C1)", async () => {
    const insert = (tenant: SeededTenant) =>
      insertMessage(tenant, [tenant.tenantId, tenant.conversationId, "mock-message-twice"]);
    expect(await insert(a)).toBe(1);
    expect(await insert(a)).toBe("23505");
    expect(await insert(b), "the same identifier in another tenant is a different message").toBe(1);
  });

  test("a phone number is unique within a tenant, and says nothing about another tenant", async () => {
    const insert = (tenant: SeededTenant, phone: string) =>
      withTenant(app, tenant.tenantId, (tx) =>
        tx.query("INSERT INTO contacts (tenant_id, phone) VALUES ($1, $2)", [
          tenant.tenantId,
          phone,
        ]),
      ).then(
        (result) => result.rowCount as number | string,
        (error: { code?: string }) => error.code ?? String(error),
      );
    expect(await insert(a, "+15550110")).toBe(1);
    expect(await insert(a, "+15550110")).toBe("23505");
    expect(await insert(b, "+15550110"), "the same number as another tenant's contact").toBe(1);
    expect(await insert(a, "0555 0111"), "not E.164").toBe("23514");
  });

  test("a conversation cannot use another tenant's channel account", async () => {
    const result = await withTenant(app, a.tenantId, async (tx) => {
      const contact = await tx.query<{ id: string }>(
        "INSERT INTO contacts (tenant_id, phone) VALUES ($1, '+15550112') RETURNING id",
        [a.tenantId],
      );
      return tx.query(
        "INSERT INTO conversations (tenant_id, contact_id, channel_account_id) VALUES ($1, $2, $3)",
        [a.tenantId, contact.rows[0]?.id, b.channelAccountId],
      );
    }).catch((error: { code?: string }) => error.code);
    expect(result).toBe("23503");
  });

  test("only an outbound message has a status", async () => {
    const insert = (direction: string, messageClass: string | null, status: string | null) =>
      asA(
        "INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, status) VALUES ($1, $2, $3, $4, 'text', $5)",
        [a.tenantId, a.conversationId, direction, messageClass, status],
      );
    expect(await insert("inbound", null, "pending")).toBe("23514");
    expect(await insert("outbound", "system-reply", null)).toBe("23514");
    expect(await insert("outbound", "system-reply", "pending")).toBe(1);
  });

  test("a channel other than the two known ones is refused", async () => {
    expect(
      await sqlState(
        cross.query(
          "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'sms', 'x')",
          [a.tenantId],
        ),
      ),
    ).toBe("23514");
  });

  test("only an outbound message has a class", async () => {
    const insert = (direction: string, messageClass: string | null) =>
      asA(
        "INSERT INTO messages (tenant_id, conversation_id, direction, class, kind) VALUES ($1, $2, $3, $4, 'text')",
        [a.tenantId, a.conversationId, direction, messageClass],
      );
    expect(await insert("inbound", "system-reply")).toBe("23514");
    expect(await insert("outbound", null)).toBe("23514");
  });
});

function insertMessage(tenant: SeededTenant, values: unknown[]): Promise<number | string> {
  return withTenant(app, tenant.tenantId, async (tx) => {
    const result = await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, kind, channel_message_id)
       VALUES ($1, $2, 'inbound', 'text', $3)`,
      values,
    );
    return result.rowCount as number | string;
  }).catch((error: { code?: string }) => error.code ?? String(error));
}
