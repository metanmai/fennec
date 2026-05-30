# Stack Research — fennec

**Domain:** AI usage / cost observability platform (local capture daemon + multi-tenant cloud + dashboard, n8n-style dual-distribution)
**Researched:** 2026-05-31
**Confidence:** HIGH (the pinned stack is validated by synapse, a working implementation of the same pattern; gaps below are flagged with their individual confidence)

## TL;DR — Stack Verdict

The pinned TypeScript-end-to-end stack (Workers + Hono + Supabase + SvelteKit 5 + Biome + Vitest) is **the right stack for fennec**. Synapse is a load-bearing existence proof: it already runs the daemon + Worker + Supabase pattern with launchd / systemd / Windows Task Scheduler, ships via `npm i -g`, and already has a TLS-intercepting local proxy with per-host leaf certs. Fennec should reuse those exact patterns and concentrate net-new design effort on the surfaces synapse does *not* yet solve: IDE extensions (Copilot in VS Code, JetBrains), the cost/attribution dashboards, and the open-source license choice.

Three hard decisions where I diverge from synapse defaults or sharpen them:

| Decision | Recommendation | Why |
|---|---|---|
| Browser capture mechanism | **Browser extension first (MV3), local TLS-MITM proxy as v1.5 fallback** | Extension installs in 30 seconds. Proxy requires CA trust (root keychain on macOS, NSS on Linux, AD GPO on Windows) — synapse already has the proxy code but it's an IT-heavy install for an org pilot. Ship the cheap path first, keep the proxy as the escape hatch for ChatGPT/Claude.ai capture if extension proves insufficient. |
| Daemon packaging | **Plain Node 22 LTS + `npm i -g fennec` (synapse-style), NOT a SEA / Bun-compile binary in v1** | SEA cross-compile is still rough in 25.x (snapshots/code-cache disabled for cross-platform). Bun compile cross-compiles cleanly but Bun isn't a 1:1 Node-API drop-in for native deps (chokidar's fsevents, openssl spawn). `npm i -g` matches synapse's working playbook, ships in minutes, and works on every platform Node already supports. Revisit SEA in v1.5 if first-run friction is measurable. |
| Open-source license | **Apache 2.0** (with optional CLA for future commercial features) | n8n's Sustainable Use License blocks the largest growth channel: agencies/MSPs deploying fennec for their clients. PostHog (MIT), Helicone (Apache 2.0), and Langfuse (MIT) all chose permissive licenses and have larger self-host adoption than n8n proportionally. Apache 2.0 gives explicit patent grant, which matters once enterprises evaluate. |

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| **TypeScript** | 5.9.x | Single language across daemon, backend, frontend, shared types | Pinned. Synapse validates: shared `packages/shared` exports types both Worker and daemon import. Removes language seams. |
| **Node.js** | 22 LTS (current active LTS through 2027-04) | Daemon runtime | Chokidar 5 requires Node ≥20; Node 22 LTS is the longest-supported floor through fennec's v1 window. Avoid 24/25 odd versions in production daemons — they're the unstable tier. Synapse runs on Node 22. |
| **Cloudflare Workers** | Wrangler 4.x (current `^4.75.0` in synapse) | Backend HTTP + scheduled tasks | Edge regional execution, no cold starts at fennec's expected volume, built-in queues + analytics engine. Workers is the right shape for fan-in event ingestion. |
| **Hono** | 4.12.x (latest stable as of April 2026) | HTTP framework on Workers | Web-standards Request/Response API, RegExpRouter is the fastest router on Workers, first-class Zod validator middleware. Synapse already runs `hono@^4.12.8`. No reason to switch. |
| **Supabase Postgres** | Postgres 15+ via Supabase managed (or self-host) | Primary datastore | Synapse-validated. Postgres native partitioning solves fennec's high-volume `events` table (see partitioning section below). pgvector available if/when prompt-similarity becomes useful for cluster analysis. |
| **Supabase Auth** | `@supabase/supabase-js` 2.99+, `@supabase/ssr` 0.9+ | User identity + session management | Synapse uses it. Supports OAuth (GitHub, Google) for dev signup; magic-link for SMB; SAML/OIDC available on paid tier when enterprise lands in v2. |
| **SvelteKit** | 5.x (Svelte 5 runes API, current `^2.55.0` kit) | Web dashboard frontend | Pinned. Svelte 5's runes and signal-graph rendering shine for live-updating dashboards. Bundle size matters less than DX here. |
| **Tailwind CSS** | 4.2.x via `@tailwindcss/vite` | Styling | Pinned. Tailwind 4 is meaningfully faster (Lightning CSS engine) and the v4 Vite plugin is the supported path on SvelteKit 5. |
| **Biome** | 1.9.x | Lint + format | Pinned. One config replaces ESLint+Prettier; ~10x faster lint runs. Synapse runs it as `biome check .` in pre-push. |
| **Vitest** | 4.1.x | Unit + integration tests | Pinned. Plus `@cloudflare/vitest-pool-workers` for testing Worker code in Miniflare-equivalent isolation. |
| **Zod** | 4.3.x | Runtime validation | Pinned. Boundary validation on every Hono route + every adapter parse. Synapse pins `4.3.6`. |

