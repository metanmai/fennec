---
phase: 01-foundations
plan: 10
subsystem: phase-1-smoke

tags:
  - phase-1-e2e
  - autonomous-shipped-task-1
  - blocking-human-task-2
  - blocking-human-task-3
  - blocking-human-task-4
  - blocking-human-task-5
  - locally-runnable-subset-green
  - real-infra-required
  - partial-completion-halt-on-checkpoints

# Dependency graph
requires:
  - 01-04 (Supabase migrations 1-7 in repo; Plan 01-10 Task 2 pushes them live)
  - 01-05 (backend Hono Worker; Plan 01-10 Task 3 deploys it)
  - 01-09 (UNSIGNED .pkg built; SIGNED step gated on Apple Dev cert from 01-03; Task 4 installs signed once procurement completes)

provides:
  - "scripts/db-push.sh: supabase db push wrapper — SUPABASE_ACCESS_TOKEN preflight, optional SUPABASE_PROJECT_REF auto-link, migration-set SHA-256 chain-of-custody print (T-10-01)"
  - "tests/ci/verify-signed-pkg.sh: ROADMAP criterion 2 gate — spctl --assess must report `source=Notarized Developer ID`; pkgutil --check-signature must show a Developer ID Installer signer (rejects self-signed). Called from tests/manual/fresh-mac-pkg-install.sh AND from operators running the e2e suite."
  - "tests/e2e/01-phase-1-smoke.spec.ts: Playwright spec for the live tier — backend /health, daemon /v1/health, hook injection via X-Fennec-Shim-Secret, ai_events poll (≤5min — ROADMAP criterion 1), idempotency assertion (criterion 6 first half), adapter_heartbeats poll (criterion 6 second half + CAP-14), canary redaction (criterion 5). Requires real Supabase + deployed Worker + signed daemon installed."
  - "tests/e2e/canary-secrets-smoke.test.ts: 14 PRIV-01 local tests (fixture-vs-CANARIES parity + per-canary redaction + multi-canary redaction + redaction-metadata stamping). RUNS LOCALLY — no infra."
  - "tests/e2e/synapse-coexistence.test.ts: 5 DAE-11/D-20/D-24 local tests (byte-equal user-settings + 6-hook install + additive merge + surgical uninstall + round-trip byte-equality). RUNS LOCALLY — no infra."
  - "tests/e2e/kill-9-idempotency.test.ts: 6 ROADMAP-criterion-6 local tests (deterministic buildCanonicalEvent + redactor byte-equality on replay + replay-from-stale-watermark + second-replay-same-keys + atomic watermark durability + watermark tamper-recovery). RUNS LOCALLY — no infra."
  - "tests/e2e/README.md: full setup checklist + env vars + pass/fail interpretation guide for the Playwright spec"
  - "tests/manual/launchdaemon-smoke.sh: DAE-05 verification — launchctl entries + daemon-as-root + plist ACL + api_key ACL + helper-agent plist ACL"
  - "tests/manual/fresh-mac-pkg-install.sh: DAE-12 runbook — 8 steps from `sw_vers` through `Claude Code prompt → ai_events row` with screenshot capture points"
  - "tests/manual/synapse-coexistence-smoke.sh: live companion to the local synapse test — requires Claude Code + a synapse install OR a mock synapse hook; asserts BOTH handlers fire on one Claude Code event"
  - "tests/vitest.config.ts: tests workspace config — includes e2e/**/*.test.ts + integration/**/*.test.ts; excludes *.spec.ts (Playwright owns those)"
  - "vitest.workspace.ts: adds `./tests` workspace so `npm run test` includes the locally-runnable Phase 1 smoke subset"
  - "daemon/src/index.ts: re-exports writeFennecHooks + removeFennecHooks + ALL_HOOK_NAMES from the @fennec/daemon barrel so the synapse-coexistence local test imports cleanly via the public API"

affects:
  - "01-SMOKE-LOG.md: this plan WOULD populate it as Tasks 2-5 land; currently empty because all 4 require real infrastructure"
  - "ROADMAP.md Phase 1: success criteria 1, 3 (managed-settings part), 5 (criterion-5 portion), 6 (criterion-6 portion), 7 — verified LOCALLY where possible; LIVE verification gated on infrastructure"
  - "STATE.md: Phase 1 status remains in-progress; this plan is NOT marked complete — it ships the harness but the verification it harnesses requires external action"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-tier verification: LOCAL .test.ts files (Vitest) for in-process invariants, LIVE .spec.ts files (Playwright) for end-to-end pipeline. README explains the split; pass/fail interpretation guide enumerates the 7 ROADMAP criteria and which file covers each."
    - "Manual scripts as runbooks (not pure automation): tests/manual/fresh-mac-pkg-install.sh prints each step + waits for Enter so the operator captures screenshots into 01-SMOKE-LOG.md. Synapse-style 'fully green or not done' philosophy applies — partial pass is not pass."
    - "Workspace-pattern Vitest expansion: added `./tests` to vitest.workspace.ts so the locally-runnable subset is picked up by `npm run test` automatically. New workspace's tests/vitest.config.ts explicitly excludes *.spec.ts to keep Playwright vs Vitest separation clean."
    - "Daemon barrel expansion: writeFennecHooks + removeFennecHooks + ALL_HOOK_NAMES now exported from @fennec/daemon top-level (Plan 01-07 originally kept them internal). Necessary for tests/e2e/synapse-coexistence.test.ts to import via the public API rather than deep-importing dist paths."
    - "Argv-array safety end-to-end: all 5 shell scripts use `command argv argv argv` patterns with no shell concatenation. scripts/db-push.sh prints SUPABASE_ACCESS_TOKEN length only (never the token itself). tests/ci/verify-signed-pkg.sh prints SHA-256 BEFORE running spctl/pkgutil so chain-of-custody is captured even if Gatekeeper rejects."

