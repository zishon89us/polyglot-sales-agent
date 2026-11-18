// The API's settings, read from the environment once, at start. Everything
// that is wrong is reported together, by name and never by value.

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly appDatabaseUrl: string;
  readonly crossDatabaseUrl: string;
  readonly whatsappAppSecrets: readonly string[];
  readonly whatsappVerifyToken: string;
  readonly whatsappBaseUrl: string;
  readonly whatsappApiVersion: string;
  readonly trustedProxies: false | readonly string[];
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const missing: string[] = [];
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value;
  };
  const list = (value: string): string[] =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");

  const portText = env["PSA_API_PORT"] ?? "3000";
  const port = /^[0-9]{1,5}$/.test(portText) ? Number(portText) : Number.NaN;
  const proxies = list(env["PSA_TRUSTED_PROXIES"] ?? "");
  const config: ApiConfig = {
    // A blank host would make Node listen on every interface.
    host: (env["PSA_API_HOST"] ?? "").trim() || "127.0.0.1",
    port,
    appDatabaseUrl: need("PSA_DB_APP_URL"),
    crossDatabaseUrl: need("PSA_DB_CROSS_URL"),
    // More than one while the app secret is being replaced.
    whatsappAppSecrets: list(need("PSA_WHATSAPP_APP_SECRET")),
    whatsappVerifyToken: need("PSA_WHATSAPP_VERIFY_TOKEN"),
    whatsappBaseUrl: need("PSA_WHATSAPP_BASE_URL"),
    whatsappApiVersion: need("PSA_WHATSAPP_API_VERSION"),
    trustedProxies: proxies.length === 0 ? false : proxies,
  };
  const problems = missing.map((name) => `${name} is not set`);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    problems.push("PSA_API_PORT is not a port number");
  }
  if (problems.length > 0) {
    throw new Error(`api: ${problems.join("; ")}`);
  }
  return config;
}
