import { defineConfig } from "vitest/config";

/**
 * Vitest workspace for tests/e2e/*.test.ts and any future
 * tests/integration/*.test.ts files. The Playwright spec
 * (tests/e2e/*.spec.ts) is excluded — Playwright owns those via
 * `npm run test:e2e`.
 *
 * Per Plan 01-10: this workspace covers the locally-runnable subset
 * of the Phase 1 smoke (canary, synapse-coexistence, kill-9
 * idempotency) — the ones that don't need real Supabase/Cloudflare
 * infra.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts", "integration/**/*.test.ts"],
    // Exclude Playwright specs — they import from @playwright/test
    // and would fail to import under vitest.
    exclude: ["**/*.spec.ts", "**/node_modules/**"],
  },
});
