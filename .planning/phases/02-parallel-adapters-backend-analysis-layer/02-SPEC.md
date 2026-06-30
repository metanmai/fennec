# Phase 2: Parallel Adapters + Backend Analysis Layer — Specification

**Created:** 2026-07-01
**Ambiguity score:** 0.178 (gate: ≤ 0.20)
**Requirements:** 16 locked
**Mode:** `--auto` — derived from ROADMAP.md + REQUIREMENTS.md + Phase 1 decisions (D-16, D-17, D-27); ambiguity interview self-answered (see Interview Log + 02-OPEN-QUESTIONS.md).

## Goal

Every remaining capture surface (Codex CLI, Gemini CLI, Cursor, GitHub Copilot, ChatGPT.com, Claude.ai, and local git) lands canonical events in staging, and three backend async workers — correlation, model-fit (rule-based), and a daily aggregator — turn those raw events into the `prompt_outcomes`, `model_fit_scores`, and `daily_rollups_by_{user,project}` tables the Phase 4 dashboard will read.

## Background

Phase 1 shipped the foundation end-to-end on macOS: the canonical event schema (`@fennec/shared` — `CanonicalEventSchema` already enumerates all eight `tool` values including `git`), the daemon adapter registry (`daemon/src/adapters/registry.ts`) with one working adapter (`claude-code`), the append-only JSONL queue + sync loop, capture-time redaction, the ingest endpoint (`POST /api/events/batch`), and partitioned `ai_events` + `git_events` tables with RLS. The ingest path is deliberately "dumb" (ING-04) — `backend/src/api/events-batch.ts` carries a hot-path-purity guard and does NOT enqueue to a Queue yet (the `wrangler.jsonc` queue binding is commented out, awaiting this phase).

What does NOT exist today and is the work of this phase:

- **Capture adapters** — only `claude-code` exists under `daemon/src/adapters/`. Codex, Gemini, Cursor, Copilot, the browser MV3 extension, the Copilot VS Code sidecar, and the git-watcher are all absent. No `extension/` or `vscode-extension/` workspace exists.
- **Queue + async workers** — there is no Cloudflare Queue producer/consumer, no correlation worker, no model-fit worker, no daily aggregator cron. `grep` confirms zero references to `prompt_outcome`, `model_fit`, `daily_rollup`, `model_pricing`, `correlation`, or `aggregator` in backend/daemon source.
- **Analysis tables** — `prompt_outcomes`, `model_fit_scores`, `daily_rollups_by_user`, `daily_rollups_by_project`, and `model_pricing` do not exist in `supabase/migrations/`. `git_events` exists (Phase 1) but receives zero rows until the git-watcher ships.
- **`fennec inspect`** — referenced in `daemon/src/cli/consent.ts` ("Run `fennec inspect`...") but not implemented.

Phase 1 decision constraints carried in: D-16/D-27 removed `fennec pause` (CAP-17) — there is no pause to build; D-17 keeps `fennec inspect` (CAP-18) and assigns it to this phase; the cache-token capture decision (A2 option c — daemon captures all four Anthropic Usage fields verbatim; Phase 2 cost worker calibrates against billed data) is locked.

## Requirements

### Capture adapters (CLI transcript watchers)

1. **Codex CLI adapter (CAP-03)**: A new daemon adapter watches Codex CLI transcript files and emits canonical events.
   - Current: No `codex` adapter exists under `daemon/src/adapters/`; the `codex` tool value exists in `ToolSchema` but nothing emits it.
   - Target: A file-watcher adapter (synapse-style, chokidar-based) implementing the `Adapter` interface registers with the registry and emits `tool: "codex"` events through the registry's `emit` callback (redaction + queue handled by the registry, never the adapter).
   - Acceptance: One prompt issued in Codex CLI on the dev machine produces exactly one `ai_events` row tagged `tool = "codex"` in staging within 5 minutes; the adapter emits an `AdapterHeartbeat` with `events_parsed`/`parse_errors` even when zero events are captured.

