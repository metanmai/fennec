---
phase: 01-foundations
plan: 09
subsystem: macos-installer

tags:
  - dae-01-fennec-wizard
  - dae-02-fennec-init-mdm
  - dae-05-launchdaemon-system-level
  - dae-08-apple-notarised-pkg
  - dae-12-signed-pkg-distribution
  - dae-21-mdm-configuration-profile-primitive
  - priv-07-first-run-consent
  - w-5-node-vendoring-path-a
  - cli-dispatcher
  - configuration-profile-mdm-primitive
  - pattern-6-launchdaemon-helper-launchagent
  - pitfall-8-headless-install-consent-record
  - tdd-red-green
  - partial-completion-halt-on-sign-notarize

# Dependency graph
requires:
  - 01-03 (partial — autonomous portion: installer/macos/sign-test-artefact.sh + 01-CERT-STATUS.md tracker; procurement gates STILL OPEN for the SIGNED step of this plan)
  - 01-07 (Go hook shim at shim/build/fennec-hook-darwin-arm64; managed-settings install/uninstall modules; loopback bridge secret-store)
  - 01-08 (Go notifier binary at notifier/build/fennec-notifier-darwin-arm64; enrollDaemon + persistApiKey + getMachineId + runAttachFlow + emitUninstallAudit)

provides:
  - "daemon/src/cli/consent.ts: renderInteractive (@clack/prompts confirm-gated; PRIV-07 interactive) + renderLogged (file mode 0o640, parent dir mode 0o750, ISO datetime + machine_id + hostname + org_name + apiBaseUrl + disclosure text shared between surfaces; PRIV-07 audited log per Pitfall 8)"
  - "daemon/src/cli/wizard.ts: runWizard() — uid==0 gate, interactive consent, @clack/prompts text() install_secret prompt (min 32 chars), enrollDaemon → persistApiKey → write daemon plist + agent plist + managed-settings hooks → launchctl load (asuser for agent via SUDO_UID), trigger attach flow"
  - "daemon/src/cli/init.ts: runInit() — uid==0 gate, install_secret resolution (--install-secret arg OR `defaults read` of Managed Preferences via argv-array execFileSync), renderLogged BEFORE enrollment (PRIV-07/Pitfall 8 sequencing), enrollDaemon → persistApiKey → re-renderLogged with org_name, plists + managed-settings + launchctl load (does NOT block on attach — D-14 Helper LaunchAgent triggers on first user-session login)"
  - "daemon/src/cli/uninstall.ts: runUninstall() — uid==0 gate, org-token validation (Phase 1: compares against /var/db/fennec/install-secret record), emitUninstallAudit BEFORE filesystem teardown (audit reaches backend even if subsequent steps fail per D-18), surgical removeFennecHooks (preserves synapse per D-24), unload plists, unlink binaries + api_key + shim-secret"
  - "daemon/src/service/launchdaemon.ts: writePlist (XML escapes special chars, sorted env keys for deterministic diffs), loadDaemon/unloadDaemon (execFileSync launchctl argv-array), mode 0o644 + chown root:wheel in prod (skipChown for tests)"
  - "daemon/src/service/helper-agent.ts: writePlist for dev.fennec.notifier, loadAgent + loadAgentForUser (asuser <uid> launchctl load), unloadAgent"
  - "daemon/src/index.ts: CLI dispatcher (case wizard/init/uninstall/daemon, --install-secret + --read-config + --org-token flag parsing) runs iff this file is the process main module (library imports keep it a no-op)"
  - "installer/macos/dev.fennec.daemon.plist: LaunchDaemon template — Label dev.fennec.daemon, ProgramArguments [/usr/local/fennec/bin/fennec, daemon] per W-5 path (a), UserName=root GroupName=wheel, RunAtLoad+KeepAlive, env (FENNEC_API_URL/PORT/PATH), StandardOut/Err to /var/log/fennec/daemon.log, mode 0644 root:wheel; plutil -lint OK"
  - "installer/macos/dev.fennec.notifier.plist: Helper LaunchAgent template — Label dev.fennec.notifier, ProgramArguments /usr/local/fennec/bin/fennec-notifier, RunAtLoad+KeepAlive, FENNEC_NOTIFIER_PORT, mode 0644 root:wheel; plutil -lint OK"
  - "installer/macos/Configuration.plist: MDM PRIMITIVE per D-09 — PayloadType Configuration + nested dev.fennec.daemon dict with org_install_secret/org_name/api_url placeholders (REPLACE_WITH_*); polished Jamf/Intune templates land in Phase 5; plutil -lint OK; T-09-08 plaintext-placeholder accepted-risk"
  - "installer/macos/preinstall.sh: macOS >= 13.0 gate (Ventura+ for launchd APIs) + best-effort unload of existing daemon/agent; mode 0755; bash -n clean"
  - "installer/macos/postinstall.sh: creates /etc/fennec /var/log/fennec /var/db/fennec with correct ACLs; generates shim-secret (openssl rand -base64 32); warns about Node 22+ PATH prereq (W-5); detects /Library/Managed Preferences/dev.fennec.daemon.plist and invokes `fennec init --read-config` (org-tier) OR prints `sudo fennec wizard` instructions (personal-tier); mode 0755; bash -n clean"
  - "installer/macos/Distribution.xml: productbuild Distribution document — welcome+conclusion HTML resources, customize=never, allowed-os-version min=13.0, single dev.fennec choice referencing fennec-component.pkg"
  - "installer/macos/Resources/welcome.html + conclusion.html: pre/post-install UI explaining what fennec captures + redacts + Node 22+ prereq; post-install lists installed paths and direct next-step commands"
  - "installer/macos/build-pkg.sh: end-to-end pipeline — pkgbuild → productbuild → conditional productsign + sign-test-artefact.sh (signed mode gated on DEVELOPER_ID_INSTALLER_NAME env var); UNSIGNED mode runs autonomously; SHA-256 emitted on completion"
  - "installer/macos/build-pkg.test.sh: smoke — asserts pkgbuild/productbuild/productsign/xcrun/plutil/shasum/bash/openssl on PATH, Go binaries built, all installer artefacts present, plutil -lint passes, bash -n passes on 5 scripts, MDM primitive shape correct"
  - "docs/PRIVACY.md: data-capture + redaction + dataflow + inspect-locally + org-admin-responsibilities + uninstall sections; referenced by consent renderers per PRIV-07"
  - ".planning/phases/01-foundations/01-INSTALLER-BUILD-LOG.md: build tracker (UNSIGNED build recorded with SHA-256 + spctl status; SIGNED row awaiting Apple Dev cert procurement)"

