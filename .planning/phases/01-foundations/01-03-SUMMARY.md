---
phase: 01-foundations
plan: 03
subsystem: installer

tags:
  - apple-developer-program
  - developer-id-installer
  - notarytool
  - keychain-profile
  - ev-code-signing
  - smartscreen
  - signtool
  - hsm
  - procurement-checkpoint
  - partial-completion

# Dependency graph
requires:
  - 01-01 (monorepo + installer/macos + installer/windows scaffolds)
provides:
  - "installer/macos/CERT-PROCUREMENT.md — 7-step Apple Developer Program enrolment + Developer ID Installer cert + App Store Connect API key + notarytool keychain profile playbook"
  - "installer/windows/CERT-PROCUREMENT.md — Windows EV cert procurement playbook (vendor comparison + ID-verification + HSM/cloud-signing + first signature)"
  - "installer/windows/procure-cert.md — 1-page summary cross-link"
  - "installer/windows/sign-test-artefact.ps1 — PowerShell signtool wrapper: /td sha256 /fd sha256 /tr <timestamp-url>, auto-locates signtool.exe in Windows SDK, verifies with signtool verify /pa /v"
  - "installer/macos/sign-test-artefact.sh — bash productsign + notarytool submit --wait + stapler staple + spctl --assess pipeline (executable, fail-on-error)"
  - ".planning/phases/01-foundations/01-CERT-STATUS.md — live tracking template for Team ID, cert thumbprints, keychain profile, vendor, first-signature timestamp"
  - ".env.example documentation pointer to installer/macos/CERT-PROCUREMENT.md above APPLE_NOTARY_KEYCHAIN_PROFILE"
affects:
  - 01-09 (signed installer pipeline — will invoke sign-test-artefact.sh against the real fennec .pkg; reads Team ID + keychain profile from 01-CERT-STATUS.md)
  - Phase 5 (cross-platform polish — will exercise installer/windows/sign-test-artefact.ps1 against the real fennec.msi)
  - Operational: starts the Win EV cert reputation-warm-up clock (per D-05) once the user completes Task 2 procurement + first signature

# Tech tracking
tech-stack:
  added:
    - "Apple Developer Program enrolment WORKFLOW (procurement-only; not a software dependency)"
    - "Windows EV code-signing cert procurement WORKFLOW (DigiCert / Sectigo / Certera; not a software dependency)"
    - "signtool.exe (Windows SDK) — recommended; alternative cross-platform: osslsigncode"
    - "xcrun notarytool — already bundled with Xcode Command Line Tools on macOS"
  patterns:
    - "Playbook + Status separation: CERT-PROCUREMENT.md (the recipe) vs 01-CERT-STATUS.md (the live tracker filled in as procurement progresses). Plan 01-09 reads from STATUS, not the playbooks."
    - "Smoke signing script is environment-agnostic: macOS script accepts identity as arg + reads keychain profile from env; PowerShell script reads cert subject from arg-or-env; neither hardcodes user-specific values."
    - "Pipeline correctness gates baked into the smoke scripts: spctl assertion for 'source=Notarized Developer ID' (macOS); signtool verify /pa /v (Windows). Both fail loudly if the chain is broken."
    - "Pitfall 4 honoured (SmartScreen March 2024 policy change): Phase 1 acceptance is procurement-complete + first signature, not full SmartScreen reputation."
    - "Pitfall 11 honoured (notarytool --wait): the macOS smoke script hardcodes --wait so notarisation completes synchronously before stapling."

key-files:
  created:
    - installer/macos/CERT-PROCUREMENT.md
    - installer/windows/CERT-PROCUREMENT.md
    - installer/windows/procure-cert.md
    - installer/windows/sign-test-artefact.ps1
    - installer/macos/sign-test-artefact.sh
    - .planning/phases/01-foundations/01-CERT-STATUS.md
  modified:
    - .env.example

