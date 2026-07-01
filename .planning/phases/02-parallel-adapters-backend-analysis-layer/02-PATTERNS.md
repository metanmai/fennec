# Phase 2: Parallel Adapters + Backend Analysis Layer - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 24 new/modified (6 capture surfaces, 1 bridge route + normaliser, 1 CLI subcommand, 1 queue producer wiring, 1 consumer Worker, 1 cron Worker, 5 migrations, shared validators/types, config)
**Analogs found:** 22 / 24 (2 net-new: MV3 browser extension internals, Cursor `node:sqlite` reader — partial analogs only)

> **Read-this-first for the planner:** Phase 2 is overwhelmingly *additive wiring against Phase 1 primitives*. Nearly every new file has an exact in-repo analog to copy. The two genuinely-new build problems with no clean in-repo analog are (1) the Cursor `node:sqlite` read and (2) the MV3 browser monkeypatch. Everything else — adapters, bridge routes, migrations, the no-LLM guard test, the queue wiring — copies an existing file almost verbatim. Excerpt line numbers below are the lines to copy.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `daemon/src/adapters/codex/adapter.ts` | adapter | file-I/O (tail-on-append) | `daemon/src/adapters/claude-code/adapter.ts` | role-match (event-driven analog; net file-watch) |
| `daemon/src/adapters/codex/codex-normaliser.ts` | utility (normaliser) | transform | `daemon/src/adapters/claude-code/payload-normaliser.ts` | exact |
| `daemon/src/adapters/gemini/adapter.ts` | adapter | file-I/O (snapshot diff) | `daemon/src/adapters/claude-code/adapter.ts` | role-match |
| `daemon/src/adapters/gemini/gemini-normaliser.ts` | utility (normaliser) | transform | `daemon/src/adapters/claude-code/payload-normaliser.ts` | exact |
| `daemon/src/adapters/cursor/adapter.ts` | adapter | file-I/O (SQLite poll) | `daemon/src/adapters/claude-code/adapter.ts` (shape) + net-new `node:sqlite` read | partial |
| `daemon/src/adapters/cursor/cursor-normaliser.ts` | utility (normaliser) | transform | `daemon/src/adapters/claude-code/payload-normaliser.ts` | exact |
| `daemon/src/adapters/git/adapter.ts` | adapter | event-driven (reflog/HEAD watch) | `daemon/src/adapters/claude-code/adapter.ts` (shape); **git transport decision flagged** | role-match |
| `daemon/src/adapters/git/git-normaliser.ts` | utility (normaliser) | transform | `daemon/src/adapters/claude-code/payload-normaliser.ts` | role-match |
| `daemon/src/adapters/loopback-bridge/server.ts` (MODIFY) | middleware (ingress) | request-response | the existing `handleHookPost` in the same file | exact (self-analog) |
| `daemon/src/adapters/bridge-events/adapter.ts` (copilot/chatgpt-web/claude-ai-web normaliser) | adapter | event-driven (bridge "events") | `daemon/src/adapters/claude-code/adapter.ts` | exact |
| `vscode-extension/` (Copilot sidecar workspace) | component (out-of-process client) | file-I/O→HTTP POST | bridge POST shape (`server.ts`) + net-new vsce shell | partial |
| `extension/` (MV3 browser workspace) | component (out-of-process client) | streaming capture→HTTP POST | bridge POST shape (`server.ts`) + net-new monkeypatch | partial (no in-repo analog) |
| `daemon/src/cli/inspect.ts` | utility (CLI command) | batch (read JSONL) | `daemon/src/cli/daemon.ts` (runX shape) + `replayFromWatermark` consumer | role-match |
| `daemon/src/index.ts` (MODIFY) | route (CLI dispatcher) | request-response | the `switch (sub)` block in the same file | exact (self-analog) |
| `backend/wrangler.jsonc` (MODIFY) | config | n/a | the commented `queues` stub in the same file | exact (self-analog) |
| `backend/src/api/events-batch.ts` (MODIFY) | controller (ingest) | request-response | the existing handler in the same file (add one binding call) | exact (self-analog) |
| `backend/src/api/events-batch.hot-path.test.ts` (KEEP GREEN) | test | n/a | the existing guard | exact |
| `backend/src/index.ts` (MODIFY) | route (Worker entry) | n/a | the existing default-export `app` — add `queue` + `scheduled` siblings | role-match |
| `backend/src/workers/correlation-and-model-fit.ts` (consumer `queue()`) | service (Queue consumer) | event-driven / batch | `backend/src/api/events-batch.ts` (pg lifecycle) + `ai-events.ts` (upsert) | role-match |
| `backend/src/workers/aggregator.ts` (cron `scheduled()`) | service (cron) | batch | `backend/src/api/events-batch.ts` (pg lifecycle) + `ai-events.ts` (upsert) | role-match |
| `backend/src/workers/model-fit.no-llm.test.ts` | test (static-import guard) | n/a | `backend/src/api/events-batch.hot-path.test.ts` | exact |
| `supabase/migrations/...008_prompt_outcomes.sql` | migration | n/a | `..002_ai_events_partitioned.sql` (partition) + `..006_rls_policies.sql` (RLS) | exact |
| `supabase/migrations/...009_model_fit_scores.sql` | migration | n/a | `..002_ai_events_partitioned.sql` + `..006_rls_policies.sql` | exact |
| `supabase/migrations/...010_model_pricing.sql` | migration | n/a | `..003_git_events_partitioned.sql` (CHECK pattern) + net-new EXCLUDE/btree_gist | partial |
| `supabase/migrations/...011_daily_rollups_by_user.sql` | migration | n/a | `..001_orgs_users_keys.sql` style (plain table) + `..006` RLS | role-match |
| `supabase/migrations/...012_daily_rollups_by_project.sql` | migration | n/a | same as 011 | role-match |
| `supabase/migrations/...013_seed_model_pricing.sql` | migration (seed) | n/a | `..007_seed_phase1_test_data.sql` (ON CONFLICT seed) | exact |
| `packages/shared/src/events/<tool>-payload.ts` (×N) | model (Zod validator) | n/a | `packages/shared/src/events/claude-code-payload.ts` | exact |
| `packages/shared/src/analysis/*.ts` (row types) | model (Zod/types) | n/a | `packages/shared/src/events/canonical.ts` | role-match |
| `packages/shared/src/index.ts` (MODIFY) | config (barrel) | n/a | the existing `export *` list | exact (self-analog) |
| `daemon/package.json` (MODIFY) | config | n/a | existing `dependencies` block (add `chokidar@^5.0.0`) | exact |

