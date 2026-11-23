// The boundary test of ADR 0012, "Confirmation": the core names nothing of
// the booking pack, and imports no pack. Since ADR 0014 the core side may
// import the pack interface, and two files the registry; the rules are at
// the end of this file.

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
      "packages/ai",
      "packages/channel",
      "packages/channel-whatsapp",
      "packages/core",
      "packages/db",
      "packages/pack-interface",
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

// What ADR 0014 lets the core side import of the packs. A package's name
// tells which of three things it is: `pack-interface`, `packs-registry`, or
// a pack, `pack-<name>`. That is why `interface` and `registry` are not
// names a pack may have.
const quoted = (inside: string): RegExp => new RegExp(`["'\`]${inside}["'\`]`);
/** A pack itself, by its package's name or by a path into its folder. */
const A_PACK = new RegExp(
  `${quoted("@polyglot-sales-agent/pack-(?!interface[\"'`/])[^\"'`]*").source}|${
    quoted("[^\"'`]*/packs/(?!registry[\"'`/])[^\"'`]*").source
  }`,
);
const THE_INTERFACE = new RegExp(
  `${quoted("@polyglot-sales-agent/pack-interface(/[^\"'`]*)?").source}|${
    quoted("[^\"'`]*/pack-interface(/[^\"'`]*)?").source
  }`,
);
const THE_REGISTRY = new RegExp(
  `${quoted("@polyglot-sales-agent/packs-registry(/[^\"'`]*)?").source}|${
    quoted("[^\"'`]*/packs/registry(/[^\"'`]*)?").source
  }`,
);

/**
 * A way round: a string that begins as the interface or the registry and
 * then goes up or into what is installed, and so can end anywhere. It is
 * counted as an import of a pack.
 */
const A_WAY_ROUND = quoted(
  "[^\"'`]*(?:pack-interface|packs-registry|packs/registry)/[^\"'`]*(?:\\.\\.|node_modules)[^\"'`]*",
);
const reachesAPack = (text: string): boolean => A_PACK.test(text) || A_WAY_ROUND.test(text);

// What none of these rules can see: a name put together from parts
// ("@polyglot-sales-agent/" + "pack-…"), a path written with backslashes,
// and a folder's name in another case on a disk that ignores case.

/** The folders that may not know a pack exists at all (ADR 0014, "Registration"). */
const KNOWS_NO_PACK = [
  "packages/core",
  "packages/db",
  "packages/channel",
  "packages/channel-whatsapp",
];
/** The only files that may import the registry, to pass it to what they start. */
const MAY_IMPORT_REGISTRY = ["apps/api/src/main.ts", "apps/worker/src/main.ts"];
/** The only packages that may depend on it. */
const MAY_DEPEND_ON_REGISTRY = ["apps/api", "apps/worker"];

/** Every source file of the core side, tests included: a test may not import a pack either. */
function sources(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const directory of CORE) {
    for (const name of readdirSync(`${root}${directory}`, { recursive: true, encoding: "utf8" })) {
      const path = `${directory}/${name}`;
      if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) && !/(^|\/)node_modules\//.test(path)) {
        found.push({ path, text: readFileSync(`${root}${path}`, "utf8") });
      }
    }
  }
  return found;
}