key-decisions:
  - "Tasks 1 + 2 are checkpoint:human-action with no autonomous shortcut — Apple Developer Program enrolment ($99/yr, photo-ID verification) and Windows EV cert purchase ($280-700/yr, document upload + HSM shipping 2-7 days) are by design human-only external procurements. Claude authored the playbooks that the user follows; the procurement itself is HALTED awaiting user action."
  - "Phase 1 Windows acceptance criterion recalibrated per Pitfall 4 (Microsoft SmartScreen policy March 2024). Phase 1 succeeds at: EV cert procured + first signature applied + signtool verify /pa /v returns 'Successfully verified'. Full SmartScreen reputation is a Phase 5 downstream concern, not a Phase 1 gate."
  - "Vendor recommendation matrix in installer/windows/CERT-PROCUREMENT.md ranks DigiCert (fastest, includes KeyLocker cloud signing — eliminates HSM shipping), Sectigo (best price-to-delivery), Certera (cheapest CA/B Forum option). User picks; cost + delivery-speed tradeoff is documented."
  - "Individual EV vs Business EV decision left to user. For a v1 solo build, Individual EV is appropriate; the playbook documents both paths."
  - "App Store Connect .p8 lives at ~/.config/fennec-keys/ (OUTSIDE the repo) per threat T-03-03; the macOS playbook explicitly chmod-400s the file and warns against committing it. .gitignore already excludes *.p8."

patterns-established:
  - "Split-responsibility pattern for procurement plans: Claude ships the playbooks + smoke scripts + tracking template autonomously, then HALTS with a structured checkpoint for the real-world purchase + ID-verification that only the user can complete. SUMMARY documents partial-completion honestly."
  - "macOS smoke script invokes pipeline against a payload-free .pkg (pkgbuild --nopayload) so it can exercise the full productsign + notarytool + stapler + spctl chain without needing a real binary payload until Plan 01-09 lands."
  - "Audit-trail row in 01-CERT-STATUS.md for every procurement state transition (purchase, ID submission, HSM receipt, first signature). Allows reconstruction of the procurement timeline for compliance / cost-attribution."

requirements-completed: []
requirements-partial:
  - "DAE-09: cert PROCUREMENT artefacts ready (playbooks + smoke scripts + status template). Cert itself not yet procured — awaiting user action on Tasks 1 + 2."

# Metrics
duration: ~7 min (autonomous portion only — playbooks + smoke scripts + status template; the multi-day human-procurement clock is independent and external)
completed: 2026-05-31 (autonomous portion)
completed-fully: PENDING — gated on user completing Apple Developer Program enrolment + Windows EV cert procurement
---

# Phase 1 Plan 03: Code-signing procurement — partial completion (autonomous deliverables shipped; procurement gated on user action)

**Plan 01-03 ships its three autonomous artefacts** (Apple Developer playbook, Windows EV cert playbook + signtool wrapper, macOS smoke notarisation script) **and HALTS for user action.** Tasks 1 and 2 are `checkpoint:human-action` by design — they gate on real-world external procurements (Apple Developer Program $99/yr enrolment + ID verification; Windows EV cert $280-700/yr + ID verification + 2-7 day HSM shipping or cloud-signing setup) that cannot be automated.

> **Status:** **AUTONOMOUS PORTION COMPLETE. PROCUREMENT AWAITING USER ACTION.** The plan transitions to fully complete once the user finishes both external procurements and fills the `TODO` rows in `01-CERT-STATUS.md`.

## Performance

- **Duration (autonomous portion):** ~7 min
- **Started:** 2026-05-31T06:07:00Z
- **Autonomous portion completed:** 2026-05-31T06:14:25Z
- **Tasks completed autonomously:** 1 of 3 (Task 3 = auto). Tasks 1 + 2 ship their *autonomous deliverables* (the playbooks the user follows) but their **acceptance gates remain blocked** on external action.
- **Commits:** 2 task commits (+ a metadata commit to follow this SUMMARY)
- **Wall-clock to fully complete:** unknowable — depends on user procurement speed. Estimate: same day for Apple Dev Program; 2-7 days for Win EV cert.