### Daemon-Specific Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| **chokidar** | 5.0.x (ESM-only, Node ≥20) | Cross-platform file watching | All adapter file-watchers (Codex jsonl, Gemini transcripts, Cursor workspaceStorage, local git `.git/HEAD` / `.git/logs/HEAD`). Synapse uses `chokidar@^5.0.0`. Single dependency in v5 (was 13 in v3) — major footprint win. |
| **@clack/prompts** | 0.11.x | Interactive CLI wizard | `fennec wizard` setup flow. Synapse uses it. Better DX than Inquirer, smaller, ESM-native. |
| **Native `node:http` / `node:https` / `node:tls`** | — | Local TLS-MITM proxy server (browser fallback path) | Roll your own — do NOT pull in `http-proxy` or `node-http-proxy`. Synapse's `mcp/src/capture/proxy/server.ts` (~460 LOC) is a complete reference. CONNECT handling + per-host leaf certs is ~1500 LOC total, all stdlib. |
| **`openssl` via `node:child_process`** | — | CA + leaf cert generation for proxy | Synapse's `tls.ts` shells out via `execFileSync` with argv arrays (NOT shell strings) to avoid command injection. Don't use `node-forge` — slower and a much larger dependency surface for the same job. |
| **`ulid` (inline ~20 LOC)** | — | Event IDs in the local JSONL queue | Synapse inlines this in `events-log.ts`. Lexicographically sortable + 128-bit + URL-safe. Do not pull `ulid` from npm for one function. |

### Backend-Specific Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| **`@supabase/supabase-js`** | 2.99.x | Postgres + Auth client from Worker | One client per request (do NOT cache across requests — leaks JWT context). Use `service_role` key only in admin endpoints; user-scoped requests use the anon key + RLS. |
| **Cloudflare Queues** | (Wrangler binding) | Buffer + batch event writes | Daemon `POST /v1/events` → Worker enqueues → consumer Worker batches up to 100 events / 5s and writes to Postgres in one transaction. Default batching: `max_batch_size: 100`, `max_batch_timeout: 5s`. Critical for not melting Postgres connection limits during burst traffic. |
| **Cloudflare Hyperdrive** | (Wrangler binding) | Postgres connection pooling from edge | Always use Hyperdrive when a Worker talks to Supabase Postgres — eliminates per-request TCP+TLS handshake. Synapse may not use this yet but it's required at fennec's volume. |
| **Cloudflare Analytics Engine** | (Wrangler binding) | Aggregate metrics (events/min, tokens/hour) | Cheap time-series writes (~$0.25/M events) for dashboard counters. Don't hand-roll rollups in Postgres for these — let AE handle it and query via SQL. |

### Frontend-Specific Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| **Apache ECharts** + **`svelte-echarts`** wrapper | ECharts 5.5+, `svelte-echarts` latest | Time-series + per-user dashboards | **Recommended.** ECharts is the most full-featured time-series chart library in the JS ecosystem (heatmaps, candlesticks, large-dataset performance), and is what most cost/observability dashboards use. The svelte-echarts wrapper is a thin shell — drop down to raw ECharts when you need custom interactions. |
| **LayerChart** | 2.0 (Svelte 5 native, in active migration as of late 2025) | (Alternative) Native Svelte 5 charts | Pick this **only** if you want chart components that look idiomatically Svelte. Smaller feature surface than ECharts. Risk: 2.0 migration still in flight; could break under Svelte 5 runes. |
| **`marked`** + **`dompurify`** | marked 18.x, dompurify 3.4.x | Render prompt/response markdown safely in drill-downs | Synapse-pattern. Marked is fast; DOMPurify sanitises XSS. Always run DOMPurify after Marked, never before. |
| **`@supabase/ssr`** | 0.9.x | Cookie-based session for SvelteKit | Synapse uses it. Replaces the older `auth-helpers-sveltekit`. Cookie flows through SvelteKit `hooks.server.ts` to load. |

### Browser Extension (Adapter for ChatGPT / Claude.ai)

| Library / API | Version | Purpose | When to Use |
|---|---|---|---|
| **WebExtension Manifest V3** | MV3 (Chrome 88+, Firefox 109+) | Browser extension shell | All new browser extensions in 2026. Chrome MV2 phase-out is final; Firefox supports both but converging on MV3. |
| **Content script + `fetch` monkeypatch** | — | Capture prompts on ChatGPT/Claude.ai | The only MV3-viable interception path. Inject a content script (`run_at: document_start`, `world: MAIN`) that overrides `window.fetch` and `XMLHttpRequest.prototype.send` before page JS loads. Post captured payloads to the extension service worker via `chrome.runtime.sendMessage`. |
| **`declarativeNetRequest`** | (MV3 API) | NOT for capture — only for blocking | DO NOT try to use this for fennec. It's declarative-only (no inspecting bodies), built for ad blockers. Mention only to explain why the fetch-monkeypatch path exists. |
| **`chrome.storage.local`** | (MV3 API) | Buffer events in extension before send-to-daemon | Buffer up to ~5MB locally; flush to the local daemon's `http://127.0.0.1:<port>/v1/events` endpoint. Daemon authenticates extension via a one-time pairing token written to disk during `fennec wizard`. |

