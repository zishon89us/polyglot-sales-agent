// A tenant's profile in the database (M3 unit U3). Each test is named for
// its case in the design note, docs/design/notes/m3-u3-profile.md.

import { readFileSync } from "node:fs";
import {
  type BusinessProfile,
  type ProfileFile,
  profileSize,
  readProfileFile,
} from "@polyglot-sales-agent/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  answering,
  CROSS_ROLE,
  type Database,
  loadBusinessProfile,
  loadMigrations,
  MIGRATE_ROLE,
  migrateDown,
  migrateUp,
  migrationStatus,
  replaceProfile,
  storeInbound,
  withTenant,
} from "../src/index.ts";
import { adopt, createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./harness.ts";

let database: TestDatabase;
let pool: pg.Pool;
let app: Database;
let administrator: pg.Client;
let tenant = "";
let other = "";
const NUMBER = "100000000000009";

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  pool = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  app = adopt(APP_ROLE, pool);
  administrator = await database.administrator();
}, 30_000);

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await administrator.query(
    "TRUNCATE messages, conversations, contacts, jobs, services, policies, audit_log, channel_accounts, tenants CASCADE",
  );
  const made = await administrator.query<{ id: string }>(
    `INSERT INTO tenants (name, pack, time_zone, default_language)
     VALUES ('Salon Noor', 'faq-only', 'Asia/Riyadh', 'ar'), ('Another', 'faq-only', 'UTC', 'en')
     RETURNING id`,
  );
  tenant = made.rows[0]?.id as string;
  other = made.rows[1]?.id as string;
});

const SETTINGS = {
  currency: "SAR",
  support_contact: "+15550100",
  notification_email: "owner@example.com",
  business_hours: [{ weekday: 7, opens: "09:00", closes: "17:00" }],
};
/** A file as an operator would write it, read by the same function the command uses. */
function file(value: Record<string, unknown>): ProfileFile {
  const read = readProfileFile(new TextEncoder().encode(JSON.stringify(value)));
  if (!read.ok) {
    throw new Error(read.problems.join("; "));
  }
  return read.profile;
}
const BASE = {
  settings: {
    ...SETTINGS,
    opening_hours: [
      { weekday: 1, opens: "10:00", closes: "13:00" },
      { weekday: 1, opens: "16:00", closes: "24:00" },
    ],
  },
  services: [
    { name: "Haircut", description: "Wash and cut.", price_minor: 12000 },
    { name: "Blow-dry", price_minor: 8000 },
    { name: "Old service", price_minor: 100, active: false },
  ],
  policies: [
    { title: "Payment", body: "Cash and cards." },
    { title: "Lateness", body: "We wait 15 minutes." },
  ],
};
/** A file's two lists, when a test has none to give: both are required. */
const NONE = { services: [], policies: [] };
const load = (value: Record<string, unknown>, to = tenant) =>
  replaceProfile(app, to, file(value), { sha256: "test" });
async function rows<Row extends pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<Row[]> {
  return (await administrator.query<Row>(sql, values)).rows;
}
const stored = () =>
  rows<{ name: string; price_minor: string; active: boolean; id: string; updated_at: Date }>(
    "SELECT id, name, price_minor, active, updated_at FROM services WHERE tenant_id = $1 ORDER BY lower(name)",
    [tenant],
  );

