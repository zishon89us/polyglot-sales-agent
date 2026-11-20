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

/** Every placeholder secret in `.env.example` holds this, so that one can be told from a real value. */
export const PLACEHOLDER_MARK = "local-only";

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
export function productionProblems(environment: Environment, facts: DeploymentFacts): string[] {
  if (environment !== "production") {
    return [];
  }
  const problems: string[] = [];
  if (facts.developmentOnly === true) {
    problems.push("this is a development component and has no place in production");
  }
  if (facts.whatsappBaseUrl !== undefined) {
    let host: string | undefined;
    let secure = false;
    try {
      const url = new URL(facts.whatsappBaseUrl);
      host = url.hostname;
      secure = url.protocol === "https:" && url.username === "" && url.password === "";
    } catch {
      host = undefined;
    }
    if (host !== WHATSAPP_PRODUCTION_HOST || !secure) {
      problems.push(
        `PSA_WHATSAPP_BASE_URL is not https://${WHATSAPP_PRODUCTION_HOST}, so the channel is a stand-in`,
      );
    }
  }
  for (const [name, value] of Object.entries(facts.secrets ?? {})) {
    if (value.toLowerCase().includes(PLACEHOLDER_MARK)) {
      problems.push(`${name} holds a placeholder from the example file`);
    }
  }
  if (facts.sharedChannelCredential === true) {
    problems.push(
      "the worker sends with one channel credential for every tenant, which is for development only",
    );
  }
  return problems;
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
