import { z } from "zod";

/**
 * EventKind — discriminated union of every event type the daemon can emit.
 *
 * Extending this list is a breaking schema change because backends store
 * the value verbatim in `ai_events.payload->>'kind'`. Coordinate with
 * `schema_version` bumps in `canonical.ts` when extending.
 */
export const EventKindSchema = z.enum([
  "prompt_submitted",
  "tool_call",
  "session_start",
  "session_end",
  "pre_compact",
  "subagent_stop",
  "model_response",
]);

export type EventKind = z.infer<typeof EventKindSchema>;
