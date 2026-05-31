# Requirements: fennec

**Defined:** 2026-05-31
**Core Value:** Make every AI request in an org observable, attributable, and explainable — answering *who is prompting how*, *where is the money going by project*, and *is the right model being used for each task?*

## v1 Requirements

Requirements for initial release. Each maps to one roadmap phase. Grounded in research synthesis at `.planning/research/SUMMARY.md` and refined by Phase 1's discussion (see `.planning/phases/01-foundations/01-CONTEXT.md` decisions D-27 through D-31).

### Capture (CAP)

The local daemon and adapters that capture AI usage at the source.

- [ ] **CAP-01**: Local capture daemon runs as a single background process per user-machine, hosting all in-process adapters
- [ ] **CAP-02**: Daemon captures Claude Code AI requests via hook entries (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, SubagentStop) written into Claude Code's **managed-settings layer** (system-protected path; not user-settings) by the installer
- [ ] **CAP-03**: Daemon captures Codex CLI sessions via transcript file watcher (synapse-style adapter)
- [ ] **CAP-04**: Daemon captures Gemini CLI sessions via transcript file watcher
- [ ] **CAP-05**: Daemon captures Cursor IDE AI usage by watching Cursor's local SQLite/workspaceStorage
- [ ] **CAP-06**: Daemon captures GitHub Copilot IDE usage via a paired VS Code sidecar extension that reads Copilot's local cache
- [ ] **CAP-07**: Browser extension (Manifest V3) captures ChatGPT.com AI usage and posts events to daemon's loopback bridge
- [ ] **CAP-08**: Browser extension (Manifest V3) captures Claude.ai AI usage and posts events to daemon's loopback bridge
- [ ] **CAP-09**: Daemon captures local git activity (commits, reverts, file edits, branch switches) via a dedicated git-watcher adapter
- [x] **CAP-10**: All adapters emit events conforming to a single canonical `CanonicalEvent` schema defined in `packages/shared/`
- [ ] **CAP-11**: Local queue is append-only and crash-safe (JSONL with explicit rotation; synapse pattern)
- [ ] **CAP-12**: Sync loop batches events (100 per batch or 5-second flush) and POSTs to backend; watermark advances on 2xx, exponential backoff on 5xx
- [x] **CAP-13**: Each event carries a stable `idempotency_key` so the backend can dedupe on retry
- [ ] **CAP-14**: Every adapter emits a periodic heartbeat including `events_parsed` and `parse_errors`, even when zero events captured, so dashboards can tell "no AI usage" apart from "adapter broken"
- [ ] **CAP-15**: Adapters detect schema-hash drift in source-tool data and surface an "adapter offline" status when the upstream format changes
- [ ] **CAP-16**: Daemon survives offline / network blips with no event loss (events stay in local queue until sync succeeds)
- [ ] **CAP-18**: `fennec inspect` shows the user what data was captured locally and where it's being sent (transparency surface; preserved under tamper-resistance posture)

> **Removed:** CAP-17 (`fennec pause`). Phase 1's discussion (D-16) made fennec an uncircumventable observability agent — no user-controlled pause exists. See `01-CONTEXT.md` for the surveillance-perception-tradeoff rationale.

### Privacy & Redaction (PRIV)

Trust-failure prevention. Must ship with capture or it cannot be retrofitted safely.

- [ ] **PRIV-01**: Capture-time secret redaction strips common dev secrets (gitleaks-style default rules: API keys, bearer tokens, private keys, AWS keys, etc.) **before** events leave the user's machine
- [ ] **PRIV-02**: Org admins can configure custom redaction regexes that the daemon fetches and applies at capture time
- [ ] **PRIV-03**: Each org has a data retention setting; defaults are 30 days (SaaS) and 90 days (self-host)
- [ ] **PRIV-04**: Per-org KMS encryption at rest for stored prompts and responses (cloud tier)
- [ ] **PRIV-05**: Documented GDPR Article-17 deletion path; org admin can issue a deletion request that purges prompts within SLA
- [ ] **PRIV-06**: Per-developer dashboards default to org-aggregate / anonymised view; per-developer breakdowns require an explicit admin opt-in with a visible audit trail
- [ ] **PRIV-07**: First-run installer surfaces a consent screen showing exactly what's captured before any hooks are written

### Authentication & Multi-tenancy (AUTH)

