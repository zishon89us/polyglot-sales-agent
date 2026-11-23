// No provider's library outside its adapter (ADR 0005, "Confirmation";
// design note docs/design/notes/m3-u4-llm-client.md, section 6).
//
// This is a list of names. A library it does not know, a name put together
// from parts, or a plain HTTP call to a provider, passes: it shows that the
// known ones are kept in one place, not that no model is called from
// elsewhere.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Packages of model providers and of frameworks that call models. A name, or a name's beginning ending in `/` or `-`. */
const PROVIDER_PACKAGES = [
  "@aws-sdk/client-bedrock",
  "@aws-sdk/client-bedrock-runtime",
  "@aws-sdk/client-bedrock-agent",
  "@aws-sdk/client-bedrock-agent-runtime",
  "@aws-sdk/client-sagemaker-runtime",
  "@anthropic-ai/",
  "openai",
  "@azure/openai",
  "@azure-rest/ai-inference",
  "@google/generative-ai",
  "@google/genai",
  "@google-cloud/vertexai",
  "@google-cloud/aiplatform",
  "@mistralai/",
  "cohere-ai",
  "groq-sdk",
  "together-ai",
  "replicate",
  "ollama",
  "@huggingface/inference",
  "langchain",
  "@langchain/",
  "llamaindex",
  "@llamaindex/",
  "ai",
  "@ai-sdk/",
];

/** Whether what is imported is one of the list's: by its name, or by a path into where it is installed. */
function isProvider(imported: string): boolean {
  const installed = imported.lastIndexOf("node_modules/");
  const name = installed < 0 ? imported : imported.slice(installed + "node_modules/".length);
  return PROVIDER_PACKAGES.some((listed) =>
    listed.endsWith("/")
      ? name.startsWith(listed)
      : name === listed || name.startsWith(`${listed}/`),
  );
}

/** The packages a source text imports: `from "x"`, `import "x"`, `import("x")` and `require("x")`. */
function imported(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(?:\/\*[^*]*\*\/\s*)?["'`]([^"'`\n]+)["'`]/g,
  )) {
    found.push(match[1] as string);
  }
  return found;
}

/** Where an adapter lives: the one place a provider's library may be imported. */
const ADAPTERS = "packages/ai/src/adapters/";
/** The one package that may depend on one. */
const MAY_DEPEND = "packages/ai";

/** Folders that hold none of this repository's code: what is installed, and the history. */
const NOT_OURS = ["node_modules", ".git"];

/** Every file of the repository, from its root down, as a path from the root. */
function everyFile(): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (path) => !path.split("/").some((part) => NOT_OURS.includes(part)),
  );
}

describe("a provider's library is imported only by its adapter", () => {
  test("no source file of the repository outside the adapters' folder imports one", () => {
    const importers: string[] = [];
    const read: string[] = [];
    for (const path of everyFile()) {
      if (
        /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path) &&
        !path.startsWith(ADAPTERS) &&
        // This file plants the lines it looks for.
        path !== "packages/ai/src/providers.test.ts"
      ) {
        read.push(path);
        if (imported(readFileSync(`${root}${path}`, "utf8")).some(isProvider)) {
          importers.push(path);
        }
      }
    }
    expect(importers).toEqual([]);
    // The walk starts at the root, so a folder added later (the evals, the
    // infrastructure) is read without being named here.
    for (const expected of [
      "vitest.config.ts",
      "tools/names-check.ts",
      "apps/worker/src/main.ts",
      "packages/ai/src/bounded.ts",
      "packages/db/src/index.ts",
    ]) {
      expect(read).toContain(expected);
    }
    expect(read.some((path) => path.includes("node_modules"))).toBe(false);
  });

  test("no package but packages/ai depends on one, the root included", () => {
    const manifests = everyFile().filter((path) => /(^|\/)package\.json$/.test(path));
    for (const expected of ["package.json", "apps/api/package.json", "packages/ai/package.json"]) {
      expect(manifests).toContain(expected);
    }
    // One for each workspace package and one for the root.
    expect(manifests.length).toBeGreaterThanOrEqual(15);
    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(`${root}${path}`, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      const names = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
        .flatMap((kind) => Object.keys(manifest[kind] ?? {}))
        .filter(isProvider);
      if (path !== `${MAY_DEPEND}/package.json`) {
        expect(names, path).toEqual([]);
      }
    }
  });

  test("the list sees each library in each way it can be imported, and nothing that only looks like one", () => {
    for (const line of [
      'import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";',
      'import Anthropic from "@anthropic-ai/sdk";',
      'import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";',
      "import OpenAI from 'openai';",
      'import { toFile } from "openai/uploads";',
      'const { GoogleGenerativeAI } = require("@google/generative-ai");',
      'const sdk = await import("@mistralai/mistralai");',
      "const sdk = await import(`cohere-ai`);",
      'import "groq-sdk";',
      'import { ChatOpenAI } from "@langchain/openai";',
      'import { generateText } from "ai";',
      'import { bedrock } from "@ai-sdk/amazon-bedrock";',
      'export { Ollama } from "ollama";',
      'import type { Message } from\n  "@anthropic-ai/sdk";',
      'const sdk = await import(/* webpackIgnore: true */ "openai");',
      'import x from "../../node_modules/openai/index.mjs";',
      'import x from "../node_modules/@anthropic-ai/sdk/index.js";',
    ]) {
      expect(imported(line).some(isProvider), line).toBe(true);
    }
    for (const line of [
      'import { bounded } from "@polyglot-sales-agent/ai";',
      'import { S3Client } from "@aws-sdk/client-s3";',
      'import pg from "pg";',
      'import { parse } from "yaml";',
      'import x from "./ai.ts";',
      'import x from "../ai/src/index.ts";',
      'import x from "openai-like-but-not";',
      'import x from "aitools";',
      'const text = "we do not use openai";',
    ]) {
      expect(imported(line).some(isProvider), line).toBe(false);
    }
  });
});
