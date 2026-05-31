import type { Client } from "pg";

/**
 * AI-event queries against the partitioned `ai_events` table
 * (created in `supabase/migrations/20260531000002_ai_events_partitioned.sql`).
 *
 * Schema invariants we honour:
 *   - PRIMARY KEY (idempotency_key, occurred_at) -- the partition column must
 *     be part of every unique constraint, and the composite doubles as the
 *     dedupe key in our `ON CONFLICT DO NOTHING` clause (ING-02).
 *   - `org_id` is NOT NULL -- the handler stamps it from auth context, the
 *     query NEVER reads it from the request body (T-05-02 mitigation).
 *   - `user_id` is nullable; `user_id_unknown` is `"unknown@${hostname}"` for
 *     events captured before the dev-OAuth attach (D-15). Backfill on attach
 *     is `backfillUnknownUser` below.
 *
 * All queries are parameterised (`$1`, `$2`, ...). T-05-03 mitigation.
 */

export interface InsertableAiEvent {
  idempotency_key: string;
  org_id: string;
  user_id: string | null;
  user_id_unknown: string | null;
  tool: string;
  occurred_at: string;
  payload: unknown;
  schema_version: number;
  redaction_applied_at: string;
  redaction_version_hash: string;
  hostname: string;
}

/**
 * Per-row INSERT with `ON CONFLICT (idempotency_key, occurred_at) DO NOTHING`.
 * Returns the count of rows actually inserted (0 if the row was a duplicate).
 *
 * Phase 1 picks one INSERT per event for simplicity (Plan 01-05 §Task 2 note).
 * Phase 2 may swap to a multi-row VALUES list once the bulk-insert volume is
 * worth optimising. The dedupe contract is identical either way.
 */
export async function insertAiEvent(client: Client, event: InsertableAiEvent): Promise<number> {
  const result = await client.query(
    `INSERT INTO ai_events (
       idempotency_key,
       org_id,
       user_id,
       user_id_unknown,
       tool,
       occurred_at,
       payload,
       schema_version,
       redaction_applied_at,
       redaction_version_hash,
       hostname
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (idempotency_key, occurred_at) DO NOTHING`,
    [
      event.idempotency_key,
      event.org_id,
      event.user_id,
      event.user_id_unknown,
      event.tool,
      event.occurred_at,
      JSON.stringify(event.payload),
      event.schema_version,
      event.redaction_applied_at,
      event.redaction_version_hash,
      event.hostname,
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Backfills `user_id` (and clears `user_id_unknown`) for every event written
 * before the first successful dev-OAuth attach. One-shot per machine per
 * D-15: when the daemon attaches a developer identity, ALL prior events for
 * (org_id, hostname) with NULL user_id are tied back to the resolved user.
 *
 * Returns the number of rows backfilled (informational; the handler logs
 * this).
 */
export async function backfillUnknownUser(
  client: Client,
  input: { org_id: string; hostname: string; user_id: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE ai_events
        SET user_id = $3,
            user_id_unknown = NULL
      WHERE org_id = $1
        AND hostname = $2
        AND user_id IS NULL`,
    [input.org_id, input.hostname, input.user_id],
  );
  return result.rowCount ?? 0;
}