---

## Shared Patterns

> These cross-cutting patterns apply to MANY new files. Read them once here; the per-file sections below reference them.

### Pattern S1 — The Adapter contract (every in-process adapter implements this)
**Source:** `daemon/src/adapters/adapter.ts`
**Apply to:** codex, gemini, cursor, git, and the bridge-events normalising adapter.

`EmitInput` (lines 33-49) is exactly the shape the new adapters supply. Required: `tool`, `adapter_version`, `kind`, `payload`, `session_id`, `hook_event`. Optional: `occurred_at`, `monotonic_seq`, `cwd`, `git_remote`, `git_branch`. The registry stamps `idempotency_key`/`hostname`/`os`/redaction. The `Adapter` interface (lines 63-72):
```typescript
export interface Adapter {
  readonly tool: Tool;
  readonly version: string;
  start(emit: Emit): Promise<void>;
  stop(): Promise<void>;
}
```
**Non-negotiable (D2-01, CONTEXT "Locked by Phase 1"):** adapters call `emit` and NOTHING else — never the redactor, queue, or sync loop.

### Pattern S2 — Drop-on-throw / log-and-swallow (PITFALL P1)
**Source:** `daemon/src/adapters/registry.ts` lines 164-209 (`makeEmit`); `daemon/src/adapters/claude-code/adapter.ts` lines 67-81, 94-108.

The registry's `makeEmit` (registry.ts:173-207) runs `buildCanonicalEvent → redact → appendEvent` in a try/catch; on ANY throw it does `counter.parse_errors++` and DROPS the event — never propagates back to the adapter loop. The adapter's own handler (adapter.ts:78-80) wraps the normalise+forward in `void this.forward(raw).catch(...)` so a malformed upstream line is logged-and-swallowed and the watch loop keeps running. **New adapters get the parse_errors counting for free** by going through `emit`; the normaliser should THROW on malformed input (see S3) so the registry counts it.

### Pattern S3 — Normaliser throws on malformed input
**Source:** `daemon/src/adapters/claude-code/payload-normaliser.ts` lines 95-136.

The normaliser is a pure function `(raw: unknown) => EmitInput`. It uses a safe `pick<T>(obj, key)` helper (lines 45-48), maps a tool-event-name to an `EventKind` via a frozen lookup (lines 35-42), and THROWS on unknown/missing fields (lines 97-108):
```typescript
const kind = HOOK_EVENT_TO_KIND[hookEventName];
if (!kind) {
  throw new Error(`unknown hook_event_name: ${hookEventName}`);
}
```
Codex/Gemini/Cursor/git normalisers copy this shape: a frozen event→`EventKind` map, `pick` helpers, throw-on-malformed. Codex/Gemini/Cursor prompts map to `prompt_submitted`; tool calls to `tool_call` (no new `EventKind` — RESEARCH E13.4 caveat). The four token fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) are preserved VERBATIM, never aggregated (payload-normaliser.ts:59-83 `extractUsage`).

### Pattern S4 — stop() unsubscribes the exact listener reference
**Source:** `daemon/src/adapters/claude-code/adapter.ts` lines 58-92.

Store the handler on the instance so `stop()` can pass the identity-equal reference to `bridge.off()` (or `watcher.close()` for chokidar). `start()` throws if already started (lines 59-61); `stop()` nulls the handler + emit (lines 86-92). Each new adapter does the same with its chokidar watcher / SQLite poll timer.

### Pattern S5 — Per-table org_id + RLS from creation migration (D-26 / D2-28)
**Source:** `supabase/migrations/20260531000002_ai_events_partitioned.sql` (table+partition) and `..006_rls_policies.sql` (RLS).