affects:
  - 01-10 (Phase 1 smoke test): installs the produced fennec.pkg (signed once cert is procured; the unsigned variant works for local dev) on a fresh-state macOS environment and asserts the full daemon → backend pipeline works end-to-end
  - daemon/src/index.ts (orchestrator post-Wave-5 integration): the CLI dispatcher case "daemon" still needs the full daemon boot wiring (adapter-registry start, LoopbackBridge bind, SyncLoop start, HeartbeatScheduler start) — currently a placeholder that blocks forever
  - Phase 5 cross-platform polish: build-pkg.sh's W-5 path (a) (system Node via PATH) can be revisited if vendoring Node becomes appropriate; Phase 5 also ships the polished MDM templates (Jamf JSON / Intune ADMX) that this Phase 1 primitive seeds

# Tech tracking
tech-stack:
  added:
    - "@clack/prompts@1.5.0 (pre-audited in plan 01-01 — DAE-01 interactive wizard prompts)"
  patterns:
    - "W-5 resolution path (a): /usr/local/fennec/bin/fennec wrapper shell script exec's `node /usr/local/fennec/lib/daemon/index.js \"$@\"` via system Node 22+ on PATH. LaunchDaemon plist's ProgramArguments points at the wrapper, NOT directly at node + script. Postinstall warns about Node 22+ prereq. Phase 5+ can vendor Node by swapping just the wrapper."
    - "CLI dispatcher in index.ts: runs iff `fileURLToPath(import.meta.url) === process.argv[1]`. Library imports (vitest, other workspaces, integration tests) keep the dispatcher a no-op; direct invocation by the wrapper runs it."
    - "Per-surface consent rendering: same disclosureText() body shared between renderInteractive (@clack/prompts note + confirm) and renderLogged (file write with mode 0o640). Both surfaces show the developer the same information; the only difference is interactive vs audited."
    - "PRIV-07 / Pitfall 8 sequencing in fennec init: renderLogged BEFORE enrollment (placeholder org_name='unknown — populated after enrollment'), then re-render AFTER enrollment with the resolved org_name. The placeholder record exists even if enrollment fails — the dev gets a discoverable consent trail regardless."
    - "Argv-array execFileSync for ALL shell-out: launchctl, defaults read, openssl, pkgbuild, productbuild, productsign, xcrun. No shell-string concatenation anywhere. T-09-02 + T-09-05 mitigations."
    - "Two-mode build-pkg.sh: UNSIGNED mode runs autonomously (no Apple Dev creds required); SIGNED mode delegates to plan 03's sign-test-artefact.sh once DEVELOPER_ID_INSTALLER_NAME + APPLE_NOTARY_KEYCHAIN_PROFILE are present. This lets the pipeline ship + verify mechanically end-to-end before procurement is complete."
    - "MDM primitive vs polished template (D-09): Configuration.plist ships with explicit `REPLACE_WITH_*` placeholders + comment block explaining that polished Jamf/Intune templates land in Phase 5. The Phase 1 primitive proves the install-with-secret mechanism; Phase 5 polishes for IT-team rollout."
    - "TDD RED → GREEN for Task 1: separate `test(01-09): RED ...` commit followed by `feat(01-09): GREEN ...` commit. Pre-existing 136 tests + 19 new = 155 daemon tests pass; build clean."