describe("loading a profile (section 5)", () => {
  test("L1: a valid file becomes the tenant's settings, services and policies, and is counted", async () => {
    expect(await load(BASE)).toEqual({
      services: { added: 3, changed: 0, removed: 0 },
      policies: { added: 2, changed: 0, removed: 0 },
    });
    expect(
      await rows(
        "SELECT currency, support_contact, notification_email, business_hours, opening_hours, opening_hours_updated_at IS NOT NULL AS dated FROM tenants WHERE id = $1",
        [tenant],
      ),
    ).toEqual([
      {
        currency: "SAR",
        support_contact: "+15550100",
        notification_email: "owner@example.com",
        business_hours: [{ weekday: 7, opens: "09:00", closes: "17:00" }],
        opening_hours: [
          { weekday: 1, opens: "10:00", closes: "13:00" },
          { weekday: 1, opens: "16:00", closes: "24:00" },
        ],
        dated: true,
      },
    ]);
    expect((await stored()).map((row) => [row.name, row.price_minor, row.active])).toEqual([
      ["Blow-dry", "8000", true],
      ["Haircut", "12000", true],
      ["Old service", "100", false],
    ]);
    // Nothing of it reached the other tenant.
    expect(await rows("SELECT 1 FROM services WHERE tenant_id = $1", [other])).toEqual([]);
    expect(await rows("SELECT currency FROM tenants WHERE id = $1", [other])).toEqual([
      { currency: null },
    ]);
  });

  test("L1: an item of the same name, whatever its case, is updated in place and keeps its identifier", async () => {
    await load(BASE);
    const before = await stored();
    const change = await load({
      ...BASE,
      services: [
        { name: "HAIRCUT", description: "Wash and cut.", price_minor: 13000 },
        BASE.services[1],
        BASE.services[2],
      ],
    });
    expect(change.services).toEqual({ added: 0, changed: 1, removed: 0 });
    const after = await stored();
    expect(after.map((row) => [row.id, row.name, row.price_minor])).toEqual([
      [before[0]?.id, "Blow-dry", "8000"],
      [before[1]?.id, "HAIRCUT", "13000"],
      [before[2]?.id, "Old service", "100"],
    ]);
  });

  test("L2: a service or a policy the file no longer names is deleted; one can be kept and hidden", async () => {
    await load(BASE);
    const change = await load({
      settings: BASE.settings,
      services: [
        { name: "Haircut", description: "Wash and cut.", price_minor: 12000, active: false },
      ],
      policies: [BASE.policies[0]],
    });
    expect(change).toEqual({
      services: { added: 0, changed: 1, removed: 2 },
      policies: { added: 0, changed: 0, removed: 1 },
    });
    expect((await stored()).map((row) => [row.name, row.active])).toEqual([["Haircut", false]]);
    expect(await rows("SELECT title FROM policies WHERE tenant_id = $1", [tenant])).toEqual([
      { title: "Payment" },
    ]);
    // A file with none clears them all.
    expect(await load({ ...NONE, settings: SETTINGS })).toMatchObject({
      services: { removed: 1 },
      policies: { removed: 1 },
    });
  });

  test("L3: an item whose values are as stored is not touched: its time of change stays, and the opening hours' too", async () => {
    await load(BASE);
    const before = await rows(
      `SELECT (SELECT array_agg(updated_at ORDER BY id) FROM services) AS services,
              (SELECT array_agg(updated_at ORDER BY id) FROM policies) AS policies,
              opening_hours_updated_at AS hours FROM tenants WHERE id = $1`,
      [tenant],
    );
    expect(await load(BASE)).toEqual({
      services: { added: 0, changed: 0, removed: 0 },
      policies: { added: 0, changed: 0, removed: 0 },
    });
    expect(
      await rows(
        `SELECT (SELECT array_agg(updated_at ORDER BY id) FROM services) AS services,
                (SELECT array_agg(updated_at ORDER BY id) FROM policies) AS policies,
                opening_hours_updated_at AS hours FROM tenants WHERE id = $1`,
        [tenant],
      ),
    ).toEqual(before);
    // Changed hours are dated anew; hours taken away are cleared.
    await load({ ...BASE, settings: { ...SETTINGS, opening_hours: [] } });
    const changed = await rows<{ hours: Date }>(
      "SELECT opening_hours_updated_at AS hours FROM tenants WHERE id = $1",
      [tenant],
    );
    const earlier = before[0]?.["hours"] as Date;
    expect(changed[0]?.hours.getTime()).toBeGreaterThan(earlier.getTime());
    await load({ ...BASE, settings: SETTINGS });
    expect(await rows("SELECT opening_hours FROM tenants WHERE id = $1", [tenant])).toEqual([
      { opening_hours: null },
    ]);
  });

  test("L4: a renamed service is a new one with a new identifier, and the old one is gone", async () => {
    await load(BASE);
    const before = await stored();
    await load({
      ...BASE,
      services: [{ name: "Hair cut", price_minor: 12000 }, BASE.services[1], BASE.services[2]],
    });
    const after = await stored();
    expect(after.map((row) => row.name)).toEqual(["Blow-dry", "Hair cut", "Old service"]);
    expect(before.map((row) => row.id)).not.toContain(after[1]?.id);
  });

  test("L8: a tenant that does not exist is an error, and nothing is written", async () => {
    await expect(load(BASE, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "tenant-not-found",
    });
    expect(await rows("SELECT 1 FROM services")).toEqual([]);
    expect(await rows("SELECT 1 FROM audit_log")).toEqual([]);
  });

  test("L9: two loads for one tenant go one after the other: the second waits on the tenant's row", async () => {
    await load(BASE);
    await administrator.query("BEGIN");
    let running: Promise<unknown>;
    try {
      await administrator.query("SELECT 1 FROM tenants WHERE id = $1 FOR NO KEY UPDATE", [tenant]);
      running = load({ ...NONE, settings: SETTINGS });
      for (let tries = 0; ; tries += 1) {
        const waiting = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
           WHERE NOT l.granted AND a.datname = current_database()`,
        );
        if (waiting.rows[0]?.n === 1) {
          break;
        }
        if (tries > 200) {
          throw new Error("the load did not wait");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // Still everything, while it waits.
      expect(await rows("SELECT count(*)::int AS n FROM services")).toEqual([{ n: 3 }]);
    } finally {
      await administrator.query("COMMIT");
    }
    await running;
    expect(await rows("SELECT count(*)::int AS n FROM services")).toEqual([{ n: 0 }]);
  });

  test("L10: a profile read while a load is under way is wholly the old one", async () => {
    await load(BASE);
    const during = await withTenant(pool, tenant, async (tx) => {
      // A load that has written and not yet committed.
      await tx.query("UPDATE services SET price_minor = 1 WHERE name = 'Haircut'");
      await tx.query("DELETE FROM policies");
      await tx.query("UPDATE tenants SET currency = 'KWD' WHERE id = $1", [tenant]);
      return loadBusinessProfile(app, tenant);
    });
    expect(during.currency).toEqual({ code: "SAR", decimals: 2 });
    expect(during.services.map((service) => service.priceMinor)).toEqual([8000, 12000]);
    expect(during.policies).toHaveLength(2);
    const after = await loadBusinessProfile(app, tenant);
    expect(after.currency).toEqual({ code: "KWD", decimals: 3 });
    expect(after.policies).toEqual([]);
  });

  test("L11: each load leaves one row in the tenant's own audit log, with what it was given and the counts", async () => {
    await load(BASE);
    expect(
      await rows("SELECT tenant_id, action, subject_type, subject_id, details FROM audit_log"),
    ).toEqual([
      {
        tenant_id: tenant,
        action: "profile.loaded",
        subject_type: "tenant",
        subject_id: tenant,
        details: {
          sha256: "test",
          servicesAdded: 3,
          servicesChanged: 0,
          servicesRemoved: 0,
          policiesAdded: 2,
          policiesChanged: 0,
          policiesRemoved: 0,
        },
      },
    ]);
  });

  test("the database itself refuses one name's key twice in one tenant, and allows it in another", async () => {
    await load(BASE);
    await expect(
      administrator.query(
        "INSERT INTO services (tenant_id, name, name_key, price_minor) VALUES ($1, 'HAIRCUT', 'haircut', 1)",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      administrator.query(
        "INSERT INTO policies (tenant_id, title, title_key, body) VALUES ($1, 'PAYMENT', 'payment', 'x')",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await load(BASE, other);
    expect(await rows("SELECT count(*)::int AS n FROM services")).toEqual([{ n: 6 }]);
  });

  test("a later load with other values changes each of them, moves the time of change of what changed and of nothing else", async () => {
    await load(BASE);
    const before = await stored();
    const policiesBefore = await rows<{ title: string; updated_at: Date }>(
      "SELECT title, updated_at FROM policies WHERE tenant_id = $1 ORDER BY title",
      [tenant],
    );
    const change = await load({
      settings: {
        currency: "KWD",
        support_contact: "help@example.com",
        notification_email: "second@example.com",
        business_hours: [{ weekday: 1, opens: "08:00", closes: "12:00" }],
      },
      services: [
        // The description alone.
        { name: "Haircut", description: "Wash, cut and dry.", price_minor: 12000 },
        // The price alone.
        { name: "Blow-dry", price_minor: 8500 },
        { name: "Old service", price_minor: 100, active: false },
      ],
      policies: [
        // The body alone.
        { title: "Payment", body: "Cards only." },
        { title: "Lateness", body: "We wait 15 minutes." },
      ],
    });
    expect(change).toEqual({
      services: { added: 0, changed: 2, removed: 0 },
      policies: { added: 0, changed: 1, removed: 0 },
    });
    expect(
      await rows(
        "SELECT currency, support_contact, notification_email, business_hours, opening_hours FROM tenants WHERE id = $1",
        [tenant],
      ),
    ).toEqual([
      {
        currency: "KWD",
        support_contact: "help@example.com",
        notification_email: "second@example.com",
        business_hours: [{ weekday: 1, opens: "08:00", closes: "12:00" }],
        opening_hours: null,
      },
    ]);
    expect(
      await rows(
        "SELECT name, description, price_minor FROM services WHERE tenant_id = $1 ORDER BY name",
        [tenant],
      ),
    ).toEqual([
      { name: "Blow-dry", description: "", price_minor: "8500" },
      { name: "Haircut", description: "Wash, cut and dry.", price_minor: "12000" },
      { name: "Old service", description: "", price_minor: "100" },
    ]);
    const after = await stored();
    const moved = (name: string): boolean => {
      const was = before.find((row) => row.name === name) as { updated_at: Date; id: string };
      const is = after.find((row) => row.name === name) as { updated_at: Date; id: string };
      expect(is.id, name).toBe(was.id);
      return is.updated_at.getTime() > was.updated_at.getTime();
    };
    expect([moved("Haircut"), moved("Blow-dry"), moved("Old service")]).toEqual([
      true,
      true,
      false,
    ]);
    const policiesAfter = await rows<{ title: string; body: string; updated_at: Date }>(
      "SELECT title, body, updated_at FROM policies WHERE tenant_id = $1 ORDER BY title",
      [tenant],
    );
    expect(policiesAfter.map((row) => [row.title, row.body])).toEqual([
      ["Lateness", "We wait 15 minutes."],
      ["Payment", "Cards only."],
    ]);
    expect(
      policiesAfter.map(
        (row, index) =>
          row.updated_at.getTime() > (policiesBefore[index]?.updated_at.getTime() ?? 0),
      ),
    ).toEqual([false, true]);
  });

  test("names outside ASCII: the longest is stored, and one that differs only in case is the same item", async () => {
    expect(await rows("SHOW server_encoding")).toEqual([{ server_encoding: "UTF8" }]);
    // 200 Arabic letters, and a body of 4,000: characters, not bytes.
    const long = "\u0633".repeat(200);
    await load({
      settings: SETTINGS,
      services: [
        { name: long, price_minor: 1 },
        { name: "\u00C9lan Spa", price_minor: 2 },
      ],
      policies: [{ title: "\u00C9lan", body: "\u0633".repeat(4000) }],
    });
    const first = await rows<{ id: string; name: string }>(
      "SELECT id, name FROM services WHERE name LIKE '%Spa'",
    );
    expect(await rows("SELECT char_length(name) AS n FROM services ORDER BY 1")).toEqual([
      { n: 8 },
      { n: 200 },
    ]);
    const change = await load({
      settings: SETTINGS,
      services: [
        { name: long, price_minor: 1 },
        { name: "\u00E9LAN spa", price_minor: 2 },
      ],
      policies: [{ title: "\u00E9lan", body: "\u0633".repeat(4000) }],
    });
    expect(change).toEqual({
      services: { added: 0, changed: 1, removed: 0 },
      policies: { added: 0, changed: 1, removed: 0 },
    });
    expect(await rows("SELECT id, name FROM services WHERE name LIKE '%spa'")).toEqual([
      { id: first[0]?.id, name: "\u00E9LAN spa" },
    ]);
  });

  test("the database's own checks: a length, a price below nothing, a currency's form, hours that are no list", async () => {
    await load(BASE);
    for (const statement of [
      `UPDATE services SET description = repeat('x', 2001)`,
      `UPDATE services SET name = repeat('x', 201)`,
      `UPDATE services SET name = ''`,
      `UPDATE services SET name_key = ''`,
      `UPDATE services SET price_minor = -1`,
      `UPDATE policies SET body = repeat('x', 4001)`,
      `UPDATE policies SET body = ''`,
      `UPDATE policies SET title = repeat('x', 201)`,
      `UPDATE tenants SET currency = 'sar'`,
      `UPDATE tenants SET support_contact = ''`,
      `UPDATE tenants SET notification_email = repeat('x', 255)`,
      `UPDATE tenants SET business_hours = '{}'`,
      `UPDATE tenants SET opening_hours = '1'`,
    ]) {
      await expect(administrator.query(statement), statement).rejects.toMatchObject({
        code: "23514",
      });
    }
    // At each limit, it is taken.
    await administrator.query(
      "UPDATE services SET description = repeat('x', 2000), price_minor = 0 WHERE name = 'Haircut'",
    );
    await administrator.query(
      "UPDATE policies SET body = repeat('x', 4000) WHERE title = 'Payment'",
    );
  });
});

describe("what the model is given (section 2)", () => {
  async function profile(): Promise<BusinessProfile> {
    return loadBusinessProfile(app, tenant);
  }

  test("M1 to M8, M11: the business, its active services, its policies, its opening hours and its support contact, and nothing else", async () => {
    await load(BASE);
    const ids = await rows<{ kind: string; name: string; id: string }>(
      `SELECT 'service' AS kind, name, id FROM services UNION ALL SELECT 'policy', title, id FROM policies`,
    );
    const id = (name: string) => ids.find((row) => row.name === name)?.id;
    expect(await profile()).toEqual({
      name: "Salon Noor",
      timeZone: "Asia/Riyadh",
      currency: { code: "SAR", decimals: 2 },
      supportContact: "+15550100",
      // In order of name. The one that is not active is not here (M3).
      services: [
        { id: id("Blow-dry"), name: "Blow-dry", description: "", priceMinor: 8000 },
        { id: id("Haircut"), name: "Haircut", description: "Wash and cut.", priceMinor: 12000 },
      ],
      policies: [
        { id: id("Lateness"), title: "Lateness", body: "We wait 15 minutes." },
        { id: id("Payment"), title: "Payment", body: "Cash and cards." },
      ],
      // All seven weekdays once any is set; a closed one has no period (M5).
      openingHours: [
        {
          weekday: 1,
          periods: [
            { opens: "10:00", closes: "13:00" },
            { opens: "16:00", closes: "24:00" },
          ],
        },
        ...[2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, periods: [] })),
      ],
    });
    // Every item has an identifier (ADR 0006's own confirmation).
    const given = await profile();
    for (const item of [...given.services, ...given.policies]) {
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    // Business hours, the notification email and any time of change are nowhere in it (M6, M8, M11).
    const text = JSON.stringify(given);
    expect(text).not.toContain("owner@example.com");
    expect(text).not.toContain("17:00");
    // A date, not four digits and a hyphen: an identifier made at random can hold "2034-".
    expect(text).not.toMatch(/updated|20[0-9][0-9]-[01][0-9]-[0-3][0-9]/);
  });

  test("policies and services are given in the order of their names, whatever order they were stored in", async () => {
    const titles = ["m", "c", "x", "a", "t", "e", "z", "b"];
    await load({
      settings: SETTINGS,
      services: titles.map((name) => ({ name: `S ${name}`, price_minor: 1 })),
      policies: titles.map((title) => ({ title: `P ${title}`, body: "b" })),
    });
    // Rewritten, so that the newest versions of the rows are not in the order of insertion.
    await administrator.query("UPDATE policies SET body = 'c' WHERE title IN ('P a', 'P m')");
    await administrator.query("UPDATE services SET price_minor = 2 WHERE name IN ('S a', 'S m')");
    const given = await profile();
    const sorted = [...titles].sort();
    expect(given.policies.map((policy) => policy.title)).toEqual(sorted.map((t) => `P ${t}`));
    expect(given.services.map((service) => service.name)).toEqual(sorted.map((t) => `S ${t}`));
  });

  test("M9: nothing from a contact's record or a conversation is in it, whatever the tenant has stored", async () => {
    await load(BASE);
    const before = await profile();
    await administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [tenant, NUMBER],
    );
    await storeInbound(
      app,
      tenant,
      NUMBER,
      [
        {
          channelMessageId: "wamid.PROFILE1",
          phone: "+15550181",
          userId: "US.10000000000000000081",
          kind: "text",
          body: "a customer's private words",
          sentAt: new Date(),
        },
      ],
      [],
    );
    const after = await profile();
    expect(after).toEqual(before);
    const text = JSON.stringify(after);
    for (const secret of ["5550181", "10000000000000000081", "private words"]) {
      expect(text).not.toContain(secret);
    }
  });

  test("M9: the one query that reads a profile names three tables and no other", () => {
    const source = readFileSync(new URL("../src/profile.ts", import.meta.url), "utf8");
    const query = source.slice(
      source.indexOf("const PROFILE = `"),
      source.indexOf("/** The profile inside"),
    );
    const named = [...query.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((match) => match[1]);
    expect([...new Set(named)].sort()).toEqual(["policies", "services", "tenants"]);
  });

  test("M10: what the owner typed is given as typed, a number and a link included", async () => {
    await load({
      settings: SETTINGS,
      services: [],
      policies: [
        {
          title: "Reaching us",
          body: "Call Dr Sample on +15550123 or see https://example.com/pay",
        },
      ],
    });
    expect((await profile()).policies[0]?.body).toBe(
      "Call Dr Sample on +15550123 or see https://example.com/pay",
    );
  });

  test("M13: a tenant with nothing loaded has a name and a time zone and nothing else", async () => {
    expect(await profile()).toEqual({
      name: "Salon Noor",
      timeZone: "Asia/Riyadh",
      currency: null,
      supportContact: null,
      services: [],
      policies: [],
      openingHours: null,
    });
  });

  test("a tenant is given its own profile and never another's", async () => {
    await load(BASE);
    await load(
      {
        settings: { ...SETTINGS, currency: "KWD" },
        services: [{ name: "Other's", price_minor: 5 }],
        policies: [],
      },
      other,
    );
    expect((await loadBusinessProfile(app, other)).services.map((service) => service.name)).toEqual(
      ["Other's"],
    );
    expect((await profile()).services.map((service) => service.name)).toEqual([
      "Blow-dry",
      "Haircut",
    ]);
  });

  test("the widest price the loader takes is given exactly; a wider one, or hours of another shape, stored by other means stops the read", async () => {
    await load({
      settings: SETTINGS,
      services: [{ name: "Costly", price_minor: 2 ** 53 - 1 }],
      policies: [],
    });
    expect((await profile()).services[0]?.priceMinor).toBe(9007199254740991);
    await administrator.query("UPDATE services SET price_minor = 9007199254740993");
    await expect(profile()).rejects.toMatchObject({ code: "profile-unreadable" });
    await administrator.query("UPDATE services SET price_minor = 1");
    expect((await profile()).services[0]?.priceMinor).toBe(1);
    for (const hours of [
      "[null]",
      "[5]",
      '[{"weekday": 1, "opens": "9", "closes": "17:00"}]',
      '[{"weekday": 1.5, "opens": "09:00", "closes": "17:00"}]',
      '[{"weekday": 1, "opens": "09:00"}]',
      '[{"weekday": 99, "opens": "09:00", "closes": "17:00"}]',
      '[{"weekday": 0, "opens": "09:00", "closes": "17:00"}]',
      '[{"weekday": 1, "opens": "09:00", "closes": "08:00"}]',
      '[{"weekday": 1, "opens": "09:00", "closes": "09:00"}]',
      '[{"weekday": 1, "opens": "24:00", "closes": "24:00"}]',
    ]) {
      await administrator.query("UPDATE tenants SET opening_hours = $2::jsonb WHERE id = $1", [
        tenant,
        hours,
      ]);
      await expect(profile(), hours).rejects.toMatchObject({ code: "profile-unreadable" });
    }
    await administrator.query("UPDATE tenants SET opening_hours = NULL, currency = 'XXQ'");
    await expect(profile()).rejects.toMatchObject({ code: "profile-unreadable" });
  });
});

describe("whether a tenant is answering (section 4)", () => {
  const connect = () =>
    administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [tenant, NUMBER],
    );

  test("A1: all four settings and a channel", async () => {
    await load(BASE);
    await connect();
    expect(await answering(app, tenant)).toEqual({ settingsMissing: [], channelConnected: true });
  });

  test("A2: each setting that is missing is named", async () => {
    expect(await answering(app, tenant)).toEqual({
      settingsMissing: ["currency", "support_contact", "notification_email", "business_hours"],
      channelConnected: false,
    });
    await load(BASE);
    for (const setting of ["currency", "support_contact", "notification_email", "business_hours"]) {
      await administrator.query(`UPDATE tenants SET ${setting} = NULL WHERE id = $1`, [tenant]);
      expect((await answering(app, tenant)).settingsMissing).toEqual([setting]);
      await load(BASE);
    }
  });

  test("A3: no channel account; another tenant's channel is not in reach, so it does not count", async () => {
    await load(BASE);
    await administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [other, NUMBER],
    );
    expect(await answering(app, tenant)).toEqual({ settingsMissing: [], channelConnected: false });
  });

  test("A4, A5: business hours with no period at all are set; opening hours, services and policies are not needed", async () => {
    await load({ ...NONE, settings: { ...SETTINGS, business_hours: [] } });
    await connect();
    expect(await answering(app, tenant)).toEqual({ settingsMissing: [], channelConnected: true });
  });
});

