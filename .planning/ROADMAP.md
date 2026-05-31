# Roadmap: fennec

## Overview

Fennec ships in six phases that mirror the critical path identified in research: freeze the canonical event schema, prove ingest end-to-end with one adapter on one OS, then fan out adapters and backend analysis in parallel, harden the multi-tenant backend before any dashboard renders cross-tenant data, build the dashboards that are the actual value surface, polish the daemon across Linux + Windows so the "see *everything*" pitch holds, and finally open the public repo with the self-host bundle, license, and managed-cloud signup that turn it into a distributable product. Each phase carries the prevention mechanisms from PITFALLS.md that map to its work (capture-time redaction in Phase 1, multi-tenant isolation drill in Phase 3, attribution-confidence UI in Phase 4, code signing in Phase 5, CVE channel in Phase 6). v1 ships all four capture surfaces (CLI + CLI watch + IDE + browser) with the browser status decided at v1-freeze: GA, submit-and-wait, or honest defer.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundations** - Schema, ingest, daemon skeleton, Claude Code adapter end-to-end on macOS with capture-time redaction + heartbeats wired in
- [ ] **Phase 2: Parallel Adapters + Backend Analysis** - All remaining adapters (Codex, Gemini, Cursor, Copilot, browser, git-watcher) plus correlation/model-fit/aggregator workers
- [ ] **Phase 3: Multi-Tenant Backend Maturity** - Org/membership/invite/API-key surfaces, projectScopeMiddleware + RLS belt-and-suspenders, privacy controls (redaction rules UI, retention, KMS, GDPR deletion)
- [ ] **Phase 4: Dashboards** - Per-user view, per-project view, drill-down, confidence-aware attribution UI, model-fit + outcome-correlation lenses as first-class nav
- [ ] **Phase 5: Cross-Platform Daemon Polish** - Linux systemd, Windows service, EV code-signing, Apple notarisation, `fennec doctor` with proxy/CA diagnostics
- [ ] **Phase 6: Self-Host Distribution + License + Public Repo** - Docker Compose bundle, Apache 2.0 + DCO, managed-cloud signup, Stripe billing, tiered access, CVE notification channel

## Phase Details

### Phase 1: Foundations
**Goal**: A prompt typed in Claude Code on macOS arrives in Supabase via the daemon, with capture-time secret redaction applied, dedupes on retry, survives daemon restart, and emits adapter heartbeats so the dashboard could tell "no AI usage" from "adapter broken."
**Depends on**: Nothing (first phase)
**Requirements**: CAP-01, CAP-02, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, PRIV-01, PRIV-07, AUTH-09, AUTH-10, ING-01, ING-02, ING-03, ING-04, ING-05, ING-06, ANL-06, DAE-01, DAE-02, DAE-05, DAE-10, DAE-11, DAE-12
**Success Criteria** (what must be TRUE):
  1. A prompt typed in Claude Code on macOS produces a row in `ai_events` in Supabase within 5 minutes, via the daemon and its sync loop.
  2. Pasting any of 10 canary secrets (AWS key, GitHub PAT, Bearer token, private key, generic high-entropy string, etc.) into a Claude Code prompt results in zero secret characters reaching the cloud `ai_events` row; the daemon's redactor stamps a `redaction_applied_at` timestamp and version hash on the event.
  3. Killing the daemon mid-flight (`kill -9`) and restarting it loses zero captured events; replaying the same batch is idempotent on the backend (`ON CONFLICT (idempotency_key) DO NOTHING`).
  4. The first-run installer (`fennec wizard` and `fennec init --api-key <k>`) writes Claude Code hook entries into `~/.claude/settings.json` chaining (not overwriting) any existing synapse entries, installs a macOS LaunchAgent, and surfaces a consent screen showing exactly what's captured before any hook fires.
  5. Every adapter emits an `AdapterHeartbeat` event at a fixed cadence including `events_parsed`, `parse_errors`, and a `schema_hash` of the upstream tool's data shape — even when zero events were captured in the interval.
**Plans**: TBD

