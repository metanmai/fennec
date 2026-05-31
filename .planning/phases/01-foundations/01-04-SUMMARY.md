---
phase: 01-foundations
plan: 04
subsystem: supabase

tags:
  - supabase-postgres-15
  - range-partitioning
  - row-level-security
  - multi-tenant-day-1
  - sha256-hash-storage
  - pgcrypto
  - phase1-smoke-seed

# Dependency graph
requires:
  - 01-01 (monorepo + supabase CLI choice baked into RESEARCH.md / STACK.md)
provides:
  - "orgs / users / org_members / projects / daemon_machines / api_keys schema (multi-tenant correct from day 1 per D-26)"
  - "ai_events range-partitioned by occurred_at with monthly partitions for 2026-05 and 2026-06 (ING-05)"
  - "git_events range-partitioned by occurred_at with one initial partition for 2026-05 (ING-06)"
  - "adapter_heartbeats with required-not-optional events_parsed + parse_errors >= 0 (CAP-14)"
  - "daemon_audit_events with 5-value reason CHECK constraint (AUTH-14 / AUTH-16 / DAE-19)"
  - "RLS ENABLE + tenant-isolation CREATE POLICY on every customer-data table (D-26 / PITFALL P5)"
  - "Phase 1 smoke-test seed: 1 org + 1 user + 1 project + 1 machine + 1 api_key with known plaintexts (idempotent via ON CONFLICT DO NOTHING)"
  - "Authoritative plaintext register .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md (consumed by Plans 01-05 + 01-10)"
  - "supabase/config.toml + supabase/migrations/README.md scaffolding for `supabase db push` (Plan 01-10 [BLOCKING])"
affects:
  - 01-05 (backend Hono — INSERT INTO ai_events ON CONFLICT (idempotency_key, occurred_at) DO NOTHING; SELECT api_keys WHERE token_hash = sha256(bearer))
  - 01-08 (daemon identity — persists the per-machine api_key returned by /api/daemons/enroll)
  - 01-10 (smoke test — reads ai_events.org_id = seeded test org)
  - Phase 3 (RLS placeholders activate when user-scoped JWTs land)
  - Phase 2 (git_events table ready for CAP-09 git-watcher rows; dynamic partition cron extension)

# Tech tracking
tech-stack:
  added:
    - "pgcrypto extension (CREATE EXTENSION IF NOT EXISTS pgcrypto in the seed migration for digest('value','sha256'))"
  patterns:
    - "Timestamped migration ordering (20260531000001 … 20260531000007) so the Supabase CLI applies them deterministically and self-host `psql -f` glob ordering matches"
    - "Range partitioning by occurred_at on event tables with PRIMARY KEY (idempotency_key, occurred_at) — Postgres requirement that the partition column be in any unique constraint; doubles as the backend's ON CONFLICT clause"
    - "Partial UNIQUE index on api_keys.token_hash WHERE revoked_at IS NULL — hot-path lookup avoids scanning revoked history"
    - "RLS declared in Phase 1 even though service_role bypasses it — load-bearing in Phase 3 when user-scoped JWTs land; D-26 mandate that this cannot be retrofitted"
    - "sha256-hex hashing of secrets via Postgres-built-in encode(digest(value, 'sha256'), 'hex') in the seed migration — same hashing as the backend will perform on inbound Bearer tokens"
    - "ON CONFLICT DO NOTHING on every seed INSERT for `supabase db reset` idempotency"

key-files:
  created:
    - supabase/config.toml
    - supabase/migrations/README.md
    - supabase/migrations/20260531000001_orgs_users_keys.sql
    - supabase/migrations/20260531000002_ai_events_partitioned.sql
    - supabase/migrations/20260531000003_git_events_partitioned.sql
    - supabase/migrations/20260531000004_adapter_heartbeats.sql
    - supabase/migrations/20260531000005_daemon_audit_events.sql
    - supabase/migrations/20260531000006_rls_policies.sql
    - supabase/migrations/20260531000007_seed_phase1_test_data.sql
    - .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md
  modified: []

