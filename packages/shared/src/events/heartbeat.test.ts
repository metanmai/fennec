import { describe, expect, it } from "vitest";
import { type AdapterHeartbeat, AdapterHeartbeatSchema } from "./heartbeat.js";

function buildHeartbeat(overrides?: Partial<AdapterHeartbeat>): AdapterHeartbeat {
  const base: AdapterHeartbeat = {
    idempotency_key: "macbook|claude-code|2026-05-31T05:00:00.000Z",
    hostname: "macbook-pro.local",
    adapter: "claude-code",
    adapter_version: "0.1.0",
    schema_hash: "field-set-sha256-abc",
    events_parsed: 0,
    parse_errors: 0,
    daemon_unreachable_count: 0,
    interval_start: "2026-05-31T05:00:00.000Z",
    interval_end: "2026-05-31T05:05:00.000Z",
    schema_version: 1,
  };
  return { ...base, ...(overrides ?? {}) };
}

describe("AdapterHeartbeatSchema", () => {
  it("accepts a heartbeat with events_parsed=0 and parse_errors=0 (Test 8 / PITFALL P3)", () => {
    const hb = buildHeartbeat();
    const parsed = AdapterHeartbeatSchema.parse(hb);
    expect(parsed.events_parsed).toBe(0);
    expect(parsed.parse_errors).toBe(0);
  });

  it("throws when events_parsed is missing (Test 9 — field is required, not optional)", () => {
    const hb = buildHeartbeat();
    const broken: Record<string, unknown> = { ...hb };
    delete broken.events_parsed;
    const r = AdapterHeartbeatSchema.safeParse(broken);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("events_parsed");
    }
  });

  it("throws when parse_errors is missing", () => {
    const hb = buildHeartbeat();
    const broken: Record<string, unknown> = { ...hb };
    delete broken.parse_errors;
    const r = AdapterHeartbeatSchema.safeParse(broken);
    expect(r.success).toBe(false);
  });

  it("accepts a heartbeat reporting many events, zero errors, some daemon-unreachable counts", () => {
    const r = AdapterHeartbeatSchema.safeParse(
      buildHeartbeat({ events_parsed: 100, parse_errors: 0, daemon_unreachable_count: 5 }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.daemon_unreachable_count).toBe(5);
    }
  });

  it("defaults daemon_unreachable_count to 0 when omitted from input", () => {
    const hb = buildHeartbeat();
    const input: Record<string, unknown> = { ...hb };
    delete input.daemon_unreachable_count;
    const parsed = AdapterHeartbeatSchema.parse(input);
    expect(parsed.daemon_unreachable_count).toBe(0);
  });

  it("rejects negative events_parsed", () => {
    const r = AdapterHeartbeatSchema.safeParse(buildHeartbeat({ events_parsed: -1 }));
    expect(r.success).toBe(false);
  });

  it("rejects non-literal schema_version", () => {
    const broken = { ...buildHeartbeat(), schema_version: 2 as unknown as 1 };
    const r = AdapterHeartbeatSchema.safeParse(broken);
    expect(r.success).toBe(false);
  });
});
