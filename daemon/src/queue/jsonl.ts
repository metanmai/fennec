/**
 * Append-only JSONL queue (Pattern 4 in 01-RESEARCH.md).
 *
 * Uses synchronous `fs.openSync(path, "a")` with O_APPEND semantics. On
 * POSIX (macOS + Linux), O_APPEND is atomic for writes ≤ PIPE_BUF (4KB
 * on Linux, 512B on macOS); our event lines are typically well under
 * that, but the kernel guarantees we never get torn writes from a
 * single concurrent writer. (CAP-11.)
 *
 * The async `fs.appendFile()` is intentionally NOT used — it does not
 * have an atomic-per-line guarantee on all filesystems.
 *
 * `replayFromWatermark` reads the file line-by-line and yields events
 * AFTER the line whose idempotency_key matches the watermark (or every
 * line if watermark is null). It tolerates a partial last line by
 * try/catching JSON.parse — the corrupted line is silently skipped, so
 * a daemon crash mid-write loses at most that one event.
 */

import { closeSync, createReadStream, existsSync, openSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import type { CanonicalEvent } from "@fennec/shared";

/**
 * Append a single event as one JSONL line, atomically.
 *
 * Synchronous on purpose: the daemon's hot path is short enough that
 * blocking the event loop for a single fs.write is fine, and the
 * crash-safety guarantee is what matters here.
 */
export function appendEvent(event: CanonicalEvent, queuePath: string): void {
  const line = `${JSON.stringify(event)}\n`;
  const fd = openSync(queuePath, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/**
 * Replay events from the queue starting AFTER the line whose
 * `idempotency_key` matches `lastSyncedIdempotencyKey`. If
 * `lastSyncedIdempotencyKey` is null, yields everything.
 *
 * Tolerates corrupted/truncated lines — they're silently dropped (the
 * crash-safety contract: lose the partially-written event, never throw
 * the whole queue away).
 */
export async function* replayFromWatermark(
  queuePath: string,
  lastSyncedIdempotencyKey: string | null,
): AsyncIterableIterator<CanonicalEvent> {
  if (!existsSync(queuePath)) return;

  const stream = createReadStream(queuePath, { encoding: "utf-8" });
  // The default `crlfDelay: Infinity` recombines CR+LF as a single line break,
  // which is the behaviour we want for cross-platform JSONL.
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let pastWatermark = lastSyncedIdempotencyKey === null;
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      let parsed: CanonicalEvent;
      try {
        parsed = JSON.parse(line) as CanonicalEvent;
      } catch {
        // Corrupted / truncated line — skip, don't throw the whole queue away
        continue;
      }

      if (!pastWatermark) {
        // We have not yet crossed the watermark — keep reading and flip
        // the flag once we see the watermark key, but do NOT yield it.
        if (parsed.idempotency_key === lastSyncedIdempotencyKey) {
          pastWatermark = true;
        }
        continue;
      }

      yield parsed;
    }
  } finally {
    rl.close();
    stream.close();
  }
}
