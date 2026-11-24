// Where a process runs, and what it must refuse to run with there (issue
// #165; threat model T40). Development components make the product easy to
// try: a stand-in for WhatsApp that anyone can make speak as any customer,
// placeholder secrets that are published in this repository, one channel
// credential shared by every tenant. None may be in a real deployment, so
// each process says where it is and refuses to start in production with
// any of them.

export const ENVIRONMENTS = ["development", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** The setting that says where a process runs. It has no default: a forgotten setting must not mean "development". */
export const ENVIRONMENT_SETTING = "PSA_ENV";

/**
 * Every placeholder secret in `.env.example` holds this, so that one copied
 * into a deployment can be told from a real value. It is a mark, not a
 * proof: a value without it is not thereby a good secret.
 */
export const PLACEHOLDER_MARK = "local-only";

/**
 * A value as it is compared with the mark: percent-decoded, lower-case,
 * letters and digits only. Each `%XX` is decoded on its own, so that one
 * malformed `%` elsewhere in the value does not leave the rest undecoded.
 */
function plain(value: string): string {
  const decoded = value.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The only host a production deployment sends WhatsApp messages to. */
export const WHATSAPP_PRODUCTION_HOST = "graph.facebook.com";

/** Reads `PSA_ENV`. Throws, naming the setting and never its value, if it is not one of the two words. */
export function readEnvironment(env: Readonly<Record<string, string | undefined>>): Environment {
  const value = env[ENVIRONMENT_SETTING];
  const found = ENVIRONMENTS.find((name) => name === value);
  if (found === undefined) {
    throw new Error(`${ENVIRONMENT_SETTING} must be set to ${ENVIRONMENTS.join(" or ")}`);
  }
  return found;
}

export interface DeploymentFacts {
  /** A component that exists only for development, such as the stand-in for WhatsApp. */
  readonly developmentOnly?: boolean;
  /** Where WhatsApp messages are sent, if this process sends any or is told the address. */
  readonly whatsappBaseUrl?: string;
  /** Settings that hold a secret or a credential, by the setting's name. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** True while the process sends with one channel credential for every tenant (NFR-S5 not built). */
  readonly sharedChannelCredential?: boolean;
}

/**
 * What stops this process from starting in production, as sentences that
 * name settings and never show a value. Empty when nothing does. In
 * development it is always empty.
 *
 * Not checked, because neither exists yet: a fake model client and an
 * email writer that only logs (M3 and M4; issue #165 stays open for them).
 */
/** Why a program will not start in production, as short names a log line can carry. */
export const PRODUCTION_REASONS = [
  "development-component",
  "stand-in-channel",
  "placeholder-secret",
  "shared-channel-credential",
] as const;
export type ProductionReason = (typeof PRODUCTION_REASONS)[number];

function refusals(
  environment: Environment,
  facts: DeploymentFacts,
): { readonly reason: ProductionReason; readonly text: string }[] {
  if (environment !== "production") {
    return [];
  }
  const problems: { reason: ProductionReason; text: string }[] = [];
  if (facts.developmentOnly === true) {
    problems.push({
      reason: "development-component",
      text: "this is a development component and has no place in production",
    });
  }
  if (facts.whatsappBaseUrl !== undefined) {
    // The whole origin: https, that host, the default port, and nobody's name in front of it.
    let real = false;
    try {
      const url = new URL(facts.whatsappBaseUrl);
      real =
        url.origin === `https://${WHATSAPP_PRODUCTION_HOST}` &&
        url.username === "" &&
        url.password === "";
    } catch {
      real = false;
    }
    if (!real) {
      problems.push({
        reason: "stand-in-channel",
        text: `PSA_WHATSAPP_BASE_URL is not https://${WHATSAPP_PRODUCTION_HOST}, so the channel is a stand-in`,
      });
    }
  }
  for (const [name, value] of Object.entries(facts.secrets ?? {})) {
    // Written any way: with other punctuation, in capitals, or percent-encoded in a URL.
    if (plain(value).includes(plain(PLACEHOLDER_MARK))) {
      problems.push({
        reason: "placeholder-secret",
        text: `${name} holds a placeholder from the example file`,
      });
    }
  }
  if (facts.sharedChannelCredential === true) {
    problems.push({
      reason: "shared-channel-credential",
      text: "the worker sends with one channel credential for every tenant, which is for development only",
    });
  }
  return problems;
}

export function productionProblems(environment: Environment, facts: DeploymentFacts): string[] {
  return refusals(environment, facts).map((problem) => problem.text);
}

/** The same refusals as `productionProblems`, each once, by its short name. */
export function productionReasons(
  environment: Environment,
  facts: DeploymentFacts,
): ProductionReason[] {
  return [...new Set(refusals(environment, facts).map((problem) => problem.reason))];
}

/**
 * A failure to start: a sentence for whoever reads the error, a code and
 * short reasons for the log, which carries no sentence.
 */
export function startFailure(
  text: string,
  code: "settings" | "not-for-production" | "database-unreachable",
  reasons: readonly string[] = [],
): Error {
  return Object.assign(new Error(text), { code, reasons: [...reasons] });
}

/** The short reasons a failure to start carries, if it carries any, in the list's order. */
export function startReasons(error: unknown): string[] {
  const reasons = (error as { reasons?: unknown } | null)?.reasons;
  // Only the reasons of the list: whatever else an error carries is not written.
  return Array.isArray(reasons)
    ? PRODUCTION_REASONS.filter((reason) => reasons.includes(reason))
    : [];
}

/** Throws one error listing every problem, if there is any. `who` is the process, such as `api`. */
export function refuseInProduction(
  who: string,
  environment: Environment,
  facts: DeploymentFacts,
): void {
  const problems = productionProblems(environment, facts);
  if (problems.length > 0) {
    throw new Error(`${who}: will not start in production: ${problems.join("; ")}`);
  }
}
