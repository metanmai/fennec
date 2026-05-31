import { defineConfig } from "vitest/config";

/**
 * Phase 1 Plan 01-01 ships node-env Vitest for the backend workspace. Plan
 * 01-05 (Hono routes + Hyperdrive wiring) swaps this to:
 *   import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
 * so backend tests run in a Miniflare-equivalent Worker isolate.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
