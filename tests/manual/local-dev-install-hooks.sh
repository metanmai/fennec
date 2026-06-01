#!/usr/bin/env bash
#
# tests/manual/local-dev-install-hooks.sh — install fennec managed-settings
# hooks on the developer's own macOS machine, pointing at a locally-running
# daemon (not a signed/notarised production install).
#
# This is the bridge between "the wire format works with simulated POSTs"
# (Plan 01-10 Task 1 — already green) and "real Claude Code prompts land
# in local Postgres" — without going through the full Apple Dev cert +
# notarisation + LaunchDaemon pipeline.
#
# What this script does (all idempotent):
#   1. Installs the compiled Go shim to /usr/local/fennec/bin/fennec-hook
#   2. Writes /Library/Application Support/ClaudeCode/managed-settings.json
#      with fennec's 6 D-22 hook entries pointing at a shell wrapper that
#      passes FENNEC_SHIM_SECRET inline (cat /tmp/fennec-local-data/shim-secret).
#      Additive — preserves any other tool's existing hook blocks.
#   3. Prints a verification block + a quick recipe to confirm hooks fire.
#
# Pre-reqs (NOT enforced by this script — caller must set up):
#   - Local daemon running with FENNEC_DATA_DIR=/tmp/fennec-local-data
#   - File /tmp/fennec-local-data/shim-secret readable by the user that
#     runs Claude Code (mode 0644 is fine)
#   - The local backend reachable at http://127.0.0.1:8787
#
# Usage:
#   sudo bash tests/manual/local-dev-install-hooks.sh
#
# Reverse (remove fennec entries — preserves everything else):
#   sudo bash tests/manual/local-dev-uninstall-hooks.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: this script writes to /usr/local/fennec/bin and" >&2
  echo "       /Library/Application Support/ClaudeCode — must run as root." >&2
  echo "       Re-run with: sudo bash $0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.."
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
SHIM_BIN="$REPO_ROOT/shim/build/fennec-hook-darwin-arm64"

if [ ! -x "$SHIM_BIN" ]; then
  echo "error: fennec shim binary not found at $SHIM_BIN" >&2
  echo "       Rebuild via: cd shim && /opt/homebrew/bin/.goenv/versions/1.25.7/bin/go build -o build/fennec-hook-darwin-arm64 main.go" >&2
  exit 1
fi

INSTALL_DIR=/usr/local/fennec/bin
HOOK_BIN="$INSTALL_DIR/fennec-hook"
MANAGED_SETTINGS="/Library/Application Support/ClaudeCode/managed-settings.json"
SHIM_SECRET_FILE=/tmp/fennec-local-data/shim-secret

mkdir -p "$INSTALL_DIR"
echo "[1/3] installing shim binary -> $HOOK_BIN"
cp "$SHIM_BIN" "$HOOK_BIN"
chmod 0755 "$HOOK_BIN"
# Re-sign with an ad-hoc signature so Gatekeeper accepts a binary that
# was copied from a Go-build output on this same machine (signing is a
# no-op if already signed by Go — `codesign --force` overwrites).
codesign --sign - --force "$HOOK_BIN" >/dev/null 2>&1 || true
ls -la "$HOOK_BIN"

# The managed-settings command string: a sh -c invocation that reads
# the shim-secret from /tmp/fennec-local-data/shim-secret and execs the
# hook binary. If the file is missing or unreadable, FENNEC_SHIM_SECRET
# stays empty and the daemon's bridge 401s the request — fail-open safe
# per D-23 (no user-facing disruption).
HOOK_COMMAND="FENNEC_SHIM_SECRET=\$(cat $SHIM_SECRET_FILE 2>/dev/null) $HOOK_BIN"

echo ""
echo "[2/3] writing managed-settings hooks -> $MANAGED_SETTINGS"
echo "      hook command: $HOOK_COMMAND"

# Write a tiny Node script in-place that uses fennec's own
# writeFennecHooks() so the additive-merge contract is exercised by
# the real production code path. node binary inherited from PATH; if
# missing, surface a clear error.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH; cannot run writeFennecHooks" >&2
  exit 1
fi

DAEMON_DIST="$REPO_ROOT/daemon/dist/index.js"
if [ ! -f "$DAEMON_DIST" ]; then
  echo "error: daemon dist not built at $DAEMON_DIST" >&2
  echo "       Build via: cd $REPO_ROOT/daemon && npx tsc -p tsconfig.json" >&2
  exit 1
fi

# Use the same writeFennecHooks the production installer uses. Pass
# skipChown=false so the file is chowned root:wheel (the script
# already runs as root via sudo).
node --input-type=module -e "
import { writeFennecHooks } from '$DAEMON_DIST';
const command = process.env.FENNEC_HOOK_COMMAND;
const path = process.env.FENNEC_MANAGED_SETTINGS_PATH;
writeFennecHooks(path, command);
console.log('writeFennecHooks: ok');
" \
  FENNEC_HOOK_COMMAND="$HOOK_COMMAND" \
  FENNEC_MANAGED_SETTINGS_PATH="$MANAGED_SETTINGS"

ls -la "$MANAGED_SETTINGS"

echo ""
echo "[3/3] verification — managed-settings.json content:"
echo "--- start managed-settings.json ---"
cat "$MANAGED_SETTINGS"
echo "--- end managed-settings.json ---"

echo ""
echo "INSTALL OK"
echo ""
echo "To confirm hooks fire, open Claude Code in a fresh terminal session"
echo "and type any prompt. After a few seconds, query Postgres:"
echo ""
echo "  psql fennec_local -c \"SELECT idempotency_key, session_id, jsonb_pretty(payload) FROM ai_events ORDER BY occurred_at DESC LIMIT 3;\""
echo ""
echo "Note: session_id lives under payload.session_id (not on the envelope)."
