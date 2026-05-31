/**
 * Managed-settings path resolution (Plan 01-07 Task 4).
 *
 * Per D-19, fennec's Claude Code hook entries live in the
 * managed-settings layer of Claude Code's settings hierarchy
 * (system-protected, root-owned, mode 0644). The exact filesystem
 * location is per-OS:
 *
 *   macOS:   /Library/Application Support/ClaudeCode/managed-settings.json
 *   Linux:   /etc/claude-code/managed-settings.json
 *   Windows: %ProgramData%\ClaudeCode\managed-settings.json (defaults to
 *            C:\ProgramData if the env var isn't set — matches
 *            Windows defaults).
 *
 * The shared `Os` enum from @fennec/shared is the input. Returns the
 * absolute path string the installer / uninstaller writes to.
 */

import type { Os } from "@fennec/shared";

/**
 * Resolve the managed-settings.json path for the given OS. Pure
 * function — no filesystem touches, no side effects.
 */
export function resolveManagedSettingsPath(os: Os): string {
  switch (os) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode/managed-settings.json";
    case "linux":
      return "/etc/claude-code/managed-settings.json";
    case "win32": {
      const root = process.env.ProgramData ?? "C:\\ProgramData";
      return `${root}\\ClaudeCode\\managed-settings.json`;
    }
  }
}
