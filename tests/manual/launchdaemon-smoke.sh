#!/usr/bin/env bash
#
# tests/manual/launchdaemon-smoke.sh — DAE-05 verification.
#
# Asserts the fennec LaunchDaemon + Helper LaunchAgent are loaded and
# running as the expected uid/gid with the expected file ACLs.
#
# Designed to be invoked AFTER the signed .pkg is installed AND
# `sudo fennec wizard` (or `sudo fennec init --install-secret <s>`)
# has completed.
#
# Usage:
#   sudo bash tests/manual/launchdaemon-smoke.sh
#
# Exits 0 on full pass, 1 on the first failed check. Each check prints
# its diagnostic output on stderr.
#
# Companion to: Plan 01-10 Task 4 acceptance criteria.

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'error: launchdaemon-smoke.sh is macOS-only.\n' >&2
  exit 1
fi

PASS=0
FAIL=0
TOTAL=0

check() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  printf '\n[%d] %s\n' "${TOTAL}" "${name}"
  if "$@"; then
    PASS=$((PASS + 1))
    printf '    PASS\n'
  else
    FAIL=$((FAIL + 1))
    printf '    FAIL\n' >&2
  fi
}

# Check 1 — launchctl shows BOTH fennec entries
check_launchctl_list() {
  local out
  if ! out="$(sudo launchctl list 2>&1)"; then
    printf 'sudo launchctl list failed: %s\n' "${out}" >&2
    return 1
  fi
  local count
  count="$(printf '%s\n' "${out}" | grep -c "fennec" || true)"
  if [ "${count}" -lt 2 ]; then
    printf 'expected ≥ 2 fennec entries in launchctl list, got %d\n' "${count}" >&2
    printf '%s\n' "${out}" | grep "fennec" >&2 || true
    return 1
  fi
  printf '    launchctl entries: %d\n' "${count}"
  return 0
}

# Check 2 — daemon process running as root, executing the daemon entry
check_daemon_process() {
  local out
  out="$(ps -axo uid,pid,command | grep -E 'fennec.*(daemon|/index.js)' | grep -v grep || true)"
  if [ -z "${out}" ]; then
    printf 'no fennec daemon process running (looked for "fennec daemon" or index.js)\n' >&2
    return 1
  fi
  printf '%s\n' "${out}"
  if ! printf '%s\n' "${out}" | awk '{print $1}' | grep -q '^0$'; then
    printf 'daemon process not running as uid 0 (root)\n' >&2
    return 1
  fi
  return 0
}

# Check 3 — LaunchDaemon plist file ACL (root:wheel mode 644)
check_daemon_plist_acl() {
  local plist="/Library/LaunchDaemons/dev.fennec.daemon.plist"
  if [ ! -f "${plist}" ]; then
    printf 'plist not found at %s\n' "${plist}" >&2
    return 1
  fi
  local info owner group mode
  info="$(stat -f '%Su %Sg %Lp' "${plist}")"
  owner="$(printf '%s' "${info}" | awk '{print $1}')"
  group="$(printf '%s' "${info}" | awk '{print $2}')"
  mode="$(printf '%s' "${info}" | awk '{print $3}')"
  printf '    %s  %s:%s mode %s\n' "${plist}" "${owner}" "${group}" "${mode}"
  # Use a single combined test so we exit non-zero cleanly under set -e
  # without `return` short-circuiting via the AND chain.
  if [ "${owner}" = "root" ] && [ "${group}" = "wheel" ] && [ "${mode}" = "644" ]; then
    return 0
  fi
  printf 'plist must be root:wheel mode 644 (got %s:%s mode %s)\n' "${owner}" "${group}" "${mode}" >&2
  return 1
}

# Check 4 — per-machine API key at /var/db/fennec/key root:wheel 0400
check_api_key_acl() {
  local key="/var/db/fennec/key"
  if [ ! -f "${key}" ]; then
    printf 'api key not found at %s\n' "${key}" >&2
    return 1
  fi
  local info owner group mode
  info="$(sudo stat -f '%Su %Sg %Lp' "${key}")"
  owner="$(printf '%s' "${info}" | awk '{print $1}')"
  group="$(printf '%s' "${info}" | awk '{print $2}')"
  mode="$(printf '%s' "${info}" | awk '{print $3}')"
  printf '    %s  %s:%s mode %s\n' "${key}" "${owner}" "${group}" "${mode}"
  if [ "${owner}" = "root" ] && [ "${group}" = "wheel" ] && [ "${mode}" = "400" ]; then
    return 0
  fi
  printf 'api key must be root:wheel mode 0400 (got %s:%s mode %s)\n' "${owner}" "${group}" "${mode}" >&2
  return 1
}

# Check 5 — Helper LaunchAgent plist exists and is root:wheel 644
check_agent_plist_acl() {
  local plist="/Library/LaunchAgents/dev.fennec.notifier.plist"
  if [ ! -f "${plist}" ]; then
    printf 'helper-agent plist not found at %s\n' "${plist}" >&2
    return 1
  fi
  local info owner group mode
  info="$(stat -f '%Su %Sg %Lp' "${plist}")"
  owner="$(printf '%s' "${info}" | awk '{print $1}')"
  group="$(printf '%s' "${info}" | awk '{print $2}')"
  mode="$(printf '%s' "${info}" | awk '{print $3}')"
  printf '    %s  %s:%s mode %s\n' "${plist}" "${owner}" "${group}" "${mode}"
  if [ "${owner}" = "root" ] && [ "${group}" = "wheel" ] && [ "${mode}" = "644" ]; then
    return 0
  fi
  printf 'helper-agent plist must be root:wheel mode 644 (got %s:%s mode %s)\n' "${owner}" "${group}" "${mode}" >&2
  return 1
}

printf 'fennec LaunchDaemon smoke — %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

check "launchctl list shows ≥ 2 fennec entries (daemon + notifier)" check_launchctl_list
check "fennec daemon process running as root" check_daemon_process
check "LaunchDaemon plist root:wheel mode 644" check_daemon_plist_acl
check "Helper LaunchAgent plist root:wheel mode 644" check_agent_plist_acl
check "api_key at /var/db/fennec/key root:wheel mode 0400" check_api_key_acl

printf '\nResult: %d/%d passed\n' "${PASS}" "${TOTAL}"
[ "${FAIL}" -eq 0 ] || exit 1
