#!/usr/bin/env bash
#
# tests/manual/local-dev-uninstall-hooks.sh — surgical removal of the
# hook entries installed by local-dev-install-hooks.sh.
#
# Uses the real production removeFennecHooks() function so the synapse-
# coexistence (D-24) contract is exercised: only fennec entries are
# stripped; any other tool's blocks remain byte-equal preserved.
#
# Does NOT remove /usr/local/fennec/bin/fennec-hook itself — that's a
# bare binary that doesn't run unless invoked, so leaving it is safe
# and avoids re-downloading on next install. Delete by hand if desired.
#
# Usage:
#   sudo bash tests/manual/local-dev-uninstall-hooks.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: must run as root (writes to /Library/Application Support/ClaudeCode/)" >&2
  echo "       Re-run with: sudo bash $0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.."
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
DAEMON_DIST="$REPO_ROOT/daemon/dist/index.js"
MANAGED_SETTINGS="/Library/Application Support/ClaudeCode/managed-settings.json"
SHIM_SECRET_FILE=/tmp/fennec-local-data/shim-secret
HOOK_BIN=/usr/local/fennec/bin/fennec-hook
HOOK_COMMAND="FENNEC_SHIM_SECRET=\$(cat $SHIM_SECRET_FILE 2>/dev/null) $HOOK_BIN"

if [ ! -f "$DAEMON_DIST" ]; then
  echo "error: daemon dist not built at $DAEMON_DIST" >&2
  exit 1
fi

echo "[1/2] running removeFennecHooks() — surgical strip"
node --input-type=module -e "
import { removeFennecHooks } from '$DAEMON_DIST';
const command = process.env.FENNEC_HOOK_COMMAND;
const path = process.env.FENNEC_MANAGED_SETTINGS_PATH;
removeFennecHooks(path, command);
console.log('removeFennecHooks: ok');
" \
  FENNEC_HOOK_COMMAND="$HOOK_COMMAND" \
  FENNEC_MANAGED_SETTINGS_PATH="$MANAGED_SETTINGS"

echo ""
echo "[2/2] verification — current managed-settings.json:"
if [ -f "$MANAGED_SETTINGS" ]; then
  cat "$MANAGED_SETTINGS"
else
  echo "(file unlinked — no remaining hooks or other top-level keys)"
fi

echo ""
echo "UNINSTALL OK (the shim binary at $HOOK_BIN is preserved)"
