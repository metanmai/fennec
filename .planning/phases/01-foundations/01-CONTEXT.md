# Phase 1: Foundations - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 wires the canonical event schema, the daemon skeleton, the Claude Code hook adapter, and the ingest endpoint end-to-end on macOS — with capture-time secret redaction, dedupe on retry, daemon-restart survival, and adapter heartbeats. The smoke proof: a prompt typed in Claude Code on macOS arrives as a row in `ai_events` in Supabase within 5 minutes via the daemon and its sync loop.

**Scope expansion via discussion:** code-signing (Apple notarisation in v1, Windows EV-cert preparation) **moves from Phase 5 polish into the Phase 1 critical path** because v1 distribution is signed installers only — there is no npm-global path for end-users. The first-run flow depends on a signed `.pkg` and an Apple-notarised binary, so Phase 1 cannot ship without them.

**Strictly out of scope for Phase 1** (assigned to later phases — DO NOT pull in):
- Linux systemd / Windows service install (→ Phase 5)
- Codex, Gemini, Cursor, Copilot, browser, git-watcher adapters (→ Phase 2)
- Correlation worker, model-fit scorer, daily aggregator (→ Phase 2)
- Org / project / membership / invite UX (→ Phase 3); Phase 1 uses minimal SQL-seeded org/user/project for the smoke test
- Custom redaction rules UI + retention / KMS / GDPR deletion (→ Phase 3)
- Dashboard (→ Phase 4)
- Self-host bundle + license + public repo (→ Phase 6)

</domain>

<decisions>
## Implementation Decisions

### Product Posture (cross-cutting, sets the tone for every Phase 1 mechanic)

- **D-01: fennec is an org-property observability agent, not a developer telemetry tool.** Posture is CrowdStrike-style: system-managed, transparent (`fennec inspect` survives), but uncircumventable (`fennec pause` is gone). This is a deliberate departure from PROJECT.md's surveillance-perception mitigation stance.
- **D-02: Tamper-resistance is always-on, with an admin escape hatch.** Every install — including indie / personal use — is system-level. In personal mode the local user is the admin of their single-member org and can sudo their way to uninstall. In org mode the org admin holds the keys and the dev cannot kill the daemon without IT.
- **D-03: Knowingly walks away from PITFALLS Pitfall 8 (developer surveillance perception is the adoption killer).** The product compensates for this risk via transparency (`fennec inspect`) and default org-aggregate dashboard views (PRIV-06, already in Phase 3 scope), but the team accepts that some bottom-up adoption motion is sacrificed in exchange for the stronger governance / cost-visibility story to engineering leadership. **Flag for re-evaluation at every milestone close.**

### Distribution (Phase 1 critical-path impact)

- **D-04: v1 distribution is signed installers ONLY. No `npm install -g fennec` as a user-facing path.**
  - macOS: signed `.pkg` (Apple Developer ID) + Apple notarisation + stapling
  - Windows: signed `.msi` (EV code-signing cert)
  - Linux: signed `.deb` and `.rpm` (apt + yum repos)
  - Cross-platform: Homebrew tap (`brew install fennec`) + curl-bash installer (`curl -fsSL fennec.dev/install.sh | sudo bash`)
- **D-05: Code-signing scope moves from Phase 5 polish to Phase 1 critical-path.** Phase 1 must ship Apple-notarised macOS binary. Windows EV-cert acquisition and `.msi` signing pipeline must also be set up in Phase 1 (even though the Windows daemon itself stays in Phase 5), because the certificate-reputation warm-up clock (~30 days) starts at first signature. Buy the EV cert in Phase 1.
- **D-06: Synapse's `npm install -g fennec` pattern is explicitly NOT followed.** Fennec is a signed system agent like Tailscale / 1Password CLI / Datadog Agent, not a Node-flavoured CLI tool.

### Install Actor (org-tier path)

