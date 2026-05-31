/**
 * Tests for consent renderer (Plan 01-09 Task 1, PRIV-07).
 *
 * Two contracts:
 *   1. renderInteractive() — @clack/prompts confirm()-driven boolean
 *      gate. We mock the confirm module so tests are deterministic.
 *   2. renderLogged({...}) — writes /var/log/fennec/first-run-consent.txt
 *      (logPath overridable) with mode 0o640. Tests use a tmp path.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// We must mock @clack/prompts BEFORE importing consent.ts so the dynamic
// confirm() call resolves through our mock.
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as clackMock from "@clack/prompts";
import { renderInteractive, renderLogged } from "./consent.js";

describe("consent.renderInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns true when user confirms", async () => {
    (clackMock.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await renderInteractive({ apiBaseUrl: "https://api.fennec.dev" });
    expect(result).toBe(true);
  });

  test("returns false when user declines", async () => {
    (clackMock.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const result = await renderInteractive({ apiBaseUrl: "https://api.fennec.dev" });
    expect(result).toBe(false);
  });

  test("returns false when user cancels (Ctrl+C / symbol)", async () => {
    const cancelSymbol = Symbol("cancel");
    (clackMock.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cancelSymbol);
    (clackMock.isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const result = await renderInteractive({ apiBaseUrl: "https://api.fennec.dev" });
    expect(result).toBe(false);
  });
});

describe("consent.renderLogged", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fennec-consent-test-"));
    logPath = join(tmpDir, "var", "log", "fennec", "first-run-consent.txt");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes file with ISO datetime, machine_id, hostname, apiBaseUrl, and disclosure text", () => {
    renderLogged({
      machineId: "AAAA-BBBB-CCCC-DDDD",
      hostname: "test-mac.local",
      apiBaseUrl: "https://api.fennec.dev",
      logPath,
    });

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    // ISO 8601 datetime — `YYYY-MM-DDTHH:MM:SS...Z`
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain("AAAA-BBBB-CCCC-DDDD");
    expect(content).toContain("test-mac.local");
    expect(content).toContain("https://api.fennec.dev");
    // Disclosure text mentions the 6 hooks and capture-time redaction
    expect(content).toMatch(/capture/i);
    expect(content).toMatch(/redact/i);
  });

  test("file mode is 0o640", () => {
    renderLogged({
      machineId: "X",
      hostname: "h",
      apiBaseUrl: "https://example.com",
      logPath,
    });

    const st = statSync(logPath);
    const mode = st.mode & 0o777;
    expect(mode).toBe(0o640);
  });

  test("includes org_name when supplied", () => {
    renderLogged({
      machineId: "X",
      hostname: "h",
      orgName: "Acme Corp",
      apiBaseUrl: "https://example.com",
      logPath,
    });

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("Acme Corp");
  });

  test("creates parent directory if missing", () => {
    // logPath includes nested var/log/fennec/ — none exist yet
    renderLogged({
      machineId: "X",
      hostname: "h",
      apiBaseUrl: "https://example.com",
      logPath,
    });
    expect(existsSync(logPath)).toBe(true);
  });
});