2. **Gemini CLI adapter (CAP-04)**: A new daemon adapter watches Gemini CLI transcript files and emits canonical events.
   - Current: No `gemini` adapter exists; `gemini` tool value exists in `ToolSchema` unused.
   - Target: A chokidar-based file-watcher adapter implementing `Adapter` emits `tool: "gemini"` events via the registry `emit` callback.
   - Acceptance: One prompt issued in Gemini CLI produces exactly one `ai_events` row tagged `tool = "gemini"` in staging within 5 minutes; heartbeat emitted regardless of capture count.

3. **Cursor IDE adapter (CAP-05)**: A new daemon adapter reads Cursor's local SQLite / `workspaceStorage` and emits canonical events.
   - Current: No `cursor` adapter exists; `cursor` tool value unused.
   - Target: An adapter watches Cursor's local SQLite/workspaceStorage (read-only), parses AI usage records, and emits `tool: "cursor"` events via the registry `emit` callback.
   - Acceptance: One AI interaction in Cursor produces exactly one `ai_events` row tagged `tool = "cursor"` in staging within 5 minutes; heartbeat emitted regardless of capture count.

### Capture adapters (IDE sidecar)

4. **GitHub Copilot sidecar adapter (CAP-06)**: A paired VS Code sidecar extension reads Copilot's local cache and forwards usage to the daemon.
   - Current: No VS Code extension workspace exists; `copilot` tool value unused.
   - Target: A VS Code extension (MV-equivalent `vsce`-packaged) reads Copilot's local cache files and posts captured usage to the daemon's loopback bridge, which the daemon normalises into `tool: "copilot"` events.
   - Acceptance: One Copilot interaction in VS Code (with the sidecar installed and paired) produces exactly one `ai_events` row tagged `tool = "copilot"` in staging within 5 minutes; heartbeat emitted regardless of capture count.

### Capture adapters (browser MV3)

5. **ChatGPT.com browser capture (CAP-07)**: An MV3 browser extension captures ChatGPT.com AI usage and posts events to the daemon's loopback bridge.
   - Current: No browser extension workspace exists; `chatgpt-web` tool value unused.
   - Target: A Manifest V3 extension with a `world: MAIN`, `run_at: document_start` content script that captures prompts/responses on ChatGPT.com, buffers in `chrome.storage.local`, and flushes to the daemon's loopback `/v1/events` bridge authenticated by a pairing token. Daemon normalises into `tool: "chatgpt-web"` events.
   - Acceptance: One prompt in ChatGPT.com produces exactly one `ai_events` row tagged `tool = "chatgpt-web"` in staging within 5 minutes — OR the browser surface is explicitly flagged "submit-and-wait" / "defer" at the v1-freeze decision point with the loopback-bridge architecture left intact (see OPEN-QUESTIONS Q2).

6. **Claude.ai browser capture (CAP-08)**: The same MV3 extension captures Claude.ai AI usage via the same loopback path.
   - Current: No browser extension workspace exists; `claude-ai-web` tool value unused.
   - Target: The same MV3 extension content-script path captures Claude.ai prompts/responses and flushes them to the daemon loopback bridge; daemon normalises into `tool: "claude-ai-web"` events.
   - Acceptance: One prompt in Claude.ai produces exactly one `ai_events` row tagged `tool = "claude-ai-web"` in staging within 5 minutes — OR deferred under the same v1-freeze decision as CAP-07.

### Capture adapter (git)

7. **Git-watcher adapter (CAP-09)**: A daemon adapter watches local git activity and writes `git_events` rows.
   - Current: No `git` adapter exists; the `git_events` table exists (Phase 1) but receives zero rows; `EventKindSchema` does not yet enumerate git-specific kinds (the `git_events.event_type` CHECK is `commit|revert|file_edit|branch_switch`).
   - Target: A chokidar-based adapter watches `.git/HEAD`, `.git/logs/HEAD`, and working-tree changes in registered repos and produces `git_events` rows with `event_type ∈ {commit, revert, file_edit, branch_switch}`, carrying `repo_remote`/`repo_branch` and `occurred_at`.
   - Acceptance: A commit, a revert, a file edit, and a branch switch in a watched repo each produce a `git_events` row in staging with the matching `event_type` within 5 minutes.

### Transparency surface

