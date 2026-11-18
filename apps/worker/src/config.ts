// The worker's settings, read from the environment once, at start.
// Everything that is wrong is reported together, by name and never by value.

export interface WorkerConfig {
  readonly appDatabaseUrl: string;
  readonly crossDatabaseUrl: string;
  /** The channel cannot be made without it. The worker verifies no webhook with it. */
  readonly whatsappAppSecrets: readonly string[];
  readonly whatsappBaseUrl: string;
  readonly whatsappApiVersion: string;
  /** One credential for every tenant, until per-tenant credentials are built (NFR-S5). */
  readonly whatsappAccessToken: string;
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
  const config: WorkerConfig = {
    appDatabaseUrl: need("PSA_DB_APP_URL"),
    crossDatabaseUrl: need("PSA_DB_CROSS_URL"),
    whatsappAppSecrets: need("PSA_WHATSAPP_APP_SECRET")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
    whatsappBaseUrl: need("PSA_WHATSAPP_BASE_URL"),
    whatsappApiVersion: need("PSA_WHATSAPP_API_VERSION"),
    whatsappAccessToken: need("PSA_WHATSAPP_ACCESS_TOKEN"),
  };
  if (missing.length > 0) {
    throw new Error(`worker: ${missing.map((name) => `${name} is not set`).join("; ")}`);
  }
  return config;
}
