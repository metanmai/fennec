# Phase 1 Code-Signing Procurement Status

**Plan:** 01-foundations / 01-03
**Updated:** 2026-05-31 (template; fill in as procurement completes)
**Status:** ⏳ AWAITING USER ACTION (Apple Developer Program enrolment + Windows EV cert procurement)

> ⚠ This file is the **single source of truth** for Phase 1's code-signing credentials. Plan 01-09 (signed installer pipeline) reads from here. Fill in every row marked `TODO` as procurement completes. Commit each row's update separately — these are audit-trail entries.

> 🚫 **NEVER commit the App Store Connect `.p8` file, the HSM PIN, the EV cert private key, or any plaintext signing credentials.** This document records only public identifiers (Team ID, cert thumbprints, key IDs, issuer UUIDs) — not secrets. The `.p8` lives at `~/.config/fennec-keys/` (outside the repo); the HSM PIN lives only in the developer's head.

---

## macOS — Apple Developer Program + Developer ID Installer cert

Follow [`installer/macos/CERT-PROCUREMENT.md`](../../../installer/macos/CERT-PROCUREMENT.md). Update this section as each step completes.

| Field                                | Value                       | Notes                                                                                          |
|--------------------------------------|-----------------------------|------------------------------------------------------------------------------------------------|
| Apple Developer Team ID              | `TODO`                      | 10-char alphanumeric. From https://developer.apple.com/account/ → Membership details           |
| Enrollment Type                      | `TODO`                      | Individual / Organisational                                                                    |
| Enrollment Date                      | `TODO`                      | ISO 8601 YYYY-MM-DD                                                                            |
| Apple Developer Cost                 | $99 USD/yr                  | Fixed by Apple                                                                                 |
| Renewal Date                         | `TODO`                      | Enrollment Date + 1 year                                                                       |
| Apple ID Used                        | `TODO`                      | The email of the Apple ID owning the Developer Program membership                              |
| 2FA Enabled                          | `TODO`                      | yes (required by Apple)                                                                        |
| Developer ID Installer Common Name   | `TODO`                      | Quoted CN string from `security find-identity -p basic -v` (e.g., `"Developer ID Installer: Your Name (TEAMID)"`) |
| Developer ID Installer Cert SHA-1    | `TODO`                      | 40-char hex thumbprint from same command                                                       |
| Developer ID Installer Cert Expiry   | `TODO`                      | ~5 years from issuance (check via `security find-certificate -c "Developer ID Installer" -p \| openssl x509 -enddate -noout`) |
| App Store Connect Key ID             | `TODO`                      | 10-char alphanumeric (also embedded in `.p8` filename)                                         |
| Issuer ID                            | `TODO`                      | UUID format `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`                                             |
| Keychain Profile Name                | `fennec-notary`             | Pinned by `.env.example` and `installer/macos/sign-test-artefact.sh`                           |
| `.p8` File Location                  | `TODO`                      | Should be `~/.config/fennec-keys/AuthKey_<KEYID>.p8` (mode 0400; OUTSIDE the repo)             |
| `xcrun notarytool history` exit code | `TODO`                      | Must be 0 (proves the profile authenticates)                                                   |
| Last Verified                        | `TODO`                      | ISO 8601 date when all of the above were last confirmed working                                |

### Verification commands (run these after filling the table)

```bash
security find-identity -p basic -v | grep "Developer ID Installer"
xcrun notarytool history --keychain-profile fennec-notary
ls -l ~/.config/fennec-keys/AuthKey_*.p8
```

All three must succeed (exit code 0; first command must print ≥1 line).

---

## Windows — EV code-signing certificate

Follow [`installer/windows/CERT-PROCUREMENT.md`](../../../installer/windows/CERT-PROCUREMENT.md). Update this section as procurement completes.

