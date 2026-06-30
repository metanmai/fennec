# Phase 2: Parallel Adapters + Backend Analysis Layer - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** `--auto` (unattended). Grey areas auto-decided by precedence (prior phase decisions > codebase patterns > domain conventions > ROADMAP criteria). STRONG-confidence calls recorded here; MEDIUM/LOW or genuinely-open calls applied as safest-reversible defaults and appended to `02-OPEN-QUESTIONS.md` (Q3+). No `AskUserQuestion` was used.

<domain>
## Phase Boundary

This phase is the HOW behind the locked WHAT/WHY in `02-SPEC.md`. It does NOT re-open any SPEC requirement — it only decides implementation mechanics for them. It delivers two layers on top of the Phase 1 foundation:

1. **Six new capture surfaces**, all additive against the locked Phase 1 `Adapter` contract (`daemon/src/adapters/adapter.ts`) and the registry emit pipeline (`daemon/src/adapters/registry.ts`):
   - Three chokidar file-watcher / SQLite-reader adapters in-process in the daemon: **codex**, **gemini**, **cursor**.
   - One in-process **git-watcher** adapter writing `git_events` (not `ai_events`).
   - Two out-of-process capture clients that POST to the daemon's existing loopback bridge: the **VS Code Copilot sidecar** (`vsce`-packaged) and the **MV3 browser extension** (ChatGPT.com + Claude.ai). The daemon normalises their bridge posts into `tool: "copilot" | "chatgpt-web" | "claude-ai-web"` events.

2. **The backend analysis layer**: wire ingest to enqueue onto a Cloudflare Queue (un-commenting the binding stub in `backend/wrangler.jsonc`), then three async consumers/cron — **correlation worker**, **rule-based model-fit worker**, **daily aggregator cron** — plus the migrations for `prompt_outcomes`, `model_fit_scores`, `daily_rollups_by_user`, `daily_rollups_by_project`, and `model_pricing`. Plus the `fennec inspect` transparency CLI.

**HOW-only scope of this CONTEXT:** queue batching params, the loopback-bridge auth reuse for browser/Copilot, adapter file-path resolution + heartbeat shape, the correlation ±N window + revert-downgrade state model, the rule-based model-fit heuristic weights, the pricing-table + subscription-cost design, cost-estimate cache-token line-itemisation, and `fennec inspect` redaction-visibility + output shape.

**Locked by Phase 1 / SPEC — do NOT re-decide:**
- Adapters emit ONLY via the registry `emit` callback; never touch the redactor, queue, or sync loop (registry applies PRIV-01 redaction uniformly).
- `org_id`/`user_id` are backend-stamped from the API-key lookup, never client-supplied (T-05-02).
- Tool-specific data stays in `payload`; no new top-level tool columns on `ai_events`. `schema_version` bump (`z.literal(1)`) is the only breaking-change mechanism.
- Ingest stays hot/dumb (ING-04) — `events-batch.hot-path.test.ts` static-import guard must keep passing.
- Cache tokens (`cache_creation_input_tokens`, `cache_read_input_tokens`) are costed as separate line items (ANL-06).
- Model-fit is rule-based ONLY — no LLM/network call in the scoring path this phase.
- Every new analysis table carries `org_id` + an RLS policy from its creation migration (D-26).

**Strictly out of scope** (assigned elsewhere — do NOT pull in): Linux/Windows install for the new adapters (Phase 5); Chrome Web Store / Firefox AMO submission (gated at v1-freeze, see Q2); org/membership/invite/redaction-UI/retention/KMS (Phase 3); the dashboard that reads the rollups (Phase 4); LLM-as-judge model-fit (v2); per-PR / custom-SQL attribution (v2); the Postgres-backed Queue abstraction for self-host, pgmq/graphile-worker, ING-07 (Phase 6); JetBrains/Aider/Continue/Windsurf/CI capture (v2); TLS-MITM proxy capture path (deferred escape hatch).

</domain>

<decisions>
## Implementation Decisions

### Adapter mechanics (Codex, Gemini, Cursor, git-watcher)