key-decisions:
  - "Migration ordering uses timestamped prefixes (20260531000001 .. 20260531000007) instead of integer prefixes so both Supabase CLI and `psql -f` glob expansion produce the correct order; matches Supabase's documented convention."
  - "ai_events PRIMARY KEY is (idempotency_key, occurred_at) — Postgres requires the partition column be in any unique constraint, and the composite doubles as Plan 01-05's ON CONFLICT clause for dedupe."
  - "Created two ai_events partitions (2026_05 and 2026_06) but only one git_events partition (2026_05). Rationale: ai_events ingestion lands traffic in Phase 1; git_events rows arrive only in Phase 2 (CAP-09), so one partition is enough to keep the parent queryable."
  - "RLS policy for users uses USING (TRUE) as a Phase 1 placeholder. The users table has no org_id column; Phase 3 will replace this with EXISTS (SELECT 1 FROM org_members ...) when cross-org user listing matters. Inline comment in the migration explains the deferral."
  - "RLS policy for orgs uses USING (id = (auth.jwt() ->> 'org_id')::uuid) since the orgs row IS the tenant — there is no separate org_id column on this table. The other 8 customer-data tables use the standard org_id = jwt.org_id pattern."
  - "Seed migration uses Postgres-built-in pgcrypto.digest() to compute sha256-hex hashes inside SQL, rather than precomputing hashes in the SUMMARY/docs. Benefit: a single source of truth (the plaintext); the hash always matches; future hash-algorithm changes touch only the SQL."
  - "api_keys.token_hash partial index `WHERE revoked_at IS NULL` keeps lookups fast as revocation history grows — the backend's hot path only ever checks active keys."
  - "daemon_audit_events.daemon_machine_id is NULLABLE without ON DELETE CASCADE so post-uninstall audit rows survive even after the daemon_machines row is removed by an admin sweep."

patterns-established:
  - "Every customer-data row carries org_id NOT NULL from day 1 (D-26 / PITFALLS P5). Retrofit-resistant by design."
  - "Hash-only storage for any user-visible secret (api_keys.token_hash, orgs.install_secret_hash). Raw values returned once at issuance and never again."
  - "Dev-vs-prod seed segregation via timestamp + header tag: the seed migration's filename includes `seed_phase1_test_data` and its header is a multi-line `DO NOT APPLY TO PRODUCTION` block. Phase 6 deployment docs will instruct exclusion."

requirements-completed:
  - ING-05
  - ING-06
  - AUTH-15

# Metrics
duration: ~4 min
completed: 2026-05-31
---

# Phase 1 Plan 04: Supabase schema migrations — orgs/users/keys, partitioned ai_events + git_events, adapter_heartbeats, daemon_audit_events, RLS policies, seed

**Seven ordered migrations** that establish the Phase 1 Postgres schema for fennec, with multi-tenant correctness (`org_id` on every customer-data row + RLS enabled) baked in from day 1 per D-26, ai_events / git_events range-partitioned by month per ING-05 / ING-06, and a reproducible seed for the Phase 1 smoke test.

## Performance

- **Duration:** ~4 min (260 s)
- **Started:** 2026-05-31T05:56:03Z
- **Completed:** 2026-05-31T06:00:23Z (approx)
- **Tasks:** 2 (both auto, no checkpoints, no TDD)
- **Commits:** 2 task commits + 1 docs commit (this SUMMARY)

## Accomplishments

- 7 ordered migration files under `supabase/migrations/`
  - 6 core schema migrations (`20260531000001` .. `20260531000006`)
  - 1 dev-only seed migration (`20260531000007`)