function dependencies(directory: string): string[] {
  const manifest = JSON.parse(readFileSync(`${root}${directory}/package.json`, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
}

describe("what the core side may import of the packs (ADR 0012, ADR 0014)", () => {
  test("B3: no file of the core side, tests included, imports a pack, and no package depends on one", () => {
    expect(
      sources()
        .filter((file) => reachesAPack(file.text))
        .map((file) => file.path),
    ).toEqual([]);
    for (const directory of CORE) {
      expect(
        dependencies(directory).filter(
          (name) => /\/pack-/.test(name) && !name.endsWith("/pack-interface"),
        ),
        directory,
      ).toEqual([]);
    }
  });

  test("B2: the core, the database package and the channel packages import neither the interface nor the registry", () => {
    // The list is this one: a folder taken out of it is seen here.
    expect(KNOWS_NO_PACK).toEqual([
      "packages/core",
      "packages/db",
      "packages/channel",
      "packages/channel-whatsapp",
    ]);
    for (const folder of KNOWS_NO_PACK) {
      expect(CORE, folder).toContain(folder);
    }
    expect(
      sources()
        .filter((file) => KNOWS_NO_PACK.some((folder) => file.path.startsWith(`${folder}/`)))
        .filter((file) => THE_INTERFACE.test(file.text) || THE_REGISTRY.test(file.text))
        .map((file) => file.path),
    ).toEqual([]);
    for (const directory of KNOWS_NO_PACK) {
      expect(
        dependencies(directory).filter((name) => /\/packs?-/.test(name)),
        directory,
      ).toEqual([]);
    }
  });

  test("B4: only main.ts of the api and of the worker may import the registry, and only those two packages may depend on it", () => {
    // The two lists are these: a third file or a third package is seen here.
    expect(MAY_IMPORT_REGISTRY).toEqual(["apps/api/src/main.ts", "apps/worker/src/main.ts"]);
    expect(MAY_DEPEND_ON_REGISTRY).toEqual(["apps/api", "apps/worker"]);
    for (const file of MAY_IMPORT_REGISTRY) {
      expect(
        sources().map((source) => source.path),
        file,
      ).toContain(file);
    }
    expect(
      sources()
        .filter((file) => THE_REGISTRY.test(file.text))
        .map((file) => file.path)
        .filter((path) => !MAY_IMPORT_REGISTRY.includes(path)),
    ).toEqual([]);
    for (const directory of CORE) {
      if (!MAY_DEPEND_ON_REGISTRY.includes(directory)) {
        expect(
          dependencies(directory).filter((name) => name.endsWith("/packs-registry")),
          directory,
        ).toEqual([]);
      }
    }
  });

  test("B5: each rule sees what it should, and tells the interface, the registry and a pack apart", () => {
    const pack = [
      'import { BOOKING_WORDS } from "@polyglot-sales-agent/pack-booking";',
      'import pack from "@polyglot-sales-agent/pack-faq-only";',
      "import pack from '@polyglot-sales-agent/pack-booking/names';",
      'import x from "../../packs/booking/src/names.ts";',
      'const pack = await import("../../../packs/faq-only/src/index.ts");',
      "const pack = await import(`@polyglot-sales-agent/pack-booking`);",
      // A pack whose name only begins like the interface's is a pack.
      'import x from "@polyglot-sales-agent/pack-interfaces";',
      'import x from "../packs/registry-two/src/index.ts";',
    ];
    const theInterface = [
      'import type { Pack } from "@polyglot-sales-agent/pack-interface";',
      'import { packNamed } from "../../pack-interface/src/index.ts";',
    ];
    const registry = [
      'import { PACKS } from "@polyglot-sales-agent/packs-registry";',
      'import { PACKS } from "../../packages/packs/registry/src/index.ts";',
      "const { PACKS } = await import('@polyglot-sales-agent/packs-registry');",
    ];
    const neither = [
      'import { echoReply } from "@polyglot-sales-agent/core";',
      'import { bounded } from "@polyglot-sales-agent/ai";',
      'const text = "a pack of cards";',
      'import x from "./packs.ts";',
    ];
    for (const line of pack) {
      expect(A_PACK.test(line), line).toBe(true);
      expect(THE_INTERFACE.test(line), line).toBe(false);
      expect(THE_REGISTRY.test(line), line).toBe(false);
    }
    for (const line of theInterface) {
      expect(THE_INTERFACE.test(line), line).toBe(true);
      expect(A_PACK.test(line), line).toBe(false);
      expect(THE_REGISTRY.test(line), line).toBe(false);
    }
    for (const line of registry) {
      expect(THE_REGISTRY.test(line), line).toBe(true);
      expect(A_PACK.test(line), line).toBe(false);
      expect(THE_INTERFACE.test(line), line).toBe(false);
    }
    // A string that begins as the interface or the registry and then leaves it reaches a pack.
    for (const line of [
      'import x from "../packs/registry/../booking/src/index.ts";',
      'import x from "@polyglot-sales-agent/packs-registry/node_modules/@polyglot-sales-agent/pack-booking";',
      'import x from "@polyglot-sales-agent/pack-interface/../pack-booking";',
      'import x from "../../pack-interface/../packs/booking/src/index.ts";',
    ]) {
      expect(reachesAPack(line), line).toBe(true);
    }
    for (const line of [...theInterface, ...registry, ...neither]) {
      expect(A_WAY_ROUND.test(line), line).toBe(false);
    }
    for (const line of neither) {
      expect(A_PACK.test(line) || THE_INTERFACE.test(line) || THE_REGISTRY.test(line), line).toBe(
        false,
      );
    }
  });
});
