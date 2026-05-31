# macOS Code-Signing Certificate Procurement Playbook

**Phase:** 01 (Foundations) / Plan 01-03
**Owner:** developer enrolling the Apple Developer Program
**Cost:** USD $99/year (Apple Developer Program membership)
**Lead-time:** Immediate to 24 hours (most enrollments are processed in minutes; identity-flagged accounts can take up to a day)
**Companion docs:**
- `.planning/phases/01-foundations/01-CERT-STATUS.md` — live tracker (fill in IDs / dates / hashes after each step)
- `installer/macos/sign-test-artefact.sh` — the smoke signing + notarisation script Plan 01-09 will invoke
- `.env.example` line 67 — `APPLE_NOTARY_KEYCHAIN_PROFILE=fennec-notary`

This document is a **numbered checklist for a human developer**. Claude cannot enrol in the Apple Developer Program on your behalf — it requires a payment method, an Apple ID, and (for some enrollments) photo-ID verification. Follow these steps in order; tick each box in `01-CERT-STATUS.md` as you go.

---

## Overview

By the end of this checklist you will have:

1. An **active, paid** Apple Developer Program membership ($99/yr) tied to an Apple ID
2. A 10-character alphanumeric **Apple Developer Team ID** recorded in `01-CERT-STATUS.md`
3. A **Developer ID Installer** certificate (`.cer`) installed in the macOS login keychain
4. An **App Store Connect API key** (`.p8`) generated, downloaded once, stored OUTSIDE the repo
5. A **notarytool keychain profile** named `fennec-notary` that wraps the API key for non-interactive notarisation by `sign-test-artefact.sh` and (later) the full Plan 01-09 installer pipeline

Estimated total time: ~30 minutes of attended clicking + 0–24 hours of Apple-side processing.

---

## Step 1 — Apple Developer Program enrolment

1.1 Open https://developer.apple.com/programs/enroll/ in a browser. Sign in with the Apple ID you intend to use for fennec's signing identity. If you don't have one, create one at https://appleid.apple.com — **enable 2FA before proceeding** (Apple requires it for the Developer Program).

1.2 Choose **Individual** enrolment unless you have a registered business entity. Individual enrolment uses your legal name as the certificate's CN; organisational enrolment uses the legal entity name. Fennec is fine either way — pick whichever matches the legal owner of the signing key. **For an indie / solo build, Individual is the right choice.** [Assumption A6 in 01-RESEARCH.md: individual Developer Program suffices for `.pkg` notarisation.]

1.3 Complete the verification flow. Apple may ask for:
- A government-issued photo ID (uploaded via the iOS Developer app or via web)
- Confirmation via 2FA-enabled Apple ID
- D-U-N-S number (only for organisational enrolment — skip for individual)

1.4 Pay the $99 annual fee. Apple charges immediately.

1.5 Wait for the enrolment-complete email from Apple. **Most individuals are approved within 5–60 minutes**; some take up to 24 hours.

1.6 Record in `01-CERT-STATUS.md`:
- `Apple Developer Team ID`: the 10-character alphanumeric ID visible at https://developer.apple.com/account/ → "Membership details"
- `Enrollment Date`: today's date (ISO 8601 YYYY-MM-DD)

> Verification: `open https://developer.apple.com/account/` should show "Membership: Apple Developer Program — Active".

---

## Step 2 — Generate a Certificate Signing Request (CSR) on your Mac

The Developer ID Installer private key MUST be generated on the signing machine and never leave it. Apple's portal issues a `.cer` containing the public half; the private key stays in your login keychain.

2.1 Open **Keychain Access** (`/Applications/Utilities/Keychain Access.app`).

2.2 Menu bar: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority...**

2.3 In the dialog:
- **User Email Address:** the email on your Apple Developer account
- **Common Name:** your legal name (Individual enrolment) or your org's legal name (Organisational)
- **CA Email Address:** *leave blank*
- **Request is:** select **Saved to disk**
- Click **Continue** and save the resulting `CertificateSigningRequest.certSigningRequest` file (typically to `~/Desktop`)

2.4 Keychain Access has now generated an RSA 2048-bit key pair in your **login** keychain; the private key is non-exportable by default (see threat T-03-01).