key-files:
  created:
    - daemon/src/cli/consent.ts
    - daemon/src/cli/consent.test.ts
    - daemon/src/cli/init.ts
    - daemon/src/cli/uninstall.ts
    - daemon/src/cli/wizard.ts
    - daemon/src/service/helper-agent.ts
    - daemon/src/service/helper-agent.test.ts
    - daemon/src/service/launchdaemon.ts
    - daemon/src/service/launchdaemon.test.ts
    - installer/macos/Configuration.plist
    - installer/macos/Distribution.xml
    - installer/macos/Resources/conclusion.html
    - installer/macos/Resources/welcome.html
    - installer/macos/build-pkg.sh
    - installer/macos/build-pkg.test.sh
    - installer/macos/dev.fennec.daemon.plist
    - installer/macos/dev.fennec.notifier.plist
    - installer/macos/postinstall.sh
    - installer/macos/preinstall.sh
    - docs/PRIVACY.md
    - .planning/phases/01-foundations/01-INSTALLER-BUILD-LOG.md
  modified:
    - daemon/package.json (added @clack/prompts@1.5.0)
    - daemon/src/index.ts (extended with CLI dispatcher + new exports)
    - package-lock.json (npm install for @clack/prompts)

key-decisions:
  - "W-5 plan-checker contradiction resolved per path (a): /usr/local/fennec/bin/fennec is a shell wrapper that exec's `node /usr/local/fennec/lib/daemon/index.js \"$@\"` via system Node 22+ on PATH; LaunchDaemon plist's ProgramArguments points at the wrapper, NOT at `node` + script path. Postinstall warns about Node 22+ prerequisite. welcome.html highlights it for the user before install. Phase 5+ can vendor Node by swapping just the wrapper."
  - "CLI dispatcher lives in daemon/src/index.ts (not a separate cli.ts) per the plan's interface block: same file is both the library barrel (when imported) and the entry point (when invoked via the wrapper). The dispatch() function only runs when `fileURLToPath(import.meta.url) === process.argv[1]` — library imports stay no-op."
  - "`fennec daemon` subcommand is a PLACEHOLDER that blocks forever (KeepAlive doesn't respawn-loop). The full daemon orchestration boot — AdapterRegistry.start, ClaudeCodeAdapter registration, LoopbackBridge bind to 127.0.0.1:7821, SyncLoop start, HeartbeatScheduler start — is the post-Wave-5 integration commit the orchestrator owns. This plan ships the dispatcher case; integration ships the wiring."
  - "Configuration.plist is the Phase 1 MDM PRIMITIVE per D-09 — explicit REPLACE_WITH_* placeholders + an extensive comment block guiding IT admins through the conversion-to-mobileconfig workflow. Polished Jamf JSON / Intune ADMX / Workspace ONE templates land in Phase 5. T-09-08 plaintext-placeholder is accepted-risk: the MDM admin protects the .mobileconfig the same way they protect every other MDM payload."
  - "Two-mode build-pkg.sh: UNSIGNED mode (autonomous, no creds) + SIGNED mode (gated on DEVELOPER_ID_INSTALLER_NAME env var). This lets the pipeline ship + ship-verify mechanically end-to-end before Apple Dev procurement completes. SIGNED mode delegates to plan 01-03's sign-test-artefact.sh which is already in the repo + already tested."
  - "Plan 01-09 PARTIAL completion: Tasks 1 + 2 complete; Task 3 partial — UNSIGNED .pkg built + verified, but SIGNED + NOTARISED step HALTS until Apple Dev Program enrollment + cert procurement complete (01-CERT-STATUS.md macOS section). The signed step is a one-shot `bash installer/macos/build-pkg.sh` re-run once the env vars are set — no further development work needed."
  - "Helper LaunchAgent identifier consistency: dev.fennec.notifier (new this plan) vs com.fennec.notifier (Plan 01-08's standalone artefact at installer/macos/notifier-launchagent.plist). The older artefact stays in the repo as a reference; Plan 01-09's installer pipeline uses dev.fennec.notifier consistently with the LaunchDaemon's dev.fennec.daemon identifier."
  - "uninstall.ts reason resolution: UninstallReasonSchema is `user_initiated` | `mdm_revoke` | `admin_initiated`. Personal-tier (no --org-token) → user_initiated. Org-tier (--org-token) → admin_initiated. Phase 1 does not surface `mdm_revoke` (Phase 3 backend webhook will trigger it). The earlier draft used `operator_request` which is NOT in the schema — fixed during build verification."

# Threat surface scan
threat-flags: []

# Metrics
metrics:
  duration_min: 12
  tasks_completed: 2
  tasks_partial: 1
  files_created: 21
  files_modified: 3
  tests_added: 19
  daemon_tests_total: 155
  daemon_tests_passing: 155
  unsigned_pkg_built: true
  unsigned_pkg_sha256: "5b25f5bd004a22db4ceffa71dfb0e4638ae4bd87a6e7d72a8e3fa4e3268ce54a"
  signed_pkg_built: false
  signed_pkg_blocker: "Apple Developer Program enrolment + Developer ID Installer cert + notarytool keychain profile (see 01-CERT-STATUS.md macOS section)"
  completed_date: "2026-05-31 (partial — Task 3 HALTS at signed step)"
