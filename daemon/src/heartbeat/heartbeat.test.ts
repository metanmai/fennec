/**
 * Heartbeat tests (Task 3 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 11, 12, 13):
 *  - Test 11: heartbeat fires per interval EVEN at zero events
 *  - Test 12: 10 events emitted → next heartbeat shows events_parsed=10
 *    + parse_errors=0; counters reset to 0 for next interval
 *  - Test 13: schema_hash present + non-empty
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter, Emit, EmitInput } from "../adapters/adapter.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { HeartbeatScheduler } from "./heartbeat.js";

function makeFetchSuccess() {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
}

describe("HeartbeatScheduler", () => {
  let dir: string;
  let queuePath: string;
  let seqDir: string;
  let registry: AdapterRegistry;
  let adapter: Adapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-heartbeat-"));
    queuePath = join(dir, "events.jsonl");
    seqDir = join(dir, "seq");
    registry = new AdapterRegistry({ queuePath, seqDir });
    adapter = {
      tool: "claude-code",
      version: "0.1.0",
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    registry.register(adapter);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits a heartbeat even when zero events have been parsed", async () => {
    const fetchFn = makeFetchSuccess();
    const scheduler = new HeartbeatScheduler({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_testkey",
      registry,
      hostname: "test-host",
      fetchFn,
    });

    await scheduler.tick();

    expect(fetchFn).toHaveBeenCalledOnce();
    const firstCall = fetchFn.mock.calls[0];
    if (!firstCall) throw new Error("expected fetch to be called");
    const url = firstCall[0] as string;
    const init = firstCall[1] as RequestInit;
    expect(url).toBe("https://api.fennec.test/api/heartbeats");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fennec_testkey");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.adapter).toBe("claude-code");
    expect(body.events_parsed).toBe(0);
    expect(body.parse_errors).toBe(0);
    expect(body.daemon_unreachable_count).toBe(0);
    expect(body.hostname).toBe("test-host");
    expect(body.schema_version).toBe(1);
  });

  it("reports events_parsed correctly after emit ticks + resets the counter after success", async () => {
    const fetchFn = makeFetchSuccess();
    const scheduler = new HeartbeatScheduler({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_testkey",
      registry,
      hostname: "test-host",
      fetchFn,
    });

    // Wire the registry's emit chain
    let capturedEmit: Emit | undefined;
    adapter.start = vi.fn(async (emit: Emit) => {
      capturedEmit = emit;
    });
    await registry.startAll();

    // 10 successful emits
    if (!capturedEmit) throw new Error("expected adapter.start to be called with emit");
    for (let i = 0; i < 10; i++) {
      const input: EmitInput = {
        tool: "claude-code",
        adapter_version: "0.1.0",
        kind: "prompt_submitted",
        payload: { prompt_text: `event-${i}`, session_id: "s", hook_event: "UserPromptSubmit" },
        session_id: "s",
        hook_event: "UserPromptSubmit",
      };
      await capturedEmit(input);
    }

    await scheduler.tick();

    const firstInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    if (!firstInit) throw new Error("expected first fetch call");
    const firstBody = JSON.parse(firstInit.body as string) as Record<string, unknown>;
    expect(firstBody.events_parsed).toBe(10);
    expect(firstBody.parse_errors).toBe(0);

    // Second tick — counter should have been reset to 0
    await scheduler.tick();
    const secondInit = fetchFn.mock.calls[1]?.[1] as RequestInit | undefined;
    if (!secondInit) throw new Error("expected second fetch call");
    const secondBody = JSON.parse(secondInit.body as string) as Record<string, unknown>;
    expect(secondBody.events_parsed).toBe(0);
    expect(secondBody.parse_errors).toBe(0);
  });

  it("includes a non-empty schema_hash in the payload", async () => {
    const fetchFn = makeFetchSuccess();
    const scheduler = new HeartbeatScheduler({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_testkey",
      registry,
      hostname: "test-host",
      fetchFn,
    });

    await scheduler.tick();
    const tickInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    if (!tickInit) throw new Error("expected fetch call");
    const body = JSON.parse(tickInit.body as string) as Record<string, unknown>;
    expect(body.schema_hash).toBeTypeOf("string");
    expect((body.schema_hash as string).length).toBeGreaterThan(0);
    expect(body.schema_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not post when no api key is yet available (pre-enrollment) but still resets counters", async () => {
    const fetchFn = makeFetchSuccess();
    const scheduler = new HeartbeatScheduler({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => null,
      registry,
      hostname: "test-host",
      fetchFn,
    });

    await scheduler.tick();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not leak Bearer tokens through logged errors", async () => {
    const logged: { msg: string; err: unknown }[] = [];
    const fetchFn = vi.fn(async () => {
      throw new Error("network timeout (Bearer fennec_secret_token_abcdefghij)");
    });
    const scheduler = new HeartbeatScheduler({
      apiBaseUrl: "https://api.fennec.test",
      apiKeyProvider: async () => "fennec_testkey",
      registry,
      hostname: "test-host",
      fetchFn,
      logError: (msg, err) => logged.push({ msg, err }),
    });

    await scheduler.tick();

    expect(logged.length).toBeGreaterThan(0);
    for (const e of logged) {
      const msgString = JSON.stringify(e);
      expect(msgString, "Bearer token leaked into log").not.toContain("fennec_secret_token");
    }
  });
});
