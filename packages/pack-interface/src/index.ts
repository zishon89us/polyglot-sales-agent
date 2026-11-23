// What a pack is (ADR 0014). M3 unit U4 builds the name and the prompt
// fragment; a pack's tools and claim kinds are added to this type by the
// units that first use them (U7, U9). No pack's name is written here.

/** A prompt of the pack's own, under `prompts/` in the folder named for the pack. */
export interface PromptFragment {
  readonly name: string;
  readonly version: number;
}

/** One pack. A pack with a name and nothing else is valid. */
export interface Pack {
  /** Equals `tenants.pack`. */
  readonly name: string;
  /** Added to the system text after the core's own. */
  readonly promptFragment?: PromptFragment;
}

/** Packs by name. The one a deployment runs is the registry package's; a test passes its own. */
export type PackRegistry = Readonly<Record<string, Pack>>;

/** Names no pack may have: they are the names of things that are not packs. */
export const RESERVED_PACK_NAMES = ["core", "interface", "registry"] as const;

const PACK_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** What is wrong with a pack's name, or undefined. */
export function packNameProblem(name: string): string | undefined {
  if (!PACK_NAME.test(name)) {
    return "a pack's name is 1 to 40 of the letters a to z, digits and hyphens, and starts with a letter";
  }
  if ((RESERVED_PACK_NAMES as readonly string[]).includes(name)) {
    return `"${name}" is not a pack's name`;
  }
  return undefined;
}

/** What is wrong with a set of packs: a name that is not one, or a pack filed under another's. */
export function registryProblems(registry: PackRegistry): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(registry)) {
    const problem = packNameProblem(key);
    if (problem !== undefined) {
      problems.push(`${JSON.stringify(key)}: ${problem}`);
    }
    if (registry[key]?.name !== key) {
      problems.push(`${JSON.stringify(key)}: the pack filed here is named otherwise`);
    }
  }
  return problems;
}

/** The pack of that name, or undefined. A tenant whose pack is not found cannot be worked for (ADR 0014). */
export function packNamed(registry: PackRegistry, name: string): Pack | undefined {
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}
