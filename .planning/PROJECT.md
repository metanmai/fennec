# fennec

## What This Is

Fennec is an AI usage and cost observability platform for organizations that pay for AI coding tools (Claude Code, Codex, Cursor, GitHub Copilot, Gemini, ChatGPT, Claude.ai). A local daemon captures AI requests at the source — across CLIs, IDEs, and browsers — correlates each prompt with local git activity, and surfaces per-developer prompting quality and per-project cost attribution in a web dashboard. Distributed n8n-style: open-source self-hostable AND a managed fennec cloud.

## Core Value

**Make every AI request in an org observable, attributable, and explainable** — so engineering leaders can answer *who is prompting how*, *where is the money going by project*, and *is the right model being used for each task?* Aggregate token/cost dashboards already exist; fennec's edge is the granular, per-user + per-project view tied back to real git outcomes.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Capture (the daemon)**

- [ ] Local capture daemon — single background process per machine, monitors AI requests originating from that machine
- [ ] Claude Code adapter — hook-based capture (SessionStart, UserPromptSubmit, PostToolUse, etc.)
- [ ] Other AI CLI adapter — transcript file watchers for Codex CLI and Gemini CLI (synapse-style adapters)
- [ ] IDE adapter — capture from Cursor and GitHub Copilot (extension or transcript watch — mechanism TBD per tool)
- [ ] Browser adapter — capture from ChatGPT and Claude.ai web (browser extension; proxy fallback if needed)
- [ ] Local git watcher — daemon also monitors local git activity (commits, reverts, file edits) to enable outcome correlation
- [ ] Resilient queueing — daemon survives offline / network blips, no event loss
- [ ] Cross-machine sync — same dev on multiple machines reports under one identity
- [ ] Daemon installer & lifecycle — launchd / systemd / Windows service; `fennec wizard`-style setup

**Backend (sync, store, analyze)**

- [ ] Cloud backend on Cloudflare Workers + Hono + Supabase Postgres (synapse-pattern stack)
- [ ] Multi-tenant: organizations, projects, users, memberships
- [ ] Ingestion API (auth via API key, accepts batched events from daemons)
- [ ] Storage of prompts, responses, token counts, model used, timing, git correlation
- [ ] Outcome correlation engine — match each prompt to its eventual git outcome (committed / reverted / lingering)
- [ ] Model-fit analysis — flag when an expensive model was used for a task a cheaper one would have nailed

**Dashboard (the value surface)**

- [ ] Web dashboard (SvelteKit, synapse-pattern) with both a **per-user** view and a **per-project** view
- [ ] Per-user view — prompting patterns, token usage over time, model-fit score, outcome correlation, trends
- [ ] Per-project view — total cost, hotspots (which files/features burned tokens), cost per shipped PR/feature
- [ ] Drill-down from any aggregate metric down to the actual prompts behind it
- [ ] Org-level admin — invite members, manage API keys, billing (for cloud tier)

**Distribution**

- [ ] Open-source self-hostable bundle (Docker / standard deploy doc) — primary path for enterprise/data-residency
- [ ] Managed fennec cloud — default for indies/SMB tier
- [ ] Tiered access model: free (indie + self-host), paid SaaS (SMB), enterprise tier (SSO + self-host support) — enterprise tier likely staged in later

### Out of Scope (v1)

- AI-generated recommendations / weekly coaching summaries — v2 (prove data value via dashboards first)
- Real-time IDE/CLI nudges (e.g., "this prompt is too big, here's a slimmer one") — v2+ (would require the daemon to talk *back* to tools)
- Policy enforcement / spend caps / blocking — v2+ (heavy compliance surface, governance-grade work)
- GitHub / GitLab App integration — v1 uses local git watching instead; cloud SCM integration is v2
- SSO (SAML / OIDC) — v2+ as the enterprise tier matures
- Mobile-side capture, CI/CD AI usage, agent platform usage (Devin, Cognition, etc.) — out until clear customer pull
- Other AI surfaces: Aider, Continue.dev, Windsurf, JetBrains AI, internal LLM gateways — v2 (4 surfaces already aggressive)

