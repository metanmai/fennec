/**
 * Adapter registry tests (Task 2 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 1, 2):
 *  - Test 1: register + startAll calls adapter.start(emit); calling emit
 *    funnels through redactor + queue.append
 *  - Test 2: stopAll calls each registered adapter's stop()
 *
 * For now the redactor is stubbed (passes through unchanged + stamps metadata).
 * Real gitleaks redactor lands in Task 3 — the registry's wiring is the same.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter, Emit } from "./adapter.js";
import { AdapterRegistry } from "./registry.js";

describe("AdapterRegistry", () => {
  let dir: string;
  let queuePath: string;
  let seqDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-registry-"));
    queuePath = join(dir, "events.jsonl");
    seqDir = join(dir, "seq");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("startAll passes an emit fn to each adapter; emit funnels event into the JSONL queue with envelope stamped", async () => {
    let capturedEmit: Emit | undefined;
    const adapter: Adapter = {
      tool: "claude-code",
      version: "0.1.0",
      start: vi.fn(async (emit: Emit) => {
        capturedEmit = emit;
      }),
      stop: vi.fn(async () => {}),
    };

    const registry = new AdapterRegistry({ queuePath, seqDir });
    registry.register(adapter);
    await registry.startAll();

    expect(adapter.start).toHaveBeenCalledOnce();
    expect(capturedEmit).toBeDefined();

    await capturedEmit?.({
      tool: "claude-code",
      adapter_version: "0.1.0",
      kind: "prompt_submitted",
      occurred_at: "2026-05-31T12:00:00.000Z",
      hostname: "ignored-server-stamps-from-os",
      os: "darwin",
      payload: { prompt_text: "hi", session_id: "s1", hook_event: "UserPromptSubmit" },
      session_id: "s1",
      hook_event: "UserPromptSubmit",
    });

    const raw = readFileSync(queuePath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.tool).toBe("claude-code");
    expect(parsed.kind).toBe("prompt_submitted");
    expect(parsed.schema_version).toBe(1);
    expect(parsed.idempotency_key).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.hostname).toBeTruthy();

    // Counter ticked once
    const counters = registry.getCountersSnapshot();
    expect(counters["claude-code"]?.events_parsed).toBe(1);
    expect(counters["claude-code"]?.parse_errors).toBe(0);
  });

  it("stopAll calls each registered adapter's stop()", async () => {
    const adapterA: Adapter = {
      tool: "claude-code",
      version: "0.1.0",
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    const adapterB: Adapter = {
      tool: "codex",
      version: "0.1.0",
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };

    const registry = new AdapterRegistry({ queuePath, seqDir });
    registry.register(adapterA);
    registry.register(adapterB);
    await registry.startAll();
    await registry.stopAll();

    expect(adapterA.stop).toHaveBeenCalledOnce();
    expect(adapterB.stop).toHaveBeenCalledOnce();
  });

  it("increments parse_errors when the emit chain throws (e.g. redactor failure)", async () => {
    let capturedEmit: Emit | undefined;
    const adapter: Adapter = {
      tool: "claude-code",
      version: "0.1.0",
      start: vi.fn(async (emit: Emit) => {
        capturedEmit = emit;
      }),
      stop: vi.fn(async () => {}),
    };

    // Inject a redactor that always throws via the registry's injectable hook
    const registry = new AdapterRegistry({
      queuePath,
      seqDir,
      redact: () => {
        throw new Error("synthetic redactor failure");
      },
    });
    registry.register(adapter);
    await registry.startAll();

    // The emit chain must not throw to the adapter — but the event must NOT
    // be queued and parse_errors must tick
    await capturedEmit?.({
      tool: "claude-code",
      adapter_version: "0.1.0",
      kind: "prompt_submitted",
      occurred_at: "2026-05-31T12:00:00.000Z",
      hostname: "ignored",
      os: "darwin",
      payload: { prompt_text: "x", session_id: "s1", hook_event: "UserPromptSubmit" },
      session_id: "s1",
      hook_event: "UserPromptSubmit",
    });

    // Counter records the failure
    const counters = registry.getCountersSnapshot();
    expect(counters["claude-code"]?.events_parsed).toBe(0);
    expect(counters["claude-code"]?.parse_errors).toBe(1);

    // Queue file was never written (or is empty)
    let queueRaw = "";
    try {
      queueRaw = readFileSync(queuePath, "utf-8");
    } catch {
      // ENOENT — even better, never created
    }
    expect(queueRaw).toBe("");
  });
});
