// The M2 exit criterion as a test: the real programs, each started as its
// own process with settings in the environment, against a database of the
// test's own. A tenant is made and its number connected with the operator's
// commands; a message goes in through the stand-in for WhatsApp and the
// echo comes back. `docker compose up` runs the same programs with the same
// settings; CI runs this round trip against that too.

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { APP_ROLE, CROSS_ROLE } from "../packages/db/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../packages/db/test/harness.ts";
import { echoRoundTrip } from "./e2e.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const NUMBER = "100000000000002";
const CUSTOMER = "+15550142";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Running {
  readonly child: ChildProcess;
  output: string;
  exit: Promise<number | null>;
}

let database: TestDatabase;
let settings: Record<string, string>;
let mockUrl: string;
const running: Record<string, Running> = {};

function start(name: string, file: string, extra: Record<string, string> = {}): Running {
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { PATH: process.env["PATH"] ?? "", ...settings, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state: Running = {
    child,
    output: "",
    exit: new Promise((resolve) => child.once("exit", (code) => resolve(code))),
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    state.output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    state.output += chunk.toString("utf8");
  });
  running[name] = state;
  return state;
}

function ops(...argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["apps/ops/src/main.ts", ...argv, "--as", "end-to-end"],
      { cwd: root, env: { PATH: process.env["PATH"] ?? "", ...settings } },
      (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error(stderr))),
    );
  });
}

beforeAll(async () => {
  database = await createTestDatabase({ migrate: true });
  const [apiPort, mockPort] = [await freePort(), await freePort()];
  mockUrl = `http://127.0.0.1:${mockPort}`;
  settings = {
    PSA_ENV: "development",
    PSA_DB_APP_URL: database.url(APP_ROLE),
    PSA_DB_CROSS_URL: database.url(CROSS_ROLE),
    PSA_API_PORT: String(apiPort),
    PSA_WHATSAPP_APP_SECRET: "local-only-app-signing-value",
    PSA_WHATSAPP_VERIFY_TOKEN: "local-only-verify-value",
    PSA_WHATSAPP_BASE_URL: mockUrl,
    PSA_WHATSAPP_API_VERSION: "v27.0",
    PSA_WHATSAPP_ACCESS_TOKEN: "local-only-mock-token",
    PSA_MODEL_ADAPTER: "stand-in-echo",
    PSA_PROMPT_CANARY: "localonlycanary0000000000000000",
    PSA_MOCK_ACCESS_TOKEN: "local-only-mock-token",
    PSA_MOCK_PORT: String(mockPort),
    PSA_MOCK_WEBHOOK_URL: `http://127.0.0.1:${apiPort}/webhooks/whatsapp`,
  };
  const created = await ops(
    "tenant",
    "create",
    "--name",
    "End To End Clinic",
    "--pack",
    "booking",
    "--time-zone",
    "Asia/Karachi",
    "--language",
    "en",
  );
  const tenant = created.replace("tenant created: ", "").trim();
  await ops(
    "channel",
    "connect",
    "--tenant",
    tenant,
    "--channel",
    "whatsapp",
    "--number-id",
    NUMBER,
  );
  // A tenant answers only once its profile is loaded (order of checks, step 8).
  await ops(
    "profile",
    "load",
    "--tenant",
    tenant,
    "--file",
    "packages/core/fixtures/profile.salon.en.json",
  );
  start("mock", "apps/mock-whatsapp/src/main.ts");
  start("api", "apps/api/src/main.ts");
  start("worker", "apps/worker/src/main.ts");
}, 60_000);

afterAll(async () => {
  for (const state of Object.values(running)) {
    state.child.kill("SIGKILL");
  }
  await database.drop();
});

