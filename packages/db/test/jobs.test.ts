// The job queue and the worker heartbeat (ADR 0004, NFR-R5, issue #187).
// Most tests pass the time in and step it. A few use the database's own
// clock, and one waits 50 ms for a handler to time out.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  cancelJobs,
  claimJob,
  completeJob,
  deadJobs,
  deferJob,
  enqueueJob,
  failJob,
  type Job,
  MIGRATE_ROLE,
  recordHeartbeat,
  replaceJob,
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

// A fixed time in the future: the application role may not date a job into the past.
const T0 = new Date("2100-01-01T00:00:00.000Z");
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
      subjectId: null,
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

  test("the application role sees which of its tenant's jobs exist, not what they hold, and no other tenant's", async () => {
    await enqueueJob(cross, {
      type: "mine",
      tenantId: a.tenantId,
      payload: { contactId: a.contactId },
    });
    await enqueueJob(cross, { type: "theirs", tenantId: b.tenantId });
    await queue("nobodys");
    const seen = await withTenant(app, a.tenantId, (tx) =>
      tx.query("SELECT type, tenant_id, state FROM jobs"),
    );
    expect(seen.rows).toEqual([{ type: "mine", tenant_id: a.tenantId, state: "queued" }]);
    for (const statement of [
      "SELECT * FROM jobs",
      "SELECT payload FROM jobs",
      "SELECT last_error FROM jobs",
      "SELECT run_at FROM jobs",
      "UPDATE jobs SET state = 'dead'",
      "UPDATE jobs SET run_at = now()",
      "SELECT * FROM worker_heartbeats",
      "INSERT INTO worker_heartbeats VALUES ('x', now(), now())",
    ]) {
      const attempt = withTenant(app, a.tenantId, (tx) => tx.query(statement));
      expect(await sqlState(attempt), statement).toBe("42501");
    }
  });

  test("what the application role may not put in a job is refused by the database itself", async () => {
    const insert = (columns: string, values: string) =>
      sqlState(
        withTenant(app, a.tenantId, (tx) =>
          tx.query(
            `INSERT INTO jobs (tenant_id, run_at, ${columns}) VALUES ($1, now(), ${values})`,
            [a.tenantId],
          ),
        ),
      );
    expect(await insert("type", "'fine'"), "the control: a plain job is accepted").toBe("none");
    // A column it may not set.
    expect(await insert("type, state", "'x', 'dead'")).toBe("42501");
    expect(await insert("type, attempts", "'x', 999")).toBe("42501");
    expect(await insert("type, last_error", "'x', 'forged'")).toBe("42501");
    expect(await insert("type, id", "'x', gen_random_uuid()")).toBe("42501");
    expect(await insert("type, locked_until", "'x', now()")).toBe("42501");
    // A value the table refuses from anyone.
    expect(await insert("type, payload", `'x', '{"phone":"+15550100"}'`)).toBe("23514");
    expect(await insert("type, payload", `'x', '{"contactId":"Ali Khan"}'`)).toBe("23514");
    expect(await insert("type, payload", `'x', '[]'`)).toBe("23514");
    expect(await insert("type", "'send to +15550100: hello'")).toBe("23514");
    // The queue's own type.
    expect(await insert("type", `'${OPERATOR_ALERT_JOB}'`)).toBe("42501");
    // An endless time is refused from anyone, the cross-tenant role included.
    for (const endless of ["-infinity", "infinity"]) {
      const insert = cross.query("INSERT INTO jobs (type, run_at) VALUES ('x', $1)", [endless]);
      expect(await sqlState(insert), endless).toBe("23514");
    }
    for (const past of ["now() - interval '2 minutes'", "'1970-01-01'"]) {
      const dated = withTenant(app, a.tenantId, (tx) =>
        tx.query(`INSERT INTO jobs (tenant_id, type, run_at) VALUES ($1, 'x', ${past})`, [
          a.tenantId,
        ]),
      );
      expect(await sqlState(dated), `dated into the past: ${past}`).toBe("42501");
    }
    // More keys than a payload may have, put straight into the table by the role that may write anything.
    const many = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`k${"x".repeat(index)}Id`, a.tenantId]),
    );
    expect(
      await sqlState(
        cross.query("INSERT INTO jobs (type, payload, run_at) VALUES ('x', $1, now())", [
          JSON.stringify(many),
        ]),
      ),
    ).toBe("23514");
    await expect(enqueueJob(cross, { type: "x", tenantId: null, payload: many })).rejects.toThrow(
      "enqueueJob: the payload has more than 20 keys",
    );
    expect((await rows()).map((row) => row.type)).toEqual(["fine"]);
  });

  test("a type or a payload that could carry data is refused before the database is asked", async () => {
    await expect(
      enqueueJob(cross, { type: "send to +15550100: hello", tenantId: null }),
    ).rejects.toThrow("enqueueJob: the type is not a plain lower-case name");
    for (const payload of [{ phone: "+15550100" }, { contactId: "+15550100" }, { body: "hello" }]) {
      // With and without a tenant: the check does not depend on who the job is for.
      for (const tenantId of [null, a.tenantId]) {
        await expect(enqueueJob(cross, { type: "x", tenantId, payload })).rejects.toThrow(
          "enqueueJob:",
        );
      }
    }
    expect(await rows()).toEqual([]);
  });

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
      await queue("bulk");
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
    await enqueueJob(cross, {
      type: "always-fails",
      tenantId: a.tenantId,
      payload: { contactId: a.contactId },
      runAt: T0,
    });
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
        expect(await runNextJob(cross, handlers, { clock: () => now })).toEqual({ ran: false });
      }
      now = new Date(now.getTime() + 1);
      const outcome = await runNextJob(cross, handlers, { clock: () => now });
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
    // The alert names the dead job and carries nothing of it: no tenant, no payload.
    expect(Object.keys(alert?.payload ?? {})).toEqual(["jobId"]);
    expect(await deadJobs(cross)).toEqual({ dead: 1, deadAlerts: 0 });
    // It is never run again, however long one waits.
    now = after(24 * 60 * 60 * SECOND);
    const next = await runNextJob(cross, handlers, { clock: () => now });
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
    const outcome = await runNextJob(cross, {}, { clock: () => T0 });
    expect(outcome).toMatchObject({ ran: true, result: "retry" });
    expect(await rows()).toMatchObject([
      { state: "queued", attempts: 1, last_error: "no-handler" },
    ]);
  });

  test("a dead alert raises no alert of its own", async () => {
    await queue(OPERATOR_ALERT_JOB);
    let now = T0;
    for (let run = 0; run < JOB_MAX_ATTEMPTS; run += 1) {
      await runNextJob(cross, {}, { clock: () => now });
      now = new Date(now.getTime() + 60 * SECOND);
    }
    expect(await rows()).toMatchObject([{ type: OPERATOR_ALERT_JOB, state: "dead" }]);
    // Its only trace: the count the worker's probe prints.
    expect(await deadJobs(cross)).toEqual({ dead: 1, deadAlerts: 1 });
  });

  test("a job put back after a failure can no longer be finished or failed by that run", async () => {
    await queue("fails");
    const job = (await claimJob(cross, T0)) as Job;
    expect(await failJob(cross, job, new Error("x"), T0)).toBe("retry");
    // Same job, same attempt number, but it is queued now, not this worker's.
    expect(await completeJob(cross, job)).toBe(false);
    expect(await failJob(cross, job, new Error("again"), T0)).toBe("not-held");
    expect(await rows()).toMatchObject([{ state: "queued", attempts: 1, last_error: "Error" }]);
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
    expect(await runNextJob(cross, handlers, { clock: () => T0 })).toMatchObject({
      result: "retry",
    });
    fail = false;
    expect(await runNextJob(cross, handlers, { clock: () => after(2 * SECOND) })).toMatchObject({
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

describe("timers: a job about a subject can be cancelled or replaced (architecture, Timers)", () => {
  const timer = (runInMs: number, tenant = a) => ({
    type: "session-end",
    tenantId: tenant.tenantId,
    subjectId: tenant.conversationId,
    runAt: T0,
    runInMs,
  });

  test("the application role cancels its tenant's queued timer in its own transaction", async () => {
    await withTenant(app, a.tenantId, (tx) => enqueueJob(tx, timer(60 * SECOND)));
    await withTenant(app, b.tenantId, (tx) => enqueueJob(tx, timer(60 * SECOND, b)));
    const cancelled = await withTenant(app, a.tenantId, (tx) => cancelJobs(tx, timer(0)));
    expect(cancelled).toBe(1);
    expect((await rows()).map((row) => row.type)).toEqual(["session-end"]);
    expect((await claimJob(cross, after(60 * SECOND)))?.tenantId).toBe(b.tenantId);
  });

  test("replacing leaves one timer, due at the new time", async () => {
    await withTenant(app, a.tenantId, (tx) => replaceJob(tx, timer(60 * SECOND)));
    await withTenant(app, a.tenantId, (tx) => replaceJob(tx, timer(90 * SECOND)));
    expect(await rows()).toMatchObject([{ type: "session-end", run_at: after(90 * SECOND) }]);
  });

  test("a replacement that fails with its transaction leaves the old timer", async () => {
    await withTenant(app, a.tenantId, (tx) => replaceJob(tx, timer(60 * SECOND)));
    const attempt = withTenant(app, a.tenantId, async (tx) => {
      await replaceJob(tx, timer(90 * SECOND));
      throw new Error("the state change failed");
    });
    await expect(attempt).rejects.toThrow("the state change failed");
    expect(await rows()).toMatchObject([{ run_at: after(60 * SECOND) }]);
  });

  test("a tenant cannot cancel another tenant's timer, a running job, or a job about something else", async () => {
    await withTenant(app, a.tenantId, (tx) => enqueueJob(tx, timer(0)));
    await enqueueJob(cross, {
      type: "other",
      tenantId: a.tenantId,
      subjectId: a.contactId,
      runAt: after(1),
    });
    const asB = await withTenant(app, b.tenantId, (tx) =>
      cancelJobs(tx, { type: "session-end", tenantId: a.tenantId, subjectId: a.conversationId }),
    );
    expect(asB).toBe(0);
    const everything = await withTenant(app, b.tenantId, (tx) => tx.query("DELETE FROM jobs"));
    expect(everything.rowCount).toBe(0);
    // The timer is now running; only the other job is still queued.
    expect((await claimJob(cross, T0))?.type).toBe("session-end");
    expect(await withTenant(app, a.tenantId, (tx) => cancelJobs(tx, timer(0)))).toBe(0);
    const own = await withTenant(app, a.tenantId, (tx) => tx.query("DELETE FROM jobs"));
    expect(own.rowCount, "of its own jobs, it can remove the queued one only").toBe(1);
    expect(await rows()).toMatchObject([{ type: "session-end", state: "running" }]);
  });
});

describe("putting a job back for later (ADR 0004)", () => {
  test("a deferred job does not use up an attempt and runs after the wait", async () => {
    await queue("busy-conversation");
    let now = T0;
    const handlers = { "busy-conversation": async () => ({ deferMs: 500 }) };
    for (let round = 0; round < 20; round += 1) {
      expect(await runNextJob(cross, handlers, { clock: () => now })).toMatchObject({
        result: "deferred",
      });
      const early = new Date(now.getTime() + 499);
      expect(await runNextJob(cross, handlers, { clock: () => early })).toEqual({ ran: false });
      now = new Date(now.getTime() + 500);
    }
    expect(await rows()).toMatchObject([{ state: "queued", attempts: 0, last_error: null }]);
  });

  test("a worker that no longer holds the job cannot defer it", async () => {
    await queue("held");
    const slow = (await claimJob(cross, T0)) as Job;
    await claimJob(cross, after(JOB_CLAIM_MS));
    expect(await deferJob(cross, slow, 500, after(JOB_CLAIM_MS))).toBe(false);
    expect(await rows()).toMatchObject([{ state: "running", attempts: 2 }]);
  });
});

describe("the database's clock is the clock", () => {
  test("with no time passed in, a job queued now is due now and one queued for later is not", async () => {
    await enqueueJob(cross, { type: "now", tenantId: null });
    await enqueueJob(cross, { type: "later", tenantId: null, runInMs: 60 * 60 * SECOND });
    expect((await claimJob(cross))?.type).toBe("now");
    expect(await claimJob(cross)).toBeUndefined();
    const claim = await cross.query<{ seconds: number }>(
      `SELECT extract(epoch FROM locked_until - now())::float AS seconds
       FROM jobs WHERE state = 'running'`,
    );
    expect(
      claim.rows[0]?.seconds,
      "claimed for five minutes of the database's time",
    ).toBeGreaterThan(JOB_CLAIM_MS / SECOND - 5);
    expect(claim.rows[0]?.seconds).toBeLessThanOrEqual(JOB_CLAIM_MS / SECOND);
  });

  test("a failed job waits two seconds of the database's time", async () => {
    await enqueueJob(cross, { type: "fails", tenantId: null });
    expect(await runNextJob(cross, {})).toMatchObject({ result: "retry" });
    const wait = await cross.query<{ seconds: number }>(
      "SELECT extract(epoch FROM run_at - now())::float AS seconds FROM jobs",
    );
    expect(wait.rows[0]?.seconds).toBeGreaterThan(1.5);
    expect(wait.rows[0]?.seconds).toBeLessThanOrEqual(2);
  });

  test("a heartbeat recorded now makes the worker ready now", async () => {
    await recordHeartbeat(cross, "worker-1");
    expect((await workerReadiness(cross)).ready).toBe(true);
  });
});

describe("running a handler", () => {
  test("the handler gets the job and finishes it", async () => {
    await enqueueJob(cross, {
      type: "process-conversation",
      tenantId: a.tenantId,
      subjectId: a.conversationId,
      payload: { conversationId: a.conversationId },
      runAt: T0,
    });
    const seen: Job[] = [];
    const outcome = await runNextJob(
      cross,
      {
        "process-conversation": async (job) => {
          seen.push(job);
        },
      },
      { clock: () => T0 },
    );
    expect(outcome).toMatchObject({ ran: true, result: "done" });
    expect(seen).toMatchObject([
      {
        tenantId: a.tenantId,
        subjectId: a.conversationId,
        payload: { conversationId: a.conversationId },
      },
    ]);
    expect(await rows()).toEqual([]);
  });

  test("a handler is looked up among the handlers given, not among what they inherit", async () => {
    const inherited = Object.create({ inherited: async () => undefined }) as Record<string, never>;
    await queue("inherited");
    expect(await runNextJob(cross, inherited, { clock: () => T0 })).toMatchObject({
      result: "retry",
    });
    expect(await rows()).toMatchObject([{ state: "queued", last_error: "no-handler" }]);
  });

  test("a handler that throws something that is not an error still fails the job", async () => {
    await queue("throws-text");
    const outcome = await runNextJob(
      cross,
      {
        "throws-text": async () => {
          throw "+15550100 said hello";
        },
      },
      { clock: () => T0 },
    );
    expect(outcome).toMatchObject({ result: "retry" });
    expect(await rows()).toMatchObject([{ state: "queued", last_error: "unknown" }]);
  });

  test("an error that cannot even be read still fails the job", async () => {
    await queue("hostile");
    const hostile = {
      get code(): string {
        throw new Error("no");
      },
    };
    const outcome = await runNextJob(
      cross,
      {
        hostile: async () => {
          throw hostile;
        },
      },
      { clock: () => T0 },
    );
    expect(outcome).toMatchObject({ result: "retry" });
    expect(await rows()).toMatchObject([{ state: "queued", last_error: "unknown" }]);
  });

  test("a handler that never returns is failed after its time, and told to stop", async () => {
    await queue("hangs");
    let aborted = false;
    const outcome = await runNextJob(
      cross,
      {
        hangs: (_job, signal) =>
          new Promise<void>(() => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      },
      { clock: () => T0, timeoutMs: 50 },
    );
    expect(outcome).toMatchObject({ result: "retry" });
    expect(aborted).toBe(true);
    expect(await rows()).toMatchObject([{ state: "queued", last_error: "handler-timeout" }]);
  });

  test.each([
    ["null", null],
    ["an empty object", {}],
    ["a list", []],
    ["a wait that is not a number", { deferMs: Number.NaN }],
    ["an endless wait", { deferMs: Number.POSITIVE_INFINITY }],
    ["a negative wait", { deferMs: -1 }],
    ["a wait of more than an hour", { deferMs: 60 * 60 * SECOND + 1 }],
    ["a wait given as text", { deferMs: "500" }],
  ])(
    "a handler that returns %s fails the run; the job is not left claimed",
    async (_what, result) => {
      await queue("returns-nonsense");
      const outcome = await runNextJob(
        cross,
        { "returns-nonsense": async () => result as never },
        { clock: () => T0 },
      );
      expect(outcome).toMatchObject({ result: "retry" });
      expect(await rows()).toMatchObject([{ state: "queued", last_error: "bad-handler-result" }]);
    },
  );

  test("the clock is read again after the handler: the wait starts when the run ended", async () => {
    await queue("slow-then-fails");
    let now = T0;
    await runNextJob(
      cross,
      {
        "slow-then-fails": async () => {
          now = after(30 * SECOND);
          throw new Error("failed after 30 seconds");
        },
      },
      { clock: () => now },
    );
    expect(await rows()).toMatchObject([{ run_at: after(32 * SECOND) }]);
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

  test("one live worker is enough while a dead one is still remembered", async () => {
    await recordHeartbeat(cross, "worker-dead", T0);
    await recordHeartbeat(cross, "worker-live", after(60 * SECOND));
    const known = await cross.query("SELECT count(*)::int AS n FROM worker_heartbeats");
    expect(known.rows[0]?.n).toBe(2);
    expect(await workerReadiness(cross, after(61 * SECOND))).toEqual({
      ready: true,
      lastSeenAt: after(60 * SECOND),
    });
  });

  test("a worker is remembered for a day and no longer; its start time is kept", async () => {
    const day = 24 * 60 * 60 * SECOND;
    await recordHeartbeat(cross, "worker-old", T0);
    await recordHeartbeat(cross, "worker-new", after(SECOND));
    await recordHeartbeat(cross, "worker-new", after(day));
    const names = async () =>
      (await cross.query("SELECT worker_id FROM worker_heartbeats ORDER BY 1")).rows.map(
        (row) => row.worker_id,
      );
    expect(await names(), "exactly a day: still remembered").toEqual(["worker-new", "worker-old"]);
    await recordHeartbeat(cross, "worker-new", after(day + 1));
    expect(await names()).toEqual(["worker-new"]);
    const kept = await cross.query("SELECT started_at, last_seen_at FROM worker_heartbeats");
    expect(kept.rows).toEqual([{ started_at: after(SECOND), last_seen_at: after(day + 1) }]);
  });

  test("the probe command exits 0 when a worker is alive and 1 when none is", async () => {
    const run = async (): Promise<{ code: number; out: string }> => {
      try {
        const done = await promisify(execFile)(
          process.execPath,
          [fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "worker-status"],
          { env: { ...process.env, PSA_DB_CROSS_URL: database.url(CROSS_ROLE) } },
        );
        return { code: 0, out: done.stdout };
      } catch (error) {
        const failed = error as { code: number; stdout: string };
        return { code: failed.code, out: failed.stdout };
      }
    };
    const none = await run();
    expect(none).toMatchObject({ code: 1 });
    expect(none.out).toContain("db: worker not ready, last seen never");
    await recordHeartbeat(cross, "worker-1");
    const alive = await run();
    expect(alive).toMatchObject({ code: 0 });
    expect(alive.out).toContain("db: worker ready, last seen 20");
    expect(alive.out).toContain("db: dead jobs 0, of which undelivered alerts 0");
  }, 20_000);

  test("a worker name that is not a plain token is refused", async () => {
    expect(await sqlState(recordHeartbeat(cross, "worker 1; drop", T0))).toBe("23514");
  });
});
