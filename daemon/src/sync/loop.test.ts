/**
 * Sync loop tests (Task 3 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 5, 6, 7):
 *  - Test 5: queue of 250 events + 0-watermark → first iteration POSTs
 *    100 events, advances watermark; next iteration POSTs next 100
 *  - Test 6: 5xx → watermark does NOT advance; backoff increases
 *    (sleep called with progressively larger delays)
 *  - Test 7: 4xx → watermark DOES advance (events unsalvageable);
 *    backoff resets
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@fennec/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../adapters/registry.js";
import { appendEvent } from "../queue/jsonl.js";
import { readWatermark } from "../queue/watermark.js";
import { SyncLoop } from "./loop.js";

function makeEvent(i: number): CanonicalEvent {
  return {
    idempotency_key: `key-${String(i).padStart(4, "0")}`,
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "h",
    os: "darwin",
    kind: "prompt_submitted",
    payload: { i },
    schema_version: 1,
    redaction_applied_at: "2026-05-31T12:00:00.000Z",
    redaction_version_hash: "test",
  };
}

describe("SyncLoop", () => {
  let dir: string;
  let queuePath: string;
  let watermarkPath: string;
  let seqDir: string;
  let registry: AdapterRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-sync-"));
    queuePath = join(dir, "events.jsonl");
    watermarkPath = join(dir, "sync-state.json");
    seqDir = join(dir, "seq");
    registry = new AdapterRegistry({ queuePath, seqDir });
    registry.register({
      tool: "claude-code",
      version: "0.1.0",
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("POSTs up to batchSize events per iteration, advances watermark on 2xx", async () => {
    for (let i = 0; i < 250; i++) appendEvent(makeEvent(i), queuePath);

    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_key",
      queuePath,
      watermarkPath,
      registry,
      batchSize: 100,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    function getCallInit(i: number): RequestInit {
      const call = fetchFn.mock.calls[i];
      if (!call) throw new Error(`expected fetch call #${i}`);
      const init = call[1] as RequestInit | undefined;
      if (!init) throw new Error(`expected RequestInit on fetch call #${i}`);
      return init;
    }
    function getCallUrl(i: number): string {
      const call = fetchFn.mock.calls[i];
      if (!call) throw new Error(`expected fetch call #${i}`);
      return call[0] as string;
    }

    // First iteration: 100 events, watermark advances to event 99
    await loop.iteration();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(getCallUrl(0)).toBe("https://api.fennec.test/api/events/batch");
    const init = getCallInit(0);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fennec_key");
    const body = JSON.parse(init.body as string) as { events: CanonicalEvent[] };
    expect(body.events).toHaveLength(100);
    expect(body.events[0]?.idempotency_key).toBe("key-0000");
    expect(body.events[99]?.idempotency_key).toBe("key-0099");
    expect(readWatermark(watermarkPath)).toEqual({
      last_synced_event_idempotency_key: "key-0099",
    });

    // Second iteration: next 100 events, watermark advances to event 199
    await loop.iteration();
    const body2 = JSON.parse(getCallInit(1).body as string) as { events: CanonicalEvent[] };
    expect(body2.events).toHaveLength(100);
    expect(body2.events[0]?.idempotency_key).toBe("key-0100");
    expect(body2.events[99]?.idempotency_key).toBe("key-0199");
    expect(readWatermark(watermarkPath)).toEqual({
      last_synced_event_idempotency_key: "key-0199",
    });

    // Third iteration: remaining 50 events, watermark advances to event 249
    await loop.iteration();
    const body3 = JSON.parse(getCallInit(2).body as string) as { events: CanonicalEvent[] };
    expect(body3.events).toHaveLength(50);
    expect(readWatermark(watermarkPath)).toEqual({
      last_synced_event_idempotency_key: "key-0249",
    });
  });

  it("does NOT advance the watermark on 5xx + sleeps with increasing backoff", async () => {
    for (let i = 0; i < 50; i++) appendEvent(makeEvent(i), queuePath);

    const fetchFn = vi.fn<typeof fetch>(async () => new Response("oops", { status: 503 }));
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_key",
      queuePath,
      watermarkPath,
      registry,
      batchSize: 100,
      backoffBaseMs: 100,
      backoffMaxMs: 5_000,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    await loop.iteration();
    await loop.iteration();
    await loop.iteration();

    expect(fetchFn).toHaveBeenCalledTimes(3);
    // Watermark never advanced
    expect(readWatermark(watermarkPath)).toBeNull();

    // Sleep called with progressively larger delays
    expect(sleepFn).toHaveBeenCalledTimes(3);
    const sleepArgs: number[] = [];
    for (const c of sleepFn.mock.calls) {
      sleepArgs.push(c[0]);
    }
    if (sleepArgs.length < 3) throw new Error("expected 3 sleep calls");
    const s0 = sleepArgs[0] as number;
    const s1 = sleepArgs[1] as number;
    const s2 = sleepArgs[2] as number;
    expect(s0).toBeLessThan(s1);
    expect(s1).toBeLessThan(s2);
  });

  it("advances the watermark on 4xx (events unsalvageable) + resets backoff", async () => {
    for (let i = 0; i < 50; i++) appendEvent(makeEvent(i), queuePath);

    const fetchFn = vi.fn<typeof fetch>(async () => new Response("bad request", { status: 400 }));
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_key",
      queuePath,
      watermarkPath,
      registry,
      batchSize: 100,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    await loop.iteration();
    expect(readWatermark(watermarkPath)).toEqual({
      last_synced_event_idempotency_key: "key-0049",
    });
    // 4xx should not have triggered a sleep
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("increments per-adapter daemon_unreachable_count on network failure", async () => {
    for (let i = 0; i < 5; i++) appendEvent(makeEvent(i), queuePath);

    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_key",
      queuePath,
      watermarkPath,
      registry,
      batchSize: 100,
      backoffBaseMs: 10,
      backoffMaxMs: 100,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    await loop.iteration();
    const counters = registry.getCountersSnapshot();
    expect(counters["claude-code"]?.daemon_unreachable_count).toBe(1);
    // Watermark still null
    expect(readWatermark(watermarkPath)).toBeNull();
  });

  it("does nothing when the queue is empty", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_key",
      queuePath,
      watermarkPath,
      registry,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    await loop.iteration();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("defers the batch when no api_key is available (pre-enrollment)", async () => {
    for (let i = 0; i < 5; i++) appendEvent(makeEvent(i), queuePath);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const sleepFn = vi.fn(async (_ms: number) => {});
    const loop = new SyncLoop({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => null,
      queuePath,
      watermarkPath,
      registry,
      fetchFn,
      sleepFn,
      envOverride: {},
    });

    await loop.iteration();
    expect(fetchFn).not.toHaveBeenCalled();
    // Watermark still null — events stay in queue
    expect(readWatermark(watermarkPath)).toBeNull();
  });
});