## Accomplishments (autonomous portion)

- **`installer/macos/CERT-PROCUREMENT.md`** — 7-step Apple Developer Program enrolment playbook the user follows: enrolment URL + cost + ID verification, CSR generation from Keychain Access (with the non-exportability warning for T-03-01), portal cert issuance, `.cer` import into login keychain, App Store Connect API key generation (with the "Apple only lets you download .p8 ONCE" warning per T-03-03), notarytool `store-credentials` setup, and a final acceptance-gate verification block.
- **`installer/windows/CERT-PROCUREMENT.md`** — Windows EV cert procurement playbook with:
  - Vendor comparison table (DigiCert $500-700 / 1-3d / KeyLocker cloud, Sectigo $300-500 / 3-5d, Certera $280-400 / 3-7d, GlobalSign + SSL.com)
  - USB HSM vs cloud-signing decision matrix
  - Individual EV vs Business EV decision matrix
  - ID-verification process (passport + selfie + signed declaration; +D-U-N-S for Business)
  - HSM/token receipt + SafeNet Authentication Client driver install
  - First signature procedure with `signtool sign /td sha256 /fd sha256 /tr <timestamp-url>`
  - `signtool verify /pa /v` verification + first-signature-timestamp capture for the SmartScreen reputation-warm-up clock
  - Pitfall 4 acceptance recalibration (Phase 1 = cert + first signature; full reputation is Phase 5)
- **`installer/windows/procure-cert.md`** — 1-page TL;DR summary that cross-links to the full playbook. Matches the file path referenced in 01-RESEARCH.md §Recommended Project Structure.
- **`installer/windows/sign-test-artefact.ps1`** — PowerShell signtool wrapper:
  - Parameters: `-ArtefactPath` (default `installer\windows\test-artefact.exe`), `-CertSubject` (or `FENNEC_EV_CERT_SUBJECT` env var), `-TimestampUrl` (default `http://timestamp.digicert.com`), `-SignToolPath` (auto-locates the Windows SDK signtool.exe if not specified)
  - Hardcodes `/td sha256 /fd sha256 /tr` flags per Pitfall 4 / Plan acceptance criteria
  - Verifies with `signtool verify /pa /v` after signing; exits non-zero if verify fails
  - Embedded troubleshooting hints for common failures (cert not in store, PIN issues, timestamp server unreachable, missing root chain)
  - Reminds the user to capture the first-signature timestamp into 01-CERT-STATUS.md
- **`installer/macos/sign-test-artefact.sh`** (executable, 0755):
  - `#!/usr/bin/env bash` + `set -euo pipefail` per acceptance criteria
  - Accepts `$1 = unsigned .pkg path` + `$2 = "Developer ID Installer: Name (TEAMID)" common-name`
  - Reads `APPLE_NOTARY_KEYCHAIN_PROFILE` from env (default `fennec-notary`)
  - Auto-creates a payload-free smoke `.pkg` via `pkgbuild --identifier dev.fennec.test --version 0.0.1 --nopayload` if `$1` doesn't exist
  - Pipeline: `productsign --timestamp --sign` → `xcrun notarytool submit --wait` (Pitfall 11) → `xcrun stapler staple` → `spctl --assess --type install -vvv`
  - Asserts `source=Notarized Developer ID` in the spctl output (exits 1 if missing)
  - Prints SHA-256 of the signed+notarised+stapled `.pkg` for downstream traceability
