---
phase: 01-foundations
plan: 05
subsystem: backend

tags:
  - hono-4.12.23
  - cloudflare-workers
  - hyperdrive
  - workers-kv
  - bearer-auth-sha256
  - pkce-rfc-7636
  - oauth-google-github-microsoft
  - zod-validation
  - idempotent-upsert
  - hot-path-purity
  - org-id-from-context
  - tdd-red-green

# Dependency graph
requires:
  - 01-01 (npm workspaces + tsc project refs + vitest + biome + husky)
  - 01-02 (@fennec/shared CanonicalEventSchema / EventBatchSchema / EnrollRequestSchema / AttachCallbackRequestSchema / AdapterHeartbeatSchema / UninstallAuditEventSchema)
  - 01-04 (Supabase schema — ai_events PK (idempotency_key, occurred_at) for ON CONFLICT; api_keys.token_hash partial index; install_secret_hash + install_secret_expires_at on orgs)
provides:
  - "Hono Worker entry (`backend/src/index.ts`) mounting 6 routes + /health"
  - "POST /api/events/batch — Bearer-auth, Zod-validate, idempotent UPSERT into ai_events, org_id from context (T-05-02), hot-path-pure (ING-04)"
  - "POST /api/heartbeats — Bearer-auth + Zod, ON CONFLICT (idempotency_key) DO NOTHING on adapter_heartbeats (CAP-14)"
  - "POST /api/daemons/enroll — no auth (bootstrap); sha256(install_secret) lookup; UPSERT daemon_machine + REVOKE prior key + ISSUE fresh key (per W-3 amendment); audit row (AUTH-14)"
  - "GET /api/auth/sso — PKCE state stored in OAUTH_STATE_KV (10-min TTL), 302 to Google/GitHub/Microsoft authorize URL (AUTH-16 first half)"
  - "POST /api/daemons/attach-callback — KV state lookup + PKCE verify + provider code exchange + UPSERT users + bind daemon_machine.attached_user_id + backfill unknown@hostname events (D-15) + audit (AUTH-16 second half)"
  - "POST /api/daemons/uninstall — Bearer-auth + Zod; insert audit row; REVOKE calling api_key (DAE-19 server side, AUTH-09 revocation surface)"
  - "fennecBearerAuth() middleware factory wrapping resolveApiKey (sha256(token) → JOIN api_keys+daemon_machines WHERE revoked_at IS NULL); sets org_id / api_key_id / daemon_machine_id / hostname on Hono context"
  - "11 vitest test files / 49 unit tests (handler logic + Zod validation + Bearer-auth + PKCE state mgmt + hot-path purity static check; W-2 mitigation: integration tests against live Hyperdrive deferred to Plan 01-10 smoke)"
affects:
  - 01-06 (daemon core — POSTs ai_events to /api/events/batch + heartbeats to /api/heartbeats with the Bearer token from key file)
  - 01-08 (daemon identity — calls /api/daemons/enroll with install_secret, persists returned api_key; spins up loopback HTTP server to receive the PKCE callback that then posts to /api/daemons/attach-callback)
  - 01-09 (uninstall — daemon calls /api/daemons/uninstall during teardown)
  - 01-10 (smoke — exercises /health, /api/events/batch, /api/daemons/enroll end-to-end against deployed Worker + live Supabase)

# Tech tracking
tech-stack:
  added:
    - "hono@4.12.23 (already pinned on backend/package.json from Plan 01-01 Wave 0 scaffolding; mounted with sub-app composition in this plan)"
    - "@hono/zod-validator@0.8.0 (zValidator middleware for request-body + query-string parsing)"
    - "pg@8.21.0 + @types/pg@8.20.0 (Hyperdrive connection via env.HYPERDRIVE.connectionString; parameterised queries only)"
    - "@cloudflare/workers-types@4.20260531.1 (Hyperdrive + KVNamespace ambient types)"
    - "wrangler@4.93.1 (pinned per Plan 01-01 corp-proxy compat note; deploy in Plan 01-10)"
  patterns:
    - "Hono sub-app composition: each route module exports a tiny Hono() app that the entry mounts at `/`. The bearer middleware is applied per-app via `app.use('/api/...', fennecBearerAuth())` — the bootstrap (enroll), attach-start, and attach-callback routes intentionally omit the middleware."
    - "Pattern 11 (01-RESEARCH.md lines 671-714): bearerAuth → zValidator → handler → parameterised UPSERT. The org_id, api_key_id, daemon_machine_id, and hostname are NEVER read from the request body — they come from `c.get(...)` set by middleware (T-05-02)."
    - "Hot-path purity (ING-04): the events-batch handler is forbidden from importing `correlation`, `model-fit`, or `aggregator` modules. A static-grep test (`events-batch.hot-path.test.ts`) on the source file enforces this at every CI run."
    - "Idempotency contract for re-enrollment (clarification of plan-text): a successful `/api/daemons/enroll` always returns a FRESH api_key and REVOKES any prior active key for (org_id, daemon_machine_id). The plan-text said 'idempotent: same machine_id → same key'; that is unimplementable because the backend stores `token_hash` only and cannot recover the plaintext to return. The actually-implementable contract is 'idempotent at the daemon_machine level; api_key rotated on every re-enroll'. The plan's W-3 amendment in the execution context explicitly endorsed this resolution."
    - "Async Web Crypto sha256 across both the daemon (via `@fennec/shared`'s `deriveIdempotencyKey`) and the backend (`backend/src/lib/hash.ts`'s `sha256Hex`). Hashes computed at write time match hashes computed at read time against the seeded test row's expected value: `42e56dcc783aaa5fcce745d0167f51726a49cad1801c25f8e69f21f0d65961ed` (asserted in `resolve-api-key.test.ts`)."
    - "TDD RED → GREEN per-task: each task ships a `test(...)` commit before the matching `feat(...)` commit. Husky + biome lint-staged run on every commit and on this plan reformatted 3 files during the lint:fix pass."
    - "W-2 mitigation (chose option C per orchestrator brief): integration tests against live Hyperdrive + Postgres deferred to Plan 01-10 where real Supabase is provisioned. Plan 01-05 ships hermetic unit tests with an injected pg.Client-shaped mock + a KV-shaped mock. Trade-off documented in `backend/vitest.config.ts`. This keeps CI hermetic and gives Plan 01-10 the responsibility of proving the SQL actually executes against the real partitioned table."

