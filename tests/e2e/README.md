# fennec end-to-end smoke suite

Phase 1 verification harness. Two tiers:

| Tier | Runs locally? | Requires real infra? | Files |
|------|---------------|----------------------|-------|
| **Local** — daemon-internal invariants | YES | NO | `canary-secrets-smoke.test.ts`, `synapse-coexistence.test.ts`, `kill-9-idempotency.test.ts` |
| **Live** — full pipeline | NO | YES (Supabase + Cloudflare + signed .pkg + Claude Code) | `01-phase-1-smoke.spec.ts` |

The local tier proves the invariants the live tier depends on: redactor catches all 10 canaries, install/uninstall is surgical, idempotency keys are deterministic. The live tier proves the entire stack works.

---

## Running the local tier (anyone, anytime)

```bash
npm run test
```

This runs the three local `.test.ts` files via Vitest. No env vars, no network, no install. ~5 seconds.

Each file is also runnable individually:

```bash
npx vitest run tests/e2e/canary-secrets-smoke.test.ts
npx vitest run tests/e2e/synapse-coexistence.test.ts
npx vitest run tests/e2e/kill-9-idempotency.test.ts
```

---

## Running the live tier (Plan 01-10 acceptance)

The live spec at `01-phase-1-smoke.spec.ts` REQUIRES a real Phase 1 deployment. Without the prereqs below, the spec halts at the first health check with a clear error.

### Prerequisites

| Item | Where to get it | Cost |
|------|-----------------|------|
| Supabase project with all 7 migrations applied | https://supabase.com/dashboard — `bash scripts/db-push.sh` | Free tier OK for smoke |
| Cloudflare Worker deployed with Hyperdrive + KV + OAuth secrets | `cd backend && wrangler deploy` | Free tier OK for smoke |
| Apple Developer ID + notarised `fennec.pkg` installed on the test mac | `bash installer/macos/build-pkg.sh` then `sudo installer -pkg installer/build/fennec.pkg -target /` | $99/yr (Apple Dev Program — see `.planning/phases/01-foundations/01-CERT-STATUS.md`) |
| `sudo fennec wizard` completed on the test mac | Daemon enrollment + plist install + SSO attach | Free |
| Claude Code installed on the test mac | https://claude.ai/download | Free |

### Required env vars

```bash
# Backend
export FENNEC_API_URL=https://fennec-backend.<your-account>.workers.dev

# Supabase
export SUPABASE_URL=https://<your-project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>     # from Supabase Dashboard → API
```

### Optional env vars (with defaults)

```bash
# Loopback daemon HTTP bridge (default 127.0.0.1:7821 — the port the
# loopback bridge binds in Plan 01-07)
export FENNEC_DAEMON_LOOPBACK_URL=http://127.0.0.1:7821

# Path to the daemon's shim secret (default /etc/fennec/shim-secret,
# written by installer/macos/postinstall.sh with mode 0644)
export FENNEC_SHIM_SECRET_PATH=/etc/fennec/shim-secret

# How long to wait for an ai_events row to arrive after a hook fires
# (default 5 minutes = 300000 ms — matches ROADMAP success criterion 1)
export FENNEC_TEST_TIMEOUT_MS=300000
```

### Run the live spec

```bash
npm run test:e2e
```

Or specifically:

```bash
npx playwright test tests/e2e/01-phase-1-smoke.spec.ts
```

Expected runtime: **5–15 minutes** depending on Supabase poll latency. The dominant time is the `pollForRow` against ai_events — set `FENNEC_TEST_TIMEOUT_MS=600000` if your Supabase project is in a slow region.

### What the live spec exercises

1. Backend `/health` returns 200
2. Daemon `/v1/health` returns 200 (proves the LaunchDaemon is alive)
3. POST a hook payload to the daemon loopback bridge with a unique UUID
4. Poll Supabase `ai_events` for the row (≤5 min — ROADMAP success criterion 1)
5. Assert per-row invariants: `org_id`, `schema_version`, `redaction_applied_at`, `redaction_version_hash`
6. Idempotency: re-POST the same payload, assert still exactly 1 row (ROADMAP success criterion 6)
7. Heartbeat: assert `adapter_heartbeats` has a recent row with `events_parsed ≥ 1`, `parse_errors = 0`, `schema_hash` set (CAP-14)
8. Canary redaction: POST a prompt with the AWS canary, assert the canary is NOT in `ai_events.payload` and `[REDACTED:...]` IS (ROADMAP success criterion 5)

