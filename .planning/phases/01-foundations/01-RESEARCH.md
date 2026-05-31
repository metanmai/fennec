# Phase 1: Foundations - Research

**Researched:** 2026-05-31
**Domain:** Multi-tier observability agent — canonical event schema in shared package, append-only JSONL capture daemon as macOS LaunchDaemon, signed `.pkg` distribution with Apple notarisation, Cloudflare Workers + Hono ingest, Supabase Postgres multi-tenant schema, Claude Code hook capture via managed-settings, daemon enrollment + dev-OAuth attach flow, capture-time secret redaction, Windows EV cert procurement clock-start
**Confidence:** HIGH for the synapse-validated patterns (daemon lifecycle, JSONL queue, sync loop, Hono ingest, Supabase RLS) and the Claude Code managed-settings + hooks contract; HIGH for Apple `.pkg` signing pipeline; **MEDIUM** for Windows EV cert reputation warm-up (Microsoft changed SmartScreen behaviour in March 2024 — the "EV gives instant reputation" assumption is stale; warm-up clock still starts at first signature but no longer guarantees instant SmartScreen acceptance); **MEDIUM** for LaunchDaemon GUI surfacing on first-run attach (a root daemon cannot drive osascript notifications directly — needs a paired LaunchAgent or `launchctl asuser` shim); **MEDIUM** for the canonical-event token-shape (Anthropic SDK and OTel spec disagree on whether `input_tokens` already includes cache tokens — see Assumption A2).

## Summary

Phase 1 is the longest serial critical path in the milestone. It freezes the canonical event schema, builds the daemon skeleton (LaunchDaemon + JSONL queue + sync loop + Claude Code hook adapter), the Hono ingest endpoint with Supabase upsert-by-`idempotency_key`, the daemon-enrollment endpoint, the dev-OAuth attach flow, capture-time secret redaction, and the signed `.pkg` distribution + Windows EV cert procurement. The smoke proof is a Claude Code prompt arriving as a row in `ai_events` via the daemon within 5 minutes, with redaction applied, dedupe on retry, and survival across daemon restart.

The synapse codebase is the load-bearing existence proof for nearly every component except (1) the managed-settings hook installation, (2) the signed-installer distribution pipeline, (3) the daemon-enrollment + OAuth attach flow, (4) MDM config-key plumbing, and (5) the LaunchDaemon (system-level) variant of synapse's LaunchAgent (user-level). All five are net-new for fennec.

Three findings reshape Phase 1 in ways the orchestrator and planner must internalize:

1. **Claude Code managed-settings DOES support hooks** [VERIFIED: code.claude.com/docs/en/settings] — D-19's foundational assumption holds; no fallback to filesystem-watch on user-settings is needed. Managed settings have final precedence over user/project; hook arrays merge additively across layers (matching D-20's synapse-coexistence guarantee).
2. **Windows EV cert no longer provides instant SmartScreen reputation** [VERIFIED: Microsoft policy change March 2024] — the "30-day warm-up clock" assumption in D-05 / Pitfall 12 is partially stale: the clock still starts at first signature and reputation is still earned over downloads/usage, but EV no longer bypasses warnings immediately. Phase 1 should still procure the cert to start the clock, but verification criteria 2 in ROADMAP Phase 1 should be relaxed from "warm-up complete" to "cert procured + first signed artefact + signtool verification" — full SmartScreen acceptance is a downstream Phase 5 problem.
3. **A macOS LaunchDaemon running as root cannot surface GUI notifications directly** [VERIFIED: Apple developer.apple.com/library/.../launchd] — D-14's tray-notification design needs a paired helper LaunchAgent (running in the logged-in user's session) OR a `launchctl asuser <uid> osascript ...` invocation. The cleanest pattern is: LaunchDaemon does all capture and IPC work; a tiny separate LaunchAgent surfaces notifications and OAuth-browser-opening on behalf of the user. This adds one component to Phase 1 (a notifier LaunchAgent), but it's small and isolated.

**Primary recommendation:** Adopt the synapse stack wholesale, write hooks to managed-settings (system-level), pair the LaunchDaemon with a notifier LaunchAgent for user-facing UX, build the shim in Go for cross-compile simplicity + small binary + signing toolchain maturity, ship the JSONL queue + per-event redaction unchanged from synapse, write the canonical event schema as `packages/shared/` with a discriminated-union payload, and procure the Apple Developer Program ($99/yr) and Windows EV cert ($300-500/yr) in week 1 of Phase 1.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Product Posture (cross-cutting, sets the tone for every Phase 1 mechanic)**

- **D-01: fennec is an org-property observability agent, not a developer telemetry tool.** Posture is CrowdStrike-style: system-managed, transparent (`fennec inspect` survives), but uncircumventable (`fennec pause` is gone). This is a deliberate departure from PROJECT.md's surveillance-perception mitigation stance.
- **D-02: Tamper-resistance is always-on, with an admin escape hatch.** Every install — including indie / personal use — is system-level. In personal mode the local user is the admin of their single-member org and can sudo their way to uninstall. In org mode the org admin holds the keys and the dev cannot kill the daemon without IT.
- **D-03: Knowingly walks away from PITFALLS Pitfall 8 (developer surveillance perception is the adoption killer).** The product compensates for this risk via transparency (`fennec inspect`) and default org-aggregate dashboard views (PRIV-06, already in Phase 3 scope), but the team accepts that some bottom-up adoption motion is sacrificed in exchange for the stronger governance / cost-visibility story to engineering leadership. **Flag for re-evaluation at every milestone close.**

**Distribution (Phase 1 critical-path impact)**

- **D-04: v1 distribution is signed installers ONLY. No `npm install -g fennec` as a user-facing path.**
  - macOS: signed `.pkg` (Apple Developer ID) + Apple notarisation + stapling
  - Windows: signed `.msi` (EV code-signing cert)
  - Linux: signed `.deb` and `.rpm` (apt + yum repos)
  - Cross-platform: Homebrew tap (`brew install fennec`) + curl-bash installer (`curl -fsSL fennec.dev/install.sh | sudo bash`)
- **D-05: Code-signing scope moves from Phase 5 polish to Phase 1 critical-path.** Phase 1 must ship Apple-notarised macOS binary. Windows EV-cert acquisition and `.msi` signing pipeline must also be set up in Phase 1 (even though the Windows daemon itself stays in Phase 5), because the certificate-reputation warm-up clock (~30 days) starts at first signature. Buy the EV cert in Phase 1.
- **D-06: Synapse's `npm install -g fennec` pattern is explicitly NOT followed.** Fennec is a signed system agent like Tailscale / 1Password CLI / Datadog Agent, not a Node-flavoured CLI tool.

**Install Actor (org-tier path)**

- **D-07: Org-tier install at v1 is MDM-only.** Jamf / Intune / Workspace ONE deployment is the sole org path. No admin-elevated `fennec install --org-token <t>` CLI fallback ships at v1. This is aggressive and slows the first sale (IT approval gate), but commits to the strongest tamper-resistance story.
- **D-08: MDM-deployable artefacts in v1 scope:** signed `.pkg` with macOS Configuration Profile schema; signed `.msi` with Intune ADMX template; `.deb` with optional pre-seeded config; the install secret is delivered via the MDM payload (e.g., a `org_install_secret` key in the configuration profile).
- **D-09: Phase 1 ships MDM-PRIMITIVES not full MDM-templates.** The signed `.pkg` and a JSON config-schema spec land in Phase 1; the polished Jamf / Intune ADMX manifests land in Phase 5 (cross-platform polish). Phase 1 proves the install-with-secret mechanism is correct; Phase 5 polishes for actual IT-team rollout.

**Personal / Indie Install Path**

- **D-10: Indie install uses the SAME signed artefacts as MDM.** No separate codepath. Indie devs run a signed `.pkg` / `.msi` / `.deb`, brew, or curl-bash; the first-run wizard handles a "personal mode" flow that auto-creates a single-member org with the local user as admin and trades a self-issued install secret for a per-machine API key. Code path is identical to org enrollment; the only difference is **where** the install secret comes from (MDM payload vs self-issued by the wizard).

**Daemon Identity**

- **D-11: Hybrid identity model.** Daemon enrolls via `POST /api/daemons/enroll { install_secret, machine_id, hostname }` and trades the org install secret for a per-machine API key. THEN the human identity attaches via dev-OAuth (Google / GitHub / Microsoft SSO).
- **D-12: Both org and individual are first-class.** Events are tagged `org_id` (always present after enrollment) and `user_id` (present after dev-OAuth attach; tagged `unknown@${hostname}` until attach happens; backfilled on first attach within the org).
- **D-13: API keys are per-machine, not per-user.** A user with three machines has three per-machine API keys; cross-machine identity merge happens server-side at user_id resolution time, not at the daemon. (Aligns with research synthesis and PITFALLS Pitfall 11.)

**Dev-OAuth Attach UX**

- **D-14: Browser auto-open + tray notification.** On first boot after MDM-install, the daemon detects no dev-identity attached, surfaces a macOS / Windows / Linux system notification ("Sign in to fennec to attribute your AI usage"), and auto-opens the default browser to the SSO flow. The notification persists across reboots until attached.
- **D-15: Until dev signs in, events are still captured.** Pre-attach events are stored with `user_id = unknown@${hostname}`; on first successful SSO attach, the backend backfills the `user_id` for all `unknown@${hostname}` events for that machine within the org. Backfill is one-shot per machine.

**Tamper-Resistance / Capture Continuity**

- **D-16: `fennec pause` (CAP-17) is REMOVED.** Daemon runs always. There is no user-controlled pause mechanism. Tradeoff: the strongest tamper-resistance story; cost: cannot offer a "private moment" mode and the PITFALLS P8 surveillance-perception mitigation surface shrinks meaningfully.
- **D-17: `fennec inspect` (CAP-18) is KEPT.** Dev can see exactly what was captured locally in the last 24 hours, with redactions visible. Transparency without dev-agency. Stays in Phase 2 (its current roadmap home).
- **D-18: Daemon uninstall requires the org-token in org-tier, sudo in personal-tier.** Uninstall via MDM-revoke is the supported org path; a manual `sudo fennec uninstall --org-token <t>` exists for break-glass. Each uninstall emits an audit event the org admin sees in the eventual dashboard (Phase 4).

**Hook Installation (Claude Code, Phase 1 specific)**

- **D-19: Fennec's Claude Code hook entries live in Claude Code's MANAGED-SETTINGS layer, not user-settings.**
  - macOS: `/Library/Application Support/ClaudeCode/managed-settings.json` (root-owned, mode 644)
  - Linux: `/etc/claude-code/managed-settings.json` (root-owned)
  - Windows: `%ProgramData%\ClaudeCode\managed-settings.json` (SYSTEM-owned)
  - User cannot edit these without sudo / admin. Tamper-resistant by filesystem ACL.
- **D-20: Synapse coexistence is non-interfering.** Synapse continues to write its hooks into `~/.claude/settings.json` (user-layer). Fennec writes to managed-settings (system-layer). Claude Code's default hook-merge semantics fire BOTH on every event (additive merge across layers). Neither tool needs to know about the other.
- **D-21: Hook handler is a tiny shim that IPCs the running daemon.**
  - Shim path: `/usr/local/fennec/bin/fennec-hook` (macOS / Linux), `C:\Program Files\fennec\bin\fennec-hook.exe` (Windows)
  - Shim responsibility: read hook payload from stdin, POST to daemon's loopback bridge (HTTP `127.0.0.1:<port>` OR Unix socket — planner's call), exit non-blocking. Target overhead: ≤15ms per hook fire.
  - Daemon does all parsing, redaction, queueing, sync. Shim has no dependencies, no Node runtime, no config.
