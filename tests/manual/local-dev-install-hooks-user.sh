#!/usr/bin/env bash
#
# tests/manual/local-dev-install-hooks-user.sh — install fennec hooks
# into the user-level Claude Code settings (no sudo required).
#
# Sibling of local-dev-install-hooks.sh, which writes to the
# system-level managed-settings.json and needs root. This variant
# targets ~/.claude/settings.json and ~/.fennec/bin/ instead — same
# end result (Claude Code fires fennec hooks) without touching any
# root-owned paths.
#
# Why this works: Claude Code merges hooks from all settings layers
# (managed-settings + user + project + project-local), so user-level
# entries are functionally equivalent for local dev. The trade-off is
# they're NOT tamper-resistant (user can edit/delete) — fine for a
# dev box, not what production wants.
#
# What this script does (idempotent):
#   1. Copies the Go shim to ~/.fennec/bin/fennec-hook + codesigns ad-hoc
#   2. Calls writeFennecHooks() (production code path) against
#      ~/.claude/settings.json with skipChown=true. Additive merge —
#      existing synapse, gsd, etc. entries are preserved byte-equal.
#   3. Prints a summary of how many blocks fennec added per event.
#
# Pre-reqs (NOT enforced by this script):
#   - Local daemon running with FENNEC_DATA_DIR=/tmp/fennec-local-data
#   - File /tmp/fennec-local-data/shim-secret readable by you
#   - Local backend reachable at http://127.0.0.1:8787
#
# Usage:
#   bash tests/manual/local-dev-install-hooks-user.sh
#
# Reverse (surgical strip, leaves other tools' entries intact):
#   bash tests/manual/local-dev-uninstall-hooks-user.sh
#
# Safety: this script BACKS UP ~/.claude/settings.json to
# ~/.claude/settings.json.fennec-pre-install-<unix-ts>.bak before any
# mutation — restore by hand if anything looks wrong.

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "warning: this is the no-sudo variant — running as root works but" >&2
  echo "         you probably wanted local-dev-install-hooks.sh (system-wide)." >&2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.."
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
SHIM_BIN="$REPO_ROOT/shim/build/fennec-hook-darwin-arm64"
DAEMON_DIST="$REPO_ROOT/daemon/dist/index.js"

if [ ! -x "$SHIM_BIN" ]; then
  echo "error: fennec shim binary not found at $SHIM_BIN" >&2
  echo "       Rebuild via: cd shim && go build -o build/fennec-hook-darwin-arm64 main.go" >&2
  exit 1
fi

if [ ! -f "$DAEMON_DIST" ]; then
  echo "error: daemon dist not built at $DAEMON_DIST" >&2
  echo "       Build via: cd $REPO_ROOT/daemon && npx tsc -p tsconfig.json" >&2
  exit 1
fi

SHIM_DEST="$HOME/.fennec/bin/fennec-hook"
USER_SETTINGS="$HOME/.claude/settings.json"
SHIM_SECRET_FILE=/tmp/fennec-local-data/shim-secret

mkdir -p "$(dirname "$SHIM_DEST")"
mkdir -p "$(dirname "$USER_SETTINGS")"

echo "[1/4] backing up user settings"
if [ -f "$USER_SETTINGS" ]; then
  BACKUP="$USER_SETTINGS.fennec-pre-install-$(date +%s).bak"
  cp "$USER_SETTINGS" "$BACKUP"
  echo "      backup: $BACKUP"
else
  echo "      (no existing settings file — nothing to back up)"
fi

echo ""
echo "[2/4] installing shim -> $SHIM_DEST"
cp "$SHIM_BIN" "$SHIM_DEST"
chmod 0755 "$SHIM_DEST"
codesign --sign - --force "$SHIM_DEST" >/dev/null 2>&1 || true
ls -la "$SHIM_DEST"

# Hook command: sh -c shell expansion reads the shim-secret inline at
# every fire. Fail-open: if the file is missing/unreadable, the env
# var stays empty and the bridge 401s — no user-facing disruption.
HOOK_COMMAND="FENNEC_SHIM_SECRET=\$(cat $SHIM_SECRET_FILE 2>/dev/null) $SHIM_DEST"

echo ""
echo "[3/4] writing fennec hook entries to $USER_SETTINGS"
echo "      hook command: $HOOK_COMMAND"
export FENNEC_TARGET_PATH="$USER_SETTINGS"
export FENNEC_HOOK_COMMAND="$HOOK_COMMAND"
node --input-type=module -e "
import { writeFennecHooks } from '$DAEMON_DIST';
writeFennecHooks(process.env.FENNEC_TARGET_PATH, process.env.FENNEC_HOOK_COMMAND, { skipChown: true });
console.log('writeFennecHooks: ok');
"

echo ""
echo "[4/4] verification — fennec entries in user settings:"
python3 <<PY
import json
d = json.load(open("$USER_SETTINGS"))
hooks = d.get("hooks", {})
needle = "$SHIM_DEST"
total_fennec = 0
for ev in sorted(hooks.keys()):
    blocks = hooks[ev]
    fennec = sum(
        1 for b in blocks
        if isinstance(b, dict)
        and any(needle in (e.get("command") or "") for e in b.get("hooks", []))
    )
    total_fennec += fennec
    marker = " <- fennec" if fennec else ""
    print(f"  {ev}: {len(blocks)} block(s) ({fennec} fennec){marker}")
print(f"total fennec blocks: {total_fennec}")
PY

echo ""
echo "INSTALL OK"
echo ""
echo "Next step: open a FRESH Claude Code session in a separate terminal"
echo "(Claude Code reads settings.json once at startup). Type any prompt"
echo "in that new session, then verify the row appeared in Postgres:"
echo ""
echo "  psql fennec_local -c \"SELECT idempotency_key, occurred_at, payload->>'prompt_text' AS prompt FROM ai_events ORDER BY occurred_at DESC LIMIT 5;\""