key-files:
  created:
    - backend/src/api/attach-callback.ts
    - backend/src/api/attach-start.ts
    - backend/src/api/daemons-enroll.ts
    - backend/src/api/daemons-uninstall.ts
    - backend/src/api/events-batch.ts
    - backend/src/api/heartbeats.ts
    - backend/src/api/attach-callback.test.ts
    - backend/src/api/attach-start.test.ts
    - backend/src/api/daemons-enroll.test.ts
    - backend/src/api/daemons-uninstall.test.ts
    - backend/src/api/events-batch.dedupe.test.ts
    - backend/src/api/events-batch.hot-path.test.ts
    - backend/src/api/events-batch.test.ts
    - backend/src/api/events-batch.validation.test.ts
    - backend/src/api/heartbeats.test.ts
    - backend/src/db/client.ts
    - backend/src/db/queries/ai-events.ts
    - backend/src/db/queries/api-keys.ts
    - backend/src/db/queries/audit.ts
    - backend/src/db/queries/heartbeats.ts
    - backend/src/db/queries/orgs.ts
    - backend/src/env.ts
    - backend/src/lib/bearer-auth.ts
    - backend/src/lib/hash.ts
    - backend/src/lib/hash.test.ts
    - backend/src/lib/resolve-api-key.ts
    - backend/src/lib/resolve-api-key.test.ts
    - backend/src/test-utils/mock-db.ts
  modified:
    - backend/src/index.ts
    - backend/package.json
    - backend/tsconfig.json
    - backend/vitest.config.ts
    - backend/wrangler.jsonc

key-decisions:
  - "Phase 1 OAuth providers: ALL THREE — Google + GitHub + Microsoft — are wired in attach-start.ts and attach-callback.ts. The orchestrator brief asked for Google as the primary Phase 1 dev SSO; the implementation is provider-agnostic so the daemon-side (Plan 01-08) can pick whichever is easiest to provision for the smoke. The first-pass smoke run picks GitHub (no OAuth-app-review needed for solo dev). Phase 3 may narrow or expand the provider set; the surface here is stable."
  - "W-2 mitigation = option C (defer integration tests to Plan 01-10). Plan 01-05's vitest config is documented to use a Node environment with mocked pg.Client. The unit tests cover handler logic, Zod validation, Bearer-auth middleware, PKCE state mgmt, and hot-path purity. The real Hyperdrive + Postgres path is proved in Plan 01-10's smoke after `[BLOCKING] supabase db push`."
  - "API key format: `fennec_<32-byte-urandom-base64url>`. The `fennec_` prefix is visible in logs (operational), the 32-byte (256-bit) urandom keyspace defeats brute force (T-05-01), and the server stores only sha256(token) (T-05-04). Backend never reads or logs the raw token after issuance."
  - "Hono middleware order: `app.use('/api/events/batch', fennecBearerAuth())` runs BEFORE the per-route `zValidator` and the handler. `cors` is intentionally NOT in this plan — the backend only accepts daemon-shaped (Bearer-auth) traffic + the browser-shaped OAuth callback (PKCE), neither of which needs CORS preflight. If the SvelteKit dashboard (Phase 4) calls these endpoints directly from a browser, cors will be added at that point."
  - "Re-enrollment ALWAYS rotates the api_key. Re-enrolling with the same `(org_id, machine_id)` revokes the prior active key (UPDATE api_keys SET revoked_at = NOW()) and issues a fresh one. Documented in `backend/src/api/daemons-enroll.ts` header comment as 'idempotency at the daemon_machine level; api_key freshly issued on every enroll'. The plan's W-3 amendment in the execution context explicitly endorsed this clarification."
  - "Attach-callback machine resolution is by `machine_id alone` (no org scope at this point), discovering org_id from the daemon_machine row. PKCE + KV state TTL together gate this: an attacker would need to forge state AND compute the matching PKCE challenge to land here, which is exactly the threat model the state+PKCE pair are designed to prevent. The threat-model note in attach-callback.ts header documents the residual annoyance vector (a malicious daemon enrolls with arbitrary machine_id, tricks a user into OAuth, binds that user to the attacker's org — an annoyance, NOT a compromise of any existing data, because the row was the attacker's daemon_machine row already)."
  - "Backfill is one-shot per machine and runs in attach-callback (D-15). `backfillUnknownUser(client, { org_id, hostname, user_id })` issues `UPDATE ai_events SET user_id = $3, user_id_unknown = NULL WHERE org_id = $1 AND hostname = $2 AND user_id IS NULL`. Hostname-scoped per D-15 so events from other machines in the same org are NOT touched."
  - "OIDC id_token JWT signature NOT verified in Phase 1. The code-for-token exchange is server-to-server over HTTPS, which is already provider-identity proof. Phase 3 will add full JWKS-based signature verification once OAuth becomes a primary auth path. Documented in `emailFromIdToken` JSDoc."

