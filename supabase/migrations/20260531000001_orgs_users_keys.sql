-- Phase 1: Foundations. Multi-tenant correctness from day 1 per D-26.
--
-- Creates the tenancy + identity schema:
--   orgs              — the tenant
--   users             — identities (Phase 3 adds sign-up + password_hash)
--   org_members       — M:N user ↔ org with role
--   projects          — Phase 1 just needs 1 default project per org
--   daemon_machines   — one row per enrolled host (machine_id stable across reboots)
--   api_keys          — per-machine, token_hash only (raw token returned ONCE at enrollment)
--
-- Token + secret storage rules (load-bearing):
--   • api_keys.token_hash         = sha256-hex of issued Bearer token; raw never persisted.
--   • orgs.install_secret_hash    = sha256-hex of org-distributed install secret; raw lives
--                                   in MDM payload (org) or wizard memory (personal) only.
--
-- Indexes:
--   • idx_api_keys_token_hash is a PARTIAL index on (token_hash) WHERE revoked_at IS NULL.
--     Phase 1's backend hot path (api_key bearer auth) only ever looks up active keys; the
--     partial index keeps lookups fast as the revocation history grows.

CREATE TABLE orgs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  install_secret_hash         TEXT NOT NULL,           -- sha256-hex of plaintext (raw never stored)
  install_secret_expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Phase 3 will add: password_hash, email_verified_at, sso_provider, sso_external_id
);

CREATE TABLE org_members (
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daemon_machines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  machine_id          TEXT NOT NULL,                       -- IOPlatformUUID (macOS), machine-id (Linux), etc.
  hostname            TEXT NOT NULL,
  os                  TEXT NOT NULL CHECK (os IN ('darwin', 'linux', 'win32')),
  attached_user_id    UUID REFERENCES users(id),           -- NULL until SSO attach (D-15)
  attached_at         TIMESTAMPTZ,                         -- NULL until SSO attach
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, machine_id)
);

CREATE TABLE api_keys (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  daemon_machine_id       UUID NOT NULL REFERENCES daemon_machines(id) ON DELETE CASCADE,
  token_hash              TEXT NOT NULL UNIQUE,            -- sha256-hex of Bearer token (raw never stored)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ                       -- NULL = active
);

-- Partial index: backend's bearer-auth hot path only checks active keys.
CREATE INDEX idx_api_keys_token_hash
  ON api_keys (token_hash)
  WHERE revoked_at IS NULL;
