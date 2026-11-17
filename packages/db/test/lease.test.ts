// The conversation lease (ADR 0004; architecture, "Processing one turn").
// The unit's "done when": two workers never process one conversation at
// once, and a worker that lost the lease has its late result discarded.

import { LEASE_MS } from "@polyglot-sales-agent/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  CROSS_ROLE,
  holdsLease,
  releaseLease,
  renewLease,
  takeLease,
  withTenant,
} from "../src/index.ts";
import {
  createTestDatabase,
  type SeededTenant,
  seedTenant,
  sqlState,
  type TestDatabase,
} from "./harness.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const after = (ms: number): Date => new Date(T0.getTime() + ms);

let database: TestDatabase;
let app: pg.Pool;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 6 });
  const cross = await database.client(CROSS_ROLE);
  a = await seedTenant(cross, app, "a", "+15550100");
  b = await seedTenant(cross, app, "b", "+15550101");
}, 30_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

beforeEach(async () => {
  for (const tenant of [a, b]) {
    await withTenant(app, tenant.tenantId, (tx) =>
      tx.query("UPDATE conversations SET lease_token = NULL, lease_expires_at = NULL"),
    );
  }
});

const take = (now: Date, tenant = a, conversationId = a.conversationId) =>
  withTenant(app, tenant.tenantId, (tx) => takeLease(tx, conversationId, now));

/** What a worker does when its work is done: store the result only if the lease is still its own. */
function storeResult(token: string, body: string): Promise<"stored" | "discarded"> {
  return withTenant(app, a.tenantId, async (tx) => {
    if (!(await holdsLease(tx, a.conversationId, token))) {
      return "discarded";
    }
    await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, class, kind, body, status)
       VALUES ($1, $2, 'outbound', 'assistant-reply', 'text', $3, 'pending')`,
      [a.tenantId, a.conversationId, body],
    );
    return "stored";
  });
}

const stored = (body: string) =>
  withTenant(
    app,
    a.tenantId,
    async (tx) => (await tx.query("SELECT 1 FROM messages WHERE body = $1", [body])).rowCount,
  );

describe("taking the lease", () => {
  test("one worker holds a conversation; a second is refused until the lease runs out", async () => {
    const first = await take(T0);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await take(after(1))).toBeUndefined();
    expect(await take(after(LEASE_MS - 1))).toBeUndefined();
    const second = await take(after(LEASE_MS));
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  test("of two workers that try at the same moment, exactly one gets it, fifty times over", async () => {
    for (let round = 0; round < 50; round += 1) {
      const now = after(round * 2 * LEASE_MS);
      const [one, two] = await Promise.all([take(now), take(now)]);
      expect(
        [one, two].filter((token) => token !== undefined),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });

  test("a lease on one conversation does not hold another", async () => {
    expect(await take(T0)).toBeDefined();
    expect(await take(T0, b, b.conversationId)).toBeDefined();
  });

  test("another tenant cannot take, check or release a conversation's lease", async () => {
    const token = (await take(T0)) as string;
    expect(await take(after(LEASE_MS), b, a.conversationId)).toBeUndefined();
    const asB = await withTenant(app, b.tenantId, async (tx) => {
      const holds = await holdsLease(tx, a.conversationId, token);
      await releaseLease(tx, a.conversationId, token);
      return holds;
    });
    expect(asB).toBe(false);
    expect(await storeResult(token, "still mine")).toBe("stored");
  });
});

describe("keeping and giving back the lease", () => {
  test("renewing extends it by two minutes from the renewal", async () => {
    const token = (await take(T0)) as string;
    const renewed = await withTenant(app, a.tenantId, (tx) =>
      renewLease(tx, a.conversationId, token, after(100_000)),
    );
    expect(renewed).toBe(true);
    expect(await take(after(100_000 + LEASE_MS - 1))).toBeUndefined();
    expect(await take(after(100_000 + LEASE_MS))).toBeDefined();
  });

  test("a worker that lost the lease cannot renew it", async () => {
    const old = (await take(T0)) as string;
    await take(after(LEASE_MS));
    const renewed = await withTenant(app, a.tenantId, (tx) =>
      renewLease(tx, a.conversationId, old, after(LEASE_MS + 1)),
    );
    expect(renewed).toBe(false);
  });

  test("releasing frees the conversation at once; a stale token releases nothing", async () => {
    const old = (await take(T0)) as string;
    await withTenant(app, a.tenantId, (tx) => releaseLease(tx, a.conversationId, old));
    const next = (await take(after(1))) as string;
    expect(next).toBeDefined();
    await withTenant(app, a.tenantId, (tx) => releaseLease(tx, a.conversationId, old));
    expect(await take(after(2)), "the stale release must not free the new lease").toBeUndefined();
  });

  test("a token and its expiry are set together or not at all", async () => {
    const half = withTenant(app, a.tenantId, (tx) =>
      tx.query("UPDATE conversations SET lease_token = gen_random_uuid()"),
    );
    expect(await sqlState(half)).toBe("23514");
  });
});

describe("storing a result", () => {
  test("a worker that still holds the lease stores its result", async () => {
    const token = (await take(T0)) as string;
    expect(await storeResult(token, "on time")).toBe("stored");
    expect(await stored("on time")).toBe(1);
  });

  test("a worker that lost the lease has its late result discarded", async () => {
    const slow = (await take(T0)) as string;
    // The slow worker's model call outlasts the lease, and another worker takes over.
    const taker = (await take(after(LEASE_MS))) as string;
    expect(await storeResult(slow, "late")).toBe("discarded");
    expect(await stored("late")).toBe(0);
    expect(await storeResult(taker, "from the worker that took over")).toBe("stored");
  });

  test("an expired lease that nobody took is still the worker's own", async () => {
    const token = (await take(T0)) as string;
    // Nothing reads the clock here: only another worker's token ends a lease.
    expect(await storeResult(token, "slow but alone")).toBe("stored");
  });

  test("while a result is being stored, no other worker can take the lease", async () => {
    const token = (await take(T0)) as string;
    let finish: () => void = () => undefined;
    const storing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let checked: () => void = () => undefined;
    const hasChecked = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const store = withTenant(app, a.tenantId, async (tx) => {
      const holds = await holdsLease(tx, a.conversationId, token);
      checked();
      await storing;
      return holds;
    });
    await hasChecked;
    let taken: string | undefined | "pending" = "pending";
    const taking = take(after(LEASE_MS)).then((result) => {
      taken = result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(taken, "the take must wait for the store to finish").toBe("pending");
    finish();
    expect(await store).toBe(true);
    await taking;
    expect(taken, "and then succeeds, the lease having expired").toMatch(/^[0-9a-f-]{36}$/);
  });
});
