# Phase 2: Parallel Adapters + Backend Analysis Layer — Research

**Researched:** 2026-07-01
**Domain:** Cross-tool capture adapters (CLI transcript watchers, SQLite reader, VS Code sidecar, MV3 browser extension, git-watcher) + Cloudflare Queue/cron async analysis layer (correlation, model-fit, daily aggregator, cost model) on macOS into a staging backend.
**Confidence:** HIGH on the in-process adapter file paths/schemas and the SQLite read mechanism (verified by live POC on this machine); HIGH on the Cloudflare Queue/cron config and Postgres constraint DDL (verified against current official docs); MEDIUM on browser MV3 capture viability and Copilot capture path (verified storage location, but the locked sidecar approach has a token-data gap); MEDIUM on seed pricing currency (verified 2026-07-01, but volatile).

> **Reading note for the planner:** Every claim below is phrased as a falsifiable assertion with a one-line "Falsify:" check and a confidence tag. Claims that *refine or contradict* a locked CONTEXT decision (D2-xx) or an OPEN-QUESTION default (Qx) are flagged inline with **⚠ REFINES Dx-xx** / **⚠ REFINES Qx**. The biggest such refinements: the **Cloudflare one-push-consumer-per-queue limit (refines D2-14)**, the **Cursor data is in a global SQLite not per-workspace `.json` (refines D2-04/Q3)**, the **Copilot chat lives in `workspaceStorage/.../chatSessions/*.json` not `github.copilot-chat/globalStorage` and carries no token counts (refines Q3)**, and the **subscription seed prices have changed: Copilot Pro is now $10/mo not $19 (refines D2-27/ANL-09)**.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D2-01 .. D2-31 — research RESPECTS these, does not re-open)

**Adapter mechanics:**
- **D2-01:** Each new in-process adapter is its own dir `daemon/src/adapters/<tool>/` mirroring `claude-code/` (`adapter.ts` + `<x>-normaliser.ts` + co-located `*.test.ts`). Adapter owns watch+parse+normalise; calls registry `emit` and nothing else.
- **D2-02:** File-watching uses chokidar 5 (ESM-only, Node ≥20). Watch smallest stable target per tool. Tail-on-append (read bytes since last offset), not full re-parse.
- **D2-03:** Parsers tolerate multiple upstream transcript versions (per-line v1/v2 detection like synapse codex.ts). Unknown/malformed lines → `parse_errors`, skipped, never thrown up the loop.
- **D2-04:** Cursor adapter reads SQLite/`workspaceStorage` strictly read-only (immutable/read-only connection, or copy-then-read if locked); poll on chokidar mtime watch. Never write/migrate Cursor's DB.
- **D2-05:** File-path resolution is macOS-only this phase, isolated behind a per-adapter `resolvePaths(os)` so Phase 5 adds Linux/Windows without touching capture logic.
- **D2-06:** Git-watcher emits `git_events` (not `ai_events`) with `event_type ∈ {commit, revert, file_edit, branch_switch}`; carries `repo_remote`/`repo_branch`/`occurred_at`. Revert detection v1 = `Revert "<subject>"` form OR `git revert` reflog entry. No `schema_version` bump (git kinds live in the table CHECK, not `EventKindSchema`).

**Loopback bridge reuse:**
- **D2-07:** Reuse existing `LoopbackBridge` as single ingress for out-of-process clients. No second bridge/port.
- **D2-08:** Add `POST /v1/events` route alongside `/v1/hook` for browser+Copilot; `/v1/health` stays.
- **D2-09:** Browser+Copilot authenticate with the SAME shared-secret-header model (`X-Fennec-Shim-Secret`; planner may rename to neutral `X-Fennec-Pairing-Token`). Token is the per-install secret written by `fennec wizard`/`init`. Threat model unchanged from Pattern 9.
- **D2-10:** Out-of-process clients buffer-then-flush, never block. Browser buffers in `chrome.storage.local`, flushes on `chrome.alarms`. Copilot buffers in extension memory/`globalState`. Fail-open on daemon unreachable.
- **D2-11:** Browser disposition = build-and-exercise-locally; defer public-store GA to v1-freeze. Architecture built either way.

**Queue topology + batching:**
- **D2-12:** Un-comment + wire ONE Cloudflare Queue producer in ingest; fan out from there. Enqueue after the existing `INSERT ... ON CONFLICT DO NOTHING` — the only analytics-adjacent thing the hot path does, a binding call not an analytics import (hot-path test keeps passing).
- **D2-13:** Batching `max_batch_size: 100`, `max_batch_timeout: 5s`, with retries + a dead-letter queue.
- **D2-14:** Correlation and model-fit are independent consumers of the same event stream. Aggregator is NOT a queue consumer — it's a cron reading already-written rows.
- **D2-15:** Consumers idempotent on `(idempotency_key)`/`(prompt event id)` via upsert (at-least-once delivery assumed).

**Correlation + attribution:**
- **D2-16:** Correlation window N = 15 minutes (±15-min join), surfaced as a tunable worker config constant. (Q1, MEDIUM.)
- **D2-17:** Every prompt-class event gets exactly one `prompt_outcomes` row — including prompts with no in-window git activity (null/empty outcome link, never missing).
- **D2-18:** Confidence stored as an interval: categorical `confidence_band ∈ {low,medium,high}` PLUS numeric `confidence_low`+`confidence_high` (both populated). Schema CHECK/test rejects a bare number. (Band thresholds Q5, MEDIUM.)
- **D2-19:** Reverts downgrade via explicit recorded state transition: `attribution_state` (`attributed` → `downgraded_by_revert`) + `downgraded_at`/`downgrade_reason`. Never a silent decrement.

**Model-fit (rule-based):**
- **D2-20:** Rule-based scorer, zero network/LLM calls. Pure function of signals: prompt length, file-edit size (from correlated git event), tool-call count, model tier. Static-import-guard test asserts no `fetch`/network import.
- **D2-21:** v1 = transparent weighted "task heaviness" score → `fit_verdict ∈ {under_powered, fit, over_powered}` + raw score + persisted input signals. (Weights Q6, MEDIUM.)
- **D2-22:** Model→tier (frontier/mid/small) mapping lives in data, seeded alongside `model_pricing`.

**Daily aggregator + cost:**
- **D2-23:** Aggregator is a Cloudflare cron-triggered Worker (`scheduled` handler); one `daily_rollups_by_user` + one `daily_rollups_by_project` row per entity per day; idempotent upsert. Frontend reads ONLY rollups.
- **D2-24:** Cost estimate line-items cache tokens separately: `cost_estimated = (input×input_price)+(output×output_price)+(cache_creation×cache_creation_price)+(cache_read×cache_read_price)`. Test asserts four distinct multiplications, no 70%-collapse.
- **D2-25:** Rollups carry distinct `cost_estimated` (always populated) and `cost_billed` (null until vendor reconciliation).
- **D2-26:** `model_pricing` keyed by `(model, token_kind, effective_from, effective_to)`; aggregator selects price where `occurred_at ∈ [effective_from, effective_to)`. Non-overlapping ranges enforced. No hardcoded price constant (grep-checked).
- **D2-27:** Subscription products are a separate cost line, never summed into per-token `cost_estimated`. `pricing_kind` discriminator (`per_token` vs `subscription`) in `model_pricing` is the leaner default vs a sibling `subscription_pricing` table. Rollup surfaces a distinct `cost_subscription` field. (Q7, MEDIUM.)
- **D2-28:** All five new tables `org_id`-stamped + RLS-policied from creation. Timestamped filenames continuing `20260531000007`. Partition per-event tables by `occurred_at`/day; rollup tables likely un-partitioned.

**`fennec inspect`:**
- **D2-29:** New subcommand in `daemon/src/index.ts` dispatcher (alongside `wizard|init|uninstall|daemon`), reading local JSONL queue via `replayFromWatermark` (NOT a backend call). Prints `tool`, `occurred_at`, `kind`, redacted `payload`, then destination backend URL. No pause/disable.
- **D2-30:** Redaction visibility = show already-redacted-at-capture payload as stored in queue. Canary test asserts zero raw secret characters.
- **D2-31:** Default output = human-readable table; `--json` machine-readable; default window 24h; `--since <duration>` override; `--full` opt-out of truncation. (Flag surface Q-discretion, MEDIUM.)

### Claude's Discretion
- chokidar `awaitWriteFinish`/polling tuning per adapter; tail-offset bookkeeping (in-memory vs per-adapter offset file).
- Cursor read-only mechanism: immutable open flag vs copy-to-temp-then-read.
- `/v1/events` header reuse vs neutral `X-Fennec-Pairing-Token` alias.
- Queue retry count + DLQ naming; consumer concurrency.
- Confidence-band thresholds (D2-18) and model-fit weights/cutoffs (D2-21).
- `model_pricing` shape: `pricing_kind` discriminator vs sibling table; model→tier lookup location.
- Whether `prompt_outcomes`/`model_fit_scores` are range-partitioned vs plain.
- `fennec inspect` flag surface beyond `--json`/`--since`/`--full`.
- Browser extension build tooling within "raw MV3 + `tsc`, no Plasmo/WXT"; vsce packaging specifics.