8. **`fennec inspect` (CAP-18)**: A daemon CLI command shows the developer what was captured locally.
   - Current: `fennec inspect` is referenced in `daemon/src/cli/consent.ts` but no command implementation exists.
   - Target: `fennec inspect` prints every event captured locally in the last 24 hours (read from the local JSONL queue / synced log), with redactions visibly applied (no raw secrets), and shows where events are being sent (backend URL). No pause/disable capability (CAP-17 removed per D-16/D-27).
   - Acceptance: Running `fennec inspect` after capturing ≥1 event lists that event with its `tool`, `occurred_at`, and redacted payload, and prints the destination backend URL; running it with a known canary secret in a captured prompt shows zero raw secret characters.

### Backend analysis — correlation

9. **Correlation worker (ANL-01)**: A Queue-consumer worker joins prompts to nearby git events and writes `prompt_outcomes`.
   - Current: No Queue binding, no consumer, no `prompt_outcomes` table. Ingest does not enqueue (ING-04 hot-path guard in place).
   - Target: Ingest enqueues each event onto a Cloudflare Queue; a consumer worker joins each prompt-class `ai_events` row to `git_events` within a ±N-minute window (default N = 15; see OPEN-QUESTIONS Q1) and writes one `prompt_outcomes` row per correlated prompt.
   - Acceptance: A prompt followed by a commit within the window produces a `prompt_outcomes` row linking the two; a prompt with no git activity in-window produces a `prompt_outcomes` row with a null/empty outcome link (not a missing row).

10. **Attribution confidence interval (ANL-02)**: Each `prompt_outcome` carries a confidence interval, not a bare percentage.
    - Current: No `prompt_outcomes` table or confidence field exists.
    - Target: Every `prompt_outcomes` row stores a confidence representation that is an interval / range (e.g., `confidence_low` + `confidence_high`, or a categorical low/medium/high with bounds), never a single bare percentage.
    - Acceptance: Inspecting any `prompt_outcomes` row shows an interval-shaped confidence value with both bounds populated; a schema/test check rejects a bare single-number confidence.

11. **Reverts downgrade attribution (ANL-03)**: A revert explicitly downgrades the attribution of the correlated prompt rather than silently subtracting from totals.
    - Current: No attribution logic exists.
    - Target: When a `git_events` revert correlates to a prompt that previously had a positive outcome, the correlation worker writes an explicit downgrade (a recorded state transition / downgrade marker on the `prompt_outcomes` row), not a silent decrement of an aggregate.
    - Acceptance: A prompt → commit → later revert sequence produces a `prompt_outcomes` row whose attribution shows an explicit "downgraded by revert" state; the original positive attribution and the downgrade are both traceable (no silent total mutation).

### Backend analysis — model-fit

12. **Model-fit worker, rule-based (ANL-04)**: A Queue-consumer worker scores each prompt against the model used with rule-based heuristics and writes `model_fit_scores`.
    - Current: No model-fit worker or `model_fit_scores` table exists.
    - Target: A consumer worker scores every captured prompt against the model used via rule-based v1 heuristics (prompt length, file-edit size, tool-call count, model tier) — explicitly NOT an LLM judge (LLM-as-judge is v2 REC-03/ADV-01) — and writes one `model_fit_scores` row per prompt.
    - Acceptance: Each captured prompt yields exactly one `model_fit_scores` row containing a rule-derived score and the input signals used; a test confirms no LLM/network call is made in the scoring path.

### Backend analysis — daily aggregator + cost

13. **Daily aggregator cron (ANL-05)**: A scheduled worker writes `daily_rollups_by_user` and `daily_rollups_by_project`; frontend reads only rollups.
    - Current: No aggregator, no rollup tables, no cron trigger.
    - Target: A scheduled (cron) worker reads raw `ai_events`/`git_events`/`prompt_outcomes`/`model_fit_scores` and writes pre-rolled `daily_rollups_by_user` and `daily_rollups_by_project` rows (one row per user/project per day).
    - Acceptance: After a day of seeded events, the cron run produces `daily_rollups_by_user` and `daily_rollups_by_project` rows whose totals reconcile with a direct query over the underlying raw events for that day.