describe("the size of a profile (section 3)", () => {
  test("the two fixture profiles, a small business in English and in Arabic, are accepted and measured", async () => {
    const sizes: Record<string, number> = {};
    for (const language of ["en", "ar"]) {
      const bytes = readFileSync(
        new URL(`../../core/fixtures/profile.salon.${language}.json`, import.meta.url),
      );
      const read = readProfileFile(bytes);
      if (!read.ok) {
        throw new Error(read.problems.join("; "));
      }
      await replaceProfile(app, tenant, read.profile, { sha256: "fixture" });
      // What is stored and given back measures the same as what the file did.
      expect(profileSize(await loadBusinessProfile(app, tenant))).toBe(read.size);
      sizes[language] = read.size;
    }
    // Recorded in the design note, "As built".
    expect(sizes).toEqual({ en: 1515, ar: 1271 });
  });
});

describe("the database's encoding", () => {
  test("a database that is not UTF-8 is refused by the migration: its lengths would be counted in bytes", async () => {
    const latin = await createTestDatabase({ migrate: false, latin1: true });
    try {
      const client = await latin.client(MIGRATE_ROLE);
      const all = loadMigrations(MIGRATIONS_DIRECTORY);
      const at = all.findIndex((migration) => migration.name === "profile");
      expect(at).toBe(6);
      await migrateUp(client, all.slice(0, at));
      await expect(migrateUp(client, all.slice(0, at + 1))).rejects.toThrow(
        "this database is encoded as LATIN1, and must be UTF8",
      );
      expect((await migrationStatus(client, all)).applied).toHaveLength(at);
    } finally {
      await latin.drop();
    }
  }, 30_000);
});

