// The job queue and the worker heartbeat (ADR 0004, NFR-R5, issue #187).
// Time is passed in, so these tests step a clock and never sleep.

import {
  JOB_CLAIM_MS,
  JOB_MAX_ATTEMPTS,
  JOB_STATES,
  OPERATOR_ALERT_JOB,
  WORKER_READY_WITHIN_MS,
} from "@polyglot-sales-agent/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  APP_ROLE,
  CROSS_ROLE,
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  type Job,
  MIGRATE_ROLE,
  recordHeartbeat,
  runNextJob,
  withTenant,
  workerReadiness,
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
const SECOND = 1_000;

let database: TestDatabase;
let app: pg.Pool;
let cross: pg.Client;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  app = new pg.Pool({ connectionString: database.url(APP_ROLE), max: 4 });
  cross = await database.client(CROSS_ROLE);
  a = await seedTenant(cross, app, "a", "+15550100");
  b = await seedTenant(cross, app, "b", "+15550101");
}, 30_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

beforeEach(async () => {
  await cross.query("DELETE FROM jobs");
  await cross.query("DELETE FROM worker_heartbeats");
});

interface Row {
  type: string;
  state: string;
  attempts: number;
  run_at: Date;
  last_error: string | null;
  payload: Record<string, string>;
}

async function rows(): Promise<Row[]> {
  const result = await cross.query<Row>(
    "SELECT type, state, attempts, run_at, last_error, payload FROM jobs ORDER BY created_at, type",
  );
  return result.rows;
}

function queue(type: string, runAt: Date = T0, tenantId: string | null = null): Promise<void> {
  return enqueueJob(cross, { type, tenantId, runAt });
}

describe("queueing a job", () => {
  test("the application role queues a job for its own tenant, in the transaction of its cause", async () => {
    await withTenant(app, a.tenantId, (tx) =>
      enqueueJob(tx, {
        type: "process-conversation",
        tenantId: a.tenantId,
        payload: { conversationId: a.conversationId },
        runAt: T0,
      }),
    );
    const job = await claimJob(cross, T0);
    expect(job).toMatchObject({
      type: "process-conversation",
      tenantId: a.tenantId,
      payload: { conversationId: a.conversationId },
      attempts: 1,
    });
  });

  test("a message and its job are stored together or not at all", async () => {
    const attempt = withTenant(app, a.tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, kind, channel_message_id)
         VALUES ($1, $2, 'inbound', 'text', 'mock-message-atomic')`,
        [a.tenantId, a.conversationId],
      );
      await enqueueJob(tx, { type: "process-conversation", tenantId: a.tenantId, runAt: T0 });
      throw new Error("the request failed after both inserts");
    });
    await expect(attempt).rejects.toThrow("the request failed");
    expect(await rows()).toEqual([]);
    const message = await withTenant(app, a.tenantId, (tx) =>
      tx.query("SELECT 1 FROM messages WHERE channel_message_id = 'mock-message-atomic'"),
    );
    expect(message.rowCount).toBe(0);
  });

  test("the application role cannot queue for another tenant or for none", async () => {
    for (const tenantId of [b.tenantId, null]) {
      const attempt = withTenant(app, a.tenantId, (tx) =>
        enqueueJob(tx, { type: "process-conversation", tenantId, runAt: T0 }),
      );
      await expect(attempt).rejects.toThrow("row-level security policy");
    }
    expect(await rows()).toEqual([]);
  });

  test("the application role cannot read, change or remove jobs", async () => {
    await queue("process-conversation", T0, a.tenantId);
    for (const statement of [
      "SELECT * FROM jobs",
      "UPDATE jobs SET state = 'dead'",
      "DELETE FROM jobs",
      `INSERT INTO jobs (type, tenant_id, run_at) VALUES ('x', '${a.tenantId}', now()) RETURNING id`,
      "SELECT * FROM worker_heartbeats",
      "INSERT INTO worker_heartbeats VALUES ('x', now(), now())",
    ]) {
      const attempt = withTenant(app, a.tenantId, (tx) => tx.query(statement));
      expect(await sqlState(attempt), statement).toBe("42501");
    }
  });

  test.each([[{ phone: "+15550100" }], [{ contactId: "+15550100" }], [{ body: "hello" }]])(
    "a payload that is not identifiers is refused and nothing is stored: %j",
    async (payload) => {
      await expect(
        enqueueJob(cross, { type: "x", tenantId: null, payload, runAt: T0 }),
      ).rejects.toThrow("enqueueJob:");
      expect(await rows()).toEqual([]);
    },
  );

  test("the database accepts exactly the job states of packages/core", async () => {
    const migrate = await database.client(MIGRATE_ROLE);
    const result = await migrate.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'jobs'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE 'CHECK ((state = ANY%'`,
    );
    expect(result.rows).toHaveLength(1);
    const allowed = [...(result.rows[0]?.definition ?? "").matchAll(/'([^']+)'::text/g)];
    expect(allowed.map((match) => match[1])).toEqual([...JOB_STATES]);
  });
});

