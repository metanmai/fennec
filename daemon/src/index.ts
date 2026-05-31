/**
 * @fennec/daemon — entry-point + public API surface.
 *
 * Phase 1, Plan 01-06 ships the in-process pipeline: adapter registry,
 * canonical normalisation, JSONL queue, watermark, rotation, redactor,
 * sync loop, heartbeat emitter. The actual CLI entry-point (`fennec`
 * binary, LaunchDaemon plist wiring) is plan 01-09.
 *
 * Downstream plans (01-07 Claude Code adapter, 01-08 identity/attach,
 * 01-09 OS-service install, 01-10 smoke test) import from here.
 */

// Adapter contract
export type { Adapter, Emit, EmitInput } from "./adapters/adapter.js";
export type {
  AdapterCounter,
  AdapterRegistryOptions,
  CountersSnapshot,
  RedactFn,
} from "./adapters/registry.js";
export { AdapterRegistry } from "./adapters/registry.js";
export type { Env } from "./env.js";
// Env
export { loadEnv } from "./env.js";
export type { HeartbeatSchedulerOptions } from "./heartbeat/heartbeat.js";
export { DEFAULT_HEARTBEAT_INTERVAL_MS, HeartbeatScheduler } from "./heartbeat/heartbeat.js";
// Heartbeat
export { computeSchemaHash } from "./heartbeat/schema-hash.js";
export type { BuildCanonicalEventInput } from "./normalize/canonical.js";
// Canonical normalisation
export {
  buildCanonicalEvent,
  bumpMonotonicSeq,
  deriveIdempotencyKey,
  readMonotonicSeq,
} from "./normalize/canonical.js";
// Queue
export { appendEvent, replayFromWatermark } from "./queue/jsonl.js";
export type { RotationResult } from "./queue/rotation.js";
export { listRotatedFiles, rotateIfNeeded, THRESHOLD_BYTES_DEFAULT } from "./queue/rotation.js";
export type { Watermark } from "./queue/watermark.js";
export { advanceWatermark, readWatermark } from "./queue/watermark.js";
export type { CanarySmokeResult } from "./redact/canary-test.js";
export { CANARIES, runCanarySmoke } from "./redact/canary-test.js";
// Redactor + PRIV-01 canaries
export type { CompiledRule } from "./redact/gitleaks-rules.js";
export {
  COMPILED_RULE_COUNT,
  GITLEAKS_TOML_SHA256,
  gitleaksRules,
  REDACTION_VERSION_HASH,
} from "./redact/gitleaks-rules.js";
export { redactEvent } from "./redact/redactor.js";
export type { BackoffParams } from "./sync/backoff.js";
export { DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS, exponentialBackoff, resetBackoff } from "./sync/backoff.js";
// Sync loop
export type { Batch } from "./sync/batch.js";
export { readNextBatch } from "./sync/batch.js";
export type { SyncLoopOptions } from "./sync/loop.js";
export { DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS, SyncLoop } from "./sync/loop.js";
export { buildFetchOptions, detectExtraCaCerts, detectHttpsProxy } from "./sync/proxy.js";