key-files:
  created:
    - scripts/db-push.sh
    - tests/ci/verify-signed-pkg.sh
    - tests/e2e/README.md
    - tests/e2e/canary-secrets-smoke.test.ts
    - tests/e2e/kill-9-idempotency.test.ts
    - tests/e2e/synapse-coexistence.test.ts
    - tests/manual/fresh-mac-pkg-install.sh
    - tests/manual/launchdaemon-smoke.sh
    - tests/manual/synapse-coexistence-smoke.sh
    - tests/vitest.config.ts
  modified:
    - daemon/src/index.ts (added 3 managed-settings re-exports)
    - tests/e2e/01-phase-1-smoke.spec.ts (replaced placeholder skip with full live spec)
    - vitest.workspace.ts (added `./tests` workspace)

key-decisions:
  - "Plan 01-10 split into AUTONOMOUS (Task 1) + INFRA-GATED (Tasks 2-5). Task 1 ships the entire smoke harness + locally-runnable verification subset. Tasks 2-5 cannot run in this session — they require real Supabase + Cloudflare + Apple Dev cert + Claude Code on the user's machine. Halting at structured checkpoints with explicit env-var/external-action requirements is the correct posture; faking infra calls would mask the real status."
  - "Synapse 'fully green or not done' standard applied: the locally-runnable subset (25 tests across 3 files) actually runs and is fully green. The live spec is shipped + Playwright sees it (`playwright test --list` confirms discovery) but is gated on infra. The plan's status is honestly `partial — autonomous-ready, live-infra-required`."
  - "Test directory structure: tests/e2e/{*.spec.ts → Playwright; *.test.ts → Vitest}; tests/manual/*.sh → operator runbooks; tests/ci/*.sh → automated gates (runnable in CI when artefacts are present); scripts/ → infra wrappers (one-shot operator-invoked). This separation lets `npm run test:unit` stay fast (Vitest only) while `npm run test:e2e` runs the live spec when explicitly invoked."
  - "Daemon barrel surface expanded by 3 symbols (writeFennecHooks, removeFennecHooks, ALL_HOOK_NAMES) — these were internal to Plan 01-07 but become public for the synapse-coexistence local test. This is the right boundary: any user wanting to write a 3rd-party tool that coexists with fennec needs to understand the hook entry shape, so making the entry-points public is correct as Phase 1 closes."
  - "tests/vitest.config.ts excludes *.spec.ts patterns so Playwright specs (which import from @playwright/test) never accidentally load under Vitest (which would fail with `Cannot find module @playwright/test`). The root vitest.config.ts also keeps `**/tests/e2e/**` excluded — the workspace override is what lets Vitest see .test.ts files in tests/e2e/."
  - "redaction_version_hash format is `gitleaks-v<VER>-defaults+fennec-<N>@<hex>` not pure hex — caught by canary smoke test failure on first run; fixed by matching @[hex] suffix pattern. This is documented behaviour from Plan 01-06; the test now asserts the actual format."

# Threat surface scan
threat-flags: []

# Metrics
metrics:
  duration_min: 17
  tasks_completed: 1
  tasks_partial: 0
  tasks_halted: 4
  files_created: 10
  files_modified: 3
  tests_added_local: 25
  tests_local_passing: 25
  daemon_tests_total_post_change: 155
  live_spec_status: "ready; gated on real Supabase + Cloudflare + signed .pkg + Claude Code"
  completed_date: "2026-05-31 (PARTIAL — Tasks 2-5 HALT for infrastructure)"
---

# Phase 1 Plan 01-10: End-to-end Smoke (Partial — Autonomous Subset Shipped, Live Tier Gated on Infra)

**Smoke harness for the Phase 1 ROADMAP success criteria.** Five tasks: 1 autonomous (test scaffold + locally-runnable subset), 4 gated on real infrastructure (Supabase push, Cloudflare deploy, signed .pkg install, live Claude Code exercise).

## What shipped (autonomous portion)

### Task 1 — Smoke harness + locally-runnable subset (DONE, green)

Ten files authored, three modified, one commit (`e0ec61c`):