**Why not Plasmo / WXT framework:** Tempting (TypeScript build, hot reload, cross-browser), but adds 2-5MB build artefacts and another dependency tree to audit. For an extension with ~3 files, raw MV3 + `tsc` is fine. Revisit if the extension grows past ~10 source files.

### IDE Extensions

| Surface | SDK | Notes |
|---|---|---|
| **VS Code (Copilot, Cursor's Continue, etc.)** | `@types/vscode` 1.95+ (April 2026 baseline), `vsce` for packaging | Two viable paths for Copilot capture: **(a) Chat participant API** (stable since VS Code 1.92) — fennec registers as a participant and observes prompts routed to it explicitly. Does NOT see prompts sent to the built-in Copilot Chat. **(b) Language Model Tool API** — same limitation. **(c) Sidecar approach**: package fennec as a VS Code extension purely to read Copilot's local cache files (`~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/` on macOS, etc.) and ship them to the daemon. Path (c) is the practical winner for v1 — Copilot's internal chat is closed-source and the public APIs don't expose its prompt stream. **Confidence: MEDIUM** — file locations are stable across recent Copilot versions but undocumented; budget rework time. |
| **JetBrains (IntelliJ, PyCharm, WebStorm, GoLand)** | IntelliJ Platform Plugin SDK (Kotlin), 2024.3 baseline | JetBrains AI Assistant + Junie are first-party only; no public hook for third-party observability. **Defer JetBrains capture to v1.5 or v2.** If a customer demands it earlier, the only fennec-feasible path is reading JetBrains's local cache (`~/Library/Caches/JetBrains/<product>/llm-history/` — undocumented). Plugin development requires Kotlin + Gradle, breaks fennec's TypeScript-only constraint. **Confidence: LOW.** |

### Development & Distribution Tools

| Tool | Purpose | Notes |
|---|---|---|
| **wrangler 4.75+** | Deploy Workers, manage Queues/Hyperdrive bindings | Synapse-validated. `wrangler deploy` from a token-holding machine; no auto-deploy in v1 (synapse explicitly avoids the GH Action — keep that pattern). |
| **`supabase` CLI** | Local Postgres dev + migration push | `supabase db push` runs migrations. Migrations live in `supabase/migrations/`. Synapse pattern. |
| **`playwright`** 1.49+ | Frontend e2e | Synapse pattern (`frontend/playwright.config.ts`). Only for the dashboard happy-flow + auth flow; do not over-test the dashboard at e2e level. |
| **GitHub Actions** | CI for lint + typecheck + unit + e2e gates (NOT auto-deploy) | Mirror synapse's pre-push verify (`lint && typecheck && test`). Backend deploy stays manual. |

---

## The Five Hard Stack Decisions

### 1. Browser Capture Mechanism — extension first, proxy as escape hatch

**Recommendation: Ship a Manifest V3 browser extension in v1. Keep the local TLS-MITM proxy code (which synapse already has) as a v1.5 fallback for installations where the extension is insufficient.**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **MV3 browser extension (fetch monkeypatch)** | 30-second install. No CA install. Works on macOS/Linux/Windows identically. Captures ChatGPT, Claude.ai out of the box. | Misses traffic if user opens a private window without the extension; can't see raw API tokens (privacy upside). Chrome Web Store review can take days. | **v1 ship.** |
| **Local TLS-MITM proxy (mitmproxy-style)** | Captures everything regardless of browser. Already exists in synapse. | CA install is IT-heavy (root keychain on macOS, NSS DB on Linux, AD GPO on Windows). Risks breaking corporate network controls (Netskope, ZScaler, etc. — synapse README explicitly notes Netskope breakage). Trust-store install is the #1 reason users abandon this kind of tool. | **v1.5 escape hatch.** |
| **OS-level network interception (eBPF on Linux, NetworkExtension on macOS, WFP on Windows)** | Truly invisible to the user. No CA. | Per-platform native code (C/Rust/Swift). Requires kernel-level privileges. Out of scope for a TypeScript-only solo build. | **Defer to v3+** if at all. |
| **Browser DevTools Protocol (CDP) attach** | Sees raw network on Chromium-based browsers. | Requires Chrome to be launched with `--remote-debugging-port` (won't fly with users' existing Chrome profile). Doesn't work on Firefox/Safari. | **Skip.** |

**Risk callouts:**
- **Chrome Web Store review unpredictability**: a "captures all your AI prompts" extension may get a longer review or rejection. Mitigate by being explicit in the listing: "fennec sends data only to your fennec instance (cloud or self-hosted), never to fennec the company unless you opt into managed cloud." Also publish a Firefox-AMO listing in parallel (faster reviews historically).
- **Service worker lifecycle** in MV3 is hostile to long-lived listeners — the SW gets killed after ~30s idle. Solution: buffer events in `chrome.storage.local`, batch-flush to the local daemon on a periodic alarm (`chrome.alarms`).
- **Content-script + `world: MAIN` injection** is the only way to override page-side `fetch`, but it must inject early (`run_at: document_start`) — late injection misses the first prompt. Test this carefully on ChatGPT's SPA navigation.
- **Anti-bot scripts on ChatGPT may detect monkeypatched fetch.** Use the smallest possible wrapper (preserve `.toString()`, preserve `[Symbol.toStringTag]`, don't mutate the prototype chain). Synapse does NOT have this code yet — it's net-new for fennec.

**Confidence: MEDIUM.** Extension approach is the standard; specifics of "will it cleanly capture ChatGPT 4-Turbo conversations in May 2026" require building the prototype to confirm.

### 2. Daemon Packaging & Distribution — npm global install, not a binary (in v1)

**Recommendation: `npm install -g fennec` + a `fennec wizard` that installs the launchd / systemd / Task Scheduler unit. Mirror synapse exactly.**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **`npm i -g` + `fennec wizard`** | Works on every platform Node supports. Auto-updates via `npm`. Synapse-validated and shipping today. Trivial to publish. | Requires Node 22+ already installed (acceptable for the dev-tool target market). Corporate networks with Netskope can block `npm` (synapse hits this — bypass = tether or VPN). | **v1 ship.** |
| **Node SEA (`--build-sea`)** | Single binary, no Node prerequisite. Node 25.5+ added a one-step `--build-sea` flag. | Cross-compile is still rough — code-cache + snapshots disabled when cross-compiling, so startup is slower. Native modules (chokidar's optional fsevents) require additional plumbing. Docker required for cross-platform builds. Code-signing each platform binary is its own project (Apple notarisation, Windows EV cert). | **v1.5 candidate** once Node 26 LTS ships in Oct 2026 with better SEA tooling. |
| **`bun build --compile --target=...`** | Cross-compile to bun-linux-x64, bun-darwin-arm64, bun-windows-x64 from a single host. ~70% faster cold-start than Node. | Bun is not 100% Node-API compatible — `child_process.execFileSync` for openssl works; `chokidar` works; some edge-case native deps don't. Switching the daemon runtime to Bun means re-running all of synapse's existing e2e tests under Bun. Bun is one company's runtime — synapse explicitly chose stdlib Node for longevity. | **v2 candidate** if startup time becomes a marketing point. |
| **`pkg` (Vercel)** | Was the dominant tool 2019-2023. | `pkg` is **deprecated by Vercel** (last meaningful release 2023). Do not adopt. | **AVOID.** |

**v1 ship path (concrete):**
1. Publish `fennec` to npm — `bin: { fennec: "dist/index.js" }`.
2. `fennec wizard` installs the OS service unit (synapse has the exact code: `mcp/src/capture/os-service.ts` — copy the templates and rename).
3. `npm i -g fennec` is the install. Same as synapse, same as Claude Code's `@anthropic-ai/claude-code`, same as `gh` (well, brew/scoop, but the model is identical).

**Risk callouts:**
- **Corporate Netskope-class proxies block `npm`** (synapse README explicitly calls out `npx synapsesync` failing). Mitigation: also publish a tarball download + `curl -fsSL https://fennec.dev/install.sh | bash` install script that fetches the tarball directly (avoiding npm). Maintain both as official paths.
- **Windows is the friction surface.** Synapse explicitly notes Windows as a "known friction point worth budgeting time for." Task Scheduler quirks, PATH handling for `npm i -g`, and PowerShell execution policies all trip up first-time installs. Budget 25-40% of total daemon-install effort on Windows.

**Confidence: HIGH** for the recommendation. Synapse runs this in production; the unknowns are scale (Windows polish), not feasibility.

### 3. Local Queue Durability — append-only JSONL, not SQLite

**Recommendation: Plain JSONL append-only event log on disk, with a watermark file for sync progress. Exactly synapse's pattern.**

Synapse implements this in `mcp/src/capture/events-log.ts` — `appendEvent()` does `fs.openSync(path, "a")` + `fs.writeSync(fd, JSON.stringify(event) + "\n")` + `fs.closeSync(fd)`. That's it. Watermark stored separately, advanced on successful upload, retried on next sync poll.

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Append-only JSONL + watermark file** | Zero deps. Atomic line-write via OS append semantics. Trivial to inspect/debug (cat the file). Resilient to partial writes (a truncated last line is the only loss case, and ULID-prefixed lines make it skippable). Synapse-validated. | No secondary indexes. Replay is O(file size). Cleanup requires log rotation. | **Ship this.** |
| **SQLite (better-sqlite3 / libsql)** | Real ACID. Indexes if you need them. WAL mode is durable across crashes. | Native dep — fennec daemon now has a native compile step per platform. Adds ~5MB to install. Overkill for a write-mostly queue with a sequential reader. | Skip unless you actually need indexed queries on the local queue (you don't — the backend has the queryable copy). |
| **Embedded DuckDB** | Columnar storage, great for local-analytics. | Solves a problem fennec doesn't have at the daemon layer (the daemon doesn't analyse, just captures + ships). Pull DuckDB into the backend tier if needed for column-store analytics on the Postgres side. | Skip at daemon layer. |
| **Plain JSON file (full rewrite)** | Simple. | Race condition every time the daemon dies mid-write → entire file corrupted. Don't do this. | **AVOID.** |

**Implementation cribs from synapse:**
- File: `~/.fennec/events.jsonl` (per-project subdirs as synapse does, keyed by repo + working directory).
- Watermark: `~/.fennec/<project>/sync-state.json` containing `{ last_synced_event_id: "01ARZ3..." }`.
- Log rotation: when `events.jsonl` exceeds 100MB, rename to `events-<timestamp>.jsonl` and reset the watermark logic to handle multi-file replay. (Synapse doesn't yet implement rotation — note as a v1.1 follow-up.)

**Confidence: HIGH.**

### 4. Cloudflare Workers + Hono for Event Ingestion at Scale

**Recommendation: Confirmed fit. Add Cloudflare Queues + Hyperdrive to the synapse-baseline pattern.**

Architecture:
```
Daemon ──POST /v1/events (batch of 1-100)──▶ Worker (Hono route, Zod-validated)
                                              │
                                              ▼
                                       Cloudflare Queue (buffer)
                                              │  max_batch_size: 100
                                              │  max_batch_timeout: 5s
                                              ▼
                                       Consumer Worker
                                              │
                                              ▼ (via Hyperdrive)
                                       Supabase Postgres (events table, partitioned)
```

**Why this shape:**
- Hono routes are validated via `zValidator('json', EventBatchSchema)` — a malformed payload returns 400 at the edge, never hits Postgres.
- Queues decouple ingestion latency from Postgres write latency. A burst of 10K events doesn't melt Postgres connection pools.
- Hyperdrive pools Postgres connections globally; without it, each Worker request pays a fresh TCP+TLS handshake to Supabase (50-150ms wasted per request).
- Analytics Engine in parallel: for "events per minute per org" counters that drive the dashboard's live metric tiles, write to AE (~$0.25/M events) and query with SQL. Cheaper and faster than running a `count(*) GROUP BY org_id, minute` against Postgres every dashboard refresh.

**Scale envelope (back-of-envelope):**
- Assume 100 active devs × ~200 AI requests/day average = 20K events/day per org.
- 100 paying orgs in year 1 = 2M events/day = ~25 events/sec sustained, with bursts to 1000/sec at the workday-start peak.
- Workers handles 1000/sec trivially per region. Postgres after batching: 10 inserts/sec of ~100-row batches. Comfortable territory.
- Self-hosted single-Postgres deployments handle this without partitioning; cloud tier requires partitioning for the multi-tenant aggregate.

**Confidence: HIGH** for the components; Hyperdrive specifically requires verifying current Supabase compatibility (it explicitly supports Postgres, but check the Hyperdrive docs for the supported Postgres version range).

### 5. Open-Source License — Apache 2.0

**Recommendation: Apache 2.0 with a CLA (Contributor License Agreement, e.g., EasyCLA) for future commercial flexibility.**

| Project | License | Verdict for fennec |
|---|---|---|
| **n8n** | Sustainable Use License (custom, restricts commercial redistribution) | Wrong shape for fennec. Blocks consulting/agency installs, which is the natural growth channel for a dev-observability tool. |
| **PostHog** | MIT (with separate Enterprise Edition licensed differently) | Permissive — most adoption-friendly. PostHog has demonstrated this works at scale. |
| **Helicone** | Apache 2.0 | Most directly comparable to fennec (LLM observability, self-hostable). Validates the choice. (Note: acquired by Mintlify in March 2026; the licensing precedent remains valid even if the project is in maintenance mode.) |
| **Langfuse** | MIT | June 2025 they open-sourced *all* product features under MIT. Strong signal that permissive licensing works for LLM observability. |
| **Sentry** | Functional Source License (FSL) — non-compete, converts to Apache 2.0 after 2 years | The hedged middle ground. Works for Sentry's scale; overkill for fennec at v1. |
| **MongoDB / Elasticsearch / Redis (post-license-change)** | SSPL | DO NOT use SSPL. It's not OSI-approved; Linux distributions won't package it; perception cost is huge for a tiny benefit. |

**Why Apache 2.0 specifically (over MIT):**
- Explicit patent grant — matters once enterprises evaluate. (MIT is silent on patents, which lawyers note.)
- Wider corporate-trust track record (Helicone, Apache Software Foundation everything, most cloud-native OSS).
- Trademark provisions clearly separate (you keep "fennec" as a trademark even if the code is open).

**Why NOT n8n's Sustainable Use License:**
- n8n's license blocks "selling a product whose value derives entirely or substantially from n8n." For fennec, an MSP managing AI usage for 20 client orgs would be in violation. That's the *exact* customer fennec wants.
- n8n succeeded *despite* its license (because workflow automation has weak alternatives); fennec lives in a more crowded observability space and can't afford the license friction.

**CLA recommendation:**
- Use a simple CLA (e.g., DCO sign-off on commits, or EasyCLA bot for explicit consent on PRs).
- This preserves your option to later release a paid-tier feature (e.g., SSO, audit logs) under a separate commercial license without re-licensing existing contributions. PostHog does this; Sentry does this.
- DO NOT require copyright assignment — that's the heaviest CLA flavour and turns away contributors. Just require a license-grant CLA.

**Confidence: HIGH** for Apache 2.0; MEDIUM for the CLA detail (could ship v1 without CLA and add it later — DCO is the lower-friction interim).

---

## Installation

```bash
# Daemon (synapse-pattern)
npm install -g fennec

# Backend (in repo)
cd backend
npm install   # installs hono, @supabase/supabase-js, zod, agents
              # devDeps: wrangler@^4.75, @cloudflare/vitest-pool-workers, vitest

# Frontend (in repo)
cd ../frontend
npm install   # installs @sveltejs/kit@^2.55, svelte@^5.54, tailwindcss@^4.2,
              # @supabase/ssr@^0.9, @supabase/supabase-js@^2.99,
              # marked@^18, dompurify@^3.4, svelte-echarts (latest)

# Daemon source (in repo, separate workspace)
cd ../daemon
npm install   # installs chokidar@^5, @clack/prompts@^0.11, zod@^4.3
              # (NO http-proxy, NO node-forge — use stdlib for proxy + openssl spawn)

# Browser extension (in repo, separate workspace)
cd ../extension
npm install   # devDeps: typescript, @types/chrome
              # (NO Plasmo, NO WXT — raw MV3 + tsc)

# Root
npm install -D @biomejs/biome@^1.9
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Apache 2.0 | MIT | If you want the lowest-friction license and don't care about patent grants. Defensible for fennec. |
| Apache 2.0 | n8n Sustainable Use License | Only if you decide MSP/agency redistribution is *not* a target channel. Unlikely fit. |
| Apache 2.0 | Sentry Functional Source License | If you've raised a Series A and competing forks are a real risk. Premature for v1. |
| ECharts | LayerChart | Pick this only after LayerChart 2.0 (Svelte 5 native) is GA. Worth re-evaluating at v1.5. |
| ECharts | Chart.js | If you only need 3-4 chart types and don't care about ECharts's massive feature set. Smaller bundle. |
| ECharts | visx (D3 wrapper) | Only if a React port is on the table (it isn't for fennec). |
| `npm i -g` daemon | Bun compile binary | Once Bun's ecosystem-compat issues with native modules are fully resolved AND startup time becomes a customer-visible metric. v2+. |
| `npm i -g` daemon | Node SEA | Once Node 26 LTS ships with mature cross-compile support (Oct 2026+). v1.5 candidate. |
| Cloudflare Queues + Hyperdrive | Direct daemon → Worker → Postgres (no queue) | Acceptable for self-host single-tenant deployments where event volume is low. Skip the queue for the self-host bundle; require it in the cloud tier. |
| Plain JSONL queue | better-sqlite3 / libsql | Only if you need indexed local queries (you don't in v1). |
| Browser extension first | TLS-MITM proxy first | If the v1 target customer is "small enterprise with central IT willing to push a root CA" — but that's not the indie/SMB market fennec opens with. |
| Supabase Postgres | Neon / PlanetScale-postgres / vanilla RDS | Only if Supabase's combined Auth + RLS + pgvector + dashboard is *not* a value-add for you. For fennec it is. |
| Supabase Auth | Clerk / Auth0 / Better-Auth | If you outgrow Supabase Auth's SSO/SAML limitations in v2+. Not a v1 concern. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| **`pkg` (vercel/pkg)** | Deprecated since 2023. Last release was 5.8.1 in 2023. Project archived. | Node SEA (`--build-sea`) or `bun build --compile` if you must ship a binary; otherwise `npm i -g`. |
| **`http-proxy` / `node-http-proxy`** | Bloated for fennec's needs (CONNECT + TLS-MITM). Old API. Synapse rolled its own in ~460 LOC with zero deps. | Stdlib `node:http` + `node:https` + `node:tls`. Copy synapse's `mcp/src/capture/proxy/server.ts` shape. |
| **`node-forge`** for cert generation | Pure-JS X.509 is slow, large, and a frequent CVE source. | `execFileSync('openssl', [...])` with argv arrays (synapse pattern). |
| **MV2 (Manifest V2) browser extension** | Chrome MV2 is end-of-life. Firefox still allows MV2 but is migrating. | MV3 (Manifest V3) for both Chrome + Firefox. |
| **`webRequest` blocking API in MV3** | Removed for non-enterprise extensions. `declarativeNetRequest` replaced it for blocking but doesn't help with capture (no body inspection). | Content-script fetch monkeypatch. |
| **Plasmo / WXT browser-extension frameworks** | Heavy build chains for a ~3-file extension. Adds dependency-audit surface. | Raw MV3 + `tsc`. |
| **Inquirer.js** for CLI prompts | Slow, large, callback-flavoured API. | `@clack/prompts` (synapse uses this). |
| **`auth-helpers-sveltekit`** | Deprecated by Supabase in favour of `@supabase/ssr`. | `@supabase/ssr` 0.9+. |
| **MongoDB / Elastic SSPL'd stack** | License is OSI-rejected; distros refuse to package. | Apache 2.0-licensed stores (Postgres). |
| **n8n Sustainable Use License pattern** | Blocks MSP/agency redistribution — kills a growth channel for fennec. | Apache 2.0 or MIT. |
| **Hand-rolled JWT auth from scratch** | Auth is a tarpit. | Supabase Auth (already in stack). |
| **Tailwind v3** | v4 is faster and is the supported path on SvelteKit 5 via `@tailwindcss/vite`. | Tailwind v4. |
| **Drizzle / Prisma** in the Worker | The Supabase JS client + raw SQL is enough for fennec. Adding an ORM is a 100KB+ Worker bundle hit and a debugging layer. | `@supabase/supabase-js` + raw SQL strings where needed. (Drizzle becomes interesting at v2 if schema sprawl gets bad.) |
| **`fs.watch` (raw Node API)** instead of chokidar | Inconsistent across macOS/Linux/Windows; misses events; doesn't recurse on Linux. | chokidar 5 (synapse-validated). |

---

## Stack Patterns by Variant

**If self-hosted single-tenant (the OSS bundle):**
- Use a single Supabase or vanilla Postgres instance.
- Skip Cloudflare Queues — write to Postgres directly from the Worker (or run the backend as a Node server with Hono via `@hono/node-server`).
- Single fennec instance, no multi-tenant routing.
- Provide `docker-compose.yml` with Postgres + Hono-on-Node + SvelteKit static build behind nginx/Caddy.

**If managed cloud (the SaaS tier):**
- Full Cloudflare stack: Workers + Queues + Hyperdrive + Analytics Engine + R2 (for prompt-body cold storage if needed).
- Supabase managed Postgres with partitioning enabled on `events`.
- Pgbouncer or Supabase's Supavisor in front of Postgres.
- Multi-tenant RLS with `org_id` on every table + JWT custom claim for tenant binding.

**If enterprise (v2+):**
- BYO database (point fennec at customer's Postgres/RDS instance).
- SAML / OIDC SSO via Supabase Auth's paid tier or Better-Auth.
- Audit log table + retention policies.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| chokidar@^5.0.0 | Node ≥20 | ESM-only as of v5. fennec's Node 22 LTS baseline is fine. |
| @sveltejs/kit@^2.55 | svelte@^5.54 | Pinned together. Don't run Kit 2.x on Svelte 4. |
| @tailwindcss/vite@^4.2 | vite@^6.0 | Tailwind 4 Vite plugin is the supported path. v5 vite users should NOT mix. |
| hono@^4.12 | @cloudflare/workers-types matching Wrangler 4.x | Wrangler 4.75+ ships types compatible with the current Workers runtime. |
| @supabase/supabase-js@^2.99 | @supabase/ssr@^0.9 | Same auth model; ssr is the SvelteKit-aware cookie wrapper. |
| zod@^4.3 | @hono/zod-validator latest | Hono's zod-validator supports Zod 4 (the namespace change from `z.string()` to default `z` was non-breaking for validators). |
| wrangler@^4.75 | Supabase Postgres 15+ (via Hyperdrive) | Hyperdrive supports Postgres 12-15; check Supabase region availability. |
| chrome MV3 | Chrome ≥88, Firefox ≥109, Edge ≥88 | Safari supports a subset; for v1, target Chromium browsers + Firefox. |

---

## Where Fennec Should Diverge from Synapse

Synapse is the reference, but fennec has different requirements at five points:

| Area | Synapse approach | Fennec divergence | Why |
|---|---|---|---|
| Browser capture | Has TLS-MITM proxy code; no extension | **Extension first, proxy second** | Synapse's users are individual devs willing to install a CA; fennec's users include enterprise IT, where CA installs are friction. |
| Event volume | Hand-rolled JSONL → Worker (no queue) | **Add Cloudflare Queues + Hyperdrive** | Fennec's volume is per-org × per-developer, not per-individual. Queue decoupling is required at fennec's scale. |
| Local-store | Sessions saved as full JSON files per session | **JSONL append-only events + computed sessions at backend** | Synapse stores small handoff state; fennec stores raw prompt/response events that need streaming-batch semantics. |
| License | MIT | **Apache 2.0** | Patent grant matters once fennec evaluates with enterprise; synapse is a personal-tool with different stakes. |
| Charting | None (Synapse is mostly text + minimal UI) | **Apache ECharts + svelte-echarts** | Fennec's dashboards are the value surface; ECharts gives time-series + heatmaps + drill-down out of the box. |

Everything else — TypeScript-end-to-end, Workers + Hono, Supabase, SvelteKit 5 + Tailwind 4, Biome + Vitest, chokidar + clack/prompts, the OS-service install pattern, the wizard CLI, the adapter-registry shape, the watermarked sync pattern — should be copied wholesale. Synapse is your spec, not just inspiration.

---

## Sources

### Synapse codebase (load-bearing reference)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/os-service.ts` — launchd / systemd / Task Scheduler unit templates (HIGH confidence reference)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/proxy/server.ts` — TLS-MITM forward proxy implementation (HIGH confidence reference)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/proxy/tls.ts` — OpenSSL-spawn cert generation (HIGH confidence reference)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/events-log.ts` — append-only JSONL queue (HIGH confidence reference)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/adapters/{codex,cursor,gemini}.ts` — file-watcher adapter pattern (HIGH confidence reference)
- `/Users/Tanmai.N/Documents/synapse/{mcp,backend,frontend}/package.json` — concrete version pins (HIGH confidence reference)

### Official docs (HIGH confidence)
- [Node.js v26 SEA documentation](https://nodejs.org/api/single-executable-applications.html) — `--build-sea` flag, cross-compile constraints
- [Cloudflare Queues: Batching, Retries, and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/) — `max_batch_size` and `max_batch_timeout` semantics
- [Cloudflare Workers Storage Options](https://developers.cloudflare.com/workers/platform/storage-options/) — Hyperdrive, Queues, Analytics Engine, D1, R2 selection guide
- [Hono Validation Guide](https://hono.dev/docs/guides/validation) — Zod validator middleware patterns (current as of April 2026, Hono 4.12.16)
- [Hono Zod Validator middleware repo](https://github.com/honojs/middleware/tree/main/packages/zod-validator) — `zValidator` API
- [Chrome `webRequest` API + MV3 migration](https://developer.chrome.com/docs/extensions/reference/api/webRequest) — webRequest deprecation in MV3; declarativeNetRequest substitute
- [Replace blocking web request listeners](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests) — official migration guide for MV3
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — SessionStart, UserPromptSubmit, PostToolUse hook contract
- [Supabase Postgres Partitioning](https://supabase.com/docs/guides/database/partitions) — range partitioning for time-series events
- [Supabase Dynamic Table Partitioning](https://supabase.com/blog/postgres-dynamic-table-partitioning) — automated partition management for events tables
- [n8n Sustainable Use License](https://docs.n8n.io/sustainable-use-license/) — terms (verifying limitations for MSP redistribution)
- [PostHog LICENSE](https://github.com/PostHog/posthog/blob/master/LICENSE) — MIT for core, separate commercial for EE
- [Langfuse LICENSE](https://github.com/langfuse/langfuse/blob/main/LICENSE) — MIT
- [Helicone Open Source docs](https://docs.helicone.ai/references/open-source) — Apache 2.0
- [Sentry Functional Source License announcement](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/) — FSL terms
- [Chokidar 5 on npm](https://www.npmjs.com/package/chokidar) — ESM-only, Node ≥20 baseline
- [VS Code Chat Participant API discussion](https://github.com/microsoft/vscode-discussions/discussions/1101) — public extension API for chat participants

### WebSearch findings (MEDIUM confidence — multi-source, not direct from docs)
- VS Code Copilot Chat closed-source nature, cache file location stability — MEDIUM (community articles, not Microsoft docs)
- JetBrains AI Assistant public hook surface (none for third-party observability) — MEDIUM (community + JetBrains marketing pages, not SDK docs)
- Bun cross-compile vs Node SEA performance numbers — MEDIUM (benchmarks vary by workload)
- LayerChart 2.0 Svelte 5 migration status — MEDIUM (community signal; check repo state before committing)
- Chrome Web Store review timing for capture-style extensions — LOW (anecdotal; verify by submitting prototype)

### Confidence summary
- **HIGH** confidence: TypeScript stack pinning, Workers/Hono fit, Supabase + RLS multi-tenancy, chokidar adapter pattern, JSONL queue, launchd/systemd OS-service templates, Apache 2.0 license choice, ECharts pick over LayerChart for v1.
- **MEDIUM** confidence: Browser extension MV3 capture viability (specifics of monkeypatching ChatGPT's fetch in late 2026), VS Code Copilot cache-reading approach, Cloudflare Hyperdrive + Supabase Postgres version compatibility.
- **LOW** confidence: JetBrains plugin viability (defer to v2), Chrome Web Store approval timing for capture extensions, exact Cursor/Gemini transcript file paths on Windows (synapse confirms macOS/Linux; Windows requires verification at build time).

---
*Stack research for: AI usage observability platform (fennec)*
*Researched: 2026-05-31*
