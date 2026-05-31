/**
 * Sync loop (Pattern 5 of 01-RESEARCH.md, CAP-12, CAP-16).
 *
 * Timer-driven batched delivery from the JSONL queue to the backend's
 * `POST /api/events/batch` endpoint:
 *
 *   - Every `flushInterval` ms (default 5s) OR when the env var
 *     `FENNEC_FLUSH_NOW` is "1" (set by the daemon's IPC layer to
 *     force-flush after a burst), read up to `batchSize` events
 *     from the watermark forward.
 *   - POST with `Authorization: Bearer <api_key>`.
 *   - On 2xx: `advanceWatermark(lastKey)`, `resetBackoff()`.
 *   - On 5xx: `exponentialBackoff(++attempt)`, DO NOT advance.
 *   - On 4xx: log + `advanceWatermark(lastKey)` (the events are
 *     unsalvageable; the next batch should advance past them).
 *   - On network error: `registry.incrementUnreachable(tool)` for
 *     every registered adapter; backoff; do not advance.
 *
 * Bearer-token log sanitisation (threat T-06-06): the logError
 * callback strips `Bearer [A-Za-z0-9_.\-]{20,}` from any message
 * before forwarding.
 */

import type { CanonicalEvent } from "@fennec/shared";
import type { AdapterRegistry } from "../adapters/registry.js";
import { rotateIfNeeded } from "../queue/rotation.js";
import { advanceWatermark } from "../queue/watermark.js";
import { exponentialBackoff } from "./backoff.js";
import { readNextBatch } from "./batch.js";
import { buildFetchOptions } from "./proxy.js";

export interface SyncLoopOptions {
  apiBaseUrl: string;
  apiKeyProvider: () => Promise<string | null>;
  queuePath: string;
  watermarkPath: string;
  registry: AdapterRegistry;
  batchSize?: number;
  flushIntervalMs?: number;
  /** Backoff base (ms). Defaults to 5000. */
  backoffBaseMs?: number;
  /** Backoff cap (ms). Defaults to 60000. */
  backoffMaxMs?: number;
  /** Injectable fetch — defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Injectable sleep — defaults to setTimeout. Used by tests for spying. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injectable env override — defaults to process.env. */
  envOverride?: NodeJS.ProcessEnv;
  /** Bearer-safe error logger. */
  logError?: (message: string, err: unknown) => void;
}