- **D-22: Hook entries handled by fennec at Phase 1:** all six Claude Code hooks Anthropic exposes — `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `SessionEnd`, `SubagentStop` — match synapse's surface. Fennec uses the same set so the captured-event volume is comparable.
- **D-23: Daemon-down failure mode is fail-open for Claude Code.** If the daemon process is dead when the shim fires, the shim exits 0 silently within its budget; Claude Code's user-facing flow is never blocked or delayed by fennec being down. The daemon's own watchdog handles restart; lost-during-downtime events are noted in the next adapter heartbeat (parse_errors > 0 with a "daemon-unreachable" reason).
- **D-24: Uninstall surgery is targeted.** Fennec uninstall removes only fennec's entries from managed-settings.json (leaves the file structure intact, removes the file if it becomes empty), never touches `~/.claude/settings.json`. Synapse keeps working without intervention.

**Phase 1 Multi-Tenant Bootstrap**

- **D-25: Phase 1 does NOT build the full org / membership UX (that's Phase 3).** Phase 1 ships:
  - Database schema with `orgs`, `users`, `api_keys`, `projects`, `org_members`, `ai_events`, `adapter_heartbeats` tables
  - A SQL seed script that creates one test org + one test user + one test API key for the Phase 1 smoke test
  - The enrollment endpoint (`POST /api/daemons/enroll`) — minimal version that accepts an install secret and returns an API key
  - **No** sign-up UI, **no** invite flow, **no** dashboard, **no** API-key management UI — those are Phase 3
- **D-26: All Phase 1 schema is multi-tenant-correct from day 1.** Every customer-data row carries `org_id`. RLS policies are written even though only one tenant exists in Phase 1. Mandatory: this cannot be retrofitted without painful migrations.

**Cross-Phase Scope Impact (requires REQUIREMENTS.md + ROADMAP.md edits — already applied per D-27..D-31)**

REQUIREMENTS.md and ROADMAP.md have been updated to reflect D-27 through D-31; the 36-requirement Phase 1 list is authoritative.

### Claude's Discretion

The planner / researcher has flexibility on:
- Loopback IPC mechanism between hook shim and daemon: HTTP vs Unix socket vs named pipe (Windows). Lean toward Unix socket on macOS/Linux for permission-scoped access; named pipe on Windows. HTTP is acceptable if simpler. Document the choice and security model.
- Local queue durability mechanism: append-only JSONL with rotation per synapse pattern is the default; switching to SQLite WAL is acceptable if the planner can justify it. Either way, crash-safety + replay-on-restart is the bar.
- `org_install_secret` rotation: how often, how surfaced, who can rotate. v1 acceptable answer = "rotated only on org-admin request via support; no auto-rotation"; v1.x adds self-service rotation.
- Where the per-machine API key lives on disk: must be system-protected (root-only readable). Candidate paths: `/var/db/fennec/key` (macOS), `/var/lib/fennec/key` (Linux), `%ProgramData%\fennec\key` (Windows). Planner to confirm against platform conventions and code-signing requirements.
- Schema-hash drift detection mechanism (CAP-15): the exact hash input (field-name set? payload-shape fingerprint? sample-based?) is a planner choice; the requirement is just that it detects upstream changes and surfaces "adapter offline" status.
- Canonical event schema field names, exact token-shape (Anthropic Usage object vs flatter), and `idempotency_key` derivation — all delegated to researcher / planner with the constraint that ANL-06 (cache_creation_input_tokens + cache_read_input_tokens captured separately) must be honoured.
- Secret-redaction default rule set (gitleaks default ~150 patterns vs hand-picked) — delegated to researcher / planner with the constraint that capture-time redaction MUST ship in Phase 1 and PRIV-01 must pass canary-secret testing.

### Deferred Ideas (OUT OF SCOPE)

- **Loopback secret + handshake between hook shim and daemon (security):** preventing a malicious local process from posting fake events to the daemon's loopback bridge. The shim and daemon share a per-install secret; the daemon verifies it on every request. Mechanic-level detail for the planner; flagged here so it doesn't get dropped.
- **`fennec inspect` UX details:** CAP-18 is kept (Phase 2 home) but the exact CLI surface — what filters, what timeframe, what redaction-visibility levels — should be designed when Phase 2 plans CAP-18 specifically. Not for Phase 1.
- **MDM-package polish (Jamf config profile + Intune ADMX templates):** Phase 1 ships the primitives (`.pkg`, `.msi`, config-key schema); Phase 5 polishes for actual IT-team rollout per D-09. Don't pull these into Phase 1.
- **`org_install_secret` rotation / revocation UI:** v1 acceptable answer is "support-only rotation"; self-service rotation is v1.x.
- **`fennec doctor` design:** DAE-04 is currently in Phase 5. Some Phase-5 doctor checks (proxy reachability, CA status) may also be valuable in Phase 1 for the first-run wizard to validate. Surface to planner; OK to defer if Phase 1 is already tight.
- **Auto-update mechanism (security boundary):** out of Phase 1; surface as a Phase 6 distribution-tier concern (D-31 covers cross-phase scope impact but auto-update is genuinely deferred).
- **Per-developer "I'd like to opt out" sales conversation script:** the surveillance-perception tradeoff (D-03) needs sales / customer-success messaging support eventually. Out of Phase 1; flag for the Phase 6 launch-prep phase or whichever phase owns sales enablement.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **GSD workflow enforced:** All file changes must go through a GSD command (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`). Plans for this phase must reflect this — no direct repo edits outside the workflow.
- **TypeScript end-to-end** across daemon, backend, frontend, packages/shared. Synapse uses `npm` workspaces; CLAUDE.md's pinned stack (lines 10-17) is the binding constraint.
- **Synapse coexistence:** plans must not break Synapse hooks at `~/.claude/settings.json`. Fennec writes only to managed-settings.
- **Synapse search / save_insight protocol** is for development/dev-ops, not a runtime fennec product feature. The user has Synapse for cross-session context; the assistant should respect that protocol in development but it's orthogonal to Phase 1's deliverable.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-01 | Single daemon process per machine, hosts all in-process adapters | Standard Stack §Daemon, Architecture §Pattern 2 (Adapter interface), synapse `os-service.ts` (validated) |
| CAP-02 | Capture Claude Code hooks via managed-settings layer (system path) | Verified: Claude Code managed-settings supports hooks [CITED: code.claude.com/docs/en/settings]; Hook installation §Pattern 7 below |
| CAP-10 | All adapters emit conforming to `CanonicalEvent` in `packages/shared/` | Standard Stack §Shared Schema; Code Examples §Canonical Schema |
| CAP-11 | Local queue append-only, crash-safe (JSONL) | Synapse `events-log.ts` pattern; Architecture §Pattern 1 |
| CAP-12 | Sync loop batches 100/5s, watermark advances on 2xx, exp backoff on 5xx | Synapse `cloud-sync.ts` / `daemon.ts` pattern; Code Examples §Sync Loop |
| CAP-13 | Stable `idempotency_key` per event | Canonical Schema field + derivation strategy below |
| CAP-14 | Heartbeats with `events_parsed` + `parse_errors`, even at zero | Architecture §Pattern 3 (Adapter heartbeats); AdapterHeartbeat schema |
| CAP-15 | Schema-hash drift → "adapter offline" status | Heartbeat carries schema_hash; planner picks hash input (Discretion area) |
| CAP-16 | Survives offline / network blips, no event loss | JSONL append-only + watermark = lossless replay |
| PRIV-01 | Capture-time secret redaction (gitleaks-style defaults) | Gitleaks ~150 patterns embeddable; Code Examples §Redaction |
| PRIV-07 | First-run consent screen before any hook fires | First-run wizard: CLI text + privacy policy URL; `fennec init` shows before installing hooks |
| AUTH-09 | Org admin creates/revokes API keys (daemon-use) | Phase 1 minimal: SQL seed creates one key; full UX in Phase 3 |
| AUTH-10 | Daemon authenticates via `Authorization: Bearer <api-key>` | Hono Bearer Auth middleware; Code Examples §Backend Auth |
| AUTH-14 | `POST /api/daemons/enroll` accepts install_secret, returns API key | Code Examples §Enrollment Endpoint |
| AUTH-15 | Per-machine API key stored at root-only path | macOS `/var/db/fennec/key` mode 0400 — pattern below |
| AUTH-16 | Dev-OAuth attach: notification + browser auto-open + backfill | OAuth 2.0 PKCE loopback redirect (RFC 8252); helper LaunchAgent for notifications |
| ING-01 | `POST /api/events/batch` accepts batched CanonicalEvent | Hono route + Zod validator; Code Examples §Ingest |
| ING-02 | Dedupe by `idempotency_key` (upserts not inserts) | Postgres `ON CONFLICT (idempotency_key) DO NOTHING` |
| ING-03 | Zod validation rejects invalid batches 4xx | `zValidator('json', BatchSchema)` |
| ING-04 | Ingest is dumb — no correlation in hot path | Phase 1 has no correlation worker; enqueue to Queue is Phase 2 wiring |
| ING-05 | `ai_events` range-partitioned by month on `occurred_at` | Postgres declarative partitioning; Supabase blog dynamic-partitioning pattern |
| ING-06 | `git_events` range-partitioned by month on `occurred_at` | Same pattern as ING-05; table-creation only in Phase 1 (no rows yet) |
| ANL-06 | Capture `cache_creation_input_tokens` + `cache_read_input_tokens` separately | Hard constraint; captured in payload from Anthropic Usage object — see Assumption A2 for input_tokens semantics |
| DAE-01 | `fennec wizard` interactive installer | Personal-tier path; `@clack/prompts` (synapse pattern) |
| DAE-02 | `fennec init --install-secret <secret>` non-interactive | MDM-payload-driven path; same code as wizard |
| DAE-05 | Daemon installs as macOS **LaunchDaemon** (root, system-level) | LaunchDaemon plist template — see Code Examples; differs from synapse's LaunchAgent |
| DAE-08 | macOS binary + `.pkg` signed Apple Developer ID + notarised + stapled | productbuild + productsign + notarytool + stapler — see Code Examples §Signing Pipeline |
| DAE-09 | Windows EV cert procured + first signature for warm-up start | Buy cert, sign a stub artefact; full `.msi` is Phase 5 |
| DAE-10 | Honor corporate proxy (`NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`) | Node honors these natively; just don't override |
| DAE-11 | Coexist with synapse non-interferingly (managed-settings vs user-settings) | Verified merge behavior [CITED: code.claude.com docs] |
| DAE-12 | Distributed as signed `.pkg` (replaces npm-global) | Code Examples §Signing Pipeline; payload: binaries + LaunchDaemon plist + postinstall script |
| DAE-17 | Hook entries written to managed-settings at install time, root-owned, user-read-only | postinstall script writes the JSON; chmod 644, chown root |
| DAE-18 | Compiled shim binary at `/usr/local/fennec/bin/fennec-hook`, ≤15ms, fail-open | Go binary, ~2MB; Code Examples §Hook Shim |
| DAE-19 | `fennec uninstall` surgical removal + audit event | JSON edit of managed-settings.json (remove fennec entries only) + audit POST |
| DAE-20 | Tray notification on un-attached state, persists until attach | Helper LaunchAgent + `osascript display notification` |
| DAE-21 | MDM packaging primitives: signed `.pkg` accepts config-key schema | Configuration Profile payload — install_secret as custom-defined key |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Canonical event schema definition | Shared package (`packages/shared`) | — | Daemon + backend both consume; single source of truth prevents wire-format drift |
| Hook capture from Claude Code | OS-level (managed-settings) → shim binary → daemon (LaunchDaemon) | — | Hook entries are filesystem-installed; shim is OS-process; daemon is system service |
| Hook handler shim (read stdin, IPC daemon) | OS-level executable (compiled shim) | — | Cannot be Node because Node startup ≥150ms; must be ≤15ms |
| Loopback IPC bridge (shim ↔ daemon) | Daemon (HTTP server bound to 127.0.0.1) | — | Daemon owns the listener; shim is short-lived client |
| Event redaction (capture-time) | Daemon (in-process before queue write) | — | Defense-in-depth requires raw never leaves machine |
| Local JSONL queue + rotation | Daemon (filesystem on local disk) | — | Survives daemon restart; offline-tolerant |
| Sync loop (queue → backend) | Daemon (timer + watermark) | — | Backend never connects to daemon |
| Adapter heartbeats | Daemon (timer) → Backend (storage) | — | Daemon emits, backend stores |
| Daemon enrollment | Backend (Hono Worker) | Database (Supabase) | API endpoint validates install_secret, generates API key, persists |
| Per-machine API key storage | Filesystem (`/var/db/fennec/key`, mode 0400, root-owned) | — | System-protected on local disk; only daemon (running as root) can read |
| Dev-OAuth attach UX | Browser (OAuth provider) + Helper LaunchAgent (notifications) + Daemon (loopback OAuth callback) | Backend (SSO endpoint) | Daemon CANNOT show GUI (root, no window server); needs LaunchAgent helper |
| Ingest endpoint (`POST /api/events/batch`) | Backend (Hono Worker) | Database (Supabase via Hyperdrive) | Stateless edge; upsert + (later) enqueue |
| Multi-tenant data isolation | Database (RLS policies) + Backend (middleware enforcement) | — | Belt-and-suspenders — RLS as backstop, middleware as primary |
| Range partitioning of events tables | Database (Supabase Postgres) | — | Declarative `PARTITION BY RANGE`, monthly subtables |
| Apple notarisation pipeline | CI / dev machine (notarytool) → Apple notary service | — | One-shot per release artefact; cached in keychain profile |
| Windows EV cert procurement + signing | External CA (DigiCert/Sectigo) + dev machine (signtool) | — | One-time procurement; sign on each release |
| LaunchDaemon process lifecycle | macOS launchd (system) | — | RunAtLoad + KeepAlive supervises daemon |
| First-run consent screen | CLI (during `fennec init` / `fennec wizard`) | — | Text-mode; references policy URL fetched from backend |
| `fennec uninstall` audit event | Daemon (emit) → Backend (record) | — | Same canonical event path |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.x | Single language across daemon/backend/shared | [CITED: synapse package.json] — shared types prevent wire-format drift |
| Node.js | 22 LTS | Daemon runtime | LTS through 2027-04, chokidar 5 floor [CITED: synapse runs Node 22] |
| Hono | 4.12.23 | HTTP framework on Workers | [VERIFIED: npm view hono] — synapse uses 4.12.8; current is 4.12.23 |
| `@hono/zod-validator` | 0.8.0 | Request body validation middleware | [VERIFIED: npm view] — first-class Zod integration |
| Zod | 4.4.3 | Runtime validation | [VERIFIED: npm view] — schema source of truth in `packages/shared/` |
| Cloudflare Workers (Wrangler) | 4.95.0 | Backend deploy + bindings | [VERIFIED: npm view wrangler] — supports Queues + Hyperdrive + AE |
| `@supabase/supabase-js` | 2.106.2 | Postgres + Auth client | [VERIFIED: npm view] — synapse pattern; service-role from Worker only |
| Supabase Postgres | 15+ | Primary datastore | [CITED: STACK.md] — partitioning + RLS; pgvector available if needed |
| Vitest | 4.1.7 | Unit + integration tests | [VERIFIED: npm view] |
| `@cloudflare/vitest-pool-workers` | 0.16.10 | Test Workers in Miniflare | [VERIFIED: npm view] |
| Biome | 2.4.16 | Lint + format | [VERIFIED: npm view] (note: synapse pins 1.9.x; current major is 2.x — planner may want to align on synapse's version for parity) |

### Supporting (Daemon)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | 5.0.0 | File watching (future adapters; not needed for Claude Code hook adapter alone) | [VERIFIED: npm view] — defer to Phase 2 if Claude Code is the only adapter |
| `@clack/prompts` | 1.5.0 | Interactive CLI wizard | [VERIFIED: npm view] — `fennec wizard` for personal-tier install |
| ulid | 3.0.2 (or inline ~20 LOC) | Event IDs / idempotency_key seed | [VERIFIED: npm view] — synapse inlines this; consider inline to avoid dep |
| `node:http` / `node:https` / `node:tls` | stdlib | Loopback bridge listener | No external dep needed; bind 127.0.0.1 only |

### Supporting (Backend)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg` (node-postgres) | 8.21.0 | Postgres driver for Hyperdrive | [VERIFIED: npm view] — Cloudflare Hyperdrive requires node-postgres ≥8.16.3 [CITED: developers.cloudflare.com/hyperdrive/.../supabase/] |
| Cloudflare Queues | (Wrangler binding) | Async fan-out (will be wired in Phase 2 for correlation; declared in wrangler.toml in Phase 1 but no consumer yet) | [CITED: STACK.md] |
| Cloudflare Hyperdrive | (Wrangler binding) | Postgres connection pooling at edge | Required by ARCHITECTURE.md for multi-tenant scale |

### Supporting (Shim)

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| Go | 1.23+ (or latest stable) | Compile hook shim to static binary | [VERIFIED: web research] — Go has the most mature cross-compile + code-signing toolchain for macOS/Windows/Linux; binary ~1-2 MB after `-ldflags="-s -w"`. Rust is comparable on size/speed but slower compile cycle; Zig has macOS arm64 signing rough edges as of 2026. **Recommendation: Go**. |

### Code-Signing Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| `pkgbuild` / `productbuild` | macOS package construction | Apple dev-tools; `xcode-select --install` provides them [CITED: scriptingosx.com] |
| `productsign --sign "Developer ID Installer: <Name>"` | Sign the `.pkg` | Use Developer ID Installer cert, NOT Developer ID Application |
| `xcrun notarytool submit ... --wait` | Submit to Apple notary service | Requires App Store Connect API key + Apple Developer Program ($99/yr) [CITED: developer.apple.com] |
| `xcrun stapler staple` | Attach notarisation ticket to artefact | Final step before distribution |
| `xcrun notarytool store-credentials "<profile>" --key ... --key-id ... --issuer ...` | Store creds in keychain for repeat use | One-time setup per dev machine [CITED: keith.github.io/xcode-man-pages] |
| `signtool` (Windows SDK) | Sign Windows binaries with EV cert | Token-based (HSM) signing; cloud signing options exist (DigiCert KeyLocker, AzureSign) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONL queue | SQLite WAL (better-sqlite3) | Native dep + 5MB install size; not needed since daemon is write-mostly with sequential reader |
| Go (shim) | Rust | Slightly smaller binary but slower compile; mac signing equally mature |
| Go (shim) | Zig | Smallest binary but macOS signing rough edges in 2026 |
| Apple Developer Program | Free Apple ID | A free Apple ID cannot notarise. The $99/yr program is required [VERIFIED: developer.apple.com forums] — surface as a budget line in Phase 1 |
| EV cert from DigiCert | Sectigo / Certera | DigiCert ~$500-700/yr, Sectigo ~$300-500/yr, Certera ~$280/yr. All produce the same SmartScreen-eligible signature. Vendor choice = price + token-delivery-time tradeoff |
| `npm` workspaces | pnpm workspaces | Synapse uses npm; stay aligned for portability of patterns. pnpm has faster installs but adds a new tool to learn for a marginal gain |
| LaunchDaemon (root) for everything | LaunchDaemon + Helper LaunchAgent | A pure LaunchDaemon can't show GUI; pairing with a small LaunchAgent for notifications is the documented Apple pattern [CITED: developer.apple.com/library/.../CreatingLaunchdJobs.html] |
| Bearer header in shim → daemon IPC | Shared secret via filesystem | Both work; shared secret is simpler since IPC is loopback-only (not subject to MITM) |

**Installation:**

```bash
# Daemon (in repo, separate workspace)
cd daemon
npm install hono@4.12 zod@4.4 @clack/prompts@1.5

# Backend (in repo)
cd ../backend
npm install hono@4.12 @hono/zod-validator@0.8 @supabase/supabase-js@2.106 zod@4.4 pg@8.21
npm install -D wrangler@4.95 @cloudflare/vitest-pool-workers@0.16

# Shared (in repo)
cd ../packages/shared
npm install zod@4.4

# Root
npm install -D @biomejs/biome@2.4 vitest@4.1 typescript@5.9
```

**Version verification (run before locking versions):**
```bash
npm view hono version              # confirmed 4.12.23 at research time
npm view @supabase/supabase-js version
npm view zod version
```

## Package Legitimacy Audit

> **slopcheck was NOT available at research time** (PyPI proxy returned "no matching distribution"). Per protocol, **all packages below are tagged `[ASSUMED]`** even though every one was discovered via authoritative sources (synapse `package.json`, official Hono/Cloudflare/Supabase docs) AND exists on the npm registry. The planner **must add a `checkpoint:human-verify` task** before any install step that adds a new package — registry existence alone does not confer `[VERIFIED]` status per slopcheck protocol.

| Package | Registry | Latest Version | Source Repo | slopcheck | Disposition |
|---------|----------|----------------|-------------|-----------|-------------|
| hono | npm | 4.12.23 | github.com/honojs/hono | unavailable | [ASSUMED] — synapse uses, official Cloudflare partner |
| @hono/zod-validator | npm | 0.8.0 | github.com/honojs/middleware | unavailable | [ASSUMED] — Hono first-party middleware |
| zod | npm | 4.4.3 | github.com/colinhacks/zod | unavailable | [ASSUMED] — synapse uses |
| @supabase/supabase-js | npm | 2.106.2 | github.com/supabase/supabase-js | unavailable | [ASSUMED] — synapse uses |
| pg | npm | 8.21.0 | github.com/brianc/node-postgres | unavailable | [ASSUMED] — Cloudflare-recommended for Hyperdrive [CITED: developers.cloudflare.com] |
| chokidar | npm | 5.0.0 | github.com/paulmillr/chokidar | unavailable | [ASSUMED] — synapse uses (Phase 2 use only) |
| @clack/prompts | npm | 1.5.0 | github.com/natemoo-re/clack | unavailable | [ASSUMED] — synapse uses |
| ulid | npm | 3.0.2 | github.com/ulid/javascript | unavailable | [ASSUMED] — synapse inlines; consider not installing |
| wrangler | npm | 4.95.0 | github.com/cloudflare/workers-sdk | unavailable | [ASSUMED] — Cloudflare official |
| @cloudflare/vitest-pool-workers | npm | 0.16.10 | github.com/cloudflare/workers-sdk | unavailable | [ASSUMED] — Cloudflare official |
| @biomejs/biome | npm | 2.4.16 | github.com/biomejs/biome | unavailable | [ASSUMED] — synapse uses |
| vitest | npm | 4.1.7 | github.com/vitest-dev/vitest | unavailable | [ASSUMED] — synapse uses |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck did not run)
**Packages flagged as suspicious [SUS]:** none (slopcheck did not run)

