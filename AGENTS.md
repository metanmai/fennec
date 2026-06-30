# AGENTS.md — Fennec

## Project

Fennec is an **AI usage and cost observability platform** for orgs that pay for AI coding tools. A local daemon captures AI prompts across CLIs, IDEs, and browsers; correlates them with git activity; and surfaces per-developer and per-project cost attribution in a web dashboard. Distributed n8n-style: open-source self-hostable + managed cloud.

- **Language**: TypeScript end-to-end (plus two tiny Go binaries for macOS daemon plumbing)
- **Runtime**: Node 22 LTS (daemon), Cloudflare Workers (backend)
- **License**: Apache 2.0
- **Solo developer** — attention is the bottleneck

## Essential Commands

```bash
# All from repo root
npm run lint          # Biome check (lint + format)
npm run lint:fix      # Biome auto-fix
npm run typecheck     # TypeScript project references build (tsc --build)
npm run test          # Vitest run across all workspaces
npm run test:unit     # Vitest with dot reporter, CI-friendly
npm run test:e2e      # Playwright e2e (requires live infra)
npm run build         # tsc --build
npm run clean         # Clean build outputs

# Go tests (run in shim/ or notifier/ dirs)
go test ./...

# Backend local dev
cd backend && npm run dev     # wrangler dev

# DB migrations
bash scripts/db-push.sh       # Requires SUPABASE_ACCESS_TOKEN env
```

## Monorepo Structure

```
fennec/
├── packages/shared/      # @fennec/shared — Zod schemas, event types. RUNTIME-NEUTRAL (no node:*).
├── daemon/               # @fennec/daemon — Node 22 CLI + long-lived daemon process
├── backend/              # @fennec/backend — Cloudflare Workers + Hono HTTP API
├── installer/            # macOS .pkg build pipeline (Windows/Linux planned)
├── shim/                 # Go binary: Claude Code hook shim (fail-open, 15ms budget)
├── notifier/             # Go binary: macOS Helper LaunchAgent (user-session GUI bridge)
├── supabase/migrations/  # Postgres DDL (timestamp-ordered)
├── tests/
│   ├── e2e/              # Playwright specs (live infra)
│   ├── ci/               # CI verification scripts
│   └── manual/           # Shell scripts for manual smoke testing
├── scripts/              # Build/db helper scripts
└── .planning/            # GSD planning artifacts (not source code)
```

## Architecture & Data Flow

### Event Ingestion Pipeline

```
Claude Code hook fires
  → shim/ (Go binary) reads stdin payload, POSTs to 127.0.0.1:7821/v1/hook
  → daemon loopback bridge validates X-Fennec-Shim-Secret
  → Claude Code adapter normalises payload → calls Emit callback
  → AdapterRegistry: buildCanonicalEvent → redactEvent → JSONL queue append
  → SyncLoop: readNextBatch → POST /api/events/batch to backend
  → Hono route: bearerAuth → zValidator(EventBatchSchema) → insertAiEvent (ON CONFLICT DO NOTHING)
  → Supabase Postgres (Hyperdrive connection pool)
```

### Key Architectural Patterns

1. **Adapter interface** (`daemon/src/adapters/adapter.ts`): Every capture surface (Claude Code, Codex, etc.) implements `Adapter { tool, version, start(emit), stop() }`. Adding a new tool = add adapter + payload validator. Pure additive.

2. **Emit callback**: Adapters never touch the queue/redactor/sync directly. They call the `Emit` callback the registry provides. The registry runs the canonical-envelope → redact → queue pipeline uniformly.

3. **Shared types runtime-neutral**: `@fennec/shared` MUST NOT import `node:*` — it's consumed by both Node daemon and Cloudflare Workers. Only `zod` + Web Crypto API allowed.

4. **Tenancy via auth context, not request body**: `org_id` and `user_id` are NEVER accepted from the request body. The backend's `bearerAuth` middleware resolves the API key → stamps `org_id` onto Hono context variables. Every handler reads `c.get("org_id")`, never `body.org_id`. This is enforced by unit tests.

5. **JSONL queue with O_APPEND**: The daemon's local queue uses sync `fs.openSync(path, "a")` for atomic line-write. NOT `fs.appendFile` (no atomic guarantee on all FS). Queue rotation at 100MB.

6. **idempotency via composite primary key**: `PRIMARY KEY (idempotency_key, occurred_at)` + `ON CONFLICT DO NOTHING` — safe to retry the same batch infinitely.

7. **Fail-open shim**: The Go hook shim ALWAYS exits 0 regardless of whether the daemon is reachable. Claude Code's UX must never be blocked by fennec being down.

## Code Conventions

### Formatting
- Biome 2.4.16: double quotes, semicolons, trailing commas, 2-space indent, 120 line width
- TypeScript: `composite: true` (project references), `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`

### Naming
- Files: `kebab-case.ts` for modules, `.test.ts` for tests
- Types/interfaces: `PascalCase` (e.g., `CanonicalEvent`, `EmitInput`, `InsertableAiEvent`)
- Functions: `camelCase` (e.g., `buildCanonicalEvent`, `resolveApiKey`)
- Constants: `UPPER_SNAKE_CASE` or `PascalCase` for defaults (e.g., `DEFAULT_BATCH_SIZE`)
- Test descriptions: `it("Test N: does the thing")` with sequential numbering

