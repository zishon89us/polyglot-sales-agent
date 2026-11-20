// The boundary test of ADR 0012, "Confirmation": the core names nothing of
// the booking pack, and imports no pack.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BOOKING_WORDS, comparable, KNOWN_EXCEPTION } from "./names.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

/** What is not the core, and why. Everything else under `apps` and `packages` is. */
const NOT_CORE: Record<string, string> = {
  "packages/packs": "the packs themselves",
  "apps/ops": "the operator's tool, which names the packs a tenant can be created on",
  "apps/mock-whatsapp": "a stand-in for the channel, in no deployment",
  "packages/channel-mock": "the in-memory channel of the tests",
};

/** The core's folders, found on disk: a new app or package is scanned without being added here. */
const CORE: string[] = ["apps", "packages"]
  .flatMap((top) =>
    readdirSync(`${root}${top}`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${top}/${entry.name}`),
  )
  .filter((folder) => !Object.hasOwn(NOT_CORE, folder))
  .sort();

/** Every file of the core that is not a test, with its lines. */
function files(): { path: string; lines: string[] }[] {
  const found: { path: string; lines: string[] }[] = [];
  for (const directory of CORE) {
    for (const name of readdirSync(`${root}${directory}`, { recursive: true, encoding: "utf8" })) {
      const path = `${directory}/${name}`;
      if (
        /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql)$/i.test(name) &&
        !/\.test\.[a-z]+$/i.test(name) &&
        !/(^|\/)(node_modules|fixtures)\//.test(path)
      ) {
        found.push({ path, lines: readFileSync(`${root}${path}`, "utf8").split("\n") });
      }
    }
  }
  return found;
}

/**
 * The lines of the core that do name the pack, each accepted for a stated
 * reason. A new one fails the test; so does one of these that has gone.
 */
const ACCEPTED: Record<string, string> = {
  // Comments that explain the one exception.
  "packages/core/src/names.ts: // `late-change`. The booking pack's names live in the pack (ADR 0012).":
    "explains the exception",
  "packages/core/src/names.ts: * `late-change` is raised by the booking pack and is a known exception to the":
    "explains the exception",
  "packages/core/src/names.ts: * rule that the core names nothing about bookings (ADR 0012).":
    "explains the exception",
  // A comment in a migration that is already applied, and so cannot be reworded.
  "packages/db/migrations/0002_jobs_and_lease.up.sql: -- What the job is about (a conversation, later a booking or a handover),":
    "a comment in an applied migration",
};

describe("the core names nothing of the booking pack (ADR 0012)", () => {
  test("the scan covers the core's files, migrations included, and no pack", () => {
    const paths = files().map((file) => file.path);
    for (const expected of [
      "packages/core/src/names.ts",
      "packages/db/migrations/0001_core_tables.up.sql",
      "packages/db/src/outbound.ts",
      "apps/api/src/webhook.ts",
      "apps/worker/src/handlers.ts",
    ]) {
      expect(paths).toContain(expected);
    }
    expect(paths.some((path) => path.startsWith("packages/packs/"))).toBe(false);
    expect(paths.length).toBeGreaterThan(40);
    // The folders left out are these four and no other, and each is there.
    expect(Object.keys(NOT_CORE).sort()).toEqual([
      "apps/mock-whatsapp",
      "apps/ops",
      "packages/channel-mock",
      "packages/packs",
    ]);
    expect(CORE).toEqual([
      "apps/api",
      "apps/worker",
      "packages/channel",
      "packages/channel-whatsapp",
      "packages/core",
      "packages/db",
    ]);
  });

  test("no line of the core holds one of the pack's words, but the accepted ones", () => {
    const found: string[] = [];
    for (const file of files()) {
      // A file's own name is looked at like a line of it.
      if (BOOKING_WORDS.some((word) => comparable(file.path).includes(word))) {
        found.push(`${file.path}: (the file's name)`);
      }
      for (const line of file.lines) {
        const plain = comparable(line);
        if (BOOKING_WORDS.some((word) => plain.includes(word))) {
          found.push(`${file.path}: ${line.trim()}`);
        }
      }
    }
    expect(found.sort()).toEqual(Object.keys(ACCEPTED).sort());
  });

  test("the words would be seen in the forms they take", () => {
    for (const line of [
      "CREATE TABLE bookings (",
      "  REFERENCES booking_service_settings (id)",
      "const bookingId = job.payload.bookingId;",
      'app.get("/slots", handler);',
      'app.get("/blocked-periods", handler);',
      "const REMINDER_LEAD = 24;",
      "FROM blocked_periods",
      "const blockedPeriod = rows[0];",
      "CREATE TABLE slot_holds (",
      "slotInterval: 30,",
      "minNotice: 120,",
      "min_notice_minutes integer",
      "changeCutoff: 24,",
      "booking_horizon_days integer",
      "capacity integer NOT NULL",
      'buttons: ["Confirm", "Reschedule", "Cancel"]',
      "noShowRate: sessions.noShow / sessions.total",
      "no_show boolean",
      "-- marks a no show",
      "blocked period",
      "apps/api/src/bookings.ts",
    ]) {
      const plain = comparable(line);
      expect(
        BOOKING_WORDS.some((word) => plain.includes(word)),
        line,
      ).toBe(true);
    }
    // Every word is already in the form it is compared in.
    for (const word of BOOKING_WORDS) {
      expect(comparable(word)).toBe(word);
    }
  });

  test("a migration is a migration whatever the case of its extension", () => {
    const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql)$/i;
    expect(SOURCE.test("0009_x.up.SQL")).toBe(true);
    // The pattern used by the scan is this one.
    expect(files.toString()).toContain(`/${SOURCE.source}/i`);
  });

  test("the one name the core does hold is the handover reason, and only in its list of names", () => {
    const holders = files()
      .filter((file) => file.lines.some((line) => line.includes(KNOWN_EXCEPTION)))
      .map((file) => file.path);
    expect(holders).toEqual(["packages/core/src/names.ts"]);
  });
});

describe("the core imports no pack (ADR 0012)", () => {
  const PACK =
    /["'`]@polyglot-sales-agent\/pack-[^"'`]*["'`]|["'`][^"'`]*\/packs?(-[a-z-]+)?\/[^"'`]*["'`]/;

  test("no file of the core, tests included, imports one", () => {
    const importers: string[] = [];
    for (const directory of CORE) {
      for (const name of readdirSync(`${root}${directory}`, {
        recursive: true,
        encoding: "utf8",
      })) {
        if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)) {
          const path = `${directory}/${name}`;
          if (PACK.test(readFileSync(`${root}${path}`, "utf8"))) {
            importers.push(path);
          }
        }
      }
    }
    // Until the registry of the pack interface exists (M3 to M5), nothing of the product imports a pack at all.
    expect(importers).toEqual([]);
    expect(PACK.test('import { BOOKING_WORDS } from "@polyglot-sales-agent/pack-booking";')).toBe(
      true,
    );
    expect(PACK.test('import x from "../../packs/booking/src/names.ts";')).toBe(true);
    expect(PACK.test('import { echoReply } from "@polyglot-sales-agent/core";')).toBe(false);
  });

  test("no package of the core depends on one", () => {
    for (const directory of CORE) {
      const manifest = JSON.parse(readFileSync(`${root}${directory}/package.json`, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const names = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ];
      expect(
        names.filter((name) => name.includes("/pack-")),
        directory,
      ).toEqual([]);
    }
  });
});
