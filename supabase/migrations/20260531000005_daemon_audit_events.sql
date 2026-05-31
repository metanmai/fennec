-- DAE-19 + AUTH-16 + AUTH-14: audit log for uninstall, attach, enrollment events.
--
-- Captures every state-changing daemon-lifecycle event so org admins can audit
-- their fleet in the eventual dashboard (Phase 4). The `reason` CHECK constraint
-- enumerates the five valid reasons:
--   • user_initiated       — local sudo `fennec uninstall` (personal-tier)
--   • mdm_revoke           — MDM withdrew the device (org-tier; D-18)
--   • admin_initiated      — org admin triggered remote uninstall via dashboard
--   • attach_completed     — daemon attached to a developer identity via SSO (AUTH-16)
--   • enrollment_completed — daemon traded install_secret for api_key (AUTH-14)
-- Adding a new reason requires a future migration (the type-level catch is in
-- @fennec/shared/auth/uninstall.ts).
--
-- daemon_machine_id is NULLABLE (no FK CASCADE) — post-uninstall audits may
-- arrive after the daemon_machines row has been deleted by an admin sweep,
-- and we want the audit record to survive.

CREATE TABLE daemon_audit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  daemon_machine_id   UUID REFERENCES daemon_machines(id),    -- NULL ok for post-uninstall audits
  hostname            TEXT NOT NULL,
  reason              TEXT NOT NULL CHECK (reason IN (
                        'user_initiated',
                        'mdm_revoke',
                        'admin_initiated',
                        'attach_completed',
                        'enrollment_completed'
                      )),
  actor               TEXT,                                   -- e.g. user_id (attach), mdm operator (revoke), or NULL
  occurred_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version      INTEGER NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE
);
