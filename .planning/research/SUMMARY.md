# Project Research Summary

**Project:** fennec
**Domain:** AI usage / cost observability platform (local capture daemon + multi-tenant cloud + dashboard, n8n-style dual distribution)
**Researched:** 2026-05-31
**Confidence:** HIGH (synapse is a working existence proof for the same pattern; competitor landscape is well-mapped; pitfalls are concrete from synapse's lived experience plus 2026 industry incidents)

## Executive Summary

Fennec is a three-tier system — thin local daemon, stateless edge backend, read-mostly dashboard — that captures AI prompts at the source on a developer's machine across CLI, IDE, and browser surfaces, correlates them with local git activity, and surfaces per-user prompting-quality and per-project cost attribution. The category is partially served (Helicone, Langfuse, LangSmith for app-side LLM observability; Anthropic/Cursor/Copilot for vendor-only dashboards; Token Telemetry for single-developer CLI capture; Jellyfish/LinearB for org-level vendor-API aggregation) but **no product combines machine-side capture across all surfaces, local git outcome correlation, model-fit lens, and n8n-style OSS+managed distribution**. That combination is fennec's moat.

The pinned synapse-stack (TypeScript end to end, Node 22 daemon, Cloudflare Workers + Hono, Supabase Postgres, SvelteKit 5, Biome, Vitest) is validated and should be copied wholesale; the five places fennec must diverge from synapse are: (1) **browser capture via Manifest V3 extension first, not TLS-MITM proxy**, (2) **Cloudflare Queues + Hyperdrive added** for fan-in event ingestion at multi-tenant scale, (3) **append-only JSONL local queue per synapse, but with explicit log rotation and watermark-driven sync** (synapse's queue without its rotation gap), (4) **Apache 2.0 license** (patent grant + MSP/agency channel preservation, not synapse's MIT or n8n's SUL), and (5) **first-class charting via ECharts**. Build order is dictated by one critical-path: freeze the canonical event schema in `packages/shared/` → ingest endpoint → one adapter (Claude Code hooks) end-to-end → daemon lifecycle on macOS → everything else parallelises.

The dominant risks are not technical-feasibility (synapse proves it) but **trust failure**: secrets-in-prompts leaking to the cloud (the existential pitfall — mandates capture-time redaction before v1 ships), multi-tenant data isolation (synapse hit this three times — defense-in-depth required: service-role + middleware checks + RLS backstop), outcome-correlation over-claim weaponising attribution numbers in performance reviews, cost numbers diverging from vendor invoices because prompt caching breaks naive token×price math, and developer surveillance perception killing bottom-up adoption. Browser capture is the highest-risk surface architecturally (Manifest V3 limitations + Chrome Web Store review unpredictability post-January-2026 malicious-extension scandal + corporate IT cert friction) and must be developed in parallel but treated as ship-or-defer at v1 freeze — PROJECT.md mandates "all 4 surfaces in v1" but research recommends a fallback plan.

## Key Findings

### Recommended Stack

The synapse-validated TypeScript-end-to-end stack is the right shape with five precise divergences. Synapse's `mcp/src/capture/` directory (proxy, OS service install, JSONL queue, adapters) is a load-bearing reference — copy patterns, not code. Detailed analysis in [STACK.md](./STACK.md).

**Core technologies:**
- **TypeScript 5.9 / Node 22 LTS / Cloudflare Workers + Hono 4.12 / Supabase Postgres / SvelteKit 5 / Tailwind 4 / Biome / Vitest / Zod 4** — the synapse stack, single language across daemon/backend/frontend/shared. Validated, no alternative justifies deviation.
- **Chokidar 5 / `@clack/prompts` / stdlib node:http+tls / openssl-via-child_process / inline ULID** — daemon libraries. Single dependencies per role, no `http-proxy`, no `node-forge`, no `pkg` (deprecated).
- **Cloudflare Queues + Hyperdrive + Analytics Engine** — backend additions on top of synapse's pattern. Queues decouple ingest latency from Postgres write latency at multi-tenant scale; Hyperdrive pools Postgres connections at the edge; Analytics Engine is the cheap path for live dashboard counters.
- **Manifest V3 browser extension (raw, no Plasmo/WXT) with content-script fetch monkeypatch + chrome.storage.local buffer + chrome.alarms flush + chrome.runtime.sendMessage → daemon localhost bridge** — the only MV3-viable capture path. `declarativeNetRequest` is for blocking only, not capture.
- **Apache ECharts + svelte-echarts** for time-series dashboards. LayerChart 2.0 is the alternative once its Svelte 5 migration is stable (v1.5 re-eval candidate).
- **License: Apache 2.0 with DCO sign-off in v1, EasyCLA in v1.x** — patent grant matters at enterprise evaluation; n8n SUL would block MSP/agency redistribution which is fennec's natural growth channel.
- **Daemon distribution: `npm install -g fennec` + `fennec wizard` (synapse-exact pattern)** for v1. SEA / Bun-compile are v1.5+ candidates once Node 26 LTS or Bun native-module compat matures.

### Expected Features

Fennec's pitch is "see *everything* an org's AI usage." The competitive landscape splits into app-side observability (Langfuse/Helicone/LangSmith/Phoenix — assumes you wrote the LLM-calling code; can't see vendor coding tools), vendor-native dashboards (Anthropic/OpenAI/Copilot/Cursor — each sees only their own slice, gated behind Enterprise tiers), engineering productivity platforms (Jellyfish/LinearB/Faros — vendor-API-dependent, no prompt-level detail), and single-developer local tools (Token Telemetry — CLI-only, no org layer, no outcome correlation). Detailed competitor matrix in [FEATURES.md](./FEATURES.md).

**Must have (table stakes — missing means fennec looks incomplete):**
- Token + cost capture per request; cost rollups over time; time-range filters; model and tool breakdowns
- Per-user dashboard AND per-project dashboard as equal first-class views
- Drill-down from any aggregate to individual prompts; search + multi-filter
- Multi-tenant org / project / user / membership data model with RLS isolation
- API key management; member invites; admin roles
- Daemon installer wizard (`fennec wizard`); cross-platform service install (launchd/systemd/Windows); `fennec doctor` / `fennec status`
- Resilient offline-tolerant queue; cross-machine sync to one identity per user
- CSV / JSON export for finance + reporting audiences
- Self-hostable bundle (Docker Compose + setup docs) — mandatory for enterprise data residency
- Real-time-ish freshness (data within minutes; not real-time IDE nudges, just fresh dashboards)

**Should have (differentiators that justify fennec existing):**
- Multi-surface capture from one daemon — CLI (Claude Code via hooks, Codex/Gemini via transcript watchers), IDE (Cursor + Copilot), browser (ChatGPT + Claude.ai via MV3 extension). This combination is fennec's entire moat — no competitor has it.
- Local git watcher (commits/reverts/file edits) without requiring GitHub/GitLab App — works in self-host with zero SCM setup
- Outcome correlation engine — prompt → diff → commit → durability heuristic (v1 is fuzzy-matching with explicit confidence intervals, not over-claimed certainty)
- Model-fit mismatch lens — flag "you used Opus for a 30-line refactor Haiku would have nailed" via rule-based v1, LLM-as-judge in v2. Zero competitors do post-hoc model-fit.
- Per-user prompting-quality view (length, retries, model-tier appropriateness) and per-project cost attribution from local git context
- n8n-style dual distribution: OSS self-host + managed cloud, same codebase

**Defer (v2+):**
- AI-generated recommendations / weekly coaching summaries (prove dashboards' data value first)
- Real-time IDE/CLI nudges (would require daemon→tool reverse channel; doubles every adapter's complexity)
- Policy enforcement / spend caps / blocking (heavy compliance surface)
- GitHub/GitLab App integration (v1 uses local git watching instead)
- SSO (SAML/OIDC) — Enterprise tier, staged after PMF
- LLM-as-judge model-fit classifier; per-feature/per-PR attribution; additional AI surfaces (Aider, Continue.dev, Windsurf, JetBrains AI); CI/CD AI usage; agent-platform usage; mobile capture

### Architecture Approach

Three-tier system where the **producer of events is the developer's machine**, not the user's running application — capture sits next to AI tools at the source. The daemon is one process containing many in-process adapters that share one append-only local queue; the backend is dumb at ingest and async at analysis (correlation/model-fit run as Queue consumers, not synchronously in the ingest path); the frontend reads pre-aggregated rollup tables, never raw events. Detailed analysis in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **Daemon (Node, single process)** — `AdapterRegistry` loads in-process adapters (`claude-code-hook`, `codex-transcript`, `gemini-transcript`, `cursor`, `copilot`, `browser-bridge`, `git-watcher`); each adapter emits `CanonicalEvent` via a shared `emit()` callback; events flow to one SQLite/WAL `LocalQueue` keyed by `idempotency_key`; one `SyncLoop` drains queue → batches 100 events / 5s → POSTs to backend with watermark advance on 2xx and exponential backoff on 5xx.
2. **Backend (Cloudflare Workers + Hono)** — `POST /api/events/batch` does auth + dedupe-upsert + Cloudflare Queue enqueue, nothing else; `CorrelationWorker` (Queue consumer) joins prompts ↔ git events within ±N min; `ModelFitWorker` (Queue consumer) scores prompt vs model; `AggregatorCron` writes daily rollups to `daily_rollups_by_{user,project}`; all reads from frontend hit rollup tables.
3. **Database (Supabase Postgres)** — RLS-gated; `ai_events` and `git_events` PARTITION BY RANGE (occurred_at) monthly; derived tables `prompt_outcomes` + `model_fit_scores` + `daily_rollups_*` (write only from owning worker, re-derive don't mutate); tenancy via `orgs · projects · users · org_members · project_members · api_keys · invites`.
4. **Frontend (SvelteKit, server-rendered)** — `/orgs/[org]/users/[user]` (per-user view), `/orgs/[org]/projects/[proj]` (per-project view), `/orgs/[org]/prompts/[id]` (drill-down), `/orgs/[org]/settings/{members,keys,billing}`. Routes load via `+page.server.ts` calling backend JSON endpoints with API key.
5. **Browser extension** — separate npm-deployable Manifest V3 artefact, content-script fetch-monkeypatch on chatgpt.com / claude.ai, posts to daemon's loopback `127.0.0.1:7821` bridge with shared-secret header set at `fennec wizard`. Architecturally just another adapter from the daemon's perspective.

**Five anti-patterns to actively prevent** (all caught from synapse experience): adapter writes directly to backend bypassing the queue (breaks offline / dedupe / retry); inferring outcomes in the daemon (breaks cross-machine + retroactive heuristic improvement); branching code on cloud vs self-host (silent divergence + self-host rot); querying raw `ai_events` for dashboard cards (becomes the slowest part of the system at 10M+ events); top-level event fields for tool-specific data (every new adapter breaks the canonical shape).

### Critical Pitfalls

Five pitfalls have CRITICAL severity in fennec's domain (existential failure modes). Detailed prevention strategies, warning signs, and phase mapping in [PITFALLS.md](./PITFALLS.md).

1. **Secrets-in-prompts leak to cloud / breach surface** — A developer pastes a `.env`, a Bearer token, or PII into a prompt; daemon captures verbatim; cloud stores indefinitely; next breach exposes every customer's secrets. Mandates **capture-time redaction with two-layer rules (gitleaks defaults + customer-configurable regex), default 30-day SaaS / 90-day self-host retention, per-org KMS encryption at rest, and a documented Article-17 deletion path**. Non-negotiable for Phase 1 (Capture); cannot be retrofitted safely.
2. **Capture adapter breakage goes silent** — Tool transcript formats change between versions (Claude Code 2.0.x hook regressions, Cursor SQLite multi-DB shifts, Codex session-path rotation); adapter silently captures zero events; dashboard shows "AI usage down 40%" interpreted as team behaviour, not adapter break. Mandates **heartbeat events with `events_parsed: 0, parse_errors: N` even when nothing captured, schema-hash drift detection in every adapter, snapshot-based contract tests per supported tool version, and a dashboard "adapter offline" banner that distinguishes "no AI usage" from "we can't see your AI usage."**
3. **Multi-tenant data isolation enforced only in application code** — Synapse hit this exact bug three times. Service-role key bypasses RLS, every handler is the sole defender of tenant isolation, one missing `requireRole` call leaks across orgs. Mandates **defense-in-depth: middleware-enforced `projectScopeMiddleware` on every project-scoped route + RLS backstop on every customer-data table + pre-commit hook grep for handlers missing the check + quarterly tenant-isolation drill with two test orgs.**
4. **Outcome correlation over-claims certainty** — Fuzzy diff-matching is directionally useful but not individually precise; "Sarah's prompts produced 4,200 lines this week" gets printed in a quarterly review and weaponised in a performance evaluation; research literature shows 88%→1% accuracy collapse under adversarial conditions. Mandates **every attribution number shows confidence (no raw percentages), default views are org-aggregate not per-developer, methodology page linked from every per-user view, reverts explicitly downgrade attribution rather than silently subtracting, and the UI actively makes performance-review export hard.**
5. **Cost numbers diverge from vendor invoices** — Anthropic prompt caching means cache reads cost 10% of input price and cache writes 125-200%; daemon that captures only `input_tokens` without `cache_creation_input_tokens` / `cache_read_input_tokens` (the LiteLLM bug) computes 70%+ wrong cost; mid-month pricing changes break hardcoded prices; subscription products (Copilot $19/mo, ChatGPT Pro $20/mo) get double-counted as token-cost. Mandates **separate estimated-vs-billed columns, full response usage block capture (not aggregated), pricing as data not code with effective-date ranges, subscription-product distinguished from token-cost, reconciliation against vendor billing APIs surfaced in the UI footer.**

**Additional HIGH-severity pitfalls** to design around in v1: developer surveillance perception (default views org-aggregate, transparency via `fennec inspect`, `fennec pause` for private mode, EU works-council brief for sales enablement); license/self-host friction (pick Apache 2.0 once and never relicense, default-off opt-in telemetry with inspectable payload, explicit feature parity, CVE notification channel via in-product banner); browser capture fragility (extension over proxy, minimal permissions to survive Chrome Web Store review post-January-2026 malicious-extension scandal, honest marketing about DOM-only vs raw-API capture limitations).

## Key Research Tensions — Resolved

Two surfaces of disagreement emerged across researchers worth resolving here before roadmap planning consumes this summary.

### Tension 1: Browser surface — parallel workstream OR defer to v1.1?

ARCHITECTURE.md and FEATURES.md agree the browser adapter is **architecturally independent** — its only contract with the daemon is one HTTP POST of a `CanonicalEvent` to the loopback bridge, so it can be developed fully in parallel with CLI/IDE adapters and backend work once the shared schema is frozen. PITFALLS.md (Pitfall 4) recommends **defer browser to v1.1, ship v1 with 3 surfaces** because Manifest V3 + Chrome Web Store review timing + corporate IT cert friction + post-January-2026 malicious-extension scrutiny make it the highest slip-risk surface. PROJECT.md says **all 4 surfaces in v1**.

**Resolution (recommended to roadmapper):** Develop browser in parallel during Phase 2 (per ARCHITECTURE.md), but **plan an explicit v1-freeze decision point** where browser status is one of three: (a) GA-ready and shipping, (b) submitted to Chrome Web Store and awaiting review while v1 ships GA on CLI+IDE with a "browser coming Q3" callout, (c) delayed past v1 because Manifest V3 capture proved unreliable for ChatGPT/Claude.ai in late 2026. Build the work in v1 so option (a) is the default and the architecture is unchanged; reserve options (b)/(c) as honest fallback rather than ambiguous risk. The browser extension's parallel-workstream architecture *enables* this flexibility — it doesn't block other surfaces if it slips.

### Tension 2: STACK ↔ FEATURES internal consistency on what gets built when

STACK.md recommends Cloudflare Queues + Hyperdrive as v1 backend components for fan-in event ingestion at multi-tenant scale. FEATURES.md scores per-user dashboard, per-project dashboard, model-fit lens, and outcome correlation as P1 (v1 launch) — but outcome correlation is also flagged as the longest dependency chain and the most likely scope-cut candidate.

**Resolution:** Cloudflare Queues + Hyperdrive are correct v1 choices because the multi-tenant cloud tier requires them from day 1 — they are not optional infrastructure. The self-host bundle can skip Queues (write to Postgres directly via Hono on Node or workerd) — this is the **deployment-topology variation** ARCHITECTURE.md prescribes, not a v1-vs-v2 split. On the differentiated lenses: research recommends **ship model-fit-mismatch as the v1 lens (pure analytics, no git dependency, dependencies cap at "captured prompt + model + token data"), defer outcome correlation to v1.x if scope pressure forces a cut** — both researchers agree model-fit ships easier and is just as differentiating because no competitor surfaces it post-hoc.

## Implications for Roadmap

Based on combined research, suggested 6-phase structure. Phase order reflects ARCHITECTURE.md's critical path (schema → ingest → one adapter end-to-end → daemon lifecycle → parallel adapters/backend/frontend → cross-platform → self-host) plus PITFALLS.md's prevention mapping (capture-time redaction, multi-tenant isolation, adapter heartbeats, attribution confidence UI all wired before the surfaces they protect ship).

### Phase 1: Foundations — Schema, Ingest, Daemon Skeleton, One Adapter End-to-End

**Rationale:** ARCHITECTURE.md identifies one serial critical path: `packages/shared/` event schema → `POST /api/events/batch` ingest → daemon skeleton (queue + sync loop + wizard) → one adapter (Claude Code hooks). Until a prompt typed in Claude Code arrives in Supabase via the daemon, nothing else can be validated. PITFALLS.md flags four prevention mechanisms that MUST be in this phase or they cannot be retrofitted: (1) capture-time secret redaction, (2) adapter heartbeats including parse_errors, (3) schema-hash drift detection, (4) `idempotency_key`-based dedupe.
**Delivers:** End-to-end smoke proof — prompt in Claude Code → Supabase row via daemon → dedupe on retry → survives daemon restart. macOS launchd only at this phase; Linux/Windows later.
**Addresses (FEATURES):** Daemon installer wizard (P1), Claude Code hook adapter (P1), resilient local queue (P1), ingestion API (P1), multi-tenant data model (P1, schema only), API key auth.
**Uses (STACK):** TypeScript 5.9, Node 22, Hono 4.12, Supabase Postgres, Wrangler 4.75, Zod 4.3, chokidar 5, @clack/prompts 0.11, append-only JSONL queue per synapse `events-log.ts`.
**Avoids (PITFALLS):** P1 (capture-time redaction wired before first cloud event), P3 (adapter heartbeats from day one), P5 (multi-tenant `org_id` scoping in the schema from the first migration, even if only one adapter ships), P11 (API-key auth ties machine to user from first run), P12 (code-signed Windows binary deferred to Phase 5 but build pipeline supports signing from Phase 1).
**Research flag:** STANDARD PATTERNS — synapse is the load-bearing reference; minimal additional research needed. Spike Cloudflare Hyperdrive + Supabase Postgres compatibility before locking in.

### Phase 2: Parallel Adapters + Backend Analysis Layer

**Rationale:** Once Phase 1 freezes the schema and proves the ingest pipeline, every remaining adapter and every backend worker can develop independently. ARCHITECTURE.md's parallelisation map: Codex/Gemini transcript adapters, Cursor/Copilot adapter, browser extension, git-watcher adapter all parallel — none block each other. Correlation worker, model-fit scorer, daily aggregator are likewise independent of each other. Putting these in one phase reflects calendar parallelism, not coupling.
**Delivers:** All four AI surfaces capturing (CLI hooks, CLI transcripts, IDE, browser), git events flowing, model-fit lens computing scores, daily rollups populating dashboard-read tables.
**Addresses (FEATURES):** Codex CLI watcher (P1), Gemini CLI watcher (P1), Cursor IDE adapter (P1), Copilot IDE adapter (P1, mechanism risk noted), ChatGPT/Claude.ai browser extension (P1, slip risk noted), local git watcher (P1), model-fit mismatch lens (P1 differentiator — primary v1 lens choice), outcome correlation engine (P1 differentiator — secondary; ships in v1.x if scope cut).
**Uses (STACK):** chokidar adapters per synapse pattern, Manifest V3 raw (no Plasmo/WXT), stdlib `node:http` localhost bridge, Cloudflare Queues consumer for correlation/model-fit, Cloudflare Analytics Engine for live counters.
**Avoids (PITFALLS):** P4 (browser-extension minimal permissions + security review + DOM-only positioning), P6 (correlation engine surfaces confidence intervals, not single percentages), P7 (model-fit captures cache_creation/cache_read tokens separately at ingest), P15 (synapse + fennec coexistence detection on install).
**Research flag:** NEEDS RESEARCH — Cursor's SQLite storage moved from one DB to three (composer/legacy aichat/aiService.prompts); Copilot's cache-file approach is undocumented and version-fragile; Manifest V3 fetch-monkeypatch viability against ChatGPT's anti-bot scripts in late 2026 must be spiked before committing schedule. Recommend `/gsd:plan-phase --research-phase 2`.

### Phase 3: Multi-Tenant Backend Maturity — Org Layer, Membership, Tenant Isolation

**Rationale:** Phase 1 ships one org's data flowing end-to-end with `org_id` scoping baked in but no multi-org UX. This phase adds the org/project/user/membership/invite/API-key surfaces that make fennec a team product, and operationalises the multi-tenant isolation defense-in-depth that PITFALLS.md flags as the single most catastrophic class of bug (synapse hit it three times). Comes before dashboards because every dashboard query must already be tenant-scoped on day one.
**Delivers:** Org admin UX (invite members, manage API keys, set roles), `projectScopeMiddleware` enforcing membership on every project-scoped route, RLS policies on every customer-data table as backstop, pre-commit hook grepping for unsafe handler patterns, quarterly tenant-isolation drill documented and run.
**Addresses (FEATURES):** Org member invite + roles (P1), API key management (P1), multi-tenant data isolation (P1), org-level admin (P1), customer-configurable redaction-rules UI (Pitfall 2 mitigation).
**Uses (STACK):** Supabase Auth (`@supabase/supabase-js` + `@supabase/ssr`), Hono middleware chain, RLS policies.
**Avoids (PITFALLS):** P2 (customer-configurable redaction-rules UI), P5 (multi-tenant isolation drill + middleware + RLS belt-and-suspenders), P11 (cross-machine identity merge UI), P17 (demo-org separation rules).
**Research flag:** STANDARD PATTERNS — synapse's auth + invite + API-key flow is directly portable. Briefly verify Hono middleware ordering with `@supabase/ssr` in SvelteKit hooks.server.ts.

### Phase 4: Dashboards — Per-User View, Per-Project View, Drill-Down

**Rationale:** Phase 1+2+3 produce the data and the safe access boundary. Phase 4 produces the value surface — fennec's pitch is the dashboard. PITFALLS.md flags two critical UX decisions that must be baked into the dashboards at first build, not retrofitted: default views are org-aggregate (not per-developer), and attribution numbers always carry confidence indicators. Both shape information architecture, not just visual design.
**Delivers:** Per-user dashboard (token usage over time, cost, model breakdown, prompting patterns), per-project dashboard (total cost, hotspots, cost per shipped PR/feature), drill-down from any aggregate to individual prompts, search + multi-filter (user/project/model/tool/time/status), CSV export, time-range selector, `fennec status` user-visible daemon health, adapter-offline banners.
**Addresses (FEATURES):** Per-user dashboard (P1), per-project dashboard (P1), drill-down to prompts (P1), search + filter (P1), time-range filters (P1), CSV/JSON export (P1), daemon health / status surface (P1).
**Uses (STACK):** SvelteKit 5 + Tailwind 4, Apache ECharts + svelte-echarts, `@supabase/ssr`, `marked` + `dompurify` for prompt rendering in drill-down.
**Avoids (PITFALLS):** P3 (adapter-offline banner distinguishes "no AI usage" from "we lost the surface"), P6 (every attribution number has visible confidence + methodology link, performance-review export is hard), P7 (estimated-vs-billed cost columns + reconciliation footer + cache-token disclosure), P8 (default views org-aggregate, per-developer views opt-in or admin-gated with friction), P10 (`fennec status` exposes resource numbers).
**Research flag:** STANDARD PATTERNS — established dashboard patterns; minimal additional research. Spike ECharts performance on a 100k-event drill-down query before locking in.

### Phase 5: Cross-Platform Daemon + Polish — Linux, Windows, Code Signing, Doctor

**Rationale:** v1 macOS-first proves the model. Phase 5 expands to Linux (systemd) and Windows (service via node-windows or NSSM). PITFALLS.md flags Windows as a known-friction surface that breaks fennec's "see *everything*" pitch if 30-40% of enterprise dev machines can't run the daemon. Code signing (EV cert on Windows, Apple notarisation on macOS) is mandatory for unattended install across corporate Defender / Gatekeeper.
**Delivers:** Systemd unit for Linux, Windows service install, EV-signed Windows binary, Apple-notarised macOS binary, `fennec doctor` covering proxy/CA/quarantine diagnostics, cross-machine identity merge UI for the rare wrong-link case, fennec+synapse coexistence detection.
**Addresses (FEATURES):** Cross-machine sync (P1), improved Windows daemon experience (P2 in FEATURES.md, treated as P1 here because Windows-broken = "see everything" broken), corporate proxy compatibility.
**Uses (STACK):** node-windows or NSSM, systemd unit templates per synapse `os-service.ts`, EV code-signing cert ($300-700/yr), Apple Developer Program ($99/yr).
**Avoids (PITFALLS):** P12 (Windows Defender quarantine — EV-signed binary), P13 (TLS-intercepting proxy fights corporate proxy — `NODE_EXTRA_CA_CERTS` + `HTTPS_PROXY` respect), P15 (synapse+fennec hook-chaining, not exclusive).
**Research flag:** NEEDS RESEARCH — Cursor/Gemini transcript file paths on Windows are not yet verified (synapse confirms macOS/Linux only). Windows Task Scheduler quirks + PowerShell execution policy interactions need spike. Recommend `/gsd:plan-phase --research-phase 5` if Windows lands as a blocker.

### Phase 6: Self-Host Distribution + License + Public Repo

**Rationale:** PROJECT.md mandates self-host from day 1 (enterprise data residency is the buyer trigger). This phase ships the OSS bundle, locks in the license, opens the public repo, and operationalises the n8n-style distribution. PITFALLS.md flags license-and-distribution as a single irreversible decision class — get it right once, never relicense.
**Delivers:** Docker Compose bundle (Postgres + Hono on Node OR workerd + SvelteKit static + Caddy reverse proxy), Supabase migrations runnable against bare Postgres, opt-in default-off telemetry with inspectable payload, Apache 2.0 LICENSE + DCO sign-off, public GitHub repo with security review of browser extension complete (Trail of Bits / NCC), CVE notification channel via in-product banner, works-council brief asset for EU sales enablement, `fennec inspect` + `fennec pause` user-transparency commands.
**Addresses (FEATURES):** Self-hostable open-source bundle (P1), tiered access (free/SaaS/enterprise stub), webhooks (P2), Slack/Teams digest (P2), cost anomaly alerts (P2), DPA template for EU B2B compliance.
**Uses (STACK):** Apache 2.0 license, EasyCLA bot OR DCO sign-off, Caddy/nginx reverse proxy, optional `pgmq` / `graphile-worker` as Postgres-backed Queues abstraction for self-host parity.
**Avoids (PITFALLS):** P1 + P2 + P5 (final tenant-isolation drill + canary-secret smoke + redaction-drill onboarding checklist), P8 (works-council brief, transparency commands, default consent flow), P9 (license locked + telemetry opt-in + CVE channel), P14 (signed releases + staged rollout + manual update path), P16 (BAA template + PHI-self-host docs), P17 (demo environment isolated from prod).
**Research flag:** STANDARD PATTERNS for Docker Compose + reverse proxy + license docs. NEEDS RESEARCH for workerd-vs-Hono-on-Node final pick for self-host (depends on Queues abstraction complexity).

### Phase Ordering Rationale

- **Why 1 before everything:** The schema is the contract between every other component. Until daemon and backend agree on the wire format, no other work parallelises safely. Synapse's experience: drift between daemon and backend types is the most expensive bug class. `packages/shared/` exists from day one.
- **Why 2 parallel after 1:** Once the schema is frozen and one adapter proves the pipeline, ARCHITECTURE.md's parallelisation map shows every remaining adapter + every backend analysis worker + every frontend view can develop independently. Treating this as one calendar phase reflects the parallelism, not coupling.
- **Why 3 before 4:** Multi-tenant isolation must be belt-and-suspenders verified before any dashboard renders cross-tenant data. PITFALLS.md flags isolation as the single most catastrophic class of bug. Doing it before the dashboard means every dashboard query is tenant-scoped from first commit, not retrofitted.
- **Why 4 before 5:** The macOS-only daemon + the dashboard is the credible-demo bar from PROJECT.md ("4-8 weeks to a credible demo"). Cross-platform polish (5) is what makes the demo a product, but the demo proves PMF first.
- **Why 5 before 6:** Self-host needs the Linux/Windows daemons to be useful for the enterprise data-residency buyer (who is almost certainly running Linux servers and mixed dev fleets). 5 is the prerequisite for 6 to be valuable.
- **Why 6 last:** License + public repo is irreversible. Better to ship the codebase running at a sandboxed group of beta customers, learn what self-host operators actually need, then open the repo with a CVE process and works-council brief in hand.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):
- **Phase 2 (Adapters):** Three areas of mechanism uncertainty: (a) Cursor's SQLite multi-DB storage in 2026, (b) Copilot's cache-file location stability across versions (undocumented), (c) Manifest V3 fetch-monkeypatch viability against ChatGPT's anti-bot scripts in late 2026. Spike each before locking in adapter timelines.
- **Phase 5 (Cross-platform):** Windows daemon lifecycle has unknowns — Task Scheduler quirks, PowerShell execution policies, Defender + EV-cert reputation timing (binaries with new EV certs still flag for ~30 days), Cursor/Gemini transcript file paths on Windows (synapse covers macOS/Linux only). Budget a research-phase if Windows blocks.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundations):** Synapse is the direct reference for daemon/queue/sync/wizard/Hono-ingest. Minimal additional research.
- **Phase 3 (Multi-tenant):** Synapse's auth/invite/API-key/membership flow is directly portable. Hono middleware + RLS is well-trodden.
- **Phase 4 (Dashboards):** Standard dashboard patterns; ECharts is the de facto choice. Spike performance on large drill-downs.
- **Phase 6 (Distribution):** Docker Compose + Caddy + license docs are standard. The license decision (Apache 2.0) is researched and locked.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Synapse is a working existence proof for the same daemon + Workers + Supabase + SvelteKit pattern. Five precise divergences each independently validated. MEDIUM-only on browser-extension capture viability for late-2026 ChatGPT/Claude.ai (specifics require prototype) and Cloudflare Hyperdrive + Supabase Postgres version compatibility (check region availability). |
| Features | HIGH | 15+ competitor products surveyed. Three structural gaps unambiguously unoccupied by combination: machine-side capture across all surfaces + local git outcome fuse + model-fit lens + n8n-style OSS+managed. Per-feature priority matrix grounded in this comparison. |
| Architecture | HIGH | Synapse's working production architecture directly applicable; daemon + Workers + Hono + Supabase + adapter-registry pattern is battle-tested. Six anti-patterns explicitly identified with lived-experience source. Queue + Hyperdrive additions sound for the multi-tenant scale envelope. |
| Pitfalls | HIGH | 17 distinct pitfalls grounded in three concrete evidence types: synapse's lived experience, verified third-party incidents (Anthropic caching math, LiteLLM bug, malicious-extension scandal, n8n license backlash, Continue.dev telemetry controversy), and public regulatory/research literature (GDPR, EU AI Act, GitClear attribution accuracy collapse). MEDIUM only on compliance specifics (SOC2/GDPR/HIPAA applicability) — laws are public, applicability needs counsel verification before customer-facing claims. |

**Overall confidence:** HIGH. This is one of the better-validated domains for research because (a) a working same-pattern reference codebase exists (synapse), (b) the competitor landscape is mature and well-mapped, (c) the pitfalls are not speculative but documented incidents.

### Gaps to Address

- **Cursor / Copilot capture mechanism for v1** — Cursor's SQLite migration to three databases and Copilot's reliance on cache-file reading (undocumented, version-fragile) need a spike before Phase 2 timeline can be committed.
- **Manifest V3 fetch-monkeypatch viability against late-2026 ChatGPT anti-bot** — Only a prototype against current ChatGPT can verify. Build prototype in first week of Phase 2, gate browser-adapter timeline on its result.
- **Windows daemon polish + Defender behaviour under fresh EV cert** — New EV certs flag for ~30 days even when signed. Budget Phase 5 to include Defender pre-clearance submission and 30-day reputation warm-up.
- **Outcome correlation algorithm precision** — Exact confidence model (string similarity + temporal proximity + same-author + not-in-stash-before-prompt) needs to land before v1 dashboards render attribution numbers.
- **Self-host Queue abstraction (Cloudflare Queues vs pgmq vs graphile-worker)** — Spike `pgmq` vs `graphile-worker` against the abstraction interface in Phase 6 research-phase.
- **EU works-council compliance asset wording** — Draft in Phase 6, review with counsel before first EU sales conversation.

## Sources

### Primary (HIGH confidence)

**Synapse codebase (load-bearing reference for fennec's patterns):**
- `~/Documents/synapse/mcp/src/capture/{os-service,events-log,proxy/server,proxy/tls}.ts` — daemon lifecycle, JSONL queue, TLS-MITM proxy, OpenSSL cert generation
- `~/Documents/synapse/mcp/src/capture/adapters/{codex,cursor,gemini}.ts` — file-watcher adapter pattern
- `~/Documents/synapse/.planning/codebase/{ARCHITECTURE,CONCERNS,STRUCTURE}.md` — architecture decisions, three documented multi-tenant isolation bugs, file structure conventions
- `~/Documents/synapse/.planning/research/PITFALLS.md` — capture loop, telemetry, waitlist funnel pitfalls
- `~/Documents/synapse/docs/BUGS.md` — Netskope proxy block (REQ-BUG-03), daemon lifecycle bugs

**Official documentation (verified current as of April-May 2026):**
- Node.js SEA documentation (nodejs.org/api/single-executable-applications.html)
- Cloudflare Queues: Batching, Retries, and Delays (developers.cloudflare.com/queues/configuration/batching-retries/)
- Hono Validation Guide (hono.dev/docs/guides/validation)
- Claude Code Hooks Reference (code.claude.com/docs/en/hooks)
- Supabase Postgres Partitioning (supabase.com/docs/guides/database/partitions)
- Anthropic Prompt Caching Documentation (platform.claude.com/docs/en/build-with-claude/prompt-caching)
- OpenTelemetry GenAI Semantic Conventions (opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- Chrome MV3 / declarativeNetRequest reference (developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- Replace blocking web request listeners — Chrome for Developers (developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests)
- Supabase Row Level Security (supabase.com/docs/guides/database/postgres/row-level-security)

**Competitor documentation (verified):**
- Helicone, Langfuse, LangSmith, Portkey, Phoenix, Traceloop documentation and pricing pages
- Anthropic Enterprise Analytics API, OpenAI Workspace Analytics, GitHub Copilot Metrics API, Cursor Admin Dashboard documentation
- Token Telemetry, Coding Agent Usage Tracker repos

### Detailed source lists

See per-file `## Sources` sections in [STACK.md](./STACK.md), [FEATURES.md](./FEATURES.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [PITFALLS.md](./PITFALLS.md) for the full enumerated bibliography.

---
*Research completed: 2026-05-31*
*Ready for roadmap: yes*
