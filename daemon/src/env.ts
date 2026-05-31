/**
 * Daemon environment / paths.
 *
 * The "data dir" defaults to `~/.fennec/` and holds the JSONL queue,
 * sync-state watermark, per-adapter sequence files, and the flush signal
 * file. Production installs (LaunchDaemon root) will override the data
 * dir via `FENNEC_DATA_DIR` to `/var/db/fennec/` per Pitfall 10
 * threat model.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Env {
  /** Backend base URL — POSTed to by the sync loop and heartbeat emitter. */
  apiBaseUrl: string;
  /** Daemon data directory (queue, watermark, sequences, flush signal). */
  dataDir: string;
  /** Append-only JSONL queue path. */
  queuePath: string;
  /** Sync-state watermark path. */
  watermarkPath: string;
  /** Touch-this-file-to-force-flush signal path. */
  flushSignalPath: string;
  /** Per-adapter monotonic_seq directory. */
  seqDir: string;
}

/**
 * Build the `Env` shape from process.env + defaults. Idempotently
 * creates the data dir + sequence dir so adapters can start writing
 * immediately.
 */
export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const dataDir = processEnv.FENNEC_DATA_DIR ?? join(homedir(), ".fennec");
  const apiBaseUrl = processEnv.FENNEC_API_URL ?? "https://api.fennec.dev";
  const queuePath = join(dataDir, "events.jsonl");
  const watermarkPath = join(dataDir, "sync-state.json");
  const flushSignalPath = join(dataDir, "daemon-flush-now");
  const seqDir = join(dataDir, "seq");

  ensureDir(dataDir);
  ensureDir(seqDir);

  return { apiBaseUrl, dataDir, queuePath, watermarkPath, flushSignalPath, seqDir };
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}
