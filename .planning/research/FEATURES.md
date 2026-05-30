# Feature Research

**Domain:** AI usage / cost observability for AI coding tools (developer tooling, dev-tool FinOps slice)
**Researched:** 2026-05-31
**Confidence:** HIGH (well-trodden competitor landscape; clear gaps validated across multiple sources)

---

## Competitor Survey

### Direct Adjacents — General LLM Observability

#### Helicone (helicone.ai) — Maintenance mode as of March 2026 (acquired by Mintlify)
- **Capture mechanism:** HTTP proxy. Change a single URL on the LLM client; every request flows through Helicone's gateway before reaching the provider.
- **Metrics surfaced:** tokens, cost, latency, errors, cache hit rate, rate-limit usage. ~40+ provider models tracked.
- **Per-user attribution:** YES via `Helicone-User-Id` header — surfaces power users, retention, retry patterns.
- **Per-project attribution:** YES via custom properties (`Helicone-Property-[Name]` headers) — tag environment, feature, project.
- **Outcome correlation:** NO. Has user feedback tracking (thumbs up/down) but no link to git or shipped code.
- **Self-host:** YES, Apache-2.0 OSS.
- **Pricing:** Free 10k req/mo, then Pro/Team/Enterprise tiers (paused — maintenance mode).
- **Gap fennec fills:** Helicone is **app-side** (instrument your own LLM-powered app). It can't see CLI/IDE/browser usage by **developers** using vendor AI tools. No git outcome correlation. And it's effectively frozen.

#### Langfuse (langfuse.com) — Most relevant general-purpose comparison
- **Capture mechanism:** SDK wrap (Python/JS/Go) or OpenTelemetry. Caller instruments their own code. Also auto-instrumented for OpenAI SDK, LangChain, LlamaIndex via decorators.
- **Metrics surfaced:** token counts (input/output, type breakdown), cost per generation, latency, traces with nested spans, prompts/completions, scores from evals.
- **Per-user attribution:** YES via `userId` attribute propagated across observations; Metrics API exposes per-user cost/token/trace aggregates.
- **Per-project attribution:** YES — projects are a first-class concept in the data model; sessions, tags, custom metadata supported.
- **Outcome correlation:** Partial — supports user feedback / scores / evals, but NO native git tie-in. You'd have to inject git metadata yourself.
- **Self-host:** YES (MIT core) — Docker Compose for dev, Helm/Terraform for prod. Requires ClickHouse + Postgres + Redis (5+ services).
- **Pricing:** Hobby free (50k units/mo), Core $29/mo, Pro $199/mo, Enterprise from $2,499/mo. Self-host: free except SCIM/audit/retention/SLA.
- **Gap fennec fills:** Langfuse expects **your code** to instrument LLM calls. Vendor AI coding tools (Claude Code, Cursor, Copilot) don't ship Langfuse SDKs and you can't modify them. Plus: no git outcome correlation, no multi-surface capture from the developer's machine.

#### LangSmith (LangChain) — The premium-priced, LangChain-tied option
- **Capture mechanism:** SDK wrap. Works with non-LangChain code too (OpenAI/Anthropic SDKs, Vercel AI SDK, LlamaIndex) but instrumentation is in-your-code.
- **Metrics surfaced:** inputs/outputs, latency, token counts, errors, full chain visibility, prompt versioning, evals.
- **Per-user attribution:** YES via metadata tagging.
- **Per-project attribution:** YES — projects are first-class.
- **Outcome correlation:** NO native git tie. Has evals and feedback, but you correlate to outcomes yourself.
- **Self-host:** YES, but Enterprise-only add-on, Kubernetes-based BYOC on AWS/GCP/Azure.
- **Pricing:** Free developer (5k traces/mo, 14-day retention), Plus $39/seat/mo (10k traces, $2.50/1k overage), Enterprise custom (can hit 5–10% of LLM API spend at scale).
- **Gap fennec fills:** Same as Langfuse — instrumentation-in-app, not capture-from-developer-machine. Pricing scales painfully. No git outcomes. Self-host gated behind Enterprise.

#### Portkey (portkey.ai) — Gateway with observability bolted on
- **Capture mechanism:** AI gateway proxy (route requests through Portkey) + SDK option. Sits between client and 1,600+ LLM endpoints.
- **Metrics surfaced:** 40+ metrics per request: cost, latency, guardrail violations, failures, model routing decisions.
- **Per-user attribution:** YES via metadata.
- **Per-project attribution:** YES.
- **Outcome correlation:** NO.
- **Self-host:** Gateway is OSS (Apache-2.0); full observability stack is SaaS-primary.
- **Pricing:** Free Developer, $49/mo Production (3M log cap — hit it and you lose visibility on overage traffic), Enterprise custom.
- **Gap fennec fills:** Portkey is a **gateway** — it requires inbound traffic to flow through it. You can't make Claude Code or Cursor route through Portkey without TLS-MITM. Same instrumentation-in-app limitation.

#### Traceloop / OpenLLMetry — The OTel-for-LLMs library
- **Capture mechanism:** SDK auto-instrumentation built on OpenTelemetry. Hooks OpenAI/Anthropic/HuggingFace/LangChain/Pinecone clients in-process.
- **Metrics surfaced:** prompts, completions, tokens, model name/version, temperature, latency, errors — all as OTel spans.
- **Per-user attribution:** Whatever the consuming OTel backend supports.
- **Per-project attribution:** Same.
- **Outcome correlation:** None native — depends on the backend.
- **Self-host:** YES, sends to any OTel collector (Datadog, New Relic, Honeycomb, SigNoz, etc.).
- **Pricing:** Library is OSS; you pay whatever your OTel backend charges.
- **Gap fennec fills:** It's a **library** — same instrumentation-in-your-code limitation. Doesn't address vendor coding tools.