- **`scripts/db-push.sh`** — supabase db push wrapper with SUPABASE_ACCESS_TOKEN preflight, optional `SUPABASE_PROJECT_REF` auto-link, and a migration-set SHA-256 print before the push (T-10-01 chain-of-custody). Friendly error messages tell the operator exactly how to obtain the token + ref.

- **`tests/ci/verify-signed-pkg.sh`** — ROADMAP criterion 2 gate. Runs `spctl --assess --type install -vvv <pkg>` and asserts the output contains `source=Notarized Developer ID`. Runs `pkgutil --check-signature <pkg>` and asserts the signer is a `Developer ID Installer:` cert (not self-signed). Prints SHA-256 first so chain-of-custody is captured even if the assertion fails.

- **`tests/e2e/01-phase-1-smoke.spec.ts`** — Playwright spec for the LIVE tier (replaces the Plan 01-01 placeholder skip). Eight steps: backend `/health`, daemon `/v1/health`, hook injection via `X-Fennec-Shim-Secret`, ai_events poll (≤5min — ROADMAP criterion 1), idempotency assertion (criterion 6 first half), adapter_heartbeats poll (criterion 6 second half + CAP-14), canary redaction (criterion 5). Requires real Supabase + deployed Worker + signed daemon installed on the test machine.

- **`tests/e2e/canary-secrets-smoke.test.ts`** — PRIV-01 redaction LOCAL test. 14 sub-tests across 4 `it` blocks: fixture-vs-CANARIES parity (sanity), `it.each` over the 10 canaries asserting both that the canary is NOT in the serialised payload AND that a `[REDACTED:<rule>]` token IS, multi-canary one-prompt redaction, redaction-metadata stamping (the hash format is `gitleaks-v8.21.0-defaults+fennec-1@1a1944db` — the test asserts the `@<hex>$` suffix shape).

- **`tests/e2e/synapse-coexistence.test.ts`** — DAE-11 / D-20 / D-24 LOCAL test. 5 `it` blocks: byte-equal user-settings (SHA-256 PRE vs POST install), 6-hook install (all D-22 hook names present), additive merge (synapse entry survives fennec install), surgical uninstall (synapse entry survives fennec uninstall, fennec entry is gone), round-trip byte-equality (user-settings byte-equal after install+uninstall). The byte-equality SHA-256 is the load-bearing assertion.

- **`tests/e2e/kill-9-idempotency.test.ts`** — ROADMAP criterion 6 LOCAL test. 6 `it` blocks: `buildCanonicalEvent` is deterministic for identical input (pinned `monotonic_seq`), differs on `monotonic_seq`, redactor produces byte-equal payload on replay, replay-from-stale-watermark yields exactly the un-acknowledged tail, second-replay-same-keys (proves dedupe by `idempotency_key` is content-stable), atomic watermark durability + tamper-recovery.

- **`tests/e2e/README.md`** — full setup checklist for the live spec + env-var documentation + pass/fail interpretation guide listing each ROADMAP criterion and which file covers it.

- **`tests/manual/launchdaemon-smoke.sh`** — DAE-05 verification: 5 checks (launchctl shows ≥2 fennec entries; daemon process running as root; LaunchDaemon plist root:wheel mode 644; api_key root:wheel mode 0400; helper-agent plist root:wheel mode 644). Prints PASS/FAIL per check + final count.

- **`tests/manual/fresh-mac-pkg-install.sh`** — DAE-12 runbook. 8 steps from `sw_vers -productVersion` through `Claude Code prompt → ai_events row in Supabase`. Each step prints the command/URL to execute + the expected verification then waits for Enter. Operator captures screenshots + outputs into 01-SMOKE-LOG.md.

- **`tests/manual/synapse-coexistence-smoke.sh`** — live companion to the local synapse test. Sets up a mock synapse-style user-settings entry (if no real synapse is installed), records SHA-256 PRE, prompts the operator to fire a Claude Code event, asserts both the mock synapse hook AND the fennec adapter_heartbeats show events, runs `sudo fennec uninstall`, asserts user-settings SHA-256 POST equals PRE.

- **`tests/vitest.config.ts`** — tests workspace config: includes `e2e/**/*.test.ts` + `integration/**/*.test.ts`; excludes `*.spec.ts` (Playwright owns those).

- **`vitest.workspace.ts`** — adds `./tests` to the workspace list so `npm run test` picks up the locally-runnable subset automatically.

- **`daemon/src/index.ts`** — re-exports `writeFennecHooks`, `removeFennecHooks`, `ALL_HOOK_NAMES`, plus types `HookName` and `WriteFennecHooksOptions` from the daemon barrel so the synapse-coexistence test imports through the public API.

#### Locally-runnable subset — actual run

```
RUN  v4.1.7 /Users/Tanmai.N/Documents/fennec/tests

Test Files  3 passed (3)
Tests       25 passed (25)
Duration    369ms
```

Pre-existing daemon suite: 155/155 pass. Typecheck clean. Playwright `--list` confirms the live spec is discovered.

## What's blocking (Tasks 2-5 — `gate="blocking-human"` checkpoints)

