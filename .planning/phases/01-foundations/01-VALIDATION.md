---
phase: 1
slug: foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract. Greenfield project — Wave 0 installs Vitest and a minimal Playwright config before any feature task ships.

See `.planning/phases/01-foundations/01-RESEARCH.md` §Validation Architecture for the full enumerated test list (30+ tests across daemon, backend, installer, and OS-integration layers).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (unit + integration) + Playwright 1.x (OS-integration smoke tests) |
| **Config files** | `vitest.config.ts` (per-workspace), `playwright.config.ts` (root) — Wave 0 |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test` (runs unit + integration + e2e:happy-path) |
| **Estimated runtime** | ~60–90 seconds unit; ~5–8 minutes full (includes daemon spin-up + Supabase RLS smoke + signed-installer dry-run) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit` for the workspace touched
- **After every plan wave:** Run `npm run test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green AND the smoke-test (prompt typed in Claude Code → row in Supabase via daemon) must have been executed manually at least once
- **Max feedback latency:** 90 seconds for unit, 8 minutes for full

---

## Per-Task Verification Map

The planner derives the concrete per-task map from PLAN.md `acceptance_criteria` fields. The map below is the SCAFFOLD — populated as plans are written. Every Phase 1 requirement has at least one automated or Wave-0-prep test, except those flagged as Manual-Only below.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| (populated by planner) | | | | | | ⬜ pending |

Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

---

## Wave 0 Requirements

Greenfield project — these MUST be installed/configured before any feature plan runs:

- [ ] `package.json` + npm workspaces (`packages/shared/`, `daemon/`, `backend/`, `installer/`)
- [ ] TypeScript 5.x with strict mode (root `tsconfig.json` + per-workspace extends)
- [ ] Biome 2.x configured at root for lint + format
- [ ] Vitest 2.x configured per-workspace with shared `vitest.config.base.ts`
- [ ] Playwright 1.x configured at root with the `01-e2e-happy-path.spec.ts` skeleton
- [ ] `husky` + `lint-staged` pre-commit hook running `biome check` on staged files
- [ ] Pre-push hook running `npm run lint && npm run typecheck && npm run test:unit`
- [ ] `.env.example` documenting every env var the Phase 1 surfaces require (Supabase URL, Cloudflare account ID, Apple Developer team ID, Win EV cert vendor, OAuth client IDs)
- [ ] Test fixtures for the 10 canary secrets used by PRIV-01 redaction tests
- [ ] CI workflow stub (`.github/workflows/ci.yml`) running lint+typecheck+unit on every PR

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Apple-notarised `.pkg` installs without Gatekeeper "unidentified developer" dialog on a clean macOS machine | DAE-08, DAE-12 | Requires a real Apple Developer ID + real codesigning + Apple's notarisation service round-trip | Install `.pkg` on a freshly-imaged macOS VM; verify `spctl --assess --type install fennec.pkg` returns `source=Notarized Developer ID`; double-click install completes without dialogs |
| Windows EV code-signing certificate is procured and a test artefact has been signed | DAE-09 | Requires real cert vendor relationship + ID verification | Run `signtool sign /td sha256 /fd sha256 /tr http://timestamp.digicert.com test-artefact.exe` with the EV cert HSM/token; verify `signtool verify /pa /v test-artefact.exe` shows the cert + timestamp |
| First-run consent screen surfaces hook list + data-flow disclosure | PRIV-07 | UX assertion; verified by a human reading the screen | Run `sudo fennec init --install-secret <test-secret>`; capture screenshot; confirm the screen lists all 6 Claude Code hook events + describes "data flows to backend at <URL>" |
| Dev-OAuth browser auto-open from system daemon | AUTH-16, DAE-20 | Requires a real OAuth provider configured + a real macOS desktop with default-browser settings | Trigger an un-attached state; confirm system notification appears; click it; confirm default browser opens to SSO; complete sign-in; confirm daemon receives the callback and binds the user_id |
| `unknown@${hostname}` events are backfilled on first SSO attach | AUTH-16 | Time-coupled to OAuth flow; requires real OAuth provider | After captures with no SSO, complete attach; query Supabase for events with original `hostname` tag; verify `user_id` updated to the attached identity |
| Claude Code hooks fire and produce a row in Supabase via the daemon | CAP-02, ING-01, ING-02 | Requires real Claude Code installation + signed daemon + real Supabase backend | Type a prompt in Claude Code; wait ≤5 min; query `ai_events` table for the prompt; verify presence + correct fields + `org_id` |

---

## Validation Sign-Off

- [ ] Wave 0 install steps completed and committed before any feature task starts
- [ ] All 36 Phase 1 requirements either have an automated `<acceptance_criteria>` or appear in the Manual-Only table above
- [ ] No watch-mode flags in CI commands
- [ ] Feedback latency under 8 minutes for full suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner populates the per-task map and Wave 0 completes
- [ ] Schema-push task (`supabase db push` or migration runner) is `[BLOCKING]` per Step 5.7 detection and gates the smoke test

**Approval:** pending
