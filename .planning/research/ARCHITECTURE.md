# Architecture Research

**Domain:** AI usage observability with local capture daemon + cloud backend (distributed n8n-style)
**Researched:** 2026-05-31
**Confidence:** HIGH (synapse reference architecture is concrete and battle-tested; observability patterns are well established)

## Standard Architecture

### System Overview

Fennec is a three-tier system with a deliberately thin local agent, a stateless edge backend, and a read-mostly dashboard. The distinguishing trait vs. generic observability is that the **producer of events is the developer's machine**, not the user's running application — capture sits next to AI tools at the source.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT EDGE — developer machine                     │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               │
│  │  Claude Code    │  │  Codex / Gemini │  │  Cursor /       │               │
│  │  hooks          │  │  CLI transcripts│  │  Copilot IDE    │               │
│  │  (push)         │  │  (file watch)   │  │  (extension or  │               │
│  │                 │  │                 │  │   transcript    │               │
│  │                 │  │                 │  │   watch)        │               │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘               │
│           │                    │                    │                        │
│  ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐               │
│  │  ChatGPT /      │  │  Local git      │  │  Daemon health  │               │
│  │  Claude.ai      │  │  watcher        │  │  / heartbeat    │               │
│  │  (browser ext   │  │  (chokidar +    │  │  (timer-based)  │               │
│  │   → localhost)  │  │   simple-git)   │  │                 │               │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘               │
│           ▼                    ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                FENNEC DAEMON  (Node, single process)                  │   │
│  │                                                                       │   │
│  │   AdapterRegistry       ──► RawEvent ──► Normalizer ──► CanonicalEvent│   │
│  │   - claude-code-hook                                          │      │   │
│  │   - codex-transcript                                          ▼      │   │
│  │   - gemini-transcript                          ┌──────────────────┐  │   │
│  │   - cursor / copilot                           │ LocalQueue       │  │   │
│  │   - browser-ext (HTTP POST → 127.0.0.1)        │ SQLite (better-  │  │   │
│  │   - git-watcher                                │ -sqlite3 WAL)    │  │   │
│  │                                                │ idempotency_key  │  │   │
│  │   SyncLoop (timer + flush-signal)              │  PRIMARY KEY     │  │   │
│  │   - batch 100 events / 5s                      └────────┬─────────┘  │   │
│  │   - exponential backoff on 5xx                          │            │   │
│  │   - watermark advances on 2xx                           ▼ HTTPS      │   │
│  │   - dead-letter after N retries                                      │   │
│  └─────────────────────────────────────────┬─────────────────────────────┘  │
└────────────────────────────────────────────┼────────────────────────────────┘
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              BACKEND — Cloudflare Workers + Hono (stateless edge)             │
│                                                                              │
│  ┌────────────────────────────┐    ┌──────────────────────────────────┐     │
│  │ POST /api/events/batch     │    │ POST /api/git-events/batch       │     │
│  │ - auth: daemon API key     │    │ - same handler shape             │     │
│  │ - dedupe: idempotency_key  │    │ - separate route only for clarity│     │
│  │ - skew clamp ±5min         │    │                                  │     │
│  │ - upsert events row        │    │ Both: tagged with org_id from    │     │
│  │ - enqueue correlation job  │    │ api_key lookup at middleware     │     │
│  └─────────────┬──────────────┘    └─────────────┬────────────────────┘     │
│                ▼                                  ▼                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Queues / Cron triggers (Cloudflare Queues or Durable Object alarms) │   │
│  │  - CorrelationWorker — joins prompts ↔ git outcomes by time window   │   │
│  │  - ModelFitWorker   — heuristic on (prompt complexity, model used)   │   │
│  │  - AggregatorCron   — nightly per-project / per-user rollups         │   │
│  └─────────────┬─────────────────────────┬─────────────────────────────┘   │
│                ▼                         ▼                                   │
│  ┌────────────────────────────┐    ┌────────────────────────────┐           │
│  │ GET /api/orgs/:id/...      │    │ /auth, /api/keys, /invites │           │
│  │ dashboards-read endpoints  │    │ (synapse-pattern)          │           │
│  │ (pre-aggregated reads)     │    │                            │           │
│  └─────────────┬──────────────┘    └────────────────────────────┘           │
└────────────────┼──────────────────────────────────────────────────────────────┘
                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  SUPABASE POSTGRES  (RLS-gated, partitioned)                  │
