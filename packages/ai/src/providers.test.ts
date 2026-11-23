// No provider's library outside its adapter (ADR 0005, "Confirmation";
// design note docs/design/notes/m3-u4-llm-client.md, section 6).
//
// This is a list of names. A library it does not know, or a plain HTTP
// call to a provider, passes: it shows that the known ones are kept in one
// place, not that no model is called from elsewhere.

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

/** Whether a package's name is one of the list's. */
function isProvider(name: string): boolean {
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
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`\n]+)["'`]/g,
  )) {
    found.push(match[1] as string);
  }
  return found;
}

/** Where an adapter lives: the one place a provider's library may be imported. */
const ADAPTERS = "packages/ai/src/adapters/";
/** The one package that may depend on one. */
const MAY_DEPEND = "packages/ai";

function workspaceFolders(): string[] {
  const inside = (top: string): string[] =>
    readdirSync(`${root}${top}`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => `${top}/${entry.name}`);
  return [...inside("apps"), ...inside("packages"), ...inside("packages/packs")].filter(
    (folder) => folder !== "packages/packs",
  );
}

describe("a provider's library is imported only by its adapter", () => {
  test("no source file outside the adapters' folder imports one", () => {
    const importers: string[] = [];
    let read = 0;
    for (const top of ["apps", "packages", "tools"]) {
      for (const name of readdirSync(`${root}${top}`, { recursive: true, encoding: "utf8" })) {
        const path = `${top}/${name}`;
        if (
          /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) &&
          !/(^|\/)node_modules\//.test(path) &&
          !path.startsWith(ADAPTERS) &&
          // This file plants the lines it looks for.
          path !== "packages/ai/src/providers.test.ts"
        ) {
          read += 1;
          if (imported(readFileSync(`${root}${path}`, "utf8")).some(isProvider)) {
            importers.push(path);
          }
        }
      }
    }
    expect(importers).toEqual([]);
    // The walk read the product's files, this one among them.
    expect(read).toBeGreaterThan(80);
  });

  test("no package but packages/ai depends on one, and the root does not", () => {
    const folders = workspaceFolders();
    for (const expected of ["apps/api", "apps/worker", "packages/ai"]) {
      expect(folders).toContain(expected);
    }
    // The packs' own folders are walked too. (Named by its ending: a file of
    // this package may not hold a path into the packs.)
    expect(folders.filter((folder) => folder.endsWith("/faq-only"))).toHaveLength(1);
    for (const folder of [".", ...folders]) {
      const manifest = JSON.parse(readFileSync(`${root}${folder}/package.json`, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      const names = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
        .flatMap((kind) => Object.keys(manifest[kind] ?? {}))
        .filter(isProvider);
      if (folder !== MAY_DEPEND) {
        expect(names, folder).toEqual([]);
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
