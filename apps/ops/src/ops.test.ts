// The operator's commands against PostgreSQL (ADR 0011, "Confirmation").

import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dbMain from "@polyglot-sales-agent/db";
import { APP_ROLE, CROSS_ROLE, type Database, MIGRATE_ROLE } from "@polyglot-sales-agent/db";
import * as dbOperator from "@polyglot-sales-agent/db/operator";
import { recorded } from "@polyglot-sales-agent/db/operator";
import {
  adopt,
  createTestDatabase,
  sqlState,
  type TestDatabase,
} from "@polyglot-sales-agent/db/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as opsCommands from "./commands.ts";
import {
  CHANNELS,
  PACKS,
  parse,
  RecordIncomplete,
  run,
  shown,
  USAGE,
  UsageError,
} from "./commands.ts";

let database: TestDatabase;
let crossPool: pg.Pool;
let cross: Database;
let administrator: pg.Client;
let lines: string[];
const output = { out: (line: string) => lines.push(line) };
const REFUSED = "42501";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  crossPool = new pg.Pool({ connectionString: database.url(CROSS_ROLE), max: 4 });
  cross = adopt(CROSS_ROLE, crossPool);
  administrator = await database.administrator();
}, 30_000);

afterAll(async () => {
  await crossPool.end();
  await database.drop();
});

beforeEach(async () => {
  // The record cannot be emptied, by design; each test reads what it added.
  await administrator.query(
    "TRUNCATE jobs, messages, conversations, contacts, channel_accounts, tenants CASCADE",
  );
  lines = [];
});

interface Row {
  invocation_id: string;
  phase: string;
  command: string;
  operator_name: string;
  arguments: Record<string, string>;
  outcome: string | null;
  subject_id: string | null;
}
let seen = 0;
/** The rows added to the record since the last call, oldest first. */
async function added(): Promise<Row[]> {
  const all = await administrator.query<Row>(
    `SELECT invocation_id, phase, command, operator_name, arguments, outcome, subject_id
     FROM operator_log ORDER BY at, phase DESC`,
  );
  const fresh = all.rows.slice(seen);
  seen = all.rows.length;
  return fresh;
}
const ops = (...argv: string[]) => run(cross, argv, output);
const CREATE = [
  "tenant",
  "create",
  "--name",
  "Noor Dental",
  "--pack",
  "booking",
  "--time-zone",
  "Asia/Riyadh",
  "--language",
  "ar",
];

async function deadJob(type = "send-messages"): Promise<string> {
  const made = await administrator.query<{ id: string }>(
    `INSERT INTO jobs (type, payload, run_at, attempts, state, last_error)
     VALUES ($1, '{}', clock_timestamp() + interval '1 hour', 6, 'dead', 'ECONNREFUSED') RETURNING id`,
    [type],
  );
  return made.rows[0]?.id as string;
}

