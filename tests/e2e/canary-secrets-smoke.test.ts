import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANARIES, redactEvent } from "@fennec/daemon";
import { describe, expect, it } from "vitest";

/**
 * PRIV-01 canary smoke — fully local.
 *
 * Runs the 10 ROADMAP canaries through the in-process daemon redactor
 * (no daemon process, no backend, no Supabase). Asserts every canary
 * string is replaced with a `[REDACTED:<rule>]` token before any event
 * could reach the JSONL queue.
 *
 * This is the locally-runnable subset of Plan 01-10 Step B that does
 * NOT require a deployed Worker or a live macOS install. The remaining
 * end-to-end canary verification (canary in Claude Code prompt → row
 * in Supabase with canary absent) is the 8th step of
 * tests/e2e/01-phase-1-smoke.spec.ts.
 *
 * Companion to daemon/src/redact/canary.test.ts which exercises the
 * `runCanarySmoke` helper directly. This file exists in tests/e2e/ to
 * make the Phase 1 smoke contract discoverable from one location.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const FIXTURE_PATH = resolve(REPO_ROOT, "tests", "canary-secrets.txt");

function buildEvent(promptText: string) {
  return {
    idempotency_key: `canary-${promptText.slice(0, 16)}`,
    tool: "claude-code" as const,
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "smoke",
    os: "darwin" as const,
    kind: "prompt_submitted" as const,
    payload: { prompt_text: promptText },
    schema_version: 1 as const,
    redaction_applied_at: "",
    redaction_version_hash: "",
  };
}

describe("PRIV-01 canary smoke (local, no infra)", () => {
  it("exports exactly 10 canaries (ROADMAP success criterion 5)", () => {
    expect(CANARIES.length).toBe(10);
  });

  it("daemon-side canary list matches tests/canary-secrets.txt fixture", () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(CANARIES.slice().sort()).toEqual(fixture.slice().sort());
  });

  it.each(CANARIES.map((c, i) => [i, c]))("redacts canary %i: %s", (_idx, canary) => {
    const event = buildEvent(`Here is my secret value ${canary} please summarise`);
    const redacted = redactEvent(event);
    const serialised = JSON.stringify(redacted.payload);
    expect(serialised, `canary still present in payload`).not.toContain(canary);
    expect(serialised, `no [REDACTED:...] token`).toMatch(/\[REDACTED:[a-z0-9-]+\]/);
  });

  it("redacts multiple canaries pasted in one prompt", () => {
    const prompt = `Test: ${CANARIES.join(" / ")}`;
    const redacted = redactEvent(buildEvent(prompt));
    const serialised = JSON.stringify(redacted.payload);
    for (const canary of CANARIES) {
      expect(serialised, `${canary} leaked`).not.toContain(canary);
    }
  });

  it("stamps redaction_applied_at + redaction_version_hash on every event", () => {
    const redacted = redactEvent(buildEvent("plain text with no secrets"));
    expect(redacted.redaction_applied_at).not.toBe("");
    expect(redacted.redaction_version_hash).not.toBe("");
    // Format is `gitleaks-v<VER>-defaults+fennec-<N>@<8-hex>` (see
    // daemon/src/redact/gitleaks-rules.ts → REDACTION_VERSION_HASH).
    expect(redacted.redaction_version_hash).toMatch(/@[0-9a-f]{8,}$/i);
  });
});