#### Arize Phoenix — Open-source competitor to Langfuse, eval-heavy
- **Capture mechanism:** SDK / OpenTelemetry / OpenInference. Same in-app instrumentation model.
- **Metrics surfaced:** traces, model calls, retrieval, tool use, evals, prompt management, prompt playground, span replay.
- **Per-user attribution:** Yes via metadata.
- **Per-project attribution:** Yes via projects/sessions.
- **Outcome correlation:** Eval-based (LLM-as-judge), not git-tied.
- **Self-host:** YES, can run locally / in container / in notebook.
- **Pricing:** OSS free; managed Arize is enterprise.
- **Gap fennec fills:** Same instrumentation-side model. Evals are about output quality, not "did this AI prompt's code actually ship and stay shipped?"

---

### Vendor-Native Dashboards

#### Anthropic — Admin Usage & Cost API (mid-2025) + Enterprise Analytics API (March 2026)
- **Capture:** Backend-side (Anthropic owns the API logs).
- **Metrics:** Tokens by workspace/API-key/model/tier. The Enterprise Analytics API adds named user attribution: token usage, USD spend, engagement patterns (conversations, Claude Code sessions, commits, PRs, lines of code, skills, connectors).
- **Per-user attribution:** YES — but only on the **Enterprise** plan (gated behind Primary Owner access), NOT on Team/Pro.
- **Per-project attribution:** Workspace-level, not real-project-level.
- **Outcome correlation:** Counts commits/PRs/LOC but doesn't tie individual prompts to shipped code (claims aggregate "lines accepted" but no per-prompt → per-commit linkage).
- **Self-host:** N/A.
- **Pricing:** Bundled with Anthropic plan. Enterprise plans only.
- **Gap fennec fills:** (1) Anthropic-only. No cross-vendor view. (2) Enterprise-gated. (3) Coarse: workspace, not arbitrary project. (4) Aggregate counts of "PRs" but not "this specific prompt's diff → this commit." (5) Can't see CLI/IDE/browser distinction within Claude Code usage.

#### OpenAI — Usage Dashboard + ChatGPT Enterprise Workspace Analytics + Codex Admin
- **Capture:** Backend.
- **Metrics:** Active users, total messages, credits spent, member-level seat/credits table, breakdowns by model/tool/connected-app. Workspace summary + flexible date ranges + CSV export.
- **Per-user attribution:** YES (Enterprise/Edu only).
- **Per-project attribution:** Workspace-level. "Projects" exist in CSV exports.
- **Outcome correlation:** NO.
- **Self-host:** N/A.
- **Pricing:** Bundled with Enterprise/Edu.
- **Gap fennec fills:** OpenAI-only. No git outcome. Enterprise/Edu gated. No cross-vendor view.

#### GitHub Copilot Metrics API
- **Capture:** Backend (GitHub owns the data).
- **Metrics:** Active users, completions, chats, breakdowns by language/IDE/feature/model. NDJSON download reports. Team-level metrics added May 2026 (you join `user-teams` report with `per-user-usage` yourself).
- **Per-user attribution:** YES — at the individual GitHub user level. Team breakdown is post-hoc by joining reports.
- **Per-project attribution:** Indirect (by team / by repo). Not a first-class dimension.
- **Outcome correlation:** Coarse counts; no per-prompt → per-commit fuse.
- **Self-host:** N/A.
- **Pricing:** Bundled with Copilot Business/Enterprise.
- **Gap fennec fills:** Copilot-only. No cross-vendor. Team mapping requires DIY join. No prompt-level visibility (only aggregates).

#### Cursor for Teams / Enterprise Admin Dashboard
- **Capture:** Backend (Cursor owns the data).
- **Metrics:** DAU/MAU, lines suggested vs accepted, chat accepts, lines of AI code added/deleted. December 2025 added "billing groups" / "pricing groups" for sub-org-level spend attribution.
- **Per-user attribution:** YES (by email).
- **Per-project attribution:** Limited — Teams plan has no built-in team grouping; Enterprise added billing/pricing groups. Repo/project not first-class.
- **Outcome correlation:** Reports acceptance, but no diff-to-commit fuse.
- **Self-host:** N/A.
- **Pricing:** Bundled with Teams/Enterprise plans. Date-range caps in API/CSV exports (90-day Admin, 30-day Analytics).
- **Gap fennec fills:** Cursor-only. No cross-vendor. Project-level still weak. No outcome correlation.

---

### Engineering Productivity Platforms (Adjacent — Bigger Surface, Less Specific)

#### Jellyfish — Engineering Intelligence + AI Impact module
- **Capture:** Integrates with GitHub/GitLab, Copilot Metrics API, Cursor admin API, Claude Code analytics API, Sourcegraph, Gemini Code Assist. Pulls from vendor dashboards. No machine-level capture.
- **Metrics:** Cycle time, throughput, PR merge counts comparing AI-touched vs human-only. ROI lens: PR-per-engineer impact (113% lift cited), median cycle time drop.
- **Per-user attribution:** YES — derived from vendor APIs.
- **Per-project attribution:** YES via Jira/repo joins.
- **Outcome correlation:** Coarse — AI-touched PRs → cycle time / quality. Not prompt-to-commit.
- **Self-host:** SaaS-only.
- **Pricing:** Enterprise (custom).
- **Gap fennec fills:** Jellyfish is **dependent on vendor APIs**. It can't see ChatGPT.com browser usage, Claude.ai web usage, or any tool that doesn't expose admin APIs. Aggregate-only, no individual prompt visibility, no model-fit lens.

#### LinearB — Workflow automation + AI Developer Productivity Insights
- **Capture:** Git/Jira/CI integrations + auto-detection of AI activity.
- **Metrics:** DORA-style cycle time, PR funnel, code quality, AI vs human comparisons. WorkerB automation (notifications, nudges).
- **Per-user attribution:** YES.
- **Per-project attribution:** YES.
- **Outcome correlation:** PR-cycle level, not prompt level.
- **Self-host:** SaaS-only.
- **Pricing:** Enterprise.
- **Gap fennec fills:** Same as Jellyfish — vendor-API-dependent, no prompt-level visibility, no browser/CLI direct capture.