**Planner action required:** before each `npm install` task, insert a `checkpoint:human-verify` step requiring the user to confirm the package name + version against the synapse codebase (for synapse-derived packages) or against the linked official docs (for Cloudflare/Supabase/Apache packages).

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    CLIENT EDGE — developer's Mac                          │
│                                                                          │
│  Claude Code (user-space process)                                        │
│       │                                                                  │
│       │  fires hook (PreToolUse, etc.) — runs configured command          │
│       │  reads hooks from MERGED settings: managed-settings.json          │
│       │  (system, root-owned) + ~/.claude/settings.json (user)            │
│       ▼                                                                  │
│  fennec-hook (compiled shim, /usr/local/fennec/bin/fennec-hook)          │
│       │                                                                  │
│       │  stdin → JSON payload                                            │
│       │  POST http://127.0.0.1:<port>/v1/hook   [shared-secret header]   │
│       │  ≤15ms, fail-open (exit 0 on connect error)                       │
│       ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │   fennec daemon  (LaunchDaemon, /Library/LaunchDaemons/...plist)  │   │
│  │   runs as root, RunAtLoad+KeepAlive                              │   │
│  │                                                                    │   │
│  │   ┌─────────────────┐    ┌─────────────────┐                      │   │
│  │   │ Loopback bridge │ →  │ Claude Code     │                      │   │
│  │   │ (127.0.0.1:???) │    │ adapter         │                      │   │
│  │   └─────────────────┘    └────────┬────────┘                      │   │
│  │                                    │ emit(CanonicalEvent)         │   │
│  │                                    ▼                              │   │
│  │   ┌─────────────────────────────────────────────────────────┐    │   │
│  │   │ Redactor (gitleaks rules, capture-time)                  │    │   │
│  │   │ → stamps redaction_applied_at + version_hash             │    │   │
│  │   └──────────────────────────┬──────────────────────────────┘    │   │
│  │                                ▼                                 │   │
│  │   ┌────────────────────────────────────────────────────────┐     │   │
│  │   │ LocalQueue (append-only JSONL, ~/.fennec/events.jsonl   │     │   │
│  │   │ + watermark ~/.fennec/sync-state.json)                  │     │   │
│  │   └────────┬───────────────────────────────────────────────┘     │   │
│  │              │                                                   │   │
│  │              ▼ timer + flush-signal                              │   │
│  │   ┌─────────────────────────────────────────────────────────┐    │   │
│  │   │ SyncLoop (batch 100/5s, watermark advances on 2xx,       │    │   │
│  │   │ exp backoff on 5xx)                                      │    │   │
│  │   └────────┬─────────────────────────────────────────────────┘   │   │
│  │              │  HTTPS w/ Authorization: Bearer <api_key>          │   │
│  │              │  (key read from /var/db/fennec/key, mode 0400)     │   │
│  │              │                                                   │   │
│  │   ┌──────────┴───────────┐                                       │   │
│  │   │ AdapterHeartbeat     │ — periodic, even at zero events       │   │
│  │   │ (events_parsed,      │                                       │   │
│  │   │ parse_errors,        │                                       │   │
│  │   │ schema_hash)         │                                       │   │
│  │   └──────────────────────┘                                       │   │
│  └───────────────────────────────┼───────────────────────────────────┘   │
│                                  │                                       │
│  ┌─────────────────────────────────┐                                     │
│  │  Helper LaunchAgent (user-      │  Triggered when daemon's `attached` │
│  │  scope, ~/Library/LaunchAgents) │  state is false:                    │
│  │                                  │  - osascript display notification  │
│  │  - tray notifier                 │  - opens default browser to SSO    │
│  │  - browser-opener               │    URL                              │
│  └─────────────────────────────────┘                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
                                     ▼ HTTPS
┌──────────────────────────────────────────────────────────────────────────┐
│            BACKEND — Cloudflare Workers + Hono                            │
│                                                                          │
│  Routes (Hono):                                                          │
│   POST /api/daemons/enroll          (validates install_secret →           │
│                                       generates per-machine api_key)      │
│   POST /api/events/batch            (Zod-validated, dedupes by            │
│                                       idempotency_key, upserts to Supabase│
│                                       via Hyperdrive)                     │
│   POST /api/daemons/attach-callback (SSO callback → backfills user_id)    │
│   POST /api/daemons/uninstall       (audit event)                         │
│                                                                          │
│  Middlewares: bearerAuth → resolveApiKey → setOrgContext → handler        │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     ▼ Hyperdrive (pg)
┌──────────────────────────────────────────────────────────────────────────┐
│            SUPABASE POSTGRES (RLS on every table)                         │
│                                                                          │
│  orgs · users · org_members · projects · api_keys · daemon_machines       │
│  ai_events    PARTITION BY RANGE (occurred_at) — monthly                  │
│  git_events   PARTITION BY RANGE (occurred_at) — monthly (table only)     │
│  adapter_heartbeats                                                       │
│  daemon_audit_events  (uninstall, attach, etc.)                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
fennec/
├── daemon/                          # Node — runs as LaunchDaemon
│   ├── src/
│   │   ├── index.ts                 # CLI entry + daemon main
│   │   ├── adapters/
│   │   │   ├── adapter.ts           # Adapter interface
│   │   │   ├── registry.ts
│   │   │   ├── loopback-bridge/     # HTTP listener on 127.0.0.1
│   │   │   └── claude-code/         # Hook payload normaliser
│   │   ├── normalize/
│   │   │   ├── canonical.ts         # imports @fennec/shared
│   │   │   └── claude-code.ts       # hook payload → CanonicalEvent
│   │   ├── redact/
│   │   │   ├── gitleaks-rules.ts    # vendored ruleset
│   │   │   ├── redactor.ts          # synchronous redact-before-queue
│   │   │   └── canary-test.ts       # 10 canary secrets for PRIV-01
│   │   ├── queue/
│   │   │   ├── jsonl.ts             # append-only, ULID-keyed
│   │   │   └── watermark.ts
│   │   ├── sync/
│   │   │   ├── loop.ts              # timer + signal-file flush
│   │   │   ├── batch.ts             # 100 events or 5s
│   │   │   └── backoff.ts
│   │   ├── enroll/
│   │   │   ├── enroll.ts            # POST /api/daemons/enroll
│   │   │   ├── api-key-store.ts     # /var/db/fennec/key  (0400)
│   │   │   └── machine-id.ts        # stable per-OS
│   │   ├── attach/
│   │   │   ├── oauth-server.ts      # loopback redirect URI listener
│   │   │   ├── notifier-bridge.ts   # tells helper LaunchAgent to notify
│   │   │   └── attach.ts
│   │   ├── heartbeat/
│   │   │   ├── heartbeat.ts
│   │   │   └── schema-hash.ts
│   │   ├── service/
│   │   │   ├── launchdaemon.ts      # plist writer (root-owned)
│   │   │   └── helper-agent.ts      # LaunchAgent plist writer (user)
│   │   ├── cli/
│   │   │   ├── wizard.ts            # `fennec wizard` (personal tier)
│   │   │   ├── init.ts              # `fennec init --install-secret` (org tier)
│   │   │   ├── uninstall.ts         # surgical managed-settings edit + audit
│   │   │   └── status.ts            # one-liner health (deferred fields)
│   │   └── managed-settings/
│   │       ├── path.ts              # platform-specific path resolution
│   │       ├── install.ts           # write hook entries (mode 644, root)
│   │       └── uninstall.ts         # remove fennec entries, preserve others
│   └── package.json
├── shim/                            # Go — compiled hook handler
│   ├── go.mod
│   ├── main.go                      # ~50 LOC: read stdin, POST loopback, exit
│   └── Makefile                     # cross-compile darwin/amd64+arm64, linux, windows
├── notifier/                        # Tiny binary for the Helper LaunchAgent
│   ├── go.mod
│   └── main.go                      # talks to daemon via loopback, surfaces osascript
├── backend/                         # Cloudflare Workers + Hono
│   ├── src/
│   │   ├── index.ts                 # Hono app + route mounting
│   │   ├── api/
│   │   │   ├── daemons-enroll.ts
│   │   │   ├── events-batch.ts
│   │   │   ├── attach-callback.ts
│   │   │   └── daemons-uninstall.ts
│   │   ├── db/
│   │   │   ├── client.ts            # pg via Hyperdrive
│   │   │   └── queries/
│   │   ├── lib/
│   │   │   ├── bearer-auth.ts       # @hono/zod-validator-style middleware
│   │   │   ├── resolve-api-key.ts   # api_key → org_id, user_id
│   │   │   └── idempotency.ts
│   │   └── env.ts
│   └── wrangler.jsonc
├── packages/
│   └── shared/                      # @fennec/shared — schema source of truth
│       ├── src/
│       │   ├── events/
│       │   │   ├── canonical.ts     # CanonicalEvent type + Zod schema
│       │   │   ├── kinds.ts         # EventKind discriminated union
│       │   │   └── claude-code-payload.ts
│       │   ├── heartbeat.ts         # AdapterHeartbeat schema
│       │   ├── auth.ts              # api-key shape, enrollment req/resp
│       │   └── index.ts
│       └── test/
├── installer/                       # Signed-installer build pipeline
│   ├── macos/
│   │   ├── build-pkg.sh             # pkgbuild + productbuild
│   │   ├── sign-and-notarize.sh     # productsign + notarytool + stapler
│   │   ├── postinstall.sh           # writes managed-settings, registers daemon
│   │   ├── Distribution.xml         # productbuild distribution template
│   │   ├── Configuration.plist      # MDM config-profile schema template
│   │   └── Resources/
│   ├── windows/
│   │   └── procure-cert.md          # docs: how to buy + receive EV cert
│   ├── homebrew/
│   │   └── fennec.rb                # tap formula (cask, downloads signed .pkg)
│   └── curl-bash/
│       └── install.sh               # mirrors `.pkg` install steps for headless
├── supabase/
│   └── migrations/
│       ├── 0001_orgs_users_keys.sql
│       ├── 0002_ai_events_partitioned.sql
│       ├── 0003_git_events_partitioned.sql
│       ├── 0004_adapter_heartbeats.sql
│       ├── 0005_rls_policies.sql
│       └── 9999_seed_phase1_test_data.sql
├── docs/
│   ├── E2E-PROTOCOL.md              # synapse-style protocol for Phase 1 smoke test
│   └── PRIVACY.md                   # URL referenced by first-run consent
├── biome.json
├── tsconfig.json                    # project references → daemon, backend, packages/shared
├── package.json                     # workspaces: daemon, backend, packages/*
└── README.md
```

### Pattern 1: Canonical Event Schema in `@fennec/shared`

**What:** A single Zod schema in `packages/shared/src/events/canonical.ts` is imported by both daemon (Node) and backend (Workers). Top-level fields are universal across all adapters; tool-specific payload lives in a discriminated union under `payload`.

**When to use:** Mandatory. Daemon → backend wire-format drift is the most expensive bug class (synapse experience).

**Trade-offs:** Workers can't import `node:*`; keep `packages/shared` runtime-neutral (Zod-only, no Node stdlib).

**Source:** [VERIFIED: synapse codebase] — `packages/shared/` pattern is synapse's working model.

### Pattern 2: Adapter Interface — Heterogeneous Capture, Homogeneous Emit

**What:** Every capture mechanism implements `Adapter { tool, start(emit), stop() }`. The daemon's `AdapterRegistry` hands each adapter an `emit(CanonicalEvent)` callback that writes to the LocalQueue. Adapters never touch the queue or sync loop directly.

**When to use:** Whenever the number of capture surfaces is open-ended. Phase 1 has one adapter (claude-code), but the pattern must exist so Phase 2 (codex, gemini, cursor, etc.) is purely additive.

**Trade-offs:** The canonical schema must be expressive enough for every adapter. Solution: discriminated union by `tool` + `kind`; permissive `payload` validators per-kind.

### Pattern 3: Capture-Time Redaction (Synchronous, Before Queue)

**What:** Every event passes through `redactor.redact(event)` BEFORE `queue.append()`. Redactor uses gitleaks default ruleset (vendored TOML, ~150 patterns [CITED: github.com/gitleaks/gitleaks]) — regex matches + entropy check. Redacted regions become `[REDACTED:TYPE]` placeholders. Redactor stamps `redaction_applied_at` and `redaction_version_hash` on the event.

**When to use:** Mandatory in Phase 1 (PRIV-01, PITFALLS P1 — capture-time redaction is non-retrofittable).

**Trade-offs:** Synchronous redaction adds latency on the daemon's hot path (~1-5ms per event for ~150 regexes). Acceptable. Ingest-time redaction is defense-in-depth, not primary.

**Verification:** 10-canary-secret smoke test — `tests/canary.test.ts` paste 10 known secret patterns (AWS key, GH PAT, Bearer token, private key, etc.) through the daemon, assert 0 reach the backend's `ai_events` payload.

### Pattern 4: Append-Only JSONL Queue + Watermark

**What:** Daemon appends each canonical event as one JSONL line to `~/.fennec/events.jsonl` (atomic line-write via OS append semantics). Watermark is `~/.fennec/sync-state.json` = `{ last_synced_event_id: "<ulid>" }`. Sync loop reads from watermark forward, POSTs in batches, advances watermark on 2xx.

**When to use:** Mandatory for offline-tolerant + crash-safe capture. Synapse-validated.

**Trade-offs:** No secondary indexes. Replay is O(file size). Rotation needed at 100MB.

**Implementation:**
```typescript
// Source: synapse mcp/src/capture/events-log.ts pattern
import { openSync, writeSync, closeSync } from "node:fs";

