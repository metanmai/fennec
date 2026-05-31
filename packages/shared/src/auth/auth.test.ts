import { describe, expect, it } from "vitest";
import { AttachCallbackRequestSchema, AttachCallbackResponseSchema } from "./attach.js";
import { EnrollRequestSchema, EnrollResponseSchema } from "./enrollment.js";
import { UninstallAuditEventSchema, UninstallReasonSchema } from "./uninstall.js";

describe("EnrollRequestSchema (AUTH-14 + threat T-02-04)", () => {
  it("rejects install_secret shorter than 32 chars (Test 4)", () => {
    const r = EnrollRequestSchema.safeParse({
      install_secret: "x".repeat(31),
      machine_id: "abcdefgh",
      hostname: "h",
      os: "darwin",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("install_secret");
    }
  });

  it("accepts install_secret of exactly 32 chars (Test 5)", () => {
    const r = EnrollRequestSchema.safeParse({
      install_secret: "x".repeat(32),
      machine_id: "abcdefgh",
      hostname: "h",
      os: "darwin",
    });
    expect(r.success).toBe(true);
  });

  it("rejects machine_id shorter than 8 chars", () => {
    const r = EnrollRequestSchema.safeParse({
      install_secret: "x".repeat(32),
      machine_id: "short",
      hostname: "h",
      os: "darwin",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown os value", () => {
    const r = EnrollRequestSchema.safeParse({
      install_secret: "x".repeat(32),
      machine_id: "abcdefgh",
      hostname: "h",
      os: "freebsd",
    });
    expect(r.success).toBe(false);
  });
});

describe("EnrollResponseSchema", () => {
  it("validates a well-formed response", () => {
    const r = EnrollResponseSchema.safeParse({
      api_key: "fk_live_abc123",
      api_key_id: "11111111-2222-3333-4444-555555555555",
      org_id: "00000000-1111-2222-3333-444444444444",
      org_name: "Acme Corp",
      privacy_policy_url: "https://fennec.dev/privacy/00000000-1111-2222-3333-444444444444",
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed UUIDs", () => {
    const r = EnrollResponseSchema.safeParse({
      api_key: "fk_live_abc123",
      api_key_id: "not-a-uuid",
      org_id: "00000000-1111-2222-3333-444444444444",
      org_name: "Acme",
      privacy_policy_url: "https://fennec.dev/privacy",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-URL privacy_policy_url", () => {
    const r = EnrollResponseSchema.safeParse({
      api_key: "fk_live_abc123",
      api_key_id: "11111111-2222-3333-4444-555555555555",
      org_id: "00000000-1111-2222-3333-444444444444",
      org_name: "Acme",
      privacy_policy_url: "not a url",
    });
    expect(r.success).toBe(false);
  });
});

describe("AttachCallbackRequestSchema (AUTH-16 / RFC 7636 PKCE)", () => {
  it("accepts code_verifier of exactly 43 chars (Test 6, lower bound)", () => {
    const r = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "y",
      code_verifier: "a".repeat(43),
      machine_id: "machine01",
    });
    expect(r.success).toBe(true);
  });

  it("rejects code_verifier of 42 chars (Test 7, below RFC 7636 floor)", () => {
    const r = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "y",
      code_verifier: "a".repeat(42),
      machine_id: "machine01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("code_verifier");
    }
  });

  it("accepts code_verifier of exactly 128 chars (RFC 7636 ceiling)", () => {
    const r = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "y",
      code_verifier: "a".repeat(128),
      machine_id: "machine01",
    });
    expect(r.success).toBe(true);
  });

  it("rejects code_verifier of 129 chars (above RFC 7636 ceiling)", () => {
    const r = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "y",
      code_verifier: "a".repeat(129),
      machine_id: "machine01",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty code or state", () => {
    const r1 = AttachCallbackRequestSchema.safeParse({
      code: "",
      state: "y",
      code_verifier: "a".repeat(43),
      machine_id: "machine01",
    });
    const r2 = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "",
      code_verifier: "a".repeat(43),
      machine_id: "machine01",
    });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("rejects machine_id shorter than 8 chars", () => {
    const r = AttachCallbackRequestSchema.safeParse({
      code: "x",
      state: "y",
      code_verifier: "a".repeat(43),
      machine_id: "short",
    });
    expect(r.success).toBe(false);
  });
});

describe("AttachCallbackResponseSchema", () => {
  it("validates a well-formed response", () => {
    const r = AttachCallbackResponseSchema.safeParse({
      user_id: "11111111-2222-3333-4444-555555555555",
      email: "dev@example.com",
      org_id: "00000000-1111-2222-3333-444444444444",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-email", () => {
    const r = AttachCallbackResponseSchema.safeParse({
      user_id: "11111111-2222-3333-4444-555555555555",
      email: "not-an-email",
      org_id: "00000000-1111-2222-3333-444444444444",
    });
    expect(r.success).toBe(false);
  });
});

describe("UninstallReasonSchema + UninstallAuditEventSchema (D-18, D-19, DAE-19)", () => {
  it("accepts each of the three valid reasons (Test 8a)", () => {
    for (const reason of ["user_initiated", "mdm_revoke", "admin_initiated"] as const) {
      const r = UninstallReasonSchema.safeParse(reason);
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown reason value (Test 8b)", () => {
    const r = UninstallReasonSchema.safeParse("other");
    expect(r.success).toBe(false);
  });

  it("validates a complete uninstall audit event with mdm_revoke", () => {
    const r = UninstallAuditEventSchema.safeParse({
      idempotency_key: "abc",
      machine_id: "abcdefgh",
      hostname: "h",
      reason: "mdm_revoke",
      actor: "admin@example.com",
      occurred_at: "2026-05-31T05:00:00.000Z",
      schema_version: 1,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an audit event without actor (actor is optional)", () => {
    const r = UninstallAuditEventSchema.safeParse({
      idempotency_key: "abc",
      machine_id: "abcdefgh",
      hostname: "h",
      reason: "user_initiated",
      occurred_at: "2026-05-31T05:00:00.000Z",
      schema_version: 1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects audit event with reason 'other'", () => {
    const r = UninstallAuditEventSchema.safeParse({
      idempotency_key: "abc",
      machine_id: "abcdefgh",
      hostname: "h",
      reason: "other",
      occurred_at: "2026-05-31T05:00:00.000Z",
      schema_version: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects audit event with non-literal schema_version", () => {
    const r = UninstallAuditEventSchema.safeParse({
      idempotency_key: "abc",
      machine_id: "abcdefgh",
      hostname: "h",
      reason: "user_initiated",
      occurred_at: "2026-05-31T05:00:00.000Z",
      schema_version: 2,
    });
    expect(r.success).toBe(false);
  });
});
