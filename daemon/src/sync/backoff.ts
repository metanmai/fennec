/**
 * Exponential backoff for the sync loop (Pattern 5 / CAP-12 / threat
 * T-06-05).
 *
 * On 5xx response or network error, the sync loop sleeps for
 *   min(base * 2^attempt, max)
 * milliseconds before retrying. The watermark does NOT advance during
 * this backoff (idempotency_key dedupe at the backend handles any
 * accidental double-sends).
 *
 * Defaults: base = 5s, max = 60s — gives 5s, 10s, 20s, 40s, 60s, 60s,
 * ... which recovers gracefully from a one-off backend blip without
 * hammering the API during a sustained outage.
 *
 * The caller owns the `attempt` state; this module is pure.
 */

export interface BackoffParams {
  attempt: number;
  base?: number;
  max?: number;
}

export const DEFAULT_BACKOFF_BASE_MS = 5_000;
export const DEFAULT_BACKOFF_MAX_MS = 60_000;

export function exponentialBackoff(params: BackoffParams): number {
  const base = params.base ?? DEFAULT_BACKOFF_BASE_MS;
  const max = params.max ?? DEFAULT_BACKOFF_MAX_MS;
  const attempt = Math.max(0, Math.floor(params.attempt));
  // Math.pow(2, attempt) — capped at max to avoid integer overflow
  // for absurd attempt counts.
  const computed = base * 2 ** attempt;
  return Math.min(computed, max);
}

export function resetBackoff(): { attempt: 0 } {
  return { attempt: 0 };
}