patterns-established:
  - "Per-app middleware: each Hono sub-app applies fennecBearerAuth() ONLY to its protected route(s); the bootstrap routes (enroll, attach-start, attach-callback) intentionally omit it. The middleware lives in `backend/src/lib/bearer-auth.ts`; routes that need it import it explicitly. No global protection — every protected route opts in."
  - "Per-request pg.Client lifecycle: every handler does `const client = pgClient(c.env); await client.connect(); try { ... } finally { await client.end(); }`. Hyperdrive pools the underlying TCP socket so the per-request `connect`+`end` is cheap. NO long-lived client cached at module scope."
  - "InsertAiEvent returns rowCount (0 on dedupe-hit, 1 on insert). The events-batch handler returns the count of events the daemon submitted, NOT the count of actual inserts — per ING-02, retries return the same `accepted` count even when every row was already present, which is what the daemon's sync loop expects to make its retry logic idempotent."
  - "Test mocking pattern: `backend/src/test-utils/mock-db.ts` exposes a single `mockPgHandle()` that intercepts SQL by regex and dispatches to per-test handlers. The default handler covers the common-case rows; per-test setups call `setHandler((sql) => ...)` to override. Keeps the test files concise and the mock surface predictable."

requirements-completed:
  - ING-01
  - ING-02
  - ING-03
  - ING-04
  - AUTH-09
  - AUTH-10
  - AUTH-14
  - AUTH-16

# Metrics
duration: ~25 min (across two execution sessions: scaffolding + Task 1+2 in session 1; Task 3 RED + GREEN + lint cleanup + SUMMARY in this session)
completed: 2026-05-31
---

# Phase 1 Plan 05: Backend Hono Worker — events/batch + heartbeats + daemons/enroll + attach + uninstall

**Six routes** + `/health` shipped on a Cloudflare Workers + Hono stack with Hyperdrive-backed Postgres connectivity, Workers KV for short-lived PKCE state, and a sha256-hashed Bearer-token auth flow. All inputs validated with Zod at the boundary (via `@hono/zod-validator`). All inserts idempotent (`ON CONFLICT DO NOTHING`). All queries parameterised. Hot-path purity enforced by static-grep test. 49 unit tests, all passing; build, typecheck, lint, and `wrangler deploy --dry-run` all green.

## Performance

- **Duration:** ~25 min total across two execution sessions
  - Session 1 (Task 1 + Task 2): scaffolding + dependencies + bearer-auth + events-batch / heartbeats / enroll handlers + Task 1 + Task 2 tests
  - Session 2 (Task 3 + finalize): attach-start / attach-callback / uninstall handlers + their tests + lint cleanup + SUMMARY
- **Tasks:** 3 (Tasks 2 + 3 followed TDD RED → GREEN; Task 1 was non-TDD scaffolding)
- **Commits:** 5 task commits + this metadata commit

## Accomplishments

- 6 Hono routes shipped + `/health` for the Plan 01-10 smoke check
- `fennecBearerAuth()` middleware verifies `sha256(token)` against `api_keys.token_hash` JOINed with `daemon_machines`, filters `revoked_at IS NULL`, and stamps `org_id` / `api_key_id` / `daemon_machine_id` / `hostname` on the Hono context (T-05-02 mitigation: request body is never trusted for tenancy)
- Events-batch handler is hot-path-pure: NO imports of `correlation` / `model-fit` / `aggregator`. The static-grep test in `events-batch.hot-path.test.ts` is the gate
- Per-event dedupe via `ON CONFLICT (idempotency_key, occurred_at) DO NOTHING` (ING-02 — the (idempotency_key, occurred_at) PK from Plan 01-04 is the dedupe key)
- Daemon enrollment trades the org install_secret for a per-machine `fennec_<base64url>` Bearer token; sha256(install_secret) lookup on `orgs.install_secret_hash` with `install_secret_expires_at > NOW()` filter; UPSERT daemon_machine + REVOKE prior active key + ISSUE fresh key + audit row (AUTH-14)
- OAuth PKCE attach flow: GET /api/auth/sso stores state in `OAUTH_STATE_KV` with 10-minute TTL and 302-redirects to Google / GitHub / Microsoft authorize URLs with the `code_challenge` + `code_challenge_method=S256`; POST /api/daemons/attach-callback verifies PKCE, exchanges code with provider, UPSERTs user, binds `daemon_machines.attached_user_id`, backfills `ai_events.user_id` for `unknown@${hostname}` rows (D-15), audits the attach, and consumes the KV state (one-shot)
- Uninstall handler inserts a `daemon_audit_events` row with the reason from the (3-value enum) body and revokes the calling api_key — subsequent calls with that Bearer token return 401 (DAE-19)
- Wrangler config declares `HYPERDRIVE` + `OAUTH_STATE_KV` bindings + `nodejs_compat` flag; `wrangler deploy --dry-run` succeeds with both bindings detected
- 49 vitest unit tests across 11 files; all pass against the mocked pg.Client + KV
- `npm -w @fennec/backend run build` (tsc), `npm run typecheck`, and `npm run lint` all exit 0

