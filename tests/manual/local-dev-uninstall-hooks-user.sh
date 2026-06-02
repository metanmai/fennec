#!/usr/bin/env bash
#
# tests/manual/local-dev-uninstall-hooks-user.sh — surgical removal of
# fennec's user-level hook entries. No sudo required.
#
# Calls the production removeFennecHooks() so the D-24 surgical
# contract is exercised: only fennec entries are stripped from
# ~/.claude/settings.json; any other tool's blocks (synapse, gsd, etc.)
# remain byte-equal preserved.
#
# The shim binary at ~/.fennec/bin/fennec-hook is left in place — it's
# inert without settings.json entries pointing at it, and keeping it
# makes the next install idempotent. Delete by hand if you really want
# it gone:  rm -rf ~/.fennec/bin
#
# Usage:
#   bash tests/manual/local-dev-uninstall-hooks-user.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.."
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
DAEMON_DIST="$REPO_ROOT/daemon/dist/index.js"
USER_SETTINGS="$HOME/.claude/settings.json"
SHIM_DEST="$HOME/.fennec/bin/fennec-hook"
SHIM_SECRET_FILE=/tmp/fennec-local-data/shim-secret
HOOK_COMMAND="FENNEC_SHIM_SECRET=\$(cat $SHIM_SECRET_FILE 2>/dev/null) $SHIM_DEST"

if [ ! -f "$DAEMON_DIST" ]; then
  echo "error: daemon dist not built at $DAEMON_DIST" >&2
  exit 1
fi

if [ ! -f "$USER_SETTINGS" ]; then
  echo "$USER_SETTINGS does not exist — nothing to uninstall."
  exit 0
fi

echo "[1/3] backing up user settings"
BACKUP="$USER_SETTINGS.fennec-pre-uninstall-$(date +%s).bak"
cp "$USER_SETTINGS" "$BACKUP"
echo "      backup: $BACKUP"

echo ""
echo "[2/3] running removeFennecHooks() — surgical strip"
export FENNEC_TARGET_PATH="$USER_SETTINGS"
export FENNEC_HOOK_COMMAND="$HOOK_COMMAND"
node --input-type=module -e "
import { removeFennecHooks } from '$DAEMON_DIST';
removeFennecHooks(process.env.FENNEC_TARGET_PATH, process.env.FENNEC_HOOK_COMMAND);
console.log('removeFennecHooks: ok');
"

echo ""
echo "[3/3] verification — fennec entries should now be 0:"
if [ -f "$USER_SETTINGS" ]; then
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
    print(f"  {ev}: {len(blocks)} block(s) ({fennec} fennec)")
print(f"total fennec blocks remaining: {total_fennec}")
PY
else
  echo "  (file unlinked — no remaining hooks or other top-level keys)"
fi

echo ""
echo "UNINSTALL OK (~/.fennec/bin/fennec-hook is preserved; rm by hand if desired)"