Every new table carries `org_id UUID NOT NULL`. RLS pattern is verbatim from `006_rls_policies.sql` lines 74-76:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <table>_tenant_isolation ON <table>
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
```
`org_id` is derived by the worker from the source event's `org_id` (already on `ai_events`), NEVER client-supplied (T-05-02).

### Pattern S6 — Range-partition-by-occurred_at + partition column in PK
**Source:** `supabase/migrations/20260531000002_ai_events_partitioned.sql` lines 25-56.

Per-event tables (`prompt_outcomes`, `model_fit_scores`) follow the `ai_events` model: `PARTITION BY RANGE (occurred_at)`, PK includes the partition column (`PRIMARY KEY (idempotency_key, occurred_at)`), explicit current+next month partitions, indexes inherited by partitions. Rollup tables and `model_pricing` are PLAIN (RESEARCH E13.2).

### Pattern S7 — Idempotent upsert (consumers + aggregator, D2-15)
**Source:** `backend/src/db/queries/ai-events.ts` lines 42-74 (`insertAiEvent` `ON CONFLICT ... DO NOTHING`); seed migration `..007` `ON CONFLICT (id) DO NOTHING`.

Workers UPSERT keyed on the prompt event's idempotency_key (correlation/model-fit) or `(org_id, user_id, day)` / `(org_id, project_id, day)` (aggregator), so a redelivered queue message or re-run cron re-derives the same row (`ON CONFLICT ... DO UPDATE SET ...` for the rollups, since the aggregator REPLACES the day). All queries parameterized `$1/$2` (T-05-03).

### Pattern S8 — Per-request pg.Client over Hyperdrive
**Source:** `backend/src/db/client.ts` lines 24-26; `backend/src/api/events-batch.ts` lines 34-66 (connect/try/finally end).
```typescript
const client = pgClient(c.env); // or pgClient(env) in queue()/scheduled()
await client.connect();
try {
  // await client.query(...)
} finally {
  await client.end(); // or ctx.waitUntil(client.end())
}
```
The correlation/model-fit consumer and the aggregator cron use this exact lifecycle. Never cache the client across invocations (client.ts:20-22 comment).

### Pattern S9 — Static-import grep guard (no-LLM / no-hardcoded-price)
**Source:** `backend/src/api/events-batch.hot-path.test.ts` lines 12-37.

`readFileSync` the worker source, assert forbidden patterns absent:
```typescript
const source = readFileSync(scorerPath, "utf-8");
expect(source).not.toMatch(/from\s+['"][^'"]*(fetch|http|undici|node:net|node:https)/);
```
Reuse VERBATIM for: ANL-04 model-fit no-LLM guard (no `fetch`/`http`/`undici` import, no `fetch(`/`XMLHttpRequest`) and ANL-08 no-hardcoded-price guard (no numeric price literal in aggregator source).

---

## Pattern Assignments

### `daemon/src/adapters/codex/adapter.ts` (adapter, file-I/O tail-on-append)

**Analog:** `daemon/src/adapters/claude-code/adapter.ts` (shape S1/S4) — but the event source is a chokidar file-watch, NOT a bridge EventEmitter. **chokidar is NOT yet a daemon dep** (RESEARCH dependency-gap; daemon/package.json has only `@clack/prompts`, `@fennec/shared`) — add `chokidar@^5.0.0`.

**Class skeleton** (copy claude-code/adapter.ts:44-92, swap bridge for chokidar):
```typescript
export class CodexAdapter implements Adapter {
  readonly tool = "codex" as const;
  readonly version = "0.1.0";
  private watcher: FSWatcher | null = null;       // chokidar watcher (was: bridge handler)
  private emit: Emit | null = null;
  private offsets = new Map<string, number>();     // per-file byte offset (tail-on-append, D2-02)

  async start(emit: Emit): Promise<void> {
    if (this.watcher) throw new Error("CodexAdapter already started");
    this.emit = emit;
    const root = resolvePaths(process.platform).sessionsRoot; // D2-05 single fn
    this.watcher = chokidar.watch(root, { /* recurse default; *.jsonl filter */ });
    this.watcher.on("change", (p) => void this.onChange(p).catch((err) =>
      this.logger("[codex] change failed; events dropped", err)));   // S2 swallow
  }
  async stop(): Promise<void> {
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
    this.emit = null;
  }
}
```

**Path resolution (D2-05):** isolate behind a single `resolvePaths(os)` so Phase 5 adds Linux/Windows. macOS root: `~/.codex/sessions` (recurse to `<YYYY>/<MM>/<DD>/rollout-*.jsonl`, RESEARCH A1.1).

**Tail-on-append (D2-02, PITFALL P3):** track per-file byte offset in `this.offsets`; on `change`, read only newly-appended bytes, parse new lines only. Re-parsing whole file re-emits every prior turn.

**One-prompt→one-row (PITFALL P1 in RESEARCH):** emit ONLY on `type:"response_item"` + `payload.type:"message"` + `payload.role:"user"`; treat `event_msg`/`turn_context`/`token_count` as noise (model on `turn_context.payload.model`, RESEARCH A1.3/A1.4). Per-line v1/v2 detection (presence of `payload` object = v2) like synapse `codex.ts` (D2-03).

---

### `daemon/src/adapters/codex/codex-normaliser.ts` (normaliser, transform)

**Analog:** `daemon/src/adapters/claude-code/payload-normaliser.ts` (exact — S3).

Copy `pick<T>` (lines 45-48), the frozen-map idiom (lines 35-42), throw-on-malformed (lines 97-108), and verbatim-token preservation (lines 59-83). Map Codex `role:"user"` → `kind: "prompt_submitted"`. Output `EmitInput` with `tool: "codex"`, `payload: { prompt_text, session_id, model?, usage? }`. Throw if `session_id` (from `session_meta.payload.id`) is missing.

**Synapse reference (pattern only, NOT a fennec file):** `~/Documents/synapse/mcp/src/capture/adapters/codex.ts` — read for the per-line v1/v2 discriminator + content-block flattening, then normalise into fennec's `EmitInput`.

---

### `daemon/src/adapters/gemini/adapter.ts` + `gemini-normaliser.ts` (adapter + normaliser)

**Analog:** same as codex (S1/S3/S4 + chokidar).

**Gemini-specific (PITFALL P2 in RESEARCH A2.2):** the v2 `session-*.jsonl` `$set.messages` is a FULL snapshot per line, NOT a patch. Keep the LAST `$set.messages` and DIFF against the prior emitted snapshot (by message id/index) — emit only newly-appeared user messages. Naive emit-per-snapshot re-emits the whole conversation each turn. Detect v1 (`.json`) vs v2 (`.jsonl`) by extension. macOS root: `~/.gemini/tmp/<project>/chats/session-*.jsonl` (ephemeral — RESEARCH A2.1). Tokens best-effort/absent (A2.4); leave `usage` undefined when not present.

**Synapse reference:** `~/Documents/synapse/mcp/src/capture/adapters/gemini.ts`.

---

### `daemon/src/adapters/cursor/adapter.ts` + `cursor-normaliser.ts` (adapter + normaliser) — PARTIAL ANALOG

**Analog:** claude-code/adapter.ts for the `Adapter` shape (S1/S4) and payload-normaliser.ts for the normaliser (S3) — but the READ MECHANISM is net-new: `node:sqlite` `DatabaseSync`, no in-repo precedent.

**Net-new read (RESEARCH A3.4, "Don't Hand-Roll"):** use Node 22 built-in `node:sqlite`, NOT `better-sqlite3` (preserves the daemon's zero-native-dep posture):
```typescript
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path, { readOnly: true });  // never write/migrate (D2-04)
const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all();
db.close(); // short-lived open per poll
```
macOS DB: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (GLOBAL SQLite, WAL — NOT per-workspace `.json`; synapse `cursor.ts` is OUTDATED, do NOT copy its parsing — RESEARCH A3.1/State-of-the-Art). Watch `state.vscdb` AND `state.vscdb-wal` mtime via chokidar (WAL writes may not bump the main file). On open failure (Cursor checkpoint lock) treat as soft error → `parse_errors`, retry next tick; copy-then-read is the documented fallback (A3.5).

**Normaliser:** `bubbleId` value JSON → `type:1` = user prompt; `text` → `prompt_text`; `modelInfo.modelName` → model; `tokenCount:{inputTokens,outputTokens}` → usage; `createdAt` → `occurred_at` (A3.3). Filter to `createdAt` newer than last watermark.

---

### `daemon/src/adapters/git/adapter.ts` + `git-normaliser.ts` (adapter, event-driven) — TRANSPORT DECISION FLAGGED

**Analog:** claude-code/adapter.ts for the `Adapter` shape (S1/S4) + chokidar.

**⚠ PLANNER DECISION (RESEARCH A4 architectural note, OPEN-Q13):** the existing `Adapter`/`EmitInput`/registry pipeline targets `ai_events`. `git_events` is a different table (`{id, org_id, occurred_at, repo_remote, repo_branch, event_type, payload, schema_version}` — see migration `..003`, no `idempotency_key`/`tool`/`kind`). Two viable transports: **(a)** route `tool:"git"` through the standard adapter+ingest path and branch ingest by tool to `git_events` (a dumb tool-branch, ING-04-safe), or **(b)** a separate git endpoint/queue. `git` already exists in `ToolSchema` (canonical.ts:9-18). **This is a genuine plan-time choice — flag it.**

**git-watcher specifics (D2-06, RESEARCH A4):** watch `.git/HEAD`, `.git/logs/HEAD`, working tree per registered repo. `event_type` from reflog message: `commit: <subj>` → `commit`; subject matching `^Revert "` → `revert` (PRIMARY version-robust rule) ALSO accept reflog prefixes `revert:` AND `commit (revert):`; `checkout: moving from A to B` → `branch_switch`; uncommitted change → `file_edit`. Context via porcelain: `git config --get remote.origin.url`, `git rev-parse --abbrev-ref HEAD`, `git show -s --format=%cI HEAD`. **No `schema_version` bump** — git kinds live in the `git_events.event_type` CHECK (migration `..003` line 17), NOT `EventKindSchema` (D2-06, RESEARCH A4.4).

**Synapse reference:** no direct git-watcher analog in synapse; reflog/HEAD shapes verified live in RESEARCH A4.

---

### `daemon/src/adapters/loopback-bridge/server.ts` (MODIFY — add POST /v1/events)

**Analog:** the existing `handleHookPost` in the SAME file (server.ts:121-172) — copy it verbatim, emit `"events"` instead of `"hook"`.

**Route registration** (server.ts:102-119, add a branch):
```typescript
if (req.method === "POST" && req.url === "/v1/events") {
  this.handleEventsPost(req, res);   // mirror handleHookPost
  return;
}
```
**`handleEventsPost`** = copy server.ts:121-172 exactly: (1) check `x-fennec-shim-secret` header BEFORE body read, 401 on mismatch, log `remoteAddr` never the secret (lines 125-136); (2) buffer `req.on("data")`, `JSON.parse` on `end`, 400 on parse error never echoing body (lines 139-153); (3) `this.emit("events", parsed)`; (4) `res.writeHead(202)`. `/v1/health` stays as-is (lines 104-108).

**Header reuse (D2-09, Claude's Discretion):** reuse `X-Fennec-Shim-Secret` verbatim OR alias to a neutral `X-Fennec-Pairing-Token` — trust model identical. Pairing token source: `secret-store.ts` `readShimSecret`/`generateShimSecret` (lines 36-59); browser/Copilot obtain it via copy-paste pairing (RESEARCH B6.5 option a, recommended), NOT disk read.

---

### `daemon/src/adapters/bridge-events/adapter.ts` (bridge-events normalising adapter)

**Analog:** `daemon/src/adapters/claude-code/adapter.ts` (EXACT — same EventEmitter-subscriber pattern, S1/S2/S4).

Subscribe to the bridge `"events"` event instead of `"hook"` (adapter.ts:83 → `this.bridge.on("events", this.handler)`). Normalise by source-tool discriminator into `tool: "copilot" | "chatgpt-web" | "claude-ai-web"`. Wire in `daemon/src/cli/daemon.ts` step 6/7 (daemon.ts:162-170) alongside `ClaudeCodeAdapter`:
```typescript
registry.register(new BridgeEventsAdapter(bridge, {...}));
```
Copilot payloads carry NO token counts (RESEARCH B5.3) — normaliser leaves `usage` undefined; strip EITHER `copilot/` or `github.copilot-chat/` prefix from `modelId`, tolerate missing `modelId` (B5.2 caveat).

---

### `vscode-extension/` (Copilot sidecar workspace) — PARTIAL ANALOG (new workspace)

**Analog:** no in-repo VS Code extension exists. The POST-to-bridge shape is the only reusable piece (mirror what the Go shim does against `/v1/hook`, now `/v1/events`).

**Shape (RESEARCH B5.5):** `package.json` with `engines.vscode` ≤ dev machine, `activationEvents:["onStartupFinished"]`, `main:"./out/extension.js"`. On activate, timer reads `~/Library/Application Support/Code/User/workspaceStorage/<md5>/chatSessions/*.json` (RESEARCH B5.1 — NOT `github.copilot-chat/globalStorage`), diffs against last-seen `requestId`s in `context.globalState`, POSTs new requests to `http://127.0.0.1:7821/v1/events` with the pairing-token header. Buffer-then-flush, fail-open (D2-10). Package with `vsce package`. chatSessions shape: `requests[i].message.text` (prompt), `requests[i].modelId` (model), `requests[i].response` (B5.2).

---

### `extension/` (MV3 browser workspace) — NO IN-REPO ANALOG (highest risk; build LAST)

**Analog:** none in fennec; none in synapse (net-new per CLAUDE.md). The POST-to-bridge shape is the only reuse.

**Shape (RESEARCH B6, CLAUDE.md locked "raw MV3 + tsc, no Plasmo/WXT"):** content script `world:"MAIN"`, `run_at:"document_start"` monkeypatches `window.fetch` + `XMLHttpRequest.prototype.send` before page JS; posts to SW via `chrome.runtime.sendMessage`; SW buffers in `chrome.storage.local`; `chrome.alarms` (min 1-min period) flushes to `http://127.0.0.1:7821/v1/events`. URL match patterns (volatile — verify at build, Q8): `*/backend-api/conversation*` (ChatGPT), `*/completion*` (Claude.ai). Anti-bot mitigation: smallest wrapper preserving `fetch.toString()` + `[Symbol.toStringTag]` (B6.2). **Build LAST so a defer decision (Q2/D2-11) doesn't strand earlier work; acceptance met by local capture OR documented defer.**

---

### `daemon/src/cli/inspect.ts` (CLI command, batch read)

**Analog:** `daemon/src/cli/daemon.ts` for the `export async function runX(opts)` shape; `replayFromWatermark` (jsonl.ts:50-88) for the data source; `loadEnv()` (env.ts:35-47) for the backend URL.

**Read pattern (D2-29/D2-30, RESEARCH D12):**
```typescript
export async function runInspect(opts: { since?: string; json?: boolean; full?: boolean }): Promise<void> {
  const env = loadEnv();
  for await (const ev of replayFromWatermark(env.queuePath, null)) {   // null = yield everything
    // filter by occurred_at >= now - window (default 24h; --since override)
    // print tool, occurred_at, kind, redacted payload  (already-redacted in queue — D2-30)
  }
  // then print env.apiBaseUrl as the destination
}
```
Events in the queue are ALREADY redacted (registry.makeEmit redacts before appendEvent — registry.ts:192-195), so `inspect` shows exactly what leaves the machine — no separate redaction pass. **Canary test (CAP-18):** reuse `CANARIES` from `daemon/src/redact/canary-test.ts` (exported via index.ts:68-69); seed a queue with a canary, run `runInspect`, assert raw canary appears ZERO times (RESEARCH D12.4). Flags via existing `getFlag(rest, "--since")` (index.ts:130-138). Output: default human table (truncate long fields), `--json` machine-readable, `--full` opt-out (D2-31).

---

### `daemon/src/index.ts` (MODIFY — add inspect case + export)

**Analog:** the SAME file's `switch (sub)` block (index.ts:146-191) and the export barrel (index.ts:25-94).

Add a case mirroring `wizard`/`init` (index.ts:147-158):
```typescript
case "inspect": {
  const since = getFlag(rest, "--since");
  const { runInspect } = await import("./cli/inspect.js");
  await runInspect({ since, json: rest.includes("--json"), full: rest.includes("--full") });
  return 0;
}
```
Add `export { runInspect } from "./cli/inspect.js";` to the barrel, and an `inspect` line to `printUsage()` (index.ts:106-123).

---

### `backend/wrangler.jsonc` (MODIFY — uncomment + populate queues, add triggers.crons)

**Analog:** the SAME file's commented Phase 2 stub (wrangler.jsonc:62-66).

Replace the commented stub with (RESEARCH C7.1/C7.2, D2-13):
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
},
"triggers": { "crons": ["0 2 * * *"] }
```
Add `EVENTS_QUEUE: Queue` to `backend/src/env.ts` `Env` interface (env.ts:22-35) mirroring `HYPERDRIVE`/`OAUTH_STATE_KV`.

---

### `backend/src/api/events-batch.ts` (MODIFY — one enqueue call, keep hot-path test green)

**Analog:** the SAME handler (events-batch.ts:29-67).

Add ONE binding call AFTER the insert loop (D2-12, RESEARCH C7.5 note — enqueue after insert so a failed insert never enqueues a non-persisted event):
```typescript
const inserted = await insertAiEvent(client, row);
accepted += 1;
await c.env.EVENTS_QUEUE.send({ idempotency_key: event.idempotency_key, occurred_at: event.occurred_at, org_id });
```
**CRITICAL (ING-04):** this is a BINDING call (`env.EVENTS_QUEUE.send`), NOT a module import. Do NOT import any `correlation`/`model-fit`/`aggregator`/`analysis` module — the existing `events-batch.hot-path.test.ts` greps for those `from "..."` imports (test lines 22-36). The 4 hot-path tests MUST stay green.

---

### `backend/src/workers/correlation-and-model-fit.ts` (Queue consumer `queue()`)

**Analog:** `backend/src/api/events-batch.ts` for the pg lifecycle (S8); `backend/src/db/queries/ai-events.ts` for the upsert (S7).

**⚠ ONE consumer, TWO functions (D2-14, RESEARCH C7.4 — Cloudflare allows only ONE push consumer per queue):**
```typescript
export async function queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
  const client = pgClient(env);
  await client.connect();
  try {
    for (const msg of batch.messages) {
      await correlateEvent(msg.body, client);   // idempotent upsert → prompt_outcomes
      await scoreModelFit(msg.body, client);     // idempotent upsert → model_fit_scores
    }
    batch.ackAll();
  } finally {
    ctx.waitUntil(client.end());
  }
}
```
**Correlation (ANL-01/02/03, RESEARCH C8):** ±15-min join (D2-16, config constant) on `git_events` by `occurred_at BETWEEN $at - interval '15 minutes' AND $at + interval '15 minutes'` + matching `repo_remote`/`repo_branch`. ALWAYS write exactly one `prompt_outcomes` row even with zero git matches (D2-17). Confidence interval (D2-18): `confidence_band` + `confidence_low`/`confidence_high`, never a bare number. Revert downgrade (D2-19): UPDATE existing row to `attribution_state='downgraded_by_revert'` + `downgraded_at`/`downgrade_reason`, never decrement a total.

**Model-fit (ANL-04, RESEARCH C9):** PURE function `scoreModelFit(promptEvent, correlatedGitEvent?)`, zero network — guarded by S9. Inputs: prompt length, file-edit size, tool-call count, model tier (from data lookup, D2-22). Persist score + ALL input signals (D2-21). Verdict `fit_verdict ∈ {under_powered, fit, over_powered}`.

**Register `queue` in `backend/src/index.ts`** as a sibling of the default-export `app` (index.ts:28-39 currently exports only `app` as default; Cloudflare needs `{ fetch, queue, scheduled }`).

---

### `backend/src/workers/aggregator.ts` (cron `scheduled()`)

**Analog:** `backend/src/api/events-batch.ts` (pg lifecycle S8) + `ai-events.ts` (upsert S7).

**Cron handler (ANL-05, RESEARCH C10.1/C10.2, D2-23):**
```typescript
export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const client = pgClient(env);
  await client.connect();
  try {
    // read raw ai_events/git_events/prompt_outcomes/model_fit_scores for the day
    // UPSERT one daily_rollups_by_user + one daily_rollups_by_project per entity/day
    //   ON CONFLICT (org_id, user_id, day) DO UPDATE SET ...   (REPLACES the day, never appends)
  } finally {
    ctx.waitUntil(client.end());
  }
}
```
Aggregator is NOT a queue consumer — it reads already-written rows (D2-14). Idempotent: re-run for a day replaces that day's rollups.

**Cost model (ANL-07/08/09, RESEARCH C11, D2-24/25/26/27):** four DISTINCT multiplications (`input`, `output`, `cache_creation`, `cache_read` × their own price columns) — never collapse (PITFALL P6). Price from `model_pricing` by `occurred_at ∈ [effective_from, effective_to)`. NO hardcoded price constant (S9 grep guard). `cost_estimated` always populated; `cost_billed` NULL until reconciliation. Subscription = separate `cost_subscription` field, NEVER summed into `cost_estimated`.

**Register `scheduled` in `backend/src/index.ts`** alongside `fetch`/`queue`.

---

### `backend/src/workers/model-fit.no-llm.test.ts` (static-import guard)

**Analog:** `backend/src/api/events-batch.hot-path.test.ts` (EXACT — S9, test lines 12-37).

Copy the `readFileSync` + `expect(source).not.toMatch(...)` structure; assert the scorer source imports no `fetch`/`http`/`undici`/`node:net`/`node:https` and contains no `fetch(`/`XMLHttpRequest`. A second test file (`no-hardcoded-price.test.ts`) uses the same technique to grep the aggregator source for numeric price literals (ANL-08).

---

### `supabase/migrations/...008_prompt_outcomes.sql` + `...009_model_fit_scores.sql` (migrations, per-event)

**Analog:** `..002_ai_events_partitioned.sql` (partition+PK, S6) + `..006_rls_policies.sql` (RLS, S5).

Partition by `occurred_at` (RESEARCH E13.2), PK `(idempotency_key, occurred_at)` or `(prompt_event_id, occurred_at)`. `prompt_outcomes` columns: `org_id`, `prompt_event_id`/`idempotency_key`, `git_event_id` (nullable), `confidence_band TEXT CHECK (... IN ('low','medium','high'))`, `confidence_low NUMERIC`, `confidence_high NUMERIC` (both NOT NULL, CHECK `confidence_low <= confidence_high`, both in `[0,1]`), `attribution_state TEXT CHECK (... IN ('attributed','downgraded_by_revert','no_outcome'))`, `downgraded_at TIMESTAMPTZ NULL`, `downgrade_reason TEXT NULL` (RESEARCH C8.3/C8.4). `model_fit_scores` columns: `score NUMERIC`, `fit_verdict TEXT CHECK (...)`, `prompt_length INT`, `file_edit_size INT`, `tool_call_count INT`, `model TEXT`, `model_tier TEXT` (RESEARCH C9.2). RLS per S5. Create current+next month partitions like `..002` lines 42-48.

---

### `supabase/migrations/...010_model_pricing.sql` (migration, reference data) — PARTIAL ANALOG

**Analog:** `..003_git_events_partitioned.sql` for the CHECK-constraint idiom (line 17); RLS from S5. The EXCLUDE/btree_gist non-overlap constraint is NET-NEW (no in-repo precedent).

PLAIN table (RESEARCH E13.2). `pricing_kind TEXT CHECK (pricing_kind IN ('per_token','subscription'))` discriminator (D2-27 leaner default). Per-token rows: `model`, `token_kind`, `input/output/cache_creation/cache_read` prices, `effective_from`, `effective_to`. Subscription rows: `monthly_price`. Net-new non-overlap (RESEARCH C11.4):
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE model_pricing ADD CONSTRAINT model_pricing_no_overlap
  EXCLUDE USING gist (model WITH =, token_kind WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&)
  WHERE (pricing_kind = 'per_token');
```
Include `tier` column (or a sibling `model_tiers`) for the model→tier lookup (D2-22). RLS per S5 (org_id — pricing is reference data but D2-28 stamps all five tables; verify whether pricing is global vs per-org with the planner).

---

### `supabase/migrations/...011_daily_rollups_by_user.sql` + `...012_daily_rollups_by_project.sql` (migrations, plain)

**Analog:** `..001_orgs_users_keys.sql` style for a plain (un-partitioned) table; `..006` for RLS (S5).

PLAIN tables (RESEARCH E13.2). Unique `(org_id, user_id, day)` / `(org_id, project_id, day)` (the aggregator's ON CONFLICT target, S7). Columns: `org_id`, `user_id`/`project_id`, `day DATE`, `event_count`, `cost_estimated NUMERIC NOT NULL`, `cost_billed NUMERIC NULL`, `cost_subscription NUMERIC` (D2-25/27, RESEARCH C11.5/C11.6). RLS per S5.

---

### `supabase/migrations/...013_seed_model_pricing.sql` (seed migration)

**Analog:** `..007_seed_phase1_test_data.sql` (EXACT — `ON CONFLICT DO NOTHING` idempotent seed, lines 22-93).

Seed verified 2026-07-01 prices (RESEARCH C11.2/C11.3/C11.7 — re-verify at build): Claude Opus 4.8 `$5/$25/$6.25/$0.50`; Sonnet 5 cutover (seed BOTH effective-date rows — through 2026-08-31 `$2/$10`, from 2026-09-01 `$3/$15` — this exercises the effective-date machinery); Haiku 4.5 `$1/$5`. Subscriptions: Copilot Pro `$10/mo` (NOT $19 — RESEARCH C11.7 refines SPEC), ChatGPT Plus `$20/mo`. Use `ON CONFLICT DO NOTHING` per `..007`.

---

### `packages/shared/src/events/<tool>-payload.ts` (Zod validators ×N)

**Analog:** `packages/shared/src/events/claude-code-payload.ts` (EXACT).

One file per new tool (`codex-payload.ts`, `gemini-payload.ts`, `cursor-payload.ts`, `copilot-payload.ts`, browser payloads). Copy the `z.object({ prompt_text, session_id, ... })` shape (lines 44-51) + reuse `AnthropicUsageSchema` (lines 27-35) where token fields apply. Runtime-neutral: import `zod` only, NO `node:*` (so Workers consume it — canonical.ts:33-35 note). Row types for `prompt_outcomes`/`model_fit_scores`/rollups (consumed by workers now, Phase 4 frontend later) go in a new `packages/shared/src/analysis/` following `canonical.ts` shape.

**NO `schema_version` bump (RESEARCH E13.4):** all eight tools already in `ToolSchema` (canonical.ts:9-18); git kinds live in the `git_events` CHECK not `EventKindSchema`; AI prompts map to existing `prompt_submitted`/`tool_call` kinds. `CanonicalEventSchema.schema_version` stays `z.literal(1)`.

---

### `packages/shared/src/index.ts` (MODIFY — barrel)

**Analog:** the SAME file's `export *` list (index.ts:11-18). Add `export * from "./events/<tool>-payload.js";` lines + `export * from "./analysis/...js";`.

---

## No Analog Found

Files with no close in-repo match (planner uses RESEARCH.md §B.6 / §A.3 patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `extension/` (MV3 browser content-script + SW) | component | streaming monkeypatch | No browser extension exists in fennec OR synapse; the fetch/XHR monkeypatch + `chrome.storage.local`/`chrome.alarms` buffer-flush is net-new (RESEARCH B6, CLAUDE.md). Only the POST-to-`/v1/events` shape is reused. Highest-risk surface; build LAST; defer-able at v1-freeze (Q2). |
| `daemon/src/adapters/cursor/` SQLite read | adapter | file-I/O (SQLite) | `node:sqlite` `DatabaseSync({readOnly:true})` has no in-repo precedent (daemon is zero-native-dep, no prior SQLite). synapse `cursor.ts` parses outdated per-workspace `.json` and must NOT be copied (RESEARCH A3.1/State-of-the-Art). The `Adapter`/normaliser SHAPE is analogous; the read mechanism is new. |

**Partial-analog dependencies to add (RESEARCH Wave 0 / Environment Availability):**
- `chokidar@^5.0.0` → `daemon/package.json` (blocks ALL four in-process file-watch adapters; currently absent).
- `@cloudflare/vitest-pool-workers` → `backend` dev deps (for high-fidelity `queue()`/`scheduled()` tests; fallback = test handler functions with a mocked `env`).
- `@vscode/vsce` (Copilot sidecar packaging), VS Code `@types/vscode` matching the dev-machine baseline.

---

## Metadata

**Analog search scope:** `daemon/src/adapters/`, `daemon/src/queue/`, `daemon/src/cli/`, `daemon/src/index.ts`, `daemon/src/env.ts`, `backend/src/api/`, `backend/src/db/`, `backend/src/index.ts`, `backend/src/env.ts`, `backend/wrangler.jsonc`, `supabase/migrations/`, `packages/shared/src/`. External pattern references (NOT fennec files, read-for-pattern only): `~/Documents/synapse/mcp/src/capture/adapters/{codex,gemini,cursor}.ts`.
**Files scanned:** 17 fennec source/config/migration files read in full.
**Project skills:** none found (`.claude/skills/`, `.agents/skills/` absent).
**Pattern extraction date:** 2026-07-01