describe("each command writes its two rows", () => {
  beforeEach(async () => {
    await added();
  });

  test("tenant create: makes the tenant, and records it by its identifier and never by its name", async () => {
    await ops(...CREATE, "--as", "Zeeshan");
    const tenants = await administrator.query(
      "SELECT id, name, pack, time_zone, default_language FROM tenants",
    );
    expect(tenants.rows).toEqual([
      {
        id: expect.stringMatching(UUID),
        name: "Noor Dental",
        pack: "booking",
        time_zone: "Asia/Riyadh",
        default_language: "ar",
      },
    ]);
    const id = tenants.rows[0]?.id as string;
    expect(lines).toEqual([`tenant created: ${id}`]);
    const rows = await added();
    const settings = { pack: "booking", timeZone: "Asia/Riyadh", language: "ar" };
    expect(rows).toEqual([
      {
        invocation_id: expect.stringMatching(UUID),
        phase: "started",
        command: "tenant create",
        operator_name: "Zeeshan",
        arguments: settings,
        outcome: null,
        subject_id: null,
      },
      {
        invocation_id: rows[0]?.invocation_id,
        phase: "finished",
        command: "tenant create",
        operator_name: "Zeeshan",
        arguments: settings,
        outcome: "ok",
        subject_id: id,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Noor");
  });

  test("tenant list: shows every tenant, oldest first, and nothing of any customer", async () => {
    await ops(...CREATE, "--as", "Zeeshan");
    await ops(
      "tenant",
      "create",
      "--name",
      'Second "Clinic"',
      "--pack",
      "faq-only",
      "--time-zone",
      "asia/karachi",
      "--language",
      "en-GB",
      "--as",
      "Zeeshan",
    );
    // Oldest first, whatever order their identifiers happen to have.
    await administrator.query(
      `UPDATE tenants SET created_at = CASE WHEN id = (SELECT max(id::text)::uuid FROM tenants)
         THEN timestamptz '2026-01-01' ELSE timestamptz '2026-02-01' END`,
    );
    const first = (
      await administrator.query<{ name: string }>("SELECT name FROM tenants ORDER BY created_at")
    ).rows[0]?.name as string;
    await added();
    lines = [];
    await ops("tenant", "list", "--as", "Zeeshan");
    expect(lines[0]).toBe("2 tenants");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(shown(first));
    const noor = lines.find((line) => line.includes("Noor")) as string;
    expect(noor).toMatch(
      /^[0-9a-f-]{36} {2}\S+Z {2}booking {2}Asia\/Riyadh {2}ar {2}"Noor Dental"$/,
    );
    // A name is printed in quotes; the zone is stored as the platform writes it, not as it was typed.
    const second = lines.find((line) => line.includes("Second")) as string;
    expect(second).toMatch(/faq-only {2}Asia\/Karachi {2}en-GB {2}"Second \\"Clinic\\""$/);
    expect(
      (await added()).map((row) => [
        row.phase,
        row.command,
        row.arguments,
        row.outcome,
        row.subject_id,
      ]),
    ).toEqual([
      ["started", "tenant list", {}, null, null],
      ["finished", "tenant list", {}, "ok", null],
    ]);
  });

  test("a name from the database is printed so that no character in it can move the cursor or reorder the line", async () => {
    await administrator.query(
      "INSERT INTO tenants (name, pack, time_zone, default_language) VALUES ($1, 'booking', 'UTC', 'en')",
      ["a\u001b[2Jb\u009bc\u202ed\ne\u0007\u2028f\u2029"],
    );
    await ops("tenant", "list", "--as", "Zeeshan");
    expect(
      lines[1]?.endsWith('"a\\u001b[2Jb\\u{9b}c\\u{202e}d\\ne\\u0007\\u{2028}f\\u{2029}"'),
    ).toBe(true);
    expect(/[\p{C}\p{Zl}\p{Zp}]/u.test(lines.join(""))).toBe(false);
    expect(shown("Noor نور")).toBe('"Noor نور"');
  });

  test("channel connect: a message to that number now reaches that tenant; recorded by identifiers", async () => {
    await ops(...CREATE, "--as", "Zeeshan");
    const tenantId = lines[0]?.replace("tenant created: ", "") as string;
    await added();
    lines = [];
    await ops(
      "channel",
      "connect",
      "--tenant",
      tenantId,
      "--channel",
      "whatsapp",
      "--number-id",
      "100000000000002",
      "--as",
      "Zeeshan",
    );
    const routes = await administrator.query(
      "SELECT tenant_id, receiving_number_id FROM channel_routes",
    );
    expect(routes.rows).toEqual([{ tenant_id: tenantId, receiving_number_id: "100000000000002" }]);
    const account = await administrator.query<{ id: string; channel: string }>(
      "SELECT id, channel FROM channel_accounts",
    );
    expect(account.rows[0]?.channel).toBe("whatsapp");
    expect(lines).toEqual([`channel connected: ${account.rows[0]?.id}`]);
    const settings = { tenantId, channel: "whatsapp", receivingNumberId: "100000000000002" };
    expect(
      (await added()).map((row) => [
        row.phase,
        row.command,
        row.arguments,
        row.outcome,
        row.subject_id,
      ]),
    ).toEqual([
      ["started", "channel connect", settings, null, null],
      ["finished", "channel connect", settings, "ok", account.rows[0]?.id],
    ]);
    // The same number again, for this tenant or another, is refused by the database and recorded.
    await expect(
      ops(
        "channel",
        "connect",
        "--tenant",
        tenantId,
        "--channel",
        "whatsapp",
        "--number-id",
        "100000000000002",
        "--as",
        "Zeeshan",
      ),
    ).rejects.toMatchObject({ code: "23505" });
    // A tenant that does not exist.
    const nobody = await ops(
      "channel",
      "connect",
      "--tenant",
      "00000000-0000-4000-8000-000000000009",
      "--channel",
      "whatsapp",
      "--number-id",
      "100000000000003",
      "--as",
      "Zeeshan",
    ).catch((error) => error);
    expect(nobody.code).toBe("23503");
    expect((await added()).map((row) => row.outcome)).toEqual([null, "23505", null, nobody.code]);
    expect((await administrator.query("SELECT 1 FROM channel_accounts")).rowCount).toBe(1);
  });

  test("jobs list-dead: shows the jobs that were given up, without what they hold", async () => {
    const id = await deadJob();
    await administrator.query(
      "INSERT INTO jobs (type, payload, run_at) VALUES ('send-messages', '{}', clock_timestamp())",
    );
    await ops("jobs", "list-dead", "--as", "Zeeshan");
    expect(lines[0]).toBe("1 dead job (the oldest 100 at most)");
    expect(lines[1]).toMatch(
      new RegExp(`^${id} {2}\\S+Z {2}send-messages {2}tenant - {2}runs 6 {2}ECONNREFUSED$`),
    );
    expect(lines).toHaveLength(2);
    expect((await added()).map((row) => [row.phase, row.command, row.outcome])).toEqual([
      ["started", "jobs list-dead", null],
      ["finished", "jobs list-dead", "ok"],
    ]);
  });

  test("jobs retry: puts a dead job back, due now, with its retries again", async () => {
    const id = await deadJob();
    await ops("jobs", "retry", id, "--as", "Zeeshan");
    expect(lines).toEqual([`job queued again: ${id} (send-messages)`]);
    const job = await administrator.query(
      "SELECT state, attempts, last_error, locked_until, run_at <= clock_timestamp() AS due FROM jobs WHERE id = $1",
      [id],
    );
    expect(job.rows).toEqual([
      { state: "queued", attempts: 0, last_error: null, locked_until: null, due: true },
    ]);
    expect(
      (await added()).map((row) => [row.phase, row.arguments, row.outcome, row.subject_id]),
    ).toEqual([
      ["started", { jobId: id }, null, null],
      ["finished", { jobId: id }, "ok", id],
    ]);
  });

  test("log show: shows the record, and is itself recorded", async () => {
    await ops(...CREATE, "--as", "Zeeshan");
    lines = [];
    await ops("log", "show", "--as", "Second Operator");
    expect(lines[0]).toMatch(/^the newest \d+ rows of the record$/);
    // Its own first row is there; its second is written after it has read.
    expect(lines[1]).toMatch(
      / {2}started {2}"log show" {2}as "Second Operator" {2}\{"limit":"50"\} {2}- {2}-$/,
    );
    expect(lines[2]).toMatch(
      / {2}finished {2}"tenant create" {2}as "Zeeshan" {2}\{.*\} {2}ok {2}[0-9a-f-]{36}$/,
    );
    expect(lines.join("\n")).not.toContain("Noor");
    // With a limit, that many and no more; the limit is recorded.
    lines = [];
    await added();
    await ops("log", "show", "--limit", "3", "--as", "Zeeshan");
    expect(lines).toHaveLength(4);
    expect((await added()).map((row) => row.arguments)).toEqual([{ limit: "3" }, { limit: "3" }]);
  });
});

describe("a command that fails, or is written wrongly", () => {
  beforeEach(async () => {
    await added();
  });

  test("a job that is not dead is left alone, and the failure is recorded with a code", async () => {
    const queued = await administrator.query<{ id: string }>(
      "INSERT INTO jobs (type, payload, run_at, attempts) VALUES ('send-messages', '{}', clock_timestamp() + interval '1 hour', 3) RETURNING id",
    );
    const id = queued.rows[0]?.id as string;
    await expect(ops("jobs", "retry", id, "--as", "Zeeshan")).rejects.toMatchObject({
      code: "no-dead-job",
      message: "ops: there is no dead job with that identifier",
    });
    expect(await administrator.query("SELECT attempts, state FROM jobs")).toMatchObject({
      rows: [{ attempts: 3, state: "queued" }],
    });
    expect((await added()).map((row) => [row.phase, row.outcome, row.subject_id])).toEqual([
      ["started", null, null],
      ["finished", "no-dead-job", null],
    ]);
    expect(lines).toEqual([]);
  });

  test("a fault of the database is recorded by its code, and thrown on", async () => {
    await administrator.query(
      "ALTER TABLE tenants ADD CONSTRAINT no_booking CHECK (pack <> 'booking')",
    );
    try {
      await expect(ops(...CREATE, "--as", "Zeeshan")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await administrator.query("ALTER TABLE tenants DROP CONSTRAINT no_booking");
    }
    expect((await added()).map((row) => [row.phase, row.outcome])).toEqual([
      ["started", null],
      ["finished", "23514"],
    ]);
  });

  test.each([
    [["tenant", "list"], "--as is needed"],
    [["tenant", "list", "--as", " "], "--as is needed"],
    [["tenant", "list", "--as", "someone@example.test"], "--as takes a name"],
    [["tenant", "list", "--as", "x".repeat(65)], "--as takes a name"],
    [["tenant", "list", "--as"], "--as needs a value"],
    [["tenant", "list", "--as", "a", "--as", "b"], "--as is given twice"],
    [["tenant", "list", "extra", "--as", "a"], "too many or too few words"],
    [["tenant", "list", "--name", "x", "--as", "a"], "--name is not an option of this command"],
    [["tenant", "delete", "--as", "a"], "there is no such command"],
    [["--as", "a"], "there is no such command"],
    [["tenant", "create", "--as", "a"], "--name is needed"],
    [
      [
        ...CREATE.slice(0, 4),
        "--pack",
        "pharmacy",
        "--time-zone",
        "Asia/Riyadh",
        "--language",
        "ar",
        "--as",
        "a",
      ],
      "--pack is one of: booking, faq-only",
    ],
    [
      [...CREATE.slice(0, 6), "--time-zone", "Mars/Olympus", "--language", "ar", "--as", "a"],
      "--time-zone is a named IANA time zone",
    ],
    [[...CREATE.slice(0, 8), "--language", "Arabic", "--as", "a"], "--language is a language tag"],
    [
      ["tenant", "create", "--name", "n".repeat(101), ...CREATE.slice(4), "--as", "a"],
      "--name is at most 100 characters",
    ],
    [["jobs", "retry", "--as", "a"], "too many or too few words"],
    [["jobs", "retry", "1; DROP TABLE jobs", "--as", "a"], "the job's identifier is not one"],
    [["tenant", "list", "--AS", "a"], "an option is not written as --name"],
    [["channel", "connect", "--as", "a"], "--tenant is needed"],
    [
      [
        "channel",
        "connect",
        "--tenant",
        "x",
        "--channel",
        "mock",
        "--number-id",
        "12345",
        "--as",
        "a",
      ],
      "--tenant is a tenant's identifier",
    ],
    [
      [
        "channel",
        "connect",
        "--tenant",
        "00000000-0000-4000-8000-000000000001",
        "--channel",
        "sms",
        "--number-id",
        "12345",
        "--as",
        "a",
      ],
      "--channel is one of: whatsapp",
    ],
    [
      [
        "channel",
        "connect",
        "--tenant",
        "00000000-0000-4000-8000-000000000001",
        "--channel",
        "mock",
        "--number-id",
        "12345",
        "--as",
        "a",
      ],
      "--channel is one of: whatsapp",
    ],
    [
      [
        "channel",
        "connect",
        "--tenant",
        "00000000-0000-4000-8000-000000000001",
        "--channel",
        "whatsapp",
        "--number-id",
        "+15550100",
        "--as",
        "a",
      ],
      "--number-id is the channel's identifier",
    ],
    [
      [
        "channel",
        "connect",
        "--tenant",
        "00000000-0000-4000-8000-000000000001",
        "--channel",
        "whatsapp",
        "--number-id",
        "1234",
        "--as",
        "a",
      ],
      "--number-id is the channel's identifier",
    ],
    [["tenant", "list", "--as", "--name"], "--as needs a value"],
    [["tenant", "list", "--as", "Zee\u015fan"], "--as takes a name"],
    [["log", "show", "extra", "--as", "a"], "too many or too few words"],
    [["log", "show", "--name", "x", "--as", "a"], "--name is not an option of this command"],
    [["log", "show", "--limit", "0", "--as", "a"], "--limit is a whole number from 1 to 1000"],
    [["log", "show", "--limit", "1001", "--as", "a"], "--limit is a whole number from 1 to 1000"],
    [["log", "show", "--limit", "5.5", "--as", "a"], "--limit is a whole number from 1 to 1000"],
    [
      [...CREATE.slice(0, 6), "--time-zone", "Etc/GMT+5", "--language", "ar", "--as", "a"],
      "--time-zone is a named IANA time zone",
    ],
    [
      ["tenant", "create", "--name", "a\u009bb", ...CREATE.slice(4), "--as", "a"],
      "--name has a character that cannot be printed",
    ],
    [
      ["tenant", "create", "--name", "a\u202eb", ...CREATE.slice(4), "--as", "a"],
      "--name has a character that cannot be printed",
    ],
    [
      ["tenant", "create", "--name", "a\u2028b", ...CREATE.slice(4), "--as", "a"],
      "--name has a character that cannot be printed",
    ],
    [["log", "show", "--limit", "01", "--as", "a"], "--limit is a whole number from 1 to 1000"],
  ])("%j is refused before anything is recorded or done", async (argv, message) => {
    const attempt = ops(...argv);
    await expect(attempt).rejects.toBeInstanceOf(UsageError);
    await expect(attempt).rejects.toThrow(message);
    expect(await added()).toEqual([]);
    expect((await administrator.query("SELECT 1 FROM tenants")).rowCount).toBe(0);
  });

  test("a refusal repeats nothing the operator typed", async () => {
    const error = await ops(
      "tenant",
      "create",
      "--name",
      "Private Person",
      "--pack",
      "+15550142",
      "--as",
      "a",
    ).catch((caught) => caught);
    expect(String(error.message)).not.toMatch(/Private|5550142/);
  });

  test("the usage text names every command and every pack", () => {
    for (const command of [
      "tenant create",
      "tenant list",
      "channel connect",
      "jobs list-dead",
      "jobs retry",
      "log show",
    ]) {
      expect(USAGE).toContain(`ops ${command}`);
    }
    expect(USAGE).toContain(PACKS.join("|"));
    // The one channel the worker can send on, and no other.
    expect(CHANNELS).toEqual(["whatsapp"]);
    expect(USAGE).toContain("letters without accents");
    expect(USAGE).toContain("waited over 15 minutes");
    expect(parse(["a", "--b", "c", "d"])).toEqual({ words: ["a", "d"], options: { b: "c" } });
  });
});

describe("the record", () => {
  test("if the first row cannot be written, the action does not run", async () => {
    let ran = false;
    await expect(
      recorded(
        cross,
        { command: "Not A Command!", operatorName: "Zeeshan", arguments: {} },
        async () => {
          ran = true;
          return { value: 1 };
        },
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(ran).toBe(false);
  });

  test("a command that was done but whose second row could not be written says so, prints its result, and is not a failure to repeat", async () => {
    await administrator.query(`
      CREATE FUNCTION refuse_finished() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused for the test'; END $$;
      CREATE TRIGGER refuse_finished BEFORE INSERT ON operator_log
        FOR EACH ROW WHEN (NEW.phase = 'finished') EXECUTE FUNCTION refuse_finished();`);
    await added();
    try {
      await expect(ops(...CREATE, "--as", "Zeeshan")).rejects.toBeInstanceOf(RecordIncomplete);
    } finally {
      await administrator.query(
        "DROP TRIGGER refuse_finished ON operator_log; DROP FUNCTION refuse_finished()",
      );
    }
    const made = await administrator.query<{ id: string }>("SELECT id FROM tenants");
    expect(made.rows).toHaveLength(1);
    expect(lines).toEqual([`tenant created: ${made.rows[0]?.id}`]);
    expect((await added()).map((row) => row.phase)).toEqual(["started"]);
  });

  test("the operator's role cannot choose a row's time or identifier, so a row cannot be dated back", async () => {
    const insert = (columns: string, values: string) =>
      sqlState(
        crossPool.query(
          `INSERT INTO operator_log (invocation_id, phase, command, operator_name${columns})
           VALUES (gen_random_uuid(), 'started', 'tenant list', 'x'${values})`,
        ),
      );
    expect(await insert(", at", ", '2001-01-01'")).toBe(REFUSED);
    expect(await insert(", id", ", gen_random_uuid()")).toBe(REFUSED);
    expect(await insert("", "")).toBe("none");
  });

  test("the first row is there while the action runs, so it stands if the process then stops", async () => {
    await added();
    let during: Row[] = [];
    await recorded(
      cross,
      { command: "tenant list", operatorName: "Zeeshan", arguments: {} },
      async () => {
        during = await added();
        return { value: 1 };
      },
    );
    expect(during.map((row) => row.phase)).toEqual(["started"]);
    expect((await added()).map((row) => row.phase)).toEqual(["finished"]);
  });

  test.each([
    ["an address", { owner: "someone@example.test" }],
    ["a phone number", { phone: "+15550142" }],
    ["a name with a space", { name: "Noor Dental" }],
    ["a number, not a word", { count: 3 }],
    ["something nested", { a: { b: "c" } }],
    ["a long value", { a: "x".repeat(65) }],
    ["an odd key", { "a b": "c" }],
    ["eleven entries", Object.fromEntries(Array.from({ length: 11 }, (_, n) => [`k${n}`, "v"]))],
    ["a list", ["a"]],
  ])("holds no %s: the database refuses such arguments", async (_what, value) => {
    expect(
      await sqlState(
        crossPool.query(
          "INSERT INTO operator_log (invocation_id, phase, command, operator_name, arguments) VALUES (gen_random_uuid(), 'started', 'tenant list', 'x', $1)",
          [JSON.stringify(value)],
        ),
      ),
    ).toBe("23514");
  });

  test("a finished row has an outcome and a started row has none; one of each for a command", async () => {
    const insert = (
      id: string,
      phase: string,
      outcome: string | null,
      subject: string | null = null,
    ) =>
      sqlState(
        crossPool.query(
          "INSERT INTO operator_log (invocation_id, phase, command, operator_name, outcome, subject_id) VALUES ($1, $2, 'tenant list', 'x', $3, $4)",
          [id, phase, outcome, subject],
        ),
      );
    const id = "00000000-0000-4000-8000-0000000000aa";
    const other = "00000000-0000-4000-8000-0000000000ab";
    expect(await insert(other, "started", "ok")).toBe("23514");
    expect(await insert(other, "finished", null)).toBe("23514");
    expect(await insert(other, "started", null, id)).toBe("23514");
    expect(await insert(other, "paused", null)).toBe("23514");
    expect(await insert(other, "finished", "has a space")).toBe("23514");
    expect(await insert(id, "started", null)).toBe("none");
    expect(await insert(id, "started", null)).toBe("23505");
  });

  test("no role can change or remove a row: not the application's, not the operator's, not the owner's", async () => {
    await ops("tenant", "list", "--as", "Zeeshan");
    const app = await database.client(APP_ROLE);
    const migrate = await database.client(MIGRATE_ROLE);
    const before = await administrator.query("SELECT count(*)::int AS n FROM operator_log");
    for (const [role, client] of [
      ["app", app],
      ["cross", crossPool],
      ["owner", migrate],
    ] as const) {
      expect(
        await sqlState(client.query("UPDATE operator_log SET outcome = 'ok'")),
        `${role} update`,
      ).toBe(REFUSED);
      expect(await sqlState(client.query("DELETE FROM operator_log")), `${role} delete`).toBe(
        REFUSED,
      );
      expect(await sqlState(client.query("TRUNCATE operator_log")), `${role} truncate`).toBe(
        REFUSED,
      );
    }
    // The application role, which serves the internet, can neither read it nor add to it.
    expect(await sqlState(app.query("SELECT 1 FROM operator_log"))).toBe(REFUSED);
    expect(
      await sqlState(
        app.query(
          "INSERT INTO operator_log (invocation_id, phase, command, operator_name) VALUES (gen_random_uuid(), 'started', 'tenant list', 'x')",
        ),
      ),
    ).toBe(REFUSED);
    const after = await administrator.query("SELECT count(*)::int AS n FROM operator_log");
    expect(after.rows).toEqual(before.rows);
  });
});

describe("the program itself", () => {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));
  function program(
    argv: string[],
    env: Record<string, string>,
  ): Promise<{ status: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [main, ...argv],
        { env: { PATH: process.env["PATH"] ?? "", ...env } },
        (error, stdout, stderr) => {
          resolve({ status: error === null ? 0 : Number(error.code ?? 1), stdout, stderr });
        },
      );
    });
  }

  test("runs a command and exits 0; a wrong command exits 2 with the usage; a failure exits 1 with its code", async () => {
    const env = { PSA_DB_CROSS_URL: database.url(CROSS_ROLE) };
    const listed = await program(["tenant", "list", "--as", "Zeeshan"], env);
    expect(listed).toEqual({ status: 0, stdout: "0 tenants\n", stderr: "" });
    const wrong = await program(["tenant", "remove", "--as", "Zeeshan"], env);
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain("ops: there is no such command");
    expect(wrong.stderr).toContain("ops tenant create");
    const failed = await program(
      ["jobs", "retry", "00000000-0000-4000-8000-000000000001", "--as", "Zeeshan"],
      env,
    );
    expect(failed).toEqual({
      status: 1,
      stdout: "",
      stderr: "ops: there is no dead job with that identifier\n",
    });
  }, 30_000);

  test("done, but the second row could not be written: the result, a warning not to repeat it, and exit 3", async () => {
    await administrator.query(`
      CREATE FUNCTION refuse_finished() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused for the test'; END $$;
      CREATE TRIGGER refuse_finished BEFORE INSERT ON operator_log
        FOR EACH ROW WHEN (NEW.phase = 'finished') EXECUTE FUNCTION refuse_finished();`);
    try {
      const listed = await program(["tenant", "list", "--as", "Zeeshan"], {
        PSA_DB_CROSS_URL: database.url(CROSS_ROLE),
      });
      expect(listed).toEqual({
        status: 3,
        stdout: "0 tenants\n",
        stderr:
          "ops: the command was done, but its second row could not be recorded; do not run it again\n",
      });
    } finally {
      await administrator.query(
        "DROP TRIGGER refuse_finished ON operator_log; DROP FUNCTION refuse_finished()",
      );
    }
  }, 30_000);

  test("without its setting, or with the wrong role's, it does nothing and shows no address", async () => {
    const none = await program(["tenant", "list", "--as", "Zeeshan"], {});
    expect(none).toEqual({ status: 1, stdout: "", stderr: "ops: PSA_DB_CROSS_URL is not set\n" });
    const wrongRole = await program(["tenant", "list", "--as", "Zeeshan"], {
      PSA_DB_CROSS_URL: database.url(APP_ROLE),
    });
    expect(wrongRole).toEqual({
      status: 1,
      stdout: "",
      stderr: "ops: PSA_DB_CROSS_URL does not reach the database as psa_cross\n",
    });
    // A command written wrongly is refused before the database is looked for at all.
    const wrong = await program(["tenant", "remove", "--as", "Zeeshan"], {});
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain("ops: there is no such command");
    const down = await program(["tenant", "list", "--as", "Zeeshan"], {
      PSA_DB_CROSS_URL: "postgres://psa_cross:secret-word@127.0.0.1:9/none",
    });
    expect(down.status).toBe(1);
    expect(down.stderr).not.toMatch(/secret-word|127\.0\.0\.1/);
    const help = await program(["--help"], {});
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("ops jobs retry");
  }, 30_000);
});

describe("nothing but ops can reach the operator's functions (ADR 0011, rule 2)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  function sources(): string[] {
    const found: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const name of readdirSync(`${root}${top}`, { recursive: true, encoding: "utf8" })) {
        const path = `${top}/${name}`;
        if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) && !/(^|\/)node_modules\//.test(path)) {
          found.push(path);
        }
      }
    }
    return found;
  }
  const OPERATOR =
    /["'`]@polyglot-sales-agent\/db\/operator["'`]|["'`][^"'`]*\/operator(\.ts)?["'`]/;

  test("only files of apps/ops import them, tests included", () => {
    // Outside the database package itself, where the module lives.
    const importers = sources()
      .filter((path) => !path.startsWith("packages/db/"))
      .filter((path) => OPERATOR.test(readFileSync(`${root}${path}`, "utf8")));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((path) => !path.startsWith("apps/ops/"))).toEqual([]);
    expect(OPERATOR.test('import { recorded } from "../../../packages/db/src/operator.ts";')).toBe(
      true,
    );
    expect(OPERATOR.test('import { storeInbound } from "@polyglot-sales-agent/db";')).toBe(false);
  });

  test("inside the database package nothing but the module itself names it, so nothing passes it on", () => {
    // A quote, or the `?` or `#` that would load the module a second time under another address.
    const NAMED = /operator(\.ts)?[?#"'`]/;
    const inside = sources()
      .filter(
        (path) => path.startsWith("packages/db/src/") && path !== "packages/db/src/operator.ts",
      )
      .filter((path) => NAMED.test(readFileSync(`${root}${path}`, "utf8")));
    expect(inside).toEqual([]);
    expect(NAMED.test('export * as things from "./operator.ts";')).toBe(true);
    expect(NAMED.test('export { createTenant as makeTenant } from "./operator";')).toBe(true);
    expect(NAMED.test('export { createTenant as makeTenant } from "./operator.ts?v";')).toBe(true);
  });

  test("the package's main entry, which the API and the worker import, gives out none of them under any name", () => {
    const main = new Set<unknown>(Object.values(dbMain));
    const operator = Object.entries(dbOperator);
    expect(operator.length).toBeGreaterThan(5);
    for (const [name, value] of operator) {
      expect(main.has(value), name).toBe(false);
    }
    // Nor wrapped in an object.
    for (const value of main) {
      if (typeof value === "object" && value !== null) {
        for (const inner of Object.values(value)) {
          expect(operator.some(([, theirs]) => theirs === inner)).toBe(false);
        }
      }
    }
  });

  test("nothing outside apps/ops imports from apps/ops, so its commands cannot be run from a route", () => {
    const FROM_OPS = /["'`]@polyglot-sales-agent\/ops["'`/]|["'`][^"'`]*\/ops\/src\/[^"'`]*["'`]/;
    const importers = sources()
      .filter((path) => !path.startsWith("apps/ops/"))
      .filter((path) => FROM_OPS.test(readFileSync(`${root}${path}`, "utf8")));
    expect(importers).toEqual([]);
    expect(FROM_OPS.test('import { run } from "../../ops/src/commands.ts";')).toBe(true);
    expect(FROM_OPS.test('import { run } from "@polyglot-sales-agent/ops";')).toBe(true);
    expect(Object.keys(opsCommands)).toContain("run");
  });
});