### Task 2 — `[BLOCKING]` supabase db push

**What's missing on this machine:**
- A provisioned Supabase project (no `supabase link` has ever been run in this repo)
- `SUPABASE_ACCESS_TOKEN` env var (Personal Access Token from supabase.com/dashboard/account/tokens)
- `SUPABASE_PROJECT_REF` env var (the project ref, e.g. `abcdefghijklmnop`)

**Required external action by the user:**
1. Create a Supabase project at https://supabase.com/dashboard (free tier OK for Phase 1 smoke)
2. Generate a Personal Access Token at https://supabase.com/dashboard/account/tokens
3. `export SUPABASE_ACCESS_TOKEN=<paste>` and `export SUPABASE_PROJECT_REF=<your-project-ref>`
4. `bash scripts/db-push.sh` — applies all 7 migrations
5. Capture the output + the seed-data verification SELECT outputs into `.planning/phases/01-foundations/01-SMOKE-LOG.md` Step 1
6. Reply with `approved — schema pushed and seeded`

### Task 3 — Cloudflare backend deploy

**What's missing on this machine:**
- A Cloudflare account (no `wrangler login` has been run)
- `CLOUDFLARE_API_TOKEN`
- Hyperdrive resource (created via `wrangler hyperdrive create` against the Supabase Direct Connection string from Task 2)
- KV namespace for `OAUTH_STATE_KV`
- At least one OAuth provider's client_id + secret (GitHub fastest at https://github.com/settings/developers)
- `FENNEC_DB_URL` (Supabase Direct Connection string)