## Task Commits

| # | Phase        | Hash      | Subject                                                                                |
| - | ------------ | --------- | -------------------------------------------------------------------------------------- |
| 1 | Task 1       | `2ea82ba` | feat(01-05): backend Hyperdrive wiring + sha256 hash + bearerAuth middleware           |
| 2 | Task 2 RED   | `5274b12` | test(01-05): RED: add failing tests for events batch + heartbeats + enroll             |
| 3 | Task 2 GREEN | `ae06036` | feat(01-05): GREEN: events-batch + heartbeats + enroll handlers                        |
| 4 | Task 3 RED   | `f4de1dc` | test(01-05): RED: add failing tests for attach start/callback + uninstall              |
| 5 | Task 3 GREEN | `07d9814` | feat(01-05): GREEN: attach-start/callback + uninstall handlers with PKCE + backfill   |

Plan-metadata commit follows this SUMMARY.

## Files Created / Modified

### `backend/src/api/` (handlers + tests)

- `events-batch.ts` — Pattern 11 ingest handler (bearerAuth → zValidator → per-event INSERT)
- `heartbeats.ts` — CAP-14 storage path
- `daemons-enroll.ts` — bootstrap (no Bearer), sha256(install_secret) → org → revoke prior key → mint fresh key
- `attach-start.ts` — PKCE flow start, 302 to provider, state in KV with 10-min TTL
- `attach-callback.ts` — PKCE verify, code exchange (Google/GitHub/Microsoft), UPSERT users + org_members, attach daemon_machine, backfill unknown@hostname events
- `daemons-uninstall.ts` — audit + revoke calling api_key
- `events-batch.test.ts` (5 tests: happy path, validation, dedupe handoff, tenant isolation, auth)
- `events-batch.validation.test.ts` (4 tests: Zod rejection paths)
- `events-batch.dedupe.test.ts` (1 test: idempotency-key replay)
- `events-batch.hot-path.test.ts` (4 tests: static-import-graph assertions for ING-04)
- `heartbeats.test.ts` (4 tests: happy path + idempotency + auth + Zod rejection)
- `daemons-enroll.test.ts` (5 tests: happy + idempotent re-enroll + invalid secret + Zod + audit)
- `attach-start.test.ts` (6 tests: 302 to each provider + KV TTL + missing params + short code_challenge + bad provider)
- `attach-callback.test.ts` (5 tests: happy + PKCE failure + state miss + backfill + hostname scoping)
- `daemons-uninstall.test.ts` (4 tests: happy + revocation effect + Zod reason rejection + audit)

### `backend/src/db/`

- `client.ts` — `pgClient(env)` returns a `pg.Client` from `env.HYPERDRIVE.connectionString` (per-request lifecycle)
- `queries/api-keys.ts` — `getApiKeyByTokenHash`, `revokeApiKey`, `issueApiKeyForMachine`, `revokeActiveKeysForMachine`
- `queries/orgs.ts` — `lookupOrgByInstallSecret`, `upsertDaemonMachine`, `upsertUserByEmail`, `addOrgMember`, `attachDaemonMachineToUser`, `getDaemonMachineByMachineId`
- `queries/ai-events.ts` — `insertAiEvent` (ON CONFLICT DO NOTHING), `backfillUnknownUser`
- `queries/heartbeats.ts` — `insertHeartbeat` (ON CONFLICT (idempotency_key) DO NOTHING)
- `queries/audit.ts` — `insertAuditEvent` (returns inserted id; ON CONFLICT (idempotency_key) DO NOTHING)

### `backend/src/lib/`

- `hash.ts` — `sha256Hex(input)` via Web Crypto (lowercase hex; same surface the daemon uses via `@fennec/shared`)
- `hash.test.ts` (5 tests: stability + matches expected-hash constant against the seeded Phase 1 token)
- `bearer-auth.ts` — `fennecBearerAuth()` middleware factory wrapping Hono's `bearerAuth`
- `resolve-api-key.ts` — `resolveApiKey(token, env, client?)` — `sha256Hex` + `getApiKeyByTokenHash`
- `resolve-api-key.test.ts` (6 tests: seeded lookup, miss, revoked, parameterisation, JOIN shape, no-raw-token-in-params)

