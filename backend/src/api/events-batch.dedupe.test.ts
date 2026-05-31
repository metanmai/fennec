/**
 * ING-02: replaying the same batch produces no duplicate rows.
 *
 * In the real Postgres, the PK on `ai_events (idempotency_key, occurred_at)`
 * plus `INSERT ... ON CONFLICT (idempotency_key, occurred_at) DO NOTHING`
 * makes the upsert idempotent. The mock simulates that behaviour by tracking
 * seen idempotency keys across the two requests.
 */

import type { CanonicalEvent, EventBatch } from "@fennec/shared";
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
  resolveApiKey: vi.fn(async () => seededAuth),
}));

import eventsBatchApp from "./events-batch.js";

const env = stubEnv();
const SEEDED_TOKEN = "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd";

function buildEvent(idempotency_key: string): CanonicalEvent {
  return {
    idempotency_key,
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
  };
}

describe("POST /api/events/batch dedupe (ING-02)", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    vi.clearAllMocks();
  });

  it("Test 4: posting the same batch twice yields 200/200 and inserts only N unique idempotency keys", async () => {
    const seen = new Set<string>();
    // Simulate ON CONFLICT DO NOTHING via a stateful handler.
    mockHandle.setHandler((sql, params) => {
      if (/INSERT\s+INTO\s+ai_events/i.test(sql)) {
        const key = params[0] as string;
        if (seen.has(key)) {
          return { rows: [], rowCount: 0 }; // conflict -> 0 rows affected
        }
        seen.add(key);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const batch: EventBatch = {
      events: [buildEvent("a".repeat(32)), buildEvent("b".repeat(32))],
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SEEDED_TOKEN}`,
    };

    const first = await eventsBatchApp.request(
      "/api/events/batch",
      { method: "POST", body: JSON.stringify(batch), headers },
      env,
    );
    expect(first.status).toBe(200);

    const second = await eventsBatchApp.request(
      "/api/events/batch",
      { method: "POST", body: JSON.stringify(batch), headers },
      env,
    );
    expect(second.status).toBe(200);

    // Both calls succeeded; the mock recorded 4 INSERT attempts (2 events x 2
    // requests) but only 2 unique idempotency keys actually persisted.
    expect(seen.size).toBe(2);

    // Verify every INSERT uses the ON CONFLICT (idempotency_key, occurred_at)
    // DO NOTHING clause; this is the ING-02 contract.
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+ai_events/i.test(c.sql));
    expect(inserts).toHaveLength(4);
    for (const call of inserts) {
      expect(call.sql).toMatch(/ON\s+CONFLICT\s*\(\s*idempotency_key\s*,\s*occurred_at\s*\)\s*DO\s+NOTHING/i);
    }
  });
});
