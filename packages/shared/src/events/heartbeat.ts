import { z } from "zod";

/**
 * `AdapterHeartbeatSchema` — emitted by the daemon on a timer regardless
 * of whether any events were parsed (CAP-14 / PITFALL P3). Zero is a
 * VALID, INFORMATIVE value: it tells the backend "the adapter is alive
 * and waiting" vs the implicit "the adapter is dead" we'd get from
 * silence.
 *
 * `schema_hash` is the per-adapter fingerprint of the upstream tool's
 * data shape. Drift in this hash flips the adapter's status to
 * "offline" on the dashboard (CAP-15). The hash input is left to the
 * adapter (Open Question 3 in 01-RESEARCH.md — planner picked
 * field-name set hash); this schema only requires that some stable
 * string is supplied.
 */
export const AdapterHeartbeatSchema = z.object({
  idempotency_key: z.string().min(1),
  hostname: z.string(),
  adapter: z.string(),
  adapter_version: z.string(),
  schema_hash: z.string(),
  // `events_parsed` and `parse_errors` are REQUIRED, not optional —
  // zero is meaningful (heartbeat ack), `undefined` is a bug.
  events_parsed: z.number().int().nonnegative(),
  parse_errors: z.number().int().nonnegative(),
  daemon_unreachable_count: z.number().int().nonnegative().default(0),
  interval_start: z.string().datetime(),
  interval_end: z.string().datetime(),
  schema_version: z.literal(1),
});
export type AdapterHeartbeat = z.infer<typeof AdapterHeartbeatSchema>;
