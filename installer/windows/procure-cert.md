# Windows EV Cert Procurement — 1-Page Summary

> **For the full numbered playbook see [`CERT-PROCUREMENT.md`](./CERT-PROCUREMENT.md) in this directory.**

## TL;DR

| What | Value |
|------|-------|
| What | EV (Extended Validation) Windows code-signing certificate |
| Why | Required for SmartScreen-eligible `.msi` signing; clock starts at first signature per D-05 |
| Cost | ~$280–700 USD/yr (vendor-dependent) |
| Time | 2–7 business days (vendor ID-verification + HSM/token shipping) |
| Phase 1 acceptance | Cert procured + first test artefact signed + `signtool verify /pa /v` returns "Successfully verified" |
| Phase 1 does NOT need | Full SmartScreen reputation (Phase 5; Microsoft changed policy March 2024) |

## Recommended vendors (CA/B Forum members only — avoid resellers)

| Vendor | ~Cost/yr | Lead-time | When to choose |
|--------|---------|-----------|----------------|
| **DigiCert** | $500–700 | 1–3 days | Fastest delivery; cloud-signing (KeyLocker) avoids HSM shipping |
| **Sectigo** | $300–500 | 3–5 days | Best price-to-delivery; widest indie adoption |
| **Certera** | $280–400 | 3–7 days | Cheapest CA/B Forum option |
| GlobalSign | $500–700 | 3–5 days | DigiCert alternative for your region |
| SSL.com | $200–400 | 3–7 days | Has cloud-signing-as-a-service (eSigner) |

## 7-step compressed flow

1. Choose vendor + delivery mode (USB HSM vs cloud signing) → record in `01-CERT-STATUS.md`
2. Choose Individual EV or Business EV → record
3. Buy on the vendor site → record purchase date
4. Submit ID-verification docs (passport + selfie for Individual; + D-U-N-S for Business)
5. Receive HSM/token (USB) OR activate cloud-signing credentials → install driver (e.g., SafeNet Authentication Client)
6. Sign a tiny test `.exe` with `signtool sign /td sha256 /fd sha256 /tr <timestamp-url>` → use `installer/windows/sign-test-artefact.ps1`
7. Verify with `signtool verify /pa /v installer/windows/test-artefact.exe` → record cert subject + thumbprint + first-signature timestamp in `01-CERT-STATUS.md`

## What's recorded where

| Field | Lives in |
|-------|----------|
| Vendor choice | `.planning/phases/01-foundations/01-CERT-STATUS.md` |
| `WINDOWS_EV_CERT_VENDOR` | `.env.example` line 71 (placeholder) → developer's local `.env` (concrete) |
| Cert thumbprint + subject CN | `01-CERT-STATUS.md` Windows section |
| First-signature timestamp | `01-CERT-STATUS.md` (this starts the SmartScreen warm-up clock per D-05) |
| Signing test script | `installer/windows/sign-test-artefact.ps1` |
| Signed test artefact | `installer/windows/test-artefact.exe` (committed only as a placeholder; the real `.msi` ships from Plan 5) |

## Anti-patterns (do NOT do)

- Buy EV certs from marketplaces (`ssl2buy.com`, `ssl-dragon.com`, etc.) — they're resellers, not CAs; you save nothing and add a middleman
- Use `signtool sign /n <name>` without `/td sha256 /fd sha256` — SHA-1 signatures are rejected by modern Windows
- Forget `/tr` (timestamp URL) — un-timestamped signatures become invalid the moment the cert expires
- Sign once, never verify — always run `signtool verify /pa /v <file>` to confirm the chain validates

---

*Companion: [`CERT-PROCUREMENT.md`](./CERT-PROCUREMENT.md) (full playbook), [`sign-test-artefact.ps1`](./sign-test-artefact.ps1) (the signtool wrapper Plan 9 will invoke)*
*Plan: 01-foundations / 01-03*
