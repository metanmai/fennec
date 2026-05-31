#!/usr/bin/env bash
#
# fennec macOS .pkg preinstall script (Plan 01-09 Task 2).
#
# Runs as root before the .pkg payload is installed. Responsibilities:
#   1. Reject installation on macOS < 13.0 (Ventura). Phase 1 daemon
#      assumes APFS + the modern launchd APIs only available on Ventura+.
#   2. Stop any existing fennec daemon so the new payload can overwrite
#      its files atomically.
#
# Apple's installer mechanism invokes this with no arguments and inherits
# pkg-installer environment variables. Exit code != 0 aborts the install.

set -euo pipefail

# -------------------------------------------------------------------------
# 1. macOS version check (D-04 + 01-RESEARCH.md §Pitfall 14 — Big Sur and
# earlier lack some launchctl bootstrap semantics fennec relies on)
# -------------------------------------------------------------------------
MIN_MAJOR=13
PRODUCT_VERSION="$(sw_vers -productVersion)"
MAJOR="${PRODUCT_VERSION%%.*}"

if [[ -z "${MAJOR}" || "${MAJOR}" -lt "${MIN_MAJOR}" ]]; then
  cat >&2 <<EOF
fennec preinstall: unsupported macOS version ${PRODUCT_VERSION}

fennec Phase 1 requires macOS ${MIN_MAJOR}.0 (Ventura) or later. Earlier
versions lack the launchd APIs the daemon depends on.

To install fennec, upgrade macOS to ${MIN_MAJOR}.0+ and re-run this .pkg.
EOF
  exit 1
fi

# -------------------------------------------------------------------------
# 2. Stop existing fennec daemon + agent (ignore-errors — they may not
# be loaded on a fresh install)
# -------------------------------------------------------------------------
if [[ -f /Library/LaunchDaemons/dev.fennec.daemon.plist ]]; then
  /bin/launchctl unload /Library/LaunchDaemons/dev.fennec.daemon.plist 2>/dev/null || true
fi
if [[ -f /Library/LaunchAgents/dev.fennec.notifier.plist ]]; then
  /bin/launchctl unload /Library/LaunchAgents/dev.fennec.notifier.plist 2>/dev/null || true
fi

exit 0
