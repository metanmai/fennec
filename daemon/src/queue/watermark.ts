/**
 * Sync-loop watermark — Pattern 5 in 01-RESEARCH.md.
 *
 * The watermark file at `${dataDir}/sync-state.json` contains
 *   { "last_synced_event_idempotency_key": "<32-char hex>" }
 *
 * The sync loop advances the watermark ONLY on a 2xx batch ack (CAP-12 /
 * threat T-06-05). Atomic-replace via temp file + rename so a crash
 * mid-write leaves either the prior version or the new version on disk,
 * never a torn file.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Watermark {
  last_synced_event_idempotency_key: string;
}

export function readWatermark(watermarkPath: string): Watermark | null {
  if (!existsSync(watermarkPath)) return null;
  try {
    const raw = readFileSync(watermarkPath, "utf-8");
    const parsed = JSON.parse(raw) as { last_synced_event_idempotency_key?: unknown };
    if (typeof parsed.last_synced_event_idempotency_key !== "string") return null;
    return { last_synced_event_idempotency_key: parsed.last_synced_event_idempotency_key };
  } catch {
    // Treat corrupted watermark as "never synced" — the backend's
    // ON CONFLICT (idempotency_key) DO NOTHING dedupes any replays.
    return null;
  }
}

/**
 * Atomically advance the watermark to the given idempotency_key. Writes
 * to a `.tmp` file first, then renames over the final path so a crash
 * during write leaves the prior watermark intact.
 */
export function advanceWatermark(watermarkPath: string, key: string): void {
  const tmp = `${watermarkPath}.tmp`;
  const body: Watermark = { last_synced_event_idempotency_key: key };
  writeFileSync(tmp, JSON.stringify(body));
  renameSync(tmp, watermarkPath);
}
