-- CAP-14 + CAP-15: heartbeats with events_parsed + parse_errors + schema_hash.
--
-- Required-not-optional counters per Plan 01-02 design:
--   • events_parsed  — zero is a meaningful "I'm alive with no traffic" signal
--   • parse_errors   — zero means the adapter is healthy; >0 trips CAP-15 drift
--                       detection
-- Either field being NULL would be a daemon bug; the NOT NULL + CHECK >= 0
-- constraints catch this at the database boundary (defence in depth: the Zod
-- schema in @fennec/shared/events/heartbeat.ts is the primary catch).
--
-- daemon_unreachable_count counts "shim fired but daemon was down" events
-- per D-23 (fail-open). The hook shim emits these on its next successful
-- contact so the dashboard surfaces lost-during-downtime windows.
--
-- idempotency_key is UNIQUE (not part of a composite PK like ai_events) because
-- this table is NOT partitioned — heartbeat volume is bounded per daemon
-- (~1/minute) and there's no need for monthly range partitioning.

CREATE TABLE adapter_heartbeats (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL,
  daemon_machine_id         UUID NOT NULL REFERENCES daemon_machines(id) ON DELETE CASCADE,
  adapter                   TEXT NOT NULL,                  -- claude_code | codex | cursor | ...
  adapter_version           TEXT NOT NULL,
  schema_hash               TEXT NOT NULL,                  -- CAP-15 upstream drift fingerprint
  events_parsed             INTEGER NOT NULL CHECK (events_parsed >= 0),
  parse_errors              INTEGER NOT NULL CHECK (parse_errors >= 0),
  daemon_unreachable_count  INTEGER NOT NULL DEFAULT 0 CHECK (daemon_unreachable_count >= 0),
  interval_start            TIMESTAMPTZ NOT NULL,
  interval_end              TIMESTAMPTZ NOT NULL,
  received_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version            INTEGER NOT NULL,
  idempotency_key           TEXT NOT NULL UNIQUE            -- prevent double-recording of same interval
);
