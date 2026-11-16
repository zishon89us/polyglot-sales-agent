import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.{ts,tsx,mts}"],
    exclude: ["**/node_modules/**", "**/dist/**", "docs/**", "tools/selftest/fixtures/**"],
    // A committed `.only` would silently skip every other test.
    allowOnly: false,
  },
});
