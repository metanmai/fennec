#!/usr/bin/env bash
#
# sign-test-artefact.sh
#
# Plan: 01-foundations / 01-03 Task 3
#
# Signs a macOS .pkg with the Developer ID Installer certificate, submits it to
# Apple's notary service, staples the resulting notarisation ticket, and asserts
# Gatekeeper acceptance via `spctl --assess`. This is the smoke test that proves
# the Phase 1 macOS signing + notarisation pipeline is ready for Plan 01-09 to
# invoke against the real fennec installer .pkg.
#
# Usage:
#   ./sign-test-artefact.sh <PATH_TO_UNSIGNED_PKG> <DEVELOPER_ID_INSTALLER_NAME>
#
#   Or with all defaults (smoke mode — creates an empty test .pkg):
#   ./sign-test-artefact.sh /tmp/fennec-test-unsigned.pkg "Developer ID Installer: Your Name (TEAMID)"
#
# If $1 does not exist, the script creates a minimal payload-free .pkg using
# `pkgbuild --nopayload` and signs that. This is the recommended smoke pattern
# — it exercises the full pipeline without needing a real payload until Plan
# 01-09 lands.
#
# Reads from environment:
#   APPLE_NOTARY_KEYCHAIN_PROFILE — defaults to "fennec-notary" (set by
#       `xcrun notarytool store-credentials` per installer/macos/CERT-PROCUREMENT.md)
#
# Companion docs:
#   - installer/macos/CERT-PROCUREMENT.md (the procurement playbook)
#   - .planning/phases/01-foundations/01-CERT-STATUS.md (the live tracker)
#   - .env.example line 67 (the env var key pinned to fennec-notary)
#
# Required tools (all ship with macOS / Xcode Command Line Tools):
#   - pkgbuild, productsign, xcrun (notarytool, stapler), spctl, shasum
#
# This script is NOT executed by Plan 01-03 — execution happens in Plan 01-09
# (full installer pipeline). Plan 01-03 just writes the script and makes it
# executable so 01-09 has it ready.

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Inputs
# ─────────────────────────────────────────────────────────────────────────

UNSIGNED_PKG="${1:-/tmp/fennec-test-unsigned.pkg}"
DEVELOPER_ID_INSTALLER_NAME="${2:-}"
APPLE_NOTARY_KEYCHAIN_PROFILE="${APPLE_NOTARY_KEYCHAIN_PROFILE:-fennec-notary}"

# Derive output path next to input
SIGNED_PKG="${UNSIGNED_PKG%.pkg}-signed.pkg"

if [[ -z "${DEVELOPER_ID_INSTALLER_NAME}" ]]; then
  cat >&2 <<'EOF'
Error: Developer ID Installer common-name is required as argument 2.

Usage:
  ./sign-test-artefact.sh <PATH_TO_UNSIGNED_PKG> "<DEVELOPER_ID_INSTALLER_NAME>"

Example (with smoke-mode auto-create of the unsigned .pkg):
  ./sign-test-artefact.sh /tmp/fennec-test-unsigned.pkg \
    "Developer ID Installer: Your Name (TEAMID1234)"

To list installed Developer ID Installer certificates:
  security find-identity -p basic -v | grep "Developer ID Installer"
EOF
  exit 2
fi

# ─────────────────────────────────────────────────────────────────────────
# 1. Create the unsigned .pkg if missing (smoke-mode)
# ─────────────────────────────────────────────────────────────────────────

if [[ ! -f "${UNSIGNED_PKG}" ]]; then
  echo "→ ${UNSIGNED_PKG} not found — creating minimal payload-free test .pkg"
  pkgbuild \
    --identifier dev.fennec.test \
    --version 0.0.1 \
    --nopayload \
    "${UNSIGNED_PKG}"
fi

if [[ ! -f "${UNSIGNED_PKG}" ]]; then
  echo "Error: failed to create or locate unsigned .pkg at ${UNSIGNED_PKG}" >&2
  exit 1
fi

echo "→ Unsigned input:    ${UNSIGNED_PKG}"
echo "→ Signed output:     ${SIGNED_PKG}"
echo "→ Signing identity:  ${DEVELOPER_ID_INSTALLER_NAME}"
echo "→ Keychain profile:  ${APPLE_NOTARY_KEYCHAIN_PROFILE}"
echo

# ─────────────────────────────────────────────────────────────────────────
# 2. Sign with productsign (uses Developer ID Installer)
# ─────────────────────────────────────────────────────────────────────────

echo "→ productsign ..."
productsign \
  --timestamp \
  --sign "${DEVELOPER_ID_INSTALLER_NAME}" \
  "${UNSIGNED_PKG}" \
  "${SIGNED_PKG}"

# ─────────────────────────────────────────────────────────────────────────
# 3. Submit to Apple notary service AND WAIT for the result
#
#    The --wait flag is CRITICAL per 01-RESEARCH.md §Pitfall 11. Without it,
#    notarytool returns immediately with a submission ID; subsequent steps
#    (staple, verify) would run before notarisation actually completes,
#    leading to silent breakage at distribution time.
# ─────────────────────────────────────────────────────────────────────────

echo "→ xcrun notarytool submit ... --wait"
xcrun notarytool submit "${SIGNED_PKG}" \
  --keychain-profile "${APPLE_NOTARY_KEYCHAIN_PROFILE}" \
  --wait

# ─────────────────────────────────────────────────────────────────────────
# 4. Staple the notarisation ticket onto the .pkg
#
#    Stapling embeds the ticket inside the .pkg so Gatekeeper works OFFLINE.
#    Without stapling, the first-run check requires network access to Apple.
# ─────────────────────────────────────────────────────────────────────────

echo "→ xcrun stapler staple"
xcrun stapler staple "${SIGNED_PKG}"

# ─────────────────────────────────────────────────────────────────────────
# 5. Verify with spctl — assert "source=Notarized Developer ID"
#
#    This is the canonical Gatekeeper acceptance test for a signed,
#    notarised, stapled .pkg.
# ─────────────────────────────────────────────────────────────────────────

echo "→ spctl --assess --type install -vvv"
SPCTL_OUTPUT="$(spctl --assess --type install -vvv "${SIGNED_PKG}" 2>&1)"
echo "${SPCTL_OUTPUT}"

if ! echo "${SPCTL_OUTPUT}" | grep -q "source=Notarized Developer ID"; then
  echo >&2
  echo "ASSERT FAILED: spctl output did not contain 'source=Notarized Developer ID'" >&2
  echo "→ This means the .pkg is not a fully-notarised Developer ID artefact." >&2
  echo "→ Investigate the notarytool log: xcrun notarytool log <submission-id> --keychain-profile ${APPLE_NOTARY_KEYCHAIN_PROFILE}" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
# 6. Print SHA-256 for downstream traceability
#
#    Plan 01-09 will record this hash in release manifests so consumers can
#    detect tampering even when offline of Apple's notary service.
# ─────────────────────────────────────────────────────────────────────────

echo
SHA256_HASH="$(shasum -a 256 "${SIGNED_PKG}" | awk '{print $1}')"
echo "✓ Signed + notarised + stapled: ${SIGNED_PKG}"
echo "✓ SHA-256: ${SHA256_HASH}"
echo
echo "─────────────────────────────────────────────────────────────────────"
echo "Pipeline complete. Plan 01-09 will invoke this script against the real"
echo "fennec .pkg payload. For now, the smoke proves the macOS signing path"
echo "(Developer ID Installer + notarytool + stapler + spctl) is wired"
echo "correctly end-to-end."
echo "─────────────────────────────────────────────────────────────────────"
