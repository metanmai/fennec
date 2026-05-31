import { z } from "zod";

/**
 * The three valid reasons a fennec daemon can be uninstalled
 * (DAE-19 / D-18 / D-19).
 *
 *  - `user_initiated`: a local user ran `sudo fennec uninstall` from
 *    a personal-tier install (the local user IS the org admin in that
 *    case per D-02).
 *  - `mdm_revoke`: an org admin pushed a profile-removal command via
 *    Jamf / Intune; the daemon's preinstall-removal hook fires this
 *    audit event before the binary is removed.
 *  - `admin_initiated`: an org admin used the eventual Phase 4
 *    dashboard kill-switch (not built in Phase 1; the wire format is
 *    ready here).
 */
export const UninstallReasonSchema = z.enum(["user_initiated", "mdm_revoke", "admin_initiated"]);
export type UninstallReason = z.infer<typeof UninstallReasonSchema>;

/**
 * `UninstallAuditEventSchema` — emitted by the daemon during teardown.
 * The backend stores these in `daemon_audit_events` (Plan 01-04 schema)
 * so the eventual Phase 4 admin dashboard can show "Machine X
 * uninstalled at T with reason R by actor A".
 *
 * `actor` is optional because the MDM-revoke path doesn't always have
 * a meaningful actor string (Jamf doesn't reliably surface the
 * triggering admin's identity).
 */
export const UninstallAuditEventSchema = z.object({
  idempotency_key: z.string().min(1),
  machine_id: z.string().min(8),
  hostname: z.string(),
  reason: UninstallReasonSchema,
  actor: z.string().optional(),
  occurred_at: z.string().datetime(),
  schema_version: z.literal(1),
});
export type UninstallAuditEvent = z.infer<typeof UninstallAuditEventSchema>;
