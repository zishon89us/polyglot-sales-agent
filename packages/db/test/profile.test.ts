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
  replaceProfile,
  storeInbound,
  withTenant,
} from "../src/index.ts";
import { adopt, createTestDatabase, type TestDatabase } from "./harness.ts";

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
    expect(await load({ settings: SETTINGS })).toMatchObject({
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
      running = load({ settings: SETTINGS });
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

  test("the database itself refuses a name twice in one tenant, whatever the case, and allows it in another", async () => {
    await load(BASE);
    await expect(
      administrator.query(
        "INSERT INTO services (tenant_id, name, price_minor) VALUES ($1, 'haircut', 1)",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      administrator.query(
        "INSERT INTO policies (tenant_id, title, body) VALUES ($1, 'PAYMENT', 'x')",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await load(BASE, other);
    expect(await rows("SELECT count(*)::int AS n FROM services")).toEqual([{ n: 6 }]);
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
    expect(text).not.toMatch(/updated|20[0-9][0-9]-/);
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

  test("a price wider than JSON carries is refused by the loader long before it could be misread here", async () => {
    await load({ settings: SETTINGS, services: [{ name: "Costly", price_minor: 2 ** 53 - 1 }] });
    expect((await profile()).services[0]?.priceMinor).toBe(9007199254740991);
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

  test("A3: no channel account; another tenant's channel does not count", async () => {
    await load(BASE);
    await administrator.query(
      "INSERT INTO channel_accounts (tenant_id, channel, receiving_number_id) VALUES ($1, 'mock', $2)",
      [other, NUMBER],
    );
    expect(await answering(app, tenant)).toEqual({ settingsMissing: [], channelConnected: false });
  });

  test("A4, A5: business hours with no period at all are set; opening hours, services and policies are not needed", async () => {
    await load({ settings: { ...SETTINGS, business_hours: [] } });
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

describe('who may do what (section 5, "Which role writes")', () => {
  test("the cross-tenant role can neither read nor write a tenant's services, policies or settings", async () => {
    await load(BASE);
    const cross = new pg.Client({ connectionString: database.url(CROSS_ROLE) });
    await cross.connect();
    try {
      for (const statement of [
        "SELECT 1 FROM services",
        "SELECT 1 FROM policies",
        "UPDATE services SET price_minor = 0",
        "DELETE FROM policies",
        "INSERT INTO policies (tenant_id, title, body) SELECT id, 't', 'b' FROM tenants",
        "UPDATE tenants SET currency = 'KWD'",
        "UPDATE tenants SET support_contact = '+15550199'",
      ]) {
        await expect(cross.query(statement), statement).rejects.toMatchObject({ code: "42501" });
      }
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