describe("claiming", () => {
  test("nothing is claimed when nothing is due", async () => {
    expect(await claimJob(cross, T0)).toBeUndefined();
    await queue("later", after(10 * SECOND));
    expect(await claimJob(cross, after(10 * SECOND - 1))).toBeUndefined();
    expect((await claimJob(cross, after(10 * SECOND)))?.type).toBe("later");
  });

  test("the job that has waited longest comes first", async () => {
    await queue("second", after(2));
    await queue("first", after(1));
    await queue("third", after(3));
    const order = [];
    for (let job = await claimJob(cross, after(5)); job; job = await claimJob(cross, after(5))) {
      order.push(job.type);
    }
    expect(order).toEqual(["first", "second", "third"]);
  });

  test("four workers claiming at once never get the same job", async () => {
    const total = 40;
    for (let index = 0; index < total; index += 1) {
      await queue(`job-${index}`);
    }
    const workers = await Promise.all([1, 2, 3, 4].map(() => database.client(CROSS_ROLE)));
    const claimed = await Promise.all(
      workers.map(async (worker) => {
        const mine: string[] = [];
        for (let job = await claimJob(worker, T0); job; job = await claimJob(worker, T0)) {
          mine.push(job.id);
        }
        return mine;
      }),
    );
    const all = claimed.flat();
    expect(all).toHaveLength(total);
    expect(new Set(all).size).toBe(total);
    expect(
      claimed.filter((mine) => mine.length > 0).length,
      "more than one worker took part",
    ).toBeGreaterThan(1);
  });

  test("a finished job is removed", async () => {
    await queue("once");
    const job = (await claimJob(cross, T0)) as Job;
    expect(await completeJob(cross, job)).toBe(true);
    expect(await rows()).toEqual([]);
  });
});

describe("a job that fails (NFR-R5)", () => {
  test("is retried 5 times, after 2, 4, 8, 16 and 32 seconds, then is dead with an alert queued", async () => {
    await queue("always-fails", T0, a.tenantId);
    let now = T0;
    const runs: number[] = [];
    const handlers = {
      "always-fails": async () => {
        runs.push(now.getTime() - T0.getTime());
        throw Object.assign(new Error("+15550100 said hello"), { code: "send-rejected" });
      },
    };
    const results: string[] = [];
    for (const wait of [0, 2, 4, 8, 16, 32]) {
      // One millisecond before it is due, it is not run.
      now = new Date(now.getTime() + wait * SECOND - 1);
      if (wait > 0) {
        expect(await runNextJob(cross, handlers, () => now)).toEqual({ ran: false });
      }
      now = new Date(now.getTime() + 1);
      const outcome = await runNextJob(cross, handlers, () => now);
      results.push(outcome.ran ? outcome.result : "nothing");
    }
    expect(results).toEqual(["retry", "retry", "retry", "retry", "retry", "dead"]);
    expect(runs).toEqual([0, 2, 6, 14, 30, 62].map((seconds) => seconds * SECOND));

    const [dead, alert] = await rows();
    expect(dead).toMatchObject({
      type: "always-fails",
      state: "dead",
      attempts: JOB_MAX_ATTEMPTS,
      last_error: "send-rejected",
    });
    expect(alert).toMatchObject({ type: OPERATOR_ALERT_JOB, state: "queued", attempts: 0 });
    expect(Object.keys(alert?.payload ?? {})).toEqual(["jobId"]);
    // It is never run again, however long one waits.
    now = after(24 * 60 * 60 * SECOND);
    const next = await runNextJob(cross, handlers, () => now);
    expect(next.ran && next.job.type).toBe(OPERATOR_ALERT_JOB);
    expect(runs).toHaveLength(JOB_MAX_ATTEMPTS);
  });

  test("the error's message is never stored, only a short code", async () => {
    await queue("fails");
    const job = (await claimJob(cross, T0)) as Job;
    expect(await failJob(cross, job, new Error("+15550100 said hello"), T0)).toBe("retry");
    const stored = JSON.stringify(await rows());
    expect(stored).not.toContain("15550100");
    expect(stored).not.toContain("hello");
    expect((await rows())[0]?.last_error).toBe("Error");
  });

  test("a job with no handler is not lost: it fails like any other", async () => {
    await queue("nobody-handles-this");
    const outcome = await runNextJob(cross, {}, () => T0);
    expect(outcome).toMatchObject({ ran: true, result: "retry" });
    expect(await rows()).toMatchObject([
      { state: "queued", attempts: 1, last_error: "no-handler" },
    ]);
  });

  test("a dead alert raises no alert of its own", async () => {
    await queue(OPERATOR_ALERT_JOB);
    let now = T0;
    for (let run = 0; run < JOB_MAX_ATTEMPTS; run += 1) {
      await runNextJob(cross, {}, () => now);
      now = new Date(now.getTime() + 60 * SECOND);
    }
    expect(await rows()).toMatchObject([{ type: OPERATOR_ALERT_JOB, state: "dead" }]);
  });

  test("a successful run after a failure removes the job", async () => {
    await queue("flaky");
    let fail = true;
    const handlers = {
      flaky: async () => {
        if (fail) {
          throw new Error("first time");
        }
      },
    };
    expect(await runNextJob(cross, handlers, () => T0)).toMatchObject({ result: "retry" });
    fail = false;
    expect(await runNextJob(cross, handlers, () => after(2 * SECOND))).toMatchObject({
      result: "done",
    });
    expect(await rows()).toEqual([]);
  });
});