function appendEvent(event: CanonicalEvent, path: string): void {
  const line = JSON.stringify(event) + "\n";
  const fd = openSync(path, "a");           // O_APPEND atomic on POSIX
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
```

### Pattern 5: Sync Loop with Watermark + Idempotency

**What:** Timer + signal-file. Every 5s OR when `~/.fennec/daemon-flush-now` exists, read 100 events from watermark forward, POST as a batch with `Authorization: Bearer <api_key>`, advance watermark on 2xx, exp backoff on 5xx. Backend dedupes by `idempotency_key` (UPSERT ON CONFLICT DO NOTHING) so a retry that double-sends is a no-op.

**When to use:** Mandatory. Synapse pattern; battle-tested.

### Pattern 6: LaunchDaemon + Helper LaunchAgent (System Service + GUI Helper)

**What:** Fennec ships TWO launchd units:
1. **LaunchDaemon** at `/Library/LaunchDaemons/dev.fennec.daemon.plist` — root-owned, runs at boot, does all capture/IPC/sync/redaction work. Cannot show GUI [VERIFIED: developer.apple.com docs].
2. **Helper LaunchAgent** at `/Library/LaunchAgents/dev.fennec.notifier.plist` — runs in each logged-in user's session (user-context), receives push from daemon via a second loopback channel, surfaces `osascript display notification`, opens browser to OAuth URL on first-run.

**When to use:** Mandatory for any system-level daemon that needs to surface user-facing UX (Apple's documented pattern). Fennec needs this for AUTH-16 (browser auto-open) and DAE-20 (persistent tray notification until attach).

**Trade-offs:** Two units to install + uninstall + monitor. Helper agent is tiny (~200 LOC Go binary) and isolated. Adds complexity but is unavoidable per Apple architecture.

**Alternative pattern considered + rejected:** `launchctl asuser <uid> osascript ...` from the daemon directly. Works but: (a) requires picking a uid (which one if multiple users logged in?), (b) crosses security boundaries (root invoking user-context UI is a TCC red flag), (c) breaks if no user is logged in (boot-time enrollment can't surface notification). Helper LaunchAgent is the right pattern.

**Source:** [CITED: developer.apple.com/library/.../CreatingLaunchdJobs.html — "Only agents have access to the macOS GUI"]

### Pattern 7: Managed-Settings Hook Installation

**What:** Postinstall script of the signed `.pkg` writes (or merges into) `/Library/Application Support/ClaudeCode/managed-settings.json` an entry:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "/usr/local/fennec/bin/fennec-hook" }
    ],
    "PostToolUse": [
      { "type": "command", "command": "/usr/local/fennec/bin/fennec-hook" }
    ]
    // ... SessionStart, PreCompact, SessionEnd, SubagentStop
  }
}
```
File is `chown root:wheel`, `chmod 644` (user-readable but not user-writable). Claude Code merges hooks from managed-settings + user-settings additively, so synapse's user-layer hooks continue to fire alongside fennec's [VERIFIED: code.claude.com/docs/en/settings — "arrays are concatenated and deduplicated" across precedence levels].

**Key constraint:** Managed-settings precedence is the highest tier; users cannot disable hooks installed there from their own settings. Fennec uninstall surgically removes ONLY its entries (preserving any other managed-settings content) and removes the file if it becomes empty.

**Source:** [VERIFIED: code.claude.com/docs/en/settings — "Plugin defaults → User settings → Project settings → Local settings → Managed (policy) settings"]

### Pattern 8: Hook Handler Shim (Compiled, ≤15ms, Fail-Open)

**What:** A ~50-LOC Go binary at `/usr/local/fennec/bin/fennec-hook`. Reads JSON from stdin, POSTs to `http://127.0.0.1:<port>/v1/hook` with `X-Fennec-Shim-Secret: <secret>` header, exits 0 within 15ms. If POST fails (timeout, daemon down, connection refused), still exits 0 — fail-open per D-23.

**Why Go:** Best cross-compile story for the three target platforms; binary ~1-2 MB with `-ldflags="-s -w"`; signing toolchain (codesign on macOS, signtool on Windows) treats Go binaries as first-class.

**Why not Node:** Cold start ~150ms. Hooks fire on every UserPromptSubmit + PostToolUse — that's 0.2s+ of latency added to a developer's loop. Unacceptable.

**Implementation sketch:**
```go
// shim/main.go (~40 LOC)
package main

import (
    "bytes"
    "io"
    "net/http"
    "os"
    "time"
)

func main() {
    payload, err := io.ReadAll(os.Stdin)
    if err != nil { os.Exit(0) }  // fail-open

    secret := os.Getenv("FENNEC_SHIM_SECRET")  // set at install by postinstall
    port := os.Getenv("FENNEC_DAEMON_PORT")    // default "7821"
    if port == "" { port = "7821" }

    client := &http.Client{Timeout: 15 * time.Millisecond}
    req, _ := http.NewRequest("POST",
        "http://127.0.0.1:"+port+"/v1/hook",
        bytes.NewReader(payload))
    req.Header.Set("X-Fennec-Shim-Secret", secret)
    req.Header.Set("Content-Type", "application/json")
    resp, err := client.Do(req)
    if err == nil { resp.Body.Close() }
    os.Exit(0)  // always exit 0 — Claude Code never blocked
}
```

### Pattern 9: Loopback IPC Security (Shared Secret + UID Binding)

**What:** Daemon binds HTTP server to `127.0.0.1:<port>` (NEVER to `0.0.0.0`). Daemon and shim share a per-install secret stored in two places:
- `/etc/fennec/shim-secret` — mode 0644, world-readable so user-context shim can read it
- daemon process memory (read once at boot)

Every loopback POST carries `X-Fennec-Shim-Secret: <secret>` header. Daemon validates on every request; rejects 401 if missing/wrong.

**Threat model:** A non-fennec process on the same machine running as the same UID-or-higher can read `/etc/fennec/shim-secret` and forge requests. Mitigation: this is acceptable because (a) loopback isn't network-exposed, (b) any process with that read access could already directly write to `~/.fennec/events.jsonl` since the daemon owns that file, (c) we're not trying to defend against an attacker with arbitrary local code-exec — we're preventing accidental cross-process noise.

**Stronger alternative considered:** UNIX socket at `/var/run/fennec.sock` with filesystem ACLs limiting to root + a `fennec` group. Cleaner, but adds a platform-divergent code path (Windows uses named pipes, requires entirely different code). HTTP-over-loopback is simpler and the threat model doesn't justify the divergence.

### Pattern 10: OAuth 2.0 PKCE with Loopback Redirect URI

**What:** First-run attach flow — daemon spins up a one-shot HTTP server on `127.0.0.1:<random-port>`, the helper LaunchAgent opens `https://api.fennec.dev/auth/sso?redirect_uri=http://127.0.0.1:<random-port>/callback&code_challenge=<S256-of-verifier>&code_challenge_method=S256`. User completes SSO in browser. Provider redirects to `http://127.0.0.1:<random-port>/callback?code=...`. Daemon's listener catches it, exchanges code+verifier for the SSO token at the backend, attaches `user_id` to the daemon's API key.

**Why:** RFC 8252 standard for native apps — loopback IP redirect URIs are the canonical pattern for desktop OAuth [CITED: datatracker.ietf.org/doc/html/rfc8252]. PKCE is mandatory because native clients can't keep a secret.

**Source:** [CITED: RFC 8252 §7.3 — "Loopback Interface Redirection"]

### Pattern 11: Backend Ingest — Bearer Auth → Zod Validate → Upsert

**What:** Single Hono route, three middlewares + handler:

```typescript
// backend/src/api/events-batch.ts
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { zValidator } from "@hono/zod-validator";
import { EventBatchSchema } from "@fennec/shared";

const app = new Hono<{ Bindings: Env, Variables: { org_id: string; api_key_id: string } }>();

app.use("/api/events/batch", bearerAuth({
  verifyToken: async (token, c) => {
    const meta = await resolveApiKey(token, c.env);
    if (!meta) return false;
    c.set("org_id", meta.org_id);
    c.set("api_key_id", meta.api_key_id);
    return true;
  }
}));

app.post("/api/events/batch",
  zValidator("json", EventBatchSchema),
  async (c) => {
    const { events } = c.req.valid("json");
    const org_id = c.get("org_id");
    const sql = c.env.HYPERDRIVE_DB;
    for (const e of events) {
      await sql.query(`
        INSERT INTO ai_events (idempotency_key, org_id, user_id, tool, occurred_at, payload, schema_version, redaction_applied_at, redaction_version_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (idempotency_key) DO NOTHING
      `, [e.idempotency_key, org_id, e.user_id ?? null, e.tool, e.occurred_at, JSON.stringify(e.payload), e.schema_version, e.redaction_applied_at, e.redaction_version_hash]);
    }
    return c.json({ accepted: events.length });
  }
);

export default app;
```

**Source:** [CITED: hono.dev/docs/middleware/builtin/bearer-auth] + [CITED: developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/]

### Anti-Patterns to Avoid

- **Adapter writes directly to backend, bypassing the queue:** synapse documented this as a real anti-pattern (`mcp/src/hooks/post-tool-use.ts` lifted). Breaks offline-tolerance + dedupe + retry. *Do this instead:* every adapter calls `emit(canonicalEvent)`, and the queue + sync loop are the only network path.
- **Inferring outcomes in the daemon:** prompt ↔ git correlation is backend-only (Phase 2). Phase 1 must not introduce any `triggered_by_prompt_id` field on git events.
- **Branching code on cloud vs self-host:** Phase 1 ships only the cloud path (Supabase + Cloudflare), but the architecture must not introduce `if (selfHosted)` branches. Self-host is Phase 6 and uses the same code with different bindings.
- **Querying raw `ai_events` for any dashboard card:** Phase 1 doesn't ship a dashboard, but the schema lays the foundation. Rollup tables come in Phase 2/4; Phase 1 schema should be designed knowing reads will always hit rollups.
- **Top-level event fields for tool-specific data:** Resist adding `claude_code_*` columns. All tool-specific data lives in `payload`.
- **One process per adapter:** Single daemon, in-process modules. One LaunchDaemon + one Helper LaunchAgent — not one launchd unit per adapter.
- **Hand-rolled JWT for daemon auth:** Use simple Bearer tokens via `hono/bearer-auth`. Daemon API keys are server-side secrets stored in `api_keys` table; no JWT signing needed.
- **Writing the hook shim in Node:** Cold start kills the latency budget.
- **TLS-MITM proxy in any form in Phase 1:** Out of scope; v1.5 escape hatch only per STACK.md.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret detection | Hand-written regex list | Vendored gitleaks TOML ruleset (~150 patterns) | [CITED: github.com/gitleaks/gitleaks] — community-maintained, covers AWS/GH/Stripe/Slack/private keys/etc. Hand-rolling = guaranteed misses |
| Request validation | Hand-written validators | Zod 4 + `@hono/zod-validator` | [CITED: hono.dev/docs/guides/validation] — type-safe + runtime-safe boundary |
| Bearer auth | Hand-rolled header parser | `hono/bearer-auth` | First-party Hono middleware [CITED: hono.dev/docs/middleware/builtin/bearer-auth] |
| Postgres connection pooling at edge | Per-request connect | Cloudflare Hyperdrive | [CITED: developers.cloudflare.com/hyperdrive] — eliminates 50-150ms per-request TCP+TLS handshake |
| Postgres partitioning | Manual subtable management + cron | Postgres declarative `PARTITION BY RANGE` + Supabase dynamic-partitioning function | [CITED: supabase.com/blog/postgres-dynamic-table-partitioning] |
| OAuth flow on native app | Hand-roll redirect URI handling | RFC 8252 PKCE + loopback redirect | Standard since 2017; secure-by-default [CITED: RFC 8252] |
| macOS notarisation | Hand-roll zip + curl + JSON polling | `xcrun notarytool submit --wait` | Apple-supported, runs synchronous, returns ticket [CITED: developer.apple.com/documentation/security/customizing-the-notarization-workflow] |
| Windows code-sign | Hand-roll signing infrastructure | Buy EV cert from DigiCert/Sectigo/Certera, use `signtool` | Cannot DIY EV cert chain |
| ULID generation | Random UUID4 + timestamp prefix | `ulid` npm package or 20-line inline | ULID is lexicographic + 128-bit + URL-safe |
| Cron-style scheduled tasks | Hand-roll setTimeout chain | Cloudflare Workers cron triggers | Not needed in Phase 1 (no rollups yet), but design for it |
| Auth provider integration | Hand-roll OAuth for GitHub/Google/Microsoft | Supabase Auth | Phase 1 needs only the SSO callback handling; full Auth UX is Phase 3 |
| Code-signing cert generation | Self-sign and hope | Apple Developer Program ($99/yr) + Windows EV cert ($300-500/yr) | Self-signed = Gatekeeper/SmartScreen instantly block |

**Key insight:** Phase 1 is gated by external dependencies (Apple Developer Program enrolment, EV cert procurement, notarytool service availability) that can take 1-7 days. Start procurement on day 1 — buying the certs is not a coding task, but the timeline is real.

## Runtime State Inventory

Phase 1 is greenfield (no existing fennec code). This section is **not applicable** — there is no existing runtime state to rename or migrate. Included here for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — greenfield project | None |
| Live service config | None — greenfield project | None |
| OS-registered state | None — fennec LaunchDaemon + Helper LaunchAgent will be **newly registered** in Phase 1 (no prior labels to migrate) | None |
| Secrets/env vars | None — `FENNEC_SHIM_SECRET`, `FENNEC_DAEMON_PORT`, `FENNEC_API_URL` are **newly introduced** in Phase 1 | None |
| Build artifacts | None — greenfield project | None |

**Nothing found in category:** Explicitly confirmed — fennec has no codebase yet; verified by `ls /Users/Tanmai.N/Documents/fennec/` returning only `CLAUDE.md` and `.planning/`.

## Common Pitfalls

### Pitfall 1: Capture-Time Redaction is Asynchronous or Skipped on Error

**What goes wrong:** Redactor is wrapped in `try { redact(e) } catch { /* swallow */ }` — a regex failure silently passes the event through unredacted.
**Why it happens:** Pressure to keep daemon hot path crash-safe.
**How to avoid:** Redactor errors fail the queue write entirely (event is dropped + logged + counted in `parse_errors`). Better lost-event than leaked secret. Plus the 10-canary-secret smoke test in CI.
**Warning signs:** Backend grep `WHERE payload::text ~ 'AKIA[0-9A-Z]{16}'` returns >0 rows after the daemon has shipped one batch.

### Pitfall 2: managed-settings Hook Entry Overwrites Existing Entries on Reinstall

**What goes wrong:** Postinstall script does `cp` instead of JSON-merge — any prior managed-settings content (from another tool or earlier fennec install) is silently destroyed.
**Why it happens:** Fast scripting at install time.
**How to avoid:** Postinstall reads existing JSON (if any), merges fennec's hook entries into the `hooks` object additively, writes back. Uninstall surgically removes ONLY fennec entries, preserving the rest. Idempotent: running install twice should be a no-op.
**Warning signs:** A re-install removes some other vendor's hook entries; a customer reports "X stopped working after I installed fennec."

### Pitfall 3: LaunchDaemon Tries to `osascript display notification` Directly

**What goes wrong:** Daemon (running as root, no window server connection) calls `osascript -e 'display notification "Sign in to fennec"'`. Either silently fails or produces a notification that never reaches a user (which "user"?).
**Why it happens:** The author doesn't know about LaunchAgent vs LaunchDaemon GUI restrictions [CITED: Apple developer docs].
**How to avoid:** Helper LaunchAgent pattern (§Pattern 6). Daemon emits an event to the LaunchAgent via a separate loopback channel; LaunchAgent (running in the user's session) does the `osascript`.
**Warning signs:** Notification fires inconsistently or never; tests pass on dev's logged-in session but fail in fresh-boot smoke test.

### Pitfall 4: SmartScreen Reputation Assumed to Be Instant on EV Sign

**What goes wrong:** ROADMAP success criterion 2 says "warm-up clock has started" — implicitly assumes EV cert = instant SmartScreen acceptance. But Microsoft changed the policy in March 2024: EV certs no longer instantly remove warnings.
**Why it happens:** Stale documentation everywhere on the internet still claims EV = instant reputation.
**How to avoid:** Recalibrate Phase 1 verification: "EV cert procured + signed test artefact + signtool verification passes" — full SmartScreen acceptance is downstream (when Windows daemon ships in Phase 5 + accumulates downloads).
**Source:** [CITED: web research — Microsoft SmartScreen policy change Mar 2024]

### Pitfall 5: Idempotency Key Derived From Timestamp or Random UUID

**What goes wrong:** `idempotency_key = uuid4()` or `Date.now().toString()`. Retry sends the same event with a different key — backend stores duplicates.
**Why it happens:** Looks fine in dev; only breaks under retry.
**How to avoid:** `idempotency_key = sha256(tool|session_id|hook_event|monotonic_seq_within_session)` OR a ULID generated ONCE at adapter capture time and persisted to JSONL alongside the event. Sync loop reads the key from JSONL — it's stable across retries.
**Warning signs:** Backend dedupe doesn't fire; a daemon-restart-during-batch produces N+M events where M is the duplicate.

### Pitfall 6: Cache Token Double-Counting (ANL-06 Misimplementation)

**What goes wrong:** Daemon captures `input_tokens` AND adds `cache_creation_input_tokens` to it (or vice versa), producing 70%+ cost miscount [CITED: LiteLLM bug #9812].
**Why it happens:** Anthropic docs and OTel spec disagree:
- Anthropic docs say: `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens` (the three are separate).
- OTel spec (and some SDKs) say: `input_tokens` already INCLUDES cache tokens — adding them is double-counting.
**How to avoid:** Capture all three fields **separately and verbatim** from the Anthropic API response — do NOT aggregate at capture. Compute totals at query time, with the formula documented per-tool. This pushes the ambiguity into Phase 2's cost computation, where it can be fixed without redeploying daemons.
**Warning signs:** Smoke-test cache-heavy session shows totals off by 30%+ from Anthropic's own dashboard.
**Cross-ref:** This is also Assumption A2 — the planner needs to confirm with the user which interpretation fennec adopts before Phase 2.

### Pitfall 7: `fennec uninstall` Reads Whole managed-settings.json and Rewrites It as One Blob

**What goes wrong:** Uninstall script `JSON.parse` → object → mutate → `JSON.stringify` → write. Loses comments, formatting, key ordering. If another MDM-managed tool maintains the same file, fennec uninstall reformats their settings — they'll complain.
**Why it happens:** It's the obvious implementation.
**How to avoid:** Acceptable for v1 because managed-settings.json is strict JSON (no comments allowed). But: preserve key order, indent with 2 spaces (matching what most MDM tools emit). If the file becomes empty (only fennec was there), delete it.

### Pitfall 8: First-Run Consent Screen Skipped on `--install-secret` Path

**What goes wrong:** Personal-tier `fennec wizard` shows consent; org-tier `fennec init --install-secret` (the MDM-payload path) skips it because "the org admin already consented." But PRIV-07 requires the operator to see what's captured BEFORE any hook fires.
**Why it happens:** MDM-driven installs are headless; tempting to skip prompts.
**How to avoid:** `fennec init` on first run writes a one-page consent message to a log file at `/var/log/fennec/first-run-consent.txt` with timestamp, machine_id, install_secret_org_name. This satisfies "operator sees the consent" — the org admin is the operator in the org-tier case. The dev sees a separate first-attach notification.

### Pitfall 9: Synapse + Fennec Hook Collision Causes Double Capture

**What goes wrong:** Both synapse and fennec install hooks; both fire on every Claude Code event. Same prompt is captured twice. Fine for fennec (org tracking), confusing for the user inspecting locally.
**Why it happens:** Hook merge is additive (correctly).
**How to avoid:** This is **expected and documented behaviour** per D-20. Both tools fire. Each tool's own deduper handles its own events; they never see each other's storage. The user is told (in `fennec inspect` output) "this is fennec's view; synapse may capture separately."

### Pitfall 10: `/var/db/fennec/key` Mode Drift After User `chmod`

**What goes wrong:** A power-user runs `chmod 644 /var/db/fennec/key` and the key becomes world-readable. Daemon happily reads it; doesn't notice the permission change.
**Why it happens:** No re-check on read.
**How to avoid:** Daemon on every key-read calls `stat()` and asserts `mode & 0777 === 0400` AND `uid === 0`. If not, refuse to start, log to `/var/log/fennec/daemon.log`. Key reaches the daemon only when correctly permissioned.

### Pitfall 11: Notarisation Submission Times Out Without `--wait`

**What goes wrong:** `xcrun notarytool submit` without `--wait` returns immediately with a submission ID; CI moves on; the artefact is never actually notarised when stapler runs.
**Why it happens:** Documentation snippets often omit `--wait`.
**How to avoid:** Always use `xcrun notarytool submit ... --wait` (synchronous). 5-15 min per submission is acceptable. Alternative: poll with `xcrun notarytool info <id>` until status is `Accepted`.

### Pitfall 12: LaunchDaemon Has No Full Disk Access (TCC) on Unmanaged Macs

**What goes wrong:** Fennec daemon needs to read files outside `~/.fennec/` (e.g., to inspect Claude Code's hook payload paths, or in future phases to read transcripts). On macOS 11+, a LaunchDaemon requesting FDA on an unmanaged Mac fails with "Caller lacks TCC authorization for Full Disk Access" — **MDM is the only supported path** for boot-time daemon FDA [CITED: developer.apple.com forums].
**Why it happens:** Apple's TCC restrictions tightened post-Big Sur.
**How to avoid:** Phase 1's Claude Code hook adapter does NOT need FDA — the shim reads stdin and POSTs to loopback, daemon reads its own files. Confirm in plans that no FDA-requiring operation lands in Phase 1. If Phase 2 needs to read Cursor's SQLite (which is in user-protected paths), this becomes a real constraint — plan for it then.

## Code Examples

### Canonical Event Schema (in `packages/shared/src/events/canonical.ts`)

```typescript
// @fennec/shared
import { z } from "zod";

// EventKind discriminated union — extend per adapter, top-level shape is stable
export const EventKindSchema = z.enum([
  "prompt_submitted",        // user typed prompt
  "tool_call",               // assistant invoked a tool
  "session_start",
  "session_end",
  "pre_compact",             // before claude code compacts conversation
  "subagent_stop",
  "model_response",          // model finished
]);
export type EventKind = z.infer<typeof EventKindSchema>;

// Claude Code-specific payload — discriminated by `tool: "claude-code"` + `kind`
export const ClaudeCodePromptPayloadSchema = z.object({
  prompt_text: z.string(),           // post-redaction
  session_id: z.string(),
  cwd: z.string().optional(),
  hook_event: z.string(),            // "UserPromptSubmit" | "PostToolUse" | ...
  // Token counts come on PostToolUse / response events:
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

// Canonical event — the wire-format contract between daemon and backend
export const CanonicalEventSchema = z.object({
  // identity + idempotency
  idempotency_key: z.string().min(1),     // deterministic; stable across retries

  // tenancy (resolved server-side from Bearer api_key; daemon doesn't fill these)
  // org_id and user_id are stamped by backend ingest middleware from api_key lookup

  // source
  tool: z.enum(["claude-code", "codex", "gemini", "cursor", "copilot", "chatgpt-web", "claude-ai-web", "git"]),
  adapter_version: z.string(),

  // time
  occurred_at: z.string().datetime(),      // ISO 8601, daemon clock
  // received_at stamped by backend

  // workspace context
  cwd: z.string().optional(),
  git_remote: z.string().optional(),
  git_branch: z.string().optional(),
  hostname: z.string(),
  os: z.enum(["darwin", "linux", "win32"]),

  // kind + payload
  kind: EventKindSchema,
  payload: z.record(z.string(), z.unknown()),  // adapter-tagged Zod validator chooses per tool+kind

  // versioning + capture-time metadata
  schema_version: z.literal(1),
  redaction_applied_at: z.string().datetime(),
  redaction_version_hash: z.string(),       // hash of the gitleaks ruleset version
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

// Batch wire format for /api/events/batch
export const EventBatchSchema = z.object({
  events: z.array(CanonicalEventSchema).min(1).max(500),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

// Adapter heartbeat — emitted even when zero events captured
export const AdapterHeartbeatSchema = z.object({
  idempotency_key: z.string(),               // hostname|adapter|interval_start
  hostname: z.string(),
  adapter: z.string(),                       // "claude-code" etc.
  adapter_version: z.string(),
  schema_hash: z.string(),                   // hash of upstream tool's data shape
  events_parsed: z.number().int().nonnegative(),
  parse_errors: z.number().int().nonnegative(),
  daemon_unreachable_count: z.number().int().nonnegative().default(0),  // D-23
  interval_start: z.string().datetime(),
  interval_end: z.string().datetime(),
  schema_version: z.literal(1),
});
export type AdapterHeartbeat = z.infer<typeof AdapterHeartbeatSchema>;
```

**Source:** Adapted from ARCHITECTURE.md §Event Schema + synapse `packages/shared/` pattern.

### `idempotency_key` Derivation

```typescript
// daemon/src/normalize/canonical.ts
import { createHash } from "node:crypto";

export function deriveIdempotencyKey(input: {
  hostname: string;
  tool: string;
  session_id: string;
  hook_event: string;
  monotonic_seq: number;
}): string {
  const h = createHash("sha256");
  h.update(`${input.hostname}|${input.tool}|${input.session_id}|${input.hook_event}|${input.monotonic_seq}`);
  return h.digest("hex").slice(0, 32);  // 128-bit hex, stable across retries
}
```

**Why this shape:** Stable across retries (same inputs → same key), survives daemon restart (monotonic_seq is persisted in JSONL alongside event), survives session crash, distinct across machines, distinct across adapters.

### Redaction (Daemon, Synchronous Before Queue)

```typescript
// daemon/src/redact/redactor.ts
import { gitleaksRules } from "./gitleaks-rules.js";  // vendored TOML → compiled regexes

const REDACTION_VERSION = "gitleaks-v8.21-defaults";

export function redactEvent(event: CanonicalEvent): CanonicalEvent {
  const redactedPayload = redactPayload(event.payload);
  return {
    ...event,
    payload: redactedPayload,
    redaction_applied_at: new Date().toISOString(),
    redaction_version_hash: REDACTION_VERSION,
  };
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactString(JSON.stringify(payload)));
}

function redactString(s: string): string {
  let out = s;
  for (const rule of gitleaksRules) {
    out = out.replace(rule.regex, (match) => {
      if (rule.entropy && computeEntropy(match) < rule.entropy) return match;
      return `[REDACTED:${rule.id}]`;
    });
  }
  return out;
}

// 10-canary test in tests/canary.test.ts
const CANARIES = [
  "AKIAIOSFODNN7EXAMPLE",                  // AWS access key
  "ghp_abcdef0123456789abcdef0123456789",  // GitHub PAT
  "sk-ant-api03-XXXXXXXXXX",                // Anthropic API key
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy",  // JWT Bearer
  "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",  // private key
  // ... etc
];
test("canary secrets are redacted before reaching queue", () => {
  for (const c of CANARIES) {
    const e = redactEvent(buildEvent({ payload: { prompt_text: `Here's my secret: ${c}` } }));
    expect(JSON.stringify(e.payload)).not.toContain(c);
    expect(JSON.stringify(e.payload)).toMatch(/\[REDACTED:/);
  }
});
```

### LaunchDaemon plist (root, system-level)

```xml
<!-- /Library/LaunchDaemons/dev.fennec.daemon.plist -->
<!-- Source: synapse os-service.ts pattern + Apple developer docs -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.fennec.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/fennec/bin/node</string>
    <string>/usr/local/fennec/lib/daemon/index.js</string>
    <string>daemon</string>
  </array>
  <key>UserName</key><string>root</string>
  <key>GroupName</key><string>wheel</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FENNEC_API_URL</key><string>https://api.fennec.dev</string>
    <key>FENNEC_DAEMON_PORT</key><string>7821</string>
    <key>PATH</key><string>/usr/local/fennec/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>/var/log/fennec/daemon.log</string>
  <key>StandardErrorPath</key><string>/var/log/fennec/daemon.log</string>
</dict>
</plist>
```

### Helper LaunchAgent plist (user, GUI helper)

```xml
<!-- /Library/LaunchAgents/dev.fennec.notifier.plist
     OR ~/Library/LaunchAgents/dev.fennec.notifier.plist (per-user install) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.fennec.notifier</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/fennec/bin/fennec-notifier</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FENNEC_DAEMON_PORT</key><string>7821</string>
  </dict>
</dict>
</plist>
```

### macOS Signing + Notarisation Pipeline (`installer/macos/sign-and-notarize.sh`)

```bash
#!/usr/bin/env bash
# Source: scriptingosx.com + Apple developer docs + GoReleaser notarize patterns
set -euo pipefail

PKG_UNSIGNED="$1"               # ./build/fennec-unsigned.pkg
PKG_SIGNED="./build/fennec.pkg"
DEVELOPER_ID="Developer ID Installer: Your Name (TEAMID)"
KEYCHAIN_PROFILE="fennec-notary"  # set once with xcrun notarytool store-credentials

# 1. Sign the .pkg
productsign --timestamp --sign "$DEVELOPER_ID" "$PKG_UNSIGNED" "$PKG_SIGNED"

# 2. Submit to Apple notary service (synchronous)
xcrun notarytool submit "$PKG_SIGNED" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --wait

# 3. Staple the ticket onto the .pkg so Gatekeeper works offline
xcrun stapler staple "$PKG_SIGNED"

# 4. Verify
spctl --assess --type install -vvv "$PKG_SIGNED"
# Expected output: "$PKG_SIGNED: accepted, source=Notarized Developer ID"
```

**Setup once per dev machine:**
```bash
# Store App Store Connect API key in keychain
xcrun notarytool store-credentials "fennec-notary" \
  --key ./AuthKey_XXXXXXX.p8 \
  --key-id XXXXXXX \
  --issuer XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

**Source:** [CITED: keith.github.io/xcode-man-pages/notarytool.1.html] + [CITED: scriptingosx.com/2021/07/notarize-a-command-line-tool-with-notarytool/]

### MDM Configuration Profile Schema (Phase 1 primitive)

```xml
<!-- installer/macos/Configuration.plist — template for org-tier MDM deployment -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadIdentifier</key><string>dev.fennec.config</string>
  <key>PayloadUUID</key><string>FENNEC-PAYLOAD-UUID-HERE</string>
  <key>PayloadScope</key><string>System</string>
  <key>PayloadDisplayName</key><string>Fennec Org Configuration</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>dev.fennec.daemon</string>
      <key>PayloadIdentifier</key><string>dev.fennec.daemon.config</string>
      <key>PayloadUUID</key><string>FENNEC-DAEMON-UUID-HERE</string>
      <key>PayloadVersion</key><integer>1</integer>
      <!-- The org_install_secret — IT team customises per-org via MDM UI -->
      <key>org_install_secret</key><string>REPLACE_WITH_ORG_INSTALL_SECRET</string>
      <key>org_name</key><string>REPLACE_WITH_ORG_NAME</string>
      <key>api_url</key><string>https://api.fennec.dev</string>
    </dict>
  </array>
</dict>
</plist>
```

**How daemon reads it:** Postinstall script invokes `defaults read /Library/Managed\ Preferences/dev.fennec.daemon.plist org_install_secret` (macOS auto-installs the profile into `Managed Preferences`). Daemon's `init` subcommand reads this on first boot, calls `POST /api/daemons/enroll`, persists the per-machine API key to `/var/db/fennec/key`.

**Source:** [CITED: maxsundell.se/posts/createmobileconfig/] + [CITED: learn.microsoft.com/en-us/intune/intune-service/configuration/custom-settings-apple]

### Daemon Enrollment Endpoint

```typescript
// backend/src/api/daemons-enroll.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const EnrollRequestSchema = z.object({
  install_secret: z.string().min(32),    // org's MDM-distributed secret OR personal-mode self-issued
  machine_id: z.string().min(8),         // stable per-OS (e.g., IOPlatformUUID on macOS)
  hostname: z.string(),
  os: z.enum(["darwin", "linux", "win32"]),
});

const app = new Hono<{ Bindings: Env }>();

app.post("/api/daemons/enroll",
  zValidator("json", EnrollRequestSchema),
  async (c) => {
    const { install_secret, machine_id, hostname, os } = c.req.valid("json");

    // 1. Validate install_secret against org_install_secrets table
    const org = await c.env.HYPERDRIVE_DB.query(
      `SELECT id, name FROM orgs WHERE install_secret_hash = $1 AND install_secret_expires_at > NOW() LIMIT 1`,
      [hashSecret(install_secret)]
    );
    if (!org.rows[0]) return c.json({ error: "invalid_or_expired_install_secret" }, 401);

    // 2. Generate per-machine api_key (idempotent: same machine_id + org → same key)
    const apiKey = await issueApiKeyForMachine(c.env.HYPERDRIVE_DB, {
      org_id: org.rows[0].id,
      machine_id,
      hostname,
      os,
    });

    // 3. Return key + org metadata for first-run UX
    return c.json({
      api_key: apiKey.token,
      api_key_id: apiKey.id,
      org_id: org.rows[0].id,
      org_name: org.rows[0].name,
      privacy_policy_url: `https://fennec.dev/privacy/${org.rows[0].id}`,
    });
  }
);

