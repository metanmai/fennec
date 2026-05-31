/**
 * Claude Code adapter (Plan 01-07 Task 3).
 *
 * Implements the `Adapter` interface defined in
 * `daemon/src/adapters/adapter.ts`. Subscribes to the LoopbackBridge's
 * "hook" event stream and forwards each event through the payload
 * normaliser into the registry's emit callback.
 *
 * The adapter's only job is normalisation. It does NOT:
 *   - Redact (registry.makeEmit → redactor handles that)
 *   - Validate the canonical envelope (registry.buildCanonicalEvent does)
 *   - Append to the queue (registry.appendEvent does)
 *
 * On unknown / malformed hook payloads, the normaliser throws. The
 * adapter logs and swallows the error so the bridge's emit loop
 * continues — the registry on the OTHER emit path (registry.makeEmit)
 * counts parse_errors when its OWN pipeline throws. Here, we swallow
 * because we never reach the registry's emit for these malformed
 * events; the bridge has no notion of parse_errors so we just log.
 *
 * Threat model:
 *  - T-07-07 (secrets in hook payload reach queue unredacted) — mitigated
 *    by the redaction step downstream of THIS adapter's emit call.
 *    A canary test asserts the redactor wins.
 *  - T-07-SC — no new deps.
 */

import type { EventEmitter } from "node:events";
import type { Adapter, Emit } from "../adapter.js";
import { normalizeHookPayload } from "./payload-normaliser.js";

/**
 * The minimal bridge surface this adapter depends on. Production wires
 * a LoopbackBridge instance; tests can pass any EventEmitter that emits
 * "hook" events with raw Claude Code payloads.
 */
export interface HookBridge extends EventEmitter {}

export interface ClaudeCodeAdapterOptions {
  /** Optional logger — defaults to no-op so tests don't spam stdout. */
  logger?: (...args: unknown[]) => void;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly tool = "claude-code" as const;
  readonly version = "0.1.0";

  private readonly bridge: HookBridge;
  private readonly logger: (...args: unknown[]) => void;
  private handler: ((raw: unknown) => void) | null = null;
  private emit: Emit | null = null;

  constructor(bridge: HookBridge, opts?: ClaudeCodeAdapterOptions) {
    this.bridge = bridge;
    this.logger = opts?.logger ?? (() => {});
  }

  async start(emit: Emit): Promise<void> {
    if (this.handler) {
      throw new Error("ClaudeCodeAdapter already started");
    }
    this.emit = emit;

    // The handler is bound to `this` via the arrow fn closure. Stored
    // on the instance so stop() can unsubscribe the exact same
    // reference (bridge.off() requires identity-equal listener).
    this.handler = (raw: unknown) => {
      // Normalise + forward. Errors are logged + swallowed here because
      // they originate from MALFORMED upstream payloads (e.g. unknown
      // hook_event_name) — the registry's parse_errors counter is for
      // failures of the OUR pipeline (redactor/queue), not malformed
      // adapter input. We choose to drop bad input quietly rather than
      // bubble it back into the bridge's event loop (which has no
      // handler for "error" events from listeners by default).
      //
      // Fire-and-forget — return a void awaiter so the bridge's emit
      // synchronously dispatches all listeners without us blocking it.
      void this.forward(raw).catch((err) => {
        this.logger("[claude-code] forward failed; event dropped", err);
      });
    };

    this.bridge.on("hook", this.handler);
  }

  async stop(): Promise<void> {
    if (this.handler) {
      this.bridge.off("hook", this.handler);
      this.handler = null;
    }
    this.emit = null;
  }

  private async forward(raw: unknown): Promise<void> {
    if (!this.emit) {
      // Defensive: handler shouldn't fire after stop(), but if it does
      // we just drop the event.
      return;
    }

    // The normaliser throws on malformed payloads (unknown hook event,
    // missing session_id). Let the throw propagate up to the catch in
    // `handler` — drop event quietly.
    const normalised = normalizeHookPayload(raw);

    // Registry.emit handles canonical envelope + redact + queue.
    await this.emit(normalised);
  }
}