- **`.planning/phases/01-foundations/01-CERT-STATUS.md`** — live tracking template:
  - macOS section: Team ID, enrolment type/date/renewal, Apple ID, 2FA, Developer ID Installer CN + SHA-1 + expiry, App Store Connect Key ID + Issuer ID, keychain profile name, `.p8` location, `notarytool history` exit, last-verified
  - Windows section: vendor, cert type, validity period, delivery mode, purchase/verification dates, vendor receipt date, HSM/token type, driver, cert subject CN + full DN + thumbprint + serial + issuer + validity start/end, first signature timestamp (Phase 1 clock-start per D-05), test artefact path, signtool verify exit, env var mirror
  - Cross-reference table to downstream plans
  - Audit trail with one row already populated (today's playbook creation)
- **`.env.example`** — comment line added above `APPLE_NOTARY_KEYCHAIN_PROFILE` pointing to `installer/macos/CERT-PROCUREMENT.md` per Task 3's acceptance criteria. Variable itself was already pinned to `fennec-notary` in Plan 01-01.

## Task Commits

| # | Phase  | Hash      | Subject                                                                                            |
| - | ------ | --------- | -------------------------------------------------------------------------------------------------- |
| 1 | Tasks 1+2 autonomous deliverables | `02ebe69` | docs(01-03): add Apple Developer + Windows EV cert procurement playbooks + signtool wrapper |
| 2 | Task 3 | `b5e7cef` | feat(01-03): add macOS smoke signing script + notarytool keychain profile reference                |

Plan-metadata commit follows this SUMMARY.

> **Why two commits, not three?** Tasks 1 and 2 are `checkpoint:human-action`. Their autonomous deliverables (the playbooks Claude writes for the user to follow + the signtool wrapper + the status template) were grouped into a single `docs(01-03)` commit because they're cohesive — both procurement workflows share the same `01-CERT-STATUS.md` tracker and the `installer/{macos,windows}/CERT-PROCUREMENT.md` pair functions as one connected procurement runbook. Task 3 (the macOS smoke signing script) is a separate `feat(01-03)` commit because it ships executable functionality, not documentation.

## Files Created / Modified

### `installer/macos/`

- `CERT-PROCUREMENT.md` (new) — 7-step Apple Developer Program enrolment + cert + notarytool playbook
- `sign-test-artefact.sh` (new, 0755) — productsign + notarytool + stapler + spctl smoke pipeline

### `installer/windows/`

- `CERT-PROCUREMENT.md` (new) — Windows EV cert procurement playbook with vendor comparison
- `procure-cert.md` (new) — 1-page summary cross-link
- `sign-test-artefact.ps1` (new) — PowerShell signtool sign + verify wrapper

### `.planning/phases/01-foundations/`

- `01-CERT-STATUS.md` (new) — live procurement tracker (macOS + Windows sections; all TODO until user completes external action)

### Root

- `.env.example` (modified) — comment line above `APPLE_NOTARY_KEYCHAIN_PROFILE` pointing to the macOS procurement playbook

## Decisions Made

(Mirrored in the frontmatter `key-decisions` block for STATE.md ingestion.)

1. **Plan 01-03 has both autonomous + human-action work; the autonomous portion ships fully and the SUMMARY honestly tracks both states.** Tasks 1 and 2 are `checkpoint:human-action` by design — Apple Developer Program enrolment and Windows EV cert procurement are real-world external transactions (payment, photo-ID verification, HSM shipping) that cannot be automated. Claude ships the *playbooks* (the recipes the user follows) + the *smoke scripts* (the signing pipelines that will exercise the procured credentials) + the *status tracker* (where the user records the procurement outcomes). The procurement itself remains the user's external responsibility — this SUMMARY reflects that honestly rather than pretending the plan is complete.

2. **Phase 1 Windows acceptance recalibrated per Pitfall 4.** Microsoft changed SmartScreen policy in March 2024 — EV certs no longer give instant reputation. Phase 1 succeeds at "EV cert procured + first signature applied + `signtool verify /pa /v` returns 'Successfully verified'". Full SmartScreen reputation is a Phase 5 emergent outcome (after `.msi` distribution accumulates downloads), not a Phase 1 gate. Both `installer/windows/CERT-PROCUREMENT.md` and `01-CERT-STATUS.md` document this recalibration prominently.

3. **Vendor recommendation matrix.** Three CA/B Forum members ranked for Phase 1's "we need this cert procured fast and at reasonable cost" objective: DigiCert (fastest + KeyLocker cloud-signing avoids HSM shipping), Sectigo (best $/day delivery ratio for indie devs), Certera (cheapest CA/B Forum option). User picks based on budget + delivery preference. Explicit anti-recommendation: do NOT buy from marketplaces (`ssl2buy.com`, `ssl-dragon.com`) — those are resellers; you save nothing and add an ID-handling middleman.

4. **Cloud signing (DigiCert KeyLocker / SSL.com eSigner / Sectigo Cloud Signing) noted as preferred over USB HSM where budget permits.** Eliminates shipping wait, friendlier for Plan 01-09 CI/signing pipeline, and avoids the "physical token lost = re-issuance" failure mode. USB HSM remains supported for users who want fully-offline signing.

5. **App Store Connect `.p8` lives at `~/.config/fennec-keys/AuthKey_<KEYID>.p8`** (chmod 400, OUTSIDE the repo). This satisfies threat T-03-03 (information disclosure via leaked `.p8`) and `.gitignore` already excludes `*.p8`. Documented prominently in both `installer/macos/CERT-PROCUREMENT.md` Step 4.5 and `01-CERT-STATUS.md`.

6. **Pitfall 11 (notarytool needs --wait) hardcoded in the macOS smoke script.** The `--wait` flag is non-removable; tests verify `grep -q '\-\-wait'`. This guards against the common CI bug pattern where notarytool returns a submission ID and the caller proceeds to staple before notarisation actually completes (= silent breakage at distribution time).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — auto-add] Phase 1 docs lacked an executable PowerShell signtool wrapper despite the plan listing it as a file_modified**

