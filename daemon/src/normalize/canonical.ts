/**
 * Canonical event normalisation (Task 2 of Plan 01-06).
 *
 * Stamps the universal envelope (hostname, os, occurred_at,
 * idempotency_key, schema_version) onto an adapter-supplied event.
 * The redaction metadata fields (`redaction_applied_at`,
 * `redaction_version_hash`) are stamped by the downstream redactor —
 * here they're filled with empty-string placeholders so the
 * `CanonicalEvent` type is satisfied at the queue-entry boundary.
 *
 * `idempotency_key` is derived from `${hostname}|${tool}|${session_id}|${hook_event}|${monotonic_seq}`
 * via Web Crypto's `crypto.subtle.digest("SHA-256", ...)`, sliced to 32
 * hex chars (128 bits — CAP-13 / PITFALL P5). The shared package's
 * `deriveIdempotencyKey` is re-exported below for downstream callers.
 *
 * The monotonic_seq is persisted to `${seqDir}/${tool}.json` so a daemon
 * restart doesn't reset the counter. Atomic write via tmp + rename.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import type { CanonicalEvent, EventKind, Os, Tool } from "@fennec/shared";
import { deriveIdempotencyKey } from "@fennec/shared";

export { deriveIdempotencyKey };

/**
 * Map `process.platform` to the OsSchema enum the wire format expects.
 * Any non-darwin, non-linux platform is mapped to "win32" (the only
 * other supported value) — covers win32, cygwin, etc.
 */
function detectOs(): Os {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "win32";
}

export interface BuildCanonicalEventInput {
  tool: Tool;
  adapter_version: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  session_id: string;
  hook_event: string;
  occurred_at?: string;
  /** If supplied, overrides the persisted seq (used by retries / tests). */
  monotonic_seq?: number;
  seqDir: string;
  cwd?: string;
  git_remote?: string;
  git_branch?: string;
  /** Hostname override — defaults to `os.hostname()`. Used only by tests. */
  hostname?: string;
}

/**
 * Build a `CanonicalEvent` from adapter-supplied fields. Stamps the
 * envelope (hostname, os, occurred_at, idempotency_key, schema_version)
 * and leaves the redaction metadata as empty placeholders for the
 * downstream redactor to fill.
 */
export async function buildCanonicalEvent(input: BuildCanonicalEventInput): Promise<CanonicalEvent> {
  const hostname = input.hostname ?? os.hostname();
  const platform = detectOs();
  const occurredAt = input.occurred_at ?? new Date().toISOString();

  // If the caller pinned monotonic_seq (test / retry path), use it
  // verbatim. Otherwise bump the persisted per-adapter sequence.
  const monotonicSeq = input.monotonic_seq ?? bumpMonotonicSeq(input.tool, input.seqDir);

  const idempotency_key = await deriveIdempotencyKey({
    hostname,
    tool: input.tool,
    session_id: input.session_id,
    hook_event: input.hook_event,
    monotonic_seq: monotonicSeq,
  });

  const envelope: CanonicalEvent = {
    idempotency_key,
    tool: input.tool,
    adapter_version: input.adapter_version,
    occurred_at: occurredAt,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.git_remote ? { git_remote: input.git_remote } : {}),
    ...(input.git_branch ? { git_branch: input.git_branch } : {}),
    hostname,
    os: platform,
    kind: input.kind,
    payload: input.payload,
    schema_version: 1,
    // Empty placeholders — redactor fills these in the registry pipeline.
    redaction_applied_at: "",
    redaction_version_hash: "",
  };

  return envelope;
}

/**
 * Per-adapter monotonic sequence files live under `${seqDir}/${tool}.json`
 * as `{ "seq": <integer> }`. The file is created on first bump; a missing
 * file reads as `seq=0`. Atomic write via temp file + rename.
 */
export function readMonotonicSeq(tool: string, seqDir: string): number {
  const path = join(seqDir, `${tool}.json`);
  if (!existsSync(path)) return 0;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { seq?: unknown };
    if (typeof parsed.seq === "number" && Number.isInteger(parsed.seq) && parsed.seq >= 0) {
      return parsed.seq;
    }
    return 0;
  } catch {
    // Corrupted seq file is benign — start from 0 and overwrite on next bump
    return 0;
  }
}

export function bumpMonotonicSeq(tool: string, seqDir: string): number {
  // Ensure the directory exists (idempotent; works on first run)
  if (!existsSync(seqDir)) {
    mkdirSync(seqDir, { recursive: true });
  }

  const next = readMonotonicSeq(tool, seqDir) + 1;
  const path = join(seqDir, `${tool}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ seq: next }));
  renameSync(tmp, path);
  return next;
}