> Pitfall (T-03-01): do NOT tick "make this key exportable" if Keychain Access ever offers the option. Apple's Developer ID private keys are non-exportable by default — keep it that way.

---

## Step 3 — Generate a Developer ID Installer certificate in the Apple portal

3.1 Visit https://developer.apple.com/account/resources/certificates/list (signed in).

3.2 Click **Certificates** in the sidebar → press the **+** (Create a Certificate) button.

3.3 Under **Software**, select **Developer ID Installer**. (Do NOT confuse this with "Developer ID Application" — that one signs binaries, not `.pkg` installers. For Plan 01-03 you only need Developer ID Installer; Plan 01-09 will revisit the Application variant if we end up signing nested executables inside the `.pkg`.)

3.4 On the next screen, upload the `CertificateSigningRequest.certSigningRequest` file from Step 2.3.

3.5 Apple immediately issues a `developerID_installer.cer` file. Download it.

3.6 Double-click the downloaded `.cer` file. Keychain Access opens and prompts to install. Choose the **login** keychain (default) and click **Add**. The certificate now appears under **Keychain Access → login → My Certificates** alongside the private key from Step 2.

3.7 Verify the certificate is installed and usable:

```bash
security find-identity -p basic -v | grep "Developer ID Installer"
```

Expected output: at least one line like:
```
1) 1A2B3C4D5E6F7890ABCDEF1234567890ABCDEF12 "Developer ID Installer: Your Name (TEAMID1234)"
```

The 40-character hex string at the start is the **SHA-1 thumbprint**. The string in quotes after it is the **certificate Common Name** you will pass to `productsign --sign` in `sign-test-artefact.sh`.

3.8 Record in `01-CERT-STATUS.md`:
- `Developer ID Installer Cert SHA-1`: the 40-char thumbprint
- `Developer ID Installer Common Name`: the full quoted CN string

---

## Step 4 — Generate an App Store Connect API key for notarytool

Notarytool requires Apple-side authentication. The modern path is an App Store Connect API key (`.p8`). The legacy app-specific-password path is deprecated — do not use it.

4.1 Visit https://appstoreconnect.apple.com → sign in with the same Apple ID.

4.2 Navigate to **Users and Access** → tab **Integrations** → sub-tab **Team Keys** (formerly "Keys"). Some accounts see this as **Users and Access** → **Keys** depending on the App Store Connect UI cohort.

4.3 Press **+** to generate a new key. In the dialog:
- **Name:** `fennec-notary` (any label; recommend matching the keychain profile)
- **Access:** **Developer** role is the minimum needed for notarytool submissions

4.4 Click **Generate**. App Store Connect displays the new key. **CRITICAL: click "Download API Key" immediately — Apple only lets you download the `.p8` once.** Save it as `AuthKey_<KEYID>.p8` where `<KEYID>` is the 10-character Key ID shown on this screen.

4.5 Move the `.p8` file OUTSIDE the repo to a safe permanent location. Recommended:

```bash
mkdir -p ~/.config/fennec-keys
chmod 700 ~/.config/fennec-keys
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.config/fennec-keys/
chmod 400 ~/.config/fennec-keys/AuthKey_XXXXXXXXXX.p8
```

(The `.gitignore` already excludes `*.p8`, but defence-in-depth: keep the file outside the repo tree entirely. See threat T-03-03.)

4.6 Note three values displayed in App Store Connect on the Keys page — you will need all three for Step 5:
- **Key ID** (10-char alphanumeric, also embedded in the `.p8` filename)
- **Issuer ID** (UUID format `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`, displayed above the keys table)
- The downloaded `.p8` file path

---

## Step 5 — Store credentials in the macOS keychain via notarytool

This is the one-time setup that lets `sign-test-artefact.sh` (and later the Plan 01-09 pipeline) authenticate to Apple's notary service without interactive prompts.

5.1 Run from a Terminal:

```bash
xcrun notarytool store-credentials "fennec-notary" \
  --key   ~/.config/fennec-keys/AuthKey_XXXXXXXXXX.p8 \
  --key-id   XXXXXXXXXX \
  --issuer   XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

Replace the three placeholders with the actual Key ID, Issuer ID, and `.p8` path from Step 4.6.

5.2 Notarytool will respond with `Credentials saved to Keychain` (or similar). The credentials are now stored under the **login** keychain as a generic password item named `com.apple.iTMSTransporter` (or `notarytool-fennec-notary` on newer macOS releases). The string `fennec-notary` is the **profile name** subsequent commands reference via `--keychain-profile fennec-notary`.

5.3 Verify the profile works:

```bash
xcrun notarytool history --keychain-profile fennec-notary
```

Expected exit code 0. Output is usually an empty list on first use — that's fine and proves auth succeeded.

5.4 Record in `01-CERT-STATUS.md`:
- `App Store Connect Key ID`: the 10-char Key ID
- `Issuer ID`: the UUID
- `Keychain Profile Name`: `fennec-notary` (already pinned)
- `.p8 location`: the path under `~/.config/fennec-keys/` (NOT under the repo)

---

## Step 6 — Acceptance gate

Before unblocking the rest of Plan 01-03 / Plan 01-09, verify ALL of:

```bash
# Cert installed
security find-identity -p basic -v | grep -q "Developer ID Installer" && echo "OK: Developer ID Installer cert present"

# Keychain profile usable
xcrun notarytool history --keychain-profile fennec-notary >/dev/null && echo "OK: fennec-notary keychain profile authenticates"

# .p8 lives outside the repo
test ! -e ~/.config/fennec-keys/AuthKey_*.p8 && echo "FAIL: .p8 missing — repeat Step 4" || echo "OK: .p8 stored outside repo"

# .planning tracker filled
grep -q "Apple Developer Team ID:" .planning/phases/01-foundations/01-CERT-STATUS.md
```

All four lines must print `OK:` (or the grep must succeed) before marking Task 1 of Plan 01-03 complete in PLAN.md / SUMMARY.md.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `security find-identity` returns 0 lines | `.cer` imported into System keychain instead of login | Move it: open Keychain Access, drag the cert from System → login |
| `xcrun notarytool history` returns `Error: Could not find credentials` | Profile name mismatch | Re-run Step 5 with `--keychain-profile fennec-notary` (case-sensitive) |
| Apple rejects the CSR with "RSA 2048 not allowed" | Apple has tightened to RSA-3072 minimum since some 2024 policy updates | Regenerate CSR from Keychain Access; in step 2.3 choose Key Size = 3072 bits, Algorithm = RSA |
| Enrolment stuck in "Pending" >24 hours | Apple identity-verification queue | Contact Apple Developer Support at https://developer.apple.com/contact/ |
| 2FA prompt loops on Apple ID sign-in | Browser cookies / device-trust issue | Use Safari (best Apple ID integration) instead of Chrome/Firefox |
| `notarytool store-credentials` says "API key invalid" | Wrong Issuer ID or Key ID | Double-check from App Store Connect → Users and Access → Integrations |
| `.p8` file accidentally committed to git | Repo contamination | Run `git rm --cached AuthKey_*.p8 && git commit -m "Remove leaked .p8"`. Then **rotate the key immediately** in App Store Connect (revoke + create new) — assume the leaked one is compromised |

---

## What this playbook does NOT cover

These are out of scope for Plan 01-03 and live in later plans:

- **Building / signing an actual `.pkg`** — `installer/macos/sign-test-artefact.sh` (created by Plan 01-03 Task 3) does a smoke signing of a tiny payload-free `.pkg`; the full installer build (with the fennec daemon + LaunchDaemon plist + postinstall script) is Plan 01-09.
- **Hardened Runtime entitlements** — fennec's daemon may need specific entitlements (network client at minimum); decided in Plan 01-09.
- **MDM Configuration Profile schema** — the `org_install_secret` payload spec is Plan 01-09's deliverable; this playbook only covers the prerequisites.
- **Renewal** — Apple Developer Program memberships auto-renew if a payment method is on file. Cert renewal is a separate flow (Developer ID certs are valid for 5 years).
- **Multi-user signing** — Plan 01-09 may discuss shared CI signing via a single team key; this playbook assumes a single developer-machine setup.

---

*Plan: 01-foundations / 01-03*
*Sources: developer.apple.com docs, scriptingosx.com notarytool guide, 01-RESEARCH.md §Code-Signing Tooling + §Pitfall 11 + §Environment Availability*