- **Found during:** Reading the plan's Task 2 `<what-built>` and `<acceptance_criteria>` sections.
- **Issue:** The plan's `<files_modified>` listed `installer/windows/sign-test-artefact.ps1` but Task 2 is a `checkpoint:human-action`. Without a script to actually invoke, the user would have no concrete signtool flag set to follow.
- **Fix:** Authored `installer/windows/sign-test-artefact.ps1` as part of Task 2's autonomous deliverable (it's listed in Task 2's `<files>` block and the plan's `<files_modified>` list — fully in-scope per the plan).
- **Files modified:** `installer/windows/sign-test-artefact.ps1` (new)
- **Verification:** The acceptance criteria for Task 2 are satisfied by the file's existence + contents (`/td sha256 /fd sha256 /tr <timestamp-url>` + `signtool verify /pa /v`).
- **Committed in:** `02ebe69`
- **Why this isn't actually a deviation:** The plan explicitly says "Claude will also write `installer/windows/sign-test-artefact.ps1`" in the Task 2 `<what-built>` block. We just shipped what was specified.

**2. [Documentation] Audit trail row pre-populated in 01-CERT-STATUS.md**

- **Found during:** Authoring 01-CERT-STATUS.md.
- **Issue:** The status doc has an "Audit Trail" table at the bottom for tracking procurement state transitions. An empty table with no example entries would have been awkward for the user to extend.
- **Fix:** Pre-populated the first row with today's date + "Status doc created" + summary of Plan 01-03 autonomous deliverables. Provides a template entry for the user to extend as procurement progresses.
- **Files modified:** `.planning/phases/01-foundations/01-CERT-STATUS.md`
- **Verification:** Cosmetic only; doesn't affect any acceptance gate.
- **Committed in:** `02ebe69`

---

**Total deviations:** 2, both within explicit plan scope (no architectural changes, no scope creep).

## Known Stubs

| File                                                                | Why it's a stub                                                                                                                                              | Resolved by                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `.planning/phases/01-foundations/01-CERT-STATUS.md` (macOS section) | All rows marked `TODO` until user completes Apple Developer Program enrolment + cert issuance + `notarytool store-credentials` per `installer/macos/CERT-PROCUREMENT.md` | User action on Task 1 (estimated: same-day to 24 hours)                    |
| `.planning/phases/01-foundations/01-CERT-STATUS.md` (Windows section) | All rows marked `TODO` until user completes EV cert purchase + ID verification + HSM/cloud-signing receipt + first signature per `installer/windows/CERT-PROCUREMENT.md` | User action on Task 2 (estimated: 2-7 business days for vendor processing) |
| `installer/windows/test-artefact.exe`                               | Does not exist yet — created by the user in Task 2 Step 5 (a tiny `go build -ldflags="-s -w" -o ...` hello-world or any small `.exe`)                            | User action on Task 2                                                      |