#### Faros AI — 100+ tool unified analytics
- Similar to Jellyfish / LinearB. Vendor-API dependent. Strong on cross-tool joins, weak on prompt-level capture.

#### Sleuth.io — Deployment-centric DORA
- Adjacent but more deployment-focused. Not a direct competitor.

---

### Emerging AI FinOps / Spend Management Tools (2026)

#### Amnic, Vantage, Finout, CloudZero, Cloudgov.ai
- **Capture:** Pull from cloud billing APIs + Anthropic/OpenAI Admin APIs.
- **Metrics:** Cloud + AI unified cost, virtual tagging, anomaly detection, unit economics.
- **Per-user attribution:** YES (where vendor APIs expose it).
- **Per-project attribution:** YES via tag-based allocation.
- **Outcome correlation:** NONE.
- **Self-host:** SaaS-primary.
- **Gap fennec fills:** These are **billing-side** — they tell finance the bill. They don't see *what* developers prompted, can't show model-fit mismatches, can't tie spend to actual git outcomes. They stop at API key / workspace, not per-prompt.

#### ToolSpend, Palma.ai, cursor-usage MCP, Clawdmeter
- **Capture:** A mix — financial layer (Plaid for receipts!), vendor admin APIs, plus a few via MCP plugins.
- **Metrics:** Tool + key + team level spend; per-developer / per-team / per-MCP attribution.
- **Per-user attribution:** YES.
- **Per-project attribution:** Active development area for most.
- **Outcome correlation:** NONE.
- **Self-host:** Mixed.
- **Gap fennec fills:** Most are spend-only, no quality lens. No machine-side capture (most are vendor-API aggregators).

---

### The Closest Direct Competitors (Multi-Surface Local Capture)

#### Token Telemetry (tokentelemetry.com) — Closest fennec analogue
- **Capture mechanism:** **Reads log files agents already write on disk.** No proxy, no SDK, no wrapper. 100% local.
- **Supported tools:** Claude Code, Codex, Gemini CLI, Cursor, Copilot, Qwen CLI, OpenCode, Vibe, Antigravity, Hermes Agent. Multi-surface CLI.
- **Metrics:** tokens in/out per agent/model, exact cost per session, session traces (waterfall view), tool call analytics, per-project heatmaps and timelines, plan-mode capture.
- **Per-user attribution:** Single-developer tool (no team layer).
- **Per-project attribution:** YES via directory heatmaps.
- **Outcome correlation:** NO git tie-in.
- **Self-host:** Always local — no cloud option.
- **Pricing:** Free, open-source.
- **Gap fennec fills:** Token Telemetry is **single-developer**, no organization layer, no per-user team view, no team-level dashboards, no outcome correlation, no browser/web capture (CLI-only). fennec extends to org-level, adds outcome correlation, adds IDE + browser surfaces, adds model-fit lens.

#### Coding Agent Usage Tracker (Dicklesworthstone/coding_agent_usage_tracker)
- Single-developer CLI similar to Token Telemetry. Quota/limit-focused. Even simpler scope.

---

## Cross-Competitor Synthesis — Where the Market Has Gaps

After surveying 15+ products, **three structural gaps** keep appearing that fennec is specifically positioned to close:

### Gap 1: "App-side instrumentation" assumption
Every general LLM observability product (Helicone, Langfuse, LangSmith, Portkey, Traceloop, Phoenix) assumes **you wrote the LLM-calling code and can instrument it**. None of them capture LLM usage where **the LLM-calling code belongs to the vendor** (Claude Code, Cursor, Copilot, ChatGPT.com). Their entire mental model is API-product-builder, not developer-using-AI-tools.

### Gap 2: Vendor-API ceiling
Vendor dashboards (Anthropic, OpenAI, GitHub Copilot, Cursor) each see their own slice and only their own slice. Engineering platforms (Jellyfish, LinearB, Faros) aggregate vendor APIs, but they inherit the ceilings: no per-prompt detail, no browser-tool capture, no cross-vendor unified surface for "how did one developer use four tools today?"

### Gap 3: No prompt → commit → outcome fuse
Nobody surfaces "this expensive prompt produced this code, which got committed, which then got reverted three days later." Engineering platforms hint at it (PR-level cycle time, AI-touched vs human-only) but stop at PR-aggregate. Vendor dashboards (Anthropic Enterprise Analytics, Cursor) report aggregate "lines accepted" but no fuse from a specific prompt to a specific git outcome. Token Telemetry has per-session detail but no git.

### Gap 4 (secondary): No model-fit lens anywhere
Nobody surfaces "this prompt used Opus when Haiku would have nailed it." The closest is vendor-side routing (Portkey AI gateway can route to cheaper models pre-flight) but **post-hoc analysis showing which past prompts were over-modeled** does not exist as a feature anywhere in the market.

### Gap 5 (secondary): Open-source-AND-managed for this slice
Most spend tools are SaaS-only (Jellyfish, LinearB, Faros, ToolSpend, Palma). The general LLM-observability OSS players (Langfuse, Phoenix, Helicone) don't address dev-tool capture. n8n-style "OSS + managed" for AI-coding-tool observability is unoccupied.

---

## Feature Landscape

### Table Stakes (Users Expect These — Missing Means fennec Looks Incomplete)

Every observability tool in the market ships these; fennec will be judged for not having them.

