/**
 * POST /api/daemons/uninstall (DAE-19).
 *
 * Plan 01-05 Tests 8 / 9 / 10:
 *   - happy path: 200 + audit row + api_keys.revoked_at set
 *   - subsequent /api/events/batch with the same key would fail (key revoked)
 *     -- in unit-test mode we verify revokeApiKey was called with api_key_id
 *   - reason outside the 3-value enum -> 400
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient, stubEnv } from "../test-utils/mock-db.js";

const mockHandle = createMockClient();
vi.mock("../db/client.js", () => ({ pgClient: () => mockHandle.client }));

const seededAuth = {
  api_key_id: "00000000-0000-0000-0000-000000000005",
  org_id: "00000000-0000-0000-0000-000000000001",
  daemon_machine_id: "00000000-0000-0000-0000-000000000004",
  hostname: "phase1-host",
};
vi.mock("../lib/resolve-api-key.js", () => ({
  resolveApiKey: vi.fn(async (token: string) =>
    token === "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd" ? seededAuth : null,
  ),
}));

import daemonsUninstallApp from "./daemons-uninstall.js";

const env = stubEnv();
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd",
};

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: "uninstall-x-x-x-x-x-x-x-x-x-x-x-x",
    machine_id: "PHASE1_SMOKE_MACHINE",
    hostname: "phase1-host",
    reason: "user_initiated",
    occurred_at: "2026-05-31T12:00:00.000Z",
    schema_version: 1,
    ...overrides,
  };
}

describe("POST /api/daemons/uninstall (DAE-19)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    mockHandle.setHandler((sql) => {
      if (/INSERT\s+INTO\s+daemon_audit_events/i.test(sql)) {
        return { rows: [{ id: "audit-uuid" }], rowCount: 1 };
      }
      if (/UPDATE\s+api_keys/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    vi.clearAllMocks();
  });

  it("Test 8: happy path inserts audit row with the supplied reason + revokes the calling api_key", async () => {
    const res = await daemonsUninstallApp.request(
      "/api/daemons/uninstall",
      { method: "POST", body: JSON.stringify(buildBody()), headers },
      env,
    );
    expect(res.status).toBe(200);

    const auditCalls = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+daemon_audit_events/i.test(c.sql));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.params).toContain("user_initiated");
    expect(auditCalls[0]?.params).toContain(seededAuth.org_id);

    const revokes = mockHandle.calls.filter((c) => /UPDATE\s+api_keys/i.test(c.sql));
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.params).toContain(seededAuth.api_key_id);
  });

  it("Test 9: after uninstall, the api_keys row's revoked_at is set (verified by the UPDATE param)", async () => {
    // Test 9 in the plan describes the e2e: replay the call with the same
    // Bearer should 401. In unit-test mode we already mock resolveApiKey to
    // return either the seeded auth or null based on the token string; what
    // we DO assert here is that the uninstall handler's UPDATE api_keys SET
    // revoked_at = NOW() was issued for the calling api_key_id.
    await daemonsUninstallApp.request(
      "/api/daemons/uninstall",
      { method: "POST", body: JSON.stringify(buildBody()), headers },
      env,
    );
    const revoke = mockHandle.calls.find((c) => /UPDATE\s+api_keys/i.test(c.sql));
    expect(revoke?.sql).toMatch(/revoked_at\s*=\s*NOW\(\)/i);
    expect(revoke?.params).toEqual([seededAuth.api_key_id]);
  });

  it("Test 10: reason outside the 3-value enum returns 400", async () => {
    const res = await daemonsUninstallApp.request(
      "/api/daemons/uninstall",
      { method: "POST", body: JSON.stringify(buildBody({ reason: "other_unsupported" })), headers },
      env,
    );
    expect(res.status).toBe(400);
    const writes = mockHandle.calls.filter((c) => /INSERT|UPDATE/i.test(c.sql));
    expect(writes).toHaveLength(0);
  });

  it("rejects with 401 when no bearer token is supplied", async () => {
    const res = await daemonsUninstallApp.request(
      "/api/daemons/uninstall",
      {
        method: "POST",
        body: JSON.stringify(buildBody()),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(401);
  });
});