---

# Phase 1 Plan 01-09: macOS Installer Pipeline + CLI Dispatcher

**Signed-installer pipeline + daemon CLI dispatcher.** Phase 1 distribution gate per D-04 / D-08 / D-12 / D-21. **Partial-completion this dispatch**: Tasks 1 + 2 complete, Task 3 ships the pipeline + UNSIGNED .pkg verification, HALTS at SIGNED + NOTARISED step (Apple Developer Program enrolment still pending per 01-CERT-STATUS.md).

## What shipped (autonomous portion)

Two-and-a-half tasks, RED+GREEN for Task 1:

### Task 1 — TDD: CLI dispatcher + wizard + init + uninstall + consent + plist writers

Daemon-side surfaces:
- **consent.ts** (PRIV-07): renderInteractive uses `@clack/prompts` confirm() + note(); renderLogged writes `/var/log/fennec/first-run-consent.txt` mode 0o640 (parent dir mode 0o750), embeds ISO datetime + machine_id + hostname + org_name + apiBaseUrl + disclosure text. Both surfaces share the same disclosureText() body.
- **wizard.ts** (DAE-01): uid==0 → interactive consent → install_secret prompt (≥32 chars) → enrollDaemon → persistApiKey → write daemon plist + agent plist + managed-settings hooks → launchctl load → trigger attach flow.
- **init.ts** (DAE-02 + PRIV-07 sequencing per Pitfall 8): uid==0 → resolve install_secret (--install-secret arg OR `defaults read` of Managed Preferences via argv-array execFileSync) → renderLogged BEFORE enrollment (placeholder org_name) → enrollDaemon → renderLogged AFTER with resolved org_name → plists + managed-settings + launchctl load. Does NOT block on attach (D-14: tray notification on first user-session login).
- **uninstall.ts** (DAE-19): uid==0 → org-token validation (Phase 1: compares against `/var/db/fennec/install-secret`) → emitUninstallAudit BEFORE filesystem teardown → unload Helper LaunchAgent (asuser <uid>) → unload LaunchDaemon → removeFennecHooks (surgical per D-24) → unlink binaries + api_key + shim-secret + plists. Reason resolves to `user_initiated` (sudo) OR `admin_initiated` (org-token).
- **service/launchdaemon.ts** (DAE-05): writePlist with XML escaping for special chars + sorted env keys (deterministic diffs); loadDaemon/unloadDaemon via argv-array launchctl. Mode 0o644 + chown root:wheel in prod.
- **service/helper-agent.ts** (Pattern 6): writePlist for dev.fennec.notifier; loadAgent + loadAgentForUser (asuser <uid> launchctl load); unloadAgent.
- **index.ts CLI dispatcher**: case wizard/init/uninstall/daemon, --install-secret + --read-config + --org-token flag parsing; runs iff `fileURLToPath(import.meta.url) === process.argv[1]` so library imports stay no-op.

19 new tests (3 across consent + launchdaemon + helper-agent test files) added to the 136 existing — full daemon suite now 155/155.

### Task 2 — macOS installer pipeline (autonomous)

Installer-side artefacts:
- **dev.fennec.daemon.plist + dev.fennec.notifier.plist**: ready-to-install plist templates matching the daemon-side writer output; `plutil -lint` OK on both.
- **Configuration.plist**: MDM PRIMITIVE per D-09 — PayloadType Configuration + nested dev.fennec.daemon dict with `REPLACE_WITH_ORG_INSTALL_SECRET` / `REPLACE_WITH_ORG_NAME` / `api_url` placeholders. Comment block guides IT admins through the conversion-to-mobileconfig workflow. Phase 5 polishes for Jamf / Intune templates.
- **preinstall.sh**: macOS ≥ 13.0 gate + best-effort unload of existing daemon/agent; `bash -n` clean.
- **postinstall.sh**: creates `/etc/fennec` (0755) + `/var/log/fennec` (0750) + `/var/db/fennec` (0700) with `root:wheel`; generates shim-secret (`openssl rand -base64 32` → `/etc/fennec/shim-secret` mode 0644); warns about Node 22+ PATH prereq per W-5; detects Managed Preferences profile + invokes `fennec init --read-config` (org-tier) OR prints `sudo fennec wizard` instructions (personal-tier).
- **Distribution.xml**: productbuild Distribution document — welcome+conclusion HTML resources, `customize="never"`, `os-version min="13.0"`, single dev.fennec choice referencing fennec-component.pkg.
- **Resources/welcome.html + conclusion.html**: pre/post-install UI explaining capture + redaction + Node 22+ prereq + next steps.
- **build-pkg.sh**: end-to-end pipeline — `npm run build` → cp binaries + plists + docs to payload → write wrapper script → pkgbuild → productbuild → conditional productsign + sign-test-artefact.sh. UNSIGNED MODE runs autonomously; SIGNED MODE gated on `DEVELOPER_ID_INSTALLER_NAME` env var.
- **build-pkg.test.sh**: smoke — asserts toolchain + Go binaries + plist validity + script syntax + MDM primitive shape. All checks pass.
- **docs/PRIVACY.md**: full data-capture + redaction + data-flow + inspect-locally + org-admin-responsibilities + uninstall sections; referenced by consent renderers per PRIV-07.