- [ ] **AUTH-01**: User can sign up with email + password
- [ ] **AUTH-02**: User receives email verification after signup
- [ ] **AUTH-03**: User can reset password via email link
- [ ] **AUTH-04**: User session persists across browser refresh; user can log out from any page
- [ ] **AUTH-05**: User can create an organization
- [ ] **AUTH-06**: Org admin can invite members via email; invitee accepts via a join URL
- [ ] **AUTH-07**: Org has at least two roles (admin, member); admin manages settings, billing, redaction rules
- [ ] **AUTH-08**: A user can be a member of multiple organizations and switch between them in the UI
- [ ] **AUTH-09**: Org admin can create and revoke API keys used by the daemon
- [ ] **AUTH-10**: Daemon authenticates to backend via `Authorization: Bearer <api-key>`
- [ ] **AUTH-11**: Every project-scoped backend route enforces membership via `projectScopeMiddleware`
- [ ] **AUTH-12**: Every customer-data table enforces RLS as a defense-in-depth backstop (middleware is primary, RLS is belt-and-suspenders)
- [ ] **AUTH-13**: Same user on multiple machines reports under one identity; cross-machine identity merge UI exists for the rare wrong-link edge case
- [ ] **AUTH-14**: Backend exposes `POST /api/daemons/enroll` accepting `{ install_secret, machine_id, hostname }` and returning a per-machine API key (org-tier install secret comes from the MDM payload; personal-tier install secret is self-issued by the first-run wizard)
- [ ] **AUTH-15**: Per-machine API key is stored in a system-protected disk location (root-only readable: `/var/db/fennec/key` macOS, `/var/lib/fennec/key` Linux, `%ProgramData%\fennec\key` Windows)
- [ ] **AUTH-16**: Dev-OAuth attach flow — on first un-attached boot, daemon surfaces a system tray notification, auto-opens the default browser to the SSO flow (Google / GitHub / Microsoft), and binds the resolved user identity to the per-machine API key; events captured before attach are tagged `unknown@${hostname}` and backfilled on first successful attach

### Ingestion (ING)

- [ ] **ING-01**: Backend exposes `POST /api/events/batch` accepting batched `CanonicalEvent` payloads
- [ ] **ING-02**: Ingest dedupes events by `idempotency_key` (writes are upserts, not inserts)
- [ ] **ING-03**: Ingest validates payloads against the shared Zod schema; invalid batches are rejected with 4xx and a clear reason
- [ ] **ING-04**: Ingest is dumb — no correlation or model-fit analysis runs in the hot path; events are enqueued onto a Cloudflare Queue for async workers
- [ ] **ING-05**: `ai_events` table is range-partitioned by month on `occurred_at`
- [ ] **ING-06**: `git_events` table is range-partitioned by month on `occurred_at`
- [ ] **ING-07**: Self-host build runs ingest via Hono-on-Node (or workerd) and a Postgres-backed Queue abstraction (pgmq / graphile-worker) — same code path, deployment-topology variation

### Analysis (ANL)

- [ ] **ANL-01**: Correlation worker (Queue consumer) joins each prompt to nearby git events within a ±N-minute window and produces a `prompt_outcome` row
- [ ] **ANL-02**: Each `prompt_outcome` includes a confidence interval (not a bare percentage)
- [ ] **ANL-03**: Reverts explicitly downgrade attribution rather than silently subtracting from totals
- [ ] **ANL-04**: Model-fit worker (Queue consumer) scores each captured prompt against the model used, using rule-based v1 heuristics (length, file-edit size, tool-call count, model tier)
- [ ] **ANL-05**: Daily aggregator (cron) writes pre-rolled `daily_rollups_by_user` and `daily_rollups_by_project`; frontend reads only rollups, never raw events
- [x] **ANL-06**: Cost calculation captures `cache_creation_input_tokens` and `cache_read_input_tokens` separately (avoids the LiteLLM-style 70%+ miscount bug)
- [ ] **ANL-07**: Cost is reported with separate "estimated" (tokens × current price) and "billed" (vendor-billing-reconciled, where available) columns
- [ ] **ANL-08**: Pricing data lives in a table with effective-date ranges, not hardcoded constants
- [ ] **ANL-09**: Subscription products (Copilot $19/mo, ChatGPT Pro $20/mo) are accounted for separately from per-token spend

### Dashboard (DASH)

