import { describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "./idempotency.js";

const BASE = {
  hostname: "macbook-pro.local",
  tool: "claude-code" as const,
  session_id: "session-abc-123",
  hook_event: "UserPromptSubmit",
  monotonic_seq: 1,
};

describe("deriveIdempotencyKey", () => {
  it("returns a 32-char lowercase hex string (Test 1)", async () => {
    const key = await deriveIdempotencyKey(BASE);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns the SAME key for identical inputs (stability — Test 2 / PITFALL P5)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE });
    const c = await deriveIdempotencyKey({ ...BASE });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns DIFFERENT keys when hostname changes (Test 3a)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE, hostname: "other-host.local" });
    expect(a).not.toBe(b);
  });

  it("returns DIFFERENT keys when tool changes (Test 3b)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE, tool: "codex" });
    expect(a).not.toBe(b);
  });

  it("returns DIFFERENT keys when session_id changes (Test 3c)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE, session_id: "different-session" });
    expect(a).not.toBe(b);
  });

  it("returns DIFFERENT keys when hook_event changes (Test 3d)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE, hook_event: "PostToolUse" });
    expect(a).not.toBe(b);
  });

  it("returns DIFFERENT keys when monotonic_seq changes (Test 3e)", async () => {
    const a = await deriveIdempotencyKey(BASE);
    const b = await deriveIdempotencyKey({ ...BASE, monotonic_seq: 2 });
    expect(a).not.toBe(b);
  });

  it("is collision-resistant for a small sample of distinct inputs", async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(await deriveIdempotencyKey({ ...BASE, monotonic_seq: i }));
    }
    expect(keys.size).toBe(100);
  });
});
