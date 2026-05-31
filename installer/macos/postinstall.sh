#!/usr/bin/env bash
#
# fennec macOS .pkg postinstall script (Plan 01-09 Task 2).
#
# Runs as root after the .pkg payload is unpacked. Responsibilities:
#   1. Create runtime directories (/etc/fennec, /var/log/fennec, /var/db/fennec)
#      with the correct modes + ownership.
#   2. Generate the shim-secret at /etc/fennec/shim-secret per Plan 01-07's
#      Pattern 9 (mode 0644 — same-UID shim can read, cross-UID denied).
#   3. Warn about the Node 22+ runtime prerequisite per W-5 (the
#      /usr/local/fennec/bin/fennec wrapper exec's `node` from PATH).
#   4. Detect a Managed Preferences profile pushed by MDM. If present,
#      invoke `fennec init --read-config <path>` to bring the daemon
#      online non-interactively. If absent, print a friendly message
#      directing the user to `sudo fennec wizard`.
#
# Apple's installer invokes this with no arguments. Exit code != 0
# leaves the .pkg as "installed but postinstall failed" — Console.app
# surfaces the failure but the files remain on disk so a re-run is
# possible.

set -euo pipefail

# -------------------------------------------------------------------------
# 1. Create runtime directories with correct ACLs
# -------------------------------------------------------------------------
/bin/mkdir -p /etc/fennec
/bin/chmod 0755 /etc/fennec
/usr/sbin/chown root:wheel /etc/fennec

/bin/mkdir -p /var/log/fennec
/bin/chmod 0750 /var/log/fennec
/usr/sbin/chown root:wheel /var/log/fennec

/bin/mkdir -p /var/db/fennec
/bin/chmod 0700 /var/db/fennec
/usr/sbin/chown root:wheel /var/db/fennec

# -------------------------------------------------------------------------
# 2. Generate shim-secret (mode 0644 per Pattern 9 in Plan 01-07)
#    Same-UID shim reads it; cross-UID processes denied by the loopback
#    bridge's secret check on the daemon side.
# -------------------------------------------------------------------------
if [[ ! -f /etc/fennec/shim-secret ]]; then
  /usr/bin/openssl rand -base64 32 > /etc/fennec/shim-secret
  /bin/chmod 0644 /etc/fennec/shim-secret
  /usr/sbin/chown root:wheel /etc/fennec/shim-secret
fi

# -------------------------------------------------------------------------
# 3. Verify Node 22+ is on PATH (W-5 prerequisite)
#    The /usr/local/fennec/bin/fennec wrapper exec's `node` from PATH;
#    without it, the LaunchDaemon will exit non-zero immediately.
# -------------------------------------------------------------------------
NODE_PATH="$(/usr/bin/which node || true)"
if [[ -z "${NODE_PATH}" ]]; then
  cat >&2 <<EOF
fennec postinstall: WARNING — Node.js is not on the system PATH.

The fennec daemon requires Node.js 22 LTS or later. The wrapper at
/usr/local/fennec/bin/fennec exec's \`node /usr/local/fennec/lib/daemon/index.js daemon\`
which will fail until Node 22+ is installed and discoverable via PATH.

Install Node 22 via Homebrew:    brew install node@22
Or via the official installer:   https://nodejs.org/

After installing Node, re-run:   sudo launchctl load -w /Library/LaunchDaemons/dev.fennec.daemon.plist
EOF
else
  NODE_VERSION="$(${NODE_PATH} --version 2>/dev/null || echo unknown)"
  echo "fennec postinstall: detected Node ${NODE_VERSION} at ${NODE_PATH}"
fi

# -------------------------------------------------------------------------
# 4. MDM detection — if a Configuration Profile has dropped a Managed
#    Preferences file for dev.fennec.daemon, invoke `fennec init`
#    non-interactively to enroll + bring up the daemon.
# -------------------------------------------------------------------------
MANAGED_PROFILE="/Library/Managed Preferences/dev.fennec.daemon.plist"

if [[ -f "${MANAGED_PROFILE}" ]]; then
  echo "fennec postinstall: detected Managed Preferences profile — running fennec init"
  if /usr/local/fennec/bin/fennec init --read-config "${MANAGED_PROFILE}"; then
    /bin/launchctl load -w /Library/LaunchDaemons/dev.fennec.daemon.plist || true
    # Helper LaunchAgent loads on next user login; we cannot reliably
    # asuser-load it from postinstall (no GUI session yet at install time).
    echo "fennec postinstall: daemon registered. Helper LaunchAgent will load on next user login."
  else
    echo "fennec postinstall: fennec init failed; daemon NOT registered. Inspect /var/log/fennec/daemon.log." >&2
    exit 1
  fi
else
  cat <<EOF

fennec installed (no MDM Configuration Profile detected).

To complete setup:
  - Personal use:  sudo fennec wizard
  - Org admin:     push a Configuration Profile via your MDM tool that
                   defines org_install_secret for dev.fennec.daemon, then
                   re-run /usr/local/fennec/bin/fennec init --read-config \
                     "/Library/Managed Preferences/dev.fennec.daemon.plist"

Privacy policy: /usr/local/fennec/share/PRIVACY.md
EOF
fi

exit 0
