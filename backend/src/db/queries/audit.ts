import type { Client } from "pg";

/**
 * Audit-event queries against `daemon_audit_events`
 * (`supabase/migrations/20260531000005_daemon_audit_events.sql`).
 *
 * The five valid reasons (per the CHECK constraint) are:
 *   - user_initiated, mdm_revoke, admin_initiated  (uninstall paths)
 *   - attach_completed                              (dev-OAuth attach)
 *   - enrollment_completed                          (initial enroll)
 *
 * `idempotency_key TEXT NOT NULL UNIQUE` plus `ON CONFLICT DO NOTHING`
 * prevents double-recording the same audit event (e.g. if the enroll
 * handler retries after a transient DB error).
 */

export interface InsertableAuditEvent {
  org_id: string;
  daemon_machine_id: string | null;
  hostname: string;
  reason: "user_initiated" | "mdm_revoke" | "admin_initiated" | "attach_completed" | "enrollment_completed";
  actor: string | null;
  occurred_at: string;
  schema_version: number;
  idempotency_key: string;
}

export async function insertAuditEvent(client: Client, audit: InsertableAuditEvent): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO daemon_audit_events (
       org_id,
       daemon_machine_id,
       hostname,
       reason,
       actor,
       occurred_at,
       schema_version,
       idempotency_key
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      audit.org_id,
      audit.daemon_machine_id,
      audit.hostname,
      audit.reason,
      audit.actor,
      audit.occurred_at,
      audit.schema_version,
      audit.idempotency_key,
    ],
  );
  return result.rows[0]?.id ?? null;
}
