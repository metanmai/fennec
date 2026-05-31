#!/usr/bin/env bash
#
# fennec macOS installer build pipeline (Plan 01-09 Task 2 + Task 3).
#
# Builds an installable .pkg in two modes:
#
#   UNSIGNED MODE (autonomous — runs without Apple Developer credentials):
#     pkgbuild + productbuild produce installer/build/fennec-unsigned.pkg.
#     Useful for dev testing on a developer's own machine where Gatekeeper
#     accepts unsigned local installs.
#
#   SIGNED MODE (gated on DEVELOPER_ID_INSTALLER_NAME + APPLE_NOTARY_KEYCHAIN_PROFILE):
#     unsigned -> productsign -> xcrun notarytool submit --wait ->
#     xcrun stapler staple -> spctl --assess. Produces
#     installer/build/fennec.pkg signed + notarised + stapled +
#     spctl-asserted. This is the DAE-08 + DAE-12 deliverable.
#
# Environment:
#   DEVELOPER_ID_INSTALLER_NAME    (e.g. "Developer ID Installer: Acme Corp (TEAMID1234)")
#       Required for SIGNED mode. From `security find-identity -p basic -v`.
#   APPLE_NOTARY_KEYCHAIN_PROFILE  (defaults to "fennec-notary")
#       Set up via `xcrun notarytool store-credentials` per
#       installer/macos/CERT-PROCUREMENT.md.
#   FENNEC_VERSION                 (defaults to 0.1.0)
#
# Usage:
#   bash installer/macos/build-pkg.sh                  # unsigned mode
#
#   export DEVELOPER_ID_INSTALLER_NAME="Developer ID Installer: ... (TEAMID)"
#   export APPLE_NOTARY_KEYCHAIN_PROFILE="fennec-notary"
#   bash installer/macos/build-pkg.sh                  # signed mode

set -euo pipefail

# -------------------------------------------------------------------------
# Layout
# -------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_DIR="${PROJECT_ROOT}/installer/macos"
BUILD_DIR="${PROJECT_ROOT}/installer/build"
PAYLOAD_DIR="${BUILD_DIR}/payload"
SCRIPTS_DIR="${BUILD_DIR}/scripts"

VERSION="${FENNEC_VERSION:-0.1.0}"
PKG_IDENTIFIER="dev.fennec"
COMPONENT_PKG="${BUILD_DIR}/fennec-component.pkg"
UNSIGNED_PKG="${BUILD_DIR}/fennec-unsigned.pkg"
SIGNED_PKG="${BUILD_DIR}/fennec.pkg"

# -------------------------------------------------------------------------
# Step 0: clean + prepare directories
# -------------------------------------------------------------------------
echo "==> Preparing build directories"
rm -rf "${BUILD_DIR}"
mkdir -p "${PAYLOAD_DIR}/usr/local/fennec/bin"
mkdir -p "${PAYLOAD_DIR}/usr/local/fennec/lib/daemon"
mkdir -p "${PAYLOAD_DIR}/usr/local/fennec/share"
mkdir -p "${PAYLOAD_DIR}/Library/LaunchDaemons"
mkdir -p "${PAYLOAD_DIR}/Library/LaunchAgents"
mkdir -p "${SCRIPTS_DIR}"

# -------------------------------------------------------------------------
# Step 1: build the daemon JS bundle
# -------------------------------------------------------------------------
echo "==> Building daemon JS bundle"
(cd "${PROJECT_ROOT}" && npm -w @fennec/daemon run build --silent)

# Copy compiled JS + the gitleaks ruleset assets (copy-assets.mjs already
# put them into daemon/dist/redact/)
cp -R "${PROJECT_ROOT}/daemon/dist/." "${PAYLOAD_DIR}/usr/local/fennec/lib/daemon/"

# Copy @fennec/shared dist if present (workspace dep used at runtime)
if [[ -d "${PROJECT_ROOT}/packages/shared/dist" ]]; then
  mkdir -p "${PAYLOAD_DIR}/usr/local/fennec/lib/shared"
  cp -R "${PROJECT_ROOT}/packages/shared/dist/." "${PAYLOAD_DIR}/usr/local/fennec/lib/shared/"
fi

# -------------------------------------------------------------------------
# Step 2: install the Go binaries (built by plans 01-07 + 01-08)
# -------------------------------------------------------------------------
echo "==> Installing Go binaries"
HOOK_BIN="${PROJECT_ROOT}/shim/build/fennec-hook-darwin-arm64"
NOTIFIER_BIN="${PROJECT_ROOT}/notifier/build/fennec-notifier-darwin-arm64"

if [[ ! -f "${HOOK_BIN}" ]]; then
  echo "ERROR: shim binary missing at ${HOOK_BIN}. Run \`make -C shim darwin-arm64\` first." >&2
  exit 1
fi
if [[ ! -f "${NOTIFIER_BIN}" ]]; then
  echo "ERROR: notifier binary missing at ${NOTIFIER_BIN}. Run \`make -C notifier darwin-arm64\` first." >&2
  exit 1
fi

cp "${HOOK_BIN}" "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec-hook"
cp "${NOTIFIER_BIN}" "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec-notifier"
chmod 0755 "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec-hook"
chmod 0755 "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec-notifier"