export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export class SyncLoop {
  private readonly apiBaseUrl: string;
  private readonly apiKeyProvider: () => Promise<string | null>;
  private readonly queuePath: string;
  private readonly watermarkPath: string;
  private readonly registry: AdapterRegistry;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly envOverride: NodeJS.ProcessEnv;
  private readonly logError: (message: string, err: unknown) => void;

  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private iterating = false;

  constructor(opts: SyncLoopOptions) {
    this.apiBaseUrl = opts.apiBaseUrl;
    this.apiKeyProvider = opts.apiKeyProvider;
    this.queuePath = opts.queuePath;
    this.watermarkPath = opts.watermarkPath;
    this.registry = opts.registry;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.backoffBaseMs = opts.backoffBaseMs ?? 5_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 60_000;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.sleepFn = opts.sleepFn ?? defaultSleep;
    this.envOverride = opts.envOverride ?? process.env;
    this.logError = opts.logError ?? ((msg, err) => console.warn(msg, sanitiseError(err)));
  }

  /** Start the periodic flush timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.iteration();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one sync iteration. Public for tests + the daemon's
   * shutdown-flush path. Re-entrant: if a tick is already in flight,
   * a second concurrent call is a no-op (the next timer fire will
   * pick up new events).
   */
  async iteration(): Promise<void> {
    if (this.iterating) return;
    this.iterating = true;
    try {
      // Rotate if needed (CAP-11 — keeps the live queue under threshold)
      rotateIfNeeded(this.queuePath);

      const flushNow = this.envOverride.FENNEC_FLUSH_NOW === "1";
      const { events, lastKey } = await readNextBatch(this.queuePath, this.watermarkPath, this.batchSize);

      if (events.length === 0) {
        // Nothing to sync — even an explicit FENNEC_FLUSH_NOW is a no-op
        // when the queue is empty. Don't reset backoff here; if we're in
        // a backoff cycle waiting for the backend, an empty batch
        // doesn't signal recovery.
        if (flushNow) {
          // Clear the flag-style env once observed so a subsequent call
          // doesn't redundantly burn iterations.
          delete this.envOverride.FENNEC_FLUSH_NOW;
        }
        return;
      }

      const apiKey = await this.apiKeyProvider();
      if (!apiKey) {
        // Pre-enrollment: events stay in the queue. Backoff isn't
        // appropriate (we're not at fault); just log + return.
        this.logError("[sync] no api_key available; deferring batch", new Error("api_key not yet provisioned"));
        return;
      }

      await this.postBatch(events, lastKey, apiKey);
    } finally {
      this.iterating = false;
    }
  }

  /**
   * Force-flush — equivalent to `iteration()` but bypasses the
   * re-entrant guard. Used during graceful shutdown.
   */
  async flushNow(): Promise<void> {
    this.iterating = false;
    return this.iteration();
  }

  private async postBatch(events: CanonicalEvent[], lastKey: string | null, apiKey: string): Promise<void> {
    try {
      const fetchOpts = await buildFetchOptions(this.envOverride);
      const response = await this.fetchFn(`${this.apiBaseUrl}/api/events/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ events }),
        ...(fetchOpts as RequestInit),
      });

      if (response.status >= 200 && response.status < 300) {
        // 2xx: advance the watermark, reset backoff
        if (lastKey !== null) {
          advanceWatermark(this.watermarkPath, lastKey);
        }
        this.attempt = 0;
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        // 4xx: events are unsalvageable; advance the watermark so we
        // don't replay them. Log + reset backoff.
        this.logError(
          `[sync] backend rejected batch with ${response.status}; advancing watermark to discard`,
          new Error(`status=${response.status}`),
        );
        if (lastKey !== null) {
          advanceWatermark(this.watermarkPath, lastKey);
        }
        this.attempt = 0;
        return;
      }

      if (response.status >= 500 && response.status < 600) {
        // 5xx: backend is sick; back off, do NOT advance the watermark
        this.attempt++;
        const wait = exponentialBackoff({
          attempt: this.attempt,
          base: this.backoffBaseMs,
          max: this.backoffMaxMs,
        });
        this.logError(
          `[sync] backend returned ${response.status}; backing off ${wait}ms (attempt ${this.attempt})`,
          new Error(`status=${response.status}`),
        );
        await this.sleepFn(wait);
        return;
      }

      // Unexpected status (1xx / 3xx / unknown): log + back off conservatively
      this.attempt++;
      const wait = exponentialBackoff({
        attempt: this.attempt,
        base: this.backoffBaseMs,
        max: this.backoffMaxMs,
      });
      this.logError(
        `[sync] unexpected status ${response.status}; backing off ${wait}ms`,
        new Error(`status=${response.status}`),
      );
      await this.sleepFn(wait);
    } catch (err) {
      // Network error — increment per-adapter unreachable counters so
      // the next heartbeat surfaces the outage. Back off + retry.
      for (const tool of Object.keys(this.registry.getCountersSnapshot())) {
        this.registry.incrementUnreachable(tool);
      }
      this.attempt++;
      const wait = exponentialBackoff({
        attempt: this.attempt,
        base: this.backoffBaseMs,
        max: this.backoffMaxMs,
      });
      this.logError(`[sync] network error; backing off ${wait}ms`, sanitiseError(err));
      await this.sleepFn(wait);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function sanitiseError(err: unknown): unknown {
  if (err instanceof Error && err.message) {
    return new Error(err.message.replace(/Bearer [A-Za-z0-9_.-]{20,}/g, "Bearer [REDACTED]"));
  }
  return err;
}