These stubs are **intentional and load-bearing for the plan's design**. Plan 01-03 is a hybrid autonomous + human-action plan; the human-action portion only completes when the user runs through the playbooks.

## Auth gates encountered

None during autonomous execution. The two `checkpoint:human-action` tasks (1 + 2) are themselves auth-gate analogues — they require the user to authenticate to Apple Developer (with their Apple ID) and a Win EV cert vendor (with their ID documents). Surfaced via the CHECKPOINT REACHED message returned to the orchestrator.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All security-relevant surface added in this plan (Developer ID private key handling, EV HSM PIN handling, `.p8` storage location, vendor mis-identification) was in the plan's `<threat_model>` register (T-03-01 through T-03-05 + T-03-SC). No NEW surface introduced beyond what Plan 01-03 specified. |

## Procurement Status (live)

> Updated as the user completes the external procurement steps. Re-edit this section + the `01-CERT-STATUS.md` rows together.

### macOS — Apple Developer Program

- [ ] Apple ID with 2FA enabled
- [ ] Apple Developer Program enrolment paid (~$99/yr) and active
- [ ] Team ID recorded in `01-CERT-STATUS.md`
- [ ] Developer ID Installer cert generated + imported into login keychain
- [ ] `security find-identity -p basic -v | grep "Developer ID Installer"` returns ≥1 line
- [ ] App Store Connect API key generated; `.p8` saved to `~/.config/fennec-keys/` (chmod 400, outside repo)
- [ ] `xcrun notarytool store-credentials "fennec-notary" --key ... --key-id ... --issuer ...` succeeded
- [ ] `xcrun notarytool history --keychain-profile fennec-notary` exits 0
- [ ] `01-CERT-STATUS.md` macOS section fully filled (all TODO rows replaced)

### Windows — EV code-signing cert

- [ ] Vendor chosen + recorded in `01-CERT-STATUS.md` + `.env` (mirror of `.env.example` line 71)
- [ ] EV cert purchased
- [ ] ID-verification documents submitted to vendor
- [ ] Vendor confirmed verification complete
- [ ] HSM/token received (USB) OR cloud-signing credentials activated
- [ ] Driver installed (SafeNet Authentication Client / YubiKey Manager / vendor-specific)
- [ ] Cert in user store: `certutil -store -user My` shows it
- [ ] Test artefact built: `installer/windows/test-artefact.exe` (any small signed `.exe`)
- [ ] First signature applied via `installer/windows/sign-test-artefact.ps1` — **starts the SmartScreen reputation-warm-up clock per D-05**
- [ ] `signtool verify /pa /v installer\windows\test-artefact.exe` outputs `Successfully verified`
- [ ] `01-CERT-STATUS.md` Windows section fully filled (all TODO rows replaced)

## Deferred Items

| Item                                                                   | Rationale                                                                                                                                        | Picked up by                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Full SmartScreen reputation acquisition                                | Microsoft policy change March 2024 (Pitfall 4) — no longer instant on EV cert procurement. Earned over time via downloads.                       | Phase 5 cross-platform polish (after `.msi` distribution begins accumulating downloads)                   |
| Hardened Runtime entitlements for the signed `.pkg`                    | Out of Plan 01-03 scope; required by Plan 01-09 (full installer build).                                                                          | Plan 01-09 (signed installer pipeline)                                                                    |
| MDM Configuration Profile schema (`org_install_secret` payload spec)   | Out of Plan 01-03 scope; D-08 / D-09 say Phase 1 ships MDM-primitives via Plan 01-09.                                                            | Plan 01-09                                                                                                |
| Renewal automation for both certs                                      | Annual maintenance task; out of Phase 1 scope. Cert auto-renewal lives in Phase 6 self-host distribution.                                        | Phase 6                                                                                                   |
| Cross-region availability (Cloudflare WAF blocking Apple/Windows traffic if any) | Hypothetical and out of scope. Procurement uses the user's local machine + vendor portal, not Cloudflare.                                  | N/A unless a corporate proxy issue surfaces during procurement                                            |
| `playwright@1.49.1` SSL vulnerability (carried from Plan 01-01)        | Pre-existing; out of scope for this plan.                                                                                                        | Plan 01-10 or Phase 5                                                                                     |