- Every customer-data table is `org_id NOT NULL` where applicable — multi-tenant correct from day 1 per D-26
- RLS `ENABLE` + `CREATE POLICY` on **all 10** customer-data tables: `orgs`, `users`, `org_members`, `projects`, `daemon_machines`, `api_keys`, `ai_events`, `git_events`, `adapter_heartbeats`, `daemon_audit_events`
- `ai_events` is range-partitioned on `occurred_at` with monthly partitions for the current month (`ai_events_2026_05`) and next month (`ai_events_2026_06`) — ING-05 satisfied
- `git_events` table exists with `PARTITION BY RANGE (occurred_at)` + one initial partition for 2026-05; ready for Phase 2 (CAP-09) to fill rows — ING-06 satisfied
- `api_keys.token_hash` is the sole storage column for issued Bearer tokens; raw tokens never persisted; partial UNIQUE index covers active keys only — AUTH-15 schema satisfied
- `orgs.install_secret_hash` + `orgs.install_secret_expires_at` cover the AUTH-14 server-side requirement
- `adapter_heartbeats` has `events_parsed` + `parse_errors` as `NOT NULL CHECK >= 0` — CAP-14 / PITFALL P3 zero-is-meaningful semantics enforced at the DB boundary
- `daemon_audit_events.reason` CHECK constraint enumerates exactly five reasons (`user_initiated`, `mdm_revoke`, `admin_initiated`, `attach_completed`, `enrollment_completed`) covering AUTH-14 + AUTH-16 + DAE-19
- Seed migration creates one test org + user + org_membership + project + daemon_machine + api_key with known plaintexts; all `INSERT`s wrapped in `ON CONFLICT DO NOTHING` so `supabase db reset` is idempotent
- `.planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md` documents the plaintexts for Plan 01-05 + Plan 01-10 with a bold `NOT FOR PRODUCTION USE` warning
- `supabase/config.toml` + `supabase/migrations/README.md` scaffold the `supabase` CLI workflow for Plan 01-10's `[BLOCKING] supabase db push`

## Task Commits

| # | Phase  | Hash      | Subject                                                                |
| - | ------ | --------- | ---------------------------------------------------------------------- |
| 1 | Task 1 | `3eacca2` | feat(01-04): add tenancy, partitioned events, heartbeat and audit schema migrations |
| 2 | Task 2 | `f683ccc` | feat(01-04): add RLS policies and Phase 1 smoke-test seed migration    |

Plan-metadata commit follows this SUMMARY.

## Files Created / Modified

### `supabase/`

- `config.toml` — `project_id = "fennec-phase1"` + `[db]` `port = 54322`
- `migrations/README.md` — ordered migration list + `supabase db push` / `supabase db reset` / raw `psql` workflows

### `supabase/migrations/`

- `20260531000001_orgs_users_keys.sql` — orgs, users, org_members, projects, daemon_machines, api_keys
- `20260531000002_ai_events_partitioned.sql` — partitioned ai_events + 2 child partitions + 2 indexes
- `20260531000003_git_events_partitioned.sql` — partitioned git_events + 1 child partition
- `20260531000004_adapter_heartbeats.sql` — adapter_heartbeats with CHECK constraints
- `20260531000005_daemon_audit_events.sql` — daemon_audit_events with 5-value reason CHECK
- `20260531000006_rls_policies.sql` — RLS ENABLE + CREATE POLICY on all 10 customer-data tables
- `20260531000007_seed_phase1_test_data.sql` — DEV-ONLY: one test tenant + idempotent `ON CONFLICT DO NOTHING`

### `.planning/phases/01-foundations/`

- `01-SCHEMA-TEST-DATA.md` — known plaintexts (install_secret + Bearer token) for Plans 01-05 + 01-10

## RLS Coverage

| #  | Table                  | RLS Enabled | Policy                                                                            |
| -- | ---------------------- | ----------- | --------------------------------------------------------------------------------- |
| 1  | `orgs`                 | YES         | `id = (auth.jwt() ->> 'org_id')::uuid`   *(orgs.id IS the tenant key)*           |
| 2  | `users`                | YES         | `USING (TRUE)` placeholder; Phase 3 replaces with `org_members` JOIN             |
| 3  | `org_members`          | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |
| 4  | `projects`             | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |
| 5  | `daemon_machines`      | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |
| 6  | `api_keys`             | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |
| 7  | `ai_events`            | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`   *(inherited by all partitions)*     |
| 8  | `git_events`           | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`   *(inherited by all partitions)*     |
| 9  | `adapter_heartbeats`   | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |
| 10 | `daemon_audit_events`  | YES         | `org_id = (auth.jwt() ->> 'org_id')::uuid`                                       |

**10 of 10** customer-data tables covered. Phase 1 backend uses `service_role` (RLS bypass); these policies activate the moment Phase 3 introduces user-scoped JWTs.

## Partition Strategy

