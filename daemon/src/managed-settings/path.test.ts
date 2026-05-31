/**
 * resolveManagedSettingsPath tests (Task 4 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md Tests 1–3):
 *  - Test 1: darwin → /Library/Application Support/ClaudeCode/managed-settings.json (D-19)
 *  - Test 2: linux → /etc/claude-code/managed-settings.json (D-19)
 *  - Test 3: win32 → ${ProgramData}\ClaudeCode\managed-settings.json (D-19)
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedSettingsPath } from "./path.js";

describe("resolveManagedSettingsPath", () => {
  it("returns the macOS managed-settings.json path on darwin", () => {
    expect(resolveManagedSettingsPath("darwin")).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
  });

  it("returns the Linux managed-settings.json path on linux", () => {
    expect(resolveManagedSettingsPath("linux")).toBe("/etc/claude-code/managed-settings.json");
  });

  describe("win32 path resolution", () => {
    const originalProgramData = process.env.ProgramData;
    afterEach(() => {
      // Restore env between tests
      if (originalProgramData === undefined) {
        delete process.env.ProgramData;
      } else {
        process.env.ProgramData = originalProgramData;
      }
    });

    it("uses the ProgramData env var when set", () => {
      process.env.ProgramData = "D:\\AltData";
      expect(resolveManagedSettingsPath("win32")).toBe("D:\\AltData\\ClaudeCode\\managed-settings.json");
    });

    it("falls back to C:\\ProgramData when env var is unset", () => {
      delete process.env.ProgramData;
      expect(resolveManagedSettingsPath("win32")).toBe("C:\\ProgramData\\ClaudeCode\\managed-settings.json");
    });
  });
});