| Feature | Why Expected | Complexity | Inspired/Validated By | Notes |
|---------|--------------|------------|------------------------|-------|
| Token counts per request (input/output, with type breakdown) | Universal — every competitor surfaces this | S | All | Direct numeric capture from API responses / hook payloads |
| Cost per request in USD | Universal | S | All | Need a maintained model→price table; helicone & langfuse both maintain their own |
| Cost rollups over time (day / week / month) | Universal time-series view | S | All | Standard line-chart with time-range selector |
| Time-range filter (24h / 7d / 30d / 90d / custom) | Universal | S | All | Standard UI primitive |
| Model breakdown view (which model burned how much) | Universal | S | All | Stacked bar / pie / table |
| Per-tool breakdown (Claude Code vs Cursor vs ChatGPT etc.) | Specific to fennec's domain but expected once positioned | S | Token Telemetry, Jellyfish | Inherent in fennec's multi-surface capture |
| Per-user dashboard | Expected for any org tool | M | Langfuse, Anthropic Enterprise, Copilot, Cursor | First-class persona view |
| Drill-down from aggregate to individual prompts | Expected from observability tools | M | Langfuse, LangSmith, Helicone, Phoenix | Without this, "dashboards" feel hollow |
| Search across prompts (text + filters) | Expected | M | Langfuse, Phoenix | Postgres ILIKE for v1; pgvector later if useful |
| Filters: by user, by project, by model, by tool, by time, by status | Expected | M | All | Standard observability multi-filter |
| Org / multi-tenant data isolation | Required for any team product | M | Langfuse, LangSmith, vendor dashboards | RLS + project_id scoping; synapse pattern |
| Org member invite & roles (admin / member) | Required for any team product | M | Langfuse, LangSmith, synapse | At minimum admin/member; SSO is anti-feature for v1 |
| API key management (for daemons / for programmatic ingest) | Required — daemons need to auth | M | synapse, Helicone, Langfuse | Synapse pattern reusable |
| CSV / JSON export | Expected for finance and reporting | S | Anthropic, OpenAI, Cursor, Jellyfish | One endpoint, one button |
| Real-time-ish freshness (data within a few minutes) | Expected — not "real-time" in IDE-nudge sense, just "fresh dashboards" | M | All | Daemon queue + 1-minute flush window is fine |
| Daemon health / status surface | Expected once a daemon exists | S | synapse `synapsesync status` / `doctor` | Reuse synapse `status` and `doctor` patterns directly |
| Offline-tolerant queue (no event loss when offline) | Expected — daemons must be resilient | M | synapse pattern | SQLite-backed local queue |
| Daemon installer / wizard (`fennec wizard`) | Expected — adoption friction killer | M | synapse `synapsesync wizard` | Direct synapse port; launchd/systemd/Windows-service |
| Cross-machine sync for the same user | Expected — devs work on multiple machines | M | synapse cross-device link | Same identity, different host tags |
| Per-project view as a top-level destination | Expected for the "where is money going" persona | M | Cursor billing groups, Jellyfish | Half of fennec's stated value |
| Cost-per-project / cost-per-repo aggregation | Expected | S | Cursor billing groups, ToolSpend | Just an aggregation; only blocked by capture having project identity |
| Self-hostable open-source bundle | Expected for the enterprise-data-residency buyer | L | Langfuse, Helicone, Phoenix | Docker Compose + docs minimum; n8n model |

### Differentiators (Where fennec Competes)

These are the features that justify fennec existing.

| Feature | Value Proposition | Complexity | Inspired/Validated By | Notes |
|---------|-------------------|------------|------------------------|-------|
| **Multi-surface capture from one daemon (CLI + IDE + browser)** | Nobody else has this. Token Telemetry has CLI; vendor dashboards have one-vendor-each; nobody has CLI + IDE + browser in one product. | **XL** | Token Telemetry (partial — CLI only) | This is fennec's entire moat. Browser is the highest-risk surface (PROJECT.md flags this explicitly). |
| **Hook-based capture for Claude Code (lossless event stream)** | Hooks capture more reliably than parsing transcripts; gives latency, tool invocations, prompts as discrete events | **M** | synapse Claude Code hooks (SessionStart, UserPromptSubmit, PostToolUse, etc.) | Direct synapse pattern reuse; fennec is the org-level analyzer on the same events |
| **File-watcher adapters for non-hook CLIs (Codex, Gemini)** | Captures from tools that don't expose hooks | M | synapse Cursor/Codex/Gemini adapters | Direct port from synapse |
| **Browser extension capture for ChatGPT.com / Claude.ai** | Browser is where indie devs do 30%+ of their AI work; nobody else captures it | L | None directly; closest is malicious extensions (negative validator) | High risk per PROJECT.md — will be revisited mid-build |
| **Local git watcher (commits / reverts / file edits) on developer's machine** | Foundation for outcome correlation without requiring GitHub App | **M** | Git AI (commercial), synapse pattern | Polls / watches `.git/`; works in self-host with zero SCM setup |
| **Outcome correlation: prompt → diff → commit → durability** | "Did the AI's suggested code actually ship, and did it stay shipped?" — nobody surfaces this. v1 fuzzy-match heuristic is acceptable. | **XL** | Git AI (closest commercial); broadly aspirational across category | Per PROJECT.md, v1 is heuristic-level; v2+ precision improvements |
| **Model-fit mismatch flag (used expensive model when cheap one would have worked)** | "You spent $40 on Opus for a 30-line refactor that Haiku nailed in 10 cents" — zero competitors do post-hoc model-fit | **L** | No direct competitor | Rule-based v1: short prompt + simple file change + high tier-model = flag. v2 = LLM-as-judge classifier. |
| **Per-user prompting-quality view (length, retry rate, model-tier appropriateness)** | Engineering managers need this lens; vendor dashboards stop at lines-accepted aggregates | **M** | Loose: Cursor's accept-rate, Anthropic Enterprise's engagement metrics | Derive composite "prompting quality" score from request shape + retries + outcomes |
| **Per-project cost attribution from local git context** | No vendor sees "Tanmai's prompt while in `~/repos/fennec` belongs to `fennec`" — they see API keys and workspaces | **M** | Loose: Cursor billing groups | Daemon emits project identity from CWD + git remote |
| **Dual first-class views: per-user AND per-project, equally weighted** | Most tools privilege one persona; fennec serves engineering managers (per-user) AND finance/leadership (per-project) on the same data | **M** | None — design choice | Just two top-level navigation entry points, same underlying data |
| **n8n-style distribution (OSS self-host AND managed cloud, same codebase)** | Validated by Langfuse (high adoption from this model); zero of the engineering-platform competitors do it; gives fennec both indie growth and enterprise compliance | L | n8n, Langfuse, Helicone (pre-acquisition) | Self-host is mandatory per PROJECT.md (enterprise data residency); managed cloud serves indies/SMB |
| **Tool-spanning unified developer-identity view** | Same developer using Claude Code + Cursor + ChatGPT.com is *one person*; vendor dashboards can't show that | **M** | None — direct fennec value | Multi-machine, multi-tool unified identity per user |

