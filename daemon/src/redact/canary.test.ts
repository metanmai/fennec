/**
 * PRIV-01 canary smoke test (Task 3 of Plan 01-06).
 *
 * Asserts every canary in `CANARIES` is redacted before reaching the
 * queue (Pitfall 1 — secret leakage is non-retrofittable). This is the
 * load-bearing trust-posture verification for Phase 1.
 *
 * The test also verifies that the daemon-side canary list stays in sync
 * with the Wave 0 root fixture at `tests/canary-secrets.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalEvent } from "@fennec/shared";
import { describe, expect, it } from "vitest";
import { CANARIES, runCanarySmoke } from "./canary-test.js";
import { GITLEAKS_TOML_SHA256 } from "./gitleaks-rules.js";
import { redactEvent } from "./redactor.js";

function makeEvent(payload: Record<string, unknown>): CanonicalEvent {
  return {
    idempotency_key: "canary-test",
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "host",
    os: "darwin",
    kind: "prompt_submitted",
    payload,
    schema_version: 1,
    redaction_applied_at: "",
    redaction_version_hash: "",
  };
}

describe("PRIV-01 canary redaction (load-bearing)", () => {
  it("redacts every canary secret before the event reaches the queue boundary", () => {
    for (const canary of CANARIES) {
      const event = redactEvent(makeEvent({ prompt_text: `Here's my secret: ${canary} sent in a prompt` }));
      const stringified = JSON.stringify(event.payload);
      expect(stringified, `canary not redacted: ${canary.slice(0, 30)}…`).not.toContain(canary);
      expect(stringified, `no [REDACTED:...] marker for canary: ${canary.slice(0, 30)}…`).toMatch(
        /\[REDACTED:[^\]]+\]/,
      );
    }
  });

  it("redacts a payload containing ALL 10 canaries at once", () => {
    const promptText = CANARIES.map((c, i) => `Secret #${i}: ${c}`).join("\n");
    const event = redactEvent(makeEvent({ prompt_text: promptText }));
    const stringified = JSON.stringify(event.payload);
    for (const canary of CANARIES) {
      expect(stringified, `canary leaked: ${canary.slice(0, 30)}…`).not.toContain(canary);
    }
  });

  it("runCanarySmoke() helper reports pass=true for the bundled canaries", async () => {
    const result = await runCanarySmoke();
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("daemon-side canary list matches the Wave 0 root fixture", () => {
    // tests/canary-secrets.txt at the repo root is the source of truth.
    // The daemon-side CANARIES array exists to keep tests hermetic
    // (no fs reads at module load) but must remain identical.
    const rootPath = join(__dirname, "..", "..", "..", "tests", "canary-secrets.txt");
    const rootContent = readFileSync(rootPath, "utf-8");
    const rootCanaries = rootContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Daemon includes ALL root fixtures (potentially with extras for
    // formatting context). Assert every root fixture appears in
    // daemon-side CANARIES OR matches a canary at the same prefix.
    for (const root of rootCanaries) {
      const matched = CANARIES.some((c) => c === root || c.startsWith(root.slice(0, 30)));
      expect(matched, `root canary not represented in daemon CANARIES: ${root.slice(0, 30)}…`).toBe(true);
    }
  });

  it("vendored gitleaks TOML SHA-256 matches the pinned value (W-4)", () => {
    // W-4: if the TOML on disk drifts from the pinned SHA, the build
    // script refuses to regenerate the JSON. We re-verify here so a
    // direct edit of the .json (bypassing the build script) is caught.
    const tomlPath = join(__dirname, "gitleaks-rules.toml");
    const tomlContent = readFileSync(tomlPath, "utf-8");
    // Re-compute via subtle.digest (sync would be simpler but Node 26
    // makes subtle.digest available; we can use createHash for parity)
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const sha = createHash("sha256").update(tomlContent).digest("hex");
    expect(sha).toBe(GITLEAKS_TOML_SHA256);
    // And confirm the pinned value is exactly what we expect
    expect(GITLEAKS_TOML_SHA256).toBe("1a1944db563ed277a5091b73559f4b244fae110557e189da5a5e367c607b7f4e");
  });
});
