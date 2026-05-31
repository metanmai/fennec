/**
 * Claude Code hook payload normaliser (Plan 01-07 Task 3).
 *
 * Translates the raw Anthropic Claude Code hook payload (per
 * https://code.claude.com/docs/en/hooks) into the EmitInput shape the
 * adapter registry expects. The mapping is intentionally thin — most
 * fields pass through verbatim. The interesting bits:
 *
 *   1. `hook_event_name` → `kind` (EventKind enum) via HOOK_EVENT_TO_KIND.
 *      Unknown hook events throw so the registry counts parse_errors
 *      (PITFALL P1 — better dropped than mis-classified).
 *
 *   2. The 4 Anthropic Usage token fields (input_tokens, output_tokens,
 *      cache_creation_input_tokens, cache_read_input_tokens) are
 *      preserved SEPARATELY, VERBATIM. No aggregation. No derived
 *      `total_input_tokens`. Per Plan 01-06 A2 resolution (option c):
 *      Phase 2 cost worker will calibrate the formula empirically;
 *      Phase 1 daemon captures verbatim so future calibration can
 *      change interpretation without redeploying daemons.
 *
 *   3. The normaliser does NOT redact. Redaction happens downstream
 *      in `AdapterRegistry.makeEmit` → `redact()`. The normaliser's
 *      output reaches the registry which then runs gitleaks rules.
 */

import type { EventKind } from "@fennec/shared";
import type { EmitInput } from "../adapter.js";

/**
 * Map each of the 6 Claude Code hook events (D-22) to the corresponding
 * fennec EventKind. The 6 keys are:
 *   - UserPromptSubmit, PostToolUse, SessionStart, SessionEnd,
 *     PreCompact, SubagentStop
 */
export const HOOK_EVENT_TO_KIND: Readonly<Record<string, EventKind>> = Object.freeze({
  UserPromptSubmit: "prompt_submitted",
  PostToolUse: "tool_call",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  PreCompact: "pre_compact",
  SubagentStop: "subagent_stop",
});

/** Read the value of a property from an unknown object safely. */
function pick<T>(obj: unknown, key: string): T | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key] as T | undefined;
}

/**
 * Extract the Anthropic Usage object from the raw hook payload, if
 * present. The shape on the wire (per Anthropic docs) is:
 *   raw.tool.response.usage = { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens }
 *
 * Returns undefined if the path doesn't exist or no usage is set.
 * Returns the 4 fields verbatim if present — no aggregation, no math.
 */
function extractUsage(raw: unknown): Record<string, unknown> | undefined {
  const tool = pick<unknown>(raw, "tool");
  if (tool == null) return undefined;
  const response = pick<unknown>(tool, "response");
  if (response == null) return undefined;
  const usage = pick<unknown>(response, "usage");
  if (usage == null || typeof usage !== "object") return undefined;

  // Preserve the 4 fields verbatim — VERBATIM per A2 option c.
  // Any non-number values pass through as-is so downstream validation
  // (Zod) can flag them; the normaliser does not silently coerce.
  const u = usage as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (u.input_tokens !== undefined) out.input_tokens = u.input_tokens;
  if (u.output_tokens !== undefined) out.output_tokens = u.output_tokens;
  if (u.cache_creation_input_tokens !== undefined) {
    out.cache_creation_input_tokens = u.cache_creation_input_tokens;
  }
  if (u.cache_read_input_tokens !== undefined) {
    out.cache_read_input_tokens = u.cache_read_input_tokens;
  }
  // If all 4 fields were absent, return undefined (not an empty object).
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

/**
 * Normalise a raw Claude Code hook payload into an EmitInput.
 *
 * Throws if:
 *   - hook_event_name is missing or not one of the 6 D-22 hooks
 *   - session_id is missing
 *
 * The throw is the registry's signal that this event is malformed —
 * AdapterRegistry.makeEmit catches it, counts parse_errors, and drops.
 */
export function normalizeHookPayload(raw: unknown): EmitInput {
  const hookEventName = pick<unknown>(raw, "hook_event_name");
  if (typeof hookEventName !== "string") {
    throw new Error("hook_event_name missing or not a string");
  }
  const kind = HOOK_EVENT_TO_KIND[hookEventName];
  if (!kind) {
    throw new Error(`unknown hook_event_name: ${hookEventName}`);
  }

  const sessionId = pick<unknown>(raw, "session_id");
  if (typeof sessionId !== "string") {
    throw new Error("session_id missing or not a string");
  }

  const cwd = pick<unknown>(raw, "cwd");
  const prompt = pick<unknown>(raw, "prompt");
  const usage = extractUsage(raw);

  // Build the payload object stored under CanonicalEvent.payload. The
  // shape matches `ClaudeCodePromptPayloadSchema` from @fennec/shared
  // for prompt_submitted kinds and is permissive for the other 5 kinds
  // (the per-tool schema accepts optional fields).
  const payload: Record<string, unknown> = {
    prompt_text: typeof prompt === "string" ? prompt : "",
    session_id: sessionId,
    hook_event: hookEventName,
  };
  if (typeof cwd === "string") payload.cwd = cwd;
  if (usage !== undefined) payload.usage = usage;

  const out: EmitInput = {
    tool: "claude-code",
    adapter_version: "0.1.0",
    kind,
    payload,
    session_id: sessionId,
    hook_event: hookEventName,
  };
  if (typeof cwd === "string") out.cwd = cwd;
  return out;
}

/**
 * The normaliser's output type, re-exported for callers that want to
 * pre-build payloads before handing them to the adapter (e.g. tests).
 */
export type NormalisedClaudeCodeEvent = EmitInput;