### Deferred Ideas (OUT OF SCOPE — ignore)
Per-org configurable correlation window; Linux/Windows path branches; Chrome Web Store/Firefox AMO submission+GA; vendor-billing reconciliation for `cost_billed`; LLM-as-judge model-fit; semantic revert detection; self-host Queue abstraction (pgmq/graphile-worker); JetBrains/Aider/Continue/Windsurf/CI capture; TLS-MITM proxy capture path.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-03 | Codex CLI adapter | §A.1 — verified path `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, v2 line schema, one-row mapping, token_count event location |
| CAP-04 | Gemini CLI adapter | §A.2 — verified path `~/.gemini/tmp/<project>/chats/session-*.jsonl` (ephemeral), `$set` snapshot semantics |
| CAP-05 | Cursor IDE adapter | §A.3 — **verified live POC**: global `state.vscdb` SQLite, `cursorDiskKV` bubbles, `node:sqlite` read-only open works while Cursor runs (WAL) |
| CAP-06 | Copilot VS Code sidecar | §B.5 — **verified**: chat in `workspaceStorage/<md5>/chatSessions/*.json`, has `message.text`/`modelId`/`response`, NO token counts |
| CAP-07 | ChatGPT.com browser capture | §B.6 — MV3 monkeypatch viability MEDIUM, anti-bot risk, SW lifecycle + alarms, pairing handshake |
| CAP-08 | Claude.ai browser capture | §B.6 — same MV3 path, distinct request URL shapes |
| CAP-09 | Git-watcher adapter | §A.4 — verified reflog/HEAD shapes, event_type derivation, porcelain for remote/branch/occurred_at |
| CAP-18 | `fennec inspect` | §D.12 — `replayFromWatermark` reader, dispatcher wiring, canary test |
| ANL-01 | Correlation worker | §C.7/§C.8 — Queue consumer, ±15-min join via Hyperdrive→Supabase |
| ANL-02 | Confidence interval | §C.8 — `confidence_band` + bounds, CHECK rejecting bare number |
| ANL-03 | Reverts downgrade | §C.8 — `attribution_state` transition |
| ANL-04 | Model-fit rule-based | §C.9 — weighted score, no-LLM static-import guard |
| ANL-05 | Daily aggregator cron | §C.10 — `scheduled` handler, idempotent upsert |
| ANL-07 | Estimated vs billed cost | §C.11 — distinct columns, cache-token line items |
| ANL-08 | Pricing effective-date table | §C.11 — `model_pricing`, EXCLUDE/btree_gist non-overlap DDL |
| ANL-09 | Subscription separate | §C.11 — `pricing_kind` discriminator; **prices changed: Copilot $10, ChatGPT $20** |
</phase_requirements>

## Summary

Phase 2 is two layers bolted onto a proven Phase 1 foundation. The capture layer adds six surfaces; the analysis layer adds a Cloudflare Queue producer + consumers + cron and five Postgres tables. Phase 1's contracts are already shaped for this: the `Adapter` interface + `AdapterRegistry` give every new in-process adapter a one-line `register()` + an `emit` callback that handles canonical-envelope/redact/queue uniformly, and the `LoopbackBridge` already provides a `127.0.0.1` + shared-secret ingress that just needs one new route for the out-of-process clients.

**The single most important new finding is verified by live POC on this machine:** modern Cursor stores its chat/AI-usage data in a **global** SQLite DB at `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (149 MB, WAL mode, tables `ItemTable` + `cursorDiskKV`), **not** in per-workspace `.json` files as the synapse `cursor.ts` adapter assumes. Critically, **Node 22.23.1's built-in `node:sqlite` (`DatabaseSync`) opens this live DB read-only successfully while Cursor is running, with zero native dependencies** — which resolves the highest STATE-flagged risk (Q4) cleanly and confirms D2-04's read-only posture is achievable without `better-sqlite3`.

**The second consequential finding contradicts a CONTEXT assumption:** Cloudflare Queues allow only **one push consumer per queue**. D2-14's "two independent consumers of the same event stream" is therefore not directly expressible as one queue with two push-consumer Workers. Two clean topologies satisfy the intent: (a) one queue + one consumer Worker that runs both correlation and model-fit per message; or (b) two queues, the producer enqueues each event to both. Recommendation below: **(a)** for v1 simplicity (one batch, one transaction, shared event parse), with the per-message work split into two idempotent functions.

**Primary recommendation:** Use `node:sqlite` (built-in, read-only open) for Cursor; add `chokidar@^5.0.0` as the daemon's first file-watch dependency (it is NOT yet installed); model the four in-process adapters on `claude-code/adapter.ts`; reuse the loopback bridge with a new `POST /v1/events` route for the VS Code sidecar (which reads `workspaceStorage/.../chatSessions/*.json`) and the MV3 extension; implement the analysis layer as one queue + one consumer (correlation+model-fit) + one cron (aggregator), with `model_pricing` using a `pricing_kind` discriminator and a Postgres `EXCLUDE USING gist` non-overlap constraint; and seed pricing with the verified 2026-07-01 numbers (re-verify at build time).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Codex/Gemini/Cursor/git capture | Daemon (in-process adapter) | — | File/SQLite watch needs local FS access; registry pipeline already in daemon |
| Copilot capture | VS Code sidecar (out-of-process) → Daemon bridge | Daemon | VS Code extension reads its own workspaceStorage; daemon normalises + redacts |
| ChatGPT/Claude.ai capture | Browser MV3 extension (out-of-process) → Daemon bridge | Daemon | Only content-script monkeypatch can see page fetch; daemon normalises + redacts |
| Capture-time redaction | Daemon (AdapterRegistry) | — | PRIV-01 invariant: registry redacts before queue.append, uniformly for ALL surfaces |
| Event ingest | Backend Worker (hot path) | — | Stays hot/dumb (ING-04); only adds one queue-enqueue binding call |
| Correlation / model-fit | Backend Worker (Queue consumer) | Supabase Postgres | Async, idempotent; reads git_events + writes prompt_outcomes/model_fit_scores via Hyperdrive |
| Daily aggregation | Backend Worker (cron `scheduled`) | Supabase Postgres | Reads raw rows, writes rollups; not a queue consumer |
| Cost computation | Backend Worker (aggregator) reading `model_pricing` | Supabase Postgres | Effective-date price lookup; no hardcoded constants |
| Pricing source of truth | Supabase Postgres (`model_pricing`) | — | Data, not code; non-overlap enforced at DB |
| `fennec inspect` | Daemon (CLI) reading local JSONL | — | Local transparency; reads queue, never calls backend |

---

# A. The four in-process file-watcher / reader adapters (CAP-03/04/05/09)

> All four implement the `Adapter` interface (`daemon/src/adapters/adapter.ts`): `readonly tool`, `readonly version`, `start(emit)`, `stop()`. They call `emit(EmitInput)` only. `EmitInput` requires `{ tool, adapter_version, kind, payload, session_id, hook_event }` and optionally `{ occurred_at, cwd, git_remote, git_branch }`. The registry stamps idempotency_key/hostname/os, redacts, and appends to JSONL. **[VERIFIED: codebase — `daemon/src/adapters/adapter.ts`, `registry.ts`]**

> **Dependency gap [VERIFIED: POC]:** chokidar is NOT currently a daemon dependency — `daemon/package.json` lists only `@clack/prompts` and `@fennec/shared`. The plan MUST add `chokidar@^5.0.0` (ESM-only, Node ≥20; the CLAUDE.md stack pin). Falsify: `node -e "console.log(require('/Users/Tanmai.N/Documents/fennec/daemon/package.json').dependencies)"` → currently shows no chokidar.

## A.1 — Codex CLI adapter (CAP-03)

**CLAIM A1.1 [HIGH — verified live POC]:** Codex CLI writes per-session transcripts at `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO8601-with-dashes>-<uuid>.jsonl` on macOS (e.g. `~/.codex/sessions/2026/06/27/rollout-2026-06-27T15-39-10-019f088d-...jsonl`). The synapse glob roots at `~/.codex/sessions`; the real layout is date-nested under it, so the watcher must watch `~/.codex/sessions` **recursively** (chokidar recurses by default) and filter to `*.jsonl`.
*Falsify:* `find ~/.codex/sessions -name '*.jsonl' | head` returns date-nested rollout files.

**CLAIM A1.2 [HIGH — verified live POC]:** The current (v2) Codex line schema is `{timestamp, type, payload}` where `type ∈ {session_meta, response_item, event_msg, turn_context, ...}`. The session id is `payload.id` on the `session_meta` line; `cwd` is on `session_meta.payload.cwd`. A user/assistant turn is a `type:"response_item"` line with `payload.type:"message"`, `payload.role:"user"|"assistant"`, and `payload.content` as an array of typed blocks (`{type:"input_text"|"output_text", text}`). This matches synapse `codex.ts` exactly.
*Falsify:* `head -5 <rollout file> | jq '{type, payloadType: .payload.type, keys: (.payload|keys)}'`.

**CLAIM A1.3 [HIGH — verified live POC] — one-prompt→one-row mapping (avoids multi-row):** A single Codex user prompt appears on the SAME file as BOTH a `response_item`(`payload.type:"message"`, role `user`) line AND an `event_msg`(`payload.type:"user_message"`) line with identical `timestamp`. Emitting on both would double-count. **The adapter must filter to exactly one — emit only on `response_item`+`payload.type:"message"`** (synapse's choice), treating `event_msg`/`turn_context` as noise.
*Falsify:* in a real session, `grep -c user_message <file>` and `grep -c '"type":"message"' <file>` for the same prompt both ≥1.

**CLAIM A1.4 [HIGH — verified live POC]:** The model name is on the `turn_context` line at `payload.model` (e.g. observed `"llama3.2:1b"` for a local model). Codex emits a `type:"token_count"` `event_msg` line carrying `payload.info` + `payload.rate_limits` (both `null` for local models with no usage; populated for hosted models). Token usage for Codex is therefore on a SEPARATE line from the prompt — the adapter that wants per-prompt tokens must associate the nearest `token_count` line to the turn, OR (simpler v1) carry model on the prompt event and leave token usage to the `token_count` event if present.
*Falsify:* `grep '"type":"token_count"' <file>` shows the event; `grep turn_context <file> | jq .payload.model` shows the model.

**CLAIM A1.5 [MEDIUM — multi-source]:** Codex still ships an older v1 flat-line format (`{type:"message", role, content:<string>, session_id, ...}`). Per-line v1/v2 detection (presence of a `payload` object = v2) makes the parser tolerant to a version bump (D2-03). Recommend mirroring synapse's per-line discriminator. *Falsify:* install an older `codex` build and confirm flat lines lack `payload`.

> **Tail-on-append (D2-02):** Codex appends turns to the SAME rollout file as the session proceeds. The adapter should track a per-file byte offset and parse only newly-appended lines on each chokidar `change` event, not re-parse the whole file (which would re-emit every prior turn → duplicates, though idempotency_key dedupes at backend). Discretion on in-memory vs offset-file bookkeeping (Claude's Discretion).

## A.2 — Gemini CLI adapter (CAP-04)

**CLAIM A2.1 [HIGH — verified live POC]:** Gemini CLI's transcript root on macOS is `~/.gemini/tmp` (synapse `watchPaths()` confirmed). The v2 chat files live at `~/.gemini/tmp/<project>/chats/session-*.jsonl`. **The `chats/*.jsonl` files are ephemeral** — on this machine `~/.gemini/tmp/<project>/` contained only `.project_root` (no live chats), and `~/.gemini/history/<project>/` likewise. gemini-cli writes the chat JSONL during a session and may clean it afterward.
*Falsify:* `find ~/.gemini -name '*.jsonl'` — may be empty between sessions; run a `gemini` prompt and re-check to see `session-*.jsonl` appear under `tmp/<project>/chats/`.

**CLAIM A2.2 [HIGH — verified codebase, synapse `gemini.ts`]:** The v2 JSONL format: first line is `session_meta` (`{sessionId, projectHash?, startTime?, kind:"main"}`); subsequent lines are `$set` deltas where `$set.messages` is a **FULL snapshot** up to that point (NOT a patch). The adapter must keep the LAST `$set.messages` it sees, not accumulate (accumulating duplicates every prior message). Each message is `{type:"user"|"model"|"assistant", content:[{text?, toolName?, input?, output?}], timestamp?}`.
*Falsify:* tail a live `session-*.jsonl`; the last `$set` line's `messages` array length equals the full conversation.

**CLAIM A2.3 [MEDIUM]:** v1 Gemini used a single `.json` doc (`{id, messages[], createdAt, updatedAt}`). Detect by extension: `.jsonl`→v2, `.json`→v1 (synapse pattern). *Falsify:* check an older gemini-cli build's file extension.

**CLAIM A2.4 [LOW — unverified, no live tokens observed]:** gemini-cli does not reliably persist per-turn token usage in the transcript (none observed). For v1, capture model + prompt/response text; treat token usage as best-effort/absent (cost worker will null-out tokens it can't find — see §C.11 null handling). **Verify-at-build-time:** run a real Gemini session and inspect whether `session-*.jsonl` carries any token/usage field. *Falsify:* `grep -i token ~/.gemini/tmp/*/chats/*.jsonl` after a session.

> **One-prompt→one-row (CAP-04 acceptance):** because gemini's `$set` is a full snapshot, naive emit-per-snapshot would re-emit every message each turn. The adapter must diff against the prior emitted snapshot (by message id/index) and emit only the newly-appeared user message(s). idempotency_key derivation (session_id + monotonic seq) at the registry backstops duplicates, but the adapter should still emit one EmitInput per genuinely-new prompt.

## A.3 — Cursor IDE adapter (CAP-05) — STATE-flagged risk, RESOLVED by POC

**CLAIM A3.1 [HIGH — verified live POC] ⚠ REFINES D2-04/Q3/Q4:** Modern Cursor stores chat/AI-usage in a **GLOBAL** SQLite DB at `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (149 MB on this machine), NOT in per-workspace `.json` files. The synapse `cursor.ts` adapter (which parses `workspaceStorage/<hash>/*.json`) is **outdated** for current Cursor and must NOT be copied verbatim. There is also a per-workspace `workspaceStorage/<md5>/` tree, but the AI conversation content is in the global `state.vscdb`.
*Falsify:* `ls -la "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"` (exists, ~149MB); `sqlite3` / `node:sqlite` shows tables `ItemTable`, `cursorDiskKV`.

**CLAIM A3.2 [HIGH — verified live POC]:** The DB has two tables: `ItemTable(key TEXT, value TEXT)` (342 rows, VS-Code-style settings) and `cursorDiskKV(key TEXT, value TEXT)` (10,980 rows, Cursor's chat store). Chat data lives in `cursorDiskKV` under keyed prefixes:
- `bubbleId:<composerId>:<bubbleId>` → one chat message (3,843 rows). Value JSON has `type` (1=user, 2=assistant), `text`, `richText`, `tokenCount:{inputTokens,outputTokens}`, `modelInfo:{modelName}`, `createdAt` (ISO8601), `requestId`.
- `composerData:<id>` → conversation container (268 rows). Value JSON has `composerId`, `conversationMap`, `fullConversationHeadersOnly`, `usageData`, `modelConfig`, `createdAt`, `status`.
- `messageRequestContext:<bubbleId>:<KIND>` → per-request context (162 rows; some values are non-JSON/binary).
*Falsify:* open read-only, `SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 1` then `JSON.parse(value)` and inspect keys — observed `type`, `text`, `tokenCount`, `modelInfo`, `createdAt`.

**CLAIM A3.3 [HIGH — verified live POC] — token + model location:** A `bubbleId` value carries `tokenCount:{inputTokens, outputTokens}` (observed `{"inputTokens":0,"outputTokens":0}` for many rows — Cursor does not always populate; non-zero when usage is recorded) and `modelInfo:{modelName}` (observed `"claude-4.5-opus-high-thinking"`). So the Cursor adapter CAN map: prompt = `bubbleId` with `type:1` (text→`prompt_text`), model = `modelInfo.modelName`, tokens = `tokenCount`, occurred_at = `createdAt`.
*Falsify:* scan 400 bubbles → found rows with non-empty `text` + `modelInfo.modelName` + `tokenCount`.

**CLAIM A3.4 [HIGH — verified live POC] ⚠ RESOLVES Q4 — the safe read mechanism, zero native deps:** Node 22.23.1's **built-in `node:sqlite`** (`const { DatabaseSync } = require("node:sqlite")`) opens the live 149MB `state.vscdb` **read-only** via `new DatabaseSync(path, { readOnly: true })` and reads `cursorDiskKV` successfully **while Cursor is running**. A write attempt against a `{readOnly:true}` handle throws `"attempt to write a readonly database"`. Five rapid sequential read-only opens all succeeded. This means **no `better-sqlite3`, no copy-then-read needed in the common case** — directly satisfying D2-04's read-only posture and the daemon's zero-native-dep constraint.
*Falsify:* `node -e 'const{DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(PATH,{readOnly:true});console.log(d.prepare("SELECT COUNT(*) c FROM cursorDiskKV").get());'` (works; ExperimentalWarning is emitted but non-fatal).

**CLAIM A3.5 [HIGH — verified live POC] — WAL implication:** `state.vscdb` is in `journal_mode=wal` with live `state.vscdb-wal` and `state.vscdb-shm` sidecars present. A read-only `node:sqlite` open of a WAL DB sees the last checkpointed state plus committed WAL frames at open time; it does NOT block Cursor's writers and is not blocked by them. **Caveat [MEDIUM]:** a pure `readonly` (not `immutable`) open of a WAL DB requires read access to the `-shm`/`-wal` sidecars and the containing directory; if Cursor holds an exclusive lock during a checkpoint, an open could transiently fail — the adapter should treat an open failure as a soft error (heartbeat `parse_errors`, retry next tick), and the **copy-then-read fallback (D2-04) remains the documented escape hatch** for any locked-DB edge case.
*Falsify:* `ls ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb-{wal,shm}` (present); `PRAGMA journal_mode` returns `wal`.

> **`node:sqlite` stability note [MEDIUM]:** `node:sqlite` is marked **experimental** in Node 22 (emits `ExperimentalWarning: SQLite is an experimental feature`). It is `require`-able WITHOUT a flag on 22.23.1 (the `--experimental-sqlite` flag is needed only on earlier 22.x). The API surface (`DatabaseSync`, `prepare().all()/.get()`, `{readOnly:true}`) is stable enough for read-only use. **Verify-at-build-time:** confirm the daemon's pinned Node 22 minor exposes `node:sqlite` without a flag (`node -e "require('node:sqlite')"`). If a future Node 22 patch reverts to flag-gating, the daemon launch can add `--experimental-sqlite` to its node invocation.

> **Watch target (D2-02/D2-04):** chokidar-watch the `state.vscdb` file's mtime (not a long-lived DB connection). On `change`, open read-only, query `cursorDiskKV` for `bubbleId` rows with `createdAt` newer than the last-seen watermark, emit one event per new user bubble, close the handle. Note WAL writes may not bump the main file's mtime promptly (writes land in `-wal`); also watch `state.vscdb-wal` mtime as a change trigger. **Verify-at-build-time:** confirm a new Cursor prompt changes the mtime of either `state.vscdb` or `state.vscdb-wal` within the poll window. *Falsify:* `stat -f %m` the files before/after a Cursor prompt.

## A.4 — git-watcher adapter (CAP-09)

**CLAIM A4.1 [HIGH — verified live POC]:** Watch `.git/HEAD` (21 bytes; changes on branch switch/checkout) and `.git/logs/HEAD` (the reflog; appended on every commit/checkout/reset/revert) per registered repo. Working-tree edits (`file_edit`) require watching tracked files or polling `git status --porcelain`. *Falsify:* `ls -la .git/HEAD .git/logs/HEAD` (both exist); commit/checkout and watch `.git/logs/HEAD` grow.

**CLAIM A4.2 [HIGH — verified live POC] — event_type derivation:** `.git/logs/HEAD` reflog lines carry a trailing message that discriminates the event:
- `commit: <subject>` → `event_type = "commit"`.
- `commit (revert): <subject>` OR a commit whose `<subject>` matches `^Revert "` → `event_type = "revert"` (D2-06 v1 rule).
- `checkout: moving from <A> to <B>` → `event_type = "branch_switch"`.
- working-tree change not yet committed → `event_type = "file_edit"` (derived from FS watch / `git status`, NOT the reflog).
*Falsify:* `git reflog -5` on this repo shows `HEAD@{0}: commit: docs(02)...`; the message prefix is the discriminator.

**CLAIM A4.3 [HIGH — verified live POC] — cheap context fields:** Use porcelain, not file parsing, for the canonical fields:
- `repo_remote` = `git config --get remote.origin.url` (observed `https://github.com/tanmain/fennec.git`).
- `repo_branch` = `git rev-parse --abbrev-ref HEAD` (observed `main`).
- `occurred_at` (for a commit) = `git show -s --format=%cI HEAD` (committer date, ISO8601 strict; observed `2026-07-01T03:22:11+05:30`). For a branch_switch/file_edit, use `new Date().toISOString()` at detection time.
*Falsify:* run each command in any repo; all return immediately.

**CLAIM A4.4 [HIGH — verified codebase] — no schema_version bump (confirms D2-06):** The git event kinds live in the `git_events.event_type` CHECK constraint (`CHECK (event_type IN ('commit','revert','file_edit','branch_switch'))` in `20260531000003_git_events_partitioned.sql`), NOT in `@fennec/shared`'s `EventKindSchema` (which enumerates only `ai_events` kinds: `prompt_submitted|tool_call|session_start|session_end|pre_compact|subagent_stop|model_response`). The git-watcher emits to `git_events`, so `schema_version` (`z.literal(1)`) does NOT change.
*Falsify:* grep `EventKindSchema` in `packages/shared/src/events/kinds.ts` — no git kinds; grep the CHECK in the git_events migration — has them.

> **Architectural note [HIGH] — the git-watcher does NOT use the ai_events `EmitInput` path cleanly.** The existing `Adapter`/`EmitInput`/registry pipeline targets `ai_events` (it builds a `CanonicalEvent` and appends to the JSONL queue that syncs to `POST /api/events/batch` → `ai_events`). `git_events` is a different table with a different shape (`{id, org_id, occurred_at, repo_remote, repo_branch, event_type, payload, schema_version}`, no `idempotency_key`/`tool`/`kind`). **The plan must decide the git transport** — two viable options: (a) extend the canonical envelope + ingest to route `tool:"git"` events into `git_events` (the `git` value already exists in `ToolSchema`), keeping the git-watcher on the standard adapter path; or (b) a separate git-events queue/endpoint. Option (a) is more consistent with "one adapter contract" but requires the ingest hot path to branch by tool (still a dumb branch, ING-04-safe). **This is a genuine plan-time design decision — flag for the planner.** *Falsify:* inspect `events-batch.ts` — it only inserts into `ai_events` via `insertAiEvent`; there is no git_events insert path today.

---

# B. The two out-of-process capture clients (CAP-06/07/08)

> Both POST to the existing `LoopbackBridge` (`daemon/src/adapters/loopback-bridge/server.ts`), which binds `127.0.0.1` only, validates `X-Fennec-Shim-Secret`, parses JSON, and emits an EventEmitter event. Phase 2 adds a `POST /v1/events` route (D2-08) and a new daemon-side normalising adapter that subscribes to the new event and emits `tool:"copilot"|"chatgpt-web"|"claude-ai-web"`. **[VERIFIED: codebase]**

**CLAIM B0.1 [HIGH — verified codebase] — bridge route shape to mirror:** The existing `/v1/hook` handler: (1) checks `req.headers["x-fennec-shim-secret"]` BEFORE reading the body (401 on mismatch, logs `remoteAddr` but never the secret), (2) buffers `req.on("data")` chunks, `JSON.parse` on `end` (400 on parse error, never echoes body), (3) `this.emit("hook", parsed)`, (4) responds `202`. The new `/v1/events` handler should mirror this exactly but `this.emit("events", parsed)`. The daemon wires a new adapter subscribing to `"events"` in `daemon/src/cli/daemon.ts` step 6/7 (where `ClaudeCodeAdapter` subscribes to `"hook"` today).
*Falsify:* read `handleHookPost` in `server.ts`; the new route is structurally identical.

## B.5 — Copilot VS Code sidecar (CAP-06)

**CLAIM B5.1 [HIGH — verified live POC] ⚠ REFINES Q3 — Copilot chat is NOT in `github.copilot-chat/globalStorage`:** The `~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/` directory holds `commandEmbeddings.json` (21 MB), `copilotCli/` shims, and `debugCommand/` — **not** chat history. The actual VS Code Copilot **chat sessions** are at `~/Library/Application Support/Code/User/workspaceStorage/<md5>/chatSessions/<uuid>.json` (one JSON file per chat session, per workspace).
*Falsify:* `find "~/Library/Application Support/Code/User/workspaceStorage" -path '*chatSessions*' -name '*.json' | head` returns session files; `ls "~/.../github.copilot-chat/"` shows embeddings/CLI, not chats.

**CLAIM B5.2 [HIGH — verified live POC] — chatSessions JSON shape:** Each `chatSessions/*.json` (observed `version:3`) has top-level `{version, requesterUsername, responderUsername, requests[], sessionId, creationDate, lastMessageDate}`. Each `requests[i]` has `{requestId, message:{text, parts}, response[], responseId, result:{errorDetails, timings, metadata:{modelMessageId, responseId, sessionId, agentId}}, timestamp, modelId, agent, contentReferences}`. The prompt is `requests[i].message.text`; the model is `requests[i].modelId` (observed `"github.copilot-chat/gpt-4.1"`); the response is `requests[i].response`.
*Falsify:* `jq '{version, req0keys: (.requests[0]|keys), text: .requests[0].message.text, model: .requests[0].modelId}' <chatSessions json>`.

**CLAIM B5.3 [LOW — verified absence] — NO token counts in Copilot chat files:** The `chatSessions/*.json` format carries no per-turn token usage (no `usage`/`tokens`/`totalTokens` field observed; only `modelId` and timing). This means the Copilot surface yields model + prompt/response text but **no token-level cost data** — the cost worker must handle Copilot rows with absent tokens (model-level only, or subscription-only accounting per ANL-09). This aligns with CLAUDE.md's MEDIUM/LOW rating for Copilot. *Falsify:* `grep -i token <chatSessions json>` → no match.

**CLAIM B5.4 [HIGH — verified live POC] — closed built-in chat (confirms CLAUDE.md):** The VS Code Chat Participant / Language Model APIs do NOT observe prompts sent to the built-in Copilot Chat (a participant only sees prompts explicitly routed to it via `@participant`). The viable capture path is therefore **reading `chatSessions/*.json` on a timer** (the "sidecar reads cache" path c from CLAUDE.md), confirmed because those files contain the full prompt/response that the public API cannot intercept. *Falsify:* there is no Chat Participant event that fires for a plain Copilot Chat prompt — the only place the prompt persists is the chatSessions file.

**CLAIM B5.5 [MEDIUM] — minimal VS Code extension shape (vsce):** A capture-only extension needs `package.json` with `engines.vscode` (set to a baseline ≤ the dev machine's VS Code, e.g. `"^1.95.0"`), `activationEvents:["onStartupFinished"]` (so it runs without a command), `main:"./out/extension.js"`, and `@types/vscode` matching the engines baseline. On activate, set a `setInterval`/timer that reads `chatSessions/*.json` (via `vscode.workspace.fs` or `node:fs` — VS Code extensions run in Node), diffs against last-seen `requestId`s (buffer in `context.globalState`), and POSTs new requests to `http://127.0.0.1:7821/v1/events` with the pairing-token header. Package with `vsce package` → `.vsix`, install with `code --install-extension`. **Verify-at-build-time:** confirm the dev machine's VS Code version and `@types/vscode` baseline. *Falsify:* `code --version`; a `.vsix` built against a too-new `engines.vscode` refuses to install on an older VS Code.

> **Plan note:** Because the chatSessions files are plain JSON on the local FS, a daemon in-process adapter could read them directly (no sidecar needed) — but CONTEXT D2 explicitly locks the **vsce sidecar** approach (the extension reads its own workspaceStorage and POSTs to the bridge). The sidecar's advantage is it runs inside VS Code's own context/permissions and is the documented per-IDE pattern; the file-read is identical either way. Honor D2 (sidecar), but note the daemon could fall back to a direct file-watch adapter if the sidecar proves fragile (this is a reversible architecture choice; flag as Q-candidate).

## B.6 — Browser MV3 extension (CAP-07/08) — highest-risk surface

**CLAIM B6.1 [MEDIUM — multi-source, not POC-verified here]:** The only MV3-viable capture path is a content script injected `world:"MAIN"`, `run_at:"document_start"` that overrides `window.fetch` and `XMLHttpRequest.prototype.send` before page JS loads, then posts captured request/response bodies to the extension service worker via `chrome.runtime.sendMessage`. `declarativeNetRequest` cannot inspect bodies (declarative-only) and is unusable for capture. This is the locked CLAUDE.md approach. **Verify-at-build-time (Q2/Q8):** build a minimal extension and confirm the monkeypatch fires on a live ChatGPT.com/Claude.ai chat completion in late-2026. *Falsify:* load the extension, open ChatGPT, submit a prompt, check the SW console for a captured fetch to the completions endpoint.

**CLAIM B6.2 [LOW — anti-bot risk, external/unverifiable here]:** ChatGPT.com and Claude.ai run anti-bot/integrity scripts that MAY detect a monkeypatched `fetch`. Mitigation: smallest possible wrapper that preserves `fn.toString()` (return the native source string), preserves `[Symbol.toStringTag]`, and does not mutate the prototype chain. Synapse has no such code — net-new for fennec. **This is the load-bearing uncertainty behind Q2's defer option.** *Falsify:* after monkeypatching, `window.fetch.toString()` should still read `function fetch() { [native code] }`; if the site breaks or flags the session, the monkeypatch was detected.

**CLAIM B6.3 [LOW — verify-at-build-time] — request shapes to capture:** The content script must know which request URL/shape is a chat completion:
- ChatGPT.com: historically `POST https://chatgpt.com/backend-api/conversation` (SSE streaming response). **Verify-at-build-time** — the path may have changed by late 2026.
- Claude.ai: historically `POST https://claude.ai/api/organizations/<org-uuid>/chat_conversations/<conv-uuid>/completion` (SSE streaming). **Verify-at-build-time.**
*Falsify:* open DevTools Network on each site, submit a prompt, read the request URL + method of the streaming completion call. Treat both as MEDIUM-volatile; the content script should match a URL pattern (e.g. `*/backend-api/conversation*`, `*/completion*`) rather than an exact string.

**CLAIM B6.4 [HIGH — verified docs] — MV3 SW lifecycle + buffer/flush:** The MV3 service worker is killed after ~30s idle, so it cannot hold a long-lived flush loop. Pattern: content script → `chrome.runtime.sendMessage` → SW writes to `chrome.storage.local` (≤ ~5–10 MB quota) → a `chrome.alarms` alarm wakes the SW periodically to flush the buffer to the daemon. **`chrome.alarms` minimum period is 1 minute** (`periodInMinutes` < 1 is clamped to 1 in production). So worst-case flush latency is ~1 min — comfortably inside the 5-minute acceptance window (CAP-07/08). *Falsify:* `chrome.alarms.create({periodInMinutes:0.5})` is clamped to 1 min; docs state the 30s SW idle teardown.

**CLAIM B6.5 [HIGH — verified codebase] — flush target + pairing handshake:** The extension flushes to `POST http://127.0.0.1:7821/v1/events` (port 7821 = `LOOPBACK_PORT` in `daemon/src/cli/daemon.ts`, matching the shim's `defaultPort`). It must send the pairing-token header (`X-Fennec-Shim-Secret` or the neutral alias per D2-09). **A browser extension CANNOT read the on-disk secret file** (`/etc/fennec/shim-secret`, root-readable). The actual pairing handshake must be one of:
- **(a) Copy-paste token [recommended v1]:** `fennec inspect`/a `fennec pair` command prints the pairing token; the user pastes it into the extension's options page once; the extension stores it in `chrome.storage.local`. Simplest, no new endpoint.
- **(b) `/v1/pair` bootstrap endpoint:** an unauthenticated-but-rate-limited `GET /v1/pair` on the loopback bridge that returns the token to any localhost caller (acceptable under Pattern 9's threat model — same-UID processes already have queue access). Lower friction, but widens the bridge surface.
**Recommendation: (a)** for v1 — it matches D2-09 ("read it during a one-time pairing step") without enlarging the bridge. *Falsify:* the secret file is mode 0644 root-owned (`secret-store.ts` writes `/etc/fennec/shim-secret`); a sandboxed extension has no filesystem read of it → must obtain the token via the browser-accessible path.

> **CAP-07/08 acceptance is satisfiable either way (D2-11/Q2):** the loopback bridge + `/v1/events` route + a daemon normalising adapter are built regardless of GA. If the monkeypatch/anti-bot/store-review risks (B6.1/B6.2/B6.3) don't resolve cleanly during the build, the phase records "submit-and-wait"/"defer" with the architecture intact. The plan should treat the browser extension as the **last** task block so a defer decision doesn't strand earlier work.

---

# C. The backend analysis layer (ANL-01..05, ANL-07..09)

## C.7 — Queue producer + consumers (ANL-01/04)

**CLAIM C7.1 [HIGH — verified docs] — wrangler.jsonc binding shape:** Producer + consumer blocks live under a top-level `"queues"` key:
```jsonc
"queues": {
  "producers": [{ "binding": "EVENTS_QUEUE", "queue": "fennec-events" }],
  "consumers": [{
    "queue": "fennec-events",
    "max_batch_size": 100,
    "max_batch_timeout": 5,
    "max_retries": 3,
    "dead_letter_queue": "fennec-events-dlq"
  }]
}
```
The producer is used in code via `await env.EVENTS_QUEUE.send(msg)` (or `sendBatch`). *Falsify:* `wrangler.jsonc` already has the commented stub `"producers":[{"binding":"CORRELATION_QUEUE","queue":"fennec-correlation"}]` to extend; the Cloudflare docs confirm the keys.

**CLAIM C7.2 [HIGH — verified docs] — config key names + ranges (confirms D2-13):** `max_batch_size` default 10, **max 100** (or 256 KB total per batch, whichever first). `max_batch_timeout` default 5, **max 60** (seconds). `max_retries` default 3. `dead_letter_queue` names another queue (auto-created if absent) that receives a message after it fails `max_retries` times; without a DLQ, repeatedly-failing messages are eventually discarded. D2-13's `100`/`5s` are exactly the documented max-batch-size / default-timeout. *Falsify:* Cloudflare "Batching, Retries and Delays" + "Limits" docs.

**CLAIM C7.3 [HIGH — verified docs] — consumer handler signature:** A push consumer Worker implements `async queue(batch, env, ctx)` where `batch` is a `MessageBatch` with `batch.queue` (queue name), `batch.messages[]` (each `{body, id, timestamp, attempts, ack(), retry()}`), and `batch.ackAll()`/`batch.retryAll()`. *Falsify:* Cloudflare "JavaScript APIs" / Hono Cloudflare-queue example.

**CLAIM C7.4 [HIGH — verified docs] ⚠ REFINES D2-14 — one push consumer per queue:** **A queue can have only ONE active push consumer.** Connecting two push-consumer Workers to the same queue is a publish-time error. D2-14's "correlation and model-fit are independent consumers of the same event stream" is therefore NOT expressible as one queue + two push-consumer Workers. Two compliant topologies:
- **Option A [recommended v1]:** ONE queue (`fennec-events`) + ONE consumer Worker whose `queue(batch)` handler runs BOTH `correlateEvent(msg)` and `scoreModelFit(msg)` per message (each an idempotent upsert per D2-15). One batch, one DB connection, shared event parse; the two operations stay logically independent functions and remain independently testable.
- **Option B:** TWO queues (`fennec-correlation`, `fennec-model-fit`); the ingest producer `send`s each event to BOTH; two consumer Workers. More moving parts, two DLQs, double the message volume.
**Recommendation: Option A** — simpler, cheaper, satisfies "two independent consumers" semantically (two independent functions) while honoring the Cloudflare 1-push-consumer constraint. *Falsify:* Cloudflare "How Queues Works" + the AnswerOverflow/community confirmation that two push consumers on one queue fails at publish.

**CLAIM C7.5 [HIGH — verified docs] — at-least-once → idempotency required (confirms D2-15):** Cloudflare Queues deliver at-least-once; a batch can be redelivered on `retry()`/timeout. Therefore correlation/model-fit MUST upsert keyed on the prompt event's `(idempotency_key)` (mirroring the ingest `INSERT ... ON CONFLICT (idempotency_key, occurred_at) DO NOTHING` pattern). A redelivered message re-derives the same `prompt_outcomes`/`model_fit_scores` row. *Falsify:* Cloudflare delivery-guarantees doc states at-least-once.

> **Hot-path purity (ING-04, D2-12) [HIGH — verified codebase]:** The enqueue in `events-batch.ts` is `await env.EVENTS_QUEUE.send(...)` — a binding call, not an analytics module import. The existing `events-batch.hot-path.test.ts` greps the handler source for `from "...correlation"`, `...model-fit`, `...aggregator`, `...analysis` imports. As long as the enqueue uses the binding (no import of a correlation/analysis module), the test keeps passing. **Place the enqueue AFTER the existing `insertAiEvent` loop** so a DB insert failure doesn't enqueue a non-persisted event. *Falsify:* run `daemon`/`backend` vitest after adding the enqueue — the 4 hot-path tests must stay green.

## C.8 — Correlation worker (ANL-01/02/03)

**CLAIM C8.1 [HIGH — verified docs/codebase] — ±N join via Hyperdrive→Supabase:** The consumer parses the prompt event's `occurred_at` + repo context (`git_remote`/`git_branch` from the canonical envelope), then queries `git_events` for rows where `occurred_at BETWEEN $prompt_at - interval '15 minutes' AND $prompt_at + interval '15 minutes'` AND matching `repo_remote` (and ideally `repo_branch`), via the per-request `pg.Client` over Hyperdrive (`backend/src/db/client.ts` pattern). N=15 is a worker config constant (D2-16/Q1). *Falsify:* the query plan uses `idx_..._occurred` range scan; a prompt+commit within 15 min returns the commit row.

**CLAIM C8.2 [HIGH — D2-17 invariant]:** Use a LEFT-JOIN-complete model: the worker ALWAYS writes exactly one `prompt_outcomes` row per prompt event, even when the git query returns zero rows (then `git_event_id` is null and `attribution_state = 'attributed'` with low confidence, or a neutral `no_outcome` state — planner's call). This makes `prompt_outcomes` a complete base for the aggregator's left join. *Falsify:* a prompt with no git activity still produces a row (`SELECT COUNT(*) FROM prompt_outcomes` == count of prompt events).

**CLAIM C8.3 [HIGH — D2-18 shape; MEDIUM thresholds (Q5)] — confidence interval, not a bare percentage:** `prompt_outcomes` carries `confidence_band TEXT CHECK (confidence_band IN ('low','medium','high'))` PLUS `confidence_low NUMERIC` + `confidence_high NUMERIC` (both NOT NULL, CHECK `confidence_low <= confidence_high`, CHECK both in `[0,1]`). A defensible v1 band rule (documented, tunable):
- **high** (e.g. bounds `[0.7, 0.95]`): time gap ≤ 5 min AND same `repo_remote` AND same `repo_branch` AND the correlated commit touches ≥1 file.
- **medium** (`[0.4, 0.7]`): gap ≤ 15 min AND same repo, branch may differ.
- **low** (`[0.1, 0.4]`): gap > 15 min OR repo mismatch OR no git activity in window.
A schema CHECK + a unit test reject any single bare-number representation (e.g. a lone `confidence` column would fail review). *Falsify:* attempt to insert a row with `confidence_low IS NULL` → CHECK violation; the band thresholds are constants in the worker, not magic numbers in SQL.

**CLAIM C8.4 [HIGH — D2-19] — revert downgrade as a state transition:** `prompt_outcomes` carries `attribution_state TEXT CHECK (attribution_state IN ('attributed','downgraded_by_revert','no_outcome'))` + `downgraded_at TIMESTAMPTZ NULL` + `downgrade_reason TEXT NULL`. When a `git_events` row with `event_type='revert'` correlates (same repo, the revert's subject references the prior commit, within window) to a prompt that previously had `attributed`, the worker UPDATEs that existing row to `downgraded_by_revert` + stamps `downgraded_at`/`downgrade_reason` — it NEVER decrements an aggregate total. The aggregator (§C.10) reads the current `attribution_state` at run time. The original attribution + the downgrade are both traceable (the row retains its original `git_event_id`/confidence + adds the downgrade fields). *Falsify:* a prompt→commit→revert sequence yields one `prompt_outcomes` row with `attribution_state='downgraded_by_revert'` and a non-null `downgraded_at`; no rollup total is mutated by the correlation worker.

> **Revert↔prior-commit linkage [MEDIUM]:** v1 detects the revert via `event_type='revert'` (set by the git-watcher per A4.2) and links it to the prompt by the same ±15-min/repo correlation as a normal commit, then checks whether the reverted commit was itself a previously-attributed outcome. Richer "this revert undoes THAT specific commit" linkage (parsing the revert subject for the original SHA) is a refinement; v1 may downgrade based on a revert in-window for the same repo/branch. **Flag as Q-candidate** (precision of revert→commit matching).

## C.9 — Model-fit worker, rule-based (ANL-04)

**CLAIM C9.1 [HIGH — D2-20] — pure, no-network scorer + the guard test:** `scoreModelFit(promptEvent, correlatedGitEvent?)` is a pure function. Inputs: `promptLength` (chars or token estimate from `payload.prompt_text`), `fileEditSize` (lines added+removed from the correlated git event, else 0), `toolCallCount` (count of `tool_call`-kind events in the session), `modelTier` (from the model→tier lookup). Reuse the **exact static-import-guard technique** from `events-batch.hot-path.test.ts`: a vitest that `readFileSync`s the scorer source and asserts `expect(source).not.toMatch(/from\s+['"][^'"]*(fetch|http|undici|node:net|node:https)/)` and contains no `fetch(`/`XMLHttpRequest`. *Falsify:* add a `fetch(` to the scorer → the guard test fails.

**CLAIM C9.2 [HIGH — D2-21 shape; MEDIUM weights (Q6)] — transparent weighted score:** v1 = a documented weighted "task heaviness" `H = w1·norm(promptLength) + w2·norm(fileEditSize) + w3·norm(toolCallCount)`, compared against the chosen model's tier. Verdict logic: heavy task + small/mid model → `under_powered`; light task + frontier model → `over_powered`; aligned → `fit`. Persist BOTH the numeric score AND the input signals (`model_fit_scores` columns: `score NUMERIC`, `fit_verdict TEXT CHECK (...)`, `prompt_length INT`, `file_edit_size INT`, `tool_call_count INT`, `model TEXT`, `model_tier TEXT`) so the verdict is explainable/re-derivable. Starting weights are documented tunable constants (e.g. `w1=0.4, w2=0.4, w3=0.2`; cutoffs tuned against staging data). *Falsify:* `SELECT * FROM model_fit_scores LIMIT 1` shows score + all input signals; recomputing the formula from the stored signals reproduces the score.

**CLAIM C9.3 [HIGH — D2-22] — model→tier in data:** A `model_tier` lookup (frontier/mid/small) is seeded as data alongside `model_pricing` (a `pricing_kind='per_token'` row's `model` plus a `tier` column, OR a small sibling `model_tiers` table). Adding a model is a data migration, not code. Seed mapping (current models, §C.11): frontier = Opus 4.x / GPT-5.5 / Sonnet 5; mid = Sonnet 4.x / GPT-4.1 / gpt-4o; small = Haiku 4.5 / GPT-4.1-nano / GPT-5.4-nano. *Falsify:* adding a new model's tier is an INSERT, not a code change; grep the scorer for a hardcoded model→tier switch → none.

## C.10 — Daily aggregator cron (ANL-05)

**CLAIM C10.1 [HIGH — verified docs] — cron config + handler:** Cron triggers go under a top-level `"triggers": { "crons": ["0 2 * * *"] }` in `wrangler.jsonc` (cron expressions, UTC). The Worker implements `async scheduled(controller, env, ctx)`; `controller.cron` distinguishes which schedule fired (for multiple crons); use `ctx.waitUntil()` for async work. Test locally with `wrangler dev --test-scheduled` then hit `/__scheduled`. *Falsify:* Cloudflare "Cron Triggers" + "Scheduled Handler" docs; the `scheduled` handler is a sibling of `fetch`/`queue` in the default export.

**CLAIM C10.2 [HIGH — D2-23] — idempotent per-day upsert:** The aggregator reads raw `ai_events`/`git_events`/`prompt_outcomes`/`model_fit_scores` for the target day, computes per-user and per-project aggregates, and UPSERTs (`INSERT ... ON CONFLICT (org_id, user_id, day) DO UPDATE SET ...`) so a re-run for the same day REPLACES that day's rollup rows (never appends). The rollup tables have a unique key on `(org_id, user_id, day)` / `(org_id, project_id, day)`. *Falsify:* run the cron twice for the same day → row count for that day is stable; totals reconcile with a direct raw query (the acceptance test).

**CLAIM C10.3 [MEDIUM] — reconcile test shape:** The acceptance test seeds N events for a day, runs `scheduled` (via the test-scheduled route or by calling the handler directly with a mocked `env`), then asserts `daily_rollups_by_user.event_count == (SELECT COUNT(*) FROM ai_events WHERE day=...)` and `cost_estimated == (direct recomputation from raw events × model_pricing)`. **Verify-at-build-time:** Worker-runtime tests need `@cloudflare/vitest-pool-workers` which is NOT yet installed (Wave 0 gap). *Falsify:* `npm ls @cloudflare/vitest-pool-workers` in backend → absent today.

## C.11 — Cost model (ANL-07/08/09)

**CLAIM C11.1 [HIGH — D2-24/ANL-06] — cache tokens are four distinct multiplications:**
```
cost_estimated =
    input_tokens                 × price(model,'input',          occurred_at)
  + output_tokens                × price(model,'output',         occurred_at)
  + cache_creation_input_tokens  × price(model,'cache_creation', occurred_at)
  + cache_read_input_tokens      × price(model,'cache_read',     occurred_at)
```
The four token fields are already captured verbatim per event (Phase 1 `AnthropicUsageSchema`, partial, all four optional non-negative ints). A unit test must assert the formula references `cache_creation_input_tokens` and `cache_read_input_tokens` as separate terms (grep the worker source for both field names + that they multiply by DISTINCT price columns — no single collapsed input figure). *Falsify:* the worker source contains four multiplications; a test feeding `{input:1000, cache_read:9000}` produces a cost using BOTH the input AND cache_read prices (not 10000×input_price).

**CLAIM C11.2 [HIGH — verified Anthropic docs 2026-07-01; MEDIUM currency] — seed pricing (Claude), USD per 1M tokens:** Anthropic's current per-MTok prices (5-minute cache write = 1.25× base input; cache read/hit = 0.1× base input):

| Model | input | output | cache_creation (5m write) | cache_read (hit) |
|-------|-------|--------|----------------------------|-------------------|
| Claude Opus 4.8 (frontier) | $5 | $25 | $6.25 | $0.50 |
| Claude Opus 4.5/4.6/4.7 | $5 | $25 | $6.25 | $0.50 |
| Claude Sonnet 5 (introductory, through 2026-08-31) | $2 | $10 | $2.50 | $0.20 |
| Claude Sonnet 5 (from 2026-09-01) | $3 | $15 | $3.75 | $0.30 |
| Claude Sonnet 4.5/4.6 | $3 | $15 | $3.75 | $0.30 |
| Claude Haiku 4.5 (small) | $1 | $5 | $1.25 | $0.10 |

**Note the Sonnet 5 effective-date cutover (2026-08-31→09-01) is itself a textbook test case for the `effective_from`/`effective_to` machinery** — seed BOTH rows. *Falsify:* `platform.claude.com/docs/en/docs/about-claude/pricing` table; re-verify at build (volatile).

**CLAIM C11.3 [MEDIUM — verified OpenAI 2026-07-01; volatile] — seed pricing (GPT), USD per 1M tokens:** As of 2026-07-01 OpenAI's flagship is GPT-5.5; cached-input discount varies by family (GPT-5 family ~90% off cached, GPT-4.1 ~75%, GPT-4o ~50%):

| Model | input | output | cached input (≈cache_read) |
|-------|-------|--------|-----------------------------|
| GPT-5.5 (frontier) | $5.00 | $30.00 | $0.50 |
| GPT-5.4 | $2.50 | $15.00 | (≈90% off) |
| GPT-4.1 (mid) | $2.00 | $8.00 | (≈75% off) |
| GPT-4o | $2.50 | $10.00 | $1.25 |
| GPT-4.1-nano (small) | $0.10 | — | — |

OpenAI's API does not have a separate cache-CREATION charge (caching is automatic, no write fee) — so for GPT models seed `cache_creation` = `input` price (no separate write) and `cache_read` = the cached-input price. **Verify-at-build-time** — these moved substantially vs CLAUDE.md's training-era assumptions; confirm against `developers.openai.com/api/docs/pricing` before seeding. *Falsify:* OpenAI pricing page.

**CLAIM C11.4 [HIGH — verified docs] — non-overlapping effective-date enforcement (ANL-08):** Enforce non-overlap per `(model, token_kind)` with a Postgres exclusion constraint (requires `CREATE EXTENSION IF NOT EXISTS btree_gist;`):
```sql
ALTER TABLE model_pricing
  ADD CONSTRAINT model_pricing_no_overlap
  EXCLUDE USING gist (
    model        WITH =,
    token_kind   WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
  WHERE (pricing_kind = 'per_token');
```
`btree_gist` lets the scalar `=` columns share a GiST index with the `&&` range overlap operator. The aggregator selects `WHERE model=$m AND token_kind=$k AND occurred_at >= effective_from AND (effective_to IS NULL OR occurred_at < effective_to)`. (PG18 offers `WITHOUT OVERLAPS` temporal PKs as a cleaner alternative if the Supabase Postgres is ≥18 — **verify Supabase PG version**; Phase 1 migrations target PG15+, so use the EXCLUDE form.) *Falsify:* inserting two overlapping ranges for the same `(model, token_kind)` raises a constraint violation; two non-overlapping ranges cost pre/post-cutover events differently.

**CLAIM C11.5 [HIGH — D2-25] — estimated vs billed columns:** Rollups carry `cost_estimated NUMERIC NOT NULL` (always computed from tokens × effective price) and `cost_billed NUMERIC NULL` (null until vendor-billing reconciliation, which is OUT OF SCOPE to fetch this phase — the column + null-handling IS the deliverable). *Falsify:* a fresh rollup has populated `cost_estimated` and `cost_billed IS NULL`.

**CLAIM C11.6 [HIGH — D2-27/Q7] — subscription accounting (recommend `pricing_kind` discriminator):** Use ONE `model_pricing` table with `pricing_kind TEXT CHECK (pricing_kind IN ('per_token','subscription'))`. Per-token rows use `token_kind` + the four-kind prices; subscription rows use `monthly_price` + `effective_from`/`effective_to` (e.g. one row per product: `copilot`, `chatgpt-web`). The rollup surfaces a DISTINCT `cost_subscription NUMERIC` field, **never summed into `cost_estimated`**. A test asserts `cost_estimated` excludes any subscription amount. This is leaner than a sibling table (one effective-date mechanism, one query path) — **recommend over the sibling `subscription_pricing` table.** *Falsify:* a rollup including Copilot usage shows `cost_subscription > 0` and `cost_estimated` unchanged by it; grep the aggregator → subscription amount is added to `cost_subscription`, never to `cost_estimated`.

**CLAIM C11.7 [HIGH — verified 2026-07-01; volatile] ⚠ REFINES D2-27/ANL-09 — subscription seed prices have CHANGED:**
- **GitHub Copilot Pro = $10/month** (NOT the $19 the SPEC/CONTEXT assume). On 2026-06-01 GitHub moved all Copilot plans to usage-based billing; Pro is $10/mo (includes $10 AI credits), Pro+ $39/mo, Max $100/mo. **The $19 figure in the SPEC is stale — seed $10.**
- **ChatGPT Plus = $20/month** (Pro = $200/mo; a $100 Pro tier launched 2026-04-09). The SPEC's "ChatGPT Pro $20/mo" conflates Plus and Pro — **the $20 tier is Plus.**
*Falsify:* `github.com/features/copilot/plans` (Pro $10); `chatgpt.com/pricing` (Plus $20). Re-verify at build; both are volatile and Copilot's move to usage-based billing means a flat-subscription model is itself an approximation for Copilot going forward (note for the planner: Copilot is now credit/usage-based, so "subscription" accounting for Copilot is a simplification — flag as Q-candidate).

---

# D. `fennec inspect` (CAP-18)

**CLAIM D12.1 [HIGH — verified codebase] — dispatcher wiring:** Add an `inspect` case to the `switch (sub)` in `daemon/src/index.ts`'s `dispatch()` (alongside `wizard|init|uninstall|daemon`), and export a `runInspect` from a new `daemon/src/cli/inspect.ts`. Flags via the existing `getFlag(rest, "--since")` helper. *Falsify:* read the `switch` in `index.ts` — adding a case is the established extension point; `printUsage()` should gain the `inspect` line.

**CLAIM D12.2 [HIGH — verified codebase] — read local queue, not backend:** `fennec inspect` reads the local JSONL queue via `replayFromWatermark(queuePath, null)` (re-exported from `daemon/src/index.ts`, source `daemon/src/queue/jsonl.ts`), yielding `CanonicalEvent`s, filters to the last 24h by `occurred_at` (default; `--since <duration>` overrides), and prints `tool`, `occurred_at`, `kind`, redacted `payload`. It then prints the destination backend URL from `loadEnv().apiBaseUrl` (D2-29). It does NOT call the backend. *Falsify:* `replayFromWatermark(queuePath, null)` yields every queued event; the events carry `redaction_applied_at`/`redaction_version_hash` already.

**CLAIM D12.3 [HIGH — verified codebase] — redaction visibility is already an invariant (D2-30):** The registry redacts BEFORE `appendEvent` (`registry.ts` `makeEmit`: `redact(canonical)` → `appendEvent(redacted, queuePath)`). So queue contents are exactly what leaves the machine — `inspect` reading the queue inherently shows the redacted-as-stored payload. No separate redaction pass is needed; there is no raw-secret code path in `inspect`. *Falsify:* `makeEmit` calls `this.redact(canonical)` then `appendEvent(redacted, ...)` — the queue never holds an un-redacted event.

**CLAIM D12.4 [HIGH — D2-30] — canary test shape:** The CAP-18 test seeds the JSONL queue with an event whose payload contained a known canary secret BEFORE redaction (e.g. reuse `daemon/src/redact/canary-test.ts`'s `CANARIES`), runs `runInspect` over that queue, captures stdout, and asserts the raw canary string appears ZERO times (the redactor already replaced it; `inspect` just renders the stored redacted text). *Falsify:* inject a canary, run inspect, `expect(output).not.toContain(rawCanary)`.

**CLAIM D12.5 [HIGH — D2-31] — output modes:** Default = human-readable table (truncate long payload fields); `--json` = machine-readable JSON array (MEMORY: CLI+MCP+AI-friendly); `--since <duration>` overrides the 24h default; `--full` disables truncation. *Falsify:* `fennec inspect --json` emits parseable JSON; `--since 1h` narrows the window.

---

# E. Cross-cutting (migrations + shared validators)

## E.13 — Migrations + shared types

**CLAIM E13.1 [HIGH — verified codebase] — migration sequence + style:** Continue the timestamp sequence after `20260531000007` (the last Phase 1 migration is `20260531000007_seed_phase1_test_data.sql`). Phase 2 adds (suggested order): `..008_prompt_outcomes`, `..009_model_fit_scores`, `..010_model_pricing`, `..011_daily_rollups_by_user`, `..012_daily_rollups_by_project`, `..013_rls_policies_phase2` (or RLS inline per table per D2-28), `..014_seed_model_pricing`. Mirror Phase 1 style: `PARTITION BY RANGE (occurred_at)` for per-event tables, PK including the partition column, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY <t>_tenant_isolation ON <t> USING (org_id = (auth.jwt() ->> 'org_id')::uuid)` (the exact pattern in `20260531000006_rls_policies.sql`). *Falsify:* `ls supabase/migrations/` shows the `20260531...` sequence; the RLS policy pattern is copy-able verbatim.

**CLAIM E13.2 [HIGH — D2-28] — partition vs plain decision:**
- `prompt_outcomes` (per-prompt) → range-partition by `occurred_at` (follow `ai_events`); PK `(idempotency_key, occurred_at)` or `(prompt_event_id, occurred_at)`.
- `model_fit_scores` (per-prompt) → range-partition by `occurred_at`; same PK shape.
- `daily_rollups_by_user` / `daily_rollups_by_project` (per-day-per-entity, low volume) → PLAIN (un-partitioned); unique `(org_id, user_id, day)` / `(org_id, project_id, day)`.
- `model_pricing` (small reference data) → PLAIN; the EXCLUDE constraint (C11.4) + the `pricing_kind` discriminator.
*Falsify:* per-event tables grow per-prompt (partition warranted); rollups grow per-day-per-entity (a few rows/day, plain is fine).

**CLAIM E13.3 [HIGH — verified codebase] — every table org_id + RLS from creation (D-26/D2-28):** Each of the five tables carries `org_id UUID NOT NULL` and gets an RLS policy in its creation (or the phase-2 RLS) migration. `org_id` is derived by the worker from the source event's `org_id` (already on `ai_events`), never client-supplied. *Falsify:* each new `CREATE TABLE` has `org_id UUID NOT NULL`; each has an `ENABLE ROW LEVEL SECURITY` + policy.

**CLAIM E13.4 [HIGH — verified codebase] — shared validators, NO schema_version bump:** Add `@fennec/shared` Zod payload validators for the new tools' payload shapes (e.g. `CursorPromptPayloadSchema`, `CodexPromptPayloadSchema`, `GeminiPromptPayloadSchema`, `CopilotPromptPayloadSchema`, browser payloads) following `claude-code-payload.ts`'s shape, plus shared row types for `prompt_outcomes`/`model_fit_scores`/rollups (consumed by workers now, Phase 4 frontend later). **No `schema_version` bump:** all new tools are ALREADY in `ToolSchema` (`claude-code, codex, gemini, cursor, copilot, chatgpt-web, claude-ai-web, git`), and git kinds live in the `git_events` CHECK not `EventKindSchema`. *Falsify:* `ToolSchema` already enumerates all eight tools (`packages/shared/src/events/canonical.ts`); `CanonicalEventSchema.schema_version` stays `z.literal(1)`.

> **One caveat [MEDIUM]:** the new tools' prompt events use `kind` values from the EXISTING `EventKindSchema` (`prompt_submitted`, `tool_call`, etc.). Codex/Gemini/Cursor prompts map to `prompt_submitted`; their tool calls to `tool_call`. No new `EventKind` is required for the AI adapters. If a surface needs a kind not in the enum, THAT would require a `schema_version` bump — but none identified. *Falsify:* map each surface's events to existing kinds — all fit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite read (Cursor) | `better-sqlite3` (native dep) | `node:sqlite` `DatabaseSync({readOnly:true})` | Built into Node 22, zero native deps, verified to open the live WAL DB read-only |
| Cross-platform file watch | raw `fs.watch` | `chokidar@^5.0.0` | `fs.watch` misses events / inconsistent across OS; chokidar is the stack pin |
| Non-overlapping price ranges | app-level overlap checks | Postgres `EXCLUDE USING gist` + `btree_gist` | DB-enforced; immune to concurrent inserts (better than serializable) |
| Two "consumers" of one queue | two push consumers on one queue (FAILS) | one consumer running two functions, OR two queues | Cloudflare allows only one push consumer per queue |
| Idempotent re-delivery | dedup table / locks | `INSERT ... ON CONFLICT DO UPDATE` upsert keyed on idempotency_key | At-least-once delivery; mirrors the ingest dedupe |
| Loopback ingress for browser/Copilot | a second HTTP server/port | the existing `LoopbackBridge` + a new `/v1/events` route | Already binds 127.0.0.1 + shared-secret auth (D2-07) |
| Cron scheduling | external scheduler | Cloudflare `triggers.crons` + `scheduled()` handler | Native, free, testable via `--test-scheduled` |
| ULID/idempotency for new events | new id scheme | the registry's existing `deriveIdempotencyKey` / canonical builder | Adapters emit `EmitInput`; the registry stamps idempotency_key |

**Key insight:** Phase 2 is overwhelmingly *additive wiring* against Phase 1 primitives. The two genuinely new build problems are (1) the Cursor SQLite read (solved by `node:sqlite`) and (2) the browser monkeypatch viability (genuinely uncertain — Q2/Q8). Everything else reuses an existing contract.

## Common Pitfalls

### Pitfall 1: Double-counting Codex prompts
**What goes wrong:** Codex writes a user prompt as BOTH a `response_item`(message) AND an `event_msg`(user_message) line → two rows per prompt.
**How to avoid:** emit only on `response_item` + `payload.type:"message"` (A1.3); treat `event_msg`/`turn_context` as noise.
**Warning sign:** `ai_events` row count for `tool='codex'` ≈ 2× the prompts issued.

### Pitfall 2: Gemini `$set` snapshot accumulation
**What goes wrong:** `$set.messages` is a FULL snapshot; accumulating across lines duplicates every prior message.
**How to avoid:** keep the LAST `$set.messages`; emit only newly-appeared user messages (A2.2).
**Warning sign:** conversation message count grows quadratically.

### Pitfall 3: Re-parsing whole transcript files on every append
**What goes wrong:** without tail-offset bookkeeping, every chokidar `change` re-emits all prior turns (idempotency_key dedupes at backend, but wastes capture + parse cycles and risks heartbeat parse_error inflation).
**How to avoid:** per-file byte-offset tail read (D2-02).

### Pitfall 4: Reading Cursor's DB with a writable/long-lived connection
**What goes wrong:** a writable open or a held connection can contend with Cursor's WAL writers; worst case, corruption.
**How to avoid:** `{readOnly:true}` short-lived opens per poll; copy-then-read fallback on lock (A3.4/A3.5/D2-04). Never write/migrate.
**Warning sign:** Cursor reports DB errors, or the adapter's open throws "database is locked".

### Pitfall 5: Two push consumers on one queue
**What goes wrong:** publish-time error; the Worker won't deploy.
**How to avoid:** one consumer + two functions, or two queues (C7.4).

### Pitfall 6: Cache-token cost collapse (the LiteLLM 70% bug)
**What goes wrong:** summing cache_creation/cache_read into one input figure → up to 70%+ miscount.
**How to avoid:** four distinct multiplications (C11.1/D2-24); a test asserting it.

### Pitfall 7: Enqueue before insert in the hot path
**What goes wrong:** enqueuing before/independent of the `INSERT ... ON CONFLICT` can enqueue events that failed to persist (consumer reads a non-existent row).
**How to avoid:** enqueue AFTER the insert loop (C7.5 note); keep it a binding call (ING-04).

### Pitfall 8: Stale subscription prices
**What goes wrong:** seeding $19 Copilot (the SPEC's number) overstates cost; Copilot is now $10 and usage-based.
**How to avoid:** seed verified prices (C11.7), re-verify at build, and represent prices via the effective-date table so updates are data changes.

## Runtime State Inventory

> This is a *greenfield-additive* phase (new adapters + new tables), not a rename/refactor. Runtime-state categories are mostly N/A, but two are worth an explicit note because the new adapters READ external runtime state:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (external, READ) | Cursor `cursorDiskKV` (10,980 rows) in `state.vscdb`; Codex `rollout-*.jsonl`; VS Code Copilot `chatSessions/*.json`; gemini ephemeral `chats/*.jsonl` | Read-only capture only — fennec NEVER writes these. New fennec tables are created fresh. |
| Live service config | None — no external service config embeds a fennec string this phase | None |
| OS-registered state | None new (Phase 1's launchd plist already registered; daemon just gains adapters) | None |
| Secrets/env vars | Reuses the Phase 1 `/etc/fennec/shim-secret` for the new `/v1/events` route (D2-09); browser/Copilot obtain it via pairing handshake (B6.5), not disk | No new secret key; add the pairing handshake |
| Build artifacts | New: a `vscode-extension/` (vsce → `.vsix`) and an `extension/` (MV3 → `tsc`) workspace; `chokidar` added to daemon deps; possibly `@cloudflare/vitest-pool-workers` to backend dev deps | New workspaces + deps in the plan |

**Nothing found requiring data migration of existing fennec state** — verified: no fennec table is renamed/restructured; the five new tables are additive and `git_events` already exists (just gains rows).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `node:sqlite` | Cursor adapter | ✓ | Node 22.23.1 (built-in, no flag) | copy-then-read; or `better-sqlite3` (against zero-native-dep posture) |
| chokidar | all file-watch adapters | ✗ (not installed) | needs `^5.0.0` | none — must add to daemon deps |
| Codex CLI transcripts | CAP-03 verify | ✓ | files present under `~/.codex/sessions/2026/...` | — |
| Gemini CLI transcripts | CAP-04 verify | ⚠ ephemeral | dir present, chats aged out | run a live `gemini` prompt to generate `chats/*.jsonl` before verifying |
| Cursor `state.vscdb` | CAP-05 verify | ✓ | present, 149MB, WAL | — |
| VS Code + Copilot chatSessions | CAP-06 verify | ✓ | `chatSessions/*.json` present | — |
| Chrome/Firefox + MV3 | CAP-07/08 verify | (assumed) | — | defer per Q2 if monkeypatch/anti-bot fails |
| `vsce` | Copilot sidecar package | (not checked) | install `@vscode/vsce` | — |
| `@cloudflare/vitest-pool-workers` | Worker consumer/cron tests | ✗ (not installed) | add to backend dev deps | test handlers as plain functions with mocked env (lower fidelity) |
| wrangler | deploy queue/cron | ✓ (Phase 1) | 4.x | — |

**Missing dependencies with no fallback:**
- `chokidar@^5.0.0` — must be added to `daemon/package.json` (blocks all four in-process adapters).

**Missing dependencies with fallback:**
- `@cloudflare/vitest-pool-workers` — needed for high-fidelity Worker tests; fallback is testing handler functions directly with a mocked `env`.
- Gemini live chats — ephemeral; generate fresh before verifying CAP-04.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 (root + per-workspace configs) |
| Config files | `vitest.workspace.ts`, `vitest.config.ts`, `daemon/vitest.config.ts`, `backend/vitest.config.ts`, `tests/vitest.config.ts` |
| Quick run command | `npx vitest run <path/to/test>` (or `npm test -w daemon` / `-w backend`) |
| Full suite command | `npm test` (root: `vitest run --passWithNoTests`) + `npm run lint` + `npm run typecheck` |
| E2E | Playwright (`npm run test:e2e`) — dashboard only, Phase 4 |
| Worker-runtime tests | **GAP:** `@cloudflare/vitest-pool-workers` NOT installed — Wave 0 |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-03 | one Codex prompt → one `tool='codex'` row in ≤5min | integration (fixture transcript → adapter → staging) | `npx vitest run daemon/.../codex.test.ts` | ❌ Wave 0 |
| CAP-04 | one Gemini prompt → one `tool='gemini'` row | integration | `npx vitest run daemon/.../gemini.test.ts` | ❌ Wave 0 |
| CAP-05 | one Cursor interaction → one `tool='cursor'` row; read-only open | unit + integration (fixture vscdb) | `npx vitest run daemon/.../cursor.test.ts` | ❌ Wave 0 |
| CAP-06 | one Copilot interaction → one `tool='copilot'` row (sidecar→bridge) | integration (fixture chatSessions json → bridge) | `npx vitest run` | ❌ Wave 0 |
| CAP-07/08 | one ChatGPT/Claude.ai prompt → one row OR defer recorded | manual + integration (bridge POST shape) | manual capture + `npx vitest run extension bridge test` | ❌ Wave 0 |
| CAP-09 | commit/revert/file_edit/branch_switch → matching `git_events.event_type` | unit (reflog fixture) + integration | `npx vitest run daemon/.../git.test.ts` | ❌ Wave 0 |
| (all CAP) | heartbeat emits events_parsed/parse_errors at zero capture | unit | existing `AdapterCounter` test pattern | partially (registry tested) |
| CAP-18 | inspect lists 24h events, redacted, prints backend URL; canary→0 raw | unit (canary over seeded queue) | `npx vitest run daemon/.../inspect.test.ts` | ❌ Wave 0 |
| ANL-01 | ingest enqueues; hot-path purity holds | unit (existing guard) + integration | `npx vitest run backend/src/api/events-batch.hot-path.test.ts` | ✅ (extend) |
| ANL-01 | prompt+commit in window → linking `prompt_outcomes` row | integration (Worker queue handler) | `npx vitest run backend/.../correlation.test.ts` | ❌ Wave 0 |
| ANL-02 | confidence is interval (two bounds), not bare number | unit + schema CHECK | `npx vitest run backend/.../prompt-outcomes-schema.test.ts` | ❌ Wave 0 |
| ANL-03 | prompt→commit→revert → `attribution_state='downgraded_by_revert'`, no silent decrement | integration | `npx vitest run backend/.../revert-downgrade.test.ts` | ❌ Wave 0 |
| ANL-04 | one `model_fit_scores` row/prompt; NO LLM/network in scoring | unit + **static-import guard** | `npx vitest run backend/.../model-fit.no-llm.test.ts` | ❌ Wave 0 (mirror hot-path guard) |
| ANL-05 | cron writes rollups; totals reconcile with raw query | integration (scheduled handler) | `npx vitest run backend/.../aggregator.test.ts` | ❌ Wave 0 |
| ANL-07 | distinct `cost_estimated`/`cost_billed`; cache tokens 4 distinct line items | unit | `npx vitest run backend/.../cost-cache-tokens.test.ts` | ❌ Wave 0 |
| ANL-08 | price read from `model_pricing` effective-date; NO hardcoded price | unit + **grep guard** | `npx vitest run backend/.../no-hardcoded-price.test.ts` | ❌ Wave 0 |
| ANL-09 | subscription is distinct `cost_subscription`, not summed into estimate | unit | `npx vitest run backend/.../subscription-separate.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the task's own `npx vitest run <file>` + `npm run lint` + `npm run typecheck`.
- **Per wave merge:** `npm test` (full root) + both workspace suites.
- **Phase gate:** full suite green + the live-capture acceptance checks (one prompt per surface → one staging row ≤5min) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Add `chokidar@^5.0.0` to `daemon/package.json` (blocks all in-process adapters).
- [ ] Add `@cloudflare/vitest-pool-workers` to `backend` dev deps (for Worker queue/cron tests) — or document the mocked-env fallback.
- [ ] `daemon/src/adapters/{codex,gemini,cursor,git}/` dirs + `*.test.ts` (covers CAP-03/04/05/09).
- [ ] `daemon/src/cli/inspect.ts` + `inspect.test.ts` (CAP-18 canary).
- [ ] `daemon/src/adapters/loopback-bridge/` `/v1/events` route test (CAP-06/07/08 ingress).
- [ ] `backend/.../model-fit.no-llm.test.ts` (mirror `events-batch.hot-path.test.ts` static-import grep) — covers ANL-04 no-LLM guard.
- [ ] `backend/.../no-hardcoded-price.test.ts` (grep aggregator source for numeric price literals) — covers ANL-08.
- [ ] Fixture transcripts: a real Codex `rollout-*.jsonl`, a Gemini `session-*.jsonl`, a fixture `state.vscdb` (small), a Copilot `chatSessions` json, a `.git/logs/HEAD` reflog sample — checked into test fixtures.
- [ ] Test `model_pricing` seed migration with the Sonnet-5 cutover (two non-overlapping rows) to exercise effective-date selection.

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` → treated as ENABLED.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Loopback bridge binds 127.0.0.1 only; analytics async (no hot-path leakage) |
| V2 Authentication | yes | `X-Fennec-Shim-Secret`/pairing token on `/v1/events` (D2-09); backend bearer auth on ingest (Phase 1) |
| V3 Session Management | n/a | No new user sessions this phase (Phase 3) |
| V4 Access Control | yes | RLS `org_id` policy on all five new tables (D2-28); `org_id` from auth context never client body (T-05-02) |
| V5 Input Validation | yes | Zod payload validators per new tool (E13.4); bridge `JSON.parse` in try/catch (400 on bad input); queue message bodies validated before DB write |
| V6 Cryptography | yes (reuse) | Pairing token from `randomBytes(32).toString('base64url')` (existing `generateShimSecret`) — never hand-roll |
| V7 Error Handling/Logging | yes | Bridge never logs secret/body; redactor runs before queue (PRIV-01); inspect shows only redacted payload |
| V8 Data Protection | yes | Capture-time redaction (registry, all surfaces); canary test (CAP-18) proves zero raw-secret leak |

### Known Threat Patterns for {daemon adapters + Cloudflare Workers + Supabase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged `/v1/events` POST | Spoofing | Shared-secret header validated before body read (mirror `/v1/hook`) |
| Secret in captured prompt → backend/log | Information Disclosure | Registry redacts before queue.append (PRIV-01); inspect renders redacted-as-stored; canary test |
| SQL injection in worker queries | Tampering | Parameterized `pg.Client` queries ($1/$2), never string-concat — Phase 1 pattern |
| Cross-tenant row read | Information Disclosure | `org_id` RLS policy from table creation; `org_id` derived from event/auth, not client |
| Browser monkeypatch exfiltrates to a third party | Information Disclosure | Extension flushes ONLY to `127.0.0.1` loopback; no remote endpoint in the extension |
| Cursor DB write/corruption by adapter | Tampering/DoS | Read-only `node:sqlite` open; never write/migrate; copy-then-read on lock |
| Analytics in ingest hot path (DoS amplification) | DoS | ING-04 static-import guard; enqueue is a binding call only |
| Queue message poisoning (malformed body loops) | DoS | `max_retries` + dead-letter queue; consumer validates body, acks poison to DLQ |

## State of the Art

| Old Approach (training-era / synapse / SPEC) | Current Approach (verified 2026-07-01) | When Changed | Impact |
|----------------------------------------------|-----------------------------------------|--------------|--------|
| Cursor chat in per-workspace `workspaceStorage/<hash>/*.json` (synapse `cursor.ts`) | Global `state.vscdb` SQLite, `cursorDiskKV` bubbles | Recent Cursor versions | Rewrite the Cursor adapter for SQLite; don't copy synapse |
| Read SQLite via `better-sqlite3` (native dep) | Node 22 built-in `node:sqlite` `DatabaseSync({readOnly:true})` | Node 22.x | Zero native deps; resolves Q4 |
| Copilot chat in `github.copilot-chat/globalStorage` (assumed) | `workspaceStorage/<md5>/chatSessions/*.json` | VS Code chat persistence | Sidecar reads chatSessions, not globalStorage |
| Copilot Pro $19/mo (SPEC) | Copilot Pro $10/mo, usage-based since 2026-06-01 | 2026-06-01 | Seed $10; subscription model is a simplification for credit-based Copilot |
| One queue, two push consumers (D2-14 implied) | One push consumer per queue (Cloudflare limit) | (always) | One consumer + two functions, or two queues |
| Claude Opus 4.1 $15/$75 (training-era) | Opus 4.8 $5/$25; Sonnet 5 $2/$10 intro; Haiku 4.5 $1/$5 | 2026 | Seed current prices; model the Sonnet-5 cutover as an effective-date row |

**Deprecated/outdated:**
- synapse `cursor.ts` `.json` parsing — outdated for current Cursor (use SQLite).
- The assumed `github.copilot-chat/globalStorage` chat location — wrong (use chatSessions).
- The $19 Copilot / $20 "ChatGPT Pro" subscription figures in the SPEC — stale (Copilot $10, ChatGPT Plus $20).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Codex v1 flat-line format still exists for older builds | A1.5 | Parser over-engineered (harmless) or misses a format (heartbeat parse_errors flags it) |
| A2 | Gemini transcripts carry no reliable per-turn token usage | A2.4 | Gemini cost rows lack tokens; cost worker nulls them — verify at build |
| A3 | `node:sqlite` stays require-able without a flag on the pinned Node 22 minor | A3.4 note | Daemon may need `--experimental-sqlite`; one-line launch change |
| A4 | Cursor `bubbleId` `tokenCount` is populated for hosted-model usage (observed 0 for many) | A3.3 | Cursor cost rows may lack tokens; model-level/subscription accounting fallback |
| A5 | ChatGPT/Claude.ai completion request URLs (historical shapes) | B6.3 | Content script captures wrong/no request — verify at build (Q8) |
| A6 | MV3 monkeypatch survives late-2026 anti-bot | B6.2 | Browser surface defers per Q2; architecture intact |
| A7 | GPT cache-creation = input price (no separate write fee) | C11.3 | Slight GPT cost mis-estimate; data-fixable in `model_pricing` |
| A8 | Supabase Postgres < 18 (so EXCLUDE form, not WITHOUT OVERLAPS) | C11.4 | If ≥18, can use cleaner temporal PK; verify version |
| A9 | Copilot subscription as a flat monthly line approximates its new usage-based billing | C11.7 | Copilot cost is now credit-based; flat-sub is a simplification |

## Open items to verify at build time (append to 02-OPEN-QUESTIONS.md as Q8+)

> These are the LOW-confidence / externally-dependent items the planner should schedule a verify task for. Suggested as Q8–Q12:

- **Q8 (browser capture viability):** Build a minimal MV3 extension; confirm the `world:MAIN`+`document_start` `fetch` monkeypatch fires on live ChatGPT.com and Claude.ai chat completions in late-2026, and that anti-bot does not break the session or detect it (`fetch.toString()` still native). Confirm the current completion request URL/method per site. **This gates the CAP-07/08 GA-vs-defer decision (Q2).** [LOW]
- **Q9 (Gemini tokens):** Run a live `gemini` prompt; inspect `~/.gemini/tmp/<project>/chats/session-*.jsonl` for any per-turn token/usage field. [LOW]
- **Q10 (Cursor WAL change-detection):** Confirm a new Cursor prompt bumps the mtime of `state.vscdb` or `state.vscdb-wal` within the adapter's poll window (so chokidar fires). Confirm `node:sqlite` requires no flag on the pinned Node 22 minor. [MEDIUM]
- **Q11 (Supabase PG version + extension):** Confirm the staging Supabase Postgres version and that `CREATE EXTENSION btree_gist` is permitted (Supabase allows it); if PG ≥18, consider `WITHOUT OVERLAPS`. [MEDIUM]
- **Q12 (pricing currency + Copilot model):** Re-verify Claude/GPT per-token prices and Copilot ($10) / ChatGPT Plus ($20) subscription prices at build; decide how to represent Copilot's now-usage-based billing as a "subscription" line. [MEDIUM]
- **Q13 (git transport):** Decide whether `tool:"git"` events route through the standard adapter/ingest path into `git_events` (requires a dumb tool-branch in ingest) or a separate git endpoint/queue. [MEDIUM — see A4 architectural note]

## Sources

### Primary (HIGH confidence)
- fennec codebase (verified by direct read): `daemon/src/adapters/{adapter,registry}.ts`, `claude-code/{adapter,payload-normaliser}.ts`, `loopback-bridge/{server,secret-store}.ts`, `queue/jsonl.ts`, `cli/daemon.ts`, `index.ts`; `backend/src/api/events-batch.ts` + `events-batch.hot-path.test.ts`; `backend/wrangler.jsonc`; `supabase/migrations/2026053100000{2,3,6,7}_*.sql`; `packages/shared/src/events/{canonical,kinds,claude-code-payload}.ts`.
- Live POC on this macOS machine (2026-07-01): `node:sqlite` read-only open of Cursor `state.vscdb` (WAL); `cursorDiskKV` bubble/composer schema; Codex `rollout-*.jsonl` line schema + token_count event; VS Code `chatSessions/*.json` shape; git reflog/HEAD/porcelain.
- Anthropic pricing — `platform.claude.com/docs/en/docs/about-claude/pricing` (per-MTok prices + cache multipliers, 2026-07-01).
- Cloudflare Queues docs — `developers.cloudflare.com/queues/configuration/{configure-queues,batching-retries}`, `/queues/platform/limits`, `/queues/reference/how-queues-works`, `/queues/configuration/javascript-apis`.
- Cloudflare cron — `developers.cloudflare.com/workers/configuration/cron-triggers`, `/workers/runtime-apis/handlers/scheduled`.
- synapse reference adapters (pattern source): `~/Documents/synapse/mcp/src/capture/adapters/{codex,gemini,cursor,copilot-cli}.ts`, `watcher.ts`.

### Secondary (MEDIUM confidence)
- Postgres EXCLUDE/btree_gist non-overlap pattern — dev.to/cybertec/betterstack articles (cross-verified against the established `EXCLUDE USING gist` idiom).
- OpenAI API pricing — `developers.openai.com/api/docs/pricing` + aggregator sites (volatile; 2026-07-01).
- GitHub Copilot pricing ($10 Pro, usage-based since 2026-06-01) — `github.com/features/copilot/plans` + GitHub blog.
- ChatGPT pricing ($20 Plus) — `chatgpt.com/pricing`.

### Tertiary (LOW confidence — marked for build-time validation)
- MV3 monkeypatch viability + anti-bot detection on late-2026 ChatGPT/Claude.ai (Q8) — no live POC performed here.
- ChatGPT/Claude.ai completion request URL shapes (Q8) — historical, version-fragile.
- Gemini per-turn token persistence (Q9) — not observed (ephemeral files).

## Metadata

**Confidence breakdown:**
- In-process adapter file paths/schemas (Codex/Cursor/Copilot/git): HIGH — verified by live POC on this machine.
- Gemini specifics: MEDIUM — path verified, chats ephemeral/aged-out so live schema not re-observed this session (synapse + structure confirm).
- `node:sqlite` read-only mechanism (Q4): HIGH — verified working against the live WAL DB.
- Cloudflare Queue/cron config + the 1-consumer-per-queue constraint: HIGH — current official docs.
- Postgres EXCLUDE/btree_gist DDL: HIGH — established idiom, current docs.
- Cost/subscription seed prices: MEDIUM — verified 2026-07-01 but volatile; re-verify at build.
- Browser MV3 capture (CAP-07/08): MEDIUM-LOW — storage/transport architecture HIGH, monkeypatch/anti-bot viability LOW (Q8).

**Research date:** 2026-07-01
**Valid until:** ~2026-07-31 for stack/Cloudflare/Postgres facts; ~2026-07-08 for pricing (volatile) and Cursor/Codex/Copilot on-disk schemas (undocumented, version-fragile — re-verify if those tools update).