- **D-07: Org-tier install at v1 is MDM-only.** Jamf / Intune / Workspace ONE deployment is the sole org path. No admin-elevated `fennec install --org-token <t>` CLI fallback ships at v1. This is aggressive and slows the first sale (IT approval gate), but commits to the strongest tamper-resistance story.
- **D-08: MDM-deployable artefacts in v1 scope:** signed `.pkg` with macOS Configuration Profile schema; signed `.msi` with Intune ADMX template; `.deb` with optional pre-seeded config; the install secret is delivered via the MDM payload (e.g., a `org_install_secret` key in the configuration profile).
- **D-09: Phase 1 ships MDM-PRIMITIVES not full MDM-templates.** The signed `.pkg` and a JSON config-schema spec land in Phase 1; the polished Jamf / Intune ADMX manifests land in Phase 5 (cross-platform polish). Phase 1 proves the install-with-secret mechanism is correct; Phase 5 polishes for actual IT-team rollout.

### Personal / Indie Install Path

- **D-10: Indie install uses the SAME signed artefacts as MDM.** No separate codepath. Indie devs run a signed `.pkg` / `.msi` / `.deb`, brew, or curl-bash; the first-run wizard handles a "personal mode" flow that auto-creates a single-member org with the local user as admin and trades a self-issued install secret for a per-machine API key. Code path is identical to org enrollment; the only difference is **where** the install secret comes from (MDM payload vs self-issued by the wizard).

### Daemon Identity

- **D-11: Hybrid identity model.** Daemon enrolls via `POST /api/daemons/enroll { install_secret, machine_id, hostname }` and trades the org install secret for a per-machine API key. THEN the human identity attaches via dev-OAuth (Google / GitHub / Microsoft SSO).
- **D-12: Both org and individual are first-class.** Events are tagged `org_id` (always present after enrollment) and `user_id` (present after dev-OAuth attach; tagged `unknown@${hostname}` until attach happens; backfilled on first attach within the org).
- **D-13: API keys are per-machine, not per-user.** A user with three machines has three per-machine API keys; cross-machine identity merge happens server-side at user_id resolution time, not at the daemon. (Aligns with research synthesis and PITFALLS Pitfall 11.)

### Dev-OAuth Attach UX

- **D-14: Browser auto-open + tray notification.** On first boot after MDM-install, the daemon detects no dev-identity attached, surfaces a macOS / Windows / Linux system notification ("Sign in to fennec to attribute your AI usage"), and auto-opens the default browser to the SSO flow. The notification persists across reboots until attached.
- **D-15: Until dev signs in, events are still captured.** Pre-attach events are stored with `user_id = unknown@${hostname}`; on first successful SSO attach, the backend backfills the `user_id` for all `unknown@${hostname}` events for that machine within the org. Backfill is one-shot per machine.

### Tamper-Resistance / Capture Continuity

- **D-16: `fennec pause` (CAP-17) is REMOVED.** Daemon runs always. There is no user-controlled pause mechanism. Tradeoff: the strongest tamper-resistance story; cost: cannot offer a "private moment" mode and the PITFALLS P8 surveillance-perception mitigation surface shrinks meaningfully.
- **D-17: `fennec inspect` (CAP-18) is KEPT.** Dev can see exactly what was captured locally in the last 24 hours, with redactions visible. Transparency without dev-agency. Stays in Phase 2 (its current roadmap home).
- **D-18: Daemon uninstall requires the org-token in org-tier, sudo in personal-tier.** Uninstall via MDM-revoke is the supported org path; a manual `sudo fennec uninstall --org-token <t>` exists for break-glass. Each uninstall emits an audit event the org admin sees in the eventual dashboard (Phase 4).

### Hook Installation (Claude Code, Phase 1 specific)

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

### Phase 1 Multi-Tenant Bootstrap

