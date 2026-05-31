import type { Client } from "pg";

/**
 * Heartbeat queries against `adapter_heartbeats`
 * (`supabase/migrations/20260531000004_adapter_heartbeats.sql`).
 *
 * The table's `idempotency_key TEXT NOT NULL UNIQUE` constraint is what
 * makes the upsert idempotent at the wire level -- `ON CONFLICT
 * (idempotency_key) DO NOTHING` is the dedupe path (CAP-14).
 */

export interface InsertableHeartbeat {
  org_id: string;
  daemon_machine_id: string;
  adapter: string;
  adapter_version: string;
  schema_hash: string;
  events_parsed: number;
  parse_errors: number;
  daemon_unreachable_count: number;
  interval_start: string;
  interval_end: string;
  schema_version: number;
  idempotency_key: string;
}

export async function insertHeartbeat(client: Client, hb: InsertableHeartbeat): Promise<number> {
  const result = await client.query(
    `INSERT INTO adapter_heartbeats (
       org_id,
       daemon_machine_id,
       adapter,
       adapter_version,
       schema_hash,
       events_parsed,
       parse_errors,
       daemon_unreachable_count,
       interval_start,
       interval_end,
       schema_version,
       idempotency_key
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      hb.org_id,
      hb.daemon_machine_id,
      hb.adapter,
      hb.adapter_version,
      hb.schema_hash,
      hb.events_parsed,
      hb.parse_errors,
      hb.daemon_unreachable_count,
      hb.interval_start,
      hb.interval_end,
      hb.schema_version,
      hb.idempotency_key,
    ],
  );
  return result.rowCount ?? 0;
}
