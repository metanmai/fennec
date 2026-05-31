# Windows EV Code-Signing Certificate Procurement Playbook

**Phase:** 01 (Foundations) / Plan 01-03
**Owner:** developer (or business owner) procuring the EV certificate
**Cost:** USD ~$280 – $700 per year (vendor-dependent)
**Lead-time:** 2 – 7 business days (vendor identity verification + HSM/token shipping)
**Companion docs:**
- `.planning/phases/01-foundations/01-CERT-STATUS.md` — live tracker (fill in vendor / dates / thumbprint)
- `installer/windows/procure-cert.md` — 1-page summary cross-link
- `installer/windows/sign-test-artefact.ps1` — the smoke signtool wrapper
- `.env.example` line 71 — `WINDOWS_EV_CERT_VENDOR=<DigiCert|Sectigo|Certera>`

This document is a **numbered checklist for a human developer**. Claude cannot purchase an EV cert on your behalf — it requires a payment method, government-issued ID, and (for business-EV) corporate verification documents. Follow these steps in order; tick each box in `01-CERT-STATUS.md` as you go.

---

## Why we need this in Phase 1 (and what changed in March 2024)

Per CONTEXT.md decision **D-05**, fennec procures its Windows EV cert in Phase 1 even though the Windows daemon itself ships in Phase 5. The reasoning was historically: EV certs gave **instant Microsoft SmartScreen reputation**, so signing a stub artefact early let the reputation accumulate before the v1 launch.

**Microsoft changed SmartScreen policy in March 2024.** Per `01-RESEARCH.md §Pitfall 4`:
- EV certs **no longer bypass SmartScreen warnings instantly**.
- Reputation is now earned over time via downloads + lack of complaints — same as OV/standard certs.
- The reputation-warm-up clock still starts at first signature, but completion happens further downstream.

