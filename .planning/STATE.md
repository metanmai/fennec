---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Plan 01-07 complete: Claude Code hook adapter — Go shim + loopback bridge + payload normaliser + managed-settings install/uninstall. 4 tasks, 6 commits owned, 136/136 daemon tests pass, 4/4 Go tests pass."
last_updated: "2026-05-31T08:21:10.910Z"
last_activity: 2026-05-31
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 10
  completed_plans: 9
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Make every AI request in an org observable, attributable, and explainable — who is prompting how, where the money goes by project, is the right model being used.
**Current focus:** Phase 1: Foundations

## Current Position

Phase: 1 of 6 (Foundations)
Plan: 9 of 10 in current phase
Status: Ready to execute
Last activity: 2026-05-31

Progress: [█████████░] 90%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 1 P1 | 11 | 4 tasks | 21 files |
| Phase 01 P02 | 33 min | 2 tasks | 12 files |
| Phase 01 P04 | ~4 min | 2 tasks | 10 files |
| Phase 01 P03 | 7m | 1 of 3 (Task 3 done; Tasks 1+2 procurement-gated) tasks | 7 files |
| Phase 01 P05 | ~25 min | 3 tasks | 29 files |
| Phase 01-foundations P06 | 22 min | - tasks | - files |
| Phase 1 P08 | 11min | 3 tasks | 19 files |
| Phase 01-foundations P07 | ~15min | - tasks | - files |
| Phase 01 P09 | 12min | 2 + partial Task 3 tasks | 21 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Both quality lenses (model-fit + outcome correlation) ship in v1, model-fit first if internal sequencing forces it.
- Init: All four capture surfaces (CLI hooks, CLI watch, IDE, browser) in v1; browser develops in parallel with explicit v1-freeze decision point (GA / submit-and-wait / defer).
- Init: All three OS daemons (macOS + Linux + Windows) ship at v1 launch — macOS in Phase 1, Linux/Windows in Phase 5.
- Init: Free OSS + paid SaaS at v1; enterprise tier is a "contact us" stub on the pricing page.
- Init: Horizontal-layers project mode chosen over vertical MVP; phases build technical layers (schema → ingest → daemon → adapters → backend analysis → multi-tenant → dashboards → cross-platform → self-host).
- [Phase ?]: 01-01 — slopcheck unavailable; 14-package audit override approved by user (not automated verdict)
- [Phase ?]: 01-01 — wrangler pinned to 4.93.1 (corp proxy blocks rosie-skills transitive from 4.94.0+); Phase 5 follow-up to revisit
- [Phase ?]: 01-01 — npm 'workspace:*' protocol blocked by corp proxy; cross-workspace deps use plain '*'
- [Phase ?]: 01-01 — biome.json migrated to v2.4.16 schema (files.includes + assist.actions.source.organizeImports)
- [Phase ?]: 01-02 — deriveIdempotencyKey uses Web Crypto API (crypto.subtle.digest) not node:crypto, so @fennec/shared stays runtime-neutral for Workers
- [Phase ?]: 01-02 — Anthropic Usage cache tokens captured as 4 SEPARATE optional non-negative ints (ANL-06 / T-02-03 / PITFALL P6); Assumption A2 totals deferred to Plan 01-06
- [Phase ?]: 01-02 — CanonicalEventSchema OMITS org_id/user_id (backend stamps tenancy from api_key lookup per Pattern 11 / threat T-02-01)
- [Phase ?]: 01-02 — PKCE verifier enforced 43-128 chars per RFC 7636 4.1 on AttachCallbackRequestSchema; AdapterHeartbeat counters required-not-optional even at zero
- [Phase 01]: 01-04: timestamped migration ordering (20260531000001..7) matches Supabase CLI + psql -f glob order; ai_events PK is (idempotency_key, occurred_at) so partition col is in the unique constraint and the composite doubles as Plan 05's ON CONFLICT clause
- [Phase 01]: 01-04: RLS ENABLE + tenant-isolation CREATE POLICY on all 10 customer-data tables from day 1 (D-26/PITFALL P5); users uses USING(TRUE) placeholder until Phase 3 adds org_members JOIN; orgs uses id=jwt.org_id since orgs.id IS the tenant
- [Phase 01]: 01-04: hashes computed in SQL via pgcrypto.digest() in the seed migration (single source of truth = plaintext); ai_events/git_events range-partitioned by occurred_at with current+next month for ai_events and current month only for git_events
- [Phase 01]: 01-04: api_keys partial UNIQUE index on token_hash WHERE revoked_at IS NULL keeps bearer-auth lookup fast as revocation history grows; daemon_audit_events.daemon_machine_id NULLABLE (no CASCADE) so post-uninstall audits survive
- [Phase 01]: 01-03 — partial completion: autonomous playbooks + smoke scripts + 01-CERT-STATUS.md shipped (commits 02ebe69 + b5e7cef); Tasks 1+2 procurement-gated awaiting user external action (Apple Dev Program ~99 USD/yr + Win EV cert ~280-700 USD/yr)
- [Phase 01]: 01-03 — Phase 1 Win EV acceptance recalibrated per Pitfall 4 (Microsoft SmartScreen March 2024 policy change): success criterion is cert procured + first signature + signtool verify, NOT full reputation. Full reputation is a Phase 5 emergent outcome after .msi distribution accumulates downloads.
- [Phase 01]: 01-03 — vendor recommendation: DigiCert (fastest + KeyLocker cloud signing avoids HSM shipping), Sectigo (best price-to-delivery for indie devs), Certera (cheapest CA/B Forum option). Cloud signing preferred over USB HSM where budget permits.
- [Phase 01]: 01-03 — Pitfall 11 (notarytool --wait) hardcoded in installer/macos/sign-test-artefact.sh; App Store Connect .p8 lives at ~/.config/fennec-keys/ chmod 400 OUTSIDE the repo (T-03-03); .gitignore already excludes *.p8
- [Phase ?]: [Phase 01]: 01-05 — all three OAuth providers (Google + GitHub + Microsoft) wired in attach-start/callback; daemon picks per-smoke; backend provider-agnostic
- [Phase ?]: [Phase 01]: 01-05 — re-enrollment ALWAYS rotates api_key (REVOKE prior + ISSUE fresh) because backend stores only token_hash; W-3 amendment clarifies plan-text 'same machine → same key'
- [Phase ?]: [Phase 01]: 01-05 — W-2 mitigation option C: integration tests against live Hyperdrive deferred to Plan 01-10 smoke; Plan 01-05 ships hermetic unit tests with mocked pg.Client + KV
- [Phase ?]: [Phase 01]: 01-05 — org_id ALWAYS from auth context (c.get), NEVER from request body (T-05-02); unit test asserts hostile events[i].org_id is ignored
- [Phase ?]: [Phase 01]: 01-05 — hot-path purity enforced by static-grep test on events-batch.ts source (no correlation/model-fit/aggregator imports — ING-04)
- [Phase ?]: [Phase 01]: 01-05 — attach-callback resolves daemon_machine by machine_id alone; PKCE + state-KV TTL gate the path; residual attacker-binds-victim-to-attacker-org annoyance documented and accepted
- [Phase ?]: A2 cache-token semantics resolved: option (c) — daemon captures all 4 Anthropic Usage fields verbatim; Phase 2 cost worker calibrates against billed-usage data
- [Phase ?]: Tree-walk redaction (not stringify-redact-parse) — walks payload structure so gitleaks rules anchored on real chars fire correctly; fixes JSON-escape blind spot
- [Phase ?]: 4 fennec-supplemental gitleaks rules layered on vendored upstream v8.21.0 — required to cover all 10 PRIV-01 canaries
- [Phase ?]: W-4 SHA-256 pin enforced at two layers (build script + canary test) for vendored gitleaks-rules.toml
- [Phase ?]: schema_hash via field-name set hash (Open Question 3 option a) for CAP-15 drift detection
- [Phase ?]: Bearer-token log sanitiser strips Bearer tokens from any Error message before forwarding to logError (threat T-06-06)
- [Phase ?]: [Phase 01]: 01-07 — Go shim binary is 5.1MB (Go runtime + net/http stdlib floor); DAE-18 ≤15ms TIME contract is load-bearing, not file size.
- [Phase ?]: [Phase 01]: 01-07 — Loopback bridge binds 127.0.0.1 ONLY; X-Fennec-Shim-Secret header validated per POST; shim secret at /etc/fennec/shim-secret mode 0644 (Pattern 9 same-UID threat model)
- [Phase ?]: [Phase 01]: 01-07 — Claude Code adapter is normalisation-only; redaction lives in registry's emit chain. All 4 Anthropic Usage tokens preserved VERBATIM per A2 option c — no aggregation, no totals.
- [Phase ?]: [Phase 01]: 01-07 — Managed-settings install is additive (D-20 synapse coexistence); uninstall is surgical (D-24 — filter by command-equality + unlink when empty). Byte-equal SHA-256 on user-settings asserts DAE-11.
- [Phase ?]: [Phase 01]: 01-07 — Concurrent commit race during lint-staged: 4 RED test files cross-attributed to 01-08 commit 2860d40. Functionally correct; audit-trail misaligned (documented in 01-07 SUMMARY Deviation #2).
- [Phase ?]: [Phase 01]: 01-09 — W-5 contradiction resolved per path (a): /usr/local/fennec/bin/fennec wrapper exec's node from PATH; LaunchDaemon ProgramArguments points at wrapper
- [Phase ?]: [Phase 01]: 01-09 — CLI dispatcher in daemon/src/index.ts runs iff fileURLToPath(import.meta.url)===argv[1]; library imports stay no-op
- [Phase ?]: [Phase 01]: 01-09 — Configuration.plist ships as MDM PRIMITIVE per D-09 with REPLACE_WITH_* placeholders; polished Jamf/Intune templates land in Phase 5
- [Phase ?]: [Phase 01]: 01-09 PARTIAL — Tasks 1+2 complete; Task 3 UNSIGNED .pkg built (SHA-256 5b25f5bd...); HALT on signed step pending Apple Dev Program enrolment

### Pending Todos

None yet.

### Blockers/Concerns

None yet on the daemon/backend track. Three research-phase candidates flagged in roadmap derivation:

- Phase 2: Cursor SQLite multi-DB stability, Copilot cache-file location, Manifest V3 fetch-monkeypatch viability against late-2026 ChatGPT — recommend `/gsd:plan-phase --research-phase 2`.
- Phase 5: Windows daemon lifecycle (Defender + EV-cert reputation timing, Task Scheduler, PowerShell), Cursor/Gemini transcript paths on Windows — recommend `/gsd:plan-phase --research-phase 5`.
- Phase 6: workerd vs Hono-on-Node final pick for self-host (depends on Queues abstraction complexity).
- Plan 01-03 Tasks 1+2 procurement-gated: Apple Developer Program enrollment (~99/yr; instant to 24h) + Windows EV cert procurement (~280-700/yr from DigiCert/Sectigo/Certera; 2-7 days for ID-verification + HSM/cloud-signing). User must (a) enrol at developer.apple.com/programs/enroll and complete steps in installer/macos/CERT-PROCUREMENT.md to fill 01-CERT-STATUS.md macOS section; (b) purchase EV cert from chosen vendor and complete steps in installer/windows/CERT-PROCUREMENT.md to fill 01-CERT-STATUS.md Windows section. Wave 3+ plans (01-05, 01-06) are NOT blocked by this — only Plan 01-09 signed installer pipeline in Wave 5 requires the credentials.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-31T08:20:40.725Z
Stopped at: Plan 01-07 complete: Claude Code hook adapter — Go shim + loopback bridge + payload normaliser + managed-settings install/uninstall. 4 tasks, 6 commits owned, 136/136 daemon tests pass, 4/4 Go tests pass.
Resume file: None
