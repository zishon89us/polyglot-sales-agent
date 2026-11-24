// The worker's settings, read from the environment once, at start.
// Everything that is wrong is reported together, by name and never by value.

import {
  type DeploymentFacts,
  type Environment,
  type ModelPrices,
  productionProblems,
  productionReasons,
  readEnvironment,
  readModelPrices,
  startFailure,
} from "@polyglot-sales-agent/core";

export interface WorkerConfig {
  readonly environment: Environment;
  readonly appDatabaseUrl: string;
  readonly crossDatabaseUrl: string;
  /** The channel cannot be made without it. The worker verifies no webhook with it. */
  readonly whatsappAppSecrets: readonly string[];
  readonly whatsappBaseUrl: string;
  readonly whatsappApiVersion: string;
  /** One credential for every tenant, until per-tenant credentials are built (NFR-S5). */
  readonly whatsappAccessToken: string;
  /**
   * What each model costs, by its exact name; empty until one is chosen.
   * A model with no price here has no cost on its traces, never zero.
   */
  readonly modelPrices: ModelPrices;
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const missing: string[] = [];
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value.trim();
  };
  let environment: Environment = "development";
  let environmentProblem: string | undefined;
  try {
    environment = readEnvironment(env);
  } catch (error) {
    environmentProblem = (error as Error).message;
  }
  const prices = readModelPrices(env["PSA_MODEL_PRICES"]);
  const config: WorkerConfig = {
    environment,
    appDatabaseUrl: need("PSA_DB_APP_URL"),
    crossDatabaseUrl: need("PSA_DB_CROSS_URL"),
    whatsappAppSecrets: need("PSA_WHATSAPP_APP_SECRET")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
    whatsappBaseUrl: need("PSA_WHATSAPP_BASE_URL"),
    whatsappApiVersion: need("PSA_WHATSAPP_API_VERSION"),
    whatsappAccessToken: need("PSA_WHATSAPP_ACCESS_TOKEN"),
    modelPrices: prices.ok ? prices.prices : {},
  };
  const problems = missing.map((name) => `${name} is not set`);
  if (!prices.ok) {
    // A wrong price is worse than no price: the worker does not start.
    problems.push(`PSA_MODEL_PRICES ${prices.problem}`);
  }
  if (environmentProblem !== undefined) {
    problems.unshift(environmentProblem);
  }
  if (problems.length > 0) {
    throw startFailure(`worker: ${problems.join("; ")}`, "settings");
  }
  // Development components and placeholder secrets have no place in production (#165).
  // The last fact holds until each tenant has its own credential (NFR-S5, #290): until
  // then no worker starts in production at all.
  const facts: DeploymentFacts = {
    whatsappBaseUrl: config.whatsappBaseUrl,
    secrets: {
      PSA_DB_APP_URL: config.appDatabaseUrl,
      PSA_DB_CROSS_URL: config.crossDatabaseUrl,
      PSA_WHATSAPP_APP_SECRET: config.whatsappAppSecrets.join(","),
      PSA_WHATSAPP_ACCESS_TOKEN: config.whatsappAccessToken,
    },
    sharedChannelCredential: true,
  };
  const refused = productionProblems(environment, facts);
  if (refused.length > 0) {
    throw startFailure(
      `worker: will not start in production: ${refused.join("; ")}`,
      "not-for-production",
      productionReasons(environment, facts),
    );
  }
  return config;
}
