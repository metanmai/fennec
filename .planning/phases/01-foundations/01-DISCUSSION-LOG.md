# Phase 1: Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 1-Foundations
**Areas discussed:** First-run flow, Hook chaining

**Gray areas presented but not selected:** Event schema, Redaction v1 (user trusted researcher / planner to resolve from PITFALLS + ARCHITECTURE)

---

## First-run flow

### Pre-question framing — user-initiated architectural pivot

When the gray areas were first presented (multiSelect), the user selected First-run flow + Hook chaining AND added freeform direction:

> "For the options selected: This should not just be an API key that the user can remove, that defeats the whole purpose. And simply using a claude configuration is not enough either. This should all be resolved by the daemon process automatically and the daemon cannot be killed by the user. It should be installed on a system level."

This freeform shifted the product posture from synapse-style user-controlled telemetry to CrowdStrike-style system-managed observability agent. Surveillance-perception mitigation in PROJECT.md / PITFALLS Pitfall 8 was surfaced as a knowingly-taken tradeoff before continuing.

### Tamper-resistance reach

| Option | Description | Selected |
|--------|-------------|----------|
| Org-deployed only | Free / OSS / self-host-for-personal-use = user-level synapse-style daemon. Paid SaaS + enterprise = system-level. Two install paths. | |
| Always system-level | Every install (including indie) is system-level. Stronger guarantee, friction for OSS adoption. | |
| Always system-level + admin escape hatch | System-level everywhere, but indie mode = local user is admin (can sudo their way out). Org mode = org-admin holds keys. | ✓ |
| Let me explain | I want to frame this differently. | |

**User's choice:** Always system-level + admin escape hatch.

### Install actor (org tier)

| Option | Description | Selected |
|--------|-------------|----------|
| IT / MDM deployment | CrowdStrike-style: IT pushes signed package via Jamf / Intune / Workspace ONE. Highest trust, longest sales cycle. | ✓ |
| Dev runs admin-elevated installer | Org admin shares `fennec install --org-token <token>`. Dev runs with sudo. Lower friction than MDM. | |
| Both — dev install at launch, MDM in v1.x | v1 launches with dev-elevated; MDM packages come in v1.x. | |

**User's choice:** IT / MDM deployment (sole org-tier path at v1).

### Daemon identity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-machine enrollment | Daemon enrolls with org install secret, trades for per-machine API key. Compromised machine = revoke one machine. | |
| Per-dev OAuth-bound | Daemon ties to dev identity (Google / GitHub SSO). Identity follows the human across machines. | |
| Hybrid: org-enrollment, dev-attached | Daemon enrolls with org secret AND dev signs in to attach human identity. Both first-class. | ✓ |

**User's choice:** Hybrid: org-enrollment, dev-attached.

### CAP-17 (`fennec pause`) policy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep, fully audited | Dev can pause but every pause/resume emits an admin-visible event. | |
| Keep, time-boxed | Dev can pause for max N minutes, auto-resumes. | |
| Admin policy-controlled | Org admin chooses whether pause is allowed. Default allowed + audited. | |
| Remove the pause command | No pause. Daemon runs always. Hardest stance. | ✓ |

**User's choice:** Remove the pause command. CAP-17 explicitly removed from v1 scope. PITFALLS P8 mitigation knowingly weakened.

### MDM-only confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, MDM-only at v1 | Commit. Slower first sale but strongest tamper-resistance story. | ✓ |
| MDM + admin-elevated escape | v1 ships both MDM AND `fennec install --org-token` admin-elevated CLI. | |
| Admin-elevated v1, MDM v1.x | Ship admin-elevated first, add MDM once early customers ask. | |

**User's choice:** Yes, MDM-only at v1. Reconfirmed under explicit "aggressive for a 4-8 week solo build" framing.

### Indie install command

| Option | Description | Selected |
|--------|-------------|----------|
| sudo npm i -g fennec + fennec wizard | Dev runs sudo npm i -g, then sudo fennec wizard. Same code as org-tier; user is admin of personal org. | |
| Homebrew / curl|sudo bash installer | brew install fennec / curl-bash. More 'agent-like' feel, more legit for a system agent. | |
| Both — npm-global at launch, brew/curl in v1.x | Ship npm-global at v1, add brew/curl in v1.x. | |
| Free-text answer | "The setup should be similar to any other MDM tool, however that is done" | ✓ |

**User's free-text answer:** "The setup should be similar to any other MDM tool, however that is done."

**Reflected-back interpretation (confirmed in next question):** Indie install uses the SAME signed-installer artefacts as the MDM path. Tailscale-style. No separate npm-global codepath.

### Dev-OAuth attach UX

| Option | Description | Selected |
|--------|-------------|----------|
| Browser auto-open + tray notification | Daemon surfaces system notification + auto-opens browser to SSO flow. Events tagged `unknown@${hostname}` until attach. | ✓ |
| CLI nag + email reminder | Terminal banner + email link. Less invasive, slower convergence. | |
| Pre-mapped from MDM (no dev action) | MDM payload includes the dev's identity. Zero UX friction, enterprise-only. | |
| Let me describe | I have a different mechanic in mind. | |

