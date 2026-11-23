// The core speaks to a channel through the interface only (NFR-M2; design
// note M3 U5, section 6). A specific channel is named by the one file of
// each app that builds it, by the stand-in for Meta, and by tests.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** A specific channel's package, as an import, a path or a dependency would name it. */
const A_CHANNEL = /(?:@polyglot-sales-agent|packages|\.\.)\/channel-[a-z][a-z0-9-]*/g;

/** The channels themselves. */
const CHANNELS = /^packages\/channel-[a-z0-9-]+\//;

/** The files outside the channels that may name one, and why. */
const MAY_NAME: Record<string, string> = {
  "apps/api/src/main.ts": "builds the channel the API receives from",
  "apps/api/package.json": "the dependency of that file",
  "apps/worker/src/main.ts": "builds the channel the worker sends through",
  "apps/worker/package.json": "the dependency of that file",
  "apps/mock-whatsapp/src/server.ts": "the stand-in for Meta signs as the WhatsApp channel does",
  "apps/mock-whatsapp/package.json": "the dependency of that file",
};

function scanned(): string[] {
  const found: string[] = [];
  for (const top of ["apps", "packages"]) {
    for (const name of readdirSync(`${root}${top}`, { recursive: true, encoding: "utf8" })) {
      const path = `${top}/${name}`;
      if (
        (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(name) || /(^|\/)package\.json$/.test(name)) &&
        !/\.test\.[a-z]+$/i.test(name) &&
        !/(^|\/)(node_modules|fixtures)\//.test(path) &&
        !CHANNELS.test(path)
      ) {
        found.push(path);
      }
    }
  }
  return found.sort();
}

describe("which files name a specific channel", () => {
  const files = scanned();
  const naming = files.filter((path) => {
    const names = readFileSync(`${root}${path}`, "utf8").match(A_CHANNEL) ?? [];
    return names.length > 0;
  });

  test("the scan sees the core's folders and the files it is about", () => {
    expect(files.length).toBeGreaterThan(40);
    for (const path of [
      "packages/core/src/index.ts",
      "packages/db/src/inbound.ts",
      "packages/ai/src/bounded.ts",
      "apps/api/src/sink.ts",
      "apps/worker/src/main.ts",
      "packages/channel/src/index.ts",
    ]) {
      expect(files, path).toContain(path);
    }
  });

  test("only the files that build a channel, and the stand-in for Meta", () => {
    expect(naming).toEqual(Object.keys(MAY_NAME).sort());
  });

  test("the pattern finds a channel named in an import, a path and a dependency, and not the interface", () => {
    const hits = (text: string) => text.match(A_CHANNEL) ?? [];
    expect(hits('from "@polyglot-sales-agent/channel-whatsapp"')).toHaveLength(1);
    expect(hits('"@polyglot-sales-agent/channel-mock": "workspace:*"')).toHaveLength(1);
    expect(hits('import("../../channel-telegram/src/index.ts")')).toHaveLength(1);
    expect(hits('from "@polyglot-sales-agent/channel"')).toHaveLength(0);
    expect(hits('from "@polyglot-sales-agent/channel/contract"')).toHaveLength(0);
    expect(hits("the channel-message identifier")).toHaveLength(0);
  });
});
