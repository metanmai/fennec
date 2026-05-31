import { z } from "zod";
import { EventKindSchema } from "./kinds.js";

/**
 * The eight tools fennec captures from. Extending this list is a
 * breaking schema change — coordinate with `schema_version` and the
 * adapter registry in `daemon/src/adapters/`.
 */
export const ToolSchema = z.enum([
  "claude-code",
  "codex",
  "gemini",
  "cursor",
  "copilot",
  "chatgpt-web",
  "claude-ai-web",
  "git",
]);
export type Tool = z.infer<typeof ToolSchema>;

/**
 * Operating system the daemon is running on. Used for per-OS quirks at
 * the backend (e.g., path normalisation, machine-id format).
 */
export const OsSchema = z.enum(["darwin", "linux", "win32"]);
export type Os = z.infer<typeof OsSchema>;

/**
 * `CanonicalEventSchema` — the wire-format contract between every fennec
 * daemon and the backend ingest endpoint.
 *
 * Runtime-neutral: this module imports `zod` only — no `node:*` imports —
 * so Cloudflare Workers can re-use it without polyfills (Pattern 1 in
 * 01-RESEARCH.md).
 *
 * Anti-patterns this shape prevents (per ARCHITECTURE.md):
 *  - No top-level `claude_code_*` columns. Tool-specific data lives in
 *    `payload`, validated per-kind by the adapter (e.g.
 *    `ClaudeCodePromptPayloadSchema`). Adding new adapters is purely
 *    additive — they ship their own payload validator.
 *  - `org_id` and `user_id` are intentionally NOT in this schema. The
 *    backend stamps them from the API-key lookup (Pattern 11 + threat
 *    T-02-01); clients cannot supply them.
 *
 * `schema_version` is `z.literal(1)` — bumping the literal is the
 * formal versioning mechanism for any breaking change to the contract.
 */
export const CanonicalEventSchema = z.object({
  // identity + idempotency
  idempotency_key: z.string().min(1),

  // source
  tool: ToolSchema,
  adapter_version: z.string(),

  // time
  occurred_at: z.string().datetime(),

  // workspace context
  cwd: z.string().optional(),
  git_remote: z.string().optional(),
  git_branch: z.string().optional(),
  hostname: z.string(),
  os: OsSchema,

  // kind + payload
  kind: EventKindSchema,
  payload: z.record(z.string(), z.unknown()),

  // versioning + capture-time metadata
  schema_version: z.literal(1),
  redaction_applied_at: z.string().datetime(),
  redaction_version_hash: z.string(),
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/**
 * `EventBatchSchema` — wire format for `POST /api/events/batch`.
 *
 * Bounds: at least 1 (an empty batch is a client bug — heartbeats use
 * `AdapterHeartbeatSchema` instead) and at most 500 (matches the
 * daemon's sync-loop batch size; the backend rejects oversize batches at
 * the edge so they never reach Hyperdrive).
 */
export const EventBatchSchema = z.object({
  events: z.array(CanonicalEventSchema).min(1).max(500),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;
