import { describe, expect, it } from "vitest";
import { type CanonicalEvent, CanonicalEventSchema, EventBatchSchema } from "./canonical.js";
import { ClaudeCodePromptPayloadSchema } from "./claude-code-payload.js";

function buildEvent(overrides?: Partial<CanonicalEvent>): CanonicalEvent {
  const base: CanonicalEvent = {
    idempotency_key: "a".repeat(32),
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T05:00:00.000Z",
    hostname: "macbook-pro.local",
    os: "darwin",
    kind: "prompt_submitted",
    payload: { prompt_text: "hello world", session_id: "s-001", hook_event: "UserPromptSubmit" },
    schema_version: 1,
    redaction_applied_at: "2026-05-31T05:00:00.001Z",
    redaction_version_hash: "gitleaks-v8.21-defaults",
  };
  return { ...base, ...(overrides ?? {}) };
}

describe("CanonicalEventSchema", () => {
  it("parses a valid minimal event unchanged (Test 1)", () => {
    const e = buildEvent();
    const parsed = CanonicalEventSchema.parse(e);
    expect(parsed).toEqual(e);
    expect(parsed.schema_version).toBe(1);
  });

  it("throws with path idempotency_key when missing (Test 2)", () => {
    const e = buildEvent();
    const broken: Record<string, unknown> = { ...e };
    delete broken.idempotency_key;
    const r = CanonicalEventSchema.safeParse(broken);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("idempotency_key");
    }
  });

  it("throws when schema_version is not literal 1 (Test 3)", () => {
    const broken = { ...buildEvent(), schema_version: 2 as unknown as 1 };
    const r = CanonicalEventSchema.safeParse(broken);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("schema_version");
    }
  });

  it("rejects malformed occurred_at (non-ISO)", () => {
    const broken = { ...buildEvent(), occurred_at: "not-a-date" };
    const r = CanonicalEventSchema.safeParse(broken);
    expect(r.success).toBe(false);
  });

  it("rejects unknown tool value", () => {
    const broken = { ...buildEvent(), tool: "made-up-tool" as unknown as CanonicalEvent["tool"] };
    const r = CanonicalEventSchema.safeParse(broken);
    expect(r.success).toBe(false);
  });
});

describe("EventBatchSchema", () => {
  it("throws when events array is empty (Test 4)", () => {
    const r = EventBatchSchema.safeParse({ events: [] });
    expect(r.success).toBe(false);
  });

  it("throws when events array exceeds 500 entries (Test 5)", () => {
    const events = Array.from({ length: 501 }, (_, i) =>
      buildEvent({ idempotency_key: i.toString(16).padStart(32, "0") }),
    );
    const r = EventBatchSchema.safeParse({ events });
    expect(r.success).toBe(false);
  });

  it("accepts a single-event batch", () => {
    const r = EventBatchSchema.safeParse({ events: [buildEvent()] });
    expect(r.success).toBe(true);
  });

  it("accepts a 500-event batch (boundary)", () => {
    const events = Array.from({ length: 500 }, (_, i) =>
      buildEvent({ idempotency_key: i.toString(16).padStart(32, "0") }),
    );
    const r = EventBatchSchema.safeParse({ events });
    expect(r.success).toBe(true);
  });
});

describe("ClaudeCodePromptPayloadSchema (ANL-06: four separate token fields)", () => {
  it("preserves all 4 token fields as SEPARATE numbers (Test 6)", () => {
    const payload = {
      prompt_text: "redacted-or-plain-text",
      session_id: "session-abc",
      hook_event: "PostToolUse",
      usage: {
        input_tokens: 100,
        output_tokens: 30,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 20,
      },
    };
    const parsed = ClaudeCodePromptPayloadSchema.parse(payload);
    expect(parsed.usage).toBeDefined();
    expect(parsed.usage?.input_tokens).toBe(100);
    expect(parsed.usage?.output_tokens).toBe(30);
    expect(parsed.usage?.cache_creation_input_tokens).toBe(50);
    expect(parsed.usage?.cache_read_input_tokens).toBe(20);
    // Critical: no aggregate field; the four numbers must remain distinct.
    const usageKeys = Object.keys(parsed.usage ?? {}).sort();
    expect(usageKeys).toEqual([
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "input_tokens",
      "output_tokens",
    ]);
  });

  it("rejects negative input_tokens (Test 7)", () => {
    const payload = {
      prompt_text: "x",
      session_id: "s",
      hook_event: "PostToolUse",
      usage: {
        input_tokens: -1,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const r = ClaudeCodePromptPayloadSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it("accepts a payload with usage omitted entirely", () => {
    const r = ClaudeCodePromptPayloadSchema.safeParse({
      prompt_text: "x",
      session_id: "s",
      hook_event: "UserPromptSubmit",
    });
    expect(r.success).toBe(true);
  });

  it("accepts cwd as optional", () => {
    const r = ClaudeCodePromptPayloadSchema.safeParse({
      prompt_text: "x",
      session_id: "s",
      hook_event: "UserPromptSubmit",
      cwd: "/Users/dev/proj",
    });
    expect(r.success).toBe(true);
  });
});