### Module Structure
- Barrel exports from `index.ts`; daemon's `index.ts` doubles as CLI dispatcher
- Backend routes: each file exports a `new Hono()` sub-app; `backend/src/index.ts` mounts them with `app.route()`
- Every module has a JSDoc header describing purpose + relevant plan/requirement references
- `env.ts` files define the runtime configuration shape per workspace

### Imports
- Cross-workspace deps use `"@fennec/shared": "*"` in package.json (NOT `"workspace:*"` — corp proxy blocks it)
- Always use `.js` extension in relative imports (ESM requirement): `import { foo } from "./bar.js"`
- Imports with `import type` for type-only imports (enforced by `verbatimModuleSyntax`)

## Testing

### Vitest (unit/integration)
- Workspace-level configs: `daemon/vitest.config.ts`, `backend/vitest.config.ts`, `packages/shared/vitest.config.ts`
- Backend tests: node environment, NOT workers pool (deferred). Mock `pg.Client` + `KVNamespace` via `test-utils/mock-db.ts`
- Mock pattern: `vi.mock("../path/to/module.js", () => ({ fn: vi.fn(...) }))` — hoisted by Vitest to top of file
- Daemon tests: node environment, real filesystem operations, test-only data dirs
- Shared tests: runtime-neutral, no `node:*`, only `vitest` + `zod`

### Playwright (e2e)
- Located in `tests/e2e/`
- Requires real infrastructure (Supabase project, deployed Worker, installed .pkg + running daemon)
- Run only when live infra is provisioned; CI skips them

### Go tests
- `shim/main_test.go` — stdlib `testing` package
- `notifier/` — stdlib `testing` package

## Gotchas & Non-Obvious Patterns

### Cross-workspace dependency protocol
Dependencies between workspaces use plain `"*"` version in `package.json`, not `"workspace:*"`. The corp proxy blocks `workspace:*` protocol resolution during `npm install`.

### wrangler version pin
wrangler is pinned to `4.93.1`. 4.94.0+ pulls in transitive deps blocked by the corp proxy. Don't bump without verifying.

### Backend pgClient lifecycle
```typescript
const client = pgClient(c.env);
await client.connect();
try { /* queries */ } finally { await client.end(); }
```
Never cache the client across requests — leaks JWT context. Hyperdrive binding IS the connection pool; `pg.Client` is per-request.

### Bearer token logging ban
Bearer tokens must NEVER appear in logs, error messages, or responses. The `fennecBearerAuth` middleware returns static "Unauthorized" (not the token). Static grep tests enforce this on source files.

### Hot-path purity
`backend/src/api/events-batch.ts` must NOT import any Phase 2 analytics modules (correlation, model-fit, aggregators). Enforced by a static import-grep test.

### Schema versioning
`CanonicalEventSchema.schema_version` is `z.literal(1)`. To bump: change the literal to `2` and add a migration. The backend stores it verbatim.

### Daemon CLI dispatcher
The daemon's `src/index.ts` is both a library barrel and a CLI entry point. The CLI dispatcher only runs when `fileURLToPath(import.meta.url) === process.argv[1]`. When imported by another workspace or test, it's a no-op. Subcommands use dynamic `import()` for lazy-loading.

### Two Go binaries, two roles
- **shim/** (`fennec-hook`): Compiled binary exec'd by Claude Code for every hook fire. Reads stdin, POSTs to daemon loopback bridge. 15ms wall-clock budget. Always exits 0.
- **notifier/** (`fennec-notifier`): macOS Helper LaunchAgent. Listens on 127.0.0.1:7822 for GUI notification requests from the root daemon. Uses `exec.Command` with argv arrays (never shell strings).

### Go builds require explicit GO path
The Makefiles reference a hardcoded goenv path (`/opt/homebrew/bin/.goenv/versions/1.25.7/bin/go`). Override with `make GO=/path/to/go`. The goenv shim is known-broken on the dev machine.

### Daemon data dir
Defaults to `~/.fennec/`. Production LaunchDaemon installs override via `FENNEC_DATA_DIR` to `/var/db/fennec/`.

### Managed settings surgical uninstall
When removing fennec's hook entries from Claude Code's `managed-settings.json`, the uninstall is **surgical**: it filters by command-equality and unlinks only when the `additionalMatchCommands` array becomes empty. This preserves synapse or other tools' entries (D-24 coexistence).

### No .editorconfig
Not needed — Biome handles formatting. VS Code/Cursor settings in the repo (if present) are authoritative.

### Git hook pipeline
- **pre-commit**: `npx lint-staged` → Biome check + format on staged files only
- **pre-push**: `npm run lint && npm run typecheck && npm run test:unit` — full gate

### What doesn't exist yet
- No `frontend/` directory (SvelteKit arrives in Phase 4)
- No browser extension (Phase 3)
- No Windows daemon (Phase 5)
- No Cloudflare Queues binding (Phase 2)
- Frontend dashboard stubs are in `@fennec/shared` types only; no UI code
- Self-host bundle (`docker-compose.yml`) not yet authored
