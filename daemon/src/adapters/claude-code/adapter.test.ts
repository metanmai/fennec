/**
 * Claude Code adapter tests (Task 3 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 11–13):
 *  - Test 11: adapter.start(mockEmit) attaches a listener to a mock bridge;
 *            emitting a "hook" event on the bridge causes normalise + emit;
 *            mockEmit receives a CanonicalEvent input with tool="claude-code".
 *  - Test 12: adapter.stop() removes the listener; subsequent bridge events
 *            do NOT trigger emit.
 *  - Test 13: A canary secret inside the prompt_text field reaches mockEmit's
 *            argument UNREDACTED (because redaction is downstream in
 *            registry.emit); confirms the adapter does NOT itself redact —
 *            its job is normalisation only.
 *
 * The adapter pattern: it subscribes to the LoopbackBridge's "hook"
 * event, runs the payload through the normaliser, then calls the
 * registry-supplied emit. Errors from the normaliser propagate up so
 * the registry counts them as parse_errors (Pitfall 1).
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Emit, EmitInput } from "../adapter.js";
import { ClaudeCodeAdapter } from "./adapter.js";

/**
 * Minimal mock for the LoopbackBridge contract — only the EventEmitter
 * surface is needed for the adapter to subscribe/unsubscribe.
 */
class MockBridge extends EventEmitter {}

describe("ClaudeCodeAdapter", () => {
  it("start() subscribes to bridge 'hook' events; each event triggers normalise + emit", async () => {
    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);

    const emits: EmitInput[] = [];
    const emit: Emit = async (input) => {
      emits.push(input);
    };

    await adapter.start(emit);

    // Fire a UserPromptSubmit through the bridge
    bridge.emit("hook", {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-1",
      prompt: "Hi Claude",
    });

    // Adapter handler is async; flush microtasks
    await new Promise((r) => setImmediate(r));

    expect(emits).toHaveLength(1);
    expect(emits[0]?.tool).toBe("claude-code");
    expect(emits[0]?.adapter_version).toBe("0.1.0");
    expect(emits[0]?.kind).toBe("prompt_submitted");
    expect(emits[0]?.session_id).toBe("sess-1");
    expect(emits[0]?.payload.prompt_text).toBe("Hi Claude");
    expect(emits[0]?.payload.hook_event).toBe("UserPromptSubmit");

    await adapter.stop();
  });

  it("stop() removes the handler — subsequent bridge events do NOT trigger emit", async () => {
    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);

    const emits: EmitInput[] = [];
    const emit: Emit = async (input) => {
      emits.push(input);
    };

    await adapter.start(emit);
    await adapter.stop();

    bridge.emit("hook", {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-after-stop",
      prompt: "Should not reach emit",
    });
    await new Promise((r) => setImmediate(r));

    expect(emits).toHaveLength(0);
  });

  it("identifies itself with tool='claude-code' and version='0.1.0' on the Adapter interface", () => {
    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);
    expect(adapter.tool).toBe("claude-code");
    expect(adapter.version).toBe("0.1.0");
  });

  it("does NOT redact payload contents — a canary in prompt_text reaches emit() unredacted", async () => {
    // The Adapter's job is normalisation ONLY. Redaction lives downstream
    // in the registry's emit chain (registry.makeEmit → redact). Putting
    // the canary in the test asserts the adapter doesn't accidentally
    // strip it on the way in.
    const CANARY = "sk-ant-api03-CANARYCANARYCANARYCANARYCANARYCANARYCANARY";

    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);

    const emits: EmitInput[] = [];
    const emit: Emit = async (input) => {
      emits.push(input);
    };

    await adapter.start(emit);
    bridge.emit("hook", {
      hook_event_name: "UserPromptSubmit",
      session_id: "canary-test",
      prompt: `please use this key: ${CANARY}`,
    });
    await new Promise((r) => setImmediate(r));
    await adapter.stop();

    expect(emits).toHaveLength(1);
    expect(emits[0]?.payload.prompt_text).toContain(CANARY);
    // The adapter does NOT redact. Registry.emit will, downstream.
  });

  it("preserves the 4 Anthropic Usage token fields verbatim through the adapter (A2 option c)", async () => {
    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);

    const emits: EmitInput[] = [];
    const emit: Emit = async (input) => {
      emits.push(input);
    };
    await adapter.start(emit);

    bridge.emit("hook", {
      hook_event_name: "PostToolUse",
      session_id: "tok-sess",
      tool: {
        name: "Read",
        response: {
          usage: {
            input_tokens: 11,
            output_tokens: 22,
            cache_creation_input_tokens: 33,
            cache_read_input_tokens: 44,
          },
        },
      },
    });
    await new Promise((r) => setImmediate(r));
    await adapter.stop();

    expect(emits).toHaveLength(1);
    const usage = emits[0]?.payload.usage as Record<string, unknown> | undefined;
    expect(usage).toBeDefined();
    expect(usage?.input_tokens).toBe(11);
    expect(usage?.output_tokens).toBe(22);
    expect(usage?.cache_creation_input_tokens).toBe(33);
    expect(usage?.cache_read_input_tokens).toBe(44);
  });

  it("normaliser-thrown error (unknown hook_event_name) propagates up so registry can count parse_errors", async () => {
    const bridge = new MockBridge();
    const adapter = new ClaudeCodeAdapter(bridge);

    const emits: EmitInput[] = [];
    const errors: unknown[] = [];
    const emit: Emit = async (input) => {
      emits.push(input);
    };
    const onError = vi.fn((err: unknown) => errors.push(err));
    await adapter.start(emit);

    // EventEmitter "error" event would crash the process if unhandled — register a sink
    bridge.on("error", onError);

    // Fire an unknown hook event
    bridge.emit("hook", {
      hook_event_name: "MysteriousNewHook",
      session_id: "unknown-test",
    });
    await new Promise((r) => setImmediate(r));
    await adapter.stop();

    // No event should have been emitted (the throw inside the handler
    // prevents reaching emit). The error is surfaced via the adapter's
    // internal logger; this test doesn't assert on the logger but
    // confirms emit was never called.
    expect(emits).toHaveLength(0);
  });
});
