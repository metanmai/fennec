/**
 * AdapterHeartbeat emitter (CAP-14, CAP-15, CAP-16, threat T-06-06).
 *
 * Fires on a timer regardless of whether the corresponding adapter
 * has emitted any events in the interval. Zero is a meaningful value
 * (CAP-14 / PITFALL P3 — the missing-heartbeat case must be
 * distinguishable from "adapter alive but quiet"). The backend (Phase
 * 4 dashboard) interprets a heartbeat gap as "adapter offline"; here
 * we just guarantee the wire data is present.
 *
 * Each heartbeat:
 *   1. Snapshot per-adapter counters (events_parsed / parse_errors /
 *      daemon_unreachable_count / last_payload_sample) from the
 *      registry.
 *   2. Compute schema_hash from last_payload_sample (CAP-15 drift
 *      detector — field-name set hash, see schema-hash.ts).
 *   3. Build an AdapterHeartbeat object that satisfies
 *      AdapterHeartbeatSchema (Zod-validated BEFORE POST).
 *   4. POST to `${apiBaseUrl}/api/heartbeats` with the Bearer token.
 *   5. Reset the counter (events_parsed, parse_errors,
 *      daemon_unreachable_count → 0). last_payload_sample is
 *      intentionally NOT reset so drift detection has continuity.
 *
 * Bearer logging filter (threat T-06-06): the Authorization header is
 * never logged. The logError callback receives sanitised error info
 * only.
 */

import { type AdapterHeartbeat, AdapterHeartbeatSchema } from "@fennec/shared";
import type { AdapterRegistry } from "../adapters/registry.js";
import { buildFetchOptions } from "../sync/proxy.js";
import { computeSchemaHash } from "./schema-hash.js";

export interface HeartbeatSchedulerOptions {
  apiBaseUrl: string;
  apiKeyProvider: () => Promise<string | null>;
  registry: AdapterRegistry;
  intervalMs?: number;
  hostname: string;
  /** Injectable for tests — defaults to `globalThis.fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests — defaults to console.warn (Bearer-safe). */
  logError?: (message: string, err: unknown) => void;
  /** Injectable proxy/CA detection — used by tests. */
  envOverride?: NodeJS.ProcessEnv;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

export class HeartbeatScheduler {
  private readonly opts: Required<
    Omit<HeartbeatSchedulerOptions, "intervalMs" | "fetchFn" | "logError" | "envOverride">
  > & {
    intervalMs: number;
    fetchFn: typeof fetch;
    logError: (message: string, err: unknown) => void;
    envOverride: NodeJS.ProcessEnv;
  };
  private timer: NodeJS.Timeout | null = null;
  /** Start of the current interval. Reset on every successful POST. */
  private intervalStart: Date = new Date();

  constructor(opts: HeartbeatSchedulerOptions) {
    this.opts = {
      apiBaseUrl: opts.apiBaseUrl,
      apiKeyProvider: opts.apiKeyProvider,
      registry: opts.registry,
      hostname: opts.hostname,
      intervalMs: opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      fetchFn: opts.fetchFn ?? globalThis.fetch,
      logError: opts.logError ?? ((msg, err) => console.warn(msg, sanitiseError(err))),
      envOverride: opts.envOverride ?? process.env,
    };
  }

  /** Start the periodic heartbeat timer. */
  start(): void {
    if (this.timer) return;
    this.intervalStart = new Date();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs);
    // Unref so the timer doesn't block process exit in tests
    this.timer.unref?.();
  }

  /** Stop the periodic timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Fire a heartbeat immediately. Exposed for tests + the shutdown
   * path so we can ensure the LAST interval's counters reach the
   * backend before the daemon exits.
   */
  async tick(): Promise<void> {
    const intervalEnd = new Date();
    const counters = this.opts.registry.getCountersSnapshot();
    const apiKey = await this.opts.apiKeyProvider();

    for (const [tool, counter] of Object.entries(counters)) {
      const adapter = this.opts.registry.getAdapter(tool as "claude-code" | "codex" | "gemini" | "cursor" | "copilot");
      // Even if the adapter was unregistered, fire a final heartbeat
      // with adapter_version="unknown" — events_parsed accumulates up
      // to the unregister.
      const adapterVersion = adapter?.version ?? "unknown";
      const schemaHash = await computeSchemaHash(counter.last_payload_sample ?? {});
      const intervalStartIso = this.intervalStart.toISOString();
      const intervalEndIso = intervalEnd.toISOString();

      const heartbeat: AdapterHeartbeat = {
        idempotency_key: `${this.opts.hostname}|${tool}|${intervalStartIso}`,
        hostname: this.opts.hostname,
        adapter: tool,
        adapter_version: adapterVersion,
        schema_hash: schemaHash,
        events_parsed: counter.events_parsed,
        parse_errors: counter.parse_errors,
        daemon_unreachable_count: counter.daemon_unreachable_count,
        interval_start: intervalStartIso,
        interval_end: intervalEndIso,
        schema_version: 1,
      };

      // Zod-validate BEFORE posting — catches local bugs early.
      const parseResult = AdapterHeartbeatSchema.safeParse(heartbeat);
      if (!parseResult.success) {
        this.opts.logError(`[heartbeat:${tool}] schema validation failed; skipping post`, parseResult.error);
        continue;
      }

      if (!apiKey) {
        // Pre-enrollment: the daemon is alive but has no Bearer token
        // yet (Plan 01-08 handles enrollment). We DO NOT post; we DO
        // reset counters so the next interval has fresh values.
        this.opts.registry.resetCounter(tool);
        continue;
      }

      try {
        const fetchOpts = await buildFetchOptions(this.opts.envOverride);
        const response = await this.opts.fetchFn(`${this.opts.apiBaseUrl}/api/heartbeats`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(heartbeat),
          // Carry the proxy dispatcher when present
          ...(fetchOpts as RequestInit),
        });
        if (response.status >= 200 && response.status < 300) {
          this.opts.registry.resetCounter(tool);
        } else {
          // Non-2xx — log + leave counters so next interval reports cumulative
          this.opts.logError(
            `[heartbeat:${tool}] backend returned ${response.status}`,
            new Error(`status=${response.status}`),
          );
        }
      } catch (err) {
        this.opts.logError(`[heartbeat:${tool}] network error`, sanitiseError(err));
      }
    }

    // Advance the interval boundary regardless of per-adapter success.
    this.intervalStart = intervalEnd;
  }
}

/**
 * Strip Bearer tokens from any string that ends up in an Error message
 * before logging (threat T-06-06).
 */
function sanitiseError(err: unknown): unknown {
  if (err instanceof Error && err.message) {
    return new Error(err.message.replace(/Bearer [A-Za-z0-9_.-]{20,}/g, "Bearer [REDACTED]"));
  }
  return err;
}