14. **Estimated vs billed cost columns (ANL-07)**: Cost is reported with separate "estimated" and "billed" columns.
    - Current: No cost columns exist in any rollup table (ANL-06 cache-token capture shipped in Phase 1 at the event level; STATE records the daemon captures all four Anthropic Usage fields verbatim, with calibration deferred to this phase).
    - Target: Rollup tables carry distinct `cost_estimated` (tokens × current price) and `cost_billed` (vendor-billing-reconciled where available, else null) columns; cache-creation and cache-read tokens are accounted separately in the estimate.
    - Acceptance: A rollup row shows a populated `cost_estimated` and a separate `cost_billed` (null when no billing data); a test asserts the estimate uses `cache_creation_input_tokens` and `cache_read_input_tokens` as distinct line items (no 70%-miscount collapse).

15. **Pricing table with effective-date ranges (ANL-08)**: Pricing data lives in a table with effective-date ranges, not hardcoded constants.
    - Current: No `model_pricing` table exists; no pricing constants in source.
    - Target: A `model_pricing` table stores per-model token prices with `effective_from`/`effective_to` ranges; the cost calculation in the aggregator reads the price effective at each event's `occurred_at`.
    - Acceptance: Inserting two price rows for the same model with non-overlapping date ranges causes events before and after the cutover to be costed at the respective prices; no price constant is hardcoded in the worker source (grep check).

16. **Subscription products accounted separately (ANL-09)**: Subscription products (Copilot $19/mo, ChatGPT Pro $20/mo) are accounted for separately from per-token spend.
    - Current: No subscription cost accounting exists.
    - Target: Subscription-priced products are represented as fixed-period subscription costs (in `model_pricing` or a sibling structure) and surfaced in rollups as a separate line from per-token spend.
    - Acceptance: A rollup that includes Copilot and/or ChatGPT-web usage shows the subscription cost as a distinct field from per-token `cost_estimated`; a test confirms subscription cost is not summed into the per-token estimate.

## Boundaries

**In scope:**
- Six new capture adapters: Codex, Gemini, Cursor (transcript/SQLite watchers), Copilot (VS Code sidecar), browser MV3 extension (ChatGPT.com + Claude.ai), git-watcher — all on macOS, capturing into a staging backend.
- Wiring the ingest path to enqueue onto a Cloudflare Queue (the previously-commented `wrangler.jsonc` queue binding) — keeping ingest hot/dumb (ING-04 preserved).
- Three async workers: correlation (Queue consumer), model-fit rule-based scorer (Queue consumer), daily aggregator (cron) — plus the schema migrations for `prompt_outcomes`, `model_fit_scores`, `daily_rollups_by_user`, `daily_rollups_by_project`, `model_pricing`.
- `fennec inspect` transparency CLI command.
- Cost model: estimated vs billed columns, effective-date pricing table, separate subscription accounting, cache-token-correct estimation.
- A v1-freeze decision point that records the browser surface disposition (GA / submit-and-wait / defer) with the architecture intact either way.

**Out of scope:**
- Linux systemd / Windows service install for the new adapters — Phase 5 (this phase verifies on macOS only, per ROADMAP success criterion 1 "single macOS dev machine").
- Chrome Web Store / Firefox AMO listing submission, review, and GA approval — gated at the v1-freeze decision; the extension is built and exercised against the local bridge, not necessarily published this phase.
- Org / membership / invite / API-key management UX, RLS hardening drill, custom redaction rules UI, retention/KMS/GDPR — all Phase 3.
- The SvelteKit dashboard that reads the rollup tables — Phase 4 (this phase only produces the read tables; rendering them is Phase 4).
- LLM-as-judge model-fit classifier — v2 (REC-03 / ADV-01); v1 is rule-based heuristics only.
- Per-PR / per-feature attribution and custom SQL analytics — v2 (ADV-02 / ADV-03).
- The Postgres-backed Queue abstraction for self-host (pgmq / graphile-worker, ING-07) — Phase 6; this phase uses Cloudflare Queues (cloud path).
- JetBrains / Aider / Continue.dev / Windsurf adapters and CI/CD capture — v2 (SURF-01..05).
- TLS-MITM proxy capture path — deferred escape hatch, not built this phase.