**User's choice:** Browser auto-open + tray notification.

### Distribution mechanism — reconfirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, signed installers only | v1 = .pkg + .msi + .deb + brew + curl-bash. No npm-global. Code-signing moves Phase 5 → Phase 1. | ✓ |
| Signed installers + keep npm-global as a dev-mode option | Signed installers primary; npm-global stays as contributor mode only. | |
| I'm reading too much into this — keep npm-global at launch | Personal install via sudo npm i -g; only org-tier needs signed packages. | |

**User's choice:** Yes, signed installers only. v1 distribution definitively pivots from synapse's npm pattern.

---

## Hook chaining

### Hook home (where fennec writes hook entries)

| Option | Description | Selected |
|--------|-------------|----------|
| Managed settings (system path) | Write to Claude Code's managed-settings file (system-protected). Tamper-resistant by file permissions. Requires CC to support hooks in managed-settings. | ✓ |
| User settings + filesystem-watch enforcement | Write to ~/.claude/settings.json like synapse; daemon also watches and re-injects if removed. Cat-and-mouse but works regardless of CC support. | |
| Both — managed-settings primary, user-settings watch as fallback | Belt-and-suspenders. | |
| Different mechanism entirely | Hooks aren't the right primitive — wrap the `claude` binary, intercept at process level. | |

**User's choice:** Managed settings (system path). **Open assumption flagged in CONTEXT.md:** the researcher must verify Claude Code's managed-settings layer actually supports hooks in the current CC release before Phase 1 implementation. If it doesn't, this decision falls back to option 2 (filesystem-watch enforcement).

### Hook merge semantics (with synapse user-settings)

| Option | Description | Selected |
|--------|-------------|----------|
| Both fire (additive) | CC merges hook lists additively across layers. Both fennec and synapse fire. Non-interfering. | ✓ |
| Managed wins (override) | Fennec's managed-settings entries replace user-level. Only fennec fires. Hostile to synapse. | |
| Managed fires first, then user | Deterministic ordering; fennec captures first, then synapse. | |

**User's choice:** Both fire (additive). Synapse coexistence is non-interfering — they live in different settings layers and Claude Code's default merge fires both.

### Hook handler

| Option | Description | Selected |
|--------|-------------|----------|
| Tiny shim that IPCs to the running daemon | Hook entry = compiled shim, POSTs to daemon's loopback bridge, exits. ~10-15ms per fire. Daemon does all real work. | ✓ |
| Self-contained binary handler | Hook entry = full handler binary. No daemon dependency. ~50-200ms per process spawn. | |
| Node script via system Node | Hook entry = `node /usr/local/fennec/lib/hook-handler.js`. Synapse pattern. Slower, needs system Node, debuggable. | |

**User's choice:** Tiny shim that IPCs to the running daemon.

### Uninstall behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Surgical removal from managed-settings only | Removes only fennec's entries; leaves file intact; never touches user-settings. Synapse keeps working. | ✓ |
| Replace managed-settings with empty file | Blank fennec's managed-settings (or delete it). Equivalent if only fennec writes there. Simpler. | |
| Admin token required + audit log | Uninstall requires org-token; emits audit event the admin sees. Tighter governance. | |

**User's choice:** Surgical removal from managed-settings only. (Note: admin-token + audit event is captured separately in D-18 as the orchestration around the surgical removal — the user picked surgical-removal as the file-edit mechanism, while D-18 covers the policy gate.)

---

## Claude's Discretion

Areas the user explicitly delegated to researcher / planner, as documented in `01-CONTEXT.md` §Implementation Decisions §Claude's Discretion:

- Loopback IPC mechanism between hook shim and daemon (HTTP vs Unix socket vs named pipe)
- Local queue durability mechanism (JSONL with rotation vs SQLite WAL)
- `org_install_secret` rotation / revocation (v1 = support-only; v1.x = self-service)
- Per-machine API key disk-storage paths per OS
- Schema-hash drift detection mechanism (CAP-15)
- Canonical event schema field names, token-shape, idempotency_key derivation (with ANL-06 cache-token constraint honoured)
- Secret-redaction default rule set (gitleaks-default vs hand-picked, with PRIV-01 capture-time + canary-secret testing constraints honoured)

The user also opted out of explicit Event-schema and Redaction-v1 discussions at the "Done?" gate, trusting PITFALLS + ARCHITECTURE to give the researcher / planner enough to resolve them.

---

## Deferred Ideas

Items raised during the discussion that belong in other phases — captured in CONTEXT.md §Deferred Ideas:

- Loopback secret + handshake between hook shim and daemon (security mechanic for the planner)
- `fennec inspect` UX details (CAP-18 stays in Phase 2)
- MDM-package polish — Jamf config profile + Intune ADMX templates (Phase 5)
- `org_install_secret` rotation / revocation UI (v1.x)
- `fennec doctor` design (currently Phase 5; some checks may be valuable in Phase 1's wizard)
- Auto-update mechanism (Phase 6 distribution-tier concern)
- Per-developer surveillance-perception sales messaging (Phase 6 launch-prep)
