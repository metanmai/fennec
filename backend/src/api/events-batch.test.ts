import type { CanonicalEvent, EventBatch } from "@fennec/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient, stubEnv } from "../test-utils/mock-db.js";

// Mock the pgClient factory so the handler picks up our in-memory mock.
const mockHandle = createMockClient();
vi.mock("../db/client.js", () => ({
  pgClient: () => mockHandle.client,
}));
// Mock resolveApiKey so we don't run a real DB round trip for every bearer-auth call.
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

import eventsBatchApp from "./events-batch.js";

const env = stubEnv();

const SEEDED_TOKEN = "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd";

function buildEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    idempotency_key: "abcdef0123456789abcdef0123456789",
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "phase1-host",
    os: "darwin",
    kind: "prompt",
    payload: { hello: "world" },
    schema_version: 1,
    redaction_applied_at: "2026-05-31T12:00:00.000Z",
    redaction_version_hash: "deadbeef",
    ...overrides,
  };
}

function buildBatch(events: CanonicalEvent[] = [buildEvent()]): EventBatch {
  return { events };
}

describe("POST /api/events/batch (ING-01..04, AUTH-10)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    mockHandle.setHandler(() => ({ rows: [], rowCount: 1 }));
    vi.clearAllMocks();
  });

  // ---- Auth (AUTH-10) -----------------------------------------------------

  it("Test 7: returns 401 without an Authorization header", async () => {
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      {
        method: "POST",
        body: JSON.stringify(buildBatch()),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(mockHandle.calls).toHaveLength(0);
  });

  it("Test 8: returns 401 with an unknown Bearer token", async () => {
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      {
        method: "POST",
        body: JSON.stringify(buildBatch()),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong_token_does_not_exist",
        },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("Test 9: returns 200 with the seeded Bearer token", async () => {
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      {
        method: "POST",
        body: JSON.stringify(buildBatch()),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEEDED_TOKEN}`,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  // ---- Happy path (ING-01) -------------------------------------------------

  it("Test 1: happy path returns 200 { accepted: N } and inserts events stamped with auth-context org_id", async () => {
    const batch = buildBatch([
      buildEvent({ idempotency_key: "aaaaa".padEnd(32, "a") }),
      buildEvent({ idempotency_key: "bbbbb".padEnd(32, "b") }),
    ]);
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      {
        method: "POST",
        body: JSON.stringify(batch),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEEDED_TOKEN}`,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(2);

    // The handler should have issued one INSERT per event.
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+ai_events/i.test(c.sql));
    expect(inserts).toHaveLength(2);

    // Each insert's parameter array should include the auth-context org_id
    // (not whatever the request body provided -- threat T-05-02). The org_id
    // is the second parameter in the canonical INSERT shape.
    for (const call of inserts) {
      expect(call.params).toContain(seededAuth.org_id);
    }
  });
});

describe("POST /api/events/batch - tenancy enforcement (T-05-02)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    mockHandle.setHandler(() => ({ rows: [], rowCount: 1 }));
    vi.clearAllMocks();
  });

  it("Test 5: ignores any client-supplied org_id in the request body -- handler stamps org_id from auth context", async () => {
    // Even though CanonicalEventSchema does not include `org_id`, attackers
    // might attempt to slip one through as an extra JSON field. The handler
    // MUST stamp the row's org_id from the auth context exclusively.
    const event = buildEvent();
    const evil = { ...event, org_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
    const batch = { events: [evil] };

    const res = await eventsBatchApp.request(
      "/api/events/batch",
      {
        method: "POST",
        body: JSON.stringify(batch),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEEDED_TOKEN}`,
        },
      },
      env,
    );
    // Either the strict Zod parser strips the unknown field (canonical events
    // are .strict()/.passthrough() depending on the schema posture) OR the
    // handler stamps the auth-context org_id. EITHER way, the inserted row's
    // org_id must be the seeded one, NEVER the attacker-supplied one.
    expect([200, 400]).toContain(res.status);
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+ai_events/i.test(c.sql));
    for (const call of inserts) {
      expect(call.params).toContain(seededAuth.org_id);
      expect(call.params).not.toContain("ffffffff-ffff-ffff-ffff-ffffffffffff");
    }
  });
});
