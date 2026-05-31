-- ING-06: git_events structure created in Phase 1; rows arrive in Phase 2
-- (CAP-09 git-watcher). Same partitioning model as ai_events so the operational
-- muscle is identical across both event tables.
--
-- The `event_type` CHECK constraint enumerates the four kinds the Phase 2
-- git-watcher emits. Adding a new event_type requires a coordinated schema
-- migration + adapter change (the validator in @fennec/shared/events/ holds
-- the same enum on the wire side).

CREATE TABLE git_events (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  user_id         UUID,                                    -- NULL until SSO attach (mirrors ai_events)
  occurred_at     TIMESTAMPTZ NOT NULL,
  repo_remote     TEXT,                                    -- nullable for un-pushed repos
  repo_branch     TEXT,
  event_type      TEXT NOT NULL CHECK (event_type IN ('commit', 'revert', 'file_edit', 'branch_switch')),
  payload         JSONB NOT NULL,
  schema_version  INTEGER NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Phase 1 creates one partition (current month) so the parent table is queryable
-- before Phase 2's adapter exists. Phase 2 onward extends the rolling window.
CREATE TABLE git_events_2026_05
  PARTITION OF git_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