- [ ] **DASH-01**: Web dashboard is SvelteKit-served, deployed alongside the backend
- [ ] **DASH-02**: Per-user view shows token usage over time, cost breakdown, model-mix, prompting patterns, model-fit score, outcome correlation
- [ ] **DASH-03**: Per-project view shows total cost, hotspots (files/features burning tokens), cost-per-shipped-PR, cost-per-feature
- [ ] **DASH-04**: Any aggregate card drills down to the list of individual prompts that contributed to it
- [ ] **DASH-05**: Individual prompt drill-down shows full prompt + response (post-redaction), token counts, model, timing, tool surface, git correlation, model-fit score
- [ ] **DASH-06**: Search supports filters: user, project, model, tool surface, time range, outcome status
- [ ] **DASH-07**: Time-range selector supports day / week / month / custom range
- [ ] **DASH-08**: Adapter-offline banner clearly distinguishes "no AI usage" from "we lost visibility into this surface"
- [ ] **DASH-09**: Every attribution / per-developer number has a visible confidence indicator
- [ ] **DASH-10**: Per-user view links to a methodology page explaining how attribution is computed
- [ ] **DASH-11**: CSV export of any dashboard view (for finance / reporting)
- [ ] **DASH-12**: JSON export of any dashboard view (for automation / scripting)
- [ ] **DASH-13**: Dashboard freshness target: events visible within 5 minutes of capture
- [ ] **DASH-14**: Model-fit-mismatch lens is a first-class navigation item with its own dedicated views
- [ ] **DASH-15**: Outcome-correlation lens is a first-class navigation item with its own dedicated views

### Daemon Lifecycle (DAE)

- [ ] **DAE-01**: `fennec wizard` runs an interactive installer (sign-in, capture-mechanism choice per surface, service install) — for personal-tier installs
- [ ] **DAE-02**: `fennec init --install-secret <secret>` runs the same install non-interactively (used by MDM payload execution for org-tier installs)
- [ ] **DAE-03**: `fennec status` prints a one-line health check (daemon up? queue depth? last sync? adapters running?)
- [ ] **DAE-04**: `fennec doctor` runs detailed diagnostics (paths, permissions, last events, recent errors, proxy / CA status, code-sign verification)
- [ ] **DAE-05**: Daemon installs as a macOS **LaunchDaemon** (system-level, root-owned plist at `/Library/LaunchDaemons/dev.fennec.daemon.plist`) — not LaunchAgent
- [ ] **DAE-06**: Daemon installs as a Linux systemd **system unit** (root-owned, `/etc/systemd/system/fennec.service`)
- [ ] **DAE-07**: Daemon installs as a Windows service (node-windows or NSSM), running under the SYSTEM account
- [ ] **DAE-08**: macOS binary + `.pkg` are signed with an Apple Developer ID certificate, notarised via `notarytool`, and stapled
- [ ] **DAE-09**: Windows binary + `.msi` are signed with an EV code-signing certificate (cert procurement + first-signature-for-reputation-warm-up start in Phase 1; actual `.msi` build lands in Phase 5)
- [ ] **DAE-10**: Daemon respects corporate proxy env vars (`NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`)
- [ ] **DAE-11**: Daemon coexists non-interferingly with synapse — fennec hooks live in Claude Code's managed-settings layer (system-protected), synapse hooks live in `~/.claude/settings.json` (user-layer); Claude Code's default additive merge fires both on every event
- [ ] **DAE-12**: Daemon is distributed via a signed macOS `.pkg` (Apple Developer ID + notarisation + stapling) — replaces the prior npm-global distribution path
- [ ] **DAE-13**: Daemon is distributed via a signed Windows `.msi` (EV code-signing cert)
- [ ] **DAE-14**: Daemon is distributed via signed Linux `.deb` (apt repo) and `.rpm` (yum repo) packages
- [ ] **DAE-15**: Daemon is distributed via a Homebrew tap (`brew install fennec`) for macOS and Linuxbrew
- [ ] **DAE-16**: Daemon is distributed via a curl-bash installer script (`curl -fsSL fennec.dev/install.sh | sudo bash`) for unattended installs and headless CI
- [ ] **DAE-17**: Daemon writes Claude Code hook entries to managed-settings layer at install time (`/Library/Application Support/ClaudeCode/managed-settings.json` macOS, `/etc/claude-code/managed-settings.json` Linux, `%ProgramData%\ClaudeCode\managed-settings.json` Windows), root/SYSTEM-owned, user-read-only
- [ ] **DAE-18**: Hook handler is a compiled shim binary at `/usr/local/fennec/bin/fennec-hook` (Windows: `C:\Program Files\fennec\bin\fennec-hook.exe`) that IPCs to the running daemon via loopback bridge (HTTP or Unix socket) with ≤15ms overhead per hook fire; fails open if daemon is unreachable (Claude Code never blocked)
- [ ] **DAE-19**: `fennec uninstall` removes only fennec's entries from managed-settings (surgical, leaves synapse user-settings untouched), requires the org-token in org-tier installs or sudo in personal-tier, and emits an audit event visible to the org admin
- [ ] **DAE-20**: Daemon surfaces a system tray notification when no developer identity is attached after enrollment; the notification persists across reboots until SSO attach completes (see AUTH-16)
- [ ] **DAE-21**: MDM packaging primitives in Phase 1 — the signed `.pkg` accepts an org install secret via a documented config-key schema; polished Jamf Configuration Profile, Intune ADMX, and Workspace ONE manifest templates land in Phase 5

