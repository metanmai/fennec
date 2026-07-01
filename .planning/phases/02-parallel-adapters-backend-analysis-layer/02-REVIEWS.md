---
phase: 02-parallel-adapters-backend-analysis-layer
updated: 2026-07-01
review_cycles: 1
---

# Phase 2 — Adversarial Review Ledger

Parallel Opus lens panel (correctness · risk · requirement-coverage · security · simplicity),
each refuting the full plan set (02-01…02-10) from disk. HIGH counted from return lines.

## Cycle 1 — HIGH=28 (correctness 8 · risk 7 · req-coverage 3 · security 7 · simplicity 3)

Deduplicated into distinct consensus concerns below. `[lenses]` = which lenses raised it.
Every HIGH must be addressed by the replan or explicitly deferred-with-reason to OPEN-QUESTIONS.

### HIGH consensus issues

- **H1 · Partition coverage gap — blocks ALL live-capture acceptance** `[correctness, risk, req-coverage]`
  `ai_events` partitions end 2026-07-01 (exclusive); `git_events` ends 2026-06-01. Today is 2026-07-01, so every
  current-dated insert throws "no partition of relation found." Plan 04 copies the same `_2026_05/_2026_06` window
  for the new partitioned `prompt_outcomes`/`model_fit_scores`, propagating it. No rolling-partition mechanism exists.
  **Fix:** Plan 04 adds a migration creating current+next-month (and a DEFAULT/rolling) partitions for `ai_events`,
  `git_events`, `prompt_outcomes`, `model_fit_scores`; add a pg_cron/pg_partman-style rolling helper or documented
  monthly partition-ahead task; make "partition covers build window" a blocking pre-capture gate.

- **H2 · Single BridgeEventsAdapter cannot emit 3 distinct tools** `[correctness]`
  The registry builds the canonical event from the fixed `adapter.tool` field and keys the heartbeat counter by it;
  `EmitInput.tool` from the normaliser is discarded. So one bridge adapter tags copilot/chatgpt-web/claude-ai-web all
  the same → breaks CAP-06/07/08 tool tagging. **Fix (Plan 01):** register THREE bridge adapters (one per tool,
  each filtering the `source` it handles) OR change the registry/build path to honor a per-event `tool`. Pick the
  3-adapter path (no registry contract change) unless a POC proves the registry change is clean.

- **H3 · Revert-downgrade (ANL-03) unreachable as designed** `[correctness, risk, req-coverage]`
  (a) enqueue message body `{idempotency_key,occurred_at,org_id,tool}` carries no `event_type`; (b) git enqueue is
  marked "optional/Claude's Discretion"; (c) `git_events` has no `idempotency_key` column so the consumer can't load
  a git row by `(idempotency_key,occurred_at)`; (d) matching a revert to a prompt within ±15 min is wrong — a revert
  lands hours-to-days after the prompt→commit, so the window never catches it (false-green unit test).
  **Fix (Plan 06 + Plan 01):** make git enqueue MANDATORY; carry `event_type` + the git row key in the message
  envelope; the revert path matches the *reverted commit* (parse `Revert "<subject>"`/SHA), finds the
  `prompt_outcomes` row via `git_event_id` regardless of age, and downgrades it. Decouple from the ±15-min prompt join.

- **H4 · ai_events lacks repo/branch/cwd/project + user linkage → correlation & rollups degenerate** `[correctness, req-coverage]`
  `insertAiEvent` drops `cwd`/`git_remote`/`git_branch`; ai_events has no project column and `user_id` is NULL this
  phase. So: the correlation "same repo/branch → high confidence" rule has no ai_events side; `daily_rollups_by_project`
  (`project_id NOT NULL`, UNIQUE `(org_id,project_id,day)`) has no derivable project; per-user rollups collapse to one
  NULL row. **Fix:** persist `repo_remote`/`repo_branch`/`cwd` on ai_events (schema ALTER in Plan 04 + ingest in Plan 01);
  define a minimal repo→project derivation (from `repo_remote`) OR make `project_id` nullable/default-project for now
  and log the maturation to Phase 3/4; group user rollups by `user_id_unknown` when `user_id` is NULL (Plan 07).

- **H5 · git_events idempotency via "deterministic UUID" is unspecified & unvalidated** `[correctness, risk, security, simplicity]`
  PK `(id, occurred_at)`, `id DEFAULT gen_random_uuid()`, no `idempotency_key` column → retries duplicate git rows,
  skewing correlation/rollups. Derivation hand-waved, zero EVIDENCE. **Fix (Plan 04 + Plan 01):** SIMPLEST — add an
  `idempotency_key TEXT` column to `git_events` (matches the ai_events dedupe idiom) with a unique/ON-CONFLICT target;
  OR mandate UUIDv5 over `(org_id, idempotency_key)` and add a PROVEN EVIDENCE entry + retry-produces-one-row test.
  Pin how the git adapter derives a stable idempotency key per reflog entry.