**Required external action by the user:**
1. `wrangler login` (or set `CLOUDFLARE_API_TOKEN` env var)
2. `wrangler hyperdrive create fennec-backend-hyperdrive --connection-string $FENNEC_DB_URL`
3. `wrangler kv:namespace create OAUTH_STATE_KV`
4. Update `backend/wrangler.jsonc` with the real IDs from steps 2+3 (replace placeholders), commit
5. Register at least one OAuth app (GitHub: https://github.com/settings/developers → New OAuth App with callback URL `http://127.0.0.1:*/callback`)
6. `echo "$OAUTH_GITHUB_CLIENT_ID" | wrangler secret put OAUTH_GITHUB_CLIENT_ID` + same for `_SECRET`, `OAUTH_GOOGLE_*`, `OAUTH_MICROSOFT_*` (any subset)
7. `cd backend && wrangler deploy`
8. `curl https://fennec-backend.<account>.workers.dev/health` → expect `{"status":"ok"}` 200
9. `curl -X POST https://fennec-backend.<account>.workers.dev/api/daemons/enroll -H "Content-Type: application/json" -d '{"install_secret":"FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa","machine_id":"smoke-test-machine","hostname":"smoke-host","os":"darwin"}'` → expect 200 with `api_key` + `org_id`
10. Capture outputs into 01-SMOKE-LOG.md Step 2
11. Reply with `approved — backend deployed`

### Task 4 — Install signed .pkg + run wizard + confirm daemon + Helper LaunchAgent

**What's missing on this machine:**
- A SIGNED + NOTARISED `installer/build/fennec.pkg` (only the UNSIGNED variant from Plan 01-09 exists; signed step depends on Apple Dev cert procurement)
- See `.planning/phases/01-foundations/01-CERT-STATUS.md` macOS section — ALL fields are `TODO`

**Required external action by the user:**
1. Apple Developer Program enrollment ($99/yr) at https://developer.apple.com/account/
2. Generate Developer ID Installer certificate (Xcode → Settings → Accounts → Manage Certificates)
3. Generate App Store Connect API key (.p8 mode 0400 at `~/.config/fennec-keys/AuthKey_<KEYID>.p8`)
4. Run `xcrun notarytool store-credentials fennec-notary` once
5. Fill the macOS table in `01-CERT-STATUS.md`
6. `export DEVELOPER_ID_INSTALLER_NAME="Developer ID Installer: <Name> (<TEAMID>)"`
7. `export APPLE_NOTARY_KEYCHAIN_PROFILE=fennec-notary`
8. `bash installer/macos/build-pkg.sh` — emits `installer/build/fennec.pkg` (signed + notarised + stapled)
9. `bash tests/ci/verify-signed-pkg.sh installer/build/fennec.pkg` → must exit 0 with `source=Notarized Developer ID`
10. `sudo installer -pkg installer/build/fennec.pkg -target /` (or double-click in Finder)
11. `sudo FENNEC_API_URL=$FENNEC_API_URL fennec wizard` → step through consent + install_secret prompt + SSO attach
12. `sudo bash tests/manual/launchdaemon-smoke.sh` → 5/5 PASS
13. Capture outputs + screenshots into 01-SMOKE-LOG.md Step 3
14. Reply with `approved — installer + wizard end-to-end`

### Task 5 — End-to-end Claude Code smoke (canonical proof + all 7 ROADMAP success criteria)

**What's missing on this machine:**
- All of Tasks 2-4 above
- Claude Code installed (https://claude.ai/download)
- The dev's SSO identity attached via Task 4's wizard

**Required external action by the user:**
1. With Tasks 2-4 complete, open Claude Code on the test machine
2. Step A (criterion 1): Type a prompt with a unique UUID → query Supabase ai_events → expect row within 5 min
3. Step B (criterion 5): Paste a prompt containing all 10 canaries → query ai_events.payload → expect ZERO matches for each canary, expect `[REDACTED:` tokens
4. Step C (criterion 6): `sudo kill -9 $(pgrep -f /usr/local/fennec/lib/daemon/index.js)` mid-flight; submit another prompt; kill again; expect exactly 1 row per idempotency_key
5. Step D (criterion 6 second half): Query adapter_heartbeats → expect `events_parsed > 0`, `parse_errors = 0`, `schema_hash` set within 90s
6. Step E (criterion 3): `bash tests/manual/synapse-coexistence-smoke.sh` → operator-driven, asserts BOTH handlers fire on one event
7. Step F (criterion 7): `sudo fennec uninstall` → expect launchctl entries gone, managed-settings has no fennec entries, user-settings byte-equal, daemon_audit_events has a `user_initiated` row
8. Run `npx playwright test tests/e2e/01-phase-1-smoke.spec.ts` → expect all 8 steps PASS
9. Capture all outputs into 01-SMOKE-LOG.md Step 4
10. Reply with `approved — phase 1 complete, all 7 ROADMAP success criteria verified`

## Requirements satisfied (autonomous portion)

| Requirement | How (autonomous) | Status |
|---|---|---|
| Plan 01-10 smoke harness | `scripts/db-push.sh` + `tests/ci/verify-signed-pkg.sh` + 4 test files + 3 manual scripts + README | ✅ COMPLETE |
| Locally-runnable PRIV-01 verification | `tests/e2e/canary-secrets-smoke.test.ts` (14 sub-tests, 10 canaries) | ✅ COMPLETE (local subset) |
| Locally-runnable DAE-11 verification | `tests/e2e/synapse-coexistence.test.ts` (5 tests, byte-equal SHA-256 load-bearing) | ✅ COMPLETE (local subset) |
| Locally-runnable ROADMAP-criterion-6 verification | `tests/e2e/kill-9-idempotency.test.ts` (6 tests, deterministic-key + replay invariants) | ✅ COMPLETE (local subset) |
| Live end-to-end pipeline | `tests/e2e/01-phase-1-smoke.spec.ts` shipped + Playwright `--list` confirms | ⏳ AUTHORED (gated on real infra) |
| All 7 ROADMAP Phase 1 success criteria verified | Halts on Tasks 2-5 | ⏳ HALT (infra-gated) |

## Threat-model coverage

| Threat | Component | How mitigated |
|---|---|---|
| T-10-01 (tampered migration) | scripts/db-push.sh | Prints migration-set SHA-256 BEFORE push so operator records it in 01-SMOKE-LOG.md; only files under `supabase/migrations/` are applied |
| T-10-02 (token leaks via shell history) | scripts/db-push.sh | Token is `export`-only, never persisted to disk; script prints token LENGTH not value; `.gitignore` excludes `.env*` |
| T-10-03 (test plaintexts in prod) | tests/e2e/01-phase-1-smoke.spec.ts | The plaintexts (FENNEC_TEST_INSTALL_SECRET_PHASE1_..., fennec_phase1_smoke_TESTKEY_...) come from migration 7 which is tagged DEV-ONLY; Phase 6 docs tell operators to skip it |
| T-10-04 (failed push leaves partial schema) | scripts/db-push.sh | supabase CLI uses transactional migrations by default; failure → rollback. Recovery instructions in 01-SMOKE-LOG.md (run `supabase db reset` for the dev project) |
| T-10-05 (smoke uses wrong .pkg) | tests/ci/verify-signed-pkg.sh | Prints SHA-256 of the pkg BEFORE running spctl/pkgutil — chain-of-custody captured even if assertion fails; rejects unsigned + self-signed |

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 — Bug] `redaction_version_hash` regex mismatch in canary-secrets-smoke.test.ts**

- **Found during:** First run of `cd tests && npx vitest run`
- **Issue:** Initial assertion was `/^[0-9a-f]+$/i` but the actual `REDACTION_VERSION_HASH` from `daemon/src/redact/gitleaks-rules.ts` is `gitleaks-v8.21.0-defaults+fennec-1@1a1944db` — versioned prefix + `@<hex>` suffix, not pure hex.
- **Fix:** Changed the assertion to `/@[0-9a-f]{8,}$/i` (matches the trailing hex digest after `@`). This is the load-bearing portion — the version prefix is documentation, the hex is the integrity tag.
- **Files modified:** `tests/e2e/canary-secrets-smoke.test.ts`
- **Committed in:** `e0ec61c`

**2. [Rule 2 — Missing functionality] Daemon barrel did not re-export managed-settings install/uninstall**

- **Found during:** First write of `tests/e2e/synapse-coexistence.test.ts` — `import { installFennecHooks, removeFennecHooks } from "@fennec/daemon/managed-settings/install.js"` failed because (a) `installFennecHooks` is actually `writeFennecHooks`, (b) deep-imports through `@fennec/daemon/*` don't work without an `exports` field in daemon's package.json.
- **Fix:** Added `writeFennecHooks`, `removeFennecHooks`, `ALL_HOOK_NAMES`, and types `HookName` + `WriteFennecHooksOptions` to `daemon/src/index.ts`. This is the right boundary — any third-party tool wanting to coexist with fennec needs these symbols. Plan 01-07 originally kept them internal; Plan 01-10 promotes them as Phase 1 closes.
- **Files modified:** `daemon/src/index.ts`
- **Committed in:** `e0ec61c`

**3. [Rule 3 — Blocking issue] Initial test used non-existent vi.fn API + reversed appendEvent signature**

- **Found during:** Code-reading the daemon source (not actual test failure — caught before run)
- **Issue:** First draft used `appendEvent(queuePath, event)` (path-first). Actual signature is `appendEvent(event, queuePath)` (event-first). Same draft used `replayFromWatermark({queuePath, watermarkPath})` object arg; actual signature is `replayFromWatermark(queuePath, lastSyncedIdempotencyKey)` positional. Same draft used `wm.lastSyncedEventId`; actual field is `wm.last_synced_event_idempotency_key`. Same draft used `buildCanonicalEvent({occurredAt, monotonicSeq, ...})`; actual signature uses snake_case + requires `session_id`, `hook_event`, `seqDir`.
- **Fix:** Rewrote the three local tests against the actual daemon API by reading `daemon/src/queue/jsonl.ts`, `watermark.ts`, `normalize/canonical.ts`, `managed-settings/install.ts`, `managed-settings/uninstall.ts` directly. Same pattern: pin the snake_case wire format, use the positional signatures.
- **Files modified:** `tests/e2e/kill-9-idempotency.test.ts`, `tests/e2e/synapse-coexistence.test.ts`
- **Committed in:** `e0ec61c`

**4. [Auto-format] Biome lint:fix during pre-commit hooks**

- **Found during:** Task 1 commit
- **Issue:** None functional; biome rearranged imports (vitest before @fennec/daemon → @fennec/daemon before vitest, alphabetical), reformatted argument lists, etc. The expected lint-staged behaviour on every commit; same as plans 01-06 / 07 / 08 / 09.
- **Files affected:** `tests/e2e/canary-secrets-smoke.test.ts`, `tests/e2e/kill-9-idempotency.test.ts`, `tests/e2e/synapse-coexistence.test.ts`, `tests/e2e/01-phase-1-smoke.spec.ts`, `daemon/src/index.ts`
- **Verification:** All 25 tests pass post-format; pre-existing 155 daemon tests pass; typecheck clean.

**Total deviations:** 4
- 1 Rule 1 (bug — regex mismatch on redaction_version_hash format)
- 1 Rule 2 (missing critical functionality — barrel re-export of managed-settings APIs)
- 1 Rule 3 (blocking issue — API signature mismatches caught at draft-time, fixed before first test run)
- 1 auto-format (biome lint:fix during pre-commit)

**Impact on plan:** None architectural. The Rule 2 barrel expansion is a small, deliberate API-surface promotion. All 4 fixes preserve the plan's `<acceptance_criteria>` 1:1.

## Authentication / external-action gates

Tasks 2-5 are all blocked on external action by the user. None of these are auth gates in the in-code sense — they're external-procurement / external-deployment / external-runtime gates:

| Gate | What needed | Time estimate |
|---|---|---|
| Supabase project + access token (Task 2) | Free tier — sign up + generate token | ~5 min |
| Cloudflare account + Hyperdrive + OAuth (Task 3) | Free tier — but requires OAuth app registration | ~20-40 min depending on chosen provider |
| Apple Developer Program + Dev ID Installer cert + notarytool keychain profile (Task 4) | $99/yr + 24h enrollment + 5-10 min cert + 1 min keychain profile | ~24h (Apple enrollment dominates) |
| Signed .pkg installed on macOS dev machine (Task 4) | After Apple cert lands, `bash installer/macos/build-pkg.sh` + `sudo installer -pkg ...` | ~10-15 min |
| Claude Code installed + SSO attached (Task 5) | Download + wizard SSO flow | ~5 min |

**For the user: minimum unblocking action to start Plan 01-10's live tier is Tasks 2 + 3 (Supabase + Cloudflare).** Tasks 4 + 5 ALSO require Plan 01-03's Apple Dev cert procurement to complete — those are the longest external-action dependency in Phase 1.

## Test results

```
=== Locally-runnable subset (this plan's autonomous tier) ===
Test Files  3 passed (3)
Tests       25 passed (25)
Duration    369ms

=== Pre-existing daemon suite (regression guard) ===
Test Files  28 passed (28)
Tests       155 passed (155)
Duration    718ms

=== Playwright discovery ===
[chromium] › 01-phase-1-smoke.spec.ts:160:1 › phase 1 smoke: prompt in Claude Code → ai_events row
Total: 1 test in 1 file

=== Typecheck ===
> fennec@0.1.0 typecheck
> tsc --build
(clean exit)

=== All Task 1 acceptance greps ===
ALL GREPS OK
```

## Task Commits

| #  | Task              | Hash      | Subject                                                                       |
| -- | ----------------- | --------- | ----------------------------------------------------------------------------- |
| 1  | Task 1            | `e0ec61c` | test(01-10): Phase 1 smoke harness — db-push wrapper, e2e spec, manual scripts, locally-runnable subset |
| 2  | Task 2            | —         | HALT — `supabase db push` requires real Supabase project + SUPABASE_ACCESS_TOKEN |
| 3  | Task 3            | —         | HALT — Cloudflare deploy requires real account + Hyperdrive + KV + OAuth secrets |
| 4  | Task 4            | —         | HALT — signed .pkg install requires Apple Dev cert from Plan 01-03 + macOS dev machine |
| 5  | Task 5            | —         | HALT — Claude Code end-to-end requires Tasks 2-4 + live Claude Code on dev machine |

Plan-metadata commit follows this SUMMARY.

## Known Stubs

| File | Why it's a stub | Resolved by |
| ---- | --------------- | ----------- |
| `01-SMOKE-LOG.md` | File does not exist yet — would be populated by Tasks 2-5 verification outputs. | User completing Tasks 2-5 with real infra |
| `installer/build/fennec.pkg` (SIGNED) | Still not built — Plan 01-09 deferred this; Plan 01-10 Task 4 consumes it. | Apple Dev cert procurement + re-run of `bash installer/macos/build-pkg.sh` |
| `daemon/src/index.ts` case `"daemon"` | Still blocks forever — Plan 01-09 deferred the full orchestration wiring (AdapterRegistry boot, LoopbackBridge bind, SyncLoop start, HeartbeatScheduler start). The live spec WILL fail at Step 2 (`/v1/health`) until the orchestrator's post-Wave-5 integration commit wires this. | Orchestrator post-Wave-5 integration commit |

## Threat Flags

| Flag | File | Description |
| ---- | ---- | ----------- |
| (none) | — | All new surface (`scripts/db-push.sh`, `tests/ci/verify-signed-pkg.sh`, 3 manual scripts, 4 test files, README, daemon barrel expansion) is covered by the plan's `<threat_model>` entries T-10-01..T-10-05. No new surface beyond what Plan 01-10 specified. |

## Phase 1 Verification Status (honest snapshot at SUMMARY-write time)

| ROADMAP criterion | Status | Verified by |
|---|---|---|
| 1. Prompt in Claude Code → ai_events row ≤5min | ⏳ HALT | Task 5 live exercise + tests/e2e/01-phase-1-smoke.spec.ts |
| 2. Signed .pkg installs no Gatekeeper dialog + spctl Notarized | ⏳ HALT | tests/ci/verify-signed-pkg.sh + tests/manual/fresh-mac-pkg-install.sh + Apple Dev cert |
| 3. Hooks in managed-settings root-owned 644; ~/.claude untouched; both fire | ✅ LOCAL / ⏳ LIVE | tests/e2e/synapse-coexistence.test.ts (local: byte-equal + surgical uninstall) + tests/manual/synapse-coexistence-smoke.sh (live: both handlers fire) |
| 4. SSO attach + unknown@hostname backfill | ⏳ HALT | Task 4 wizard + Task 3 OAuth + Supabase query in 01-SMOKE-LOG.md |
| 5. 10 canary secrets redacted at capture | ✅ LOCAL / ⏳ LIVE | tests/e2e/canary-secrets-smoke.test.ts (local: 10/10 redacted) + Task 5 Step B (live) |
| 6. kill-9 mid-flight loses zero events; replay idempotent; heartbeats fire | ✅ LOCAL / ⏳ LIVE | tests/e2e/kill-9-idempotency.test.ts (local: deterministic keys + replay invariants) + Task 5 Steps C+D (live) |
| 7. Uninstall removes only fennec entries + emits audit event | ✅ LOCAL / ⏳ LIVE | tests/e2e/synapse-coexistence.test.ts (local: surgical uninstall) + Task 5 Step F (live) |

**Verdict: Phase 1 autonomous-side is fully exercised locally. Phase 1 LIVE verification is gated on user external action across 4 procurement / deployment / installation surfaces.** This plan ships the entire harness honestly; nothing is masked or faked.

## TDD Gate Compliance

Plan 01-10 was `type: execute` (not `tdd`). Task 1's commit subject uses `test(01-10):` prefix because the deliverable IS the test suite. No RED-then-GREEN sequencing is required — the smoke harness is itself the regression guard.

Tasks 2-5 are `type="checkpoint:human-action"` / `checkpoint:human-verify` so there is no RED/GREEN cycle to apply to them.

## Next Plan Readiness

**Plan 01-10 status:** **PARTIAL — autonomous portion complete; live portion HALT.**

Specifically:
- **Locally-runnable subset (25 tests):** green, committed, will run on every `npm run test`.
- **Live spec (`01-phase-1-smoke.spec.ts`):** shipped + Playwright sees it; will run when env vars + infrastructure are present.
- **Manual scripts (3 of them):** shipped + chmod +x; will run when their respective infra prerequisites are met.
- **Tasks 2-5:** HALT at structured checkpoints documenting exact env-vars + external actions needed.

**To close Phase 1 fully, the user must:**

1. Provision Supabase + push schema (Task 2) — ~5min after token in hand
2. Deploy Cloudflare backend + wire OAuth (Task 3) — ~20-40min including OAuth app registration
3. Complete Plan 01-03 Apple Dev Program enrollment + cert procurement — ~24h dominated by Apple
4. Rebuild signed `.pkg` (Plan 01-09 re-run) — ~10-15min
5. Install signed `.pkg` + run wizard (Task 4) — ~10min
6. Run end-to-end smoke (Task 5) — ~10-30min depending on Supabase region

**Orchestrator post-Wave-5 integration commit must also land** before Task 5 can succeed: `daemon/src/index.ts` case `"daemon"` currently blocks forever rather than booting the full daemon orchestration (AdapterRegistry, LoopbackBridge, SyncLoop, HeartbeatScheduler). Without this, the live spec halts at Step 2 (daemon `/v1/health`).

No architectural blockers remain. Every locally-verifiable Phase 1 invariant is verified green right now.

## Deferred Items

| Item | Rationale | Picked up by |
| ---- | --------- | ------------ |
| 01-SMOKE-LOG.md populated with Steps 1-4 | Steps require real Supabase + Cloudflare + signed .pkg + Claude Code which don't exist in this session. | User running Tasks 2-5 end-to-end |
| Live ai_events arrival within ≤5 min ROADMAP-1 proof | Requires the full pipeline to be wired and live. | Task 5 (gated on Tasks 2-4 + integration commit) |
| Cross-platform smoke (Linux + Windows) | Out of Phase 1 scope per D-04; Phase 5 ships those. | Phase 5 |
| `bash tests/manual/launchdaemon-smoke.sh` execution + output capture | Requires the signed daemon to be installed; included in Task 4's runbook. | Task 4 (gated on signed .pkg) |
| Daemon orchestration wiring (`fennec daemon` case in CLI) | Plan 01-09 deferred this; Plan 01-10 doesn't ship it either. Without it the live spec's Step 2 cannot pass. | Orchestrator post-Wave-5 integration commit |
| Multi-OAuth-provider testing | Phase 1 requires at least one provider per Plan 01-05; full coverage across Google + GitHub + Microsoft can land in Phase 3 as part of the multi-tenant signup UX. | Phase 3 |

## Self-Check

- `scripts/db-push.sh`: FOUND (executable, `bash -n` clean, all greps pass)
- `tests/ci/verify-signed-pkg.sh`: FOUND (executable, `bash -n` clean, `spctl --assess` + `Notarized Developer ID` + `pkgutil --check-signature` all greps pass)
- `tests/e2e/01-phase-1-smoke.spec.ts`: REPLACED (Playwright `--list` discovers; `ai_events` + `adapter_heartbeats` + `REDACTED` greps pass)
- `tests/e2e/README.md`: FOUND
- `tests/e2e/canary-secrets-smoke.test.ts`: FOUND (14 tests pass)
- `tests/e2e/kill-9-idempotency.test.ts`: FOUND (6 tests pass)
- `tests/e2e/synapse-coexistence.test.ts`: FOUND (5 tests pass)
- `tests/manual/launchdaemon-smoke.sh`: FOUND (executable, `bash -n` clean, `launchctl list` + `root:wheel` greps pass)
- `tests/manual/fresh-mac-pkg-install.sh`: FOUND (executable, `bash -n` clean, `Notarized Developer ID` grep pass)
- `tests/manual/synapse-coexistence-smoke.sh`: FOUND (executable, `bash -n` clean, `~/.claude/settings.json` + `managed-settings.json` + `SHA-256` greps pass)
- `tests/vitest.config.ts`: FOUND
- `vitest.workspace.ts`: MODIFIED (added `./tests` workspace)
- `daemon/src/index.ts`: MODIFIED (re-exports writeFennecHooks + removeFennecHooks + ALL_HOOK_NAMES)
- Commit `e0ec61c`: FOUND
- `cd tests && npx vitest run`: 25/25 pass across 3 files
- `npm -w @fennec/daemon run test`: 155/155 pass across 28 files
- `npm run typecheck`: clean
- `npx playwright test --list`: discovers 1 test in 1 file
- All Task 1 acceptance criteria greps from PLAN.md `<verify><automated>`: ALL PASS

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31 (PARTIAL — Task 1 autonomous-ready; Tasks 2-5 HALT for infrastructure)*
