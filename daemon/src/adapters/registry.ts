/**
 * AdapterRegistry — the in-process pipeline that wires every adapter's
 * `emit(event)` call to:
 *   1. `buildCanonicalEvent(input)` — stamps hostname/os/idempotency_key
 *   2. `redact(event)` — synchronous gitleaks-style redaction
 *   3. `queue.append(event)` — atomic O_APPEND to JSONL
 *   4. counter.events_parsed++ + last_payload_sample captured
 *
 * On ANY throw inside the chain, the event is DROPPED (parse_errors++)
 * — per PITFALL P1, "better lost event than leaked secret". The throw
 * does NOT propagate back to the adapter, so a malformed payload from
 * one event never crashes the adapter's capture loop.
 *
 * The redactor is injectable so:
 *   - Task 2's tests can pass a pass-through stub (this file)
 *   - Task 3 ships the real gitleaks redactor and wires it
 *
 * Threat model (from PLAN.md `<threat_model>`):
 *   - T-06-01: secrets in prompts — redactor runs SYNCHRONOUSLY before
 *     queue.append; on redactor throw, event dropped + parse_errors++
 *   - T-06-06: api_key in daemon log — error messages from this file
 *     intentionally omit the payload content
 */

import type { CanonicalEvent, Tool } from "@fennec/shared";
import { buildCanonicalEvent } from "../normalize/canonical.js";
import { appendEvent } from "../queue/jsonl.js";
import type { Adapter, Emit, EmitInput } from "./adapter.js";

/**
 * Per-adapter capture counters. Reset every heartbeat interval.
 *  - events_parsed: successful emits (passed redaction + queue.append)
 *  - parse_errors: failed emits (redactor threw or other pipeline error)
 *  - daemon_unreachable_count: incremented by the sync loop when it
 *    cannot reach the backend; surfaces in the next heartbeat
 *  - last_payload_sample: the most recently emitted payload, sampled
 *    so the heartbeat scheduler can compute schema_hash (CAP-15)
 */
export interface AdapterCounter {
  events_parsed: number;
  parse_errors: number;
  daemon_unreachable_count: number;
  last_payload_sample: Record<string, unknown> | null;
}

export type CountersSnapshot = Record<string, AdapterCounter>;

/**
 * Redactor function signature — synchronous (per PITFALL P1: the queue
 * write blocks on redaction, no async race). Task 3's gitleaks redactor
 * implements this.
 */
export type RedactFn = (event: CanonicalEvent) => CanonicalEvent;

/**
 * Default pass-through redactor used by Task 2 — stamps the redaction
 * metadata so the CanonicalEventSchema validates, but performs NO
 * pattern matching. Task 3 replaces this with the gitleaks rule set.
 */
function passthroughRedact(event: CanonicalEvent): CanonicalEvent {
  return {
    ...event,
    redaction_applied_at: new Date().toISOString(),
    redaction_version_hash: "passthrough-task-2",
  };
}

export interface AdapterRegistryOptions {
  queuePath: string;
  seqDir: string;
  /** Optional injected redactor. Defaults to the pass-through stub. */
  redact?: RedactFn;
  /** Optional callback for logging registry errors (defaults to console.error). */
  logError?: (message: string, err: unknown) => void;
}

export class AdapterRegistry {
  private readonly adapters: Adapter[] = [];
  private readonly counters: Map<string, AdapterCounter> = new Map();
  private readonly queuePath: string;
  private readonly seqDir: string;
  private readonly redact: RedactFn;
  private readonly logError: (message: string, err: unknown) => void;

  constructor(opts: AdapterRegistryOptions) {
    this.queuePath = opts.queuePath;
    this.seqDir = opts.seqDir;
    this.redact = opts.redact ?? passthroughRedact;
    this.logError = opts.logError ?? ((msg, err) => console.error(msg, err));
  }