describe("a worker that dies while holding a job (NFR-R1)", () => {
  test("the job is claimed again once its claim runs out, and not before", async () => {
    await queue("held");
    const first = (await claimJob(cross, T0)) as Job;
    expect(await claimJob(cross, after(JOB_CLAIM_MS - 1))).toBeUndefined();
    const second = (await claimJob(cross, after(JOB_CLAIM_MS))) as Job;
    expect(second).toMatchObject({ id: first.id, attempts: 2 });
  });

  test("the first worker, if it was only slow, can no longer finish or fail the job", async () => {
    await queue("held");
    const slow = (await claimJob(cross, T0)) as Job;
    const taker = (await claimJob(cross, after(JOB_CLAIM_MS))) as Job;
    expect(await completeJob(cross, slow)).toBe(false);
    expect(await failJob(cross, slow, new Error("late"), after(JOB_CLAIM_MS))).toBe("not-held");
    expect(await rows()).toMatchObject([{ state: "running", attempts: 2, last_error: null }]);
    expect(await completeJob(cross, taker)).toBe(true);
  });

  test("a job whose worker dies every time ends dead with an alert, and is not claimed for ever", async () => {
    await queue("kills-its-worker", T0, a.tenantId);
    let now = T0;
    for (let run = 1; run <= JOB_MAX_ATTEMPTS; run += 1) {
      expect((await claimJob(cross, now))?.attempts).toBe(run);
      now = new Date(now.getTime() + JOB_CLAIM_MS);
    }
    // This claim finds the job lost for the last time. The alert it queues is claimed next.
    expect(await claimJob(cross, now)).toBeUndefined();
    expect(await rows()).toMatchObject([
      { type: "kills-its-worker", state: "dead", last_error: "worker-lost" },
      { type: OPERATOR_ALERT_JOB, state: "queued" },
    ]);
    expect((await claimJob(cross, now))?.type).toBe(OPERATOR_ALERT_JOB);
  });
});

describe("the worker heartbeat (issue #187)", () => {
  test("no worker has ever been seen", async () => {
    expect(await workerReadiness(cross, T0)).toEqual({ ready: false, lastSeenAt: undefined });
  });

  test("a worker is ready while it was seen within three heartbeats, and not after", async () => {
    await recordHeartbeat(cross, "worker-1", T0);
    expect(await workerReadiness(cross, after(WORKER_READY_WITHIN_MS))).toEqual({
      ready: true,
      lastSeenAt: T0,
    });
    expect((await workerReadiness(cross, after(WORKER_READY_WITHIN_MS + 1))).ready).toBe(false);
    await recordHeartbeat(cross, "worker-1", after(WORKER_READY_WITHIN_MS + 1));
    expect((await workerReadiness(cross, after(WORKER_READY_WITHIN_MS + 2))).ready).toBe(true);
  });

  test("one live worker is enough, and a worker not seen for a day is forgotten", async () => {
    await recordHeartbeat(cross, "worker-old", T0);
    const day = 24 * 60 * 60 * SECOND;
    await recordHeartbeat(cross, "worker-new", after(day + 1));
    expect((await workerReadiness(cross, after(day + 2))).ready).toBe(true);
    const known = await cross.query("SELECT worker_id, started_at FROM worker_heartbeats");
    expect(known.rows).toEqual([{ worker_id: "worker-new", started_at: after(day + 1) }]);
  });

  test("a worker name that is not a plain token is refused", async () => {
    expect(await sqlState(recordHeartbeat(cross, "worker 1; drop", T0))).toBe("23514");
  });
});
