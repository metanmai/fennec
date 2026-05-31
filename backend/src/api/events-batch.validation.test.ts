/**
 * Zod-validation rejection paths for POST /api/events/batch.
 * Malformed payloads return 400; zero rows are inserted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient, stubEnv } from "../test-utils/mock-db.js";

const mockHandle = createMockClient();
vi.mock("../db/client.js", () => ({ pgClient: () => mockHandle.client }));
vi.mock("../lib/resolve-api-key.js", () => ({
  resolveApiKey: vi.fn(async () => ({
    api_key_id: "00000000-0000-0000-0000-000000000005",
    org_id: "00000000-0000-0000-0000-000000000001",
    daemon_machine_id: "00000000-0000-0000-0000-000000000004",
    hostname: "phase1-host",
  })),
}));

import eventsBatchApp from "./events-batch.js";

const env = stubEnv();
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd",
};

describe("POST /api/events/batch -- Zod validation", () => {
  beforeEach(() => {
    mockHandle.calls.length = 0;
    vi.clearAllMocks();
  });

  it("Test 2: rejects with 400 when a required field (idempotency_key) is missing from an event", async () => {
    const body = {
      events: [
        {
          // intentionally missing idempotency_key
          tool: "claude-code",
          adapter_version: "0.1.0",
          occurred_at: "2026-05-31T12:00:00.000Z",
          hostname: "phase1-host",
          os: "darwin",
          kind: "prompt",
          payload: {},
          schema_version: 1,
          redaction_applied_at: "2026-05-31T12:00:00.000Z",
          redaction_version_hash: "deadbeef",
        },
      ],
    };
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      { method: "POST", body: JSON.stringify(body), headers },
      env,
    );
    expect(res.status).toBe(400);
    // No INSERT must reach the DB on a validation failure.
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+ai_events/i.test(c.sql));
    expect(inserts).toHaveLength(0);
  });

  it("Test 3: rejects with 400 when events array is empty (EventBatchSchema enforces min(1))", async () => {
    const body = { events: [] };
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      { method: "POST", body: JSON.stringify(body), headers },
      env,
    );
    expect(res.status).toBe(400);
    const inserts = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+ai_events/i.test(c.sql));
    expect(inserts).toHaveLength(0);
  });

  it("rejects with 400 when events array exceeds 500 entries", async () => {
    const event = {
      idempotency_key: "x".repeat(32),
      tool: "claude-code",
      adapter_version: "0.1.0",
      occurred_at: "2026-05-31T12:00:00.000Z",
      hostname: "phase1-host",
      os: "darwin",
      kind: "prompt",
      payload: {},
      schema_version: 1,
      redaction_applied_at: "2026-05-31T12:00:00.000Z",
      redaction_version_hash: "deadbeef",
    };
    const body = { events: Array.from({ length: 501 }, () => event) };
    const res = await eventsBatchApp.request(
      "/api/events/batch",
      { method: "POST", body: JSON.stringify(body), headers },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects with 400 when the request body is not JSON", async () => {
    const res = await eventsBatchApp.request("/api/events/batch", { method: "POST", body: "not-json", headers }, env);
    expect(res.status).toBe(400);
  });
});
