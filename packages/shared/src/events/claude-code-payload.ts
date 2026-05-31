import { z } from "zod";

/**
 * The six Anthropic-emitted Claude Code hook events fennec adapts on
 * (D-22). Matches synapse's surface so captured-event volume is comparable.
 */
export const ClaudeCodeHookEventSchema = z.enum([
  "UserPromptSubmit",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "SubagentStop",
]);
export type ClaudeCodeHookEvent = z.infer<typeof ClaudeCodeHookEventSchema>;

/**
 * Anthropic Usage object — captured VERBATIM from the API response.
 *
 * All four token counters are SEPARATE optional non-negative integers per
 * ANL-06 / threat T-02-03 / PITFALL P6: the daemon must NEVER aggregate
 * these at capture (LiteLLM bug pattern — 70%+ cost miscount). Cost
 * computation is deferred to Phase 2 backend where the disagreement
 * between Anthropic docs and OTel spec (Assumption A2) can be resolved
 * without redeploying daemons.
 */
export const AnthropicUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative(),
  })
  .partial();
export type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>;

/**
 * Claude Code prompt payload — what the daemon stores under
 * `CanonicalEvent.payload` for `tool: "claude-code"` events.
 *
 * `prompt_text` is POST-redaction (PRIV-01 / PITFALL P1): the daemon
 * runs the gitleaks rule set before the event reaches the queue.
 */
export const ClaudeCodePromptPayloadSchema = z.object({
  prompt_text: z.string(),
  session_id: z.string(),
  cwd: z.string().optional(),
  hook_event: ClaudeCodeHookEventSchema,
  usage: AnthropicUsageSchema.optional(),
});
export type ClaudeCodePromptPayload = z.infer<typeof ClaudeCodePromptPayloadSchema>;