| Field                          | Value                                | Notes                                                                                                                              |
|--------------------------------|--------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Vendor                         | `TODO`                               | DigiCert / Sectigo / Certera / GlobalSign / SSL.com                                                                                |
| Cert Type                      | `TODO`                               | Individual EV / Business EV                                                                                                        |
| Validity Period                | `TODO`                               | 1 / 2 / 3 years                                                                                                                    |
| Delivery Mode                  | `TODO`                               | USB HSM (SafeNet eToken / YubiKey FIPS) OR Cloud Signing (DigiCert KeyLocker / SSL.com eSigner / Sectigo Cloud Signing)            |
| Purchase Date                  | `TODO`                               | ISO 8601 YYYY-MM-DD (when payment cleared)                                                                                         |
| Purchase Cost                  | `TODO`                               | USD (record actual; targets per vendor: ~$280–700 USD/yr per `01-RESEARCH.md`)                                                     |
| Verification Submitted Date    | `TODO`                               | When ID docs uploaded to vendor                                                                                                    |
| Verification Completed Date    | `TODO`                               | When vendor confirmed approval (typically email)                                                                                   |
| Vendor Receipt Date            | `TODO`                               | When HSM arrived OR cloud-signing credentials were activated — this is the procurement-complete milestone                          |
| HSM/Token Type                 | `TODO`                               | e.g., "SafeNet eToken 5110" / "YubiKey 5C FIPS" / "DigiCert KeyLocker (cloud)"                                                     |
| Driver Installed               | `TODO`                               | yes/no + version (e.g., "SafeNet Authentication Client 10.8")                                                                      |
| Cert Subject (CN)              | `TODO`                               | The Common Name as issued (Individual: legal name; Business: legal entity name)                                                    |
| Cert Subject (full DN)         | `TODO`                               | Full distinguished name including O, L, ST, C (optional but useful)                                                                |
| Cert Thumbprint (SHA-1)        | `TODO`                               | 40-char hex from `certutil -store -user My` or `smctl list certs`                                                                  |
| Cert Serial Number             | `TODO`                               | Vendor-assigned serial (for revocation reference)                                                                                  |
| Cert Issuer                    | `TODO`                               | e.g., "DigiCert EV Code Signing CA"                                                                                                |
| Cert Validity Start            | `TODO`                               | UTC datetime                                                                                                                       |
| Cert Validity End              | `TODO`                               | UTC datetime — renewal must happen before this                                                                                     |
| First Signature Timestamp      | `TODO`                               | **CRITICAL** — the UTC datetime from `signtool verify /pa /v` after the first sign. Starts the SmartScreen reputation-warm-up clock per D-05. |
| Test Artefact Path             | `installer/windows/test-artefact.exe`| (Plan 01-03 Task 2 creates this — a tiny Go hello-world or similar)                                                                |
| `signtool verify /pa /v` exit  | `TODO`                               | Must be 0 + output must contain "Successfully verified"                                                                            |
| `WINDOWS_EV_CERT_VENDOR` env   | `TODO`                               | Value mirrored to local `.env` (placeholder in `.env.example` line 71)                                                             |
| Last Verified                  | `TODO`                               | ISO 8601 date when signtool verify last succeeded                                                                                  |

### Verification commands (Windows)

```powershell
certutil -store -user My | findstr "$cert_subject_cn"     # cert is in the store
signtool verify /pa /v installer\windows\test-artefact.exe  # signature + timestamp valid
```

### Reputation clock (Phase 5 concern, tracked here for awareness)

Per `01-RESEARCH.md §Pitfall 4`, Microsoft changed SmartScreen policy in March 2024 — EV certs no longer give instant reputation. Reputation is earned via download count + lack of complaints. **Phase 1 acceptance does NOT require reputation to complete** — only that the cert is procured and a first signed artefact validates. Reputation completion is a Phase 5 success criterion that emerges naturally after `.msi` distribution begins.

---

## Cross-references for downstream plans

| What | Read by | How |
|------|---------|-----|
| `Apple Developer Team ID` | Plan 01-09 (signed installer pipeline) | Embedded in `Developer ID Installer: <Name> (<TEAM_ID>)` for `productsign --sign` |
| `Keychain Profile Name` = `fennec-notary` | Plan 01-09 + `installer/macos/sign-test-artefact.sh` | Used in `xcrun notarytool submit ... --keychain-profile fennec-notary --wait` |
| `Cert Thumbprint (SHA-1)` (Windows) | Plan 5 `.msi` build pipeline | Used in `signtool sign /sha1 <thumbprint>` for non-interactive CI signing |
| `First Signature Timestamp` (Windows) | Phase 5 SmartScreen reputation status review | Calendar reference for how long the cert has been earning reputation |
| `.p8` File Location | Developer machine ONLY (never embedded in code) | Used by `xcrun notarytool store-credentials` one-time setup; never read at sign time |

---

## Audit Trail

Append a row each time procurement state advances (purchase, ID-verification, HSM receipt, first signature, etc.):

| Date (UTC) | Event | Details |
|------------|-------|---------|
| 2026-05-31 | Status doc created | Plan 01-03 autonomous Task — playbooks + scripts authored. Awaiting user procurement. |
| 2026-05-31 | Local Go toolchain verified | Plan 01-07 Task 1 — `go version go1.25.7 darwin/arm64` at `/opt/homebrew/bin/.goenv/versions/1.25.7/bin/go` (goenv-managed; shim broken but binary works via absolute path). Shim Makefile + build commands use the absolute path explicitly. |
|            |       |         |

---

## Local Tooling

| Tool         | Version | Install method                                                                    | Date installed | Path                                                       |
|--------------|---------|-----------------------------------------------------------------------------------|----------------|------------------------------------------------------------|
| Go toolchain | 1.25.7  | goenv (`brew install goenv` → `goenv install 1.25.7`)                             | 2026-05-31     | `/opt/homebrew/bin/.goenv/versions/1.25.7/bin/go` (goenv shim on `which go` is broken on this host — use the absolute path) |

---

*Plan: 01-foundations / 01-03*
*Companion playbooks: [`installer/macos/CERT-PROCUREMENT.md`](../../../installer/macos/CERT-PROCUREMENT.md), [`installer/windows/CERT-PROCUREMENT.md`](../../../installer/windows/CERT-PROCUREMENT.md)*
*References: D-05 (EV cert clock starts at first signature); D-08 (MDM-deployable signed `.pkg`); 01-RESEARCH.md §Pitfall 4 (SmartScreen March 2024 policy change)*