describe("migration 0007, with rows", () => {
  test("the way back loses every tenant's services, policies and settings, keeps the audit rows of their loads, and the way forward starts empty", async () => {
    const scratch = await createTestDatabase({ migrate: true });
    try {
      const owner = await scratch.administrator();
      const made = await owner.query<{ id: string }>(
        `INSERT INTO tenants (name, pack, time_zone, default_language, currency)
         VALUES ('Salon Noor', 'faq-only', 'UTC', 'en', 'SAR') RETURNING id`,
      );
      const id = made.rows[0]?.id as string;
      await owner.query(
        "INSERT INTO services (tenant_id, name, name_key, price_minor) VALUES ($1, 'Cut', 'cut', 1)",
        [id],
      );
      await owner.query(
        "INSERT INTO policies (tenant_id, title, title_key, body) VALUES ($1, 'Pay', 'pay', 'Cash.')",
        [id],
      );
      await owner.query(
        "INSERT INTO audit_log (tenant_id, action, subject_type, subject_id) VALUES ($1, 'profile.loaded', 'tenant', $1)",
        [id],
      );
      const client = await scratch.client(MIGRATE_ROLE);
      const all = loadMigrations(MIGRATIONS_DIRECTORY);
      // Later migrations are taken back first, one at a time, down to 0007.
      const later = all.length - all.findIndex((migration) => migration.name === "profile") - 1;
      expect(later).toBeGreaterThanOrEqual(0);
      for (let step = 0; step < later; step += 1) {
        await migrateDown(client, all);
      }
      expect(await migrateDown(client, all)).toBe("profile");
      expect(
        (await owner.query("SELECT to_regclass('services') AS s, to_regclass('policies') AS p"))
          .rows,
      ).toEqual([{ s: null, p: null }]);
      expect((await owner.query("SELECT action FROM audit_log")).rows).toEqual([
        { action: "profile.loaded" },
      ]);
      await migrateUp(client, all);
      expect(
        (
          await owner.query(
            "SELECT currency, (SELECT count(*)::int FROM services) AS services, (SELECT count(*)::int FROM policies) AS policies FROM tenants",
          )
        ).rows,
      ).toEqual([{ currency: null, services: 0, policies: 0 }]);
    } finally {
      await scratch.drop();
    }
  }, 30_000);
});

