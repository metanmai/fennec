import { defineConfig } from "vitest/config";

/**
 * Phase 1 Plan 01-05 backend test configuration.
 *
 * **W-2 RESOLUTION (Plan 01-05):** Per the plan-checker warning, integration
 * tests against a live Hyperdrive-backed Postgres are deferred to Plan 01-10
 * (smoke test) where real Supabase is provisioned. Plan 01-05 ships UNIT TESTS
 * with mocked Postgres clients + mocked KV. This keeps the test suite hermetic,
 * runnable in CI without a live database, and aligned with the W-2 mitigation
 * captured in Plan 01-04's deferred items.
 *
 * Trade-off: we accept that Plan 01-05 cannot prove the SQL upserts execute
 * against the real partitioned `ai_events` table. Plan 01-10 closes that gap
 * by running the entire daemon -> backend -> Supabase loop against a real
 * `supabase db push`-ed instance.
 *
 * Phase 5 follow-up: re-introduce `@cloudflare/vitest-pool-workers` once a CI
 * Hyperdrive emulator is available. The unit-test surface we ship today
 * (handler logic, Zod validation, auth middleware, hash helper) is the right
 * shape for that future migration.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
