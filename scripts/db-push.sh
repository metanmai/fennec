#!/usr/bin/env bash
#
# scripts/db-push.sh — Apply Phase 1 Supabase migrations against the
# linked Supabase Postgres project.
#
# Wraps `supabase db push` with a friendly preflight, a clear error
# message when SUPABASE_ACCESS_TOKEN is missing, and optional one-shot
# project linking when SUPABASE_PROJECT_REF is set.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   Personal Access Token from
#                           https://supabase.com/dashboard/account/tokens
#
# Optional env:
#   SUPABASE_PROJECT_REF    Project reference (e.g. abcdefghijklmnop).
#                           When set, runs `supabase link --project-ref
#                           ${SUPABASE_PROJECT_REF}` before pushing so
#                           a clean machine does not need a prior
#                           `supabase link` invocation.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=<token>
#   export SUPABASE_PROJECT_REF=<ref>          # optional
#   bash scripts/db-push.sh
#
# Read by: .planning/phases/01-foundations/01-10-PLAN.md Task 2.
# Threat: T-10-02 (token in shell env, never persisted to disk by this
# script; never echoed; SUPABASE_PROJECT_REF is safe to log but the
# access token is NEVER echoed by this script).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  cat >&2 <<'EOF'
error: SUPABASE_ACCESS_TOKEN is not set.

To generate one:
  1. Open https://supabase.com/dashboard/account/tokens
  2. Click "Generate new token" — name it "fennec-cli" or similar
  3. Copy the token, then:
       export SUPABASE_ACCESS_TOKEN=<paste>
  4. (Optional) set SUPABASE_PROJECT_REF if you want this script to
     run `supabase link --project-ref <ref>` for you.
  5. Re-run this script.

The token is read from your shell environment ONLY — this script
never writes it to disk or echoes it.
EOF
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: `supabase` CLI is not on PATH.

Install via Homebrew:
  brew install supabase/tap/supabase

Or follow https://supabase.com/docs/guides/cli for other platforms.
EOF
  exit 1
fi

if [ ! -d "${MIGRATIONS_DIR}" ]; then
  printf 'error: migrations dir not found at %s\n' "${MIGRATIONS_DIR}" >&2
  exit 1
fi

# Record migration-set integrity in the smoke log (T-10-01 mitigation).
# This prints the SHA-256 of the migrations directory tarball so the
# operator can confirm the same set was applied that lives in the repo.
MIGRATION_SHA="$(cd "${MIGRATIONS_DIR}" && find . -type f -name '*.sql' \
  | LC_ALL=C sort \
  | xargs shasum -a 256 \
  | shasum -a 256 \
  | awk '{print $1}')"

printf 'fennec db-push — preflight\n'
printf '  Repo root:          %s\n' "${REPO_ROOT}"
printf '  Migrations dir:     %s\n' "${MIGRATIONS_DIR}"
printf '  Migrations SHA-256: %s\n' "${MIGRATION_SHA}"
if [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  printf '  Project ref:        %s\n' "${SUPABASE_PROJECT_REF}"
fi
printf '  Access token:       (set, %d chars; not echoed)\n' "${#SUPABASE_ACCESS_TOKEN}"

if [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  printf '\nLinking project %s ...\n' "${SUPABASE_PROJECT_REF}"
  supabase link --project-ref "${SUPABASE_PROJECT_REF}"
fi

printf '\nApplying migrations (supabase db push --include-all) ...\n'
supabase db push --include-all

printf '\nAll migrations applied. To verify in psql or Supabase Studio:\n'
printf '  SELECT id, name FROM orgs WHERE id = '\''00000000-0000-0000-0000-000000000001'\'';\n'
printf '  SELECT id, email FROM users WHERE id = '\''00000000-0000-0000-0000-000000000002'\'';\n'
printf '  \\dt+ ai_events*    -- should list parent + monthly partitions\n'
printf '  \\d ai_events       -- should show "Row security: enabled"\n'