## Next Plan Readiness

**Autonomous portion of 01-03 is complete.** The wave-2-blocking artefacts (playbooks + scripts + status template) all ship. The wave-2-complete gate (Apple Dev + Win EV procurements actually done) remains open until the user finishes external procurement.

**Downstream plan readiness:**

- **Plan 01-09 (signed installer pipeline)** — will invoke `installer/macos/sign-test-artefact.sh` against the real fennec `.pkg` once Task 1 is done. The script's interface (`$1 = unsigned pkg, $2 = "Developer ID Installer: Name (TEAMID)"`) is stable; only the inputs change. **Cannot start until Plan 01-03 Task 1 is fully done** (Team ID + keychain profile in 01-CERT-STATUS.md).
- **Phase 5 cross-platform daemon polish** — will invoke `installer/windows/sign-test-artefact.ps1` against the real fennec `.msi`. The script's interface (`-CertSubject` + `-TimestampUrl` + `-SignToolPath`) is stable; only the artefact changes. **Cannot start until Plan 01-03 Task 2 is fully done** (cert thumbprint + first-signature timestamp in 01-CERT-STATUS.md).
- **Other Phase 1 wave 2 plans** (01-02, 01-04) — **already complete; not blocked by 01-03 procurement.** They ship code that is independent of signing credentials. Wave 3 plans (01-05, 01-06) are also signing-independent. The only direct downstream blocked by procurement is Plan 01-09 (signed installer pipeline), which is in Wave 5 of Phase 1.

**This means:** the procurement clock can tick in the background while Waves 3 + 4 (backend Hono, daemon core, Claude Code adapter, MDM packaging primitives) ship in parallel. The user does not need to halt all work waiting for the Win EV cert — only the signed-installer-pipeline plan in Wave 5 is gated.

## Self-Check

- `installer/macos/CERT-PROCUREMENT.md`: FOUND (12,736 bytes)
- `installer/windows/CERT-PROCUREMENT.md`: FOUND (18,553 bytes)
- `installer/windows/procure-cert.md`: FOUND (3,405 bytes)
- `installer/windows/sign-test-artefact.ps1`: FOUND (9,873 bytes)
- `installer/macos/sign-test-artefact.sh`: FOUND (9,046 bytes, mode 0755 / executable)
- `.planning/phases/01-foundations/01-CERT-STATUS.md`: FOUND (12,287 bytes)
- `.env.example` line 67 `APPLE_NOTARY_KEYCHAIN_PROFILE=fennec-notary`: FOUND
- `.env.example` comment above APPLE_NOTARY_KEYCHAIN_PROFILE: FOUND (`# Set by 'xcrun notarytool store-credentials' — see installer/macos/CERT-PROCUREMENT.md`)
- Commit `02ebe69`: FOUND (`git log --oneline -4`)
- Commit `b5e7cef`: FOUND (`git log --oneline -4`)
- Plan automated verification (`<verify><automated>`): ALL OK
- `bash -n installer/macos/sign-test-artefact.sh`: exits 0 (syntactic valid)

## Self-Check: PASSED (autonomous portion)

## Procurement Gate: OPEN — awaiting user action on Tasks 1 + 2

---
*Phase: 01-foundations*
*Autonomous portion completed: 2026-05-31*
*Full plan completion: PENDING user procurement of Apple Developer Program enrolment + Windows EV code-signing certificate*