### `backend/src/`

- `env.ts` — `Env` (Hyperdrive + KVNamespace + OAuth secrets) + `Variables` (Hono context)
- `index.ts` — Hono entry mounting all 6 routes + `/health`

### `backend/src/test-utils/`

- `mock-db.ts` — `mockPgHandle()` (regex-dispatched SQL mock), `createMockKv()`, `stubEnv()`

### `backend/`

- `package.json` — adds hono, @hono/zod-validator, @supabase/supabase-js, pg, zod, @fennec/shared, wrangler, @cloudflare/workers-types, @types/pg
- `wrangler.jsonc` — HYPERDRIVE + OAUTH_STATE_KV bindings + nodejs_compat + secrets-list header comment + Phase 2 queue placeholder
- `tsconfig.json` — adds `"types": ["@cloudflare/workers-types"]` and `"lib": ["ES2022", "WebWorker"]`; references `../packages/shared`
- `vitest.config.ts` — Node environment, W-2-mitigation rationale documented

## Routes Summary

| Method | Path                            | Auth                | Validator                                | Behavior                                                                                            |
| ------ | ------------------------------- | ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/health`                       | none                | —                                        | `{ status: "ok" }` for Plan 01-10 smoke                                                              |
| POST   | `/api/events/batch`             | Bearer (fennecBearerAuth) | `EventBatchSchema`                       | UPSERT each event into ai_events ON CONFLICT (idempotency_key, occurred_at) DO NOTHING; returns `{ accepted: N }` (count of submitted events, not insert count, so retries are idempotent) |
| POST   | `/api/heartbeats`               | Bearer              | `AdapterHeartbeatSchema`                 | INSERT into adapter_heartbeats; idempotency_key UNIQUE dedupes; returns 201 `{ status: "recorded" }` |
| POST   | `/api/daemons/enroll`           | none (bootstrap)    | `EnrollRequestSchema`                    | sha256(install_secret) → org lookup (must not be expired); UPSERT daemon_machine; REVOKE prior key; ISSUE fresh `fennec_<base64url>` token; audit; return `EnrollResponse` |
| GET    | `/api/auth/sso`                 | none                | `QuerySchema` (provider + PKCE)          | Store state in OAUTH_STATE_KV (TTL 600s); 302 → provider authorize URL with response_type=code + code_challenge + code_challenge_method=S256 + provider-scoped scopes |
| POST   | `/api/daemons/attach-callback`  | none (PKCE)         | `AttachCallbackRequestSchema`            | KV state lookup; PKCE verify; provider code exchange; UPSERT user; bind machine; backfill events; audit; consume state |
| POST   | `/api/daemons/uninstall`        | Bearer              | `UninstallAuditEventSchema`              | Insert audit; REVOKE calling api_key; returns `{ audit_id }`                                        |

## OAuth Provider Choice — Rationale

The orchestrator brief named Google as the primary Phase 1 dev SSO (well-documented, common). The implementation goes further and wires **all three providers** (Google + GitHub + Microsoft) end-to-end so the daemon-side (Plan 01-08) can pick whichever is easiest to provision for the smoke run. The provider-agnostic `exchangeAndResolveEmail()` helper in `attach-callback.ts` dispatches to the right token endpoint per provider:

| Provider  | Authorize URL                                                       | Token URL                                                                  | Email source                  | Scopes                  |
| --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------- | ----------------------- |
| Google    | `https://accounts.google.com/o/oauth2/v2/auth`                       | `https://oauth2.googleapis.com/token`                                      | `id_token.email` (OIDC)       | `openid email profile`  |
| GitHub    | `https://github.com/login/oauth/authorize`                          | `https://github.com/login/oauth/access_token`                              | `GET /user` `.email`           | `read:user user:email`  |
| Microsoft | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`     | `https://login.microsoftonline.com/common/oauth2/v2.0/token`               | `id_token.email` (OIDC)       | `openid email profile`  |

Phase 1's first-pass smoke run will use GitHub for solo-dev provisioning convenience (no OAuth-app review required); Phase 3 may narrow or expand the provider set based on enterprise customer needs. Phase 1's surface is stable either way — providers are an enum + a switch.

## Test Coverage