describe("the walking skeleton, end to end (M2 exit criterion)", () => {
  test("a customer's message through the stand-in for WhatsApp comes back as an echo, once", async () => {
    const first = await echoRoundTrip({
      mockUrl,
      numberId: NUMBER,
      from: CUSTOMER,
      timeoutMs: 30_000,
    });
    expect(first.received).toBe(`Echo: ${first.sent}`);
    // And again, now that everything is up: a second message, a second echo, no more.
    const second = await echoRoundTrip({
      mockUrl,
      numberId: NUMBER,
      from: CUSTOMER,
      timeoutMs: 30_000,
    });
    expect(second.received).toBe(`Echo: ${second.sent}`);
    const sent = (await (await fetch(`${mockUrl}/mock/sent`)).json()) as { sent: unknown[] };
    expect(sent.sent).toHaveLength(2);
  }, 90_000);

  test("after the stand-in is stopped and started again, with the database kept, a message is still echoed", async () => {
    // As `docker compose up` a second time without removing the volume. A stand-in that
    // counted its messages from 1 again would have them taken for ones already seen.
    const before = running["mock"];
    before?.child.kill("SIGKILL");
    await before?.exit;
    start("mock", "apps/mock-whatsapp/src/main.ts");
    const third = await echoRoundTrip({
      mockUrl,
      numberId: NUMBER,
      from: CUSTOMER,
      timeoutMs: 30_000,
    });
    expect(third.received).toBe(`Echo: ${third.sent}`);
    const fourth = await echoRoundTrip({
      mockUrl,
      numberId: NUMBER,
      from: CUSTOMER,
      timeoutMs: 30_000,
    });
    expect(fourth.received).toBe(`Echo: ${fourth.sent}`);
  }, 90_000);

  test("a message to a number no tenant has is taken and answered by nobody", async () => {
    const before = (await (await fetch(`${mockUrl}/mock/sent`)).json()) as { sent: unknown[] };
    const response = await fetch(`${mockUrl}/mock/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId: "999000000000001", from: CUSTOMER, text: "anyone?" }),
    });
    expect(await response.json()).toMatchObject({ webhookStatus: 200 });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const after = (await (await fetch(`${mockUrl}/mock/sent`)).json()) as { sent: unknown[] };
    expect(after.sent).toHaveLength(before.sent.length);
  }, 30_000);

  test("the product is healthy and ready, and nothing it printed holds the customer's number or words", async () => {
    const api = `http://127.0.0.1:${settings["PSA_API_PORT"]}`;
    expect((await fetch(`${api}/healthz`)).status).toBe(200);
    expect((await fetch(`${api}/readyz`)).status).toBe(200);
    const printed = `${running["api"]?.output}${running["worker"]?.output}`;
    expect(printed).toContain('"service":"api","event":"listening"');
    expect(printed).toContain('"service":"worker","event":"running"');
    // NFR-O2: every line each of the two wrote is the one shape, and no other.
    for (const name of ["api", "worker"]) {
      const lines = (running[name]?.output ?? "").split("\n").filter((line) => line !== "");
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines) {
        expect(Object.keys(JSON.parse(line)), line).toEqual([
          "time",
          "level",
          "service",
          "event",
          "code",
          "requestId",
          "tenantId",
          "conversationId",
          "jobId",
          "names",
          "n",
        ]);
        expect(line).not.toContain('"invalid"');
      }
    }
    expect(printed).not.toMatch(/5550142|end to end|anyone\?|local-only/);
  });

  test("told to stop, the worker and the API finish and exit cleanly", async () => {
    for (const name of ["worker", "api"]) {
      running[name]?.child.kill("SIGTERM");
    }
    // A second signal while it is stopping changes nothing.
    running["api"]?.child.kill("SIGINT");
    expect(await running["worker"]?.exit).toBe(0);
    expect(running["worker"]?.output).toContain('"service":"worker","event":"stopped"');
    expect(await running["api"]?.exit).toBe(0);
    const api = running["api"]?.output ?? "";
    expect(api.match(/"event":"stopped"/g)).toHaveLength(1);
    expect(api).toContain('"level":"info","service":"api","event":"stopped"');
    expect(api).toContain(`"n":{"port":${settings["PSA_API_PORT"]}}`);
    await expect(fetch(`http://127.0.0.1:${settings["PSA_API_PORT"]}/healthz`)).rejects.toThrow();
  }, 30_000);
});

