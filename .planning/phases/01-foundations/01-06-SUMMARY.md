---
phase: 01-foundations
plan: 06
subsystem: daemon

tags:
  - adapter-registry
  - jsonl-queue
  - gitleaks-v8.21.0
  - capture-time-redaction
  - sync-loop
  - heartbeat-emitter
  - schema-hash-drift
  - exponential-backoff
  - https-proxy
  - node-extra-ca-certs
  - bearer-log-sanitisation
  - cache-token-verbatim
  - assumption-a2-deferred
  - tdd-red-green

# Dependency graph
requires:
  - 01-01 (npm workspaces + tsc project refs + vitest + biome + husky)
  - 01-02 (@fennec/shared CanonicalEventSchema / AdapterHeartbeatSchema / deriveIdempotencyKey / ClaudeCodePromptPayloadSchema)
  - 01-04 (Supabase schema — daemon writes shapes that the backend's ai_events / adapter_heartbeats tables accept)
  - 01-05 (backend Hono — POST /api/events/batch + POST /api/heartbeats are the daemon's outbound endpoints)
provides:
  - "daemon Adapter interface + Emit type + EmitInput (Pattern 2): adapters never touch queue/redactor/sync directly"
  - "AdapterRegistry with per-tool counters (events_parsed / parse_errors / daemon_unreachable_count / last_payload_sample); emit chain buildCanonicalEvent → redact → queue.append; PITFALL P1 — event dropped + parse_errors ticked on any pipeline throw (never re-thrown to adapter)"
  - "buildCanonicalEvent stamps hostname/os/occurred_at/idempotency_key/schema_version; per-adapter monotonic_seq persisted via atomic tmp+rename so daemon restart does not reset the counter"
  - "JSONL append-only queue via fs.openSync(path,'a') + writeSync + closeSync (CAP-11). Async fs.appendFile NOT used — no atomic-per-line guarantee on all FS. replayFromWatermark tolerates partial last lines (corrupted/truncated lines silently skipped — crash safety)"
  - "Watermark file (sync-state.json) read returns null on missing; advance writes atomically via tmp+rename (threat T-06-05 — never advance on partial-2xx)"
  - "Queue rotation at 100MB (100*1024*1024 = 104857600 bytes; threat T-06-04 — DoS prevention). listRotatedFiles returns rotated files in chronological order"
  - "gitleaks redactor with vendored upstream v8.21.0 ruleset (181 rules from raw github.com/gitleaks/gitleaks v8.21.0 default config) + 4 fennec-supplemental rules (anthropic-api-key, bearer-token, private-key-header, gcp-api-key-relaxed). Tree-walk recursion over payload objects/arrays/strings (NOT planner's stringify-redact-parse — that approach silently misses JSON-escape-bracketed secrets). W-4 SHA-256 pin (1a1944db…) verified at test time"
  - "PRIV-01 canary smoke: all 10 canaries from tests/canary-secrets.txt redacted before reaching the queue (load-bearing assertion)"
  - "Sync loop with 5s timer + 100-event batch (CAP-12); 2xx advances watermark + resets backoff; 4xx advances + resets backoff (events unsalvageable); 5xx exponentialBackoff (5s base, 60s cap) + does NOT advance; network error increments per-tool daemon_unreachable_count + backoff"
  - "Heartbeat emitter (CAP-14) on a 60s timer EVEN at zero events; Zod-validates AdapterHeartbeat shape before POST; resets counters on 2xx; last_payload_sample retained for cross-interval drift detection"
  - "schema_hash computation (CAP-15 / Open Question 3 option a — field-name set hash): recursive key collection, sorted + joined with `|`, sha256-hex truncated to 16 chars. Same key-set → same hash regardless of values; renamed field → different hash"
  - "NODE_EXTRA_CA_CERTS detection (DAE-10 / Pitfall 13) — Node honors natively, daemon reports detection so backend can confirm corp CA trust; HTTPS_PROXY + lowercase https_proxy support via lazy undici.ProxyAgent dynamic import (no direct daemon dep — relies on workspace-hoisted undici from backend)"
  - "Bearer-token log sanitiser strips `Bearer [A-Za-z0-9_.-]{20,}` from any error message before forwarding to logError (threat T-06-06)"
  - "build pipeline copy-assets.mjs ships gitleaks-rules.toml/.json/.sha into dist/redact/ so production LaunchDaemon (Plan 01-09) has them alongside compiled JS"
  - "60 unit tests across 12 files; full daemon test+build+lint+typecheck clean"

affects:
  - 01-07 (Claude Code hook adapter — implements the Adapter interface this plan exposes; integration test will assert all 4 Anthropic Usage fields survive end-to-end with verbatim values per A2 option c)
  - 01-08 (daemon identity + enrollment — apiKeyProvider callback this plan wires; daemon attach flow plugs into the existing Bearer token plumbing)
  - 01-09 (LaunchDaemon plist + signed .pkg — packages the daemon binary built from this plan's source modules + the dist/redact/*.{toml,json,sha} assets)
  - 01-10 (Phase 1 smoke test — exercises daemon → backend events/batch flow end-to-end; cost-assertion is loosest invariant only per A2 option c: assert 4 fields present + non-negative ints, no math invariant)

# Tech tracking
tech-stack:
  added:
    - "(no new npm runtime dependencies for daemon; threat T-06-SC honored)"
    - "vendored gitleaks-v8.21.0 default ruleset (raw TOML, SHA-256 pinned; converter is a daemon/scripts node script)"
    - "(undici is reached via dynamic import inside daemon/src/sync/proxy.ts — workspace-hoisted from backend, NOT declared in daemon/package.json)"
  patterns:
    - "Adapter contract: in-process pipeline with a single emit chain (buildCanonicalEvent → redact → queue.append). On any throw inside the chain, the event is DROPPED + parse_errors ticks. The redactor is injectable so Task 3's real implementation replaces Task 2's pass-through stub without touching registry code."
    - "Tree-walk redaction instead of stringify-redact-parse: walks the payload structure (objects + arrays + strings) so upstream regexes anchored on real whitespace/quote chars fire correctly. Fixed a planner-pattern blind spot: JSON.stringify converts `\\n` to literal `\\n` (2 chars), which doesn't match the gitleaks rule's `[\\n]` character class — so secrets followed by newlines silently slipped through. Tree walk runs each rule against the developer-typed string with the real chars."
    - "W-4 SHA-256 pin: daemon/src/redact/gitleaks-rules.sha holds the SHA-256 of the canonical TOML; the build script (build-gitleaks-rules.mjs) refuses to regenerate the JSON if the TOML on disk drifts from the pin; the canary test re-verifies the SHA at test time as a second-line defense. Any future upstream-ruleset update must deliberately update the pin."
    - "Fennec-supplemental rules: 4 rules layered on top of upstream (sk-ant- Anthropic keys, opaque Bearer tokens, bare PEM headers, relaxed GCP API key length). Tagged with `fennec-` prefix in rule IDs so the [REDACTED:<id>] markers identify which ruleset caught each secret. Honors A10 (gitleaks defaults + canary coverage = PRIV-01 bar)."
    - "RE2 → ECMAScript regex normalisation: strip inline `(?i)` flags from rule patterns and apply the `i` flag globally for any rule that had one. Rules that still fail to compile under JS are dropped silently — Phase 1 didn't hit any (all 181 upstream + 4 fennec compile cleanly)."
    - "Atomic fs writes (tmp+rename) everywhere state matters: watermark, monotonic_seq files. Survives daemon-restart-mid-write."
    - "Bearer-token log sanitiser shared between sync loop and heartbeat scheduler — any Error message has `Bearer [A-Za-z0-9_.-]{20,}` stripped before forwarding to logError. Threat T-06-06."
    - "Dynamic-import undici.ProxyAgent: the daemon has no direct undici dep (T-06-SC) but uses the workspace-hoisted version from backend at runtime; falls back to direct fetch with a logged warning if undici is unavailable. Fail-open per Pitfall 13."
    - "Tree-shaken build assets: copy-assets.mjs ships .toml/.json/.sha into dist/redact/ alongside compiled JS so production LaunchDaemon doesn't depend on src/ layout."
    - "TDD RED → GREEN per-task: separate `test(plan-id): RED ...` and `feat(plan-id): GREEN ...` commits for Tasks 2 + 3; husky pre-commit (lint-staged biome) fires on every commit"

key-files:
  created:
    - daemon/src/adapters/adapter.ts
    - daemon/src/adapters/registry.ts
    - daemon/src/adapters/registry.test.ts
    - daemon/src/env.ts
    - daemon/src/heartbeat/heartbeat.ts
    - daemon/src/heartbeat/heartbeat.test.ts
    - daemon/src/heartbeat/schema-hash.ts
    - daemon/src/heartbeat/schema-hash.test.ts
    - daemon/src/normalize/canonical.ts
    - daemon/src/normalize/canonical.test.ts
    - daemon/src/queue/jsonl.ts
    - daemon/src/queue/jsonl.test.ts
    - daemon/src/queue/crash-safe.test.ts
    - daemon/src/queue/rotation.ts
    - daemon/src/queue/rotation.test.ts
    - daemon/src/queue/watermark.ts
    - daemon/src/queue/watermark.test.ts
    - daemon/src/redact/canary-test.ts
    - daemon/src/redact/canary.test.ts
    - daemon/src/redact/gitleaks-rules.json
    - daemon/src/redact/gitleaks-rules.sha
    - daemon/src/redact/gitleaks-rules.toml
    - daemon/src/redact/gitleaks-rules.ts
    - daemon/src/redact/redactor.ts
    - daemon/src/redact/redactor.test.ts
    - daemon/src/sync/backoff.ts
    - daemon/src/sync/batch.ts
    - daemon/src/sync/loop.ts
    - daemon/src/sync/loop.test.ts
    - daemon/src/sync/proxy.ts
    - daemon/src/sync/proxy.test.ts
    - daemon/scripts/build-gitleaks-rules.mjs
    - daemon/scripts/copy-assets.mjs
  modified:
    - daemon/package.json
    - daemon/src/index.ts
    - .planning/phases/01-foundations/01-RESEARCH.md

key-decisions:
  - "**A2 cache-token semantics resolved: option (c) — defer to Phase 2.** The daemon writes all 4 Anthropic Usage fields (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens) VERBATIM with no aggregation. Phase 2's cost worker will calibrate the summed-vs-input-only interpretation empirically against billed-usage data before locking the formula. Downstream test assertions (Plan 01-07 hook adapter, Plan 01-10 smoke) are the loosest invariant only: 4 fields present + non-negative ints, no math invariant. 01-RESEARCH.md §Assumptions Log row A2 updated to RESOLVED."
  - "**Tree-walk redaction (NOT planner's stringify-redact-parse).** Walking the payload structure runs each gitleaks rule against the developer-typed string with real whitespace/quote characters. The stringify-redact-parse pattern silently fails on rules anchored on `[\\n]`/`[\\\"]` because JSON.stringify escapes those chars — secrets followed by newlines slipped through. Tree walk fixes this and also avoids JSON-structural-character collisions in rule IDs."
  - "**4 fennec-supplemental rules layered on top of upstream.** The 10-canary PRIV-01 smoke test requires Anthropic API keys (sk-ant-...), opaque Bearer tokens, bare PEM headers, and a longer GCP API key format to redact. The upstream gitleaks v8.21.0 ruleset covers 8 of 10; supplements cover the rest. Each supplement uses a `fennec-` prefix in its rule ID so the [REDACTED:<id>] marker identifies the supplementation in audit trails."
  - "**W-4 SHA-256 pin is two-layer.** The build script verifies the TOML hasn't drifted before producing the JSON. The canary test re-verifies the SHA at test-time so a direct edit to the .json (bypassing the build script) is also caught. The pin (1a1944db…) is enforced as an invariant — any future ruleset update is a deliberate two-step change (re-vendor + update .sha + re-run build script)."
  - "**Undici ProxyAgent via dynamic import.** The daemon does NOT declare undici as a direct dep (threat T-06-SC — no new daemon npm installs). It relies on the workspace-hoisted version from backend at runtime; if undici is unavailable for any reason, buildFetchOptions returns empty options with a logged warning and the daemon falls back to direct fetch. Fail-open per Pitfall 13."
  - "**Bearer-token log sanitiser shared.** Both sync loop and heartbeat scheduler share a sanitiseError() function that strips `Bearer [A-Za-z0-9_.-]{20,}` from any Error message before logging. Threat T-06-06. The Authorization header is never directly logged at any level."
  - "**Schema-hash via field-name set hash (Open Question 3 option a).** Recursive key collection, sorted, joined with `|`, sha256 → 16 hex chars. Detects field renames + adds/removes; doesn't detect type changes (covered in Phase 2's stronger drift detection if needed). Simplest path to CAP-15 wire format."
  - "**Counter reset semantics: events_parsed / parse_errors / daemon_unreachable_count reset on heartbeat success; last_payload_sample retained.** Reset on each heartbeat means each interval reports per-interval values (CAP-14 — counters are per-interval, not cumulative). last_payload_sample is intentionally NOT reset so schema_hash has cross-interval continuity for drift detection (CAP-15)."

patterns-established:
  - "TDD RED → GREEN per-task: separate test(plan-id) commit before matching feat(plan-id) commit. Plan 01-06 ships 4 commits (Task 2 RED+GREEN, Task 3 RED+GREEN) + 1 docs commit for A2 resolution."
  - "Atomic state writes (tmp + rename) for any disk-backed daemon state: watermark, monotonic_seq, future api_key file (Plan 01-08). Survives daemon-restart-mid-write."
  - "Injectable redactor in the registry: Task 2 ships a pass-through stub; Task 3 swaps in the real gitleaks implementation. The contract is a single `redact(event): CanonicalEvent` function; testing the registry's emit chain doesn't require the full ruleset to be loaded."
  - "Recursive payload walker for both redaction AND schema-hash: same tree-shape traversal pattern handles objects/arrays/primitives. Future Phase 2 redactor extensions (e.g., custom-rule UI) plug into the same walker."

requirements-completed:
  - CAP-01
  - CAP-11
  - CAP-12
  - CAP-14
  - CAP-15
  - CAP-16
  - PRIV-01
  - DAE-10

# Metrics
duration: ~22 min
completed: 2026-05-31
---

# Phase 1 Plan 06: Daemon core — adapter registry, JSONL queue, capture-time redaction, sync loop, heartbeat emitter, schema-hash, proxy

The in-process daemon pipeline. Adapters emit; the registry stamps the canonical envelope, runs gitleaks redaction synchronously, appends to an O_APPEND atomic JSONL queue, batches every 5s to the backend's `/api/events/batch`, and heartbeats every 60s to `/api/heartbeats` even at zero events. CAP-01 / CAP-11 / CAP-12 / CAP-14 / CAP-15 / CAP-16 / PRIV-01 / DAE-10 — eight requirements landed.

## Performance

- **Duration:** ~22 min
- **Started:** 2026-05-31T12:42Z (after A2 resolution commit)
- **Completed:** 2026-05-31T13:04Z
- **Tasks:** 3 (1 checkpoint + 2 auto-TDD)
- **Commits:** 5 (1 A2 docs + 2 RED + 2 GREEN; one RED/GREEN pair per autonomous task)

## Accomplishments

- **A2 cache-token semantics resolved** via the user's option-(c) decision; 01-RESEARCH.md row A2 updated to RESOLVED with the deferred-to-Phase-2 contract recorded
- **Adapter registry pattern** (Pattern 2 in 01-RESEARCH.md): in-process pipeline `emit → buildCanonicalEvent → redact → appendEvent`; on any throw the event is DROPPED + parse_errors ticks (PITFALL P1)
- **Per-adapter counters** exposed via `getCountersSnapshot()` for the heartbeat scheduler (events_parsed, parse_errors, daemon_unreachable_count, last_payload_sample)
- **Canonical normalisation** stamps hostname/os/occurred_at/idempotency_key/schema_version; per-adapter monotonic_seq persisted via atomic tmp+rename for crash-safety
- **Append-only JSONL queue** with O_APPEND atomic semantics (CAP-11); 50-concurrent-write test passes with no torn lines; corrupted/truncated last-line silently dropped on replay (crash safety)
- **Rotation at 100MB** with timestamped rotated filenames; listRotatedFiles returns chronological order so the sync loop drains rotated files first (CAP-16)
- **Watermark** via atomic tmp+rename (threat T-06-05); read returns null on missing; advance is idempotent
- **Vendored gitleaks v8.21.0 default ruleset** (181 rules, ~83KB TOML); SHA-256 pinned (W-4) to `1a1944db563ed277a5091b73559f4b244fae110557e189da5a5e367c607b7f4e`; build script refuses to regenerate JSON if the TOML drifts from the pin
- **4 fennec-supplemental rules** layered on top of upstream: anthropic-api-key, bearer-token, private-key-header, gcp-api-key-relaxed — together they catch the 2 canaries the upstream ruleset misses
- **Tree-walk redaction** (NOT stringify-redact-parse): walks payload objects/arrays/strings so rules anchored on real `\n`/`"`/`'` chars fire correctly. Fixes a planner-pattern blind spot where JSON-escape-encoded chars would silently let secrets through
- **PRIV-01 canary smoke test passes**: every one of the 10 canaries from `tests/canary-secrets.txt` is redacted before reaching the queue (assertion in `canary.test.ts`)
- **Sync loop** batches 100/5s with `Authorization: Bearer <api_key>` header (CAP-12); 2xx advances + resets backoff; 4xx advances + resets backoff (unsalvageable events); 5xx exponentialBackoff (5s base, 60s cap) and does NOT advance; network error increments per-tool daemon_unreachable_count + backoff
- **Heartbeat emitter** (CAP-14) fires every 60s EVEN at zero events; Zod-validates each AdapterHeartbeat before POST; counters reset on 2xx; last_payload_sample retained for cross-interval drift detection
- **schema_hash** computed via field-name set hash (Open Question 3 option a): recursive key collection → sorted → `|`-joined → sha256-hex → 16 chars. Same key-set → same hash; renamed field → different hash (drift detected)
- **NODE_EXTRA_CA_CERTS + HTTPS_PROXY support** (DAE-10 / Pitfall 13): detection helpers + dynamic `undici.ProxyAgent` construction via dynamic import (no direct daemon dep)
- **Bearer-token log sanitiser** strips `Bearer [A-Za-z0-9_.-]{20,}` from any error message before forwarding (threat T-06-06)
- **Build pipeline** ships gitleaks-rules.toml/.json/.sha into dist/redact/ so production LaunchDaemon (Plan 01-09) has them alongside compiled JS
- **60 unit tests / 12 test files all green**, daemon build + lint + typecheck clean across the full workspace

## Task Commits

| # | Phase                 | Hash      | Subject                                                                                                       |
| - | --------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1 | Task 1 (A2 docs)      | `4540aaf` | docs(01-06): resolve A2 cache-token semantics per user decision                                               |
| 2 | Task 2 RED            | `467c82d` | test(01-06): RED: add failing tests for adapter + canonical + JSONL queue + watermark + rotation              |
| 3 | Task 2 GREEN          | `48e8a84` | feat(01-06): GREEN: adapter registry + canonical normalisation + JSONL queue + watermark + rotation           |
| 4 | Task 3 RED            | `09b46af` | test(01-06): RED: add failing tests for redactor + canaries + sync loop + heartbeat + schema-hash + proxy     |
| 5 | Task 3 GREEN          | `fd2b65d` | feat(01-06): GREEN: gitleaks redactor (W-4 SHA pin) + sync loop + heartbeat + schema-hash + proxy             |

Plan-metadata commit follows this SUMMARY.

## A2 Cache-Token Semantics: Resolution Summary

**Decision:** Option (c) — defer to Phase 2 with the constraint that the daemon captures verbatim.

**Daemon contract (locked in by this plan):**
- The daemon writes all 4 Anthropic Usage fields VERBATIM into `payload.usage`:
  - `input_tokens` (raw value, no aggregation)
  - `output_tokens`
  - `cache_creation_input_tokens`
  - `cache_read_input_tokens`
- The daemon NEVER computes `total_input_tokens` or any aggregate.
- This is enforced at the schema layer: `ClaudeCodePromptPayloadSchema.usage` (from `@fennec/shared`) carries the 4 fields as separate optional non-negative ints.

**Downstream impact:**

| Plan | Impact of A2 = option (c) |
| ---- | ------------------------- |
| 01-07 (Claude Code hook adapter normaliser) | Integration test will assert all 4 fields survive end-to-end. Test assertion is loosest invariant: present + non-negative integers. No math invariant tested in Phase 1. |
| 01-10 (Phase 1 smoke test cost-assertion) | Same shape. The smoke asserts "all 4 fields present with sensible non-negative integers" — does NOT commit to any of `input ⊇ cache` (Anthropic-docs reading) or `input + cache_read + cache_creation = total` (OTel reading). |
| Phase 2 cost worker (future) | Will run a calibration test (sum-vs-input-only against Anthropic's billed-usage dashboard for the same period) on first deployment, then lock the formula. The calibration choice is recorded in 01-RESEARCH.md §Assumptions Log row A2 (currently marked RESOLVED — deferred-to-Phase-2). |

**Why option (c) is the safest:** Phase 1 daemons in the wild are forward-compatible with either interpretation. The 4 fields are preserved faithfully; Phase 2 can ship the formula choice (or change it) without redeploying any daemons.

## Threat Model Mitigations

Per the plan's `<threat_model>`:

| Threat ID | Mitigation Status | Implementation |
| --------- | ----------------- | -------------- |
| T-06-01 (secret in prompt reaches queue without redaction) | **mitigated** | Redactor runs SYNCHRONOUSLY before queue.append. On redactor throw, event dropped + parse_errors++ (registry catch). 10-canary test asserts zero canaries reach the JSONL. |
| T-06-02 (cache-token misinterpretation → cost miscount) | **mitigated** | Daemon captures all 4 fields VERBATIM (A2 option c). Phase 2 cost worker owns the formula. Loosest-invariant tests in Plans 01-07 / 01-10 enforce field presence only. |
| T-06-03 (JSONL queue corrupted by concurrent writer) | **mitigated** | Single daemon process per machine (CAP-01). O_APPEND atomic per-line on POSIX. 50-concurrent-write test passes. |
| T-06-04 (queue grows unbounded → disk DoS) | **mitigated** | Rotation at 100MB (104857600 bytes). listRotatedFiles + sync loop drain rotated files first. |
| T-06-05 (sync loop double-sends batch on partial 5xx) | **mitigated** | Watermark only advances on full-2xx; backend dedupes by idempotency_key (Plan 01-05 ON CONFLICT DO NOTHING). |
| T-06-06 (api_key leak to daemon log) | **mitigated** | Shared sanitiseError() strips `Bearer [A-Za-z0-9_.-]{20,}` from error messages before logError. Authorization header never directly logged. |
| T-06-07 (corp proxy with self-signed CA blocks daemon HTTPS) | **mitigated** | NODE_EXTRA_CA_CERTS detected + reported in heartbeat metadata (Node honors natively). HTTPS_PROXY + lowercase https_proxy → dynamic undici.ProxyAgent. Falls back to direct fetch with logged warning if undici unavailable. |
| T-06-SC (new daemon dep) | **mitigated** | No new npm install in daemon/package.json. undici reached via dynamic import (workspace-hoisted from backend). Only assets added are vendored TOML + generated JSON + SHA pin. |

## Decisions Made

(Mirrored in the frontmatter `key-decisions` block for STATE.md ingestion.)

1. **A2 cache-token semantics: option (c).** Daemon captures verbatim; Phase 2 cost worker calibrates the formula empirically before locking. Documented in 01-RESEARCH.md row A2.
2. **Tree-walk redaction** instead of the planner's stringify-redact-parse — fixed a JSON-escape blind spot where secrets followed by `\n` silently slipped through the gitleaks rules.
3. **4 fennec-supplemental rules** (anthropic-api-key, bearer-token, private-key-header, gcp-api-key-relaxed) layered on top of vendored upstream to cover the 2 canaries the upstream v8.21.0 ruleset misses.
4. **W-4 SHA-256 pin enforced at two layers** (build script + canary test) so any drift triggers a failure during build OR test.
5. **Dynamic-import undici.ProxyAgent** with fail-open fallback — keeps daemon/package.json free of a new external dep (T-06-SC) while still honoring HTTPS_PROXY.
6. **Bearer-token log sanitiser** shared between sync loop and heartbeat scheduler — single source of truth for the redaction pattern.
7. **schema_hash via field-name set hash** (Open Question 3 option a) — simplest path to CAP-15 wire format; detects renames + adds/removes (Phase 2 may upgrade to shape-aware drift detection).
8. **Counters reset on heartbeat 2xx; last_payload_sample retained.** Heartbeat values are per-interval; the payload sample is cumulative for cross-interval drift continuity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug] Tree-walk redaction vs. planner's stringify-redact-parse approach**

- **Found during:** Task 3 GREEN — first canary smoke test run, multi-canary case
- **Issue:** The planner's pattern in 01-RESEARCH.md §Code Examples §Redaction (lines 977-979) was:
  ```typescript
  function redactPayload(payload) {
    return JSON.parse(redactString(JSON.stringify(payload)));
  }
  ```
  This approach fails on the multi-canary test case because `JSON.stringify` escapes whitespace and quote characters: a real `\n` becomes the 2-char sequence `\\n` in the stringified blob. Upstream gitleaks rules anchor on the LITERAL newline character (e.g., `[...|\n|...]` in `stripe-access-token`), so the JSON-escaped form never matches and the secret slips through.
- **Manifestation:** In a payload like `prompt_text: "Secret #8: sk_live_TEST1234567890abcdefghijklmnopqrstuvwx\nSecret #9: ..."`, the stripe-access-token rule expects `sk_live_..._<token>\n` with a literal LF — but `JSON.stringify` converts the LF to `\\n`, breaking the trailing-context anchor. The stripe secret was visible in the redacted blob (not redacted).
- **Fix:** Replaced `redactPayload` with a recursive tree walker (`walkRedact`) that runs `redactString` on each STRING value found in the payload tree — primitive numbers/booleans pass through; objects + arrays recurse. The redactor now operates on the developer-typed characters (real LF, real `"`, etc.) and upstream rules fire correctly.
- **Files modified:** `daemon/src/redact/redactor.ts` (no other files)
- **Verification:** All 10 canaries (individually + simultaneously) redacted; `canary.test.ts` "redacts a payload containing ALL 10 canaries at once" passes
- **Committed in:** Task 3 GREEN (`fd2b65d`)

**2. [Rule 2 — auto-add critical functionality] 4 fennec-supplemental gitleaks rules**

- **Found during:** Task 3 GREEN — initial canary smoke test
- **Issue:** The upstream gitleaks v8.21.0 default ruleset has no `anthropic-api-key` rule (newer upstream releases add it; the pinned v8.21.0 doesn't). Without it, the canary `sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` would not redact — failing PRIV-01.
  Additionally, the upstream `private-key` rule requires both the BEGIN header AND a closing `-----...KEY-----` block; the canary fixture contains only the BEGIN header. The upstream `gcp-api-key` rule expects exactly 35 chars after `AIza`; the canary fixture has 38 chars.
- **Fix:** Layer 4 supplemental rules on top of upstream in `daemon/src/redact/gitleaks-rules.ts`:
  - `fennec-anthropic-api-key`: `sk-ant-(?:api|admin)\d+-[A-Za-z0-9_-]{20,}`
  - `fennec-bearer-token`: `\bBearer\s+[A-Za-z0-9._~+/=-]{20,}` (catches non-JWT Bearer secrets)
  - `fennec-private-key-header`: `-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----` (catches bare PEM header in isolation)
  - `fennec-gcp-api-key-relaxed`: `AIza[\w-]{30,}` (relaxes upstream's exact-35 constraint)
- **Why this is Rule 2 (not Rule 4):** PRIV-01 is a load-bearing trust-posture requirement — failure to redact any canary fails the phase. Adding these supplemental rules is correctness, not feature scope. Each is tagged with a `fennec-` prefix in the rule ID so the [REDACTED:<id>] marker identifies the supplementation in audit trails. The decision is reversible without breaking the contract.
- **Files modified:** `daemon/src/redact/gitleaks-rules.ts`
- **Verification:** All 10 canaries redact (individually + simultaneously); `canary.test.ts` passes
- **Committed in:** Task 3 GREEN (`fd2b65d`)

**3. [Rule 3 — auto-fix blocking issue] Build pipeline must copy non-TS assets into dist/**

- **Found during:** Task 3 GREEN — first runtime test of the compiled JS in `dist/`
- **Issue:** `tsc --build` only emits `.js`/`.d.ts`/`.map`. The redactor's `gitleaks-rules.ts` reads `gitleaks-rules.json` via `readFileSync` at module load — but the JSON was not copied to `dist/redact/`, so the production build would throw `ENOENT` on load.
- **Fix:** Added `daemon/scripts/copy-assets.mjs` (one-time post-tsc step that copies `.toml`/`.json`/`.sha` into `dist/redact/`) and updated `daemon/package.json` `build` script to chain it: `tsc --build && node scripts/copy-assets.mjs`.
- **Why Rule 3 (blocking):** Without this, Plan 01-09's LaunchDaemon plist would point at a JS bundle that crashes on import. The fix is mechanical and contained.
- **Files modified:** `daemon/package.json`, `daemon/scripts/copy-assets.mjs` (created)
- **Verification:** `npm -w @fennec/daemon run build` succeeds; `ls daemon/dist/redact/` shows the 3 asset files alongside compiled JS
- **Committed in:** Task 3 GREEN (`fd2b65d`)

**4. [Rule 3 — auto-fix blocking issue] vi.fn typing for strict noUncheckedIndexedAccess**

- **Found during:** Task 3 GREEN — `npm run typecheck` after writing test files
- **Issue:** The base tsconfig has `noUncheckedIndexedAccess: true`. Default `vi.fn(async () => ...)` infers `mock.calls[i]` as `[] | undefined`, so `mock.calls[0]?.[1]` returns `undefined`. The tests had `as [string, RequestInit]` casts that strict mode refused to accept.
- **Fix:** Switched to `vi.fn<typeof fetch>(...)` so the mock carries the fetch signature; added explicit `if (!call) throw` guards before indexing into `.calls`. Restructured loop.test.ts with `getCallInit(i)` / `getCallUrl(i)` helpers that throw on missing calls — keeps the test bodies readable.
- **Why Rule 3:** TypeScript build was failing, blocking the rest of Task 3 verification.
- **Files modified:** `daemon/src/heartbeat/heartbeat.test.ts`, `daemon/src/sync/loop.test.ts`
- **Verification:** `npm run typecheck` clean; tests still pass
- **Committed in:** Task 3 GREEN (`fd2b65d`)

**5. [Rule 3 — blocking issue] undici dependency policy**

- **Found during:** Task 3 GREEN — drafting `proxy.ts`
- **Issue:** Initial draft used `import { ProxyAgent } from "undici"` at module top. `undici` is not in `daemon/package.json` (would violate threat T-06-SC — no new daemon npm installs). It IS available as a workspace-hoisted transitive via `wrangler` in backend, but relying on hoisting is fragile.
- **Fix:** Switched to dynamic `import("undici")` inside `buildFetchOptions`. If undici is unavailable for any reason (future workspace dedupe, etc.), the function logs a warning and returns `{}` — daemon falls back to direct fetch (will fail to reach backend through corp proxy, but won't crash; surfaces in `daemon_unreachable_count`). Fail-open per Pitfall 13.
- **Files modified:** `daemon/src/sync/proxy.ts`
- **Verification:** `daemon/package.json` has no new dep; `npm run typecheck` clean; `buildFetchOptions` test confirms dispatcher constructs when `HTTPS_PROXY` is set
- **Committed in:** Task 3 GREEN (`fd2b65d`)

**6. [Auto-format] Biome lint:fix during multiple commits**

- **Found during:** Tasks 2 + 3 GREEN — pre-commit hook fired `biome check --write`
- **Issue:** None functional; biome reformatted imports (combined named-import groups, sorted), collapsed long signatures, removed unnecessary regex escapes (`\-` → `-` inside character classes), and alphabetised `index.ts` exports.
- **Fix:** Auto-applied via `lint-staged` + biome.
- **Files modified:** Various daemon source + test files; net effect is stylistic only
- **Verification:** `npm run lint` clean; tests pass; no functional changes

---

**Total deviations:** 6
- 1 Rule 1 (bug — tree-walk redaction fixes JSON-escape blind spot)
- 1 Rule 2 (auto-add — 4 supplemental gitleaks rules for PRIV-01 canary coverage)
- 3 Rule 3 (blocking — build asset copy; strict-mode vi.fn typing; dynamic undici import to avoid new dep)
- 1 auto-format (biome lint:fix during pre-commit)

**Impact on plan:** None architectural. All decisions were either correctness fixes (Rule 1), critical-functionality additions inside the plan's scope (Rule 2 — PRIV-01 already required full canary coverage), or workflow fixes (Rule 3 — strict-mode typing, build asset routing, dep-policy compliance). The plan's `interfaces` block and acceptance criteria match what shipped.

## Known Stubs

| File | Why it's a stub | Resolved by |
| ---- | --------------- | ----------- |
| (none) | — | — |

This plan introduced no stubs. Every module promised in the plan is live and tested.

The placeholder `daemon/src/index.ts` `PLACEHOLDER_VERSION` export from Plan 01-01 has been replaced with the full public API barrel exporting every Plan 01-06 module (AdapterRegistry, buildCanonicalEvent, appendEvent, redactEvent, SyncLoop, HeartbeatScheduler, computeSchemaHash, etc.).

## Threat Flags

| Flag | File | Description |
| ---- | ---- | ----------- |
| (none) | — | All security-relevant surface added (redactor, sync loop, heartbeat emitter, proxy handling) was in the plan's `<threat_model>` register. No NEW surface beyond what Plan 01-06 specified. The supplemental gitleaks rules (Rule 2 deviation) extend an existing surface — PRIV-01's secret-redaction — and operate inside the same threat boundary (T-06-01). |

## TDD Gate Compliance

Both autonomous tasks followed RED → GREEN with separate commits:

- **Task 2 RED:** `467c82d` — `test(01-06): RED: add failing tests for adapter + canonical + JSONL queue + watermark + rotation` (6 test files fail; source modules missing)
- **Task 2 GREEN:** `48e8a84` — `feat(01-06): GREEN: adapter registry + canonical normalisation + JSONL queue + watermark + rotation` (22 tests pass)
- **Task 3 RED:** `09b46af` — `test(01-06): RED: add failing tests for redactor + canaries + sync loop + heartbeat + schema-hash + proxy` (6 more test files fail)
- **Task 3 GREEN:** `fd2b65d` — `feat(01-06): GREEN: gitleaks redactor (W-4 SHA pin) + sync loop + heartbeat + schema-hash + proxy` (all 60 tests pass)

REFACTOR step not needed — the GREEN commits ship clean code (biome lint-staged in pre-commit). No fail-fast violations: every RED commit's tests genuinely failed because the implementation didn't exist.

## Issues Encountered

- The tree-walk vs. stringify-redact-parse blind spot was a genuine pattern issue in the planner's research; documented as Deviation #1 above so future plans don't repeat it.
- The 4 fennec-supplemental rules were necessary to meet PRIV-01 against the Wave 0 canary fixture; documented so future ruleset updates know which patterns came from where.
- The strict TypeScript indexing rules required explicit `if (!call) throw` guards in tests; not architectural but worth knowing for future test patterns.

## Deferred Items

| Item | Rationale | Picked up by |
| ---- | --------- | ------------ |
| Phase 2 cost worker formula calibration (A2 resolution) | Recorded in 01-RESEARCH.md row A2 as deferred-to-Phase-2 option (c) per user decision. Phase 1 captures verbatim; Phase 2 will run the empirical calibration. | Phase 2 cost worker |
| Stronger schema-hash drift detection (type-aware, not just key-set) | Open Question 3 option (a) is sufficient for Phase 1's wire format. Type-aware drift detection (option b) is a Phase 2 enhancement if the dashboard surfaces false-positive offline states. | Phase 4 dashboard |
| Disk-full detection beyond rotation | Pitfall 4 / threat T-06-04 mitigated at the 100MB-per-file rotation level. Beyond that (e.g., refusing to write when /var is at 99%), Phase 5 doctor scope. | Phase 5 doctor checks |
| Loopback IPC bridge (shim ↔ daemon) | Pattern 9 in 01-RESEARCH.md — needed by Plan 01-07's Claude Code adapter, not by this plan's pipeline. | Plan 01-07 |
| api_key file reader at /var/db/fennec/key | apiKeyProvider is exposed as a callback in SyncLoop + HeartbeatScheduler; Plan 01-08 implements the file reader + mode 0400 check (Pitfall 10). | Plan 01-08 |
| Daemon process entry-point CLI (`fennec` binary, LaunchDaemon plist, startup wiring) | Plan 01-06 builds the modules; Plan 01-09 ships the integration: signed `.pkg` + LaunchDaemon plist + postinstall script. | Plan 01-09 |
| `playwright@1.49.1` SSL vulnerability (carried from Plan 01-01) | Out of scope for this plan; deferred since Plan 01-02. | Plan 01-10 or Phase 5 |

## Next Plan Readiness

Plan 01-06 is fully released. The next plan in the wave sequence (01-07 — Claude Code hook adapter) can:

- `import { AdapterRegistry, Adapter, Emit } from "@fennec/daemon"` to register itself
- `import { ClaudeCodePromptPayloadSchema, AnthropicUsageSchema } from "@fennec/shared"` to validate hook payloads
- Rely on the registry's emit chain to redact + queue + sync without touching those subsystems
- Test the adapter against a mock registry's `getCountersSnapshot()` to confirm events_parsed ticks correctly
- Assert verbatim 4-token capture from the hook payload (A2 option c — no math invariant, just field-presence + non-negative ints)

Plan 01-08 (daemon identity + enrollment) can:
- Implement the `apiKeyProvider: () => Promise<string | null>` callback the SyncLoop + HeartbeatScheduler expect
- Read `/var/db/fennec/key` with mode-0400 + uid-0 verification (Pitfall 10)
- The enroll-then-attach state machine wires into the existing Bearer plumbing without touching sync/heartbeat code

Plan 01-09 (signed .pkg + LaunchDaemon plist) can:
- Use the `daemon/dist/` build output (compiled JS + copied gitleaks assets) as the .pkg payload
- Write the LaunchDaemon plist that boots `node /usr/local/fennec/lib/daemon/index.js` — the `index.ts` barrel exports `loadEnv()` + the public classes needed for a `startDaemon()` orchestrator

Plan 01-10 (Phase 1 smoke test) can:
- Drive a real Claude Code prompt through the daemon → backend pipeline
- Assert the 4 Anthropic Usage fields land in `ai_events.payload.usage` verbatim (loosest invariant: present + non-negative, no math)
- Verify `redaction_version_hash` on the stored row matches the daemon's pinned ruleset version

Nothing in Plan 01-06 blocks the rest of Phase 1.

## Self-Check

- `daemon/src/adapters/adapter.ts`: FOUND
- `daemon/src/adapters/registry.ts`: FOUND
- `daemon/src/env.ts`: FOUND
- `daemon/src/heartbeat/heartbeat.ts`: FOUND
- `daemon/src/heartbeat/schema-hash.ts`: FOUND
- `daemon/src/normalize/canonical.ts`: FOUND
- `daemon/src/queue/jsonl.ts`: FOUND
- `daemon/src/queue/rotation.ts`: FOUND
- `daemon/src/queue/watermark.ts`: FOUND
- `daemon/src/redact/canary-test.ts`: FOUND
- `daemon/src/redact/gitleaks-rules.json`: FOUND
- `daemon/src/redact/gitleaks-rules.sha`: FOUND (SHA `1a1944db563ed277a5091b73559f4b244fae110557e189da5a5e367c607b7f4e`)
- `daemon/src/redact/gitleaks-rules.toml`: FOUND
- `daemon/src/redact/gitleaks-rules.ts`: FOUND
- `daemon/src/redact/redactor.ts`: FOUND
- `daemon/src/sync/backoff.ts`: FOUND
- `daemon/src/sync/batch.ts`: FOUND
- `daemon/src/sync/loop.ts`: FOUND
- `daemon/src/sync/proxy.ts`: FOUND
- `daemon/scripts/build-gitleaks-rules.mjs`: FOUND
- `daemon/scripts/copy-assets.mjs`: FOUND
- `daemon/src/adapters/registry.test.ts`: FOUND (4 tests, all pass)
- `daemon/src/heartbeat/heartbeat.test.ts`: FOUND (5 tests, all pass)
- `daemon/src/heartbeat/schema-hash.test.ts`: FOUND (6 tests, all pass)
- `daemon/src/normalize/canonical.test.ts`: FOUND (5 tests, all pass)
- `daemon/src/queue/crash-safe.test.ts`: FOUND (1 test, passes)
- `daemon/src/queue/jsonl.test.ts`: FOUND (5 tests, all pass)
- `daemon/src/queue/rotation.test.ts`: FOUND (4 tests, all pass)
- `daemon/src/queue/watermark.test.ts`: FOUND (4 tests, all pass)
- `daemon/src/redact/canary.test.ts`: FOUND (5 tests, all pass — PRIV-01 load-bearing)
- `daemon/src/redact/redactor.test.ts`: FOUND (6 tests, all pass)
- `daemon/src/sync/loop.test.ts`: FOUND (6 tests, all pass)
- `daemon/src/sync/proxy.test.ts`: FOUND (9 tests, all pass)
- `.planning/phases/01-foundations/01-RESEARCH.md`: row A2 updated to RESOLVED — deferred-to-Phase-2
- Commit `4540aaf` (Task 1 A2 docs): FOUND
- Commit `467c82d` (Task 2 RED): FOUND
- Commit `48e8a84` (Task 2 GREEN): FOUND
- Commit `09b46af` (Task 3 RED): FOUND
- Commit `fd2b65d` (Task 3 GREEN): FOUND
- `npm -w @fennec/daemon run test`: 60/60 pass across 12 files
- `npm -w @fennec/daemon run build`: clean (includes copy-assets.mjs post-step)
- `npm run typecheck`: clean (all workspaces)
- `npm run lint`: clean (95 files, biome 2.4.16)
- PRIV-01 canary smoke: all 10 canaries from `tests/canary-secrets.txt` redacted before reaching the queue boundary

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31*