| Test file                                  | Tests | What it asserts                                                                                                  |
| ------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `lib/hash.test.ts`                         | 5     | sha256Hex stability + lowercase hex + matches expected-hash for seeded token                                     |
| `lib/resolve-api-key.test.ts`              | 6     | Seeded lookup + miss + revoked + parameterisation + JOIN shape + raw token never appears in params               |
| `api/events-batch.test.ts`                 | 5     | Happy path (2 events) + tenant isolation (request-body org_id ignored) + auth gates + handler shape              |
| `api/events-batch.validation.test.ts`      | 4     | Zod rejection: missing idempotency_key, empty events array, wrong types                                          |
| `api/events-batch.dedupe.test.ts`          | 1     | Same batch submitted twice returns the same `accepted` count                                                     |
| `api/events-batch.hot-path.test.ts`        | 4     | Static-grep on source: NO import of `correlation`/`model-fit`/`aggregator`                                       |
| `api/heartbeats.test.ts`                   | 4     | Happy + idempotency + auth + Zod rejection                                                                       |
| `api/daemons-enroll.test.ts`               | 5     | Happy + idempotent re-enroll (revokes prior key, issues fresh) + invalid secret 401 + short secret 400 + audit   |
| `api/attach-start.test.ts`                 | 6     | 302 to each of 3 providers + KV TTL stored + missing params 400 + short code_challenge 400 + bad provider 400    |
| `api/attach-callback.test.ts`              | 5     | Happy (mocked provider) + PKCE failure 400 + state miss 400 + backfill row count + hostname scoping              |
| `api/daemons-uninstall.test.ts`            | 4     | Happy 200 + revoke side-effect + Zod reason rejection 400 + audit row inserted                                   |
| **Total**                                  | **49**| **All pass under `npm -w @fennec/backend run test`**                                                              |

## Decisions Made

(Mirrored in the frontmatter `key-decisions` block.)

1. **All three OAuth providers wired** (Google, GitHub, Microsoft) per the planner's interfaces block + the brief's Google primary. The daemon picks which to drive at runtime; the backend is provider-agnostic.

2. **W-2 mitigation = option C** — Plan 01-05 ships hermetic unit tests with mocked pg.Client + mocked KV. Live Hyperdrive + Postgres integration is Plan 01-10's job (after `[BLOCKING] supabase db push` makes a real Supabase available). The vitest config header documents the trade-off and the Phase 5 follow-up plan to migrate to `@cloudflare/vitest-pool-workers` once a CI Hyperdrive emulator exists.

3. **W-3 amendment honoured** — re-enrollment for the same `machine_id` REVOKES any prior active api_key and ISSUES a fresh one. The plan-text said "idempotent: same machine_id → same key" which is unimplementable (the backend stores only `token_hash`; the plaintext is unrecoverable). The actually-implementable contract is "idempotent at the daemon_machine level; api_key freshly issued on every enroll" — documented at the top of `daemons-enroll.ts`. Tests 12/13/14 in `daemons-enroll.test.ts` verify the new contract.

4. **API key format `fennec_<32-byte-base64url>`.** Prefix is visible in logs (operationally useful), the 256-bit urandom keyspace defeats brute force (T-05-01), and only `sha256(token)` is persisted (T-05-04). The raw token is returned to the daemon ONCE at enrollment and never read or logged again.

5. **`org_id` always from auth context, never from request body** (T-05-02). Every protected handler does `const org_id = c.get("org_id")`. Tests in `events-batch.test.ts` assert that a hostile `events[i].org_id` in the request body is ignored — the stamped value is the auth-context value.

6. **Hot-path purity enforced by static-grep test.** `events-batch.hot-path.test.ts` reads the source file and asserts no `from "...correlation..."` / `"...model-fit..."` / `"...aggregator..."` imports. CI will catch any accidental coupling of the ingest hot path to Phase 2 analytics modules.

7. **Per-app middleware, not global.** Each Hono sub-app applies `fennecBearerAuth()` only to its protected route(s). The bootstrap routes (`enroll`, `attach-start`, `attach-callback`) intentionally omit it — they have alternative gates (install_secret hash lookup; PKCE + state KV).

8. **Per-request pg.Client lifecycle.** Every handler runs `pgClient(env).connect()` → handler body → `client.end()`. Hyperdrive handles the underlying TCP pool; no module-scoped client. Avoids the leaks-JWT-context pitfall called out in STACK.md (one client per request).

9. **OIDC id_token signature NOT verified in Phase 1.** The server-to-server code-for-token exchange over HTTPS is the identity proof. Phase 3 adds JWKS signature verification. Documented in `emailFromIdToken` JSDoc.

