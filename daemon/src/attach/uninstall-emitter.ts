/**
 * Uninstall audit emitter (Plan 01-08 Task 2, DAE-19 daemon side,
 * D-18 audit requirement).
 *
 * When the daemon is being uninstalled (`sudo fennec uninstall` in
 * personal tier or MDM-revoke in org tier), it MUST emit an audit
 * event to the backend BEFORE the daemon process exits. The backend
 * stores these in `daemon_audit_events` (Plan 01-04 schema) so the
 * eventual Phase 4 admin dashboard can show "Machine X uninstalled
 * at T with reason R".
 *
 * The emitter is small intentionally — Plan 01-09's `fennec uninstall`
 * CLI calls this once, then proceeds with file-system teardown.
 * Errors are re-thrown so the CLI can surface them; failures DO NOT
 * block uninstall (the daemon will be removed regardless).
 *
 * Idempotency: the idempotency_key includes a millisecond timestamp
 * so legitimate repeat-uninstalls (the user did `uninstall` then
 * `--force uninstall`) generate distinct audit rows. The backend's
 * `daemon_audit_events` has a unique constraint on (api_key_id,
 * idempotency_key) so a retried POST with the same key produces a
 * single row.
 */

import { type UninstallAuditEvent, UninstallAuditEventSchema, type UninstallReason } from "@fennec/shared";

export interface EmitUninstallAuditInput {
  apiBaseUrl: string;
  apiKey: string;
  reason: UninstallReason;
  machineId: string;
  hostname: string;
  actor?: string;
  fetchFn?: typeof fetch;
  fetchOpts?: RequestInit;
}

export async function emitUninstallAudit(input: EmitUninstallAuditInput): Promise<void> {
  const now = new Date();
  const body: UninstallAuditEvent = UninstallAuditEventSchema.parse({
    idempotency_key: `${input.machineId}|uninstall|${now.getTime()}`,
    machine_id: input.machineId,
    hostname: input.hostname,
    reason: input.reason,
    actor: input.actor,
    occurred_at: now.toISOString(),
    schema_version: 1 as const,
  });

  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const fetchOpts = input.fetchOpts ?? {};
  const resp = await fetchFn(`${input.apiBaseUrl}/api/daemons/uninstall`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    ...fetchOpts,
  });

  if (!resp.ok) {
    throw new Error(`uninstall-audit-failed-${resp.status}`);
  }
}