export default app;
```

**Idempotency:** Same `(org_id, machine_id)` returns the same `api_key` on repeat enrollment (UPSERT pattern). This means a re-install on the same machine doesn't create a duplicate `daemon_machines` row.

### Per-Machine API Key Storage (macOS)

```typescript
// daemon/src/enroll/api-key-store.ts
import { writeFileSync, chmodSync, readFileSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";

const KEY_PATH = "/var/db/fennec/key";  // root-only

export function persistApiKey(apiKey: string): void {
  mkdirSync("/var/db/fennec", { recursive: true, mode: 0o700 });
  writeFileSync(KEY_PATH, apiKey, { encoding: "utf-8", mode: 0o400 });
  chmodSync(KEY_PATH, 0o400);  // belt + suspenders
}

export function readApiKey(): string {
  const st = statSync(KEY_PATH);
  if (st.uid !== 0) throw new Error("api-key-file-not-root-owned");
  if ((st.mode & 0o777) !== 0o400) throw new Error("api-key-file-permissions-drifted");
  return readFileSync(KEY_PATH, "utf-8").trim();
}
```

### Postgres Schema Skeleton (Phase 1)

```sql
-- supabase/migrations/0001_orgs_users_keys.sql
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  install_secret_hash TEXT NOT NULL,
  install_secret_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  -- Phase 3 will add sign-up UX; Phase 1 SQL-seeds one user
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email)
);

