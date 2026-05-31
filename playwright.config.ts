import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e config. Wave 0 ships only the skeleton spec at
 * `tests/e2e/01-phase-1-smoke.spec.ts`; the actual end-to-end smoke (prompt
 * typed in Claude Code → row in `ai_events` via the daemon) is implemented
 * in plan 01-10. CI runs `playwright test --list` to confirm discovery only.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
