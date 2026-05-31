import { test } from "@playwright/test";

/**
 * Phase 1 smoke test skeleton.
 *
 * Real implementation arrives in plan 01-10 once the daemon, backend, and
 * Supabase schema are all wired. Until then this exists so Playwright's
 * test discovery (`playwright test --list`) succeeds in CI.
 */
test.skip("phase 1 smoke: prompt in Claude Code → ai_events row", async () => {
  /* implemented in plan 01-10 */
});