- **D-25: Phase 1 does NOT build the full org / membership UX (that's Phase 3).** Phase 1 ships:
  - Database schema with `orgs`, `users`, `api_keys`, `projects`, `org_members`, `ai_events`, `adapter_heartbeats` tables
  - A SQL seed script that creates one test org + one test user + one test API key for the Phase 1 smoke test
  - The enrollment endpoint (`POST /api/daemons/enroll`) — minimal version that accepts an install secret and returns an API key
  - **No** sign-up UI, **no** invite flow, **no** dashboard, **no** API-key management UI — those are Phase 3
- **D-26: All Phase 1 schema is multi-tenant-correct from day 1.** Every customer-data row carries `org_id`. RLS policies are written even though only one tenant exists in Phase 1. Mandatory: this cannot be retrofitted without painful migrations.

### Cross-Phase Scope Impact (requires REQUIREMENTS.md + ROADMAP.md edits)

- **D-27: CAP-17 (`fennec pause`) is REMOVED from REQUIREMENTS.md** before planning Phase 2.
- **D-28: DAE-12 (`npm install -g fennec`) is REPLACED in REQUIREMENTS.md** with new requirements for signed installers (`.pkg`, `.msi`, `.deb`, brew tap, curl-bash). Renumber or amend; planner should propose the exact new REQ-IDs.
- **D-29: DAE-08 (Apple notarisation) and DAE-09 (Windows EV signing) MOVE from Phase 5 to Phase 1.** Phase 5's success criteria stay correct (cross-platform daemon polish) but signing readiness shifts.
- **D-30: NEW requirements to add to REQUIREMENTS.md** (planner to assign IDs):
  - Org daemon enrollment endpoint (`POST /api/daemons/enroll`)
  - Per-machine API key model + storage (system-protected path on each OS)
  - Dev-OAuth attach flow (browser auto-open from daemon + backend SSO endpoint)
  - Tray-notification system on first-run + un-attached states
  - MDM packaging primitives in Phase 1; polished MDM manifests (Jamf config profile, Intune ADMX) in Phase 5
  - Managed-settings hook installation mechanism (cross-platform path handling)
  - Hook handler shim binary + IPC protocol with daemon
  - `fennec uninstall` with org-token gate + audit event
- **D-31: This CONTEXT.md is authoritative until REQUIREMENTS.md / ROADMAP.md are updated.** Planner should propose the REQUIREMENTS / ROADMAP diffs as part of the plan-phase output and merge them before execution.

### Claude's Discretion

The planner / researcher has flexibility on:
- Loopback IPC mechanism between hook shim and daemon: HTTP vs Unix socket vs named pipe (Windows). Lean toward Unix socket on macOS/Linux for permission-scoped access; named pipe on Windows. HTTP is acceptable if simpler. Document the choice and security model.
- Local queue durability mechanism: append-only JSONL with rotation per synapse pattern is the default; switching to SQLite WAL is acceptable if the planner can justify it. Either way, crash-safety + replay-on-restart is the bar.
- `org_install_secret` rotation: how often, how surfaced, who can rotate. v1 acceptable answer = "rotated only on org-admin request via support; no auto-rotation"; v1.x adds self-service rotation.
- Where the per-machine API key lives on disk: must be system-protected (root-only readable). Candidate paths: `/var/db/fennec/key` (macOS), `/var/lib/fennec/key` (Linux), `%ProgramData%\fennec\key` (Windows). Planner to confirm against platform conventions and code-signing requirements.
- Schema-hash drift detection mechanism (CAP-15): the exact hash input (field-name set? payload-shape fingerprint? sample-based?) is a planner choice; the requirement is just that it detects upstream changes and surfaces "adapter offline" status.
- Canonical event schema field names, exact token-shape (Anthropic Usage object vs flatter), and `idempotency_key` derivation — all delegated to researcher / planner with the constraint that ANL-06 (cache_creation_input_tokens + cache_read_input_tokens captured separately) must be honoured.
- Secret-redaction default rule set (gitleaks default ~150 patterns vs hand-picked) — delegated to researcher / planner with the constraint that capture-time redaction MUST ship in Phase 1 and PRIV-01 must pass canary-secret testing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project foundation

- `.planning/PROJECT.md` — Project framing, core value, constraints, scope decisions, evolution rules
- `.planning/REQUIREMENTS.md` §v1 Requirements §Capture (CAP) §Privacy & Redaction (PRIV) §Authentication & Multi-tenancy (AUTH) §Ingestion (ING) §Analysis (ANL) §Daemon Lifecycle (DAE) — Phase 1's requirements live across these sections. **Note: REQUIREMENTS.md will be edited per D-27, D-28, D-29, D-30 before Phase 2 — planner should propose the diffs.**
- `.planning/ROADMAP.md` §Phase 1 — Goal, success criteria, requirement list. **Note: Phase 1 scope expanded via this discussion (code-signing moved in); planner to propose ROADMAP edits.**
- `.planning/STATE.md` — Current project position and accumulated init decisions

### Research synthesis (load-bearing for Phase 1 design)

- `.planning/research/SUMMARY.md` — Cross-cutting summary; especially the "Phase 1: Foundations" section and the "Key Research Tensions — Resolved" section
- `.planning/research/STACK.md` — TypeScript / Node 22 / Hono 4.12 / Supabase / SvelteKit / Biome / Vitest stack. **Note: STACK.md's "Daemon distribution: `npm install -g fennec`" recommendation is OVERRIDDEN by D-04 (signed installers only). Use synapse's launchd patterns, NOT its npm-distribution pattern. Phase-1 researcher must investigate signed-installer pipelines (Apple Developer ID workflow, notarytool + stapling, Windows EV-cert acquisition + signtool, Linux `.deb` / `.rpm` signing).**
- `.planning/research/ARCHITECTURE.md` — Single-process daemon + adapter registry pattern, append-only JSONL local queue with rotation, ingest-dumb-analysis-async pattern, event schema in `packages/shared/`, six anti-patterns to avoid
- `.planning/research/FEATURES.md` — Competitor landscape, table-stakes / differentiators / anti-features categorisation
- `.planning/research/PITFALLS.md` — **§Pitfall 1** (secrets-in-prompts — capture-time redaction non-retrofittable, MUST ship in Phase 1); **§Pitfall 3** (silent adapter breakage — heartbeats with `events_parsed` + `parse_errors` + `schema_hash` drift detection from Phase 1); **§Pitfall 5** (multi-tenant isolation defence-in-depth — schema must be tenant-correct from day 1); **§Pitfall 7** (cache-token capture — `cache_creation_input_tokens` and `cache_read_input_tokens` separately from day 1); **§Pitfall 8** (developer surveillance perception — **knowingly partial mitigation per D-03, flag for milestone re-evaluation**); **§Pitfall 11** (per-machine API key + cross-machine identity); **§Pitfall 12** (Windows EV cert reputation warm-up — start in Phase 1 per D-05); **§Pitfall 13** (corporate proxy compatibility — `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY` honoured); **§Pitfall 15** (synapse coexistence — D-20 resolves)

### Synapse (reference architecture — read patterns, don't copy code)

- `~/Documents/synapse/mcp/src/capture/os-service.ts` — daemon lifecycle, launchd / systemd unit templates (fennec uses LaunchDaemon, not LaunchAgent — system-level not user-level)
- `~/Documents/synapse/mcp/src/capture/events-log.ts` — JSONL append-only queue pattern with rotation (fennec follows this)
- `~/Documents/synapse/mcp/src/capture/adapters/codex.ts` — file-watcher adapter pattern (fennec's Codex/Gemini adapters in Phase 2 will mirror this)
- `~/Documents/synapse/CLAUDE.md` — synapse working context including hook installation patterns; **but note: synapse writes to `~/.claude/settings.json` (user-layer); fennec writes to managed-settings (system-layer) per D-19. They coexist non-interferingly per D-20.**

### External documentation (for researcher / planner verification)

- Claude Code hook reference docs (canonical hook-event list + managed-settings semantics — research must verify managed-settings supports hooks in the current Claude Code release before Phase 1 implementation; this is the single biggest open assumption underlying D-19)
- Apple Developer ID + notarytool / stapling documentation (Phase 1 macOS signing pipeline)
- Windows EV code-signing cert vendor docs + signtool reference (Phase 1 Win EV warm-up start)
- macOS `.pkg` / Configuration Profile schema (`mobileconfig`) reference; Linux `.deb` / `.rpm` repo setup; Homebrew formula authoring guide
- OAuth 2.0 + PKCE for native applications (Phase 1 daemon dev-attach SSO flow uses this; never use the deprecated implicit flow)

</canonical_refs>

<code_context>
## Existing Code Insights

Fennec is greenfield — no source code, no `.planning/codebase/*.md` maps. All design decisions are net-new for Phase 1.

### Reusable Patterns (from synapse, conceptually)

- **Daemon launchd / systemd templates** — `~/Documents/synapse/mcp/src/capture/os-service.ts` defines the lifecycle pattern. Fennec adapts it to LaunchDaemon (system) instead of LaunchAgent (user).
- **Append-only JSONL queue with rotation** — `~/Documents/synapse/mcp/src/capture/events-log.ts`. Same pattern, same JSONL format, same rotation policy.
- **Hook-handler shim wrapping** — synapse writes shell snippets into hook entries; fennec writes a compiled binary path instead (D-21).

### Integration Points (net-new in Phase 1)

- `packages/shared/` — canonical event schema (`CanonicalEvent`, `AdapterHeartbeat`, related types)
- `daemon/` — adapter registry, JSONL queue, sync loop, Claude Code hook adapter, redaction module, OS-service installer (macOS LaunchDaemon in Phase 1)
- `backend/` — Hono Worker, ingest endpoint, daemon enrollment endpoint, Supabase migrations, RLS policies
- `installer/` — `.pkg` build pipeline, Apple notarisation hooks, Windows EV-signing pipeline (acquisition + warm-up only at Phase 1), brew formula stub, curl-bash installer

</code_context>

<specifics>
## Specific Ideas

- **Hook-handler shim must be a compiled binary, not a Node script.** Synapse uses `node /path/to/handler.js` per its CLAUDE.md; fennec uses a compiled shim to avoid the Node-startup penalty per hook fire (~150ms cold start saved → ~10-15ms warm shim) and to avoid requiring the user / IT to have Node installed. Build the shim in Go, Rust, or Zig — anything that produces a tiny static binary. Researcher to recommend the right tool; planner picks one.
- **Tailscale / 1Password CLI is the reference UX** for first-run on signed-installer products. Researcher should study Tailscale's `tailscale up` flow specifically — system service + signed installer + browser-auth on first run + tray icon for status — as the closest existing pattern to fennec's first-run flow.
- **No npm-global means the dev-mode (contributor / hacker) workflow needs documentation.** Contributors building fennec from source need a clear `npm run dev` story even though end users never use npm. Probably: contributor docs include `npm run install:dev` that installs the daemon from local build into the system path with skipped signing. Planner to design.

</specifics>

<deferred>
## Deferred Ideas

Items raised during discussion that belong in other phases or in follow-up scope edits — not lost:

- **Loopback secret + handshake between hook shim and daemon (security):** preventing a malicious local process from posting fake events to the daemon's loopback bridge. The shim and daemon share a per-install secret; the daemon verifies it on every request. Mechanic-level detail for the planner; flagged here so it doesn't get dropped.
- **`fennec inspect` UX details:** CAP-18 is kept (Phase 2 home) but the exact CLI surface — what filters, what timeframe, what redaction-visibility levels — should be designed when Phase 2 plans CAP-18 specifically. Not for Phase 1.
- **MDM-package polish (Jamf config profile + Intune ADMX templates):** Phase 1 ships the primitives (`.pkg`, `.msi`, config-key schema); Phase 5 polishes for actual IT-team rollout per D-09. Don't pull these into Phase 1.
- **`org_install_secret` rotation / revocation UI:** v1 acceptable answer is "support-only rotation"; self-service rotation is v1.x.
- **`fennec doctor` design:** DAE-04 is currently in Phase 5. Some Phase-5 doctor checks (proxy reachability, CA status) may also be valuable in Phase 1 for the first-run wizard to validate. Surface to planner; OK to defer if Phase 1 is already tight.
- **Auto-update mechanism (security boundary):** out of Phase 1; surface as a Phase 6 distribution-tier concern (D-31 covers cross-phase scope impact but auto-update is genuinely deferred).
- **Per-developer "I'd like to opt out" sales conversation script:** the surveillance-perception tradeoff (D-03) needs sales / customer-success messaging support eventually. Out of Phase 1; flag for the Phase 6 launch-prep phase or whichever phase owns sales enablement.

</deferred>

---

*Phase: 1-Foundations*
*Context gathered: 2026-05-31*
