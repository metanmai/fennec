/**
 * Sync-loop batch reader (Pattern 5 of 01-RESEARCH.md).
 *
 * `readNextBatch` walks the JSONL queue from the current watermark
 * forward and returns up to `batchSize` events. The `lastKey` (the
 * idempotency_key of the LAST event in the batch) is what the sync
 * loop advances the watermark to after a successful 2xx ack.
 *
 * Returns an empty batch when there's nothing to sync.
 */

import type { CanonicalEvent } from "@fennec/shared";
import { replayFromWatermark } from "../queue/jsonl.js";
import { readWatermark } from "../queue/watermark.js";

export interface Batch {
  events: CanonicalEvent[];
  lastKey: string | null;
}

export async function readNextBatch(queuePath: string, watermarkPath: string, batchSize = 100): Promise<Batch> {
  const watermark = readWatermark(watermarkPath);
  const lastSyncedKey = watermark?.last_synced_event_idempotency_key ?? null;

  const events: CanonicalEvent[] = [];
  for await (const evt of replayFromWatermark(queuePath, lastSyncedKey)) {
    events.push(evt);
    if (events.length >= batchSize) break;
  }

  const lastKey = events.length > 0 ? (events[events.length - 1]?.idempotency_key ?? null) : null;
  return { events, lastKey };
}