10. **Attach-callback resolves machine by `machine_id` alone.** PKCE + state-KV TTL together gate this; the residual annoyance vector (attacker binds a victim user to the attacker's own org) is documented in the handler header and accepted because it is not a data-disclosure compromise.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug] Test mock SQL pattern mismatched the implemented handler query**

- **Found during:** Task 3 GREEN integration of the attach-callback handler with the pre-existing Task 3 RED tests in `attach-callback.test.ts`
- **Issue:** The RED tests in `attach-callback.test.ts` mocked the daemon_machine lookup as `SELECT id, hostname FROM daemon_machines`. The implemented handler issues `SELECT id, org_id, hostname FROM daemon_machines` because the org_id needs to flow from the row into the subsequent writes (the callback handler is auth-less, so it cannot inherit org_id from a Bearer context the way other handlers do).
- **Fix:** Updated the two `installDefaultHandler` regex branches in `attach-callback.test.ts` to match `id,\s*org_id,\s*hostname` and to return `org_id: TEST_ORG` in the mock row. The implementation is correct — the test's RED-time SQL pattern was speculative.
- **Files modified:** `backend/src/api/attach-callback.test.ts`
- **Verification:** All 5 `attach-callback.test.ts` cases pass.
- **Committed in:** `07d9814` (rolled into Task 3 GREEN commit).

**2. [Lint — auto-format] Unused import + line-length reformatting after Task 3 GREEN**

- **Found during:** `npm run lint` after Task 3 GREEN.
- **Issue:** Two clean-up items: (a) `getDaemonMachineByMachineId` was imported in `attach-callback.ts` but the handler ended up calling a local `getDaemonMachineByMachineIdAnyOrg` helper instead (the `orgs.ts` query is org-scoped; the callback intentionally is NOT, per Decision 10 above), so the import was genuinely unused; (b) biome's formatter rewrote 3 files (events-batch + attach-callback + daemons-uninstall) to its preferred line breaks.
- **Fix:** Removed the unused import; ran `npm run lint:fix` to apply biome reformatting.
- **Files modified:** `backend/src/api/attach-callback.ts`, `backend/src/api/events-batch.ts`, `backend/src/api/daemons-uninstall.ts`
- **Verification:** `npm run lint` exits 0; all 49 tests still pass; build + typecheck green.
- **Committed in:** `07d9814` (rolled into the Task 3 GREEN commit).

---

**Total deviations:** 2 auto-fixed
- 1 Rule 1 (test-mock SQL pattern bug)
- 1 lint:fix auto-format

**Impact on plan:** None of these were architectural or scope-changing. All 33 acceptance-criteria grep checks across Tasks 1+2+3 pass.

## Known Stubs

| File | Why it's a stub | Resolved by |
|------|-----------------|-------------|
| `backend/wrangler.jsonc` HYPERDRIVE.id + OAUTH_STATE_KV.id | Placeholder strings (`PLACEHOLDER_RUN_wrangler_hyperdrive_create`, `PLACEHOLDER_RUN_wrangler_kv_namespace_create`). Concrete ids will be set in Plan 01-10 right before `wrangler deploy`. The Worker compiles and `wrangler deploy --dry-run` validates the binding shape against this placeholder, so this stub does NOT block Plan 01-05's "boots locally" gate. | Plan 01-10 — run `wrangler hyperdrive create fennec-supabase --connection-string=...` + `wrangler kv namespace create OAUTH_STATE_KV`, paste the printed ids in, then `wrangler deploy`. |
| `backend/src/api/attach-callback.ts` — OIDC JWT signature NOT verified | The server-to-server code-for-token exchange over HTTPS is already provider-identity proof. Adding JWKS-based signature verification is Phase 3 work when OAuth becomes a primary auth path. | Phase 3 RLS hardening / OAuth maturity plan |
| `backend/src/api/attach-callback.ts` — GitHub fallback `/user/emails` not called | When the GitHub user has suppressed their public email, the Phase 1 happy path expects them to switch to GitHub + a public email. Phase 3 will call `/user/emails` to pick the primary verified address. | Phase 3 |

The wrangler-id placeholders are intentional and tracked here per the deviation rules. Tasks 1+2+3 ship with all 3 OAuth providers wired so the daemon (Plan 01-08) can pick whichever is easiest to provision.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| (none) | — | Every security-relevant surface added in this plan (Bearer-auth lookup, PKCE verification, OAuth code exchange, install_secret lookup, api_key revocation) was in the plan's `<threat_model>` register T-05-01..10 + T-05-SC. No NEW threats were introduced beyond what the plan specified. |

Two residual notes for the next phase:
- T-05-09 (service_role bypasses RLS) remains an accepted Phase 1 limitation; Phase 3 RLS hardening introduces user-scoped tokens that make the RLS policies (already declared in Plan 01-04) load-bearing.
- The attach-callback "malicious daemon binds a victim user to the attacker's org" vector is an accepted-as-annoyance scenario (not a data-disclosure compromise) — documented in the handler header.

## TDD Gate Compliance

Tasks 2 and 3 followed the RED → GREEN cycle with separate commits:

- **Task 1** (`2ea82ba`): non-TDD scaffolding (dependencies, configs, env types, db client, hash util, bearer-auth middleware factory). Plan called this `tdd="auto"` rather than `tdd="true"`, so a single feat commit was correct. Tests (`hash.test.ts`, `resolve-api-key.test.ts`) shipped in the same commit as the code they exercise.
- **Task 2 RED** (`5274b12`): tests written first against unimplemented modules — they fail because handlers don't exist.
- **Task 2 GREEN** (`ae06036`): handlers implemented; all Task 2 tests pass.
- **Task 3 RED** (`f4de1dc`): tests written first for attach-start, attach-callback, uninstall.
- **Task 3 GREEN** (`07d9814`): handlers implemented; all Task 3 tests pass; one Rule-1 fix to a RED-time SQL-mock pattern (documented above).

No fail-fast violations. No REFACTOR commits — biome's lint-staged pre-commit hook handled formatting in-line.

## Issues Encountered

- The pre-commit hook (`husky` + biome `lint:fix`) fired on every commit; on Task 3 GREEN it reformatted 3 files. No semantic changes.
- `npm install` for the four new backend deps (hono, @hono/zod-validator, pg, @types/pg + zod which was already present) ran clean.
- `wrangler deploy --dry-run` succeeded with the placeholder bindings (the dry-run only validates the binding *shape*; it does not require the actual KV namespace / Hyperdrive config to exist). This is enough for the Plan 01-05 "boots locally" gate; Plan 01-10 owns the actual deploy.

## Deferred Items

| Item | Rationale | Picked up by |
|------|-----------|--------------|
| Live Hyperdrive + Postgres integration tests | W-2 mitigation option C — live integration is Plan 01-10's job after `[BLOCKING] supabase db push` provisions real Supabase. Plan 01-05's unit tests cover handler logic + Zod + Bearer-auth + PKCE; the live SQL execution is the smoke's job. | Plan 01-10 (smoke test) |
| `wrangler hyperdrive create` + `wrangler kv namespace create` + paste-in real IDs | Concrete binding IDs belong with the deploy. The shape is already validated by `wrangler deploy --dry-run`. | Plan 01-10 (right before `wrangler deploy`) |
| OIDC JWT signature verification (JWKS) | Server-to-server code exchange is Phase 1 sufficient. Phase 3 OAuth maturity adds full JWKS-based verification. | Phase 3 |
| GitHub `/user/emails` fallback for users with suppressed public email | Phase 1 happy path expects public email. | Phase 3 |
| CORS middleware | Backend currently accepts only daemon-shaped (Bearer) traffic + browser-shaped OAuth callback (PKCE). If Phase 4 dashboard calls these endpoints directly from a browser, `cors` will be added at that point. | Phase 4 (dashboard) |
| `@cloudflare/vitest-pool-workers` migration | Would require a CI Hyperdrive emulator (does not exist today). Re-evaluate at Phase 5. | Phase 5 |
| `playwright@1.49.1` SSL vulnerability (carried from Plan 01-01) | Pre-existing; out of scope. | Plan 01-10 or Phase 5 |

## Next Plan Readiness

Plan 01-05 is fully released. The next plans in Phase 1 can:

- **Plan 01-06 (daemon core)**: import the contract from this plan — POST events to `/api/events/batch` with `Authorization: Bearer <token from /var/db/fennec/key>`, POST heartbeats to `/api/heartbeats`. Both endpoints validate via `@fennec/shared` schemas, so the daemon's queue + sync loop ships against the same Zod schemas the backend enforces.
- **Plan 01-08 (daemon identity)**: call `/api/daemons/enroll` with the install_secret from the MDM payload, persist the returned `api_key` at `/var/db/fennec/key` (mode 0400), spin up a loopback HTTP server to receive the PKCE callback, then POST to `/api/daemons/attach-callback` with the OAuth code + verifier + state.
- **Plan 01-09 (macOS installer + uninstall)**: the uninstall flow POSTs to `/api/daemons/uninstall` with the Bearer token from the key file; the backend revokes the key, the daemon then deletes the key file and unloads the LaunchDaemon.
- **Plan 01-10 (smoke test)**: provisions live Supabase via `[BLOCKING] supabase db push`, creates the Hyperdrive + KV bindings via `wrangler hyperdrive create` / `wrangler kv namespace create`, deploys the Worker, then exercises the daemon → backend → Supabase path end-to-end.

Nothing in Plan 01-05 blocks the rest of Phase 1.

## Self-Check

- `backend/src/index.ts`: FOUND (mounts all 6 routes + /health)
- `backend/src/api/events-batch.ts`: FOUND
- `backend/src/api/heartbeats.ts`: FOUND
- `backend/src/api/daemons-enroll.ts`: FOUND
- `backend/src/api/attach-start.ts`: FOUND
- `backend/src/api/attach-callback.ts`: FOUND
- `backend/src/api/daemons-uninstall.ts`: FOUND
- `backend/src/lib/bearer-auth.ts`: FOUND
- `backend/src/lib/resolve-api-key.ts`: FOUND
- `backend/src/lib/hash.ts`: FOUND
- `backend/src/db/client.ts`: FOUND
- `backend/src/db/queries/api-keys.ts`: FOUND
- `backend/src/db/queries/orgs.ts`: FOUND
- `backend/src/db/queries/ai-events.ts`: FOUND
- `backend/src/db/queries/heartbeats.ts`: FOUND
- `backend/src/db/queries/audit.ts`: FOUND
- `backend/src/env.ts`: FOUND
- `backend/wrangler.jsonc`: FOUND (HYPERDRIVE + OAUTH_STATE_KV + nodejs_compat)
- Commit `2ea82ba` (Task 1): FOUND
- Commit `5274b12` (Task 2 RED): FOUND
- Commit `ae06036` (Task 2 GREEN): FOUND
- Commit `f4de1dc` (Task 3 RED): FOUND
- Commit `07d9814` (Task 3 GREEN): FOUND
- `npm -w @fennec/backend run test`: 49/49 pass
- `npm -w @fennec/backend run build`: clean
- `npm run typecheck`: clean (all workspaces)
- `npm run lint`: clean (64 files, biome)
- `npx wrangler deploy --dry-run`: bundles, both bindings detected
- All 33 acceptance-criteria grep checks across Tasks 1+2+3: PASS

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31*