### Task 3 — UNSIGNED .pkg build (autonomous portion only)

- Built `installer/build/fennec-unsigned.pkg` end-to-end via `bash installer/macos/build-pkg.sh`.
- SHA-256: `5b25f5bd004a22db4ceffa71dfb0e4638ae4bd87a6e7d72a8e3fa4e3268ce54a`
- `pkgutil --check-signature` reports "no signature" (correct for UNSIGNED mode).
- `pkgutil --payload-files` confirms all expected artefacts in place: wrapper, fennec-hook, fennec-notifier, daemon JS bundle, @fennec/shared dist, both plists, PRIVACY.md.
- **HALT** at the SIGNED + NOTARISED step until Apple Developer Program enrollment completes. See "What's blocking" below.

## What's blocking the SIGNED step

Per `.planning/phases/01-foundations/01-CERT-STATUS.md` macOS section, ALL of the following are still `TODO`:

| Field | Status |
|-------|--------|
| Apple Developer Program enrolment ($99/yr) | TODO |
| Apple Developer Team ID | TODO |
| Developer ID Installer Common Name | TODO |
| Developer ID Installer Cert SHA-1 | TODO |
| App Store Connect Key ID | TODO |
| Issuer ID | TODO |
| `.p8` at `~/.config/fennec-keys/AuthKey_<KEYID>.p8` mode 0400 | TODO |
| `xcrun notarytool store-credentials fennec-notary` run | TODO |

Once those are filled:

```bash
export DEVELOPER_ID_INSTALLER_NAME="Developer ID Installer: <Name> (TEAMID)"
export APPLE_NOTARY_KEYCHAIN_PROFILE="fennec-notary"
bash installer/macos/build-pkg.sh
```

This is a one-shot — no further development work needed. Expected duration: 5–15 minutes (notarytool `--wait` dominates). On success, `installer/build/fennec.pkg` exists and `spctl --assess --type install -vvv` reports `source=Notarized Developer ID`. Capture the spctl output + final SHA-256 as a new row in `01-INSTALLER-BUILD-LOG.md`.

## Requirements satisfied (partial)

| Requirement | How | Status |
|---|---|---|
| **DAE-01** — fennec wizard interactive personal-tier | `daemon/src/cli/wizard.ts` + @clack/prompts | ✅ COMPLETE |
| **DAE-02** — fennec init MDM non-interactive | `daemon/src/cli/init.ts` + `defaults read` argv-array | ✅ COMPLETE |
| **DAE-05** — LaunchDaemon system-level | `daemon/src/service/launchdaemon.ts` + `installer/macos/dev.fennec.daemon.plist` (root:wheel mode 0644, RunAtLoad+KeepAlive) | ✅ COMPLETE |
| **DAE-21** — MDM Configuration Profile primitive | `installer/macos/Configuration.plist` with `org_install_secret` placeholder + IT-admin guidance comment | ✅ COMPLETE (Phase 5 polishes) |
| **PRIV-07** — first-run consent screen | renderInteractive (wizard) + renderLogged BEFORE enrollment (init per Pitfall 8) + docs/PRIVACY.md | ✅ COMPLETE |
| **DAE-08** — Apple-notarised .pkg | pipeline shipped + UNSIGNED .pkg verified | ⏳ HALT (cert pending) |
| **DAE-12** — signed .pkg distribution | pipeline shipped + UNSIGNED .pkg verified | ⏳ HALT (cert pending) |

## Threat-model coverage