describe('who may do what (section 5, "Which role writes")', () => {
  test("the cross-tenant role can neither read nor write a tenant's services, policies or settings; of a tenant it reads and makes what it did before", async () => {
    await load(BASE);
    const cross = new pg.Client({ connectionString: database.url(CROSS_ROLE) });
    await cross.connect();
    try {
      for (const statement of [
        "SELECT 1 FROM services",
        "SELECT 1 FROM policies",
        "UPDATE services SET price_minor = 0",
        "DELETE FROM policies",
        "INSERT INTO policies (tenant_id, title, title_key, body) SELECT id, 't', 't', 'b' FROM tenants",
        "UPDATE tenants SET currency = 'KWD'",
        "UPDATE tenants SET support_contact = '+15550199'",
        "SELECT * FROM tenants",
        "SELECT currency FROM tenants",
        "SELECT support_contact FROM tenants",
        "SELECT notification_email FROM tenants",
        "SELECT business_hours FROM tenants",
        "SELECT opening_hours FROM tenants",
        "SELECT opening_hours_updated_at FROM tenants",
        "SELECT 1 FROM tenants WHERE currency = 'SAR'",
        "INSERT INTO tenants (name, pack, time_zone, default_language, currency) VALUES ('x', 'faq-only', 'UTC', 'en', 'SAR')",
        "INSERT INTO tenants (name, pack, time_zone, default_language, notification_email) VALUES ('x', 'faq-only', 'UTC', 'en', 'x@example.com')",
      ]) {
        await expect(cross.query(statement), statement).rejects.toMatchObject({ code: "42501" });
      }
      const seen = await cross.query(
        "SELECT id, created_at, name, pack, time_zone, default_language FROM tenants ORDER BY name",
      );
      expect(seen.rows.map((row) => row.name)).toEqual(["Another", "Salon Noor"]);
      const made = await cross.query(
        "INSERT INTO tenants (name, pack, time_zone, default_language) VALUES ('Third', 'faq-only', 'UTC', 'en') RETURNING id",
      );
      expect(made.rowCount).toBe(1);
    } finally {
      await cross.end();
    }
  });

  test("the application role may change its own tenant's settings and nothing else of that row, and no other tenant's", async () => {
    const as = (sql: string) =>
      withTenant(pool, tenant, (tx) => tx.query(sql)).then((done) => done.rowCount);
    expect(await as("UPDATE tenants SET currency = 'SAR'")).toBe(1);
    for (const column of ["name", "pack", "time_zone", "default_language"]) {
      await expect(as(`UPDATE tenants SET ${column} = 'x'`), column).rejects.toMatchObject({
        code: "42501",
      });
    }
    // Only its own row was in reach.
    expect(await rows("SELECT currency FROM tenants WHERE id = $1", [other])).toEqual([
      { currency: null },
    ]);
  });
});
