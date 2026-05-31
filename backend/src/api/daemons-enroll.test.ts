/**
 * POST /api/daemons/enroll (AUTH-14).
 *
 * The enroll handler is the only Phase 1 backend endpoint without a Bearer
 * auth gate -- it's the bootstrap endpoint that ISSUES the first per-machine
 * Bearer token in exchange for the org's install_secret.
 *
 * Idempotency contract (interpreted): re-enrolling the same machine_id always
 * succeeds and returns a VALID api_key. The PRIOR api_key for that machine is
 * revoked (revoked_at = NOW()). The daemon_machine row itself is stable across
 * re-enrolls. This interpretation matches the threat model (T-05-06 -- a
 * replay of the install_secret rotates rather than collides keys) and the
 * cryptographic reality that the backend cannot recover plaintext from
 * token_hash so a "same key" idempotent contract is impossible without
 * insecure plaintext storage.
 */

import type { EnrollResponse } from "@fennec/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../lib/hash.js";
import { createMockClient, stubEnv } from "../test-utils/mock-db.js";

const mockHandle = createMockClient();
vi.mock("../db/client.js", () => ({ pgClient: () => mockHandle.client }));

import daemonsEnrollApp from "./daemons-enroll.js";

const env = stubEnv();
const TEST_ORG = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Phase 1 Test Org",
};
const TEST_MACHINE_UUID = "00000000-0000-0000-0000-000000000004";
const SEEDED_INSTALL_SECRET = "FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa";

async function buildEnrollPayload(overrides: Record<string, unknown> = {}) {
  return {
    install_secret: SEEDED_INSTALL_SECRET,
    machine_id: "PHASE1_SMOKE_MACHINE",
    hostname: "phase1-host",
    os: "darwin" as const,
    ...overrides,
  };
}

/**
 * Default handler simulating a happy-path enrollment:
 *  - lookup orgs -> match
 *  - upsert daemon_machines -> returns the seeded uuid
 *  - revoke prior keys -> 0 rows
 *  - insert api_keys -> returns a new uuid
 *  - insert daemon_audit_events -> 1 row
 */
function defaultHappyPathHandler() {
  const seededHash = "096aa282d8b42aa910a2668753b8c92a64e0fd6602bae427ea2f38086e85e8df";
  let apiKeyCounter = 0;
  return (sql: string, params: unknown[]) => {
    if (/SELECT\s+id,\s*name\s+FROM\s+orgs/i.test(sql)) {
      if (params[0] === seededHash) {
        return { rows: [TEST_ORG], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (/INSERT\s+INTO\s+daemon_machines/i.test(sql)) {
      return { rows: [{ id: TEST_MACHINE_UUID, attached_user_id: null }], rowCount: 1 };
    }
    if (/UPDATE\s+api_keys/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/INSERT\s+INTO\s+api_keys/i.test(sql)) {
      apiKeyCounter += 1;
      return {
        rows: [{ id: `00000000-0000-0000-0000-00000000010${apiKeyCounter}` }],
        rowCount: 1,
      };
    }
    if (/INSERT\s+INTO\s+daemon_audit_events/i.test(sql)) {
      return { rows: [{ id: "audit-id" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
}

describe("POST /api/daemons/enroll (AUTH-14)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    mockHandle.setHandler(defaultHappyPathHandler());
    vi.clearAllMocks();
  });

  it("Test 12: happy path returns 200 with { api_key, api_key_id, org_id, org_name, privacy_policy_url }", async () => {
    const payload = await buildEnrollPayload();
    const res = await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnrollResponse;
    expect(body.api_key).toMatch(/^fennec_/);
    expect(body.api_key_id).toMatch(/^[0-9a-f-]+$/);
    expect(body.org_id).toBe(TEST_ORG.id);
    expect(body.org_name).toBe(TEST_ORG.name);
    expect(body.privacy_policy_url).toContain(env.FENNEC_BASE_URL);
    expect(body.privacy_policy_url).toContain(TEST_ORG.id);

    // The handler MUST have:
    //   1. Looked up the org by install_secret_hash
    //   2. Upserted the daemon_machine
    //   3. Revoked any prior active keys (no-op on first enroll)
    //   4. Issued a new api_key
    //   5. Logged a daemon_audit_event with reason "enrollment_completed"
    const sqls = mockHandle.calls.map((c) => c.sql).join("\n---\n");
    expect(sqls).toMatch(/SELECT\s+id,\s*name\s+FROM\s+orgs/i);
    expect(sqls).toMatch(/INSERT\s+INTO\s+daemon_machines/i);
    expect(sqls).toMatch(/UPDATE\s+api_keys/i);
    expect(sqls).toMatch(/INSERT\s+INTO\s+api_keys/i);
    expect(sqls).toMatch(/INSERT\s+INTO\s+daemon_audit_events/i);
    const auditCalls = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+daemon_audit_events/i.test(c.sql));
    expect(auditCalls[0]?.params).toContain("enrollment_completed");
  });

  it("Test 13: re-enrolling the same machine_id succeeds and issues a fresh api_key (the prior one is revoked)", async () => {
    // First enroll -- happy path; capture the issued key id.
    const payload = await buildEnrollPayload();
    const first = await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as EnrollResponse;
    const firstKeyId = firstBody.api_key_id;

    // Second enroll for the same machine_id -- should ALSO succeed and issue
    // a different api_key_id. The UPDATE api_keys SET revoked_at = NOW()
    // path is exercised here (the handler must invalidate the prior key
    // before issuing the new one).
    const second = await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as EnrollResponse;
    const secondKeyId = secondBody.api_key_id;

    expect(secondKeyId).not.toBe(firstKeyId);
    expect(secondBody.api_key).not.toBe(firstBody.api_key);

    // Both calls hit the revoke + insert SQL paths.
    const revokes = mockHandle.calls.filter((c) => /UPDATE\s+api_keys/i.test(c.sql));
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+api_keys/i.test(c.sql));
    expect(revokes.length).toBeGreaterThanOrEqual(2);
    expect(inserts.length).toBeGreaterThanOrEqual(2);
  });

  it("Test 14: returns 401 invalid_or_expired_install_secret when no matching org exists", async () => {
    const payload = await buildEnrollPayload({ install_secret: "x".repeat(40) });
    const res = await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_or_expired_install_secret");

    // No daemon_machines / api_keys / audit rows should have been written.
    const inserts = mockHandle.calls.filter((c) =>
      /INSERT\s+INTO\s+(daemon_machines|api_keys|daemon_audit_events)/i.test(c.sql),
    );
    expect(inserts).toHaveLength(0);
  });

  it("Test 15: returns 400 when install_secret is shorter than 32 chars (Zod min)", async () => {
    const payload = await buildEnrollPayload({ install_secret: "tooshort" });
    const res = await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("hashes the install_secret before lookup -- threat T-05-03 (no SQL injection vector)", async () => {
    const expectedHash = await sha256Hex(SEEDED_INSTALL_SECRET);
    const payload = await buildEnrollPayload();
    await daemonsEnrollApp.request(
      "/api/daemons/enroll",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    const lookupCall = mockHandle.calls.find((c) => /SELECT\s+id,\s*name\s+FROM\s+orgs/i.test(c.sql));
    expect(lookupCall).toBeDefined();
    // The first parameter MUST be the sha256 hex of the install_secret -- not the raw value.
    expect(lookupCall?.params[0]).toBe(expectedHash);
    expect(JSON.stringify(lookupCall?.params)).not.toContain(SEEDED_INSTALL_SECRET);
  });
});