# -------------------------------------------------------------------------
# Step 3: install the fennec wrapper script (W-5 resolution path a)
#         exec's `node /usr/local/fennec/lib/daemon/index.js "$@"`
# -------------------------------------------------------------------------
echo "==> Installing fennec wrapper script"
cat > "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec" <<'WRAPPER_EOF'
#!/usr/bin/env bash
# fennec CLI wrapper (Plan 01-09 Task 2, W-5 resolution path a).
#
# Exec's `node /usr/local/fennec/lib/daemon/index.js "$@"` via the system
# Node 22+ on PATH. Postinstall warns about the Node 22+ prerequisite.
#
# We intentionally do NOT vendor a Node binary in Phase 1 (the .pkg would
# need an extra ~50MB and signed-binary handling). Phase 5+ may vendor
# Node if first-run friction becomes a measurable problem.
set -euo pipefail
exec node /usr/local/fennec/lib/daemon/index.js "$@"
WRAPPER_EOF
chmod 0755 "${PAYLOAD_DIR}/usr/local/fennec/bin/fennec"

# -------------------------------------------------------------------------
# Step 4: copy plists
# -------------------------------------------------------------------------
echo "==> Copying LaunchDaemon + LaunchAgent plists"
cp "${INSTALLER_DIR}/dev.fennec.daemon.plist" "${PAYLOAD_DIR}/Library/LaunchDaemons/"
cp "${INSTALLER_DIR}/dev.fennec.notifier.plist" "${PAYLOAD_DIR}/Library/LaunchAgents/"

# -------------------------------------------------------------------------
# Step 5: copy bundled docs (PRIVACY.md)
# -------------------------------------------------------------------------
if [[ -f "${PROJECT_ROOT}/docs/PRIVACY.md" ]]; then
  cp "${PROJECT_ROOT}/docs/PRIVACY.md" "${PAYLOAD_DIR}/usr/local/fennec/share/PRIVACY.md"
fi

# -------------------------------------------------------------------------
# Step 6: stage scripts dir for pkgbuild
# -------------------------------------------------------------------------
echo "==> Staging preinstall + postinstall scripts"
cp "${INSTALLER_DIR}/preinstall.sh" "${SCRIPTS_DIR}/preinstall"
cp "${INSTALLER_DIR}/postinstall.sh" "${SCRIPTS_DIR}/postinstall"
chmod 0755 "${SCRIPTS_DIR}/preinstall" "${SCRIPTS_DIR}/postinstall"

# -------------------------------------------------------------------------
# Step 7: pkgbuild — produces fennec-component.pkg
# -------------------------------------------------------------------------
echo "==> Running pkgbuild"
pkgbuild \
  --identifier "${PKG_IDENTIFIER}" \
  --version "${VERSION}" \
  --scripts "${SCRIPTS_DIR}" \
  --root "${PAYLOAD_DIR}" \
  --install-location "/" \
  "${COMPONENT_PKG}"

# -------------------------------------------------------------------------
# Step 8: productbuild — produces fennec-unsigned.pkg using Distribution.xml
# -------------------------------------------------------------------------
echo "==> Running productbuild"
productbuild \
  --distribution "${INSTALLER_DIR}/Distribution.xml" \
  --resources "${INSTALLER_DIR}/Resources" \
  --package-path "${BUILD_DIR}" \
  "${UNSIGNED_PKG}"

UNSIGNED_SHA="$(shasum -a 256 "${UNSIGNED_PKG}" | awk '{print $1}')"
echo
echo "✓ Unsigned .pkg built: ${UNSIGNED_PKG}"
echo "  SHA-256: ${UNSIGNED_SHA}"
echo

# -------------------------------------------------------------------------
# Step 9: signed mode (gated on cert availability)
# -------------------------------------------------------------------------
if [[ -z "${DEVELOPER_ID_INSTALLER_NAME:-}" ]]; then
  cat <<EOF
==================================================================
SIGNED MODE SKIPPED
==================================================================

Reason: DEVELOPER_ID_INSTALLER_NAME is not set.

To produce a signed + notarised + stapled fennec.pkg (DAE-08 + DAE-12),
set:

  export DEVELOPER_ID_INSTALLER_NAME="Developer ID Installer: <Name> (TEAMID)"
  export APPLE_NOTARY_KEYCHAIN_PROFILE="fennec-notary"

Then re-run this script. The signed mode invokes
installer/macos/sign-test-artefact.sh (from Plan 01-03) which runs:

  productsign -> xcrun notarytool submit --wait -> xcrun stapler staple
  -> spctl --assess --type install (must report 'source=Notarized Developer ID')

See .planning/phases/01-foundations/01-CERT-STATUS.md for the Team ID
+ cert SHA-1 + keychain profile tracker.

EOF
  exit 0
fi

echo "==> Signed mode: invoking sign-test-artefact.sh"
bash "${INSTALLER_DIR}/sign-test-artefact.sh" "${UNSIGNED_PKG}" "${DEVELOPER_ID_INSTALLER_NAME}"

# sign-test-artefact.sh writes the signed output as <input>-signed.pkg
# Rename to the canonical installer/build/fennec.pkg
SIGNED_FROM_HELPER="${UNSIGNED_PKG%.pkg}-signed.pkg"
mv "${SIGNED_FROM_HELPER}" "${SIGNED_PKG}"

SIGNED_SHA="$(shasum -a 256 "${SIGNED_PKG}" | awk '{print $1}')"
echo
echo "✓ Signed + notarised + stapled .pkg: ${SIGNED_PKG}"
echo "  SHA-256: ${SIGNED_SHA}"
echo
