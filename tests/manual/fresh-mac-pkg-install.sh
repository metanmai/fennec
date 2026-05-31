#!/usr/bin/env bash
#
# tests/manual/fresh-mac-pkg-install.sh — DAE-12 runbook.
#
# This is a RUNBOOK, not a fully-automated script. It walks the
# operator through the sequence required to verify that the signed
# fennec.pkg installs cleanly on a fresh macOS environment (a VM is
# strongly recommended so Gatekeeper is in its default-stricter state).
#
# Each step prints what to do then waits for the operator to press
# Enter. The expected verification step + the URL/command/screenshot
# to capture into 01-SMOKE-LOG.md is printed at each step.
#
# Usage (run from inside the VM):
#   bash tests/manual/fresh-mac-pkg-install.sh
#
# Companion to: Plan 01-10 Task 4 acceptance + ROADMAP success
# criterion 2 ("Notarized Developer ID" — no Gatekeeper dialog).

set -uo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'error: this runbook is macOS-only.\n' >&2
  exit 1
fi

declare -i STEP=0

pause() {
  STEP+=1
  local heading="$1"; shift
  local body="$1"
  printf '\n=== Step %d — %s ===\n' "${STEP}" "${heading}"
  printf '%s\n' "${body}"
  printf '\nPress Enter when complete. (Ctrl+C to abort.) '
  read -r _ || true
}

printf 'fennec fresh-mac pkg install runbook — %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf '\nThis runbook assumes you are inside a fresh macOS VM with default Gatekeeper.\n'
printf 'Capture each step into .planning/phases/01-foundations/01-SMOKE-LOG.md\n'
printf '(screenshots + command outputs).\n'

pause "Confirm macOS version" \
'Run:
  sw_vers -productVersion

Expected: 13.0 or newer (macOS Ventura). Older macOS versions are
out of scope for Phase 1 (preinstall.sh enforces this).'

pause "Copy fennec.pkg into the VM" \
'Transfer installer/build/fennec.pkg from the host into the VM (shared
folder, scp, AirDrop — your choice). Once inside the VM, compute its
SHA-256:

  shasum -a 256 ~/Downloads/fennec.pkg

Confirm the SHA-256 matches the row in
.planning/phases/01-foundations/01-INSTALLER-BUILD-LOG.md for the
SIGNED build. If you only have the UNSIGNED .pkg (fennec-unsigned.pkg),
the rest of this runbook still works but Step 4 will surface a
Gatekeeper dialog because the .pkg lacks notarisation.'

pause "Verify signature + notarisation BEFORE install" \
'Run the verifier script (works whether you copied the whole repo or
just the .pkg + script):

  bash tests/ci/verify-signed-pkg.sh ~/Downloads/fennec.pkg

Expected: PASS with `source=Notarized Developer ID`. If this step fails,
DO NOT install — the .pkg is unsigned or improperly notarised. Re-run
installer/macos/build-pkg.sh on the host with the Apple Developer ID
env vars set, then re-copy.'

pause "Install via double-click in Finder" \
'Open Finder → Downloads. Double-click fennec.pkg. Step through the
installer.

Expected: NO `unidentified developer` dialog. NO `cannot be opened
because the developer cannot be verified` dialog. The installer should
present the standard Apple Installer flow with the welcome.html content.

Capture: screenshot of the installer welcome screen + screenshot of
the success screen.

NOTE: if you see a Gatekeeper dialog, the .pkg is not notarised — abort
the install and re-check Step 3.'

pause "Run fennec wizard" \
'In Terminal, run:

  sudo FENNEC_API_URL=<deployed-worker-url> /usr/local/fennec/bin/fennec wizard

Step through:
  - Consent screen — read it; reply "Yes" to consent.
  - "Do you have an org install secret?" — YES, paste
    FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa
    (from .planning/phases/01-foundations/01-SCHEMA-TEST-DATA.md).
  - Wait for enrollment + plist install + launchctl load + browser
    auto-open for SSO attach.
  - Complete SSO sign-in in the browser.

Capture: screenshot of the consent screen + the wizard "Daemon running"
message + the browser opening to SSO.'

pause "Verify daemon is loaded" \
'Run:

  sudo bash tests/manual/launchdaemon-smoke.sh

Expected: PASS on all 5 checks (launchctl entries, daemon process,
plist ACLs, api_key ACL, helper-agent plist).

Capture: the full output of launchdaemon-smoke.sh.'

pause "Verify managed-settings hooks are installed" \
'Run:

  cat /Library/Application\ Support/ClaudeCode/managed-settings.json | jq

Expected: a hooks object with all 6 D-22 hook entries
(SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd,
SubagentStop), each pointing at /usr/local/fennec/bin/fennec-hook.

Capture: the JSON.'

pause "Test prompt → ai_events row" \
'Open Claude Code on this VM (download from claude.ai if not already
installed). Type a unique test prompt including a UUID for grep-ability,
e.g.:

  Smoke test 12345678-1234-5678-1234-567812345678, please reply hello.

Within 5 minutes, query Supabase via Studio or psql:

  SELECT idempotency_key, occurred_at, payload->>'\''prompt_text'\''
  FROM ai_events
  WHERE payload->>'\''prompt_text'\'' LIKE '\''%12345678-1234-5678-1234-567812345678%'\''
  ORDER BY occurred_at DESC
  LIMIT 5;

Expected: at least 1 row. Capture the SQL output.

ROADMAP Phase 1 success criterion 1 verified.'

printf '\n=== Runbook complete ===\n'
printf 'Capture all step outputs into\n'
printf '  .planning/phases/01-foundations/01-SMOKE-LOG.md\n'
printf 'under "## Step 3: signed .pkg install + wizard + SSO attach".\n'
