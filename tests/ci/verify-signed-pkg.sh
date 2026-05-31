#!/usr/bin/env bash
#
# tests/ci/verify-signed-pkg.sh — Assert a .pkg is Apple-notarised +
# signed by a real Developer ID Installer cert (not self-signed,
# not unsigned).
#
# Acceptance gate for ROADMAP Phase 1 success criterion 2 and for
# the smoke test in Plan 01-10 Task 4 (signed .pkg install on dev
# machine without Gatekeeper dialog).
#
# Usage:
#   bash tests/ci/verify-signed-pkg.sh installer/build/fennec.pkg
#
# Exits 0 on pass, 1 on any failure with the diagnostic output of the
# failing check on stderr. Designed to be called from the e2e smoke
# spec AND from operators running the manual install runbook.
#
# Threat: T-10-05 (smoke test uses a different .pkg than the signed
# one) — this script's SHA-256 print is the chain-of-custody marker
# the operator copies into 01-SMOKE-LOG.md.

set -euo pipefail

if [ $# -lt 1 ]; then
  printf 'usage: %s <path-to-pkg>\n' "$0" >&2
  exit 1
fi

PKG_PATH="$1"

if [ ! -f "${PKG_PATH}" ]; then
  printf 'error: pkg not found at %s\n' "${PKG_PATH}" >&2
  exit 1
fi

PKG_SHA="$(shasum -a 256 "${PKG_PATH}" | awk '{print $1}')"
printf 'verify-signed-pkg: %s\n' "${PKG_PATH}"
printf '  SHA-256: %s\n' "${PKG_SHA}"

# Check 1 — spctl --assess for Notarised Developer ID.
# Gatekeeper's stricter assessment: must report `source=Notarized
# Developer ID` (the only acceptable source for ROADMAP criterion 2).
printf '\n[1/2] spctl --assess --type install -vvv\n'
SPCTL_OUT="$(spctl --assess --type install -vvv "${PKG_PATH}" 2>&1 || true)"
printf '%s\n' "${SPCTL_OUT}"

if ! printf '%s' "${SPCTL_OUT}" | grep -q "source=Notarized Developer ID"; then
  printf '\nFAIL: spctl did not report `source=Notarized Developer ID`.\n' >&2
  printf 'A correctly signed + notarised .pkg must show this exact source.\n' >&2
  printf 'If the .pkg is signed but not notarised, run notarytool + stapler.\n' >&2
  exit 1
fi

# Check 2 — pkgutil --check-signature must show a Developer ID
# Installer certificate (NOT self-signed, NOT "no signature").
printf '\n[2/2] pkgutil --check-signature\n'
PKGUTIL_OUT="$(pkgutil --check-signature "${PKG_PATH}" 2>&1 || true)"
printf '%s\n' "${PKGUTIL_OUT}"

if ! printf '%s' "${PKGUTIL_OUT}" | grep -q "Developer ID Installer:"; then
  printf '\nFAIL: pkgutil did not report a `Developer ID Installer:` signer.\n' >&2
  printf 'Signer must be a real Developer ID Installer cert (not self-signed,\n' >&2
  printf 'not "no signature"). Re-build with productsign + sign-test-artefact.sh.\n' >&2
  exit 1
fi

# Reject self-signed certs explicitly (in case `Developer ID
# Installer:` appears as a substring inside a self-signed CN).
if printf '%s' "${PKGUTIL_OUT}" | grep -qi "self-signed"; then
  printf '\nFAIL: pkgutil reports the signer is self-signed.\n' >&2
  exit 1
fi

printf '\nPASS: %s is signed + notarised by a Developer ID Installer cert.\n' "${PKG_PATH}"
printf '  SHA-256: %s\n' "${PKG_SHA}"
printf '  Source:  Notarized Developer ID (verified by spctl)\n'
printf '  Signer:  (see pkgutil output above)\n'
