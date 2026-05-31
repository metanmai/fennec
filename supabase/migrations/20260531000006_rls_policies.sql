-- D-26: RLS policies on every customer-data table from day 1.
-- Phase 1 backend uses service_role (RLS bypass); these become load-bearing
-- in Phase 3 when user-scoped tokens are introduced.
--
-- Multi-tenant isolation is implemented in two layers in Phase 1:
--   1. Backend middleware enforces `org_id = api_key.org_id` on every request
--      (the primary defence; Plan 01-05 wires this).
--   2. These RLS policies are the belt-and-suspenders backstop. The backend
--      currently runs as `service_role` and bypasses them, but the moment
--      Phase 3 introduces a `user_role` JWT, these policies activate
--      automatically.
--
-- Why declare them now: per CONTEXT.md D-26 and PITFALLS Pitfall 5, this
-- cannot be retrofitted without painful data migrations — tables that go
-- live without RLS are very difficult to lock down later without breaking
-- the application. Declaring placeholders today commits the surface.
--
-- Policy pattern:
--   USING (org_id = (auth.jwt() ->> 'org_id')::uuid)
-- Supabase Auth signs a custom claim `org_id` into every issued JWT (set
-- via the Auth trigger in Phase 3); the policy reads it and gates row
-- visibility to the calling tenant. The `orgs` and `users` tables get
-- special-case policies (see inline comments).

-- =============================================================================
-- 1. orgs — special case: orgs.id IS the org_id (no separate org_id column).
-- =============================================================================
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
CREATE POLICY orgs_tenant_isolation ON orgs
  USING (id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 2. users — special case: no org_id column. Phase 3 will replace this
--    placeholder with a `EXISTS (SELECT 1 FROM org_members ...)` cross-org
--    policy that lets users see other members of their orgs.
--    For Phase 1, the placeholder `USING (TRUE)` is intentionally permissive;
--    backend middleware is the actual gate (service_role bypasses anyway).
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
  USING (TRUE);  -- Phase 3 will add cross-org user policy via org_members JOIN

-- =============================================================================
-- 3. org_members
-- =============================================================================
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_members_tenant_isolation ON org_members
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 4. projects
-- =============================================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant_isolation ON projects
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 5. daemon_machines
-- =============================================================================
ALTER TABLE daemon_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY daemon_machines_tenant_isolation ON daemon_machines
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 6. api_keys
-- =============================================================================
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 7. ai_events  (RLS on the parent applies to all partitions automatically)
-- =============================================================================
ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_events_tenant_isolation ON ai_events
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 8. git_events
-- =============================================================================
ALTER TABLE git_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY git_events_tenant_isolation ON git_events
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 9. adapter_heartbeats
-- =============================================================================
ALTER TABLE adapter_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY adapter_heartbeats_tenant_isolation ON adapter_heartbeats
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);

-- =============================================================================
-- 10. daemon_audit_events
-- =============================================================================
ALTER TABLE daemon_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY daemon_audit_events_tenant_isolation ON daemon_audit_events
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