### Anti-Features (Things Competitors Do — fennec Should NOT Build in v1)

Per PROJECT.md's explicit Out-of-Scope list, plus a few caught during research.

| Feature | Why Requested / Why Other Tools Have It | Why Problematic For fennec v1 | Alternative |
|---------|------------------------------------------|-------------------------------|-------------|
| Real-time IDE/CLI nudges ("this prompt is too big, try this slimmer one") | Plausible roadmap evolution; LinearB does PR nudges | Requires daemon to talk *back* to tools — every adapter doubles in complexity. PROJECT.md defers explicitly to v2+. | v1 surfaces the same insight in dashboards (post-hoc); developer reads it and improves |
| Policy enforcement / spend caps / blocking | Portkey, Truefoundry, AI gateways all do this | Heavy compliance surface; needs governance-grade reliability; would require routing real-time through fennec. PROJECT.md defers to v2+. | v1 surfaces overspend in dashboards + alerts (passive); admins act manually |
| AI-generated recommendations / weekly coaching summaries | Common roadmap candy; "your team's AI usage this week" emails | Premature — fennec hasn't proven the data is valuable yet. PROJECT.md explicitly defers to v2. | Ship raw dashboards in v1; layer summaries in v2 once data trust is built |
| GitHub / GitLab App integration for SCM-side git data | Jellyfish, LinearB, Faros all do this; common buyer expectation | Adds org-level OAuth/install friction to validation. PROJECT.md explicitly uses local git watching for v1. | Local git watcher in v1; cloud SCM integration is v2 |
| SSO (SAML / OIDC) | Standard enterprise checkbox | Heavy enterprise surface for v1 — indie/SMB users don't need it; enterprise tier is staged later. PROJECT.md defers to v2+. | Email + API key auth for v1 (synapse pattern); SSO when enterprise tier ships |
| Mobile-side capture | Some "AI usage everywhere" pitches | Out of stated scope (no clear customer pull). PROJECT.md defers. | Re-evaluate v2+ if pull emerges |
| CI/CD AI usage capture (agents running in pipelines) | Some agent-platform tools market this | Out of stated scope. PROJECT.md defers. | Re-evaluate v2+ |
| Agent-platform usage capture (Devin, Cognition) | Some adjacent tools market this | Out of stated scope. PROJECT.md defers. | Re-evaluate v2+ |
| Additional AI surfaces (Aider, Continue.dev, Windsurf, JetBrains AI, internal gateways) | "Comprehensive" pitch pressure | 4 surfaces already aggressive per PROJECT.md. Adding more dilutes the v1 demo. | v2 surface expansion based on adoption signals |
| TLS-MITM proxy for browser capture | Some enterprise-grade capture tools use this | Requires root-cert install on developer machines — IT friction, hostile to indie/SMB adoption. PROJECT.md explicitly flags as risky. | Browser extension primary; proxy fallback only if extension proves inadequate |
| LLM-as-judge eval framework | Langfuse, Phoenix, LangSmith all ship this | Doesn't match fennec's "is the AI being used well" question — eval is for app-builders | Outcome correlation (git-tied) and model-fit mismatch are fennec's equivalents |
| Prompt management / version control / playground | Langfuse, Phoenix, LangSmith all ship this | Fennec is observability of vendor tools, not a place where users author prompts | Out of scope by product positioning |
| Per-trace pricing model | LangSmith does this — drives painful Enterprise costs | Anti-pattern for the indie/SMB tier fennec is targeting | Flat tiered SaaS + free self-host |

---

## Feature Dependencies

```
[Daemon installer / wizard]
    └──required-by──> [All capture adapters]
                          └──required-by──> [Ingestion API]
                                                └──required-by──> [All dashboards]

[Local git watcher]
    └──required-by──> [Outcome correlation engine]
                          └──required-by──> [Per-prompt outcome view]
                          └──required-by──> [Per-project "cost per shipped PR" metric]

[Claude Code hook adapter]
    └──independent──> [Codex/Gemini transcript watcher adapter]
    └──independent──> [Cursor IDE adapter]
    └──independent──> [Browser extension adapter]

[Ingestion API + storage]
    └──required-by──> [Per-user dashboard]
    └──required-by──> [Per-project dashboard]
    └──required-by──> [Drill-down to individual prompts]
    └──required-by──> [Model-fit mismatch analysis]
    └──required-by──> [Outcome correlation engine]

[Resilient queue in daemon]
    └──required-by──> [Cross-machine sync]
    └──enhances──> [All capture adapters]

[Org + project + user data model]
    └──required-by──> [Multi-tenant isolation]
                          └──required-by──> [Org-level admin / invites / API keys]

[Per-project cost attribution]
    └──requires──> [Daemon emits project identity from CWD + git remote]
                       └──requires──> [Local git watcher]
```

### Dependency Notes (Critical Path Items)