- **D2-01: Each new in-process adapter is its own directory under `daemon/src/adapters/<tool>/`** mirroring `claude-code/`'s shape (`adapter.ts` + `<x>-normaliser.ts` + co-located `*.test.ts`). The adapter owns watch + parse + normalise; it calls the registry `emit` and nothing else. This is the locked Pattern 2 contract — additive only.
- **D2-02: File-watching uses chokidar 5** (the stack pin; ESM-only, Node ≥20). Watch the smallest stable target per tool: Codex/Gemini watch their transcript/session JSONL files; the git-watcher watches `.git/HEAD`, `.git/logs/HEAD`, and the working tree of each registered repo. Tail-on-append (read only the bytes appended since last offset), not full re-parse, to keep capture cheap — same spirit as the JSONL queue's append-only reader.
- **D2-03: Parsers tolerate multiple upstream transcript versions** the way synapse's `codex.ts` does (per-line v1/v2 detection, not per-file). Unknown/malformed lines are counted as `parse_errors` and skipped, never thrown up the capture loop. This is the SPEC's "heartbeat with `events_parsed`/`parse_errors` even at zero capture" requirement, satisfied by the existing `AdapterCounter` plumbing in the registry.
- **D2-04: Cursor adapter reads its SQLite / `workspaceStorage` strictly read-only.** Open with an immutable / read-only connection (or copy-then-read if the DB is locked by a running Cursor), poll on a chokidar watch of the DB file's mtime rather than holding a long-lived connection. Never write to or migrate Cursor's DB. (Cursor SQLite multi-DB stability is a STATE-flagged research risk — see Q2/Q4.)
- **D2-05: File-path resolution is macOS-only this phase** (verification target is a single macOS dev machine). Resolve via the standard macOS locations (e.g. `~/.codex/`, `~/.gemini/`, `~/Library/Application Support/Cursor/User/workspaceStorage/`), but isolate each path behind a single `resolvePaths(os)` function per adapter so Phase 5 can add Linux/Windows branches without touching capture logic. Paths are MEDIUM-confidence (synapse confirms macOS/Linux; this phase verifies macOS) — log to OPEN-QUESTIONS.
- **D2-06: Git-watcher emits `git_events`, not `ai_events`,** with `event_type ∈ {commit, revert, file_edit, branch_switch}` (the locked CHECK constraint in `20260531000003_git_events_partitioned.sql`) and carries `repo_remote`/`repo_branch`/`occurred_at`. Revert detection v1 = a commit whose subject matches Git's default `Revert "<subject>"` form OR a `git revert` reflog entry; richer semantic revert detection is deferred. The `EventKindSchema` in `@fennec/shared` is for `ai_events` kinds and does NOT need git kinds added (git kinds live in the table CHECK) — so no `schema_version` bump is required for the git-watcher.

### Loopback bridge reuse (Copilot sidecar + browser MV3)