## Context

- **Lineage / inspiration:** Architecturally similar to `~/Documents/synapse` — local daemon, hook + file-watcher adapters, Cloudflare Worker backend, Supabase. Fennec is an **independent codebase** (not a fork, not a layer on top of synapse), but reuses synapse's tech stack, unit-testing philosophy, daemon lifecycle pattern, and adapter-style multi-surface capture. Synapse's existing Claude Code hook handlers and CLI transcript adapters are concrete references when designing fennec's equivalents.
- **Market context:** Companies are blowing budget on AI coding tools without granular visibility. Existing vendor dashboards stop at aggregates (% AI commits, total tokens, total spend). AI cost FinOps is becoming a category — fennec stakes the dev-tool observability slice.
- **Privacy is a sales lever, not just a check:** Prompts contain proprietary code, business logic, and occasionally secrets. The self-hosted bundle exists in v1 precisely because enterprises will not allow raw prompts to leave their network. SaaS serves indies/SMBs willing to trust managed storage.
- **Outcome correlation is a heuristic, not a measurement:** "Did this prompt's suggested code actually ship?" requires fuzzy-matching AI-emitted diffs against eventually-committed code. Acceptable as a directional v1 signal; precision is a v2+ improvement.
- **Solo developer, deliberate pace.** 4–8 weeks to a credible demo. Lean on synapse patterns to compress without copying code.

## Constraints

- **Tech stack:** TypeScript end to end. Cloudflare Workers + Hono (backend). SvelteKit (frontend). Supabase Postgres (with pgvector available if semantic queries become useful). Biome (lint/format). Vitest (unit). Synapse-style monorepo (`daemon/`, `backend/`, `frontend/`, `packages/shared/`).
- **Working model:** Solo developer — attention is the bottleneck.
- **Timeline:** Deliberate — 4–8 weeks to a credible demo. No hard external deadline; quality of the demo gates progress.
- **Distribution:** n8n-style. Must ship self-hostable from day 1 (public repo, runnable bundle, license that permits it). Managed cloud runs off the same code.
- **Browser capture is the hard surface.** TLS-intercepting proxies require root-cert installation (IT-heavy, friction). Browser extensions only see what the page exposes (may miss raw API calls). Expect this mechanism specifically to be revisited mid-build.
- **Daemon must be cross-platform.** macOS (launchd), Linux (systemd), Windows (service) all in scope — synapse covered macOS + Linux first; Windows is a known friction point worth budgeting time for.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Independent codebase, synapse patterns (no fork, no layer) | Fresh repo keeps fennec scoped on observability; reuse stack + daemon pattern + testing philosophy without inheriting synapse's product surface | — Pending |
| All 4 capture surfaces in v1 (CLI hooks + CLI watchers + IDE + browser) | Product story requires "we see *everything* an org's AI usage" — gaps undermine the pitch | — Pending |
| Local git watcher (not GitHub/GitLab App) for v1 | Works in self-host without org-level SCM setup; reduces buyer friction during validation | — Pending |
| Dashboards-only v1 — no AI recs, no nudges, no policy | Prove the data is valuable before building action loops on top; manage scope | — Pending |
| Self-host + managed cloud from day 1 (n8n model) | Self-host mandatory for enterprise data residency; cloud serves indies/SMBs without infra burden | — Pending |
| Two quality lenses: model-fit mismatch + outcome correlation | Most differentiated vs existing token/cost dashboards; both are AI-native concepts no vendor surfaces today | — Pending |
| Tiered audience (indies → SMB → enterprise) | Open-source / free tier seeds adoption from individual devs; org tier monetizes when they pull it into their company | — Pending |
| Two equal first-class views: per-user AND per-project | Engineering managers need both lenses on the same data; a single-view dashboard wouldn't fit either persona alone | — Pending |
| Project name "fennec" — working title | Working name for now; rename gate before public launch / branding | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-31 after initialization*