- **Outcome correlation requires git watcher + ingestion pipeline + at least one capture adapter producing prompt+diff candidates.** This is the longest dependency chain in v1 and likely the bottleneck. Without all three pieces, the outcome lens is impossible. Plan for it.
- **All adapters share the resilient queue layer** — building the queue once benefits every adapter. Build it first.
- **Multi-tenant data model (org → project → user → membership) must exist before any dashboard is meaningful.** Synapse pattern is directly transferable; do not re-design.
- **Per-project attribution depends on the daemon emitting project identity at capture time** — adding it later requires re-tagging historical data, which is painful. Bake project identity into the event schema from day one.
- **Browser adapter is independently architected from CLI/IDE adapters** — different runtime (browser JS), different deployment path (Chrome Web Store / Firefox add-on store). Treat it as a parallel workstream, not a dependency chain.
- **Model-fit analysis is a pure analytics layer** — it depends only on captured prompt + model + token data. It does NOT require git outcomes. So it can ship before outcome correlation matures.

---

## MVP Definition

### Launch With (v1 — credible demo per PROJECT.md, 4–8 weeks solo)

A v1 that demonstrates **all four surfaces capturing + per-user view + per-project view + at least one of {model-fit OR outcome-correlation} working at heuristic level**.

- [ ] Daemon installer (`fennec wizard`) — launchd/systemd/Windows — without it nobody can run fennec
- [ ] Resilient SQLite-backed local queue — shared across all adapters
- [ ] Claude Code hook adapter (SessionStart, UserPromptSubmit, PostToolUse, etc.) — synapse-pattern direct port
- [ ] Codex CLI file-watcher adapter — synapse pattern
- [ ] Gemini CLI file-watcher adapter — synapse pattern
- [ ] Cursor IDE adapter — extension or transcript-watch (mechanism TBD)
- [ ] GitHub Copilot IDE adapter — mechanism TBD
- [ ] Browser extension for ChatGPT.com — Manifest V3
- [ ] Browser extension for Claude.ai — same extension or separate
- [ ] Local git watcher — observes commits, reverts, file edits
- [ ] Ingestion API on Cloudflare Worker + Hono, auth via API key (synapse pattern)
- [ ] Multi-tenant data model (org / project / user / membership) on Supabase Postgres
- [ ] Per-user dashboard (SvelteKit) — token usage over time, cost, model breakdown, prompting patterns
- [ ] Per-project dashboard — total cost, hotspots (which files burned tokens)
- [ ] Drill-down from any aggregate to individual prompts
- [ ] Search + filter (user / project / model / tool / time / status)
- [ ] Time-range selector + CSV export
- [ ] Org-level admin (member invite, API key management, billing surface stubbed)
- [ ] Daemon health / status / doctor commands (synapse pattern)
- [ ] Cross-machine sync (same user on multiple hosts → one identity)
- [ ] **At least one differentiated lens**: model-fit mismatch (likely first — pure analytics, no git dependency) AND/OR outcome correlation (longer dependency chain)
- [ ] Self-hostable bundle (Docker Compose + setup doc) — n8n model

### Add After Validation (v1.x — within 4–8 weeks after v1 ships)

Things to layer in once the v1 demo lands and real users surface real needs.

- [ ] Whichever differentiated lens didn't ship in v1 (model-fit OR outcome correlation)
- [ ] Improved outcome-correlation precision (better fuzzy diff matching)
- [ ] Cost anomaly alerts (email when project / user exceeds threshold) — passive only, no enforcement
- [ ] Webhooks for ingest events (so downstream FinOps tools can consume)
- [ ] Billing for managed cloud (Stripe / similar)
- [ ] Improved daemon Windows experience (PROJECT.md flags Windows as a known friction point)
- [ ] Slack/Teams digest (passive — no nudges, just dashboards-in-Slack-style summaries)

### Future Consideration (v2+ — only after PMF signal)

Explicitly deferred per PROJECT.md. Listed here so they're not lost.

- [ ] AI-generated recommendations / weekly coaching summaries
- [ ] Real-time IDE/CLI nudges (would require daemon→tool reverse channel)
- [ ] Policy enforcement / spend caps / blocking (compliance-grade surface)
- [ ] GitHub / GitLab App integration (cloud SCM, replaces local git watcher at scale)
- [ ] SSO (SAML / OIDC) — Enterprise tier
- [ ] Additional AI surfaces (Aider, Continue.dev, Windsurf, JetBrains AI, internal LLM gateways)
- [ ] Mobile-side capture
- [ ] CI/CD AI usage capture
- [ ] Agent-platform usage capture (Devin, Cognition)
- [ ] LLM-as-judge model-fit classifier (replaces v1 rule-based)
- [ ] Per-feature / per-PR cost attribution (deeper than per-project)

---

## Feature Prioritization Matrix (v1)

