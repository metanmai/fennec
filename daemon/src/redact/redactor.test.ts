/**
 * Redactor tests (Task 3 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 2, 3, 4):
 *  - Test 2: redactEvent stamps redaction_applied_at (ISO) +
 *    redaction_version_hash matching the vendored ruleset constant
 *  - Test 3: payload with NO secret returns the original (modulo
 *    deep-clone) but still stamps redaction metadata
 *  - Test 4 (Pitfall 1): the registry catches a redactor throw and
 *    counts parse_errors — covered in registry.test.ts; here we just
 *    confirm redactEvent itself returns a stable result for valid
 *    inputs (no swallowed errors)
 */

import type { CanonicalEvent } from "@fennec/shared";
import { describe, expect, it } from "vitest";
import { REDACTION_VERSION_HASH, redactEvent } from "./redactor.js";

function makeEvent(payload: Record<string, unknown>): CanonicalEvent {
  return {
    idempotency_key: "test-key",
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "test-host",
    os: "darwin",
    kind: "prompt_submitted",
    payload,
    schema_version: 1,
    redaction_applied_at: "",
    redaction_version_hash: "",
  };
}

describe("redactEvent", () => {
  it("stamps redaction_applied_at as an ISO datetime", () => {
    const result = redactEvent(makeEvent({ prompt_text: "hello" }));
    expect(result.redaction_applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(result.redaction_applied_at).toString()).not.toBe("Invalid Date");
  });

  it("stamps redaction_version_hash with the vendored ruleset identifier", () => {
    const result = redactEvent(makeEvent({ prompt_text: "hello" }));
    expect(result.redaction_version_hash).toBe(REDACTION_VERSION_HASH);
    // Should embed both the upstream version and the TOML SHA prefix
    expect(result.redaction_version_hash).toContain("gitleaks-v8.21.0");
    expect(result.redaction_version_hash).toContain("fennec-1");
  });

  it("preserves a payload with no secrets (modulo deep-clone)", () => {
    const event = makeEvent({
      prompt_text: "Just an innocuous prompt with no secrets",
      session_id: "s1",
      hook_event: "UserPromptSubmit",
    });
    const result = redactEvent(event);

    expect(result.payload.prompt_text).toBe("Just an innocuous prompt with no secrets");
    expect(result.payload.session_id).toBe("s1");
    expect(result.payload.hook_event).toBe("UserPromptSubmit");
    // Metadata still stamped — proof of passage
    expect(result.redaction_applied_at).not.toBe("");
    expect(result.redaction_version_hash).not.toBe("");
  });

  it("does NOT mutate the input event (returns a fresh object)", () => {
    const event = makeEvent({ prompt_text: "hello" });
    const result = redactEvent(event);
    expect(result).not.toBe(event);
    expect(event.redaction_applied_at).toBe("");
    expect(event.redaction_version_hash).toBe("");
  });

  it("scans deeply nested payload strings", () => {
    const event = makeEvent({
      outer: { middle: { inner: "AKIAIOSFODNN7EXAMPLE in nested string" } },
    });
    const result = redactEvent(event);
    const stringified = JSON.stringify(result.payload);
    expect(stringified).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stringified).toContain("[REDACTED:");
  });

  it("scans values inside arrays of objects", () => {
    const event = makeEvent({
      messages: [
        { role: "user", content: "first message" },
        { role: "user", content: "second with AKIAIOSFODNN7EXAMPLE in it" },
      ],
    });
    const result = redactEvent(event);
    const stringified = JSON.stringify(result.payload);
    expect(stringified).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stringified).toContain("[REDACTED:aws-access-token]");
  });
});