## Constraints

- **Stack pins (from CLAUDE.md / 01-RESEARCH):** TypeScript end-to-end; daemon on Node 22 + chokidar 5 for file-watchers; backend on Cloudflare Workers + Hono + Cloudflare Queues + Hyperdrive→Supabase Postgres; Zod boundary validation; Biome lint; Vitest unit tests. Browser extension is raw MV3 + `tsc` (no Plasmo/WXT). VS Code sidecar via `vsce`.
- **Adapter contract (locked by Phase 1):** Every adapter implements the `Adapter` interface (`daemon/src/adapters/adapter.ts`) and emits only via the registry's `emit` callback — adapters NEVER touch the redactor, queue, or sync loop directly. Capture-time redaction (PRIV-01) is applied uniformly by the registry, including for the new surfaces.
- **Schema contract (locked):** New tools already exist in `ToolSchema`; do not add top-level tool-specific columns to `ai_events` — tool data stays in `payload`. `org_id`/`user_id` are stamped by the backend from the API-key lookup, never client-supplied. Bumping `schema_version` (currently `z.literal(1)`) is the only sanctioned breaking-change mechanism (e.g., if git event kinds need adding to `EventKindSchema`).
- **Ingest purity (ING-04):** Correlation/model-fit/aggregator MUST run as async Queue consumers / cron, never in the `POST /api/events/batch` hot path. The existing `events-batch.hot-path.test.ts` static-import guard must continue to pass.
- **Cost correctness (ANL-06, locked Phase 1):** `cache_creation_input_tokens` and `cache_read_input_tokens` are costed as separate line items — must not collapse into a single input-token figure (avoids the LiteLLM 70%+ miscount).
- **Model-fit is rule-based only** — no LLM/network call in the scoring path this phase.
- **Multi-tenant correctness (D-26):** Every new analysis table carries `org_id` and has an RLS policy from creation, mirroring Phase 1's day-1-tenant-correct posture, even though full multi-tenant UX is Phase 3.
- **Verification target:** Staging backend, single macOS dev machine, events visible within 5 minutes of capture.
- **GSD docs-only guard (this run):** This SPEC and its OPEN-QUESTIONS are design artifacts only — no production source is written by the spec step.

## Acceptance Criteria

- [ ] One prompt in Codex CLI produces one `ai_events` row tagged `tool = "codex"` in staging within 5 minutes.
- [ ] One prompt in Gemini CLI produces one `ai_events` row tagged `tool = "gemini"` in staging within 5 minutes.
- [ ] One AI interaction in Cursor produces one `ai_events` row tagged `tool = "cursor"` in staging within 5 minutes.
- [ ] One Copilot interaction (via paired VS Code sidecar) produces one `ai_events` row tagged `tool = "copilot"` in staging within 5 minutes.
- [ ] One prompt in ChatGPT.com produces one `ai_events` row tagged `tool = "chatgpt-web"` within 5 minutes — OR the browser surface is recorded as "submit-and-wait"/"defer" at the v1-freeze decision with the loopback architecture intact.
- [ ] One prompt in Claude.ai produces one `ai_events` row tagged `tool = "claude-ai-web"` within 5 minutes — OR deferred under the same decision.
- [ ] A commit, revert, file edit, and branch switch in a watched repo each produce a `git_events` row with the matching `event_type`.
- [ ] Each new adapter emits an `AdapterHeartbeat` with `events_parsed`/`parse_errors` even when zero events are captured in the interval.
- [ ] `fennec inspect` lists locally captured events from the last 24 hours with redactions visible and prints the destination backend URL.
- [ ] Ingest enqueues onto a Cloudflare Queue; the `events-batch.hot-path.test.ts` import-purity guard still passes (no analytics imports in the hot path).
- [ ] The correlation worker joins prompts to git events within the ±N-minute window and writes `prompt_outcomes` rows.
- [ ] Every `prompt_outcomes` row carries an interval-shaped confidence (two bounds), never a bare single percentage.
- [ ] A prompt → commit → revert sequence yields a `prompt_outcomes` row with an explicit revert-downgrade state (no silent total subtraction).
- [ ] The model-fit worker writes one `model_fit_scores` row per prompt using rule-based heuristics; no LLM/network call occurs in the scoring path.
- [ ] The daily aggregator cron writes `daily_rollups_by_user` and `daily_rollups_by_project` rows whose totals reconcile with a direct raw-event query for that day.
- [ ] Rollups carry separate `cost_estimated` and `cost_billed` columns; the estimate uses cache-creation and cache-read tokens as distinct line items.
- [ ] Pricing is read from a `model_pricing` table with effective-date ranges; no price constant is hardcoded in worker source.
- [ ] Subscription products (Copilot, ChatGPT Pro) appear as a cost line separate from per-token `cost_estimated`.
- [ ] Every new analysis table has `org_id` and an RLS policy from its creation migration.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                                 |
|--------------------|-------|------|--------|---------------------------------------------------------------------------------------|
| Goal Clarity       | 0.86  | 0.75 | ✓      | ROADMAP success criteria are concrete; only the browser GA/defer trichotomy is soft.  |
| Boundary Clarity   | 0.82  | 0.70 | ✓      | 16 REQ-IDs map exactly to this phase; Phase 1 CONTEXT lists later-phase ownership.     |
| Constraint Clarity | 0.78  | 0.65 | ✓      | Stack + ANL-06 + rule-based locked; ±N window and heuristic thresholds left to plan.   |
| Acceptance Criteria| 0.80  | 0.70 | ✓      | ROADMAP criteria already read pass/fail (one row per tool, within 5 min).             |
| **Ambiguity**      | 0.178 | ≤0.20| ✓      | Gate passed on initial assessment; `--auto` skipped the interview per workflow Step 3. |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

