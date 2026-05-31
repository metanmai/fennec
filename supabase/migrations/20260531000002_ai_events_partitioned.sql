-- ING-05: ai_events range-partitioned by month on occurred_at.
-- Phase 2+ adds dynamic partition creation per Supabase blog
-- (https://supabase.com/blog/postgres-dynamic-table-partitioning). Phase 1
-- creates the current + next month explicitly so all of Phase 1's smoke +
-- integration tests land in valid partitions.
--
-- Schema alignment with @fennec/shared (Plan 01-02):
--   • idempotency_key     — TEXT (32-char sha256 hex per CanonicalEvent contract)
--   • payload             — JSONB; per-tool shape lives in @fennec/shared/events/
--                           claude-code-payload.ts and similar future files
--   • schema_version      — bumped together with the Zod literal in shared
--   • user_id_unknown     — set to "unknown@${hostname}" pre-attach; backend
--                           backfills user_id on first SSO attach (D-15)
--
-- ANL-06 / PITFALL P6 alignment: the four Anthropic Usage fields live inside
-- payload (per AnthropicUsageSchema in shared); the canonical shape does NOT
-- aggregate them at capture time. Plan 01-06 deals with totals.
--
-- PRIMARY KEY shape: Postgres requires the partition column be in any unique
-- constraint. So PK is (idempotency_key, occurred_at) — Plan 01-05's backend
-- `INSERT ... ON CONFLICT (idempotency_key, occurred_at) DO NOTHING` is the
-- exact dedupe path. Collision space is 128-bit hex per CanonicalEvent — the
-- timestamp suffix is for partition routing, not collision resistance.

CREATE TABLE ai_events (
  idempotency_key         TEXT NOT NULL,
  org_id                  UUID NOT NULL,
  user_id                 UUID,                            -- NULL until SSO attach
  user_id_unknown         TEXT,                            -- "unknown@${hostname}" pre-attach
  tool                    TEXT NOT NULL,                   -- claude_code | codex | cursor | copilot | gemini | chatgpt | claude_web | git
  occurred_at             TIMESTAMPTZ NOT NULL,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload                 JSONB NOT NULL,
  schema_version          INTEGER NOT NULL,
  redaction_applied_at    TIMESTAMPTZ NOT NULL,
  redaction_version_hash  TEXT NOT NULL,
  hostname                TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Monthly partitions: current + next. Phase 2+ Supabase cron creates the rolling window.
CREATE TABLE ai_events_2026_05
  PARTITION OF ai_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE ai_events_2026_06
  PARTITION OF ai_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Indexes are inherited by every partition created on the parent.
CREATE INDEX idx_ai_events_org_occurred
  ON ai_events (org_id, occurred_at);

CREATE INDEX idx_ai_events_user_occurred
  ON ai_events (user_id, occurred_at)
  WHERE user_id IS NOT NULL;
