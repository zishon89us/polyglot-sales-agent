import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The database tests read their connection settings from the environment.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.{ts,tsx,mts}"],
    exclude: ["**/node_modules/**", "**/dist/**", "docs/**", "tools/selftest/fixtures/**"],
    // A committed `.only` would silently skip every other test.
    allowOnly: false,
  },
});