All dimensions met their minimums and overall ambiguity (0.178) passed the gate on the first assessment. No dimension is flagged ⚠. Two residual choices that sit *inside* otherwise-clear dimensions were auto-decided with safe, reversible defaults and logged to `02-OPEN-QUESTIONS.md` (correlation ±N window; browser-surface disposition) so the planner can revisit them without re-opening the spec.

## Interview Log

| Round | Perspective    | Question summary                                  | Decision locked                                                                 |
|-------|----------------|--------------------------------------------------|--------------------------------------------------------------------------------|
| 0     | Researcher (auto) | What exists vs what's missing for Phase 2?     | Phase 1 foundation present (schema, registry, ingest, partitioned tables); all 6 new adapters + 3 workers + analysis tables + `fennec inspect` absent — confirmed by grep. |
| 0     | Boundary Keeper (auto) | Which REQ-IDs are this phase vs later?     | 16 REQ-IDs (CAP-03..09, CAP-18, ANL-01..05, ANL-07..09) per traceability; Phase 3 owns multi-tenant/privacy, Phase 4 owns dashboard, v2 owns LLM-judge. |
| 0     | Simplifier (auto) | What's the irreducible core?                   | One canonical row per surface in staging + the three workers populating read tables; browser may defer at v1-freeze without changing architecture. |
| 0     | Failure Analyst (auto) | What invalidates the requirements?         | Analytics leaking into the ingest hot path (ING-04 guard must hold); cache-token collapse (ANL-06); model-fit accidentally calling an LLM (must stay rule-based); reverts silently mutating totals (ANL-03 needs explicit downgrade). |
| 0     | Seed Closer (auto) | What's left undecided?                         | Correlation ±N window value and browser GA/defer disposition → auto-defaulted (N=15; build-and-exercise-locally, decide at v1-freeze) and logged to OPEN-QUESTIONS. |

*Auto-mode rationale:* Initial ambiguity (0.178) already passed the gate with all dimensions above minimum, so per spec-phase workflow Step 3 the Socratic interview was skipped and the SPEC was derived directly from ROADMAP.md success criteria + REQUIREMENTS.md text + Phase 1 locked decisions (D-16/D-17/D-27, ANL-06 cache-token decision). The table above records the perspective checks applied during derivation.

---

*Phase: 02-parallel-adapters-backend-analysis-layer*
*Spec created: 2026-07-01*
*Next step: /gsd:discuss-phase 2 — implementation decisions (adapter file-path specifics, queue topology, worker batching, heuristic thresholds, ±N window value)*