### Distribution (DIST)

- [ ] **DIST-01**: Repository is public on GitHub, licensed Apache 2.0
- [ ] **DIST-02**: Self-host bundle (Docker Compose) runs the full stack locally — backend (Hono-on-Node or workerd) + frontend + Postgres + Caddy reverse proxy
- [ ] **DIST-03**: Database migrations run against bare Postgres (not Supabase-only)
- [ ] **DIST-04**: Self-host docs cover end-to-end setup, including pointing the daemon at the self-hosted backend URL
- [ ] **DIST-05**: Self-host telemetry is opt-in (default off); payload is inspectable by the operator before opt-in
- [ ] **DIST-06**: Managed fennec cloud signup at the public domain with email/password
- [ ] **DIST-07**: SaaS billing integrated via Stripe (per-seat or per-org pricing — TBD at billing-phase)
- [ ] **DIST-08**: Free OSS tier accessible without an account (self-host)
- [ ] **DIST-09**: Paid SaaS tier accessible with an account + paid plan
- [ ] **DIST-10**: Enterprise tier is a "contact us" stub on the pricing page (real SSO / DPA / SOC2 deferred to v1.x)
- [ ] **DIST-11**: CVE notification channel exists (in-product banner to self-hosters running affected versions)
- [ ] **DIST-12**: Contributor sign-off via DCO on every commit

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### AI Recommendations & Coaching

- **REC-01**: Weekly per-user coaching summary email
- **REC-02**: Per-org "wasted spend" report with specific recommendations
- **REC-03**: LLM-as-judge model-fit classifier (replaces v1 heuristic rules)

### Real-time Interventions

- **INT-01**: IDE / CLI nudge when prompt exceeds size or cost threshold
- **INT-02**: "Slimmer prompt" suggestions delivered back to the source tool

### Policy & Governance

- **POL-01**: Spend caps per user / per project / per org
- **POL-02**: Model-tier policies (e.g., "no Opus for files <100 lines")
- **POL-03**: Block / warn on policy violation

### Enterprise

- **ENT-01**: SSO (SAML / OIDC)
- **ENT-02**: SOC2 Type II compliance
- **ENT-03**: Signed DPA template
- **ENT-04**: HIPAA BAA path for healthcare orgs
- **ENT-05**: Customer KMS / BYOK encryption
- **ENT-06**: Audit logs for org admin actions

### SCM Integration

- **SCM-01**: GitHub App integration (org-level PR / commit / revert / incident data)
- **SCM-02**: GitLab App integration

### Additional Surfaces

- **SURF-01**: Aider adapter
- **SURF-02**: Continue.dev adapter
- **SURF-03**: Windsurf adapter
- **SURF-04**: JetBrains AI Assistant adapter
- **SURF-05**: CI/CD AI usage capture
- **SURF-06**: Agent-platform usage (Devin, Cognition, etc.)
- **SURF-07**: Mobile capture (investigate demand first)

### Notifications & Integrations

- **NOTI-01**: Slack / Teams cost-digest webhooks
- **NOTI-02**: Cost-anomaly alerts (Slack / email / webhook)
- **NOTI-03**: Generic webhook fan-out for events

### Advanced Analytics

- **ADV-01**: LLM-as-judge model-fit classifier
- **ADV-02**: Per-PR / per-feature attribution
- **ADV-03**: Custom analytics queries via SQL or visual builder

