/**
 * Loopback bridge tests (Task 3 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 1–5):
 *  - Test 1: Server binds to 127.0.0.1 ONLY (never 0.0.0.0); listens on the supplied port.
 *  - Test 2: POST /v1/hook with the correct X-Fennec-Shim-Secret + valid JSON → 202;
 *           the bridge emits a "hook" event with the parsed payload.
 *  - Test 3: POST without the header → 401; no event emitted; logger sees a
 *           "rejected-loopback-attempt" message.
 *  - Test 4: POST with the wrong secret value → 401.
 *  - Test 5: GET /v1/health → 200 {"status":"ok"}.
 *
 * Each test uses a fresh ephemeral port (port=0 → kernel picks) so they're
 * independent + can run in parallel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoopbackBridge } from "./server.js";

const SECRET = "test-shim-secret-12345678901234567890";

/** Wait for the bridge to be listening; pulls the actual bound address+port. */
async function listenOnEphemeralPort(bridge: LoopbackBridge): Promise<{ host: string; port: number }> {
  await bridge.start(0); // 0 → kernel picks
  const addr = bridge.address();
  if (!addr) throw new Error("bridge has no address after start");
  return addr;
}

describe("LoopbackBridge", () => {
  let bridge: LoopbackBridge;
  let logger: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    logger = vi.fn<(...args: unknown[]) => void>();
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
  });

  it("binds to 127.0.0.1 ONLY — never 0.0.0.0", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host } = await listenOnEphemeralPort(bridge);
    // The bound address must be loopback. We assert against the
    // literal "127.0.0.1" string (or its IPv6 mapping) — never 0.0.0.0.
    expect(host).toBe("127.0.0.1");
  });

  it("accepts POST /v1/hook with the correct shim-secret header and emits a 'hook' event", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);

    const hookEvents: unknown[] = [];
    bridge.on("hook", (payload: unknown) => {
      hookEvents.push(payload);
    });

    const body = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-abc",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/Users/dev/proj",
      prompt: "Hi Claude",
    };

    const res = await fetch(`http://${host}:${port}/v1/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fennec-Shim-Secret": SECRET,
      },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(202);
    // Give the bridge a microtask tick to flush emit
    await new Promise((r) => setImmediate(r));
    expect(hookEvents).toHaveLength(1);
    expect(hookEvents[0]).toEqual(body);
  });

  it("rejects POST /v1/hook without the shim-secret header (401) and does NOT emit", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);

    const hookEvents: unknown[] = [];
    bridge.on("hook", (payload: unknown) => hookEvents.push(payload));

    const res = await fetch(`http://${host}:${port}/v1/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s" }),
    });

    expect(res.status).toBe(401);
    await new Promise((r) => setImmediate(r));
    expect(hookEvents).toHaveLength(0);

    // Logger fired with rejection record
    const logCalls = logger.mock.calls.map((args) => args.join(" "));
    expect(logCalls.some((msg) => msg.includes("rejected-loopback-attempt"))).toBe(true);
  });

  it("rejects POST /v1/hook with a WRONG shim-secret header value (401)", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);

    const hookEvents: unknown[] = [];
    bridge.on("hook", (payload: unknown) => hookEvents.push(payload));

    const res = await fetch(`http://${host}:${port}/v1/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fennec-Shim-Secret": "this-is-not-the-right-secret",
      },
      body: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s" }),
    });

    expect(res.status).toBe(401);
    await new Promise((r) => setImmediate(r));
    expect(hookEvents).toHaveLength(0);
  });

  it("rejects POST with malformed JSON body (400 or 401; never emits a hook)", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);

    const hookEvents: unknown[] = [];
    bridge.on("hook", (payload: unknown) => hookEvents.push(payload));

    const res = await fetch(`http://${host}:${port}/v1/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fennec-Shim-Secret": SECRET,
      },
      body: "{this is not json",
    });

    // 4xx of any flavour is acceptable here; the load-bearing assertion
    // is that no event was emitted on malformed JSON.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setImmediate(r));
    expect(hookEvents).toHaveLength(0);
  });

  it("GET /v1/health returns 200 {status:'ok'}", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);

    const res = await fetch(`http://${host}:${port}/v1/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status?: string };
    expect(json.status).toBe("ok");
  });

  it("returns 404 for unknown routes", async () => {
    bridge = new LoopbackBridge({ shimSecret: SECRET, logger });
    const { host, port } = await listenOnEphemeralPort(bridge);
    const res = await fetch(`http://${host}:${port}/v1/nope`);
    expect(res.status).toBe(404);
  });
});