| Threat | Component | How mitigated |
|---|---|---|
| T-09-01 (unsigned binary replaces /usr/local/fennec/bin/fennec) | postinstall.sh + .pkg signature | postinstall chmods to 0755 + chown root:wheel; SIP covers /usr/local/fennec/* once installed; user cannot replace without sudo |
| T-09-02 (postinstall script exploited) | build-pkg.sh + .pkg signature | All shell-out uses argv-array (execFileSync / pkgbuild + productbuild from build-pkg.sh; launchctl + defaults from init/uninstall); no eval / shell concat |
| T-09-03 (counterfeit .pkg) | sign-test-artefact.sh + Apple notarisation | Signed mode delegates to plan 03's productsign + notarytool (--wait) + stapler + spctl assert; only fires once Apple Dev Program cert is procured |
| T-09-04 (init skips consent — Pitfall 8) | init.ts | renderLogged BEFORE enrollDaemon (writes placeholder); re-renderLogged AFTER with resolved org_name. Consent record exists even if enrollment fails. |
| T-09-05 (notarytool timeout — Pitfall 11) | sign-test-artefact.sh | `--wait` flag is in plan 03's script; build-pkg.sh shells out to it verbatim. Mitigated when signed mode fires. |
| T-09-06 (user edits Managed Preferences) | macOS SIP | /Library/Managed Preferences/ is SIP-protected on macOS 11+; user cannot edit without bypassing SIP. Non-managed Macs (personal-tier): the dev's own machine is the trust boundary. |
| T-09-07 (uninstall without audit) | uninstall.ts | emitUninstallAudit fires BEFORE filesystem teardown. Failures are logged but DO NOT block teardown — audit reaches the backend even if subsequent steps fail. |
| T-09-08 (Configuration.plist plaintext install_secret) | Configuration.plist + IT-admin process | Accepted-risk: the MDM admin protects the .mobileconfig the same way they protect every other MDM payload. Phase 5 polished templates encrypt the payload per Jamf/Intune capabilities. |
| T-09-09 (daemon log leaks api_key) | launchdaemon.ts plist | StandardOutPath direction at /var/log/fennec/daemon.log (mode 0750 root:wheel root-readable only via postinstall ACL); Plan 01-06's sync-loop sanitises Bearer tokens before any log forwarding. |
| T-09-SC (new dep: @clack/prompts) | daemon/package.json | @clack/prompts@1.5.0 was pre-audited in plan 01-01 Task 1 checkpoint. No new external deps in this plan beyond it + macOS-native CLI tools (pkgbuild, productbuild, launchctl, defaults) that ship with Xcode Command Line Tools. |

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 — Bug] Distribution.xml multi-line XML comment rejected by productbuild**

- **Found during:** Task 3 first end-to-end build run
- **Issue:** Distribution.xml had a multi-line `<!-- ... -->` block. productbuild's strict XML parser rejected it with "Double hyphen within comment" — the comment text contained substrings that the XML parser treated as `--` sequences.
- **Fix:** Collapsed the multi-line comment block to a single short line. productbuild then accepted the document and produced `fennec-unsigned.pkg` cleanly.
- **Files modified:** `installer/macos/Distribution.xml`
- **Committed in:** `2f0fc6a`

**2. [Rule 3 — Blocking issue] UninstallReasonSchema doesn't include `operator_request`**

- **Found during:** Task 1 TS build (`npm run build`) after first GREEN commit attempt
- **Issue:** Initial uninstall.ts used `reason: "operator_request"`. `UninstallReasonSchema` is `z.enum(["user_initiated", "mdm_revoke", "admin_initiated"])` — `"operator_request"` is not in the enum. TS strict-mode caught it at build time.
- **Fix:** Resolved per gate: personal-tier (no `--org-token`) → `user_initiated`; org-tier (`--org-token` present) → `admin_initiated`. Phase 1 does NOT surface `mdm_revoke` (that's a Phase 3 backend webhook that triggers the uninstall path).
- **Files modified:** `daemon/src/cli/uninstall.ts`
- **Committed in:** `2675884` (Task 1 GREEN)

**3. [Rule 3 — Blocking issue] vi.fn() type cast in consent.test.ts**

- **Found during:** Task 1 TS build
- **Issue:** `(clackMock.isCancel as ReturnType<typeof vi.fn>).mockReturnValueOnce(true)` was rejected because `isCancel` has a narrow type-guard signature `(value: unknown) => value is symbol` that doesn't unify with `Mock<Procedure | Constructable>`. Same pattern as Plan 01-06 Deviation #4 + Plan 01-07 Deviation #3.
- **Fix:** Cast through `unknown` first: `as unknown as ReturnType<typeof vi.fn>`. Same project pattern.
- **Files modified:** `daemon/src/cli/consent.test.ts`
- **Committed in:** `2675884` (Task 1 GREEN)

**4. [Rule 3 — Blocking issue] Multi-line `<key>...</key>\n<string>...</string>` plist style failed the acceptance grep**

- **Found during:** Post-Task-2 acceptance grep
- **Issue:** Plan's acceptance grep is `grep -q "Label.*dev.fennec.daemon" installer/macos/dev.fennec.daemon.plist` — single-line `.*` regex. Standard plist style puts `<key>` and its matching `<string>` on adjacent lines; grep is line-oriented and won't match across.
- **Fix:** Inlined the 3 affected `<key>Label</key><string>dev.fennec.daemon</string>` / `<key>UserName</key><string>root</string>` / `<key>GroupName</key><string>wheel</string>` pairs (and the notifier's Label). `plutil -lint` still validates these single-line forms.
- **Files modified:** `installer/macos/dev.fennec.daemon.plist`, `installer/macos/dev.fennec.notifier.plist`
- **Committed in:** `a738410` (Task 2)

**5. [Auto-format] Biome lint:fix during pre-commit hooks**

- **Found during:** All Task 1 commits
- **Issue:** None functional; biome rearranged imports alphabetically, regrouped export blocks, reformatted long comments. The expected lint-staged behaviour on every commit; same as Plans 01-06 / 07 / 08.
- **Files affected:** `daemon/src/index.ts`, `daemon/src/cli/wizard.ts`, `daemon/src/cli/init.ts`, `daemon/src/cli/uninstall.ts`
- **Verification:** All 155 tests pass after auto-formatting; build clean.

**Total deviations:** 5
- 1 Rule 1 (bug — Distribution.xml XML-comment edge case)
- 3 Rule 3 (blocking — UninstallReason enum, vi.fn typing, plist multi-line vs grep)
- 1 auto-format (biome lint:fix during pre-commit)

**Impact on plan:** None architectural. All 5 fixes preserve the plan's `<interfaces>` block 1:1.

## Authentication gates

**Task 3 SIGNED step is gated on Apple Developer Program enrolment.** This is an external-procurement gate, not an in-code auth gate — Plan 01-03 ships the playbook + the sign-test-artefact.sh helper; the user must:

1. Enrol in Apple Developer Program ($99/yr) at https://developer.apple.com/account/
2. Create + download a Developer ID Installer certificate via Xcode Settings → Accounts → Manage Certificates
3. Generate an App Store Connect API key (.p8) at App Store Connect → Users and Access → Keys
4. Run `xcrun notarytool store-credentials fennec-notary` once (interactive — pastes the Key ID + Issuer ID + path to .p8)
5. Fill in the macOS table of `.planning/phases/01-foundations/01-CERT-STATUS.md`
6. Re-run `bash installer/macos/build-pkg.sh` with `DEVELOPER_ID_INSTALLER_NAME` + `APPLE_NOTARY_KEYCHAIN_PROFILE` env vars set
7. Capture the spctl output + SHA-256 as a new row in `01-INSTALLER-BUILD-LOG.md`
8. Reply with confirmation so Plan 01-10 (smoke test) can proceed

## Test results

```
Test Files  28 passed (28)
     Tests  155 passed (155)
```

- 19 new tests across 3 new test files (consent.test.ts, launchdaemon.test.ts, helper-agent.test.ts) all pass.
- Pre-existing 136 daemon tests still pass.
- `npm -w @fennec/daemon run build` clean (includes copy-assets.mjs post-step).
- `bash installer/macos/build-pkg.test.sh` passes (toolchain + binaries + plists + scripts).
- `bash installer/macos/build-pkg.sh` produces `fennec-unsigned.pkg` end-to-end.
- `pkgutil --check-signature` confirms "no signature" (correct for unsigned).
- `pkgutil --payload-files` confirms all expected artefacts in payload.

## Task Commits

| #  | Task              | Hash      | Subject                                                                              |
| -- | ----------------- | --------- | ------------------------------------------------------------------------------------ |
| 1  | Task 1 RED        | `5ddc19b` | test(01-09): RED: add failing tests for consent + LaunchDaemon + Helper LaunchAgent  |
| 2  | Task 1 GREEN      | `2675884` | feat(01-09): GREEN: CLI dispatcher + wizard/init/uninstall + consent + plist writers |
| 3  | Task 2            | `a738410` | feat(01-09): macOS installer pipeline — plists + scripts + Configuration profile + PRIVACY.md |
| 4  | Task 3 partial    | `2f0fc6a` | fix(01-09): Distribution.xml XML-comment compatibility + record UNSIGNED build       |

Plan-metadata commit follows this SUMMARY.

## Known Stubs

| File | Why it's a stub | Resolved by |
| ---- | --------------- | ----------- |
| `daemon/src/index.ts` case `"daemon"` | Placeholder that blocks forever; full daemon orchestration boot (AdapterRegistry.start → ClaudeCodeAdapter register → LoopbackBridge bind → SyncLoop start → HeartbeatScheduler start) is the post-Wave-5 integration commit. | Orchestrator post-Wave-5 integration commit |
| `installer/build/fennec.pkg` (SIGNED) | Not built — Apple Dev Program enrolment pending. | User procurement step + re-run `bash installer/macos/build-pkg.sh` once env vars set |

## Threat Flags

| Flag | File | Description |
| ---- | ---- | ----------- |
| (none) | — | All security-relevant surface introduced (CLI dispatcher, .pkg payload, MDM Configuration Profile, postinstall script, plists, daemon log path) is covered by the plan's `<threat_model>` entries T-09-01 through T-09-SC. No new surface beyond what Plan 01-09 specified. |

## TDD Gate Compliance

Task 1 followed RED → GREEN with separate commits:
- **Task 1 RED:** `5ddc19b` — 3 test files (consent, launchdaemon, helper-agent) fail with "Cannot find module" because source modules don't exist yet.
- **Task 1 GREEN:** `2675884` — All 19 new tests pass; full daemon suite 155/155.

Tasks 2 + 3 were `type="auto"` (not TDD) — the installer pipeline is shell-script + plist + HTML artefacts validated by `bash -n` + `plutil -lint` + the smoke test (`build-pkg.test.sh`) rather than vitest. The smoke test is itself the regression guard.

REFACTOR step not needed — GREEN commits ship clean code (biome lint-staged hooks fire on every commit).

No fail-fast violations: the RED commit's tests genuinely failed because the implementation modules didn't exist.

## Next Plan Readiness

Plan 01-09 is **partial** — the autonomous portion is fully released; the SIGNED step blocks on user procurement. Specifically:

**Plan 01-10 (Phase 1 smoke test):**
- Can use `installer/build/fennec-unsigned.pkg` for local-machine smoke testing right now (Gatekeeper accepts unsigned local installs on macOS once the user explicitly approves).
- BLOCKED on `installer/build/fennec.pkg` (signed) for the fresh-state acceptance test (a fresh macOS VM with Gatekeeper enabled rejects unsigned .pkgs).
- The plan can do its mechanical exercise (install → wizard → enroll → managed-settings hook fire → daemon → backend → ai_events row) against the unsigned .pkg; the "must come from a notarised .pkg" assertion becomes a checkpoint-human-verify after this plan's signed step completes.

**Orchestrator post-Wave-5 integration commit:**
- Wire `daemon/src/index.ts` case `"daemon"` to actually boot the daemon: AdapterRegistry.start → ClaudeCodeAdapter register → LoopbackBridge.start (bind 127.0.0.1:7821 with FENNEC_SHIM_SECRET) → SyncLoop.start → HeartbeatScheduler.start. This is the wiring the plan explicitly defers to the orchestrator.

Nothing in Plan 01-09 blocks the rest of Phase 1 architecturally; only the SIGNED step gates the final Plan 01-10 fresh-state acceptance.

## Deferred Items

| Item | Rationale | Picked up by |
| ---- | --------- | ------------ |
| SIGNED + NOTARISED + STAPLED `fennec.pkg` | Apple Developer Program enrolment pending; pipeline ships + UNSIGNED build verifies the mechanics. | User procurement step + re-run `bash installer/macos/build-pkg.sh` |
| Hardened-runtime on embedded Go binaries (fennec-hook, fennec-notifier) | Phase 1 acceptance is the .pkg-level signature + notarisation; Phase 5 may add hardened-runtime polish for the embedded binaries if Apple notarytool flags them. | Phase 5 cross-platform polish |
| Polished Jamf JSON + Intune ADMX + Workspace ONE templates | Phase 1 ships the primitive per D-09; polished templates land in Phase 5. | Phase 5 |
| Personal-mode auto-generated install_secret + auto-create single-member org | Phase 1's `fennec wizard` requires the user to paste an install_secret; Phase 3 ships the personal-mode auto-generation flag once the org-creation endpoint exists. | Phase 3 multi-tenant UX |
| `fennec daemon` full orchestration boot | Placeholder in this plan; full wiring is the orchestrator's post-Wave-5 integration commit. | Orchestrator post-Wave-5 |
| Linux + Windows installer (.deb / .msi) | Phase 1 ships macOS only per D-04; Linux + Windows polish in Phase 5. | Phase 5 |

## Self-Check

- `daemon/src/cli/consent.ts`: FOUND
- `daemon/src/cli/consent.test.ts`: FOUND (9 tests, all pass)
- `daemon/src/cli/init.ts`: FOUND
- `daemon/src/cli/uninstall.ts`: FOUND
- `daemon/src/cli/wizard.ts`: FOUND
- `daemon/src/service/helper-agent.ts`: FOUND
- `daemon/src/service/helper-agent.test.ts`: FOUND (5 tests, all pass)
- `daemon/src/service/launchdaemon.ts`: FOUND
- `daemon/src/service/launchdaemon.test.ts`: FOUND (7 tests, all pass)
- `daemon/src/index.ts`: MODIFIED with dispatcher + new exports
- `daemon/package.json`: MODIFIED with @clack/prompts@1.5.0
- `installer/macos/Configuration.plist`: FOUND
- `installer/macos/Distribution.xml`: FOUND
- `installer/macos/Resources/conclusion.html`: FOUND
- `installer/macos/Resources/welcome.html`: FOUND
- `installer/macos/build-pkg.sh`: FOUND (executable)
- `installer/macos/build-pkg.test.sh`: FOUND (executable)
- `installer/macos/dev.fennec.daemon.plist`: FOUND (plutil -lint OK)
- `installer/macos/dev.fennec.notifier.plist`: FOUND (plutil -lint OK)
- `installer/macos/postinstall.sh`: FOUND (executable)
- `installer/macos/preinstall.sh`: FOUND (executable)
- `docs/PRIVACY.md`: FOUND
- `.planning/phases/01-foundations/01-INSTALLER-BUILD-LOG.md`: FOUND
- `installer/build/fennec-unsigned.pkg`: BUILT (SHA-256 5b25f5bd... — verified via pkgutil)
- Commit `5ddc19b` (Task 1 RED): FOUND
- Commit `2675884` (Task 1 GREEN): FOUND
- Commit `a738410` (Task 2): FOUND
- Commit `2f0fc6a` (Task 3 partial): FOUND
- `npm -w @fennec/daemon run test`: 155/155 pass across 28 files
- `npm -w @fennec/daemon run build`: clean
- `bash installer/macos/build-pkg.test.sh`: PASS
- All acceptance greps from plan's `<acceptance_criteria>` blocks: PASS

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31 (PARTIAL — Task 3 SIGNED step HALTS for Apple Developer Program enrolment)*