**Phase 1 acceptance criterion (recalibrated from ROADMAP success criterion #2):**
- EV cert procured AND
- First test artefact signed AND
- `signtool verify /pa /v` returns success
- Full SmartScreen reputation acceptance is a Phase 5 problem, not Phase 1.

By the end of this checklist you will have:
1. An **EV code-signing certificate** issued by a CA/B Forum member
2. A **hardware HSM/token** (or cloud-signing equivalent) in your possession
3. Driver software installed (e.g., SafeNet Authentication Client) on the signing machine
4. A signed test artefact (`installer/windows/test-artefact.exe`) that passes `signtool verify /pa /v`
5. The cert thumbprint, subject CN, vendor name, receipt date, and **first-signature timestamp** recorded in `01-CERT-STATUS.md`

Estimated time: ~30 minutes of attended work + 2–7 days waiting for vendor processing.

---

## Step 1 — Choose a vendor

You buy from a **CA/B Forum member** — these are the only CAs that can issue certs Microsoft trusts. Avoid marketplaces, brokers, or unknown resellers (threat T-03-05).

### Vendor comparison

| Vendor   | Approx. cost / 1 yr | Approx. cost / 3 yr | HSM/token             | ID-verification    | Delivery time | Notes |
|----------|---------------------|---------------------|------------------------|--------------------|---------------|-------|
| **DigiCert** | ~$500–700 USD | ~$1100–1500 USD | YubiKey FIPS or KeyLocker cloud signing | Strictest; phone call common | 1–3 business days (often fastest) | Premium pricing, fastest issuance, best support. Cloud-signing option (DigiCert KeyLocker) avoids HSM shipping entirely. **Recommended for fastest path.** |
| **Sectigo (formerly Comodo)** | ~$300–500 USD | ~$700–900 USD | SafeNet eToken (USB) | Standard; document upload | 3–5 business days | Mid-tier price + delivery; SafeNet driver is well-documented. Largest market share among indie devs. |
| **Certera** | ~$280–400 USD | ~$600–800 USD | SafeNet eToken (USB), or cloud | Standard | 3–7 business days | Cheapest; reseller of CA-tier roots. Slightly slower delivery on average but cost-effective. |
| GlobalSign | ~$500–700 USD | ~$1200–1500 USD | YubiKey or USB HSM | Strict (similar to DigiCert) | 3–5 business days | Solid alternative if DigiCert is unavailable in your region. |
| SSL.com | ~$200–400 USD | ~$500–700 USD | eSigner cloud signing or USB HSM | Standard | 3–7 business days | Cheap, has cloud-signing-as-a-service. Newer to EV market — verify support quality. |

**Recommendation (per CONTEXT.md / 01-RESEARCH.md):**
- **If delivery speed matters most:** **DigiCert** (1–3 days, includes KeyLocker cloud-signing — no shipping wait)
- **If cost matters most:** **Sectigo** (best price-to-delivery ratio for indie/solo builders)
- **If sub-$300 budget is hard:** **Certera** (cheapest CA/B Forum option)

> **Anti-recommendation:** Do NOT buy from `ssl-dragon.com`, `ssl2buy.com`, or any reseller marketplace **claiming to bypass CA pricing**. They typically resell legitimate certs from the above vendors at a markup; you save nothing and add a middleman who could leak your ID documents. Buy direct from the issuer when possible.

### Cloud signing vs USB HSM

Modern EV certs offer two delivery models:

| Model | Pros | Cons | Vendor examples |
|-------|------|------|-----------------|
| **USB HSM / eToken** (physical FIPS 140-2 Level 2+ device) | Fully offline; private key cannot leave device; battle-tested | Requires shipping; physical loss = expensive reissue; one machine at a time | Sectigo eToken, DigiCert YubiKey, Certera eToken |
| **Cloud signing** (vendor-hosted HSM, signing via API or remote-signing tool) | No shipping wait; multiple machines OK; CI-friendly | Vendor-side dependency; depends on vendor uptime; slightly higher cost | DigiCert KeyLocker, SSL.com eSigner, Sectigo Cloud Signing |

**Recommendation:** Cloud signing (DigiCert KeyLocker) if your budget allows — eliminates 2–5 days of shipping wait and is friendlier for the Plan 01-09 CI / signing pipeline. USB HSM if you prefer fully-offline.

### Decision

Record the choice in `01-CERT-STATUS.md` row `Vendor:` and update `.env.example` value `WINDOWS_EV_CERT_VENDOR=<chosen>`.

---

## Step 2 — Decide Individual vs Business EV

- **Individual EV** — uses your legal name as the cert subject. Faster verification (passport / driver's licence). Cheaper. Best for indie / solo builders.
- **Business EV** — uses your registered company name. Requires D-U-N-S or equivalent registry record + a callback to a verified phone number. Better trust signal for B2B-positioned products. Slower (typically +1–2 days).

For fennec at v1, **Individual EV** is acceptable if the legal owner of the signing key is a person. If fennec becomes an LLC/corporation later, transitioning to Business EV is a Phase 5 / 6 task.

Record the choice in `01-CERT-STATUS.md` row `Cert Type:` (Individual EV / Business EV).

---

## Step 3 — Begin procurement on the vendor's site

3.1 Visit the chosen vendor's EV code-signing page:
- DigiCert: https://www.digicert.com/signing/code-signing-certificates
- Sectigo: https://www.sectigo.com/ssl-certificates-tls/code-signing
- Certera: https://www.certera.com/code-signing-certificate
- GlobalSign: https://www.globalsign.com/en/code-signing-certificate
- SSL.com: https://www.ssl.com/certificates/ev-code-signing/

3.2 Select **EV (Extended Validation)** + the validity period (1 / 2 / 3 years). 3-year certs are the best value but lock you in.

3.3 Choose **USB HSM** or **Cloud signing** per Step 1.

3.4 Pay. Most vendors accept credit card; some accept ACH / wire for higher-tier orders.

3.5 Record in `01-CERT-STATUS.md`:
- `Vendor`: the chosen CA
- `Purchase Date`: today (ISO 8601 YYYY-MM-DD)
- `Cert Type`: Individual EV or Business EV
- `Validity Period`: 1 / 2 / 3 years
- `Delivery Mode`: USB HSM or Cloud Signing

---

## Step 4 — Identity verification

The vendor will email you a verification portal link within minutes of purchase. Expect:

**For Individual EV:**
- Upload of a government-issued photo ID (passport preferred; driver's licence acceptable)
- A live video call or selfie+ID check
- A signed declaration form
- Phone call from the vendor's verification team to confirm

**For Business EV (in addition to the above):**
- Articles of incorporation / business registration certificate
- D-U-N-S number (Dun & Bradstreet — register free at https://www.dnb.com)
- Confirmation of business phone number listed in a public directory
- Confirmation of registered business address

**Timeline:**
- DigiCert: same-day to 24 hours after docs received
- Sectigo: 1–3 days
- Certera: 2–5 days (longer if the verification queue is backed up)

> Threat T-03-04 (vendor mis-identification): EV CAs are highly motivated to verify correctly — the cert is essentially a notarised statement of identity. If a vendor asks for unusual information (e.g., bank details) — pause and contact their support to confirm the request is legitimate. **Never email an ID photo to an address that isn't on the vendor's domain.**

Record in `01-CERT-STATUS.md`:
- `Verification Submitted Date`: when you finished uploading docs
- `Verification Completed Date`: when the vendor confirms approval (typically by email)

---

## Step 5 — Receive the HSM/token (or cloud-signing credentials)

### Option A: Physical USB HSM / eToken

5.A.1 The vendor ships the device by courier (UPS/FedEx/DHL). Track via the shipping number they provide. Delivery is typically 1–4 days **after verification approval** in addition to the verification time.

5.A.2 On receipt, the device arrives with:
- A USB token (looks like a thick USB stick)
- A printed activation card with the **token initial PIN** (do NOT lose this card)
- A vendor sticker or sleeve with the cert serial / subject

5.A.3 Install the HSM driver:
- **Sectigo / Certera (SafeNet eToken):** download SafeNet Authentication Client (SAC) from https://supportportal.thalesgroup.com/csm — versions 10.8+ as of 2026 — install the **Windows** build (for signing on Windows) or the **macOS** build (if you'll sign from macOS via osslsigncode).
- **DigiCert YubiKey:** YubiKey ships with native Windows driver support; install YubiKey Manager from https://www.yubico.com/products/yubikey-manager/ for status visibility.

5.A.4 Plug the HSM into the signing machine. The driver should detect it and prompt for the initial PIN.

5.A.5 Set a **user PIN** (different from the initial PIN). The user PIN is what `signtool` will prompt for on every signature operation. **Make it ≥12 chars; never write it down in cleartext.** Lose it = expensive reissue (vendor must re-verify identity).

5.A.6 Confirm the cert is on the token:

```powershell
# On Windows:
certutil -store -user My
```

Expected output: a listing including the EV cert with subject CN matching your name (Individual EV) or company name (Business EV).

### Option B: Cloud signing (DigiCert KeyLocker, SSL.com eSigner, Sectigo Cloud Signing)

5.B.1 The vendor emails activation instructions including:
- A KeyLocker / eSigner account login
- An API token or signing client credentials
- A signing client utility (DigiCert KeyLocker Client, SSL.com CodeSignTool, etc.)

5.B.2 Install the signing client on the signing machine per vendor instructions.

5.B.3 Configure the credentials (typically a `~/.digicert/credentials.json` or environment variables `SM_CLIENT_CERT_FILE`, `SM_HOST`, `SM_API_KEY` for DigiCert KeyLocker).

5.B.4 Test connectivity:

```bash
# DigiCert KeyLocker Smarttool example:
smctl list certs
# Should list your EV cert with thumbprint
```

Record in `01-CERT-STATUS.md`:
- `Vendor Receipt Date`: when the device arrived OR when cloud credentials were activated
- `HSM/Token Type`: SafeNet eToken, YubiKey FIPS, KeyLocker cloud, etc.
- `Driver Installed`: yes/no + driver version
- `Cert Subject (CN)`: the full CN string (e.g., `"Jane Doe"` for Individual EV)
- `Cert Thumbprint (SHA-1)`: the 40-char hex thumbprint from `certutil` or `smctl`

---

## Step 6 — Sign the first test artefact (starts the SmartScreen reputation clock)

6.1 Build a tiny test executable. From the signing machine (Windows preferred; macOS with osslsigncode as fallback per `01-RESEARCH.md §Environment Availability`):

```bash
# Option A: Use a pre-built Go hello-world (any small .exe works)
# From any Mac / Linux / Windows machine with Go installed:
mkdir -p installer/windows
cat > /tmp/hello.go <<'EOF'
package main
import "fmt"
func main() { fmt.Println("fennec EV smoke test") }
EOF
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o installer/windows/test-artefact.exe /tmp/hello.go
```

If you don't have Go on the signing machine, any small `.exe` will do — even a minimal PowerShell-compiled C# stub. The point is to have ANY signed Windows binary to verify the pipeline.

6.2 Sign the artefact. If you have `installer/windows/sign-test-artefact.ps1` (created by Plan 01-03):

```powershell
.\installer\windows\sign-test-artefact.ps1 -ArtefactPath .\installer\windows\test-artefact.exe -CertSubject "CN=Your Name"
```

Otherwise, invoke signtool directly:

```powershell
signtool sign `
  /n   "Your Name" `
  /td  sha256 `
  /fd  sha256 `
  /tr  http://timestamp.digicert.com `
  /v   `
  installer\windows\test-artefact.exe
```

Flag explanations:
- `/n "Your Name"` — pick by Common Name; signtool finds the EV cert by CN match in the user certificate store
- `/td sha256` — timestamp digest algorithm = SHA-256 (mandatory; SHA-1 is rejected by modern Windows)
- `/fd sha256` — file digest algorithm = SHA-256
- `/tr http://timestamp.digicert.com` — RFC 3161 timestamping server URL (the timestamp is critical — it makes the signature valid AFTER the cert expires). Other valid timestamp URLs: http://timestamp.sectigo.com, http://timestamp.entrust.net/TSS/RFC3161sha2TS
- `/v` — verbose output

You will be prompted for the HSM user PIN. Enter it.

6.3 Verify the signature:

```powershell
signtool verify /pa /v installer\windows\test-artefact.exe
```

Expected output:
```
Verifying: installer\windows\test-artefact.exe
File is signed and the signature was verified.
Hash of file: ...
Signing Certificate Chain:
    Issued to: <Your Name | Your Org>
    Issued by: <Vendor CA, e.g., DigiCert EV Code Signing CA>
    ...
The signature is timestamped: <ISO 8601 UTC>
Timestamp Verified by:
    Issued to: <Timestamp authority>
    ...
Successfully verified: installer\windows\test-artefact.exe
```

The presence of `Successfully verified` + a timestamp line is the gate for Plan 01-03 Task 2 acceptance.

6.4 **CRITICAL — record the first-signature timestamp.** This is the moment the SmartScreen reputation-warm-up clock starts per D-05. Capture from the `signtool verify` output:

```powershell
# Extract just the timestamp line for documentation:
signtool verify /pa /v installer\windows\test-artefact.exe 2>&1 | findstr "timestamped"
```

Record in `01-CERT-STATUS.md`:
- `First Signature Timestamp`: the UTC timestamp from the signtool verify output (ISO 8601 if possible)

---

## Step 7 — Acceptance gate

Before unblocking the rest of Plan 01-03 / Plan 05 / Plan 09, verify ALL of:

```powershell
# Cert in user store
certutil -store -user My | findstr "Subject:"
# → must include the EV cert's CN

# Test artefact signed
test -f installer/windows/test-artefact.exe  # (from any shell)

# Signature valid
signtool verify /pa /v installer\windows\test-artefact.exe | findstr "Successfully verified"

# Status doc filled
grep -q "Cert Thumbprint" .planning/phases/01-foundations/01-CERT-STATUS.md
grep -q "First Signature Timestamp" .planning/phases/01-foundations/01-CERT-STATUS.md
```

All four lines must succeed before marking Task 2 of Plan 01-03 complete in PLAN.md / SUMMARY.md.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `signtool sign` says "No certificates were found" | Cert not in user store, or wrong store; cert in System store instead of My | `certutil -store -user My` to confirm; if missing, re-import via vendor's installer tool |
| `signtool sign` hangs or asks for PIN repeatedly | SafeNet client not initialised; HSM not detected | Re-plug HSM; restart SafeNet client; check `SafeNet Authentication Client Tools` GUI |
| `Timestamp server failed` | Network firewall blocking RFC 3161 traffic; HTTP timestamp URL blocked | Try alternative URL (Sectigo, Entrust); confirm corporate proxy allows port 80 outbound to the timestamp domain |
| `signtool verify` says "A certificate chain processed but ended in a root certificate which is not trusted" | Cert root not in your trust store (rare — should be a built-in CA root) | Update Windows root certificates: `certutil -generateSSTFromWU roots.sst && certutil -enterprise -f -v -AddStore root roots.sst` |
| Cert subject CN mismatch from what you expected | Vendor issued cert with slightly different name capitalisation than ordered | Document the actual CN in `01-CERT-STATUS.md` as-issued; cert is fine even if cosmetically different |
| HSM is lost/stolen | Hardware theft | **Contact the vendor IMMEDIATELY for revocation.** Revoked certs cannot sign new artefacts but existing signatures with valid timestamps remain valid. Order replacement (vendor charges a re-issuance fee; cost varies $50–$200). |
| Cloud signing API returns 401 / 403 | Credentials expired or rotated | Re-authenticate via vendor's web console; generate new API token if needed |
| `Verification queue` taking >2 weeks | Vendor backlog or document rejection (unflagged) | Contact vendor support directly; ask for ticket escalation. Some vendors offer expedited verification for an extra $50–$100 |

---

## What this playbook does NOT cover

- **Building the actual `.msi`** — Plan 01-03 only proves the signing pipeline works on a test `.exe`. The Plan 5 Windows daemon will be packaged as `.msi` later.
- **Smart Application Control (SAC) reputation** — Windows 11's Smart App Control is even stricter than SmartScreen; not a Phase 1 concern.
- **Renewal** — EV cert renewal is a near-identical process to initial issuance (identity may be re-verified). Plan for renewal ~30 days before expiry.
- **Multi-cert scenarios** — Some teams maintain separate "release" and "test" EV certs. Out of scope for Phase 1 (we use one cert for everything until Phase 5 distinguishes).
- **CI integration** — Plan 01-09 owns the CI signing flow. This playbook only covers manual / local signing for the first-signature test.

---

*Plan: 01-foundations / 01-03*
*Sources: 01-RESEARCH.md §Code-Signing Tooling §Windows EV cert, §Pitfall 4 (SmartScreen March 2024), §Environment Availability, vendor docs (DigiCert / Sectigo / Certera), Microsoft signtool reference*
