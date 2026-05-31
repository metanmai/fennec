/**
 * JSONL queue rotation (Task 2 of Plan 01-06; threat T-06-04 — unbounded
 * disk growth → DoS).
 *
 * When the live queue exceeds the threshold, rename it to a timestamped
 * `events-<ISO>.jsonl` file and create a fresh empty queue. The
 * watermark file is intentionally NOT touched — the sync loop reads
 * rotated files in chronological order first, then the live queue.
 *
 * The 100MB threshold (THRESHOLD_BYTES_DEFAULT) is the value baked into
 * CAP-11 / Assumption A7 — 100MB ≈ 500k events, which is the daemon's
 * offline-tolerance horizon. After that, drop the oldest rotated file
 * (Phase 5 doctor scope — Phase 1 just keeps writing).
 */

import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// 100MB = 100 * 1024 * 1024 = 104857600. We keep the explicit
// multiplication so the constant matches the planner's intent in
// PLAN.md acceptance criteria (grep target).
export const THRESHOLD_BYTES_DEFAULT = 100 * 1024 * 1024;

export interface RotationResult {
  rotated: boolean;
  rotatedTo?: string;
}

/**
 * Rotate the queue file if its current size exceeds the threshold.
 * Returns `{ rotated: false }` if rotation was unnecessary or the
 * queue file does not exist (nothing to rotate).
 *
 * Naming: rotated files use `events-<ISO-timestamp>.jsonl` where
 * timestamp is `new Date().toISOString().replace(/[:.]/g, "-")` so
 * filesystem-safe characters land in the basename.
 */
export function rotateIfNeeded(queuePath: string, thresholdBytes: number = THRESHOLD_BYTES_DEFAULT): RotationResult {
  if (!existsSync(queuePath)) return { rotated: false };

  const stats = statSync(queuePath);
  if (stats.size <= thresholdBytes) return { rotated: false };

  const dir = dirname(queuePath);
  const live = basename(queuePath, ".jsonl");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedTo = join(dir, `${live}-${timestamp}.jsonl`);

  renameSync(queuePath, rotatedTo);
  // Recreate the live queue as an empty file so the next appendEvent
  // doesn't accidentally adopt a stale fd.
  writeFileSync(queuePath, "");

  return { rotated: true, rotatedTo };
}

/**
 * List the rotated `events-<ISO>.jsonl` files in `dataDir`, sorted
 * lexicographically (which is chronologically — ISO timestamps sort
 * correctly as strings). The live `events.jsonl` is excluded.
 */
export function listRotatedFiles(dataDir: string): string[] {
  if (!existsSync(dataDir)) return [];
  const entries = readdirSync(dataDir);
  return entries
    .filter((name) => /^events-.+\.jsonl$/.test(name) && name !== "events.jsonl")
    .sort()
    .map((name) => join(dataDir, name));
}