| Parent Table | Partition Column | PK Shape                          | Phase 1 Partitions                            | Notes                                                 |
| ------------ | ---------------- | --------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| `ai_events`  | `occurred_at`    | `(idempotency_key, occurred_at)` | `ai_events_2026_05`, `ai_events_2026_06`     | Current + next month; partition column in PK per pg constraint; doubles as ON CONFLICT clause |
| `git_events` | `occurred_at`    | `(id, occurred_at)`               | `git_events_2026_05`                          | One partition is enough — rows don't arrive until Phase 2's CAP-09 git-watcher |

Phase 2+ will add a Supabase scheduled function to roll the window of monthly partitions forward (per RESEARCH.md §Postgres partitioning recipe). Phase 1 explicitly avoids `pg_cron` to keep the migration set minimal.

## Seed Data

The seed migration creates a single test tenant whose plaintexts are public (committed to the repository) and documented in `01-SCHEMA-TEST-DATA.md`:

| Entity            | UUID                                     | Notable Value                                                                 |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `orgs`            | `00000000-0000-0000-0000-000000000001`   | `install_secret_hash = sha256("FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa")` |
| `users`           | `00000000-0000-0000-0000-000000000002`   | `email = test@fennec.local`                                                   |
| `org_members`     | (composite PK)                           | `role = admin`                                                                |
| `projects`        | `00000000-0000-0000-0000-000000000003`   | `name = "Phase 1 Smoke Test Project"`                                         |
| `daemon_machines` | `00000000-0000-0000-0000-000000000004`   | `machine_id = PHASE1_SMOKE_MACHINE`, `os = darwin`                            |
| `api_keys`        | `00000000-0000-0000-0000-000000000005`   | `token_hash = sha256("fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd")`     |

Every `INSERT` uses `ON CONFLICT (id) DO NOTHING` (or the matching unique key for `org_members`) so the seed can be reapplied — `supabase db reset` works without error.

The seed migration's filename contains `seed_phase1_test_data` and its header begins with `DEV-AND-SMOKE-TEST ONLY. DO NOT APPLY TO PRODUCTION.` Phase 6 deployment docs (TBD) will instruct operators to exclude this file from `supabase db push`. The `01-SCHEMA-TEST-DATA.md` companion has a top-level **`⚠ NOT FOR PRODUCTION USE`** header.

## Decisions Made

(Mirrored in the frontmatter `key-decisions` block for STATE.md ingestion.)

1. **Timestamped migration ordering (`20260531000001` … `20260531000007`).** Matches the documented Supabase CLI convention; works with both `supabase db push` and `psql -f` glob expansion. The 7-zero-padded timestamp + suffix ordering keeps related migrations grouped.

2. **`ai_events` PRIMARY KEY = `(idempotency_key, occurred_at)`.** Postgres requires the partition column be in any unique constraint. The composite doubles as Plan 01-05's `ON CONFLICT (idempotency_key, occurred_at) DO NOTHING` clause — the `occurred_at` portion is for partition routing, not collision resistance (which is provided by the 128-bit `idempotency_key` per the CanonicalEvent contract from Plan 01-02).

3. **Two `ai_events` partitions, one `git_events` partition.** ai_events ingests traffic from day 1 of Phase 1 (Plan 01-10 smoke test); git_events sits empty until Phase 2's CAP-09 git-watcher. One partition is enough to keep the parent queryable; more would be ceremony.

4. **`users` table RLS policy uses `USING (TRUE)`.** Users has no `org_id` column — the cross-org user policy that Phase 3 needs requires a `EXISTS (SELECT 1 FROM org_members WHERE ...)` JOIN that's premature here. Inline comment in the migration documents the deferral.

5. **`orgs` table RLS policy uses `id = jwt.org_id`.** Special case — the `orgs` row IS the tenant identity; there is no separate `org_id` column.

6. **Hashes computed in SQL via `pgcrypto.digest()`, not precomputed and pasted as constants.** Single source of truth: the plaintext lives in the SQL, the hash is derived from it. Future hash-algorithm changes touch only the SQL. The seed `CREATE EXTENSION IF NOT EXISTS pgcrypto;` is explicit even though Supabase enables it by default.

7. **Partial UNIQUE index on `api_keys.token_hash WHERE revoked_at IS NULL`.** Backend's bearer-auth hot path only ever checks active keys; the partial index keeps lookup fast as revocation history grows.

