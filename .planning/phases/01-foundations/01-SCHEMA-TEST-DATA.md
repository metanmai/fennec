# Phase 1 Schema Test Data

> **Companion to:** `supabase/migrations/20260531000007_seed_phase1_test_data.sql`
> **Consumed by:** Plan 01-05 (backend integration tests) and Plan 01-10
> (end-to-end smoke test).
> **Last updated:** 2026-05-31

This file records the **known plaintext** values that the Phase 1 seed
migration uses. Downstream smoke tests (Plan 01-10) and backend integration
tests (Plan 01-05) need these plaintexts so they can produce the matching
`sha256-hex` hashes and authenticate against the seeded test rows.

## ⚠ NOT FOR PRODUCTION USE

These secrets are committed to the repository. **They are intentionally
public.** They exist solely to make the Phase 1 smoke test deterministic
and reproducible across a clean machine.

- ❌ DO NOT use these values in any production or staging Supabase project.
- ❌ DO NOT copy these values into a `.env` shipped with the daemon installer.
- ❌ DO NOT promote any environment that has the `*_seed_phase1_test_data.sql`
  migration applied to a customer-facing role.
- ✅ DO use these values inside Plan 01-10's smoke script.
- ✅ DO use these values inside Plan 01-05's backend integration tests.
- ✅ DO regenerate fresh per-customer secrets via the org install flow when
  shipping production deployments (see Plan 01-09 MDM packaging).

The matching SQL migration (`20260531000007_seed_phase1_test_data.sql`) is
clearly tagged `DEV-AND-SMOKE-TEST ONLY. DO NOT APPLY TO PRODUCTION.` in its
header comment block. Phase 6's production-deployment docs (TBD) will instruct
operators to exclude it from `supabase db push`.

---

## Test Org

| Field                      | Value                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                       | `00000000-0000-0000-0000-000000000001`                                                               |
| `name`                     | `Phase 1 Test Org`                                                                                   |
| `install_secret` (plaintext) | `FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa`                                          |
| `install_secret_hash`      | sha256-hex of the plaintext (computed via Postgres `encode(digest(..., 'sha256'), 'hex')` in the seed) |
| `install_secret_expires_at` | `NOW() + INTERVAL '90 days'` at seed time                                                            |

The plaintext install_secret is what Plan 01-09 would normally ship inside an
MDM payload to org-managed devices. For Phase 1's smoke test, the daemon
embeds it directly so the enrollment endpoint accepts the call.

## Test User

| Field   | Value                                  |
| ------- | -------------------------------------- |
| `id`    | `00000000-0000-0000-0000-000000000002` |
| `email` | `test@fennec.local`                    |

Phase 1 does not require dev-OAuth attach for the smoke test (D-15: events
captured pre-attach are stored with `user_id_unknown = "unknown@${hostname}"`).
This user exists as the org admin and as a target for future Phase 3
attach-flow testing.

## Test Project

| Field    | Value                                  |
| -------- | -------------------------------------- |
| `id`     | `00000000-0000-0000-0000-000000000003` |
| `org_id` | `00000000-0000-0000-0000-000000000001` |
| `name`   | `Phase 1 Smoke Test Project`           |

Phase 1 only needs one default project per org per D-25 (no projects UX
ships in Phase 1).

## Test Daemon Machine

| Field         | Value                                  |
| ------------- | -------------------------------------- |
| `id`          | `00000000-0000-0000-0000-000000000004` |
| `org_id`      | `00000000-0000-0000-0000-000000000001` |
| `machine_id`  | `PHASE1_SMOKE_MACHINE`                 |
| `hostname`    | `phase1-host`                          |
| `os`          | `darwin`                               |

Plan 01-10's smoke script reuses this machine_id so the enrollment lookup
short-circuits to the pre-seeded row instead of running through the full
`POST /api/daemons/enroll` path. The daemon code (Plan 01-08) is exercised
end-to-end; the database row is pre-seeded for test stability.

## Test API Key

| Field                 | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| `id`                  | `00000000-0000-0000-0000-000000000005`                 |
| `org_id`              | `00000000-0000-0000-0000-000000000001`                 |
| `daemon_machine_id`   | `00000000-0000-0000-0000-000000000004`                 |
| Plaintext Bearer token | `fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd`      |
| `token_hash`          | sha256-hex of the plaintext (computed in the seed SQL) |

The smoke test (Plan 01-10) sets this plaintext token as the `Authorization:
Bearer ...` header on its `POST /v1/events` call. The backend (Plan 01-05)
hashes the incoming token and looks it up via `api_keys.token_hash` —
matching the seeded row. From there the backend stamps `org_id` and
`daemon_machine_id` on every event in the batch (per T-02-01 / Pattern 11).

## Usage

### Plan 01-05 — Backend integration tests

The Hono integration tests under `backend/test/` will compute the same hashes
in-test (using Web Crypto via `@fennec/shared/events/idempotency.ts`'s pattern
or the equivalent backend helper) so they can authenticate against the seeded
api_key:

```ts
const token = "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd";
const hash = await sha256Hex(token);
// expect supabase.from('api_keys').select().eq('token_hash', hash) → row id 005
```

### Plan 01-10 — End-to-end smoke test

The smoke script reads the plaintext directly from this file (or from an env
var that defaults to it) and uses it as the daemon's Bearer token. After the
daemon syncs, the smoke script queries Supabase for any row in
`ai_events` with `org_id = '00000000-0000-0000-0000-000000000001'`. A non-zero
count proves the daemon → backend → Supabase path works.

### Production deployments (Phase 6 onward)

Operators run `supabase db push` while explicitly **excluding** the seed
migration. The exact mechanic depends on Phase 6's deployment tooling
choice (Supabase migration tags vs. `psql -f` glob with an excluded
filename). The README under `supabase/migrations/` documents both
workflows.
