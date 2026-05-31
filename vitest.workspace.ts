import { defineWorkspace } from "vitest/config";

/**
 * Vitest workspace definitions. Each entry points at a workspace whose own
 * `vitest.config.ts` controls test environment / include globs. Phase 1 Plan
 * 01-01 (Wave 0) ships three discoverable workspaces — no tests yet, but the
 * pre-push hook (`npm run test:unit`) succeeds with `--passWithNoTests`.
 *
 * Plan 01-05 swaps backend's environment to `@cloudflare/vitest-pool-workers`
 * once the Hono routes land.
 */
export default defineWorkspace(["./packages/shared", "./daemon", "./backend"]);