│                                                                              │
│  ai_events  ────► PARTITION BY RANGE (occurred_at) monthly                   │
│  git_events ────► PARTITION BY RANGE (occurred_at) monthly                   │
│  prompt_outcomes (correlation engine output, derived)                        │
│  model_fit_scores (model-fit engine output, derived)                         │
│  daily_rollups_by_user, daily_rollups_by_project (aggregates)                │
│                                                                              │
│  orgs · projects · users · org_members · project_members                     │
│  api_keys · invites · subscriptions                                          │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND — SvelteKit (server-rendered)                  │
│  Routes:                                                                     │
│   /orgs/[org]/users/[user]      — per-user view                              │
│   /orgs/[org]/projects/[proj]   — per-project view                           │
│   /orgs/[org]/prompts/[id]      — drill-down to a single prompt              │
│   /orgs/[org]/settings/...      — keys, members, billing                     │
│                                                                              │
│  +page.server.ts → backend API (read-only) → render aggregates               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Adapter | Tail one specific AI surface, emit raw events tagged with adapter id | One file per tool under `daemon/src/adapters/`; implements `Adapter` interface (`start()`, `stop()`, `tool`, `watchPaths()`) |
| Normalizer | Turn adapter-specific raw events into the canonical `AiRequestEvent` schema | Per-adapter `normalize(raw): CanonicalEvent[]` plus a shared validator |
| LocalQueue | Durable append + dedupe + watermark cursor | SQLite (`better-sqlite3`) with WAL mode, single table `pending_events` keyed by `idempotency_key TEXT PRIMARY KEY` |
| SyncLoop | Drain queue → batch → POST → mark synced; retry/backoff; honour flush signal | One `setInterval` + a 100ms signal-file check, just like synapse's `startHandoffLoop` |
| Git watcher | Emit `FileEdited`, `CommitMade`, `BranchSwitched`, `Reverted` events from `.git/` and the working tree | Sibling adapter; uses `chokidar` for FS watch + `simple-git` for repo state |
| Health/heartbeat | Daemon writes `~/.fennec/daemon.healthcheck` every N seconds; `fennec doctor` checks freshness | Same as synapse |
| Browser bridge | Receive prompt captures from extension via `localhost:<port>` POST | Lightweight `http.createServer` inside the daemon, bound to `127.0.0.1` only, optional shared-secret header |
| Ingest endpoint | Auth, dedupe, validate, upsert; emit correlation/model-fit jobs | Hono route on Cloudflare Workers |
| Correlation worker | Stitch prompts ↔ subsequent git outcomes within a time window | Cloudflare Queue consumer or Durable Object scheduled alarm |
| Model-fit worker | Score each prompt as `appropriate / overkill / underpowered` for its task class | Same execution surface as correlation; scored on backend so heuristics can be tuned without redeploying daemons |
| Aggregator | Nightly rollups: tokens/cost per user, per project, per model | Workers cron (`*/cron` trigger), writes to `daily_rollups_*` |
| Frontend reader | SSR pages reading the pre-aggregated rollup tables | SvelteKit `+page.server.ts` calling backend JSON endpoints |

## Recommended Project Structure

```
fennec/
├── daemon/                      # Local Node binary (cross-platform)
│   ├── src/
│   │   ├── index.ts             # CLI entry + daemon main
│   │   ├── adapters/
│   │   │   ├── adapter.ts       # Adapter interface
│   │   │   ├── registry.ts      # Loads + lifecycle-manages adapters
│   │   │   ├── claude-code/     # Hook-based (subcommands: `fennec hook <kind>`)
│   │   │   ├── codex/           # File-watch over ~/.codex/sessions/
│   │   │   ├── gemini/          # File-watch over ~/.gemini/sessions/
│   │   │   ├── cursor/          # Storage TBD — likely transcript or extension
│   │   │   ├── copilot/         # Extension or telemetry file
│   │   │   ├── browser-bridge/  # localhost HTTP receiver for browser-ext
│   │   │   └── git-watcher/     # chokidar + simple-git
│   │   ├── normalize/
│   │   │   ├── canonical.ts     # AiRequestEvent type + per-adapter normalisers
│   │   │   └── validate.ts      # Zod schema; one source of truth
│   │   ├── queue/
│   │   │   ├── sqlite.ts        # better-sqlite3 + WAL + idempotency PK
│   │   │   └── watermark.ts     # last-synced cursor
│   │   ├── sync/
│   │   │   ├── loop.ts          # startSyncLoop, signalFlush()
│   │   │   ├── batch.ts         # runFlushCycle (POST with retries)
│   │   │   └── backoff.ts       # exponential + jitter
│   │   ├── service/
│   │   │   ├── launchd.ts       # macOS plist writer
│   │   │   ├── systemd.ts       # Linux unit writer
│   │   │   └── windows.ts       # Windows service via node-windows or NSSM
│   │   ├── cli/
│   │   │   ├── handlers.ts      # HANDLERS map (synapse-pattern)
│   │   │   ├── wizard.ts        # `fennec wizard`
│   │   │   ├── doctor.ts        # `fennec doctor`
│   │   │   └── status.ts
│   │   └── config/
│   │       └── load.ts          # Reads ~/.fennec/config.json (api_key, api_url)
│   └── browser-extension/       # Manifest V3 extension (separate build target)
│       ├── manifest.json
│       ├── content-scripts/     # one per host (chatgpt.com, claude.ai)
│       └── background.ts        # POST to http://127.0.0.1:<port>
│
├── backend/                     # Cloudflare Workers + Hono
│   ├── src/
│   │   ├── index.ts             # Hono app + route mounting + cron
│   │   ├── api/
│   │   │   ├── events-batch.ts  # POST /api/events/batch  (AI events)
│   │   │   ├── git-batch.ts     # POST /api/git-events/batch
│   │   │   ├── orgs.ts          # CRUD + members
│   │   │   ├── projects.ts
│   │   │   ├── api-keys.ts
│   │   │   ├── dashboards.ts    # Read-only aggregate endpoints
│   │   │   ├── prompts.ts       # Drill-down: GET /api/prompts/:id
│   │   │   ├── invites.ts       # Invites + accept (synapse pattern)
│   │   │   └── auth.ts
│   │   ├── workers/
│   │   │   ├── correlation.ts   # Queue consumer: prompt ↔ git stitching
│   │   │   ├── model-fit.ts     # Queue consumer: scoring
│   │   │   └── aggregate.ts     # Cron: daily rollups
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   └── queries/         # One file per resource
│   │   ├── lib/
│   │   │   ├── auth.ts          # JWT or daemon-API-key, sets org_id ctx
│   │   │   ├── validate.ts
│   │   │   ├── errors.ts
│   │   │   ├── env.ts
│   │   │   └── idempotency.ts
│   │   ├── middleware/
│   │   │   └── db.ts
│   │   └── cron/                # Workers scheduled handlers
│   └── wrangler.jsonc
│
├── frontend/                    # SvelteKit dashboard
│   ├── src/
│   │   ├── routes/
│   │   │   ├── (app)/
│   │   │   │   ├── orgs/[org]/
│   │   │   │   │   ├── overview/
│   │   │   │   │   ├── users/[user]/        # Per-user view (first-class)
│   │   │   │   │   ├── projects/[project]/  # Per-project view (first-class)
│   │   │   │   │   ├── prompts/[id]/        # Drill-down detail
│   │   │   │   │   └── settings/{members,keys,billing}/
│   │   │   ├── login/ signup/ logout/
│   │   │   └── share/[token]/   # Future: public dashboard sharing
│   │   ├── lib/
│   │   │   ├── server/{api,auth}.ts
│   │   │   └── components/
│   │   │       ├── charts/
│   │   │       ├── tables/
│   │   │       └── filters/
│   └── svelte.config.js
│
├── packages/
│   └── shared/                  # @fennec/shared — types + validators
│       ├── src/
│       │   ├── events/
│       │   │   ├── ai-request.ts   # AiRequestEvent canonical schema
│       │   │   ├── git-event.ts    # GitEvent canonical schema
│       │   │   └── kinds.ts        # EventKind enums
│       │   ├── correlation/
│       │   │   └── types.ts        # PromptOutcome shape
│       │   ├── tenancy/
│       │   │   └── types.ts        # Org, Project, User, ApiKey, Member
│       │   └── index.ts
│       └── test/
│
├── supabase/
│   └── migrations/              # Numbered SQL (000_*, 001_*, ...)
│
├── self-host/                   # Single-box bundle
│   ├── docker-compose.yml       # workers-runtime alt OR plain node server
│   ├── Caddyfile / nginx conf
│   └── README.md
│
├── biome.json
├── package.json                 # workspaces: daemon, backend, frontend, packages/*
└── README.md
```