### Pass/fail interpretation

- **PASS**: every step succeeds within its timeout. Phase 1 ROADMAP success criteria 1, 5, 6 (automation portion) are verified.
- **FAIL on Step 1-2**: infrastructure is not running. Re-check `wrangler tail` (backend) and `sudo launchctl list | grep fennec` (daemon).
- **FAIL on Step 3**: shim secret mismatch — the daemon rejected the hook POST. Run `sudo cat /etc/fennec/shim-secret` and `sudo cat /var/log/fennec/daemon.log` to diagnose.
- **FAIL on Step 4**: row never landed. Common causes: backend logs an INSERT error (RLS / wrong org_id), Hyperdrive connection limit, or daemon's sync loop is blocked. Check `wrangler tail` and `tail -f /var/log/fennec/daemon.log`.
- **FAIL on Step 5**: row landed but with wrong tagging. The backend stamped the wrong org_id (check Plan 01-05 `getAuthContext` middleware) or the redactor didn't fire (check Plan 01-06 redaction stamping).
- **FAIL on Step 6 (idempotency)**: `ON CONFLICT (idempotency_key) DO NOTHING` is not firing. Check Plan 01-05's events-batch INSERT statement.
- **FAIL on Step 7 (heartbeat)**: HeartbeatScheduler is not running. Check Plan 01-06's heartbeat module.
- **FAIL on Step 8 (canary)**: PRIV-01 LEAK — the canary reached `ai_events.payload`. This is the highest-severity Phase 1 failure. Check Plan 01-06's `redactEvent` invocation in the JSONL queue path.

### What the live spec deliberately does NOT cover

The following ROADMAP success criteria are verified by the manual scripts (`tests/manual/*.sh`) rather than this Playwright spec, because they require operator-driven UI interactions:

- **Criterion 2** (signed .pkg installs without Gatekeeper dialog) — `tests/manual/fresh-mac-pkg-install.sh` + `tests/ci/verify-signed-pkg.sh`
- **Criterion 3** (synapse coexistence — BOTH hooks fire on one event) — `tests/manual/synapse-coexistence-smoke.sh` (the local `.test.ts` version proves install/uninstall logic; the manual script proves both handlers fire on a real Claude Code event)
- **Criterion 4** (SSO attach via browser auto-open + tray notification) — covered inside `fresh-mac-pkg-install.sh` Step 5
- **Criterion 7** (uninstall removes only fennec entries + emits audit event) — `synapse-coexistence-smoke.sh` final steps

The DAE-05 LaunchDaemon verification is `tests/manual/launchdaemon-smoke.sh` (called from `fresh-mac-pkg-install.sh` Step 6).

---

## Authoring guidance

If you add a new test file to this directory:

| File extension | Runner | Imports from |
|---|---|---|
| `*.spec.ts` | Playwright (`npm run test:e2e`) | `@playwright/test` |
| `*.test.ts` | Vitest (`npm run test`) | `vitest` |

Vitest's root config (`vitest.config.ts`) excludes `**/tests/e2e/**` for the workspace-aggregated run, but the workspace at `vitest.workspace.ts` lists `./daemon` and friends which CAN reach into this directory if needed. The three local `.test.ts` files use this fact to import from `@fennec/daemon` for the redactor + managed-settings APIs.

Playwright's `playwright.config.ts` has `testDir: "./tests/e2e"` so any `.spec.ts` here is discovered automatically.

---

## See also

- `.planning/phases/01-foundations/01-10-PLAN.md` — the plan this suite ships from
- `.planning/phases/01-foundations/01-VALIDATION.md` — the validation contract enumerating manual-only verifications
- `.planning/ROADMAP.md` §Phase 1 — the 7 success criteria this suite asserts
- `tests/manual/*.sh` — the operator-driven scripts that cover the UI/install-time criteria
- `tests/ci/verify-signed-pkg.sh` — the signed-pkg gate used by both this spec and the manual runbook
- `scripts/db-push.sh` — the `supabase db push` wrapper used by Plan 01-10 Task 2
