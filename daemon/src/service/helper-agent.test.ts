/**
 * Tests for Helper LaunchAgent plist writer (Plan 01-09 Task 1).
 *
 * The writer produces /Library/LaunchAgents/dev.fennec.notifier.plist.
 * Tests use os.tmpdir() with `opts.skipChown=true`.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writePlist } from "./helper-agent.js";

describe("helper-agent.writePlist", () => {
  let tmpDir: string;
  let plistPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fennec-agent-test-"));
    plistPath = join(tmpDir, "dev.fennec.notifier.plist");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes a plist containing Label=dev.fennec.notifier", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toMatch(/<key>Label<\/key>\s*<string>dev\.fennec\.notifier<\/string>/);
  });

  test("ProgramArguments points at /usr/local/fennec/bin/fennec-notifier", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toContain("/usr/local/fennec/bin/fennec-notifier");
  });

  test("RunAtLoad + KeepAlive both true", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  test("EnvironmentVariables include FENNEC_NOTIFIER_PORT when supplied", () => {
    writePlist(plistPath, { FENNEC_NOTIFIER_PORT: "7822" }, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toContain("FENNEC_NOTIFIER_PORT");
    expect(xml).toContain("7822");
  });

  test("file mode is 0o644", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const mode = statSync(plistPath).mode & 0o777;
    expect(mode).toBe(0o644);
  });
});