describe("in production the programs themselves refuse (issue #165)", () => {
  function refused(
    file: string,
    extra: Record<string, string>,
  ): Promise<{ code: number; text: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [file],
        // A program that should refuse and does not would run for ever: stop it.
        {
          cwd: root,
          env: { PATH: process.env["PATH"] ?? "", ...settings, ...extra },
          timeout: 10_000,
          killSignal: "SIGKILL",
        },
        (error, stdout, stderr) =>
          resolve({
            code: error === null ? 0 : Number(error.code ?? 1),
            text: `${stdout}${stderr}`,
          }),
      );
    });
  }
  const production = { PSA_ENV: "production" };

  test("the stand-in for WhatsApp, whatever else is set", async () => {
    const result = await refused("apps/mock-whatsapp/src/main.ts", {
      ...production,
      PSA_MOCK_PORT: String(await freePort()),
    });
    expect(result).toEqual({
      code: 1,
      text: "mock-whatsapp: will not start in production: this is a development component and has no place in production\n",
    });
  });

  test("the API and the worker with the development settings, naming each and showing none", async () => {
    const api = await refused("apps/api/src/main.ts", {
      ...production,
      PSA_API_PORT: String(await freePort()),
    });
    expect(api.code).toBe(1);
    // One line, in the one shape: a code, the settings at fault and why, and no sentence.
    expect(JSON.parse(api.text)).toMatchObject({
      level: "error",
      service: "api",
      event: "could-not-start",
      code: "not-for-production",
      names: [
        "PSA_WHATSAPP_BASE_URL",
        "PSA_DB_APP_URL",
        "PSA_DB_CROSS_URL",
        "PSA_WHATSAPP_APP_SECRET",
        "PSA_WHATSAPP_VERIFY_TOKEN",
        "stand-in-channel",
        "placeholder-secret",
      ],
    });
    const worker = await refused("apps/worker/src/main.ts", production);
    expect(worker.code).toBe(1);
    expect(JSON.parse(worker.text)).toMatchObject({
      service: "worker",
      event: "could-not-start",
      code: "not-for-production",
    });
    expect(JSON.parse(worker.text).names).toContain("shared-channel-credential");
    // The stand-in for the model is refused on its own account.
    expect(JSON.parse(worker.text).names).toContain("stand-in-model");
    expect(`${api.text}${worker.text}`).not.toMatch(/local-only|psa_app:|127\.0\.0\.1/);
  });

  test("no setting at all for where it runs is refused too: there is no default", async () => {
    for (const file of [
      "apps/api/src/main.ts",
      "apps/worker/src/main.ts",
      "apps/mock-whatsapp/src/main.ts",
    ]) {
      const result = await refused(file, { PSA_ENV: "" });
      expect(result.code, file).toBe(1);
      if (file.includes("mock-whatsapp")) {
        expect(result.text, file).toContain("PSA_ENV must be set to development or production");
      } else {
        expect(JSON.parse(result.text), file).toMatchObject({
          event: "could-not-start",
          code: "settings",
          names: ["PSA_ENV"],
        });
      }
    }
  });

  test("the set-up script, which makes a demo tenant, runs in development and nowhere else", async () => {
    for (const where of ["production", ""]) {
      const result = await new Promise<{ code: number; text: string }>((resolve) => {
        execFile(
          "sh",
          ["tools/dev-setup.sh"],
          {
            cwd: root,
            env: { PATH: process.env["PATH"] ?? "", ...settings, PSA_ENV: where },
            timeout: 10_000,
          },
          (error, stdout, stderr) =>
            resolve({
              code: error === null ? 0 : Number(error.code ?? 1),
              text: `${stdout}${stderr}`,
            }),
        );
      });
      expect(result).toEqual({
        code: 1,
        text: "dev-setup: PSA_ENV is not development; this script is for development only\n",
      });
    }
  });

  test("the mock listens on this machine, or on every interface for a container, and on nothing else", async () => {
    const result = await refused("apps/mock-whatsapp/src/main.ts", { PSA_MOCK_HOST: "192.0.2.7" });
    expect(result).toEqual({
      code: 1,
      text: "mock-whatsapp: PSA_MOCK_HOST is 127.0.0.1 or 0.0.0.0\n",
    });
    const port = await freePort();
    const every = start("mock-everywhere", "apps/mock-whatsapp/src/main.ts", {
      PSA_MOCK_HOST: "0.0.0.0",
      PSA_MOCK_PORT: String(port),
    });
    await expect.poll(() => every.output, { timeout: 10_000 }).toContain("listening on");
    // It says so, and does not name the one address that would look safe.
    expect(every.output).toBe(
      `mock-whatsapp: listening on EVERY interface of this machine or container, port ${port}\n`,
    );
    every.child.kill("SIGKILL");
  });
});
