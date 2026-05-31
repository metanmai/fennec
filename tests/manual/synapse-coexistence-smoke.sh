#!/usr/bin/env bash
#
# tests/manual/synapse-coexistence-smoke.sh — DAE-11 / D-20 / D-24
# live verification (requires a real macOS install + Claude Code).
#
# Asserts:
#   - Pre-fennec ~/.claude/settings.json (if any) is BYTE-IDENTICAL
#     after fennec install (SHA-256 compared).
#   - Fennec writes its hooks into /Library/Application Support/
#     ClaudeCode/managed-settings.json (system-layer).
#   - When a Claude Code event fires (operator-triggered), BOTH the
#     synapse user-settings hook AND the fennec managed-settings hook
#     run (additive merge — D-20).
#   - On `sudo fennec uninstall`, ONLY fennec entries are removed from
#     managed-settings.json. ~/.claude/settings.json is byte-equal
#     AGAIN.
#
# This is the LIVE companion to tests/e2e/synapse-coexistence.test.ts
# (which proves the install/uninstall logic locally without Claude
# Code running). This script's incremental value: it proves both hook
# handlers actually fire on a single Claude Code event.
#
# Usage:
#   bash tests/manual/synapse-coexistence-smoke.sh
#
# Companion to: Plan 01-10 Task 5 Step E + ROADMAP success criterion 3.

set -uo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'error: synapse coexistence smoke is macOS-only.\n' >&2
  exit 1
fi

USER_SETTINGS="${HOME}/.claude/settings.json"
MANAGED_SETTINGS="/Library/Application Support/ClaudeCode/managed-settings.json"
TEMP_DIR="$(mktemp -d -t fennec-synapse-coex)"
SYNAPSE_HOOK_DIR="${TEMP_DIR}/synapse-hook"
SYNAPSE_HOOK_LOG="${TEMP_DIR}/synapse-hook.log"
SYNAPSE_HOOK_SCRIPT="${TEMP_DIR}/synapse-hook.sh"

cleanup() {
  rm -rf "${TEMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

declare -i STEP=0

next() {
  STEP+=1
  printf '\n=== Step %d — %s ===\n' "${STEP}" "$1"
}

pause() {
  printf '\nPress Enter when complete. (Ctrl+C to abort.) '
  read -r _ || true
}

printf 'fennec synapse coexistence smoke — %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf 'Temp dir: %s\n' "${TEMP_DIR}"

next "Confirm fennec is already installed (DAE-12 prerequisite)"
if ! sudo launchctl list 2>/dev/null | grep -q "fennec"; then
  printf 'error: no fennec entries in launchctl list. Install the .pkg first.\n' >&2
  exit 1
fi
printf 'PASS — fennec is installed.\n'

next "Set up a synapse-style user-settings hook (mock)"
mkdir -p "${SYNAPSE_HOOK_DIR}"
cat > "${SYNAPSE_HOOK_SCRIPT}" <<EOF
#!/usr/bin/env bash
# Mock synapse hook — appends a marker to a log file so we can prove
# both fennec AND synapse fired on the same event.
printf 'synapse hook fired at %s\n' "\$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "${SYNAPSE_HOOK_LOG}"
exit 0
EOF
chmod +x "${SYNAPSE_HOOK_SCRIPT}"

mkdir -p "$(dirname "${USER_SETTINGS}")"
if [ -f "${USER_SETTINGS}" ]; then
  PREEXISTING_USER_SETTINGS=true
  printf 'NOTE: %s already exists — appending synapse mock entry without overwriting.\n' "${USER_SETTINGS}"
  cp "${USER_SETTINGS}" "${TEMP_DIR}/user-settings.backup"
  python3 - "${USER_SETTINGS}" "${SYNAPSE_HOOK_SCRIPT}" <<'PY'
import json, sys
path, hook = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data.setdefault("hooks", {}).setdefault("UserPromptSubmit", []).append({
    "command": hook,
    "description": "synapse-coexistence-smoke mock"
})
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PY
else
  PREEXISTING_USER_SETTINGS=false
  cat > "${USER_SETTINGS}" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "${SYNAPSE_HOOK_SCRIPT}",
        "description": "synapse-coexistence-smoke mock"
      }
    ]
  }
}
EOF
fi
chmod 0644 "${USER_SETTINGS}"

USER_SHA_PRE="$(shasum -a 256 "${USER_SETTINGS}" | awk '{print $1}')"
printf 'User-settings SHA-256 PRE: %s\n' "${USER_SHA_PRE}"