User Value scored from the engineering-manager + finance-leader perspective. Implementation Cost relative to v1 scope.

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Daemon installer / wizard | HIGH (gates adoption) | MEDIUM (synapse pattern reuse) | P1 |
| Claude Code hook adapter | HIGH (largest tool in scope) | MEDIUM (direct synapse port) | P1 |
| Codex CLI file-watcher | HIGH | LOW (synapse pattern) | P1 |
| Gemini CLI file-watcher | MEDIUM | LOW (synapse pattern) | P1 |
| Cursor IDE adapter | HIGH (biggest IDE in market) | HIGH (mechanism TBD) | P1 |
| Copilot IDE adapter | MEDIUM (mostly Anthropic/Cursor users in early audience) | HIGH (mechanism TBD) | P1 (but mechanism risk — may slip to P2) |
| ChatGPT.com browser extension | MEDIUM-HIGH (indie audience uses this) | HIGH (highest-risk surface per PROJECT.md) | P1 (but flag as the surface that may need re-architecting mid-build) |
| Claude.ai browser extension | MEDIUM | MEDIUM (same extension architecture) | P1 |
| Resilient local queue | HIGH (data integrity) | MEDIUM | P1 |
| Local git watcher | HIGH (foundation for outcome correlation) | MEDIUM | P1 |
| Ingestion API | HIGH (no API = no product) | MEDIUM (synapse pattern) | P1 |
| Multi-tenant data model | HIGH | MEDIUM (synapse pattern) | P1 |
| Per-user dashboard | HIGH | MEDIUM | P1 |
| Per-project dashboard | HIGH | MEDIUM | P1 |
| Drill-down to prompts | HIGH (without it dashboards feel hollow) | MEDIUM | P1 |
| Search + filter | HIGH | LOW-MEDIUM (Postgres-side) | P1 |
| Org admin (invite, keys) | HIGH (team product req) | MEDIUM (synapse pattern) | P1 |
| Daemon status / doctor | MEDIUM (support cost reducer) | LOW (synapse pattern) | P1 |
| Cross-machine sync | MEDIUM | MEDIUM | P1 |
| **Model-fit mismatch lens** | **HIGH (differentiator)** | **MEDIUM (rule-based v1)** | **P1** |
| **Outcome correlation (heuristic v1)** | **HIGH (differentiator)** | **HIGH (longest dependency chain)** | **P1 — but at risk; pick model-fit first if scope cuts** |
| CSV export | MEDIUM (finance audiences) | LOW | P1 |
| Self-hostable bundle (Docker Compose) | HIGH (enterprise data residency) | MEDIUM | P1 |
| Cost anomaly alerts | MEDIUM | LOW-MEDIUM | P2 |
| Webhooks | LOW | LOW | P2 |
| Slack/Teams digest | MEDIUM | MEDIUM | P2 |
| Per-feature / per-PR attribution | HIGH (long-term) | HIGH | P3 |
| SSO | HIGH (enterprise only) | HIGH | P3 |
| Real-time nudges | MEDIUM (would be magical, very expensive) | XL | P3 |
| AI-coaching summaries | MEDIUM | MEDIUM | P3 (v2) |

**Priority key:** P1 = v1 launch. P2 = v1.x within first few weeks post-launch. P3 = v2+, only after PMF signal.

### Scope-Cut Plan (If 8 Weeks Slips)

If timeline pressure forces cuts, the order of removal:
1. First cut: **Copilot IDE adapter** (mechanism risky, smaller wedge in early audience). Ship with Claude Code + Codex + Gemini + Cursor + browser.
2. Second cut: **Outcome correlation** (longest dependency chain). Ship with model-fit mismatch as the sole differentiator. Add outcome correlation in v1.x.
3. Third cut: **Browser extension for Claude.ai** (keep ChatGPT.com as proof; add Claude.ai in v1.x).
4. Do NOT cut: per-user view, per-project view, self-hostable bundle. These are positioning-critical.

---

## Competitor Feature Analysis

| Feature | Helicone | Langfuse | LangSmith | Anthropic Console | Cursor Admin | Copilot Metrics | Jellyfish | Token Telemetry | **fennec** |
|---------|----------|----------|-----------|-------------------|--------------|------------------|-----------|-----------------|------------|
| Token + cost capture | YES | YES | YES | YES (vendor-only) | YES (vendor-only) | YES (vendor-only) | Via API joins | YES | **YES (all vendors via daemon)** |
| Per-user attribution | YES (header) | YES (metadata) | YES (metadata) | YES (Ent only) | YES (email) | YES | YES | NO (single dev) | **YES** |
| Per-project attribution | YES (header) | YES (project) | YES (project) | Workspace-level | Billing groups (Ent only) | Indirect | YES | YES (dir-based) | **YES** |
| Cross-vendor unified view | App-side only | App-side only | App-side only | NO | NO | NO | YES (via APIs) | YES | **YES (machine-side)** |
| Capture from vendor coding tools (no API instrumentation) | NO | NO | NO | N/A (own product) | N/A | N/A | NO (API-dependent) | YES (CLI only) | **YES (CLI + IDE + browser)** |
| Browser tool capture | NO | NO | NO | NO | NO | NO | NO | NO | **YES (extension)** |
| Local git tie / outcome correlation | NO | NO | NO | Aggregate counts | Aggregate counts | Aggregate counts | PR-level only | NO | **YES (prompt → diff → commit fuse, heuristic v1)** |
| Model-fit mismatch detection | NO | NO | NO | NO | NO | NO | NO | NO | **YES** |
| Self-host | YES (OSS) | YES (OSS) | YES (Ent only) | N/A | N/A | N/A | NO (SaaS only) | YES (local-only) | **YES (OSS bundle)** |
| Managed cloud option | YES (pre-acquisition) | YES | YES | Yes (vendor-own) | Yes (vendor-own) | Yes (vendor-own) | YES | NO | **YES (n8n model)** |
| Org / team layer | YES | YES | YES | YES | YES | YES | YES | NO | **YES** |
| Free tier for indie devs | YES (10k req/mo) | YES (50k/mo) | YES (5k traces) | Bundled w/ paid | Bundled w/ paid | Bundled w/ paid | NO | YES (free OSS) | **YES (free OSS + free tier)** |

The pattern is stark: **fennec is the only product with "machine-side capture from vendor tools across CLI + IDE + browser" PLUS "local git outcome fuse" PLUS "model-fit lens" PLUS "OSS + managed cloud".** Each individual axis has at least one competitor; the combination is unoccupied.

---

## Sources