- **D2-07: Reuse the existing `LoopbackBridge` (`daemon/src/adapters/loopback-bridge/server.ts`) as the single ingress for out-of-process capture clients.** It already binds `127.0.0.1` only, authenticates by a shared secret header, parses JSON, and emits an event the daemon subscribes to. Do NOT build a second bridge or open a second port.
- **D2-08: Add a `POST /v1/events` route to the bridge** (alongside the existing `/v1/hook`) for the browser + Copilot clients, so the Claude-Code hook path and the new generic-capture path are distinguishable server-side and can be normalised by different adapters. `/v1/health` stays as-is for client pairing checks.
- **D2-09: Browser + Copilot clients authenticate with the SAME shared-secret-header model as the hook shim** (`X-Fennec-Shim-Secret` today; the planner may rename to a neutral `X-Fennec-Pairing-Token` if it adds the `/v1/events` route, but the trust model is identical). The pairing token is the per-install secret written to disk by `fennec wizard`/`init`; the browser extension and VS Code sidecar read it during a one-time pairing step. Threat model is unchanged from Pattern 9 (Phase 1): same-UID processes can already read the secret and write to the queue, so the header guards cross-UID + external probes only. **STRONG** — this is the locked Phase 1 loopback architecture, reused.
- **D2-10: Out-of-process clients buffer-then-flush, never block the user.** The browser extension buffers in `chrome.storage.local` and flushes on a `chrome.alarms` tick (MV3 service-worker lifecycle is hostile to long-lived listeners — CLAUDE.md). The Copilot sidecar buffers in extension memory / `globalState` and flushes on a timer. If the daemon is unreachable, the client retains its buffer and retries — fail-open, never surface an error to the developer (mirrors D-23's fail-open posture for the hook shim).
- **D2-11: Browser surface disposition = build-and-exercise-locally this phase; defer the public-store GA decision to v1-freeze** (this is Q2, already logged). The loopback architecture is built either way, so deferral is structurally free. Acceptance is met by either live local capture OR the documented-defer escape hatch.

### Queue topology + batching

- **D2-12: Un-comment and wire ONE Cloudflare Queue producer in ingest; fan out to consumers from there.** The producer binding stub already exists commented in `backend/wrangler.jsonc`. Ingest enqueues each accepted event (after the existing `INSERT ... ON CONFLICT DO NOTHING`) — the enqueue is the ONLY analytics-adjacent thing the hot path does, and it is a binding call, not an analytics import, so `events-batch.hot-path.test.ts` keeps passing. **STRONG** (ROADMAP/SPEC mandate the queue; CLAUDE.md mandates Hyperdrive+Queues at fennec's volume).
- **D2-13: Batching params follow the Cloudflare default fennec calls out in CLAUDE.md: `max_batch_size: 100`, `max_batch_timeout: 5s`, with retries + a dead-letter queue.** These are reversible config in `wrangler.jsonc`, not code. Rationale: CLAUDE.md's own §4 sizing (≈25 events/sec sustained, bursts to 1000/sec) sits comfortably inside 100/5s batching. **STRONG** (explicit CLAUDE.md default).
- **D2-14: Correlation and model-fit are independent consumers of the same event stream** (each consumes every prompt-class event once). The aggregator is NOT a queue consumer — it is a scheduled cron that reads the already-written rows. This matches the SPEC: two queue consumers + one cron.
- **D2-15: Consumers are idempotent on `(idempotency_key)` / `(prompt event id)`** — a redelivered queue message re-derives the same `prompt_outcomes` / `model_fit_scores` row via upsert, never a duplicate. Queue at-least-once delivery is assumed; dedupe lives in the consumer's upsert, mirroring the ingest dedupe pattern.

### Correlation worker + attribution (ANL-01/02/03)

- **D2-16: Correlation window N = 15 minutes (a ±15-minute join window)** per the SPEC default and OPEN-QUESTIONS Q1. Surfaced as a worker config constant (ideally an env/var, not a literal buried in logic) so it is tunable once staging data exists without a schema change. **MEDIUM** — kept logged as Q1.
- **D2-17: Every prompt-class event gets exactly one `prompt_outcomes` row — including prompts with no in-window git activity** (that row carries a null/empty outcome link, never a missing row). This satisfies the SPEC acceptance directly and makes the table a complete left-join base for the aggregator.
- **D2-18: Confidence is stored as an interval, not a bare percentage (ANL-02).** Concrete shape: a categorical `confidence_band ∈ {low, medium, high}` PLUS numeric `confidence_low` + `confidence_high` bounds (both populated). A schema CHECK / test rejects a single bare number. Band assignment v1 is rule-derived from the correlation signal strength (e.g. tight time gap + same repo/branch + a commit touching files = high; loose gap or branch mismatch = low). **MEDIUM** on the exact band thresholds — Claude's Discretion + logged.
- **D2-19: Reverts downgrade via an explicit recorded state transition, never a silent decrement (ANL-03).** A `prompt_outcomes` row carries an `attribution_state` (e.g. `attributed` → `downgraded_by_revert`) and a `downgraded_at` / `downgrade_reason` field, leaving the original positive attribution traceable. The correlation worker, when it sees a revert that correlates to a previously-positive prompt, writes the transition on the existing row — it does NOT mutate any aggregate total. The aggregator later reads the current state; no total is ever silently subtracted. **STRONG** (SPEC acceptance is explicit).

### Model-fit worker (rule-based, ANL-04)

- **D2-20: Rule-based scorer, zero network/LLM calls** — a pure function of signals already on the event: prompt length (chars/tokens), file-edit size (from correlated git event if available, else 0), tool-call count (count of `tool_call` kind events in the session), and model tier (derived from the model string in `payload`). A test asserts no `fetch`/network import in the scoring path (same static-import-guard technique as `events-batch.hot-path.test.ts`). **STRONG** (locked constraint).
- **D2-21: v1 heuristic = a transparent weighted score that flags over/under-powered model choice.** Starting weights (all reversible config, Claude's Discretion on exact values): map each signal to a "task heaviness" estimate (long prompt + large edit + many tool calls = heavy task → a frontier/large model is "fit"; short prompt + tiny edit + no tool calls = light task → a frontier model is "over-powered / cheaper model would fit"). Store BOTH the numeric score AND the input signals used (SPEC requires the signals be persisted), so the score is explainable and re-derivable. Output a categorical `fit_verdict ∈ {under_powered, fit, over_powered}` alongside the raw score.
- **D2-22: Model tier mapping lives in data, not a giant switch.** A small model→tier lookup (frontier / mid / small) is seeded alongside `model_pricing` (or in it), so adding a model is a data change, not a code change — consistent with the no-hardcoded-pricing constraint.

### Daily aggregator + cost model (ANL-05/07/08/09)

- **D2-23: Aggregator is a Cloudflare cron-triggered Worker** (a `scheduled` handler) that reads raw `ai_events` / `git_events` / `prompt_outcomes` / `model_fit_scores` for the day and writes one `daily_rollups_by_user` + one `daily_rollups_by_project` row per user/project per day. Idempotent: re-running the cron for a day upserts (replaces) that day's rollup rows rather than appending. Frontend reads ONLY rollups (Phase 4). **STRONG**.
- **D2-24: Cost estimate line-items cache tokens separately (ANL-06, locked).** `cost_estimated = (input_tokens × input_price) + (output_tokens × output_price) + (cache_creation_input_tokens × cache_creation_price) + (cache_read_input_tokens × cache_read_price)`. The four token fields are already captured verbatim per event (Phase 1 A2 option c). A test asserts cache-creation and cache-read are distinct multiplications — no 70%-collapse. **STRONG** (locked).
- **D2-25: Rollups carry distinct `cost_estimated` and `cost_billed` columns.** `cost_estimated` is always populated (tokens × effective price); `cost_billed` is null until vendor-billing reconciliation data exists (out of scope to fetch this phase — the column + null-handling is the deliverable). **STRONG** (SPEC).
- **D2-26: `model_pricing` table is the single source of truth, keyed by `(model, token_kind, effective_from, effective_to)`** with per-token prices for each of the four token kinds (input / output / cache_creation / cache_read). The aggregator selects the price row where the event's `occurred_at` falls within `[effective_from, effective_to)`. Non-overlapping ranges per model are enforced (CHECK / exclusion constraint or test). No price constant in worker source (grep-checked). **STRONG** (SPEC acceptance).
- **D2-27: Subscription products are a separate cost line, never summed into per-token `cost_estimated` (ANL-09).** Represent fixed-period subscriptions (Copilot ~$19/mo, ChatGPT Pro ~$20/mo) as their own rows — either a `pricing_kind` discriminator in `model_pricing` (`per_token` vs `subscription`) or a sibling `subscription_pricing` table. The rollup surfaces a distinct `cost_subscription` field. A test confirms subscription cost is NOT added into `cost_estimated`. **STRONG** (SPEC). Planner's call on same-table-discriminator vs sibling-table; same-table-discriminator is the leaner default.
- **D2-28: All five new tables are `org_id`-stamped + RLS-policied from their creation migration (D-26).** Mirror Phase 1's migration style: timestamped filenames continuing the `20260531000007` sequence, `RLS ENABLE` + tenant-isolation `CREATE POLICY` in the same migration, partition the high-volume tables by `occurred_at`/day if they grow per-event (the rollup tables are per-day-per-entity so likely un-partitioned; `prompt_outcomes` / `model_fit_scores` are per-prompt so follow the `ai_events` partitioning model). **STRONG** (locked).

### `fennec inspect` (CAP-18)

- **D2-29: `fennec inspect` is a new subcommand wired into the CLI dispatcher in `daemon/src/index.ts`** (alongside `wizard | init | uninstall | daemon`), reading the local JSONL queue via the existing `replayFromWatermark` reader — NOT a backend call. It prints every event captured locally in the last 24 hours with `tool`, `occurred_at`, `kind`, and the redacted `payload`, then prints the destination backend URL (`env.apiBaseUrl`). No pause/disable capability (CAP-17 removed, D-16). **STRONG**.
- **D2-30: Redaction visibility = show the already-redacted-at-capture payload as stored in the queue.** Events in the JSONL queue are ALREADY redacted (the registry redacts before `appendEvent`), so `inspect` shows exactly what would leave the machine. No raw-secret path exists to leak. The canary test for CAP-18 runs `inspect` over a queue containing a known canary secret and asserts zero raw secret characters appear. **STRONG** (the redaction-already-applied invariant is locked by the registry pipeline).
- **D2-31: Default `inspect` output is a human-readable table; `--json` emits machine-readable JSON** for the CLI+MCP+AI-friendly posture (MEMORY: every feature exposes web+CLI+MCP). Default window is 24h; `--since <duration>` overrides. Truncate long payload fields in the table view with a `--full` opt-out. **MEDIUM** on exact flag surface — Claude's Discretion + logged.

### Claude's Discretion

The planner/executor has flexibility on these (each a reversible default; none re-opens a SPEC requirement):
- Exact chokidar `awaitWriteFinish` / polling tuning per adapter, and the tail-offset bookkeeping mechanism (in-memory vs a small per-adapter offset file).
- Cursor read-only access mechanism: immutable SQLite open flag vs copy-to-temp-then-read; pick whichever is stable against a running Cursor on macOS.
- Whether `/v1/events` reuses `X-Fennec-Shim-Secret` verbatim or introduces a neutral `X-Fennec-Pairing-Token` alias (trust model identical either way).
- Cloudflare Queue retry count + dead-letter-queue naming; consumer concurrency.
- Exact confidence-band thresholds (D2-18) and model-fit heuristic weights / verdict cutoffs (D2-21) — start with transparent, documented constants; tune against staging data.
- `model_pricing` shape: `pricing_kind` discriminator in one table vs a sibling `subscription_pricing` table (D2-27); same for the model→tier lookup location (D2-22).
- Whether `prompt_outcomes` / `model_fit_scores` are range-partitioned (follow `ai_events`) or plain — partition if per-event volume warrants.
- `fennec inspect` flag surface beyond `--json` / `--since` / `--full` (D2-31).
- Browser extension build tooling within the locked "raw MV3 + `tsc`, no Plasmo/WXT" constraint; VS Code sidecar `vsce` packaging specifics.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`Adapter` interface + `EmitInput`/`Emit` types** — `daemon/src/adapters/adapter.ts`. Every new in-process adapter (codex, gemini, cursor, git-watcher) implements this verbatim. `EmitInput` already carries `tool`, `kind`, `payload`, `session_id`, `hook_event`, optional `occurred_at`/`cwd`/`git_remote`/`git_branch` — exactly the fields the new adapters need.
- **`AdapterRegistry` + `AdapterCounter`** — `daemon/src/adapters/registry.ts`. The canonical→redact→queue pipeline, `events_parsed`/`parse_errors` counting, `last_payload_sample` for `schema_hash`, and the drop-on-throw behaviour are all done. New adapters just `register()` + get an `emit`. Registration point is `daemon/src/cli/daemon.ts` (step 7) — add `registry.register(new CodexAdapter(...))` etc. there.
- **`LoopbackBridge`** — `daemon/src/adapters/loopback-bridge/server.ts`. `127.0.0.1`-only HTTP server with `X-Fennec-Shim-Secret` auth, JSON-body parse, and an `EventEmitter` "hook" event. Reuse directly for the browser + Copilot `/v1/events` ingress (D2-07/08). `secret-store.ts` (sibling) is the on-disk secret reader for pairing.
- **JSONL queue reader `replayFromWatermark`** — `daemon/src/queue/jsonl.ts`, re-exported from `daemon/src/index.ts`. This is the data source for `fennec inspect` (D2-29) — events in it are already redacted.
- **`claude-code/` adapter as the template** — `daemon/src/adapters/claude-code/adapter.ts` + `payload-normaliser.ts` show the normalise-only, log-and-swallow-malformed-input, `stop()`-unsubscribes pattern to copy.
- **Synapse reference adapters** — `~/Documents/synapse/mcp/src/capture/adapters/{codex,cursor,gemini,copilot-cli}.ts` show the per-line multi-version transcript parsing (Codex v1/v2 detection), the file-path resolution, and the chokidar watch shape. Read for pattern, normalise into fennec's `EmitInput`.
- **Phase 1 migration style** — `supabase/migrations/2026053100000{2,3,6}_*.sql` show range-partition-by-`occurred_at`, `RLS ENABLE` + tenant-isolation policy in-migration, and the `(idempotency_key, occurred_at)` PK / `ON CONFLICT` dedupe shape to mirror for the five new tables.
- **`backend/src/api/events-batch.ts` + `events-batch.hot-path.test.ts`** — the hot-path purity pattern (and the static-import-grep test technique) to reuse for the model-fit "no LLM/network in scoring path" guard.
- **CLI dispatcher in `daemon/src/index.ts`** — the `switch (sub)` block to extend with an `inspect` case.

### Established Patterns

- **Heterogeneous capture, homogeneous emit (Pattern 2):** adapters only ever call `emit`; redaction/queue/sync are the registry's job. Non-negotiable for the new adapters.
- **Drop-on-throw, count-as-parse_error (PITFALL P1):** the registry already does this; new adapters inherit it. Malformed upstream lines never crash the watch loop.
- **Append-only JSONL + watermark replay (Pattern 4/5):** the local-queue durability model; `inspect` reads it, sync flushes it. Do not introduce SQLite at the daemon layer (locked stack decision).
- **Hot/dumb ingest + async analytics (ING-04):** correlation/model-fit/aggregator run as Queue consumers / cron, never in `POST /api/events/batch`. The enqueue is a binding call, not an analytics import.
- **Tenant-correct from day 1 (D-26):** `org_id` + RLS on every customer-data table at creation; `org_id` always from auth context, never request body (T-05-02).
- **Cache tokens separate (ANL-06):** four token fields captured verbatim per event; costed as four distinct line items.
- **Fail-open capture (D-23):** the hook shim exits cleanly if the daemon is down; the browser/Copilot clients mirror this (buffer + retry, never block the dev).
- **CLI+MCP+AI-friendly (MEMORY):** new surfaces (`fennec inspect`) should offer a `--json` machine-readable mode, not just human text.

### Integration Points

- **`daemon/src/cli/daemon.ts` step 7** — where new in-process adapters get `registry.register()`ed and started. Add codex/gemini/cursor/git-watcher here.
- **`daemon/src/adapters/loopback-bridge/server.ts`** — add the `POST /v1/events` route; the daemon subscribes a new normalising adapter to the new event for copilot/chatgpt-web/claude-ai-web.
- **`daemon/src/index.ts` CLI dispatcher** — add the `inspect` subcommand + public-API export.
- **`backend/wrangler.jsonc`** — un-comment + populate the `queues` producer block (and add the consumer + `scheduled`/cron triggers); the Phase 2 comment marker is already in place.
- **`backend/src/api/events-batch.ts`** — add the single enqueue call after the existing insert loop (keeping the hot-path-purity test green).
- **`supabase/migrations/`** — five new timestamped migrations continuing the `20260531...` sequence for `prompt_outcomes`, `model_fit_scores`, `daily_rollups_by_user`, `daily_rollups_by_project`, `model_pricing` (+ subscription pricing if a sibling table is chosen).
- **`@fennec/shared`** — new Zod payload validators for the new tools' payload shapes + any new shared types for `prompt_outcomes`/`model_fit_scores`/rollup rows the workers and (Phase 4) frontend will share. No `schema_version` bump expected (tools already enumerated in `ToolSchema`; git kinds live in the table CHECK, not `EventKindSchema`).

</code_context>

<specifics>
## Specific Ideas

- **Mirror synapse's per-line transcript-version detection for Codex** (`~/Documents/synapse/mcp/src/capture/adapters/codex.ts` does v1 flat-line vs v2 `payload`-wrapped detection per-line). Fennec's Codex/Gemini parsers should be equally tolerant so a transcript-format bump degrades to `parse_errors`, not a dead adapter (PITFALL P3 silent-breakage).
- **The loopback bridge is the load-bearing reuse for the browser + Copilot surfaces.** The whole point of the Phase 1 bridge (`127.0.0.1` + shared-secret) is that out-of-process capture clients have a vetted ingress; Phase 2 adds one route to it rather than inventing a new transport. This is why deferring the browser GA (Q2) is structurally free — the bridge is built regardless.
- **`fennec inspect` shows the redacted-as-stored payload — that IS the transparency guarantee.** Because the registry redacts before the queue write, the queue contents are exactly what leaves the machine. `inspect` reading the queue therefore proves to the developer "this redacted thing is what fennec sends" — the redaction-visibility requirement (CAP-18) is satisfied by the existing pipeline invariant, not by a separate redaction pass.
- **Confidence is an interval because attribution is genuinely uncertain (ANL-02 anti-pattern guard).** The `confidence_band` + `confidence_low`/`confidence_high` shape exists specifically to stop the dashboard (Phase 4) from rendering a falsely-precise single percentage. Keep the bounds; the schema check enforces it.
- **Reverts are a state transition, not arithmetic (ANL-03 anti-pattern guard).** Recording `downgraded_by_revert` on the row (with the original attribution still traceable) is deliberately chosen over decrementing a total, so attribution history is auditable — aligns with MEMORY's "score artifacts, never silently mutate" posture.

</specifics>

<deferred>
## Deferred Ideas

Captured so they aren't lost; out of scope for Phase 2:

- **Per-org configurable correlation window** — N is a single tunable constant this phase (D2-16); per-org configurability is a later refinement once multi-tenant config UX exists (Phase 3+).
- **Linux/Windows file-path branches for the new adapters** — isolated behind `resolvePaths(os)` (D2-05) but only the macOS branch is implemented this phase; Linux/Windows is Phase 5.
- **Chrome Web Store / Firefox AMO submission + GA** — gated at the v1-freeze decision (Q2); the extension is built and exercised against the local bridge only this phase.
- **Vendor-billing reconciliation for `cost_billed`** — the column + null-handling ships this phase; actually fetching vendor invoices to populate it is later (it requires per-vendor billing API integration).
- **LLM-as-judge model-fit** — v2 (REC-03/ADV-01); v1 is rule-based heuristics only.
- **Semantic revert detection** — v1 detects reverts via Git's `Revert "..."` convention + `git revert` reflog (D2-06); detecting logical reverts that don't follow the convention is later.
- **Self-host Queue abstraction (pgmq / graphile-worker, ING-07)** — Phase 6; this phase uses Cloudflare Queues (cloud path) only.
- **JetBrains / Aider / Continue / Windsurf / CI-CD capture surfaces** — v2 (SURF-01..05).
- **TLS-MITM proxy capture path** — deferred escape hatch; not built this phase.

</deferred>

---

*Phase: 02-parallel-adapters-backend-analysis-layer*
*Context gathered: 2026-07-01 (autonomous smart-discuss)*
