/**
 * Adapter interface — Pattern 2 in 01-RESEARCH.md (Heterogeneous capture,
 * homogeneous emit). Every fennec capture mechanism (Claude Code hooks,
 * Codex transcripts, Gemini, etc.) implements this same shape, so adding
 * a new capture surface in Phase 2+ is purely additive.
 *
 * Adapters NEVER touch the queue, redactor, or sync loop directly — they
 * call the `Emit` callback the registry hands them. The registry then
 * runs the canonical-envelope build + redactor + queue.append pipeline
 * in one place, and ensures CAP-01 (single daemon process per machine)
 * + PRIV-01 (capture-time redaction) are uniformly applied.
 */

import type { CanonicalEvent, EventKind, Tool } from "@fennec/shared";

/**
 * EmitInput — what an adapter supplies to `emit(...)`. The registry adds
 * `idempotency_key`, `schema_version`, `redaction_applied_at`, and
 * `redaction_version_hash` (filled by the redactor downstream), and
 * stamps `hostname` + `os` from the daemon's process.
 *
 * Required adapter-supplied fields:
 *   - tool, adapter_version, kind: discriminate event class
 *   - payload: tool-specific shape validated by the per-tool Zod schema
 *   - session_id + hook_event: drive the idempotency_key derivation
 *
 * Optional adapter-supplied fields:
 *   - occurred_at: defaults to `new Date().toISOString()` if absent
 *   - monotonic_seq: defaults to bumpMonotonicSeq(tool); allows the
 *     adapter to pin a known seq value for tests / deterministic retry
 *   - cwd, git_remote, git_branch: workspace context if available
 */
export interface EmitInput {
  tool: Tool;
  adapter_version: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  session_id: string;
  hook_event: string;
  occurred_at?: string;
  monotonic_seq?: number;
  cwd?: string;
  git_remote?: string;
  git_branch?: string;
  // The adapter may set these but the registry overrides from os.hostname() /
  // process.platform — including the fields here keeps the type expressive.
  hostname?: string;
  os?: "darwin" | "linux" | "win32";
}

/**
 * Emit — the function the registry passes to each adapter's `start()`.
 * Adapters call this for every captured event. The registry handles
 * canonical-envelope stamping, redaction, and queue.append; on any
 * throw inside the chain, the registry counts parse_errors and DROPS
 * the event (PITFALL P1 — better lost than leaked).
 */
export type Emit = (event: EmitInput) => Promise<void>;

/**
 * Adapter — the interface every capture surface implements.
 */
export interface Adapter {
  /** Tool identifier — must match one of the values in `ToolSchema`. */
  readonly tool: Tool;
  /** Adapter version string — surfaces in events for backward-compat tracing. */
  readonly version: string;
  /** Start the adapter, passing it the registry's emit callback. */
  start(emit: Emit): Promise<void>;
  /** Stop the adapter — must drain inflight events before resolving. */
  stop(): Promise<void>;
}

// Re-export `CanonicalEvent` so callers can type-narrow on the registry's
// queue contents without a second import.
export type { CanonicalEvent };