### Phase 2: Parallel Adapters + Backend Analysis Layer
**Goal**: All four capture surfaces (CLI hooks, CLI transcripts, IDE, browser) capturing in staging plus git events; backend correlation, model-fit, and daily-aggregator workers populating the dashboard-read tables.
**Depends on**: Phase 1
**Requirements**: CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-17, CAP-18, ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-07, ANL-08, ANL-09
**Success Criteria** (what must be TRUE):
  1. On a single macOS dev machine, one prompt in Codex CLI, one in Gemini CLI, one in Cursor, one in Copilot (via the paired VS Code sidecar), one in ChatGPT.com (via the MV3 extension's loopback bridge), and one in Claude.ai (same path) each produce one canonical `ai_events` row tagged with the correct `tool` value within 5 minutes — or the browser surface is explicitly flagged as "submit-and-wait" / "defer" at the v1-freeze decision point with the architecture unchanged.
  2. Commits, reverts, file edits, and branch switches in a watched git repo produce `git_events` rows; the correlation worker joins prompts to nearby git events within a ±N-minute window and writes `prompt_outcomes` rows whose attribution carries a confidence interval (not a bare percentage), with reverts explicitly downgrading attribution rather than silently subtracting from totals.
  3. The model-fit worker scores every captured prompt against the model used and writes a `model_fit_scores` row using rule-based heuristics (length, file-edit size, tool-call count, model tier).
  4. The daily aggregator cron writes `daily_rollups_by_user` and `daily_rollups_by_project` rows; cost is reported with separate "estimated" and "billed" columns, with cache-creation/cache-read tokens accounted separately and subscription products (Copilot, ChatGPT Pro) counted apart from per-token spend; pricing is read from a `model_pricing` table with effective-date ranges, not hardcoded.
  5. `fennec pause` halts capture and `fennec resume` re-enables it; `fennec inspect` shows the developer every event captured locally in the last 24 hours with redactions visible.
**Plans**: TBD

### Phase 3: Multi-Tenant Backend Maturity
**Goal**: A user can sign up, create an org, invite teammates, manage API keys, configure org-specific redaction rules, set data-retention policy, and switch between orgs in the UI — with `projectScopeMiddleware` enforcing membership on every project-scoped route and RLS as a belt-and-suspenders backstop on every customer-data table.
**Depends on**: Phase 2
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-11, AUTH-12, AUTH-13, PRIV-02, PRIV-03, PRIV-04, PRIV-05, PRIV-06
**Success Criteria** (what must be TRUE):
  1. A new user can sign up with email + password, receives an email verification, can reset a forgotten password, stays logged in across browser refresh, and can log out from any page.
  2. An org admin can create an org, invite members by email (the invitee accepts via a join URL), assign admin or member roles, and the same human can belong to multiple orgs and switch between them in the UI; cross-machine daemons reporting under the same API key surface as one user with multiple devices, with an admin-visible "merge users" action for the rare wrong-link case.
  3. A two-org tenant-isolation drill: a member of Org A trying every project-scoped route with Org B's project IDs receives 403 from `projectScopeMiddleware`, and even if the middleware were removed, RLS policies on every customer-data table return zero rows.
  4. An org admin can add custom redaction regexes in the dashboard; the daemon fetches them within 5 minutes and applies them at capture time (rejecting any rule that doesn't compile), per-org data-retention defaults to 30 days SaaS / 90 days self-host with a working configurable override, stored prompts/responses are encrypted at rest with a per-org KMS key (cloud tier), and an admin-issued GDPR Article-17 deletion request purges the affected prompts within a documented SLA.
  5. Per-developer dashboard views default to org-aggregate / anonymised; an admin opt-in is required to enable per-developer breakdowns and that opt-in writes a visible audit trail.
**Plans**: TBD

### Phase 4: Dashboards
**Goal**: An org admin logging into the SvelteKit dashboard can see per-user prompting/cost views, per-project cost-attribution and hotspot views, drill down from any aggregate card to the individual prompts behind it, filter and time-range any view, export it to CSV/JSON, see "adapter offline" banners when a surface stops capturing, and see a visible confidence indicator on every attribution number with a link to the methodology page.
**Depends on**: Phase 3
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DASH-09, DASH-10, DASH-11, DASH-12, DASH-13, DASH-14, DASH-15, DAE-03
**Success Criteria** (what must be TRUE):
  1. An org admin can log into the SvelteKit dashboard and see, for the last 30 days, both a per-user view (token usage over time, cost breakdown, model-mix, prompting patterns, model-fit score, outcome correlation) and a per-project view (total cost, hotspots — files/features burning tokens, cost-per-shipped-PR, cost-per-feature), with events appearing in the dashboard within 5 minutes of capture.
  2. Clicking any aggregate card drills down to the list of prompts that contributed to it, and clicking a single prompt shows the full prompt + response (post-redaction), token counts, model, timing, tool surface, git correlation, and model-fit score; search supports filters by user, project, model, tool surface, time range, and outcome status; the time-range selector covers day / week / month / custom.
  3. Every attribution / per-developer number renders a visible confidence indicator (low / medium / high or interval) without hover, and the per-user view carries a link to a methodology page explaining how attribution is computed, why a low number is not a productivity signal, and which signals contribute.
  4. When an adapter's heartbeat goes quiet for >24 hours, an "adapter offline" banner appears on every view that would have used data from that adapter, clearly distinguishing "no AI usage on this surface" from "we lost visibility into this surface"; `fennec status` prints a one-line health check (daemon up, queue depth, last sync, adapters running, CPU/RAM/disk numbers).
  5. Model-fit-mismatch and outcome-correlation each appear as first-class nav items with their own dedicated views; any view can be exported to CSV or JSON via a single click.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Cross-Platform Daemon Polish
**Goal**: The daemon installs and runs cleanly on Linux (systemd user service) and Windows (Windows service via node-windows or NSSM), the macOS binary is Apple-notarised, the Windows binary is EV-signed, and `fennec doctor` diagnoses corporate-proxy / CA / quarantine / permission issues on all three platforms.
**Depends on**: Phase 4
**Requirements**: DAE-04, DAE-06, DAE-07, DAE-08, DAE-09
**Success Criteria** (what must be TRUE):
  1. On a fresh Ubuntu LTS box, `fennec wizard` installs a systemd user service that starts on login, survives reboot, and reports a heartbeat to the backend within 1 minute.
  2. On a fresh Windows 11 VM with default Microsoft Defender settings, the EV-signed `fennec.exe` installs as a Windows service (via node-windows or NSSM) without quarantine and without the SmartScreen "unidentified developer" block, starts on boot, and reports a heartbeat to the backend within 1 minute.
  3. On macOS, the Apple-notarised binary installs without the Gatekeeper "unidentified developer" dialog on a clean machine, and the LaunchAgent survives reboot.
  4. `fennec doctor` prints actionable diagnostics across all three platforms covering paths, permissions, last events, recent errors, proxy reachability, `NODE_EXTRA_CA_CERTS` / `HTTPS_PROXY` status, and (on Windows) Defender quarantine detection with a fix step.
**Plans**: TBD

### Phase 6: Self-Host Distribution + License + Public Repo
**Goal**: The fennec repository is public on GitHub under Apache 2.0 with DCO sign-off on every commit; a `docker-compose up` brings up the full self-host stack (Postgres + Hono-on-Node or workerd backend + SvelteKit frontend + Caddy reverse proxy) running migrations against bare Postgres; a managed-cloud signup at the public domain works with Stripe billing; CVE notifications reach affected self-hosters via an in-product banner.
**Depends on**: Phase 5
**Requirements**: ING-07, DIST-01, DIST-02, DIST-03, DIST-04, DIST-05, DIST-06, DIST-07, DIST-08, DIST-09, DIST-10, DIST-11, DIST-12
**Success Criteria** (what must be TRUE):
  1. The fennec GitHub repository is public, licensed Apache 2.0, and rejects commits without DCO sign-off; the README + install screen + dashboard footer all surface the license.
  2. A `docker-compose up` on a clean host with no Cloudflare account brings up the full stack — Postgres + backend (Hono-on-Node or workerd with a Postgres-backed Queue abstraction like pgmq / graphile-worker) + frontend + Caddy — runs database migrations against bare Postgres, and accepts events from a `fennec wizard`-pointed daemon within 5 minutes; the self-host docs walk an operator from clone to first captured event.
  3. Self-host telemetry is opt-in (default off) with a payload that's inspectable by the operator before opt-in; a CVE notification channel exists as an in-product banner that pushes to self-hosters running affected versions.
  4. At the public domain, a new user can sign up for managed fennec cloud with email/password (free OSS tier accessible without an account via self-host; paid SaaS tier accessible with a Stripe-managed subscription), and the pricing page surfaces an enterprise tier as a "contact us" stub.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 0/TBD | Not started | - |
| 2. Parallel Adapters + Backend Analysis | 0/TBD | Not started | - |
| 3. Multi-Tenant Backend Maturity | 0/TBD | Not started | - |
| 4. Dashboards | 0/TBD | Not started | - |
| 5. Cross-Platform Daemon Polish | 0/TBD | Not started | - |
| 6. Self-Host Distribution + License + Public Repo | 0/TBD | Not started | - |