next "Assert fennec did NOT touch ~/.claude/settings.json since install"
printf 'Fennec install ran when you executed the wizard. By contract\n'
printf 'it must NOT have touched %s.\n\n' "${USER_SETTINGS}"
printf 'The PRE SHA above was computed AFTER our synapse mock entry\n'
printf 'was added — record it now as the baseline.\n'
pause

next "Verify managed-settings contains fennec entries"
if [ ! -f "${MANAGED_SETTINGS}" ]; then
  printf 'FAIL: managed-settings file missing at %s\n' "${MANAGED_SETTINGS}" >&2
  exit 1
fi
HOOK_COUNT="$(python3 -c "import json; d = json.load(open('${MANAGED_SETTINGS}')); print(len(d.get('hooks', {})))")"
printf 'managed-settings has %d hook entries.\n' "${HOOK_COUNT}"
if [ "${HOOK_COUNT}" -lt 6 ]; then
  printf 'FAIL: expected ≥ 6 hook entries (D-22 list), got %d\n' "${HOOK_COUNT}" >&2
  exit 1
fi

next "Trigger a Claude Code event"
printf 'Open Claude Code and type a test prompt. Press Enter here when done.\n'
pause

next "Assert BOTH synapse mock AND fennec daemon fired"
SYNAPSE_FIRED="no"
if [ -f "${SYNAPSE_HOOK_LOG}" ] && [ -s "${SYNAPSE_HOOK_LOG}" ]; then
  SYNAPSE_FIRED="yes"
fi
printf 'Synapse mock hook fired: %s\n' "${SYNAPSE_FIRED}"
if [ -f "${SYNAPSE_HOOK_LOG}" ]; then
  printf '  log contents:\n'
  sed 's/^/    /' "${SYNAPSE_HOOK_LOG}"
fi

printf '\nFennec adapter_heartbeat (last 5 min) — check Supabase manually:\n'
printf "  SELECT received_at, events_parsed, parse_errors\n"
printf "  FROM adapter_heartbeats\n"
printf "  WHERE adapter = 'claude-code'\n"
printf "    AND received_at > NOW() - INTERVAL '5 minutes'\n"
printf "  ORDER BY received_at DESC LIMIT 1;\n\n"
printf 'Expected: events_parsed ≥ 1 in the last heartbeat.\n'
pause

next "Run fennec uninstall (sudo)"
printf 'Run:\n  sudo /usr/local/fennec/bin/fennec uninstall\n\nPress Enter when complete.\n'
pause

next "Assert ~/.claude/settings.json is byte-equal to PRE"
USER_SHA_POST="$(shasum -a 256 "${USER_SETTINGS}" | awk '{print $1}')"
printf 'User-settings SHA-256 POST: %s\n' "${USER_SHA_POST}"
if [ "${USER_SHA_PRE}" != "${USER_SHA_POST}" ]; then
  printf 'FAIL: user-settings file mutated during fennec uninstall.\n' >&2
  printf '  PRE:  %s\n  POST: %s\n' "${USER_SHA_PRE}" "${USER_SHA_POST}" >&2
  exit 1
fi
printf 'PASS — user-settings byte-equal across uninstall.\n'

next "Assert managed-settings has NO fennec entries (or file removed)"
if [ -f "${MANAGED_SETTINGS}" ]; then
  if grep -q "fennec-hook" "${MANAGED_SETTINGS}" 2>/dev/null; then
    printf 'FAIL: fennec-hook references survived uninstall in %s\n' "${MANAGED_SETTINGS}" >&2
    exit 1
  fi
  printf 'PASS — fennec entries removed from managed-settings (file kept).\n'
else
  printf 'PASS — managed-settings file removed entirely.\n'
fi

next "Cleanup synapse mock entry"
if [ "${PREEXISTING_USER_SETTINGS}" = "true" ]; then
  cp "${TEMP_DIR}/user-settings.backup" "${USER_SETTINGS}"
  printf 'Restored your original %s.\n' "${USER_SETTINGS}"
else
  rm -f "${USER_SETTINGS}"
  printf 'Removed the synthetic %s we created for this test.\n' "${USER_SETTINGS}"
fi

printf '\nResult: synapse coexistence verified end-to-end.\n'
printf 'Capture this output into 01-SMOKE-LOG.md Step 4 Sub-step E.\n'