## Out of Scope

Explicitly excluded from v1 and v2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| App-side LLM observability (wrap-your-own-code SDK) | Helicone / Langfuse / LangSmith own this slice; fennec is for vendor-tool capture, not wrap-your-own-code observability |
| MCP tool surface for AI assistants to consume insights | Synapse owns the "context layer for AI" surface; fennec's product is a human-facing dashboard, not an AI memory layer |
| User-controlled pause / disable of the capture daemon | Phase 1 D-16: tamper-resistance is core to the product value (org-property observability). Transparency is delivered via `fennec inspect` (CAP-18), not via pause |
| Surveillance / employee-monitoring positioning | Adoption-killer; product is observability-for-cost, not behaviour-tracking. (NOTE: Phase 1's D-03 knowingly weakens this stance; revisit at milestone close.) |
| Screen-recording or keystroke-level capture | Privacy-hostile; out of scope on principle |
| Per-developer performance-review export | Active misuse risk (PITFALLS Pitfall 6) — UI actively makes this hard, not easy |
| Real-time block-the-AI-call at the network layer | Governance / firewall product, not observability — overlaps with corporate AI gateways |
| Multi-region cloud / data residency selectors at v1 | Belongs in the enterprise tier; v1 cloud is one region |
| Mobile-side AI app capture (e.g., Claude iOS) | Out of scope until clear customer pull; iOS sandboxing makes daemon capture infeasible |
| npm-global as a user-facing install path | Replaced by signed installers — see DAE-12 through DAE-16. Phase 1 D-04 reframed fennec as a signed system agent, not a Node-flavoured CLI tool. (Contributor / dev mode via npm scripts is still supported for working on fennec itself; not for end-users.) |

## Traceability

Mapped 2026-05-31. Updated to reflect Phase 1 discussion decisions D-27 through D-31. Every v1 REQ-ID maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAP-01 | Phase 1 | Pending |
| CAP-02 | Phase 1 | Pending |
| CAP-03 | Phase 2 | Pending |
| CAP-04 | Phase 2 | Pending |
| CAP-05 | Phase 2 | Pending |
| CAP-06 | Phase 2 | Pending |
| CAP-07 | Phase 2 | Pending |
| CAP-08 | Phase 2 | Pending |
| CAP-09 | Phase 2 | Pending |
| CAP-10 | Phase 1 | Complete |
| CAP-11 | Phase 1 | Pending |
| CAP-12 | Phase 1 | Pending |
| CAP-13 | Phase 1 | Complete |
| CAP-14 | Phase 1 | Pending |
| CAP-15 | Phase 1 | Pending |
| CAP-16 | Phase 1 | Pending |
| CAP-18 | Phase 2 | Pending |
| PRIV-01 | Phase 1 | Pending |
| PRIV-02 | Phase 3 | Pending |
| PRIV-03 | Phase 3 | Pending |
| PRIV-04 | Phase 3 | Pending |
| PRIV-05 | Phase 3 | Pending |
| PRIV-06 | Phase 3 | Pending |
| PRIV-07 | Phase 1 | Pending |
| AUTH-01 | Phase 3 | Pending |
| AUTH-02 | Phase 3 | Pending |
| AUTH-03 | Phase 3 | Pending |
| AUTH-04 | Phase 3 | Pending |
| AUTH-05 | Phase 3 | Pending |
| AUTH-06 | Phase 3 | Pending |
| AUTH-07 | Phase 3 | Pending |
| AUTH-08 | Phase 3 | Pending |
| AUTH-09 | Phase 1 | Pending |
| AUTH-10 | Phase 1 | Pending |
| AUTH-11 | Phase 3 | Pending |
| AUTH-12 | Phase 3 | Pending |
| AUTH-13 | Phase 3 | Pending |
| AUTH-14 | Phase 1 | Pending |
| AUTH-15 | Phase 1 | Pending |
| AUTH-16 | Phase 1 | Pending |
| ING-01 | Phase 1 | Pending |
| ING-02 | Phase 1 | Pending |
| ING-03 | Phase 1 | Pending |
| ING-04 | Phase 1 | Pending |
| ING-05 | Phase 1 | Pending |
| ING-06 | Phase 1 | Pending |
| ING-07 | Phase 6 | Pending |
| ANL-01 | Phase 2 | Pending |
| ANL-02 | Phase 2 | Pending |
| ANL-03 | Phase 2 | Pending |
| ANL-04 | Phase 2 | Pending |
| ANL-05 | Phase 2 | Pending |
| ANL-06 | Phase 1 | Complete |
| ANL-07 | Phase 2 | Pending |
| ANL-08 | Phase 2 | Pending |
| ANL-09 | Phase 2 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DASH-05 | Phase 4 | Pending |
| DASH-06 | Phase 4 | Pending |
| DASH-07 | Phase 4 | Pending |
| DASH-08 | Phase 4 | Pending |
| DASH-09 | Phase 4 | Pending |
| DASH-10 | Phase 4 | Pending |
| DASH-11 | Phase 4 | Pending |
| DASH-12 | Phase 4 | Pending |
| DASH-13 | Phase 4 | Pending |
| DASH-14 | Phase 4 | Pending |
| DASH-15 | Phase 4 | Pending |
| DAE-01 | Phase 1 | Pending |
| DAE-02 | Phase 1 | Pending |
| DAE-03 | Phase 4 | Pending |
| DAE-04 | Phase 5 | Pending |
| DAE-05 | Phase 1 | Pending |
| DAE-06 | Phase 5 | Pending |
| DAE-07 | Phase 5 | Pending |
| DAE-08 | Phase 1 | Pending |
| DAE-09 | Phase 1 | Pending |
| DAE-10 | Phase 1 | Pending |
| DAE-11 | Phase 1 | Pending |
| DAE-12 | Phase 1 | Pending |
| DAE-13 | Phase 5 | Pending |
| DAE-14 | Phase 5 | Pending |
| DAE-15 | Phase 5 | Pending |
| DAE-16 | Phase 5 | Pending |
| DAE-17 | Phase 1 | Pending |
| DAE-18 | Phase 1 | Pending |
| DAE-19 | Phase 1 | Pending |
| DAE-20 | Phase 1 | Pending |
| DAE-21 | Phase 1 | Pending |
| DIST-01 | Phase 6 | Pending |
| DIST-02 | Phase 6 | Pending |
| DIST-03 | Phase 6 | Pending |
| DIST-04 | Phase 6 | Pending |
| DIST-05 | Phase 6 | Pending |
| DIST-06 | Phase 6 | Pending |
| DIST-07 | Phase 6 | Pending |
| DIST-08 | Phase 6 | Pending |
| DIST-09 | Phase 6 | Pending |
| DIST-10 | Phase 6 | Pending |
| DIST-11 | Phase 6 | Pending |
| DIST-12 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 104
- Mapped to phases: 104 (100%)
- Unmapped: 0
- Removed since first draft: CAP-17 (`fennec pause` — D-16 / D-27)
- Added since first draft: AUTH-14, AUTH-15, AUTH-16, DAE-13, DAE-14, DAE-15, DAE-16, DAE-17, DAE-18, DAE-19, DAE-20, DAE-21 (+12 new — D-30)
- Moved since first draft: DAE-08 (Phase 5 → Phase 1), DAE-09 (Phase 5 → Phase 1) (D-29)

**Per-phase counts:**
- Phase 1 (Foundations): **36** — CAP-01, CAP-02, CAP-10..16, PRIV-01, PRIV-07, AUTH-09, AUTH-10, AUTH-14, AUTH-15, AUTH-16, ING-01..06, ANL-06, DAE-01, DAE-02, DAE-05, DAE-08, DAE-09, DAE-10, DAE-11, DAE-12, DAE-17, DAE-18, DAE-19, DAE-20, DAE-21
- Phase 2 (Parallel Adapters + Backend Analysis): **16** — CAP-03..09, CAP-18, ANL-01..05, ANL-07, ANL-08, ANL-09
- Phase 3 (Multi-Tenant Backend Maturity): **16** — AUTH-01..08, AUTH-11..13, PRIV-02..06
- Phase 4 (Dashboards): **16** — DASH-01..15, DAE-03
- Phase 5 (Cross-Platform Daemon Polish): **7** — DAE-04, DAE-06, DAE-07, DAE-13, DAE-14, DAE-15, DAE-16
- Phase 6 (Self-Host Distribution + License + Public Repo): **13** — ING-07, DIST-01..12

Sum: 36 + 16 + 16 + 16 + 7 + 13 = **104 ✓**

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-05-31 — applied Phase 1 discussion decisions D-27 through D-31*