### Structure Rationale

- **`daemon/` is a workspace, not a sub-folder of mcp/**: synapse merged MCP + daemon because MCP was central; fennec doesn't ship an MCP server day 1 (see below), so the binary's primary identity is "daemon," not "MCP CLI."
- **`adapters/` as folders, not files**: each adapter is non-trivial (parser + watcher + tool-specific config). One-file-per-adapter (synapse's pattern) works until an adapter needs its own helpers — fennec will grow past that quickly because every AI tool has a different transcript format.
- **`normalize/` separate from `adapters/`**: the canonical schema is the contract between daemon and backend. Keeping it isolated makes the "is this still the same wire format?" question answerable by reading one folder.
- **`queue/` and `sync/` separate**: queue is durable storage; sync is the loop that drains it. They evolve at different cadences (queue is correctness-critical and rarely changes; sync changes whenever backoff/retry policy is tuned).
- **`packages/shared/` is mandatory**: the event schema lives here so daemon (Node) and backend (Workers) share one source of truth. Drift between the two is the most expensive bug class in this category.
- **`self-host/` is a deployment artefact, not a runtime alternative**: the same code in `backend/` runs in both managed cloud and self-host; this directory only contains compose files, reverse-proxy configs, and operator docs.

## Architectural Patterns

### Pattern 1: Append-only local event log with idempotency-keyed dedupe

**What:** Every captured event is appended to a SQLite table keyed by a `idempotency_key` that the daemon generates deterministically (e.g. ULID, or `sha256(tool|session|message_id|seq)`). The sync loop reads in batches, POSTs, and only deletes (or marks `synced=1`) rows once the backend confirms. Backend upserts on the same key, ignoring duplicates.

**When to use:** Every event-ingestion pipeline with network legs. Mandatory for fennec.

**Trade-offs:** SQLite WAL mode is one process-safe, which fits the single-daemon model. Storage grows; need a retention/pruning policy (e.g. delete synced rows older than 7 days, or once watermark advances). Idempotency keys must be stable across daemon restarts and across retries — never use `Date.now()` or random UUIDs generated at POST time.

**Example:**
```typescript
// daemon/src/queue/sqlite.ts
const db = new Database(path.join(home, ".fennec", "queue.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_events (
    idempotency_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pending_unsent ON pending_events(synced, occurred_at);
`);
```

### Pattern 2: Adapter interface — heterogeneous capture, homogeneous emit

**What:** Every capture mechanism implements one interface:

```typescript
// packages/shared/src/adapters/interface.ts
export interface Adapter {
  readonly tool: string;          // "claude-code" | "codex" | "cursor" | ...
  start(emit: (evt: CanonicalEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
```

The daemon's `AdapterRegistry` loads each adapter, hands it an `emit` callback that writes to the queue, and calls `start()`. Adapters never touch the queue or sync loop directly. Adapters are free to use any mechanism (hook subcommand, file watcher, HTTP listener, IPC) as long as they emit canonical events.

**When to use:** Whenever the number of sources is open-ended and the consumer is fixed. This is fennec's core extension point.

**Trade-offs:** The canonical schema must be expressive enough for every adapter — Claude Code hooks have rich tool-use payloads, browser extensions only see raw HTTP, Cursor sees file diffs. Solution: a permissive base shape (`{tool, occurred_at, session_id, kind, payload: object}`) plus adapter-tagged `payload` validators. Resist the urge to bake adapter-specific fields into the top level.

**Example:**
```typescript
// daemon/src/adapters/codex/index.ts
export class CodexAdapter implements Adapter {
  tool = "codex";
  private watcher?: FSWatcher;
  async start(emit) {
    this.watcher = chokidar.watch(path.join(os.homedir(), ".codex/sessions"));
    this.watcher.on("change", async (file) => {
      for (const evt of parseNewLines(file)) emit(toCanonical(evt));
    });
  }
  async stop() { await this.watcher?.close(); }
}
```

### Pattern 3: Ingest is dumb; analysis is async

**What:** The ingest endpoint does only: auth, validate, dedupe-upsert, and enqueue a derivation job. It does NOT correlate, score, or aggregate. Those run on Cloudflare Queues (or Durable Object alarms) consuming the same `event_id` references.

**When to use:** Always, for any high-volume ingestion pipeline. The synapse pattern of synchronously recomputing `ProjectStatus` on every batch is fine when batches are small (handoff events are sparse — a few per session). Fennec batches will be 10–100× larger because every Claude Code tool use is an event; synchronous recompute would balloon p99 latencies and tie up Workers CPU budget.

**Trade-offs:** Dashboards become eventually consistent — a prompt may appear without its outcome correlation for ~minutes. Acceptable for a cost dashboard. The price is added infra surface (queues + worker bindings) and the operator load of monitoring queue depth.

### Pattern 4: Shared schema package, not duplicated types

**What:** All wire-format types (`AiRequestEvent`, `GitEvent`, `BatchRequest`, `BatchResponse`) live in `packages/shared/`. Daemon imports them via `@fennec/shared/events/ai-request`. Backend imports the same module. Zod validators live alongside the types, so both ends validate against the same source.

**When to use:** Mandatory for any monorepo where two services share an HTTP contract. Synapse uses this for handoff types and the reducer.

**Trade-offs:** Workers runtime can't use `node:*` modules, so the shared package must stay runtime-neutral (Zod is fine, `node:fs` is not). Enforce via `tsconfig.json` `types: []` in the shared package.

### Pattern 5: Per-tenant scoping enforced at the auth middleware

**What:** Every authenticated request resolves `org_id` (or `user_id` for personal accounts) from the API key or JWT and stashes it on the Hono context. Every DB query MUST be filtered by `org_id`. RLS policies in Supabase enforce this as a backstop.

**When to use:** Mandatory for multi-tenant systems. Skipping RLS is a CVE waiting to happen.

**Trade-offs:** RLS adds query overhead — not problematic at fennec's expected scale. The bigger trap is forgetting an `org_id` filter on a query that gets called from the wrong context (e.g. a cron job using the service role bypasses RLS). Audit every service-role query manually.

## Data Flow

### Primary Flow — AI Request → Dashboard

```
[Developer types prompt in Claude Code]
        │
        ▼
[Claude Code fires UserPromptSubmit hook]
        │
        ▼ stdin JSON
[Hook subcommand: `fennec hook user-prompt-submit`]
        │ adapter.emit(canonicalEvent)
        ▼
[Daemon LocalQueue.append(idempotency_key, event)]   ← writes survive restart/offline
        │
        ▼ on timer or flush signal
[SyncLoop.runFlushCycle()]
        │ reads batch from queue
        │ POSTs to backend
        ▼
[Backend POST /api/events/batch]
        │ auth → org_id
        │ validate
        │ upsert ON CONFLICT (idempotency_key) DO NOTHING
        ▼
[ai_events row inserted]
        │
        │   enqueue("correlate", { event_id })
        ├──────────────────────────────────────┐
        │                                      │
        ▼                                      ▼
[CorrelationWorker]                  [ModelFitWorker]
- find git events within ±N min      - classify prompt complexity
- compute prompt_outcomes row        - emit model_fit_scores row
        │                                      │
        └──────────────────┬───────────────────┘
                           ▼
                  [Frontend +page.server.ts]
                  GET /api/orgs/X/users/Y
                           │
                           ▼
                  reads daily_rollups_by_user
                  + recent prompt_outcomes
                           │
                           ▼
                  [Per-user dashboard renders]
```

### Secondary Flow — Git Activity (sibling adapter)

```
[Developer commits / switches branch / reverts]
        │
        ▼ FS event on .git/HEAD or working tree
[GitWatcherAdapter]
- run simple-git status/log to enrich
- emit canonical GitEvent
        ▼
[Same LocalQueue.append(...)]            ← same queue, different kind
        ▼
[Same SyncLoop flushes]
        ▼
[Backend POST /api/git-events/batch]     ← could be the same endpoint;
                                            two routes only for clarity
        ▼
[git_events row inserted]
        │
        │   enqueue("correlate", { event_id })
        ▼
[CorrelationWorker]
- find prompts within ±N min
- update prompt_outcomes.outcome
  ∈ {committed, reverted, lingering, abandoned}
```

### Browser Adapter Flow

```
[Developer sends message in chatgpt.com]
        │
        ▼ DOM mutation observer in content-script
[Extension content-script extracts prompt + response]
        │
        ▼ chrome.runtime.sendMessage
[Extension background service-worker]
        │
        ▼ POST http://127.0.0.1:<port>/v1/capture
[Daemon's browser-bridge HTTP listener]
        │ shared-secret header check (loopback only)
        │
        ▼ adapter.emit(canonicalEvent)
[Daemon LocalQueue.append(...)]          ← same downstream path
```

### State Management

```
Truth                                   Derived
─────                                   ───────
ai_events  (immutable, append-only) ──► prompt_outcomes   (derived via correlation worker)
git_events (immutable, append-only) ──► model_fit_scores  (derived via model-fit worker)
                                    ──► daily_rollups_*   (derived via cron aggregator)

Local watermark in SQLite cursor table  cleared after backend ack
```

The rule (lifted directly from synapse's reducer pattern): **never write to a derived table from anywhere other than the worker that owns it**. If the answer changes, re-derive — do not mutate.

## Outcome Correlation — Daemon or Backend?

**Recommendation: backend, exclusively. Daemon ships raw events, never inferred outcomes.**

This is the most consequential architectural decision in fennec, so the reasoning matters.

| Consideration | Daemon-side correlation | Backend-side correlation (recommended) |
|---------------|-------------------------|------------------------------------------|
| Cross-machine outcomes | Impossible — Dev A's prompt on laptop, Dev A's commit on desktop, daemon never sees both | Trivial — backend has all events for the org |
| Heuristic tuning | Requires daemon update (every developer machine) | Backend deploy only |
| Backfill / re-correlation when heuristic improves | Impossible without re-collecting | One SQL/worker run |
| Privacy (self-host) | Slightly better — fewer raw prompts on the wire | Acceptable — the customer's own backend; data never leaves their network |
| Daemon CPU/memory budget | Adds working set (recent git events buffered locally) | Daemon stays tiny |
| Latency | Marginally faster initial outcome (no network) | Seconds-later acceptable for a cost dashboard |

The single argument for daemon-side correlation — "less raw data on the wire" — is moot because in the self-host scenario *the backend is also local to the org*; raw prompts already don't leave the customer's network. In the managed-cloud scenario the prompts are already there.

**Concrete implication:** the daemon's git watcher emits `CommitMade`, `Reverted`, `FileEdited` as plain events alongside AI events. The daemon does NOT attempt to attach a `triggered_by_prompt_id` field. Correlation is the backend's job.

## Event Schema — One Canonical Shape

**Recommendation:** define the canonical shape in `packages/shared/src/events/ai-request.ts` and use it identically on daemon and backend.

```typescript
export interface AiRequestEvent {
  // identity + idempotency
  idempotency_key: string;        // deterministic; stable across retries
  event_id?: string;              // assigned by backend on insert (UUID)

  // tenancy (resolved by daemon from local config + API key)
  api_key_id?: string;            // backend resolves api_key_id → org_id → user_id

  // source
  tool: "claude-code" | "codex" | "gemini" | "cursor" | "copilot"
      | "chatgpt-web" | "claude-ai-web";
  adapter_version: string;

  // time
  occurred_at: string;            // ISO8601, daemon's clock
  received_at?: string;           // backend's clock, set on insert
  session_id: string;             // tool-native or daemon-synthesised

  // workspace context (for project attribution)
  cwd?: string;                   // working dir if known
  git_remote?: string;            // for cross-machine project linking
  git_branch?: string;
  hostname: string;
  os: "darwin" | "linux" | "win32";

  // kind + payload (the heterogeneous part)
  kind: EventKind;                // see below
  payload: Record<string, unknown>;

  // schema versioning
  schema_version: 1;
}

export type EventKind =
  | "prompt_submitted"      // user sent a prompt
  | "model_response"        // model finished a response
  | "tool_call"             // assistant invoked a tool (read file, run bash, ...)
  | "session_start"
  | "session_end"
  | "file_edit_proposed"    // model suggested a diff
  | "file_edit_applied";    // user accepted

export interface GitEvent {
  idempotency_key: string;
  occurred_at: string;
  hostname: string;
  cwd: string;
  git_remote?: string;
  git_branch?: string;
  kind: "file_edited" | "commit_made" | "branch_switched" | "revert_detected";
  payload: Record<string, unknown>;  // commit sha, file list, etc.
  schema_version: 1;
}
```

**Key choices:**
- `schema_version` on every event. Bumping it is a coordinated daemon+backend change — keep it rare.
- `payload` is intentionally open. Strict per-kind schemas live alongside as Zod refinements (`payloadByKind[k]`). The base shape never breaks the wire.
- Sensitive fields like `prompt_text` go in `payload`, not the top level. Self-host operators can configure the daemon to redact (`payload.prompt_text` → `[REDACTED]`) before queue insert if policy requires it.

## Build Order — Critical Path Through v1

The single longest dependency chain is **event schema → ingest → one adapter end-to-end → daemon lifecycle → dashboard skeleton**. Everything else parallelises off the schema being frozen.

### Phase 1 — Foundations (serial; nothing else can ship without this)

1. **Event schema in `packages/shared/`** (~1 day): `AiRequestEvent`, `GitEvent`, `EventKind`, Zod validators, batch request/response types.
2. **Backend skeleton** (~2 days): Hono app, auth middleware (API key only — JWT later), `POST /api/events/batch` with dedupe-upsert, Supabase schema for `ai_events` + `api_keys` + `orgs` + `users`. No correlation yet. No git events route yet.
3. **Daemon skeleton** (~2 days): `daemon/src/index.ts`, config loading, SQLite queue, sync loop, `fennec wizard` minimal flow that asks for an API key and writes `~/.fennec/config.json`. macOS launchd only (Linux + Windows are Phase 5).
4. **One adapter — Claude Code hooks** (~2 days): `fennec hook user-prompt-submit` etc. installed by wizard into `~/.claude/settings.json`. End-to-end smoke: type a prompt in Claude Code, see a row in `ai_events`.

**Exit criterion for Phase 1:** A prompt typed in Claude Code on the developer's machine arrives in Supabase via the daemon, dedupes on retry, survives a daemon restart.

### Phase 2 — Multiple adapters, in parallel (3–4 days each, parallelisable)

Once the schema is frozen and the ingest endpoint exists, the following four can all be developed without blocking each other:

- **Codex + Gemini transcript adapters** (file watchers, lifted directly from synapse's patterns).
- **Cursor / Copilot adapter** (mechanism TBD; spike first to decide extension vs transcript).
- **Browser extension** (Manifest V3, content scripts for chatgpt.com and claude.ai, posts to `127.0.0.1:<port>`).
- **Git watcher adapter** (chokidar + simple-git; emits `GitEvent`s).

Each adapter ships independently behind a feature flag in `~/.fennec/config.json`.

### Phase 3 — Backend analysis layer (parallel with Phase 2)

- **Correlation worker** (Cloudflare Queues + Durable Object alarm OR cron-only first cut): joins `ai_events` ↔ `git_events` by (org, user, project, time window).
- **Model-fit scorer**: heuristic-only v1 (LOC-based prompt complexity vs model name).
- **Daily aggregator**: cron that writes `daily_rollups_by_user` + `daily_rollups_by_project`.

### Phase 4 — Frontend (depends on Phase 1 ingest, parallelisable with 2/3)

- SvelteKit shell, login, layout.
- Per-user view (reads `daily_rollups_by_user` + recent `ai_events`).
- Per-project view (reads `daily_rollups_by_project`).
- Drill-down to single prompt.

The frontend can start as soon as the backend has any data; correlation tables can be empty initially and the UI degrades gracefully.

### Phase 5 — Cross-platform daemon

- Linux systemd unit.
- Windows service (node-windows or NSSM wrapping).
- Cross-machine identity (`git_remote` based project linking on the backend, same as synapse).

### Phase 6 — Self-host packaging

- `docker-compose.yml` for a Workers-runtime alternative (e.g. workerd) or a fallback Node/Hono server target.
- Supabase migrations runnable against a bare Postgres.
- Operator README + `.env.example`.

### Parallelisation Map

```
                      Phase 1 (serial)
                            │
        ┌───────────────────┼──────────────────────────┐
        ▼                   ▼                          ▼
    Phase 2             Phase 3                    Phase 4
   (adapters in       (analysis in              (frontend in
    parallel:          parallel:                  parallel:
    Codex, Gemini,     correlation,              per-user view,
    IDE, browser,      model-fit,                per-project view,
    git-watcher)       aggregator)               drill-down)
        │                   │                          │
        └───────────────────┼──────────────────────────┘
                            ▼
                        Phase 5 (serial — cross-platform daemon)
                            │
                            ▼
                        Phase 6 (serial — self-host packaging)
```

## Self-Host vs Cloud — Topology, Not Code

**Recommendation: identical codebase, deployment-topology variation only.** The daemon ships unchanged in both modes; the difference is what URL it points at.

### Cloud (managed fennec)
- Daemon → `https://api.fennec.dev/api/events/batch` (or whatever the public domain ends up being)
- Backend: Cloudflare Workers, deployed via `wrangler deploy`
- DB: Supabase managed Postgres (multi-tenant; one schema for all orgs, RLS scoped by `org_id`)
- Frontend: Cloudflare Pages or Vercel
- Multi-tenant: `org_id` everywhere

### Self-host (single-org, single-box)
- Daemon → `https://fennec.acme.internal/api/events/batch`
- Backend: same TypeScript code, two acceptable runtimes:
  1. **workerd** (Cloudflare's open-source Workers runtime) — closest to production parity.
  2. **Hono on plain Node** — Hono runs unmodified on Node; backstop if workerd is too operationally heavy for SMB self-host. Pick this if Workers-specific bindings (Durable Objects, Queues) become a porting hazard.
- DB: self-hosted Supabase (Postgres + GoTrue + Realtime) OR plain Postgres. Multi-tenancy is still enforced — a self-host deployment is typically one org but the schema does not require code changes to be single-tenant.
- Frontend: same SvelteKit build, served from any static host or behind the same reverse proxy as the backend.
- Reverse proxy: Caddy or nginx in front of backend + frontend, terminates TLS.

### What drives the difference

A single env var in the daemon (`FENNEC_API_URL`) and a `.env`/`wrangler.toml` on the backend. No `if (selfHosted)` branches in application code. The decision must be respected: if `if (selfHosted)` appears in the codebase, it indicates the architecture has drifted and self-host will rot.

### Hard dependencies a self-hoster must run

| Component | Required? | Alternatives |
|-----------|-----------|--------------|
| Postgres 15+ | Yes | Self-hosted Supabase or plain Postgres + manual auth |
| Workers runtime | Optional | workerd (preferred) OR Hono on Node |
| Object storage | No (v1) | Not needed unless exports/archival is added later |
| Queue infrastructure | Yes | Cloudflare Queues in cloud; for self-host either workerd + a queue shim OR Postgres-backed (`pgmq` / `graphile-worker`) |
| TLS reverse proxy | Yes | Caddy or nginx |
| LLM provider | No (v1) | Model-fit is heuristic-only at first; only needed if v2 adds AI-generated recommendations |

**Recommendation: budget a queue-abstraction layer in the backend from day 1.** Either everything uses Cloudflare Queues (cloud) or a Postgres-backed alternative (self-host). Pick one wire interface (`enqueue(queueName, payload)`) and swap the implementation at the binding boundary, the way synapse swaps Workers KV for direct DB calls. Avoid a divergent self-host code path.

## Browser Capture Architecture — Implications

The STACK.md researcher covers the mechanism choice; here are the architectural implications.

### If extension (recommended path)
- The extension is a separate npm-deployable artefact, not bundled with the daemon binary.
- The daemon runs a **loopback HTTP server** on a configurable port (default 7821) that only binds to `127.0.0.1`.
- Extension → daemon communication uses a shared secret stored in extension storage + `~/.fennec/config.json`. The secret rotates on `fennec wizard`.
- **The browser-bridge is just another adapter.** From the daemon's perspective, an HTTP POST to `/v1/capture` is indistinguishable from a file-watch event — both end at `emit(canonicalEvent)`.

### If proxy (fallback)
- Adds a CA install step to the daemon's wizard — significant friction, ops surface, and trust ask.
- Proxy implementation is a separate process; treat it as a second daemon. Higher complexity.
- Captures raw HTTP (more reliable for ChatGPT/Claude.ai because it doesn't depend on DOM stability) but lower-fidelity (no UI state, no ability to attribute to a project).
- **Treat as a v1.5 escape hatch**, not the default. Ship the extension; fall back to proxy only if the extension proves to consistently miss requests.

### What this means for v1 build order
- Browser extension dev can happen **fully in parallel** with daemon and backend dev because its only contract with the daemon is one HTTP endpoint with one POST body — that body is just a `CanonicalEvent`, which `packages/shared/` already defines.
- The extension does NOT need backend changes. It does NOT need daemon changes once the loopback bridge exists.

## MCP Server — Day 1? No.

Synapse ships an MCP server because **the product itself is a context layer for AI tools**; surfacing the workspace to MCP-aware editors is its UX.

Fennec is an **observability tool for humans** (engineering leaders and developers). The dashboard is the value surface. AI tools are the *subject* of observation, not the *consumer* of insights.

**Recommendation: skip MCP in v1.** Defer to v2+, when "let Claude Code ask 'how am I doing on cost this week?'" becomes a credible UX. That's a much larger product question that should be validated separately.

What this means architecturally:
- No `mcp/` workspace.
- No Streamable HTTP MCP route on the backend.
- The dashboard alone exposes data. CLIs/scripts that want programmatic access use REST with API keys (`GET /api/orgs/:id/...`).

## Scaling Considerations

Fennec's load profile is unusual: a small number of developer machines producing a steady-but-modest stream of events. Even a 1000-developer organisation produces ~1–10 events/sec at peak (one developer firing 10 prompts/min sustained is implausible). The scaling shape is closer to *application logs* than to *web request traffic*.

| Scale | Architecture Adjustments |
|-------|---------------------------|
| 1–50 devs (single org, indie / small team) | Single backend deploy, unpartitioned tables, all-in-one Postgres is fine. Daily aggregates as a cron — no streaming needed. |
| 50–1000 devs (multi-org SaaS, paid tier) | Add monthly `RANGE` partitioning on `ai_events` and `git_events` (Postgres native, no Citus required). Indexes on `(org_id, occurred_at)` and `(user_id, occurred_at)`. Daily-aggregate-only reads for dashboards (never query raw events for aggregates). |
| 1000+ devs (enterprise tier) | Detach old partitions to a cheaper Postgres tier or export+drop. Consider read replicas for dashboard SSR. Move aggregation from cron to streaming (incremental rollups on insert via Postgres triggers or a stream processor). |

### Scaling Priorities

1. **First bottleneck: dashboard queries scanning raw events.** Fix by ensuring every dashboard read hits a pre-aggregated rollup table, not `ai_events`. This is an architectural rule from day 1, not a fix. Treat `ai_events` as write-mostly.
2. **Second bottleneck: correlation worker backlog.** If correlation falls behind, dashboards show stale outcomes. Mitigation: bound the work — only correlate within ±N minutes, skip events older than 24h (they're already aggregated).
3. **Third bottleneck: per-tenant noisy neighbours.** A single org bulk-importing historical sessions could saturate a worker. Mitigation: per-org rate limit on `/api/events/batch` (e.g. 100 batches/min/org), enforced at the auth middleware.

## Anti-Patterns

### Anti-Pattern 1: Adapter writes directly to backend, bypassing the queue

**What people do:** "We already know the API URL, let's just `fetch()` from the adapter." Lifted as a real anti-pattern from synapse (`mcp/src/hooks/post-tool-use.ts`).

**Why it's wrong:** Hooks and watchers run synchronously on the developer's machine. Network I/O blocks the user, breaks offline use, defeats the queue's whole purpose. Worse: it bypasses dedup, retry, and watermark — so a transient backend failure causes silent event loss.

**Do this instead:** Every adapter calls `emit(canonicalEvent)`. The queue and sync loop are the *only* path to the network.

### Anti-Pattern 2: Inferring outcomes in the daemon

**What people do:** "The daemon already saw the prompt and the commit, just stitch them and send the joined record."

**Why it's wrong:** Cross-machine ownership is broken — Dev A prompts on laptop, commits on desktop, daemon never has both halves. Heuristic improvements require shipping new daemons (every dev machine). Backfill is impossible.

**Do this instead:** Daemon ships raw events. Backend correlates with all the org's events available.

### Anti-Pattern 3: Branching code on cloud vs self-host

**What people do:** `if (env.FENNEC_SELF_HOST) { ... }` scattered through the backend.

**Why it's wrong:** Two product surfaces silently diverge. The cloud path stays exercised; the self-host path rots. Self-host becomes a second-class product.

**Do this instead:** Differences live at the **runtime binding layer** (env vars, wrangler config, Postgres connection string). Application code is identical. If a feature genuinely needs different behaviour, it's an abstracted dependency (`Queue`, `Storage`, `Mailer`) with two implementations behind one interface.

### Anti-Pattern 4: Querying raw `ai_events` for dashboard cards

**What people do:** Frontend asks "what's the per-user weekly spend?" → backend queries `SELECT SUM(tokens) FROM ai_events WHERE user_id=? AND occurred_at > ?` on every dashboard load.

**Why it's wrong:** Linear in event count. Fine at 1000 events, painful at 10M. The dashboard becomes the slowest part of the system once any org has a month of data.

**Do this instead:** All dashboard reads hit `daily_rollups_*`. Raw events are only queried for drill-down (single prompt detail, last 100 events for a user). Treat the rollup tables as the *real* product database; raw events as the archive.

### Anti-Pattern 5: Top-level event fields for tool-specific data

**What people do:** Add `claude_code_tool_input` and `codex_response_id` to the canonical event so they don't have to nest into `payload`.

**Why it's wrong:** Every new tool either widens the canonical shape or requires schema-version bumps coordinated across daemon + backend. Six adapters means six waves of breaking changes.

**Do this instead:** Canonical event has 10–15 universal fields. Tool-specific data lives in `payload`. Validate `payload` shape against an adapter-tagged Zod schema in the normalizer.

### Anti-Pattern 6: One process per adapter

**What people do:** Run the Claude Code hook handler, a separate Codex watcher process, a separate git watcher process — "decoupled."

**Why it's wrong:** Multiple OS-service entries (one launchd per adapter), N×health-check surface, multiplied install friction, IPC complexity, racey shared-queue access.

**Do this instead:** One daemon process. Adapters are in-process modules sharing one queue. Synapse made this choice deliberately and it's the right one — fennec inherits it unchanged.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase | Service-role client from Worker; RLS for any frontend-direct reads | Use the *same* client pattern as synapse (`db/client.ts`) |
| Cloudflare Workers | `wrangler deploy` — same model as synapse, manual deploy in v1 | Pre-push hook runs `lint && typecheck && test` to catch drift |
| Cloudflare Queues | For correlation + model-fit workers | Self-host: substitute `pgmq` or `graphile-worker` behind an abstraction |
| Cloudflare Pages | Frontend hosting (cloud only) | Self-host serves the static build via reverse proxy |
| Browsers (Chrome/Edge/Firefox) | Extension via Chrome Web Store + Mozilla Add-ons | Manifest V3; same content-script bundle works across Chromium |
| OS service managers | `launchd` (macOS), `systemd` (Linux), `node-windows` or NSSM (Windows) | Installed by `fennec wizard` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Adapter → Queue | In-process function call (`emit()`) | No threads, no IPC. Single-process daemon. |
| Queue → Sync loop | SQLite read with `synced=0` filter | Loop is one timer; signal-file (`~/.fennec/daemon-flush-now`) for immediate flush, same trick as synapse |
| Daemon → Backend | HTTPS POST `/api/events/batch` | Idempotency-keyed; retried with backoff |
| Browser ext → Daemon | HTTP POST to `127.0.0.1:<port>` | Loopback only, shared secret header |
| Backend → Workers (correlation/model-fit) | Cloudflare Queue message OR Durable Object alarm | Single source of inferred outcomes |
| Backend → Postgres | `@supabase/supabase-js` service-role client | All writes; reads also pre-aggregated |
| Frontend → Backend | `+page.server.ts` → fetch with API key | Same SSR pattern as synapse |
| Shared types | `@fennec/shared` package | One source of truth for wire format |

## Sources

- Synapse codebase architecture (`~/Documents/synapse/.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`) — primary reference for daemon + Workers + adapters pattern. HIGH confidence (current, battle-tested code).
- Synapse README and CLAUDE.md — daemon lifecycle, hook patterns, cross-machine identity. HIGH confidence.
- [OpenTelemetry Collector — Resiliency](https://opentelemetry.io/docs/collector/resiliency/) — durable queue, batching, retry patterns. HIGH confidence.
- [OpenTelemetry — Persistent Disk-Backed Queues](https://oneuptime.com/blog/post/2026-02-06-persistent-disk-queues-otel-crash-recovery/view) — WAL-backed queue rationale. MEDIUM confidence.
- [AI Observability Tools Landscape — Monte Carlo](https://montecarlo.ai/blog-best-ai-observability-tools/) — adjacent category (LLM-app observability vs dev-tool observability). MEDIUM confidence.
- [AWS Prescriptive Guidance — Multi-Tenant Postgres Partitioning Models](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/partitioning-models.html) — silo/bridge/pool models; fennec uses pool. HIGH confidence.
- [ClickHouse — Multi-Tenant SaaS on Postgres](https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture) — partitioning + retention for event tables. MEDIUM confidence.
- [Postgres time-based partitioning — Stormatics](https://stormatics.tech/blogs/improving-postgresql-performance-with-partitioning) — RANGE partitioning practical guide. MEDIUM confidence.
- [Browser extensions capturing LLM prompts — DEV Community](https://dev.to/anmolbaranwal/how-to-sync-context-across-ai-assistants-chatgpt-claude-perplexity-in-your-browser-2k9l) — content-script DOM patterns for ChatGPT/Claude. MEDIUM confidence (community write-up).
- [Chrome MV3 content script capture analysis — Microsoft Security](https://www.microsoft.com/en-us/security/blog/2026/03/05/malicious-ai-assistant-extensions-harvest-llm-chat-histories/) — confirms feasibility of DOM-level prompt capture (and the privacy risks). HIGH confidence (vendor security analysis).

---
*Architecture research for: AI usage observability + capture daemon (fennec)*
*Researched: 2026-05-31*
