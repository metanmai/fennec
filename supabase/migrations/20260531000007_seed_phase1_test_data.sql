-- =============================================================================
-- DEV-AND-SMOKE-TEST ONLY. DO NOT APPLY TO PRODUCTION.
--
-- Creates one test org + one test user + one test daemon_machine + one test
-- api_key with KNOWN PLAINTEXT VALUES for the Phase 1 smoke test (plan 10).
-- Plaintext secrets recorded in .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md.
-- Production setup (Phase 6) skips this migration via Supabase migration tags
-- or `psql -f` exclude (see supabase/migrations/README.md §Workflows).
--
-- Idempotency: every INSERT uses `ON CONFLICT DO NOTHING` so re-running this
-- migration (e.g. via `supabase db reset`) produces the same state without
-- error. The known UUIDs in column 1 of each INSERT are the conflict keys.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Test org
--   id              = 00000000-0000-0000-0000-000000000001
--   install_secret  = "FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa"
-- -----------------------------------------------------------------------------
INSERT INTO orgs (id, name, install_secret_hash, install_secret_expires_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Phase 1 Test Org',
  encode(digest('FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa', 'sha256'), 'hex'),
  NOW() + INTERVAL '90 days'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test user
--   id     = 00000000-0000-0000-0000-000000000002
--   email  = test@fennec.local
-- -----------------------------------------------------------------------------
INSERT INTO users (id, email)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'test@fennec.local'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test org membership: test user is admin of test org
-- -----------------------------------------------------------------------------
INSERT INTO org_members (org_id, user_id, role)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'admin'
)
ON CONFLICT (org_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test project (Phase 1 just needs one default per org)
--   id = 00000000-0000-0000-0000-000000000003
-- -----------------------------------------------------------------------------
INSERT INTO projects (id, org_id, name)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Phase 1 Smoke Test Project'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test daemon_machine
--   id          = 00000000-0000-0000-0000-000000000004
--   machine_id  = PHASE1_SMOKE_MACHINE
-- -----------------------------------------------------------------------------
INSERT INTO daemon_machines (id, org_id, machine_id, hostname, os)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'PHASE1_SMOKE_MACHINE',
  'phase1-host',
  'darwin'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test api_key
--   id              = 00000000-0000-0000-0000-000000000005
--   plaintext token = "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd"
-- -----------------------------------------------------------------------------
INSERT INTO api_keys (id, org_id, daemon_machine_id, token_hash)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  encode(digest('fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd', 'sha256'), 'hex')
)
ON CONFLICT (id) DO NOTHING;