8. **`daemon_audit_events.daemon_machine_id` is NULLABLE without `ON DELETE CASCADE`.** Post-uninstall audit rows must survive after the daemon_machines row is deleted by an admin sweep.

## Deviations from Plan

None. The plan executed verbatim:

- Both tasks completed without ambiguity.
- No checkpoints to wait on (the plan is purely SQL authoring; no live Supabase needed at this stage — `supabase db push` is the `[BLOCKING]` task in Plan 01-10).
- No auth gates (this plan does not touch any external service).
- No analysis-paralysis loops; the interfaces block in the plan was the schema spec, and the migrations transcribed it.
- The pre-commit hook (`husky` + `lint-staged` running biome) fired on both task commits — biome reformatted nothing material (one `.md` was touched by biome's lint:fix pass; final state matches written intent).
- Plan's acceptance criteria + overall verification both pass:
  - 7 migrations in `supabase/migrations/`
  - 10 `ENABLE ROW LEVEL SECURITY` + 10 `CREATE POLICY` in migration 6
  - `PARTITION BY RANGE` in migrations 2 and 3
  - `ai_events_2026_05` + `ai_events_2026_06` + `git_events_2026_05` present
  - `token_hash` + `install_secret_hash` + `install_secret_expires_at` + `events_parsed >= 0` + `mdm_revoke` all present
  - Seed migration includes plaintext token + `ON CONFLICT` + `DO NOT APPLY TO PRODUCTION` warning
  - `01-SCHEMA-TEST-DATA.md` contains test UUID `00000000-0000-0000-0000-000000000001` + `NOT FOR PRODUCTION` warning

## Known Stubs

| File                                                            | Why it's a stub                                                                                                                                                | Resolved by                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `supabase/migrations/20260531000006_rls_policies.sql` (users)   | `USING (TRUE)` placeholder policy on the `users` table — no `org_id` column on this table; the Phase 3 policy needs an `org_members` JOIN that's premature. Inline comment in the SQL documents the planned replacement. | Phase 3 RLS hardening plan (when user-scoped JWTs land)              |

This stub is **intentional** and tracked here per the deviation rules. Phase 1 backend uses `service_role` (RLS bypass) anyway, so the placeholder cannot create a real isolation gap in Phase 1.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| (none) | — | All security-relevant surface added (RLS placeholders, hash-only storage, dev-only seed) was in the plan's `<threat_model>` register; no NEW threats were introduced beyond what Plan 01-04 specified. |

The seed migration's dev-only nature (T-04-06) is mitigated by:
- Filename embeds `seed_phase1_test_data`
- Header is a multi-line `DEV-AND-SMOKE-TEST ONLY. DO NOT APPLY TO PRODUCTION.` block
- Companion `01-SCHEMA-TEST-DATA.md` has a bold `⚠ NOT FOR PRODUCTION USE` header
- README under `supabase/migrations/` documents how to exclude it from `psql -f` glob expansion

## Issues Encountered

- None of note. Pre-commit hooks ran cleanly on both task commits. Biome's lint pass touched one `.md` file but no material reformatting was applied.
- `pgcrypto` extension was assumed-default on Supabase (per Supabase docs it's pre-installed on managed projects); the seed migration uses `CREATE EXTENSION IF NOT EXISTS pgcrypto;` defensively so self-host setups and `supabase db reset` from cold work too.

## Deferred Items

| Item                                                                                          | Rationale                                                                                                                                                              | Picked up by                                                                                                |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Dynamic monthly partition creation (`pg_cron` or Supabase scheduled function) for `ai_events` | Plan 01-04 explicitly creates current + next month; rolling window automation is Phase 2 scope per the Supabase blog recipe in RESEARCH.md.                            | Phase 2 (paired with the CAP-09 git-watcher rollout or the first analysis-worker plan that ingests at volume) |
| Production seed-exclusion mechanic (Supabase migration tags vs `psql -f` exclude)             | Phase 1's job is to ship the seed file with a clear DEV-ONLY warning; the deployment tooling choice belongs to Phase 6.                                                | Phase 6 deployment plan                                                                                     |
| `users` table cross-org RLS via `org_members` JOIN                                            | Phase 1 backend is `service_role` (RLS bypass); user-scoped JWTs land in Phase 3.                                                                                       | Phase 3 RLS hardening plan                                                                                  |
| Local `supabase start` workflow exercised end-to-end                                          | The plan's W-2 warning notes that Plan 01-05's backend integration tests will need a local Supabase. Plan 01-04 documents the workflow in `supabase/migrations/README.md` and ships `config.toml`; the actual `supabase start` happens for the first time in Plan 01-05. | Plan 01-05                                                                                                  |
| `playwright@1.49.1` SSL vulnerability (carried from Plan 01-01)                               | Pre-existing; out of scope for this plan.                                                                                                                              | Plan 01-10 or Phase 5                                                                                       |

## Next Plan Readiness

Plan 01-04 is fully released. The next plans in the wave sequence (Wave 2 also includes 01-03 currently in-flight; Wave 3 is 01-05 / 01-06 / 01-07) can:

- **Plan 01-05 (backend Hono):** import `EventBatchSchema`, `EnrollRequestSchema` from `@fennec/shared` (Plan 01-02) and write to the `ai_events` partitioned table created here. Its `ON CONFLICT (idempotency_key, occurred_at) DO NOTHING` path will hit the composite PK. Its bearer-auth middleware will look up `api_keys.token_hash` via the partial index. Its integration tests will use the seeded test tenant from `01-SCHEMA-TEST-DATA.md`.

- **Plan 01-08 (daemon identity):** the `api_key` returned by `POST /api/daemons/enroll` (which Plan 01-05 builds) lands in the `api_keys` table created here. Daemon-side storage is system-protected (`/var/db/fennec/key`, etc.) per CONTEXT.md "Claude's Discretion".

- **Plan 01-10 (smoke test):** the `[BLOCKING] supabase db push` task runs migrations 1–7 (or 1–6 + a hand-applied seed). The smoke script reads the plaintext API key from `01-SCHEMA-TEST-DATA.md` and POSTs events to the backend.

Nothing in Plan 01-04 blocks the rest of Phase 1.

## Self-Check

- `supabase/config.toml`: FOUND
- `supabase/migrations/README.md`: FOUND
- `supabase/migrations/20260531000001_orgs_users_keys.sql`: FOUND
- `supabase/migrations/20260531000002_ai_events_partitioned.sql`: FOUND
- `supabase/migrations/20260531000003_git_events_partitioned.sql`: FOUND
- `supabase/migrations/20260531000004_adapter_heartbeats.sql`: FOUND
- `supabase/migrations/20260531000005_daemon_audit_events.sql`: FOUND
- `supabase/migrations/20260531000006_rls_policies.sql`: FOUND
- `supabase/migrations/20260531000007_seed_phase1_test_data.sql`: FOUND
- `.planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md`: FOUND
- Commit `3eacca2` (Task 1): FOUND in `git log --oneline -4`
- Commit `f683ccc` (Task 2): FOUND in `git log --oneline -4`
- `ls supabase/migrations/*.sql | wc -l` = 7 ✓
- `grep -c "ENABLE ROW LEVEL SECURITY" supabase/migrations/20260531000006_*.sql` = 10 ✓
- `grep -c "CREATE POLICY" supabase/migrations/20260531000006_*.sql` = 10 ✓
- `grep -q "PARTITION BY RANGE" supabase/migrations/20260531000002_*.sql` ✓
- `grep -q "PARTITION BY RANGE" supabase/migrations/20260531000003_*.sql` ✓
- `grep -q "ai_events_2026_05" supabase/migrations/20260531000002_*.sql` ✓
- `grep -q "ai_events_2026_06" supabase/migrations/20260531000002_*.sql` ✓
- `grep -q "git_events_2026_05" supabase/migrations/20260531000003_*.sql` ✓
- `grep -q "FENNEC_TEST_INSTALL_SECRET_PHASE1" supabase/migrations/20260531000007_*.sql` ✓
- `grep -q "ON CONFLICT" supabase/migrations/20260531000007_*.sql` ✓
- `grep -q "DO NOT APPLY TO PRODUCTION" supabase/migrations/20260531000007_*.sql` ✓
- `grep -q "00000000-0000-0000-0000-000000000001" .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md` ✓
- `grep -q "NOT FOR PRODUCTION" .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md` ✓

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31*