  /** Register an adapter. Idempotent on tool name. */
  register(adapter: Adapter): void {
    if (this.adapters.some((a) => a.tool === adapter.tool)) {
      // Re-registering the same tool is a programmer error — surface it
      throw new Error(`Adapter for tool "${adapter.tool}" already registered`);
    }
    this.adapters.push(adapter);
    this.counters.set(adapter.tool, {
      events_parsed: 0,
      parse_errors: 0,
      daemon_unreachable_count: 0,
      last_payload_sample: null,
    });
  }

  /**
   * Start all registered adapters with a per-adapter emit callback. The
   * callback runs the canonical+redact+queue chain on every event; any
   * throw is caught, counted as parse_errors, and the event is dropped.
   */
  async startAll(): Promise<void> {
    for (const adapter of this.adapters) {
      const emit: Emit = (input: EmitInput) => this.makeEmit(adapter)(input);
      await adapter.start(emit);
    }
  }

  /** Stop all registered adapters. */
  async stopAll(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.stop();
    }
  }

  /** Snapshot the counters (used by the heartbeat scheduler). */
  getCountersSnapshot(): CountersSnapshot {
    const out: CountersSnapshot = {};
    for (const [tool, c] of this.counters.entries()) {
      out[tool] = { ...c };
    }
    return out;
  }

  /** Look up a registered adapter by tool name. */
  getAdapter(tool: Tool): Adapter | undefined {
    return this.adapters.find((a) => a.tool === tool);
  }

  /**
   * Increment the per-adapter `daemon_unreachable_count`. Called by the
   * sync loop after a failed POST so the next heartbeat surfaces the
   * outage count to the backend (CAP-16 wire-format hook).
   */
  incrementUnreachable(tool: string): void {
    const counter = this.counters.get(tool);
    if (counter) counter.daemon_unreachable_count++;
  }

  /**
   * Reset a counter after the heartbeat has been delivered. Atomic from
   * the heartbeat-scheduler's perspective.
   */
  resetCounter(tool: string): void {
    const counter = this.counters.get(tool);
    if (!counter) return;
    counter.events_parsed = 0;
    counter.parse_errors = 0;
    counter.daemon_unreachable_count = 0;
    // last_payload_sample is intentionally NOT reset — schema_hash needs
    // a stable sample across intervals to detect drift between them.
  }

  private makeEmit(adapter: Adapter): Emit {
    return async (input: EmitInput) => {
      const counter = this.counters.get(adapter.tool);
      if (!counter) {
        // Defensive: adapter was registered but counter map mutated externally
        this.logError(`[adapter:${adapter.tool}] no counter; event dropped`, new Error("missing counter"));
        return;
      }

      try {
        // Step 1: stamp the canonical envelope
        const canonical = await buildCanonicalEvent({
          tool: adapter.tool,
          adapter_version: adapter.version,
          kind: input.kind,
          payload: input.payload,
          session_id: input.session_id,
          hook_event: input.hook_event,
          ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
          ...(input.monotonic_seq !== undefined ? { monotonic_seq: input.monotonic_seq } : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.git_remote ? { git_remote: input.git_remote } : {}),
          ...(input.git_branch ? { git_branch: input.git_branch } : {}),
          seqDir: this.seqDir,
        });

        // Step 2: redact synchronously. Any throw here is caught below
        // and the event is dropped (PITFALL P1).
        const redacted = this.redact(canonical);

        // Step 3: append to the JSONL queue
        appendEvent(redacted, this.queuePath);

        // Step 4: counter bookkeeping
        counter.events_parsed++;
        counter.last_payload_sample = input.payload;
      } catch (err) {
        // Per PITFALL P1: redactor (or any other pipeline step) failure
        // means we DROP the event rather than risk leaking a secret.
        // We intentionally do NOT log the payload contents — only the
        // error message + adapter tool.
        counter.parse_errors++;
        this.logError(`[adapter:${adapter.tool}] emit pipeline failed; event dropped`, err);
      }
    };
  }
}