- **H6 · Loopback `/v1/events` browser trust model is mis-scoped (confused-deputy / localhost-CSRF / DNS-rebind)** `[security]`
  The route is copied from the Phase-1 hook-shim (Pattern 9), whose "external can't reach 127.0.0.1" reasoning
  collapses once a browser is in scope — ANY visited page can POST to `127.0.0.1:<port>/v1/events`. No
  `Origin`/`Sec-Fetch-Site`/`Content-Type` validation; token compare is non-constant-time `!==`; secret file is 0644
  (world-readable); request body is unbounded (DoS). **Fix (Plan 01):** Origin/Sec-Fetch-Site allowlist; require
  `Content-Type: application/json` (forces CORS preflight a page can't satisfy); `crypto.timingSafeEqual` on
  length-checked buffers; tighten secret to 0600; enforce a max body size (413 over N KB). Add STRIDE rows for each.

- **H7 · MV3 world:MAIN content script — hostile-page tampering not modeled** `[security]`
  In `world:MAIN`, ChatGPT/Claude.ai page JS (or XSS on those origins) shares the realm with the monkeypatched
  fetch/XHR and `chrome.runtime.sendMessage`; it can feed forged prompts or read the captured buffer. STRIDE only
  covers anti-bot *detection*. **Fix (Plan 10):** add tampering/spoofing STRIDE row; minimize state held in MAIN world;
  validate messages on the SW side; treat all MAIN-world input as untrusted.

- **H8 · RLS "tenant isolation" overstated: USING-only (no WITH CHECK); workers write as service_role** `[security, req-coverage, simplicity]`
  New analysis tables' isolation is attributed to RLS, but the copied policy is `USING`-only (no write-side
  constraint) and Phase-2 workers run as service_role (RLS bypassed). `model_pricing` ships `org_id NOT NULL` +
  tenant RLS + a "global sentinel org_id so all tenants read the same prices" — self-contradicting (a tenant JWT never
  matches the sentinel; user reads return zero rows). **Fix (Plan 04):** add `WITH CHECK (org_id = …)` to every new
  customer-data policy; correct STRIDE registers to name app-layer `org_id` derivation (from the source row, with a
  test) as the true mitigation; make `model_pricing` a plain reference table with a read-any policy (`USING (true)`)
  and drop the sentinel machinery.

- **H9 · Cross-tenant write via forged/replayed queue message (model-fit trusts body org_id)** `[security]`
  Correlation re-fetches org_id from the source row, but `runModelFit(msg.body)` uses the message-body `org_id`; an
  at-least-once replayed/poisoned message with a swapped org_id writes `model_fit_scores` under the wrong tenant.
  **Fix (Plan 06):** BOTH functions ignore body org_id for tenancy and re-read from the persisted event; body org_id
  is a routing hint only; add a test.

- **H10 · DLQ configured but no consumer → silent analysis loss + poison amplification** `[risk]`
  `dead_letter_queue` set, nothing drains it. Combined with H1, every message today is poison (row failed to insert →
  retry 3× → DLQ → never correlated/scored), with no monitoring/replay. **Fix (Plan 06):** add a DLQ consumer (or a
  monitored/alerted drain + manual replay path); make the correlation/model-fit consumer treat "row not yet visible"
  as a transient retry, not a hard failure.

- **H11 · Insert-then-enqueue durability gap + placement contradiction + read-after-write** `[risk, simplicity]`
  Enqueue is placed per-event inside the ingest loop (contradicts RESEARCH C7.5 "after the loop"); if `send` throws
  after `insertAiEvent` succeeds, the row persists but is never enqueued, and retry's `ON CONFLICT DO NOTHING` (0 rows)
  skips the re-enqueue → event never analyzed. Per-event `send` also ignores `sendBatch`. Consumer re-fetch has no
  read-after-write guarantee under Hyperdrive. **Fix (Plan 06):** enqueue unconditionally on idempotency_key (or add a
  reconcile sweep for ai_events lacking outcome/fit rows); use one `sendBatch` after the loop; consumer treats
  row-not-found as transient retry.

