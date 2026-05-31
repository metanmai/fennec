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
