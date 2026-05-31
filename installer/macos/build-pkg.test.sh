#!/usr/bin/env bash
#
# Smoke test for installer/macos/build-pkg.sh (Plan 01-09 Task 2).
#
# This does NOT run the full build pipeline (too slow + sometimes
# requires Apple infrastructure). It asserts the prerequisites are in
# place:
#   - pkgbuild, productbuild, productsign, xcrun, plutil, shasum on PATH
#   - shim/build/fennec-hook-darwin-arm64 exists (built by plan 01-07)
#   - notifier/build/fennec-notifier-darwin-arm64 exists (built by plan 01-08)
#   - All shipped plists pass `plutil -lint`
#   - All shell scripts pass `bash -n` syntax check
#   - Distribution.xml + Configuration.plist + welcome.html + conclusion.html exist
#
# Exits non-zero on any failure. Intended for CI + pre-build verification.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_DIR="${PROJECT_ROOT}/installer/macos"

fail() { echo "FAIL: $*" >&2; exit 1; }

# -------------------------------------------------------------------------
# 1. Required tools on PATH
# -------------------------------------------------------------------------
echo "==> Checking required tools"
for tool in pkgbuild productbuild productsign xcrun plutil shasum bash openssl; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    fail "tool not on PATH: ${tool}"
  fi
done
echo "  OK: pkgbuild productbuild productsign xcrun plutil shasum bash openssl"

# -------------------------------------------------------------------------
# 2. Built binaries exist
# -------------------------------------------------------------------------
echo "==> Checking prebuilt Go binaries"
HOOK_BIN="${PROJECT_ROOT}/shim/build/fennec-hook-darwin-arm64"
NOTIFIER_BIN="${PROJECT_ROOT}/notifier/build/fennec-notifier-darwin-arm64"
[[ -f "${HOOK_BIN}" ]] || fail "missing shim binary: ${HOOK_BIN} (run \`make -C shim darwin-arm64\`)"
[[ -f "${NOTIFIER_BIN}" ]] || fail "missing notifier binary: ${NOTIFIER_BIN} (run \`make -C notifier darwin-arm64\`)"
echo "  OK: shim + notifier binaries present"

# -------------------------------------------------------------------------
# 3. Installer artefacts exist
# -------------------------------------------------------------------------
echo "==> Checking installer artefacts"
for f in \
  "${INSTALLER_DIR}/dev.fennec.daemon.plist" \
  "${INSTALLER_DIR}/dev.fennec.notifier.plist" \
  "${INSTALLER_DIR}/Configuration.plist" \
  "${INSTALLER_DIR}/Distribution.xml" \
  "${INSTALLER_DIR}/Resources/welcome.html" \
  "${INSTALLER_DIR}/Resources/conclusion.html" \
  "${INSTALLER_DIR}/preinstall.sh" \
  "${INSTALLER_DIR}/postinstall.sh" \
  "${INSTALLER_DIR}/build-pkg.sh" \
  "${INSTALLER_DIR}/sign-test-artefact.sh" \
; do
  [[ -f "${f}" ]] || fail "missing: ${f}"
done
echo "  OK: all installer artefacts present"

# -------------------------------------------------------------------------
# 4. Plist validation
# -------------------------------------------------------------------------
echo "==> Validating plists with plutil -lint"
for plist in \
  "${INSTALLER_DIR}/dev.fennec.daemon.plist" \
  "${INSTALLER_DIR}/dev.fennec.notifier.plist" \
  "${INSTALLER_DIR}/Configuration.plist" \
; do
  if ! plutil -lint "${plist}" >/dev/null 2>&1; then
    fail "plutil -lint failed: ${plist}"
  fi
done
echo "  OK: 3 plists validate"

# -------------------------------------------------------------------------
# 5. Shell script syntax
# -------------------------------------------------------------------------
echo "==> bash -n syntax check"
for sh in \
  "${INSTALLER_DIR}/preinstall.sh" \
  "${INSTALLER_DIR}/postinstall.sh" \
  "${INSTALLER_DIR}/build-pkg.sh" \
  "${INSTALLER_DIR}/build-pkg.test.sh" \
  "${INSTALLER_DIR}/sign-test-artefact.sh" \
; do
  if ! bash -n "${sh}"; then
    fail "bash -n failed: ${sh}"
  fi
done
echo "  OK: 5 shell scripts pass syntax check"

# -------------------------------------------------------------------------
# 6. Configuration.plist MDM primitive shape (org_install_secret placeholder)
# -------------------------------------------------------------------------
echo "==> Validating Configuration.plist MDM primitive"
if ! grep -q "org_install_secret" "${INSTALLER_DIR}/Configuration.plist"; then
  fail "Configuration.plist missing org_install_secret key"
fi
if ! grep -q "REPLACE_WITH_ORG_INSTALL_SECRET" "${INSTALLER_DIR}/Configuration.plist"; then
  fail "Configuration.plist missing REPLACE_WITH_ORG_INSTALL_SECRET placeholder"
fi
echo "  OK: MDM primitive shape correct"

# -------------------------------------------------------------------------
# Done
# -------------------------------------------------------------------------
echo
echo "✓ All build-pkg.sh smoke checks passed"