- **H12 · Unvalidated load-bearing claims lacking PROVEN/STATIC EVIDENCE** `[all lenses — CRITICAL RULE]`
  - Cloudflare `queue()`/`scheduled()` handlers + `MessageBatch`/`ScheduledController` typings compile against pinned
    `@cloudflare/workers-types`; module-worker `{fetch,queue,scheduled}` export (C15 proved only the wrangler config).
    **Fix:** add a STATIC-VALIDATED POC (typecheck a minimal `{fetch,queue,scheduled}` module).
  - Cursor WAL-mtime fires on a new prompt + tail-offset dedupe (Q10 UNVERIFIED). **Fix:** POC or downgrade the
    once-only-emission must_have to a build-time manual check; implement copy-then-read on lock (not a TODO).
  - Gemini live transcript schema / `$set` snapshot (C40 REFUTED-partial / UNVERIFIABLE). **Fix:** build-time-gate the
    Gemini normaliser shape; diff by stable message id not ordinal count.
  - Deterministic-UUID git derivation (see H5). Interval-cast join SQL (add a STATIC entry or bind `$n` interval).
  - MV3 monkeypatch viability (C39 UNVERIFIABLE — already parked): change plan disposition from "mitigate" to
    defer-gated/manual; do not assert it in must_haves.

- **H13 · In-memory tail offsets/watermark → replay-or-loss on daemon restart** `[risk]`
  Codex/Gemini/git offsets + Cursor `createdAt` watermark are in-memory; restart → whole-file re-parse (mass dupes) or
  reset-to-EOF (lost events during downtime). **Fix (Plans 02/03):** persist offsets/watermark to a sync-state file
  (as the Phase-1 queue watermark does); test the restart path both directions.

- **H14 · Aggregator cron has no run-lock (overlap race)** `[risk]`
  A slow run overlapping the next tick (or a manual re-trigger) yields concurrent full-day upserts racing on the same
  `(org_id,*,day)` rows. **Fix (Plan 07):** per-day advisory lock / idempotent single-flight; add a staging-data
  reconciliation check distinct from the mocked unit test.

- **H15 · ROADMAP plan enumeration omits 02-08/09/10 + count self-contradiction** `[req-coverage]`
  ROADMAP header says "10 plans" but the listing says "7 plans" and enumerates only 02-01..07; the daemon-wiring step
  (02-08) and CAP-06/07/08 client plans (02-09/10) are invisible at roadmap level. **Fix:** reconcile the ROADMAP
  Phase-2 plan listing to all 10 plans across their waves.

### Notable MEDIUM / LOW (address opportunistically; not gating)
- Confidence-interval CHECK `confidence_low <= confidence_high` admits equality (degenerate = single number); ANL-02
  claims it "rejects a bare single number" — tighten to `<` or document equality is allowed. `[correctness]`
- Extension workspaces (`vscode-extension/`, `browser-extension/`) lack explicit isolated `tsc --build` project
  references → excluded from the typecheck gate or leak `@types/chrome`/`@types/vscode` globals. `[correctness]`
- Pairing-token distribution contradicts across plans: 09/10 say `fennec inspect` prints the token, but Plan 05 is
  read-only and never prints a secret; secret is root-owned 0644. Define a dedicated least-privilege `fennec pair`/
  `token` command. `[security]`
- Supply-chain: every "new npm install" row asserts "official package" with no pin/lockfile/integrity/`--ignore-scripts`
  posture, for a tool that reads developer prompts. Add a pinning/`--ignore-scripts` note. `[security]`
- MV3 service-worker kill can drop an in-flight `sendMessage` before it hits `chrome.storage.local`; add content-script
  retry + cold-SW test. `chrome.storage.local` drop-oldest = silent capture loss; surface a dropped-count. `[risk]`
- `fennec inspect` 24h window filters on client-supplied `occurred_at` (stale/backfilled events hidden) — filter on a
  receipt/append timestamp or show both. `[risk]`
- Subscription→entity attribution undefined (no per-seat table) → `cost_subscription` per-user is a guess; scope to an
  org-level line this phase. GPT pricing/tier seed rows are speculative (no surface reliably supplies GPT tokens);
  seed only Anthropic where the 4 token fields are proven. `[req-coverage, simplicity]`
- git `file_edit` detection is the lowest-confidence event_type + a second watch path; implement as a debounced
  `git status --porcelain` poll. `[simplicity]`
- Plan 01 bundles 4 concerns (deps + shared types + bridge route + git ingest) and is the 7-of-10 critical-path
  bottleneck; consider splitting pure-type authoring from bridge+git work. `[simplicity]`
- `correlation-and-model-fit.ts` wrapper module exists only for a hypothetical Cloudflare multi-consumer future; inline
  it. `[simplicity]`
- RESEARCH/PATTERNS say `extension/` while plans use `browser-extension/` (Q19) — reconcile the name. `[simplicity]`
