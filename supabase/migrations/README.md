# Fennec Supabase Migrations

Phase 1 Postgres schema for `fennec`. These migrations target Supabase Postgres
15+ (managed cloud or `supabase` CLI's local dev container).

## Why this matters

Every downstream plan depends on this schema being correct from day 1:

- Plan 01-05 (backend Hono) `INSERT`s into `ai_events` and looks up
  `api_keys.token_hash`.
- Plan 01-08 (daemon identity) writes the per-machine `api_key` returned by
  the enrollment endpoint.
- Plan 01-10 (smoke test) reads from `ai_events` using the seeded `org_id` to
  prove the daemon → backend → Supabase path works end-to-end.

Per CONTEXT.md D-26, **all customer-data tables are multi-tenant-correct from
day 1** (every row carries `org_id`, every table has RLS enabled). This cannot
be retrofitted without painful data migrations.

## Migration Order

The migrations are timestamped so they apply in lexicographic order — the
Supabase CLI and `psql -f` both respect this. **Do not reorder.**

1. **`20260531000001_orgs_users_keys.sql`** — Tenancy + identity tables
   (`orgs`, `users`, `org_members`, `projects`, `daemon_machines`, `api_keys`).
   `orgs.install_secret_hash` is hashed (sha256); `api_keys.token_hash` is
   hashed (sha256). Raw tokens never live in the database.

2. **`20260531000002_ai_events_partitioned.sql`** — `ai_events` parent table
   range-partitioned by `occurred_at` per ING-05. Includes monthly child
   partitions for the current month (`ai_events_2026_05`) and next month
   (`ai_events_2026_06`). PRIMARY KEY is `(idempotency_key, occurred_at)` so
   Plan 01-05's `ON CONFLICT DO NOTHING` dedupe works across the partitioned
   set.

3. **`20260531000003_git_events_partitioned.sql`** — `git_events` parent table
   range-partitioned by `occurred_at` per ING-06. One initial partition
   (`git_events_2026_05`); no rows arrive until Phase 2's git-watcher adapter
   (CAP-09).

4. **`20260531000004_adapter_heartbeats.sql`** — Heartbeats for CAP-14 / CAP-15.
   `events_parsed` and `parse_errors` are NOT NULL with CHECK `>= 0` so the
   "I'm alive with zero traffic" signal is unambiguous and the "missing field
   is a daemon bug" case fails at the database boundary.

5. **`20260531000005_daemon_audit_events.sql`** — Audit log for AUTH-14 (enroll),
   AUTH-16 (attach), and DAE-19 (uninstall) events. The `reason` CHECK
   constraint enumerates exactly the five valid reasons; new reasons require
   a future migration.

6. **`20260531000006_rls_policies.sql`** — RLS enabled on every customer-data
   table with a placeholder `org_id`-isolation policy. Phase 1 backend uses
   `service_role` (RLS bypass) with middleware-enforced `org_id`; these
   policies become load-bearing in Phase 3 when user-scoped tokens land.

7. **`20260531000007_seed_phase1_test_data.sql`** — DEV-AND-SMOKE-TEST seed
   data: one test org + user + project + machine + api_key with known
   plaintexts. The plaintexts are documented in
   `.planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md` and consumed by
   Plan 01-10's smoke script. **Skip this migration in production
   deployments** — see the file's header comment.

## Workflows

### Apply against the linked Supabase cloud project (production / staging)

```bash
supabase db push
```

This is the path Plan 01-10 takes as its `[BLOCKING]` task. It applies
migrations 1–6 by default; the seed migration 7 is dev-only and can be
excluded by filename or via Supabase's environment-tagging mechanism in
Phase 6.

### Apply against a local Supabase CLI Postgres (dev / integration tests)

```bash
supabase start          # spin up local Postgres on :54322
supabase db reset       # wipe + reapply all migrations including seed
```

`supabase db reset` is idempotent — the seed migration uses
`ON CONFLICT DO NOTHING` on every `INSERT`. Re-running it produces the same
state.

### Apply via raw `psql` (self-host single-Postgres deployments per
01-RESEARCH.md §Architectural Responsibility Map)

```bash
for f in supabase/migrations/202605310000*.sql; do
  psql -d fennec -f "$f"
done
```

Self-host deployments should **exclude** migration 7 unless they're running
the smoke test:

```bash
for f in supabase/migrations/202605310000{1,2,3,4,5,6}_*.sql; do
  psql -d fennec -f "$f"
done
```

## What this directory deliberately does NOT do

- No `INSERT` statements in migrations 1–5 (seed lives in 7 only).
- No `supabase db push` run in Plan 01-04. That ships in Plan 01-10 as a
  blocking task gated on a real Supabase project being provisioned.
- No `pg_cron` job for dynamic partition creation. Phase 1 explicitly creates
  the current + next month of `ai_events` partitions; Phase 2+ adds dynamic
  partition management per the Supabase blog recipe (see RESEARCH.md
  §Postgres partitioning recipe).