### Direct Competitor Documentation
- [Helicone OSS LLM Observability Platform](https://www.helicone.ai/)
- [Helicone — Custom Properties documentation](https://docs.helicone.ai/features/advanced-usage/custom-properties)
- [Helicone Review (maintenance mode after Mintlify acquisition)](https://chatforest.com/reviews/helicone-llm-observability-gateway/)
- [Langfuse — User Tracking](https://langfuse.com/docs/observability/features/users)
- [Langfuse — Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Langfuse Self-Hosted Pricing](https://langfuse.com/pricing-self-host)
- [Langfuse Cloud Pricing](https://langfuse.com/pricing)
- [LangSmith Plans and Pricing](https://www.langchain.com/pricing)
- [LangSmith — Observability product page](https://www.langchain.com/langsmith/observability)
- [LangSmith — Cost Tracking](https://docs.langchain.com/langsmith/cost-tracking)
- [Portkey Pricing](https://portkey.ai/pricing)
- [Portkey Cost Management Docs](https://portkey.ai/docs/product/observability/cost-management)
- [Portkey Observability Features](https://portkey.ai/features/observability)
- [OpenLLMetry by Traceloop](https://www.traceloop.com/openllmetry)
- [OpenLLMetry GitHub](https://github.com/traceloop/openllmetry)
- [Arize Phoenix](https://arize.com/phoenix/)
- [Arize Phoenix GitHub](https://github.com/arize-ai/phoenix)

### Vendor-Native Dashboards
- [Anthropic — Enterprise Analytics API](https://www.finout.io/blog/anthropics-enterprise-analytics)
- [Anthropic Console Cost & Usage Reporting](https://support.anthropic.com/en/articles/9534590-cost-and-usage-reporting-in-console)
- [Claude Code — Track team usage with analytics](https://code.claude.com/docs/en/analytics)
- [Claude Code Analytics API](https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api)
- [OpenAI Workspace Analytics for Enterprise/Edu](https://help.openai.com/en/articles/10875114-workspace-analytics-for-chatgpt-enterprise-and-edu)
- [OpenAI ChatGPT Enterprise workspace analytics guide](https://academy.openai.com/public/clubs/admins-6o6xf/resources/chatgpt-enterprise-user-analytics-guide)
- [GitHub Copilot Metrics API](https://docs.github.com/en/rest/copilot/copilot-metrics)
- [GitHub Team-level Copilot usage metrics changelog (May 2026)](https://github.blog/changelog/2026-05-14-team-level-copilot-usage-metrics-now-available-via-api/)
- [Cursor Analytics Documentation](https://cursor.com/docs/account/teams/analytics)
- [Cursor December 2025 Enterprise Insights / Billing Groups](https://cursor.com/changelog/enterprise-dec-2025)
- [Jellyfish AI Impact](https://jellyfish.co/platform/jellyfish-ai-impact/)
- [Jellyfish Cursor Dashboard](https://jellyfish.co/platform/cursor-dashboard/)

### Direct fennec-Adjacent Tools
- [Token Telemetry](https://tokentelemetry.com/)
- [Token Telemetry GitHub](https://github.com/VasiHemanth/tokentelemetry)
- [Coding Agent Usage Tracker (Dicklesworthstone)](https://github.com/Dicklesworthstone/coding_agent_usage_tracker)
- [Truefoundry — Centralize cost control for AI coding IDEs](https://www.truefoundry.com/blog/how-to-centralize-cost-control-and-observability-for-ai-coding-ides-like-claude-code-cursor-gemini-cli-etc)
- [Toolspend on Product Hunt](https://www.producthunt.com/products/toolspend)
- [Palma.ai — Real Cost of AI Coding Tools blog](https://palma.ai/blog/real-cost-of-ai-coding-tools)
- [Clawdmeter desktop dashboard (TechCrunch)](https://techcrunch.com/2026/05/14/clawdmeter-turns-your-claude-code-usage-stats-into-a-tiny-desktop-dashboard/)
- [Git AI — Cross-Agent Observability](https://usegitai.com/agent-observability)

### Engineering Productivity Platforms
- [LinearB Platform — Engineering Metrics](https://linearb.io/platform/engineering-metrics)
- [LinearB AI & Developer Productivity Insights](https://linearb.io/platform/ai-developer-productivity-insights)
- [Faros AI Platform](https://www.faros.ai/platform)
- [Sleuth (G2)](https://www.g2.com/products/sleuth/reviews)
- [Jellyfish — 2025 AI Metrics in Review](https://jellyfish.co/blog/2025-ai-metrics-in-review/)

### Market & Comparison Reports
- [Best AI Cost Observability Tools in 2026 (Finout)](https://www.finout.io/blog/best-ai-cost-observability-tools-in-2026)
- [Best FinOps Tools for Managing AI Costs in 2026](https://www.finout.io/blog/best-finops-tools-for-managing-ai-costs-in-2026)
- [Top 5 LLM Observability Platforms 2026 comparison](https://guptadeepak.com/tools/top-5-llm-observability-platforms-2026/)
- [LLM Observability Tools 2026 Comparison (lakeFS)](https://lakefs.io/blog/llm-observability-tools/)
- [Self-Hosted vs Cloud LLM Monitoring](https://aicostboard.com/blog/posts/self-hosted-vs-cloud-llm-monitoring)
- [Langfuse vs LangSmith comparison (Leanware)](https://www.leanware.co/insights/langfuse-vs-langsmith)
- [Best LLM Cost Tracking Tools in 2026 (FutureAGI)](https://futureagi.com/blog/best-llm-cost-tracking-tools-2026)

### Outcome-Correlation & AI ROI Methodology
- [Analyzing Git Commits for AI Code Tracking](https://blog.exceeds.ai/analyze-git-commits-ai-code/)
- [7 AI-Era Developer Productivity Metrics That Work in 2026](https://blog.exceeds.ai/developer-productivity-metrics-ai-era/)
- [Measuring ROI of AI Code Assistants (Jellyfish)](https://jellyfish.co/library/ai-in-software-development/measuring-roi-of-code-assistants/)
- [AI Coding Agents Outcome-Based Verification (DEV)](https://dev.to/moonrunnerkc/ai-coding-agents-lie-about-their-work-outcome-based-verification-catches-it-12b4)

### Browser Extension Capture (Negative Validators — Security Incidents)
- [Featured Chrome Extension Intercepts AI Chats (The Hacker News)](https://thehackernews.com/2025/12/featured-chrome-browser-extension.html)
- [Malicious AI Assistant Extensions Harvest LLM Chat (Microsoft Security)](https://www.microsoft.com/en-us/security/blog/2026/03/05/malicious-ai-assistant-extensions-harvest-llm-chat-histories/)

---
*Feature research for: AI usage / cost observability for AI coding tools*
*Researched: 2026-05-31*