CREATE TABLE org_members (
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daemon_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,       -- stable across reboots (IOPlatformUUID, etc.)
  hostname TEXT NOT NULL,
  os TEXT NOT NULL CHECK (os IN ('darwin', 'linux', 'win32')),
  attached_user_id UUID REFERENCES users(id),  -- NULL until SSO attach
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ,
  UNIQUE (org_id, machine_id)
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  daemon_machine_id UUID NOT NULL REFERENCES daemon_machines(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,       -- store hash, not raw token
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (token_hash)
);
CREATE INDEX idx_api_keys_token_hash ON api_keys (token_hash) WHERE revoked_at IS NULL;

-- supabase/migrations/0002_ai_events_partitioned.sql
CREATE TABLE ai_events (
  idempotency_key TEXT NOT NULL,
  org_id UUID NOT NULL,
  user_id UUID,                              -- NULL until SSO attach
  user_id_unknown TEXT,                      -- "unknown@${hostname}" pre-attach
  tool TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL,
  redaction_applied_at TIMESTAMPTZ NOT NULL,
  redaction_version_hash TEXT NOT NULL,
  hostname TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Initial monthly partition (Phase 1 creates this; Phase 5 / cron auto-creates future)
CREATE TABLE ai_events_2026_05 PARTITION OF ai_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE ai_events_2026_06 PARTITION OF ai_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_ai_events_org_occurred ON ai_events (org_id, occurred_at);
CREATE INDEX idx_ai_events_user_occurred ON ai_events (user_id, occurred_at) WHERE user_id IS NOT NULL;

-- supabase/migrations/0005_rls_policies.sql
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE daemon_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE adapter_heartbeats ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; RLS is belt-and-suspenders for the future
-- when frontend or anon-key paths read data (Phase 3+).
-- For Phase 1, define a placeholder policy per table:
CREATE POLICY ai_events_tenant_isolation ON ai_events
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
-- (Phase 1 backend uses service_role + middleware checks; this policy
-- becomes load-bearing in Phase 3.)
```

**Source:** [CITED: supabase.com/docs/guides/database/partitions] + [CITED: supabase.com/blog/postgres-dynamic-table-partitioning]

### Hook Handler Shim (Go)

See Pattern 8 above for full source.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MV2 browser extensions for capture | Manifest V3 + fetch-monkeypatch (out of Phase 1 scope) | Chrome MV2 EOL completed | Phase 1 unaffected; relevant only for Phase 2 browser adapter |
| `altool` for Apple notarisation | `xcrun notarytool` | Late 2023; altool deprecated | Phase 1 uses notarytool exclusively |
| EV cert = instant SmartScreen reputation | EV no longer bypasses SmartScreen — reputation earned via downloads | Microsoft March 2024 policy change | Pitfall 4 — relaxes Phase 1 verification criterion 2 |
| `pkg` (vercel) for Node binary distribution | Deprecated; SEA in Node 25.5+, Bun compile, or signed `.pkg` of Node + script | 2023 | Fennec uses signed `.pkg` containing Node + script; SEA not yet stable enough |
| `auth-helpers-sveltekit` Supabase Auth | `@supabase/ssr` | 2024 | Phase 3 concern, not Phase 1 |
| `node-forge` for cert generation | `openssl` spawn | Long-standing | Phase 1 unaffected (no TLS-MITM proxy in Phase 1) |
| RSA-2048 code-signing certs | RSA-3072 minimum | 2024 (CA/B Forum) | Modern certs are fine; verify when buying |
| Hand-rolled CI auto-deploy | Manual `wrangler deploy` (synapse pattern) | Long-standing for low-stakes deployments | Phase 1 deploys are manual; CI runs lint/test only |
| EasyCLA for OSS contributor agreements | DCO sign-off as v1, EasyCLA in v1.x | 2024 | Phase 6 concern |

**Deprecated/outdated:**
- `pkg` (vercel): archived. Use SEA or signed `.pkg`.
- altool: replaced by notarytool.
- `auth-helpers-sveltekit`: replaced by `@supabase/ssr`.
- `npm install -g fennec`: removed from user-facing path per D-04 (dev workflow only).
- `fennec pause` (CAP-17): removed per D-16/D-27.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code managed-settings hooks merge additively with user-settings (D-20 holds end-to-end) | Pattern 7, Hook installation | If precedence is "replace not merge" within the same hook key, synapse hooks would be silenced when fennec installs. Mitigation: integration test in Phase 1 verifies BOTH hooks fire on a single Claude Code event. Web research strongly suggests merge IS additive ("arrays are concatenated and deduplicated" [CITED: code.claude.com/docs/en/settings]) but exact behaviour for the `hooks` object under the managed-tier precedence has not been verified by a live test in our environment. |
| A2 | Anthropic Usage object semantics: `cache_creation_input_tokens` and `cache_read_input_tokens` are SEPARATE from `input_tokens` (formula: total_input = read + creation + input) | Canonical schema, Pitfall 6 | OTel GenAI spec and Anthropic SDK 0.30+ may treat `input_tokens` as already-inclusive of cache tokens. If wrong, cost computation in Phase 2 will be off by ~70% (LiteLLM bug pattern). Phase 1 mitigation: capture all three fields RAW and verbatim; defer formula to Phase 2 with user confirmation. |
| A3 | `/var/db/fennec/key` is the right path on macOS for a system-protected per-machine secret | API key storage | Apple has no canonical "system secret" path. `/var/db/` is conventional for system daemons but Tailscale uses `/Library/Application Support/Tailscale/`, Datadog uses `/etc/datadog-agent/`. Risk: code-signing entitlements or sandbox restrictions on macOS 26 Tahoe may complicate. Mitigation: planner verifies via a single-write smoke test on a clean macOS install. |
| A4 | Windows EV cert procurement timeline is 2-7 days (ID verification + HSM/token shipping) | Code-signing tooling | DigiCert / Sectigo timelines may be slower (1-2 weeks) if ID-verification queues are backlogged. Mitigation: start procurement on day 1; Windows EV is parallel to Phase 1 main work and not blocking until Phase 5. |
| A5 | A LaunchDaemon-only daemon cannot reliably surface `osascript display notification` to a logged-in user; pairing with a Helper LaunchAgent is required | Pattern 6 | Some sources claim `launchctl asuser <uid> osascript ...` works from root. Even if it does, it's brittle (which uid? what if no user logged in?). Mitigation: implement Helper LaunchAgent. If at planner's discretion it's later shown that `asuser` works reliably for Phase 1's narrow case, the helper can be removed. |
| A6 | Anthropic Developer Program ($99/yr) suffices for `.pkg` notarisation (no need for organisation/enterprise enrolment) | Code-signing tooling | An individual Developer ID Installer cert may be flagged differently by Gatekeeper for a B2B-positioned product. Most likely fine; verify on first signed-pkg smoke test. |
| A7 | The synapse `events-log.ts` JSONL queue pattern works unchanged at fennec's expected per-machine event volume (~200/day baseline, ~1000/day burst) | Pattern 4 | At 100MB JSONL = ~500k events, replay becomes slow. Mitigation: ship rotation at 100MB in Phase 1 (synapse defers this; fennec should ship it). |
| A8 | `pg` 8.21+ via Hyperdrive supports Supabase Postgres 15+ Direct Connection strings without modification | Standard Stack | Cloudflare docs say "use Direct connection rather than pooled" [CITED] — confirmed working but not tested in our env. Mitigation: Phase 1 task includes a "POST /api/events/batch produces a row in ai_events" smoke test that exercises the full stack. |
| A9 | The 36 Phase 1 requirements can fit a 4-8 week solo timeline | (cross-cutting) | Code-signing procurement alone may eat 1-2 weeks. EV cert verification + first-sign warm-up another week. Plus 16 net-new components. Phase 1 may need to descope to (e.g., defer DAE-21 MDM-primitives polish to keep main path moving). Surfaced for the planner. |
| A10 | gitleaks default ruleset (~150 patterns) is sufficient for PRIV-01 to pass the canary-secret smoke test | Standard Stack, Pattern 3 | Some org-specific PII patterns won't be caught — this is acknowledged in PITFALLS Pitfall 2 (Phase 3 adds customer-configurable rules). For Phase 1, gitleaks defaults + 10 chosen canaries are the bar. |

**Risk-prioritised:** A1, A2, A5 are the most consequential — wrong assumptions there affect either hook installation correctness, cost computation downstream, or user-facing UX. A6, A8, A9 are slow-to-discover but lower-blast-radius. A3, A4, A7, A10 are local optimisation knobs.

## Open Questions

1. **Loopback IPC mechanism final pick (planner's discretion)**
   - What we know: HTTP-over-127.0.0.1 with shared-secret header is the simplest cross-platform path. UNIX socket is cleaner on macOS/Linux but adds Windows divergence (named pipes).
   - What's unclear: Whether the security tradeoff (HTTP secret leakable to same-UID processes) is acceptable for a system-level daemon.
   - Recommendation: Go HTTP-loopback for Phase 1 (simplicity wins on solo timeline). Document threat model. Revisit in Phase 5 if a customer demands stronger isolation.

2. **`org_install_secret` length, entropy, rotation policy**
   - What we know: Must be ≥32 chars high-entropy; v1 acceptable is "support-only rotation."
   - What's unclear: Whether the format should be ULID-prefixed (sortable, human-debuggable) or pure-random base64.
   - Recommendation: 32-byte random + base64url (44 chars). Document in admin docs.

3. **Schema-hash drift detection mechanism (CAP-15)**
   - What we know: Heartbeat carries `schema_hash`; backend tracks drift per (machine, adapter).
   - What's unclear: What goes INTO the hash. Options: (a) hash of the JSON-key set in the first received payload of the interval; (b) hash of the full payload shape (keys + types); (c) hash of the adapter version + a known-good schema fingerprint.
   - Recommendation: (b) is the most sensitive (detects "field renamed" or "type changed"); (a) is the simplest. Start with (a) in Phase 1, upgrade in Phase 2 if needed.

4. **Whether to vendor gitleaks rules or fetch at runtime**
   - What we know: ~150 patterns in TOML, ~30KB. Vendoring is the synapse pattern.
   - What's unclear: Whether updates to the ruleset should auto-deliver from backend or require daemon update.
   - Recommendation: Vendor in Phase 1; auto-fetch at startup is a Phase 3 enhancement (matches PRIV-02's customer-configurable-rules cadence).

5. **The exact ROADMAP edit for Phase 1 success criterion 2 (Windows EV cert)**
   - What we know: Original criterion implies "warm-up complete" — but SmartScreen reputation is no longer instant-on-EV.
   - What's unclear: Whether the criterion needs textual update or just operational understanding.
   - Recommendation: Relax to "EV cert procured AND first signed test artefact passes `signtool verify /pa`. Full SmartScreen reputation is a Phase 5 success criterion."

6. **Whether `fennec init` (org-tier, headless) emits any logged consent before installing hooks**
   - What we know: PRIV-07 requires the operator to see consent before any hook fires.
   - What's unclear: In a headless MDM install, the "operator" is the IT admin; the consent flow is logically pre-install (during MDM rollout planning), not at machine-install-time.
   - Recommendation: `fennec init` writes a one-time `/var/log/fennec/first-run-consent.txt` audit record + reports it back in the next adapter heartbeat. Satisfies PRIV-07 in the org-tier without requiring a user-facing dialog.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Daemon runtime | ✓ (must verify >=22 LTS) | TBD | None — required |
| npm | Workspace mgmt | ✓ | TBD | pnpm acceptable |
| Go 1.23+ | Hook shim, notifier binary compilation | ✗ (check `which go`) | — | Could try Rust if Go not available — but Go strongly preferred |
| Apple Developer Program enrolment | Notarisation pipeline (DAE-08) | ✗ — must enroll ($99/yr) | — | None — required for `.pkg` distribution. Surface as procurement task in plan. |
| Apple Developer ID Installer cert | macOS `.pkg` signing | ✗ — generated post-enrolment | — | Self-sign for dev-only, but production-blocking |
| Apple Developer ID Application cert | macOS binary signing (if any binaries inside `.pkg`) | ✗ — generated post-enrolment | — | Same as above |
| `productbuild`, `productsign`, `pkgbuild`, `notarytool`, `stapler` | Signing pipeline | ✓ (via `xcode-select --install`) | — | Need Xcode tools on the signing machine (Apple Silicon Mac assumed) |
| Windows EV code-signing cert | Windows `.msi` signing (DAE-09, warm-up start) | ✗ — must procure ($300-500/yr; 2-7 day delivery) | — | None — required to start warm-up clock per D-05 |
| Windows SDK (signtool) | Sign Windows binaries with EV cert | ✗ (need a Windows machine OR osslsigncode on macOS) | — | osslsigncode is a cross-platform alternative for sign-only |
| Cloudflare account + Workers paid plan | Wrangler deploys, Queues, Hyperdrive | TBD | — | None — required |
| Supabase project | Postgres + Auth | TBD | — | Bare Postgres works (Phase 6 self-host) but cloud needs Supabase |
| Homebrew tap repo on GitHub | Brew distribution (DAE-15) | ✗ — create new repo | — | Curl-bash fallback if brew tap delayed |
| `fennec.dev` domain | Curl-bash installer URL, OAuth callback URL | TBD | — | Can use temporary cloudflare-pages domain for dev |
| App Store Connect API key | notarytool authentication | ✗ — generate in App Store Connect after Apple Developer Program enrolment | — | App-specific password works as alternative auth (deprecated path) |

**Missing dependencies with no fallback (blocking — must address in Phase 1 plan):**
- Apple Developer Program enrolment ($99/yr; instant or 1-day verification)
- Apple Developer ID Installer cert (post-enrolment, instant generation)
- Windows EV code-signing cert (2-7 day procurement; necessary to start D-05 warm-up clock)
- Cloudflare paid plan + Supabase project (cloud infra)
- `fennec.dev` domain registration (for production URLs)
- App Store Connect API key (notarytool auth)
- Go toolchain on the dev machine

**Missing dependencies with fallback:**
- Homebrew tap repo (curl-bash fallback for first release)
- Windows SDK signtool (osslsigncode cross-platform alternative)

## Validation Architecture

> Per `.planning/config.json`, `workflow.nyquist_validation: true` — include this section.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 (synapse pattern) |
| Config file | `vitest.config.ts` at root (workspaces config); per-workspace overrides allowed |
| Quick run command | `npm run test -- --run --reporter=dot` |
| Full suite command | `npm run lint && npm run typecheck && npm run test && npm run test:e2e` |
| Workers test runtime | `@cloudflare/vitest-pool-workers` 0.16+ (Miniflare-equivalent isolation) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-10 | `CanonicalEvent` Zod schema validates correct events, rejects malformed | unit | `npm -w packages/shared test src/events/canonical.test.ts` | ❌ Wave 0 |
| CAP-11 | Append-only JSONL queue is crash-safe + correctly idempotency-keyed | unit | `npm -w daemon test src/queue/jsonl.test.ts` | ❌ Wave 0 |
| CAP-12 | Sync loop batches 100 events / 5s, advances watermark on 2xx, backs off on 5xx | unit | `npm -w daemon test src/sync/loop.test.ts` | ❌ Wave 0 |
| CAP-13 | `idempotency_key` is stable across retries (same input → same key) | unit | `npm -w daemon test src/normalize/canonical.test.ts` | ❌ Wave 0 |
| CAP-14 | Heartbeat emits even when zero events captured | unit | `npm -w daemon test src/heartbeat/heartbeat.test.ts` | ❌ Wave 0 |
| CAP-15 | Schema-hash drift surfaces "adapter offline" status | unit | `npm -w daemon test src/heartbeat/schema-hash.test.ts` | ❌ Wave 0 |
| CAP-16 | Killing daemon mid-flight (kill -9), restart loses zero events | integration | `npm -w daemon test:integration src/queue/crash-safe.test.ts` | ❌ Wave 0 |
| PRIV-01 | 10 canary secrets through daemon → 0 reach `ai_events` row | integration | `npm -w daemon test:integration src/redact/canary.test.ts` | ❌ Wave 0 |
| PRIV-07 | First-run consent screen shown / logged before any hook fires | smoke | `npm run test:e2e:first-run` | ❌ Wave 0 |
| AUTH-10 | Daemon authenticates via `Authorization: Bearer <api-key>` | integration | `npm -w backend test src/api/events-batch.test.ts` | ❌ Wave 0 |
| AUTH-14 | `POST /api/daemons/enroll` accepts valid secret, rejects invalid | integration | `npm -w backend test src/api/daemons-enroll.test.ts` | ❌ Wave 0 |
| AUTH-15 | API key file mode = 0400, uid = 0 | unit | `npm -w daemon test src/enroll/api-key-store.test.ts` | ❌ Wave 0 |
| AUTH-16 | OAuth attach: callback handles `unknown@host` backfill | integration | `npm -w backend test src/api/attach-callback.test.ts` | ❌ Wave 0 |
| ING-01 | Batch endpoint accepts Zod-valid payload, returns `{accepted: N}` | integration | `npm -w backend test src/api/events-batch.test.ts` | ❌ Wave 0 |
| ING-02 | Dedupe by `idempotency_key` — replay returns same count, no duplicate rows | integration | `npm -w backend test src/api/events-batch.dedupe.test.ts` | ❌ Wave 0 |
| ING-03 | Invalid payload → 400 with reason | unit | `npm -w backend test src/api/events-batch.validation.test.ts` | ❌ Wave 0 |
| ING-04 | Ingest does NOT call any analysis code in hot path | unit (assertion on call graph) | `npm -w backend test src/api/events-batch.hot-path.test.ts` | ❌ Wave 0 |
| ING-05 | `ai_events` table is range-partitioned on `occurred_at` | migration test | `npm -w backend test:migrations` | ❌ Wave 0 |
| ING-06 | `git_events` table is range-partitioned on `occurred_at` | migration test | `npm -w backend test:migrations` | ❌ Wave 0 |
| ANL-06 | Schema captures `cache_creation_input_tokens` + `cache_read_input_tokens` separately in `payload.usage` | unit (schema assertion) | `npm -w packages/shared test src/events/canonical.test.ts` | ❌ Wave 0 |
| DAE-01 | `fennec wizard` flow completes a personal-tier install end-to-end | manual+e2e | `npm run test:e2e:wizard` (with mock Apple Dev cert / dry-run signer) | ❌ Wave 0 (manual-mostly) |
| DAE-02 | `fennec init --install-secret <SECRET>` enrolls non-interactively | integration | `npm -w daemon test:integration src/cli/init.test.ts` | ❌ Wave 0 |
| DAE-05 | LaunchDaemon plist installs at `/Library/LaunchDaemons/dev.fennec.daemon.plist`, runs as root, KeepAlive | manual-only | `bash tests/manual/launchdaemon-smoke.sh` (requires sudo, real macOS) | ❌ Wave 0 (manual-only) |
| DAE-08 | macOS `.pkg` is signed + notarised + stapled (`spctl --assess --type install -vvv` returns "source=Notarized Developer ID") | manual+CI | `bash tests/ci/verify-signed-pkg.sh ./build/fennec.pkg` | ❌ Wave 0 |
| DAE-09 | Windows EV cert signed test artefact + `signtool verify /pa /v <artefact>` returns OK | manual-only | `tests/manual/windows-signtool-verify.ps1` (requires Windows VM + EV cert) | ❌ Wave 0 (manual-only) |
| DAE-10 | Daemon respects `NODE_EXTRA_CA_CERTS` and `HTTPS_PROXY` | integration | `npm -w daemon test:integration src/sync/proxy.test.ts` | ❌ Wave 0 |
| DAE-11 | Both fennec hooks AND synapse hooks fire on a single Claude Code event | manual+e2e | `bash tests/e2e/synapse-coexistence.sh` (requires both daemons installed) | ❌ Wave 0 |
| DAE-12 | Distributed `.pkg` installs on fresh macOS without Gatekeeper "unidentified developer" dialog | manual-only | `bash tests/manual/fresh-mac-pkg-install.sh` | ❌ Wave 0 (manual-only) |
| DAE-17 | Hook entries are written to managed-settings.json, root-owned, mode 644 | integration | `npm -w daemon test:integration src/managed-settings/install.test.ts` | ❌ Wave 0 |
| DAE-18 | Hook shim binary completes ≤15ms (POST + exit) and fails open if daemon unreachable | unit (Go test) | `cd shim && go test ./...` | ❌ Wave 0 |
| DAE-19 | `fennec uninstall` removes only fennec entries from managed-settings, preserves synapse | integration | `npm -w daemon test:integration src/managed-settings/uninstall.test.ts` | ❌ Wave 0 |
| DAE-20 | Tray notification appears when daemon's `attached` state is false | manual+e2e | `bash tests/e2e/tray-notification.sh` | ❌ Wave 0 (manual-mostly) |
| DAE-21 | `.pkg` accepts an `org_install_secret` via Configuration Profile schema | manual+integration | `bash tests/manual/mdm-profile-install.sh` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test -- --run --reporter=dot` (unit suite only; <15 sec target)
- **Per wave merge:** `npm run lint && npm run typecheck && npm run test` (full unit + integration; <60 sec target)
- **Phase gate:** Full suite green + `bash tests/e2e/phase-1-smoke.sh` exercises the canonical proof (Claude Code prompt → `ai_events` row in <5 min) + manual smoke of signed `.pkg` install on a fresh macOS VM before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` (root) — workspaces config covering `daemon`, `backend`, `packages/shared`
- [ ] `vitest.workspace.ts` defining the workspace boundaries
- [ ] `backend/vitest.config.ts` — uses `@cloudflare/vitest-pool-workers`
- [ ] `daemon/vitest.config.ts` — standard Node
- [ ] `packages/shared/vitest.config.ts` — runtime-neutral
- [ ] `tests/canary-secrets.txt` — the 10 canary patterns used by PRIV-01 smoke
- [ ] `tests/e2e/phase-1-smoke.sh` — orchestrates Claude Code prompt → daemon → backend → SQL query
- [ ] `tests/manual/launchdaemon-smoke.sh` — DAE-05 verification (requires sudo + real macOS)
- [ ] `tests/manual/fresh-mac-pkg-install.sh` — DAE-12 verification (requires fresh macOS VM)
- [ ] `tests/manual/windows-signtool-verify.ps1` — DAE-09 verification (requires Windows + EV cert)
- [ ] `tests/manual/mdm-profile-install.sh` — DAE-21 verification (requires test MDM payload)
- [ ] `tests/ci/verify-signed-pkg.sh` — automatable portion of DAE-08
- [ ] `shim/go.mod` + `shim/main_test.go` — Go test harness for the shim ≤15ms budget
- [ ] Framework install: none new — Vitest is already in the planned stack; Go test toolchain ships with Go install

## Security Domain

> Per `.planning/config.json` (no `security_enforcement: false` override), this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Multi-tier separation (capture / sync / ingest / store / RLS); documented in §System Architecture |
| V2 Authentication | yes | Daemon Bearer-token auth (Phase 1); user OAuth flow via Supabase Auth (Phase 3 for full UX); attach-only in Phase 1 |
| V3 Session Management | partial | Daemon API key is long-lived per-machine (not rotated automatically — D-discretion); user sessions are Phase 3 |
| V4 Access Control | yes | `org_id` scoping at middleware + RLS belt-and-suspenders; `projectScopeMiddleware` is Phase 3 |
| V5 Input Validation | yes | Zod schema validation at every endpoint boundary; `@hono/zod-validator` for HTTP, `parse(...)` for daemon ingestion |
| V6 Cryptography | yes | TLS for daemon ↔ backend, system random for `org_install_secret` (32 bytes urandom), sha256 for `idempotency_key` derivation, no hand-rolled crypto |
| V7 Error Handling | yes | All errors logged to `/var/log/fennec/daemon.log` (root-owned 0640) with secret-aware sanitisation — log writer goes through the same redactor |
| V8 Data Protection | yes | Capture-time redaction (PRIV-01) is non-negotiable; per-machine API key mode 0400; `/var/db/fennec/key` root-only |
| V9 Communications | yes | HTTPS-only for daemon ↔ backend; honor `NODE_EXTRA_CA_CERTS` + `HTTPS_PROXY` for corp networks (DAE-10) |
| V10 Malicious Code | yes | Code-sign artefacts (DAE-08, DAE-09); pin Node version in plist `PATH`; no auto-update in Phase 1 (deferred per CONTEXT) |
| V11 Business Logic | partial | Idempotency-keyed upserts prevent double-write; rate-limiting per-org is deferred to Phase 3+ |
| V12 Files and Resources | yes | managed-settings.json edits are surgical (preserve other entries); JSONL queue has rotation at 100MB; api-key file permission re-check on each read |
| V13 API and Web Services | yes | Hono routes use Bearer auth + Zod validation; `service_role` key never leaves Worker |
| V14 Configuration | yes | All secrets in env vars / Wrangler secrets; no `default_jwt_secret`-style developer footguns |

### Known Threat Patterns for {Node 22 daemon + Cloudflare Workers + Supabase Postgres + macOS LaunchDaemon}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Captured prompts contain secrets that leak via storage breach | Information Disclosure | Capture-time redaction (PRIV-01) + per-org KMS at rest (deferred to Phase 3 PRIV-04) + 30-day retention default (Phase 3 PRIV-03) |
| SQL injection on `org_install_secret` lookup or `idempotency_key` upsert | Tampering | All queries are parameterised via `pg` driver; never string-concat values into SQL |
| Bearer token leaks via daemon log | Information Disclosure | Daemon log goes through redactor; log mode 0640; secrets-in-logs anti-pattern banned by code review |
| Shim secret leak gives same-UID processes ability to forge events | Spoofing | Documented in threat model — `/etc/fennec/shim-secret` is mode 0644 (user-readable for shim invocation) but the threat is bounded by local-process model; loopback never leaves machine |
| LaunchDaemon binary tampering (replacing `/usr/local/fennec/lib/daemon/index.js`) | Tampering | Code-signed `.pkg` install + (Phase 5+) signature verification at boot; for Phase 1, install path is root-owned with mode 0755 |
| Cross-tenant data access via missing middleware check | Information Disclosure | RLS policy on `ai_events` + middleware enforces `org_id` from api_key; cross-tenant integration test in Phase 3 (synapse hit this 3x) |
| Hook handler shim is spoofed by a non-fennec binary at the same path | Spoofing | Postinstall sets `/usr/local/fennec/bin/fennec-hook` to root:wheel, mode 0755; user cannot replace without sudo |
| Notarisation submission fails / staple is missing → Gatekeeper blocks install | Denial of Service (against the user) | `--wait` flag synchronously confirms notarisation; verify with `spctl --assess` before release |
| `org_install_secret` is intercepted in MDM transit (MDM TLS misconfig) | Information Disclosure | Outside fennec's control; documented as IT-responsibility. Secret rotates on expiry (90 days default) |
| OAuth callback URL hijacked by another local process | Spoofing | Loopback port is randomised + PKCE verifier prevents code interception (RFC 8252) |
| `idempotency_key` collision allows tampering with an existing event | Tampering | `ON CONFLICT (idempotency_key) DO NOTHING` — duplicate is silently ignored, original is preserved (not overwritten); collision space is 128-bit hex (negligible) |
| `/var/db/fennec/key` exfil via root-compromise on the daemon machine | Information Disclosure | Out of fennec's threat model — if root is compromised, all bets are off. Mitigation: per-machine keys are scoped, revocable via Phase 3 API key UX |
| Postinstall script of `.pkg` is exploited for privilege escalation | Elevation of Privilege | Script is signed (transitively via `.pkg` signature); contents are reviewed in code review; no `eval`-style dynamic execution |

## Sources

### Primary (HIGH confidence)

- **Synapse codebase** at `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/` — `os-service.ts`, `events-log.ts`, `cloud-sync.ts`, `daemon.ts` — working production reference for daemon lifecycle, JSONL queue, sync loop. Read for patterns.
- [Claude Code settings reference — Anthropic Docs](https://code.claude.com/docs/en/settings) — managed-settings precedence, hooks-in-managed-settings support, additive merge behaviour
- [Claude Code Hooks reference — Anthropic Docs](https://code.claude.com/docs/en/hooks) — SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, SubagentStop schema + stdin JSON payload contract
- [Apple Developer — Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) — notarytool + stapler workflow
- [Apple Developer — Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) — CI scripting + keychain credential storage
- [Apple Developer — Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — LaunchDaemon vs LaunchAgent GUI restriction
- [Apple Developer — Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/) — Apple Developer Program requirement for notarisation
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252) — PKCE + loopback redirect URI
- [Cloudflare Hyperdrive + Supabase docs](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) — Direct connection string + pg driver version requirement
- [Hono — Bearer Auth Middleware](https://hono.dev/docs/middleware/builtin/bearer-auth) — daemon-to-backend auth pattern
- [Hono — Validation Guide](https://hono.dev/docs/guides/validation) — Zod-validator middleware
- [notarytool man page](https://keith.github.io/xcode-man-pages/notarytool.1.html) — exact CLI flags
- [Apple Developer — Anthropic Usage object docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — `cache_creation_input_tokens` + `cache_read_input_tokens` + `input_tokens` semantics
- [Supabase — Partitioning tables](https://supabase.com/docs/guides/database/partitions) — range partitioning by occurred_at
- [Supabase — Dynamic Table Partitioning](https://supabase.com/blog/postgres-dynamic-table-partitioning) — automated partition management
- [Gitleaks — github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) — default ruleset (TOML, ~150 patterns)
- `.planning/research/SUMMARY.md`, `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — load-bearing internal research

### Secondary (MEDIUM confidence)

- [Notarization Process for macOS Installers — Apptimized](https://apptimized.com/en/news/mac-notarization-process/) — end-to-end pipeline walkthrough verified against Apple docs
- [Creating payload-free packages with pkgbuild — Der Flounder](https://derflounder.wordpress.com/2012/08/15/creating-payload-free-packages-with-pkgbuild/) — postinstall-script-only `.pkg` pattern
- [Notarize a Command Line Tool with notarytool — Scripting OS X](https://scriptingosx.com/2021/07/notarize-a-command-line-tool-with-notarytool/) — concrete scripting examples
- [How to Create and Deploy a Configuration Profile (.mobileconfig) on macOS — Inventive HQ](https://inventivehq.com/knowledge-base/macos/how-to-create-macos-configuration-profile) — MDM profile structure
- [Add custom settings to Apple devices in Microsoft Intune — Microsoft Learn](https://learn.microsoft.com/en-us/intune/intune-service/configuration/custom-settings-apple) — Intune `.mobileconfig` upload
- [Best Code Signing Certificate Providers in 2026 — SSL Dragon](https://www.ssldragon.com/blog/code-signing-certificate-providers/) — EV cert vendor comparison; pricing context
- [EV Code Signing Guide: Costs, Windows & HSM — aso.dev](https://aso.dev/blog/ev-code-sign/) — HSM/token delivery process
- [Cheap EV Code Signing Certificates — SSL2BUY](https://www.ssl2buy.com/ev-code-signing-certificates) — DigiCert/Sectigo pricing benchmark
- [How Gitleaks Works — gitleaks.org](https://gitleaks.org/how-gitleaks-works-deep-dive-into-secret-detection-scanning-engine-and-security-automation/) — regex + entropy scoring
- [Trigger customized Notifications from the macOS Terminal — Swiss Mac User](https://swissmacuser.ch/native-macos-notifications-from-terminal-scripts/) — osascript display notification examples
- [LaunchAgents and LaunchDaemons on macOS: A Complete and Secure Guide — Mundobytes](https://mundobytes.com/en/How-to-use-launchagents-and-launchdaemons-on-macOS/) — GUI access constraints
- [Setting up a monorepo using npm workspaces and TypeScript Project References — Medium / Cecylia Borek](https://medium.com/@cecylia.borek/setting-up-a-monorepo-using-npm-workspaces-and-typescript-project-references-307841e0ba4a) — `composite: true` + `references` patterns
- [Homebrew: Casks without codesigning will be removed — Homebrew 5.1.0 blog](https://brew.sh/2026/03/10/homebrew-5.1.0/) — confirms signed-installer requirement for brew tap distribution

### Tertiary (LOW confidence — needs validation)

- [macOS TCC — HackTricks](https://angelica.gitbook.io/hacktricks/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-tcc) — TCC + LaunchDaemon FDA interactions; useful but community-curated
- [macOS LaunchDaemon FDA on unmanaged Macs — Apple Developer Forums thread](https://developer.apple.com/forums/thread/804548) — confirms MDM-required path for boot-time FDA; single thread; tight to one TCC scenario
- [Microsoft SmartScreen + EV cert reputation change March 2024](https://sslinsights.com/best-code-signing-certificate-windows-applications/) — paraphrased web research; need to verify with a Microsoft policy statement before locking
- LayerChart Svelte 5 migration status, exact Bun cross-compile vs Go cross-compile binary size benchmarks — not Phase 1 critical, but flagged where relevant

## Metadata

**Confidence breakdown:**
- Standard stack (Hono, Zod, Supabase, Cloudflare, Node 22): **HIGH** — all synapse-validated; latest versions confirmed via `npm view`
- Architecture (LaunchDaemon + Helper LaunchAgent, JSONL queue, shim binary): **HIGH** for synapse-derived parts; **MEDIUM** for net-new (LaunchAgent helper pattern, managed-settings hook installation, OAuth attach flow)
- Pitfalls (cache token semantics, EV cert SmartScreen change, LaunchDaemon FDA): **HIGH** — externally verified from official Anthropic + Microsoft + Apple sources
- Package legitimacy: **LOW** confidence per protocol (slopcheck unavailable); planner must add per-install verification checkpoints
- Code-signing pipeline (Apple notarytool + stapler + productsign): **HIGH** — Apple docs are explicit and recent (April 2026 baseline)
- Windows EV cert procurement (cost, timeline, SmartScreen behaviour): **MEDIUM** — vendor prices vary; SmartScreen policy change (March 2024) is multi-sourced but not from a Microsoft KB

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (most components are stable; revisit only if Anthropic publishes a Claude Code 2.x hook schema change, or Microsoft updates SmartScreen policy, or Apple changes notarytool flags)
