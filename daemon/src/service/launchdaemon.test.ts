/**
 * Tests for LaunchDaemon plist writer (Plan 01-09 Task 1, DAE-05).
 *
 * The writer produces a valid macOS plist XML targeted at
 * /Library/LaunchDaemons/dev.fennec.daemon.plist. Tests use os.tmpdir()
 * paths and `opts.skipChown=true` since CI is not root.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writePlist } from "./launchdaemon.js";

describe("launchdaemon.writePlist", () => {
  let tmpDir: string;
  let plistPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fennec-launchdaemon-test-"));
    plistPath = join(tmpDir, "dev.fennec.daemon.plist");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes a plist containing Label=dev.fennec.daemon, UserName=root, GroupName=wheel", () => {
    writePlist(plistPath, { FENNEC_API_URL: "https://api.fennec.dev" }, { skipChown: true });

    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<!DOCTYPE plist");
    // Label
    expect(xml).toMatch(/<key>Label<\/key>\s*<string>dev\.fennec\.daemon<\/string>/);
    // UserName
    expect(xml).toMatch(/<key>UserName<\/key>\s*<string>root<\/string>/);
    // GroupName
    expect(xml).toMatch(/<key>GroupName<\/key>\s*<string>wheel<\/string>/);
  });

  test("plist contains RunAtLoad + KeepAlive true", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  test("plist ProgramArguments points at /usr/local/fennec/bin/fennec daemon", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    // ProgramArguments array contains the wrapper path
    expect(xml).toMatch(/<key>ProgramArguments<\/key>/);
    expect(xml).toContain("/usr/local/fennec/bin/fennec");
    expect(xml).toMatch(/<string>daemon<\/string>/);
  });

  test("plist injects EnvironmentVariables from the env arg", () => {
    writePlist(
      plistPath,
      { FENNEC_API_URL: "https://api.fennec.dev", FENNEC_DAEMON_PORT: "7821" },
      { skipChown: true },
    );
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toContain("FENNEC_API_URL");
    expect(xml).toContain("https://api.fennec.dev");
    expect(xml).toContain("FENNEC_DAEMON_PORT");
    expect(xml).toContain("7821");
  });

  test("plist StandardOut/Error paths point at /var/log/fennec/daemon.log", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    expect(xml).toContain("/var/log/fennec/daemon.log");
    expect(xml).toMatch(/<key>StandardOutPath<\/key>/);
    expect(xml).toMatch(/<key>StandardErrorPath<\/key>/);
  });

  test("file mode is 0o644", () => {
    writePlist(plistPath, {}, { skipChown: true });
    const st = statSync(plistPath);
    const mode = st.mode & 0o777;
    expect(mode).toBe(0o644);
  });

  test("escapes special XML chars in env values", () => {
    writePlist(plistPath, { CUSTOM_HEADER: '<script>alert("x")</script>' }, { skipChown: true });
    const xml = readFileSync(plistPath, "utf-8");
    // Must NOT contain raw <script> — must be escaped
    expect(xml).not.toContain("<script>alert");
    expect(xml).toContain("&lt;script&gt;");
  });
});
