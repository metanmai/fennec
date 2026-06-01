import { defineConfig } from "vitest/config";

/**
 * Root Vitest config. Only used for the `npm run test` aggregate coverage
 * report. Per-workspace configs (see `vitest.workspace.ts`) own test
 * discovery + execution. Wave 0 — placeholder; coverage thresholds and
 * reporters are tuned once real tests land in plan 01-02.
 *
 * `exclude` keeps Vitest from accidentally running Playwright e2e specs
 * under `tests/e2e/` — those use `@playwright/test`'s `test` import, not
 * Vitest's, and would fail to import here.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/tests/e2e/**",
      "**/tests/manual/**",
      // Built installer payload is a compiled snapshot — its `.test.js`
      // files are stale copies of the source-tree tests with broken
      // relative paths (they expect to live under daemon/ not under
      // installer/build/payload/.../daemon/).
      "**/installer/build/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
