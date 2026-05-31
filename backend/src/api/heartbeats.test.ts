/**
 * POST /api/heartbeats tests.
 *
 * Plan 01-05 Tests 10 + 11:
 *   - happy path inserts a row with auth-context org_id
 *   - replay with the same idempotency_key returns 201 but no duplicate row
 */

import type { AdapterHeartbeat } from "@fennec/shared";
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

import heartbeatsApp from "./heartbeats.js";

const env = stubEnv();
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd",
};

function buildHeartbeat(overrides: Partial<AdapterHeartbeat> = {}): AdapterHeartbeat {
  return {
    idempotency_key: "hb-".padEnd(40, "h"),
    hostname: "phase1-host",
    adapter: "claude-code",
    adapter_version: "0.1.0",
    schema_hash: "schema-hash-v1",
    events_parsed: 0,
    parse_errors: 0,
    daemon_unreachable_count: 0,
    interval_start: "2026-05-31T11:59:00.000Z",
    interval_end: "2026-05-31T12:00:00.000Z",
    schema_version: 1,
    ...overrides,
  };
}

describe("POST /api/heartbeats (CAP-14)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    vi.clearAllMocks();
  });

  it("Test 10: happy path inserts a heartbeat row with auth-context org_id", async () => {
    mockHandle.setHandler((sql) => {
      if (/INSERT\s+INTO\s+adapter_heartbeats/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await heartbeatsApp.request(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(buildHeartbeat()), headers },
      env,
    );
    expect(res.status).toBe(201);

    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+adapter_heartbeats/i.test(c.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params).toContain(seededAuth.org_id);
    expect(inserts[0]?.params).toContain(seededAuth.daemon_machine_id);
    // ON CONFLICT (idempotency_key) DO NOTHING is the dedupe path.
    expect(inserts[0]?.sql).toMatch(/ON\s+CONFLICT\s*\(\s*idempotency_key\s*\)\s*DO\s+NOTHING/i);
  });

  it("Test 11: replay with the same idempotency_key returns 201 but inserts zero new rows", async () => {
    const seen = new Set<string>();
    mockHandle.setHandler((sql, params) => {
      if (/INSERT\s+INTO\s+adapter_heartbeats/i.test(sql)) {
        // The idempotency_key parameter position depends on the INSERT shape;
        // search the whole params array for the heartbeat key.
        const key = (params as unknown[]).find((p) => typeof p === "string" && (p as string).startsWith("hb-"));
        if (typeof key === "string" && seen.has(key)) {
          return { rows: [], rowCount: 0 };
        }
        if (typeof key === "string") seen.add(key);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const a = await heartbeatsApp.request(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(buildHeartbeat()), headers },
      env,
    );
    const b = await heartbeatsApp.request(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(buildHeartbeat()), headers },
      env,
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(seen.size).toBe(1);
  });

  it("rejects with 401 when no bearer token is supplied", async () => {
    const res = await heartbeatsApp.request(
      "/api/heartbeats",
      {
        method: "POST",
        body: JSON.stringify(buildHeartbeat()),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects with 400 when events_parsed is negative (Zod validation)", async () => {
    const hb = { ...buildHeartbeat(), events_parsed: -1 };
    const res = await heartbeatsApp.request(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(hb), headers },
      env,
    );
    expect(res.status).toBe(400);
  });
});
