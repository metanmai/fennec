---
phase: 01-foundations
plan: 02
subsystem: shared

tags:
  - zod-4.4.3
  - web-crypto
  - canonical-event-schema
  - idempotency-key
  - pkce-rfc-7636
  - mdm-enrollment
  - tdd-red-green
  - workers-neutral

# Dependency graph
requires:
  - 01-01 (npm workspaces + tsc project references + vitest + biome)
provides:
  - "@fennec/shared CanonicalEventSchema (Zod) + CanonicalEvent (TS type)"
  - "EventBatchSchema enforcing min(1)/max(500)"
  - "ClaudeCodePromptPayloadSchema with all 4 Anthropic Usage fields SEPARATE (ANL-06)"
  - "AdapterHeartbeatSchema requiring events_parsed/parse_errors even at zero (CAP-14 / PITFALL P3)"
  - "EventKindSchema (7 kinds)"
  - "deriveIdempotencyKey(input) → 32-char hex via Web Crypto (CAP-13 / PITFALL P5)"
  - "EnrollRequestSchema (install_secret min 32) + EnrollResponseSchema (AUTH-14)"
  - "AttachCallbackRequestSchema (code_verifier 43-128 chars per RFC 7636) + AttachCallbackResponseSchema (AUTH-16)"
  - "UninstallReasonSchema (3-value enum) + UninstallAuditEventSchema (DAE-19)"
affects:
  - 01-03 (daemon adapter registry — imports CanonicalEventSchema, ClaudeCodePromptPayloadSchema, deriveIdempotencyKey)
  - 01-04 (Supabase schema — column types align with payload shape; idempotency_key TEXT NOT NULL PRIMARY KEY)
  - 01-05 (backend Hono — imports EventBatchSchema, EnrollRequestSchema, AttachCallbackRequestSchema for zValidator middleware)
  - 01-06 (JSONL queue + sync loop — persists CanonicalEvent objects with pre-derived idempotency_key)
  - 01-07 (Claude Code adapter — emits ClaudeCodePromptPayload-shaped payload via CanonicalEvent envelope)
  - 01-09 (MDM packaging — install_secret + machine_id contract aligns with EnrollRequest)

# Tech tracking
tech-stack:
  added:
    - "zod@4.4.3 (production dependency of @fennec/shared; deduped at root)"
  patterns:
    - "Runtime-neutral shared package: zod-only imports + Web Crypto API; no node:* imports so Workers can consume without polyfills"
    - "Async Web Crypto sha256 derivation (crypto.subtle.digest) shared between Node 22 daemon and Cloudflare Workers backend"
    - "Discriminated-by-tool envelope + per-tool payload Zod schema (Pattern 1 / Pattern 2 in 01-RESEARCH.md); resists the 'top-level claude_code_*' anti-pattern"
    - "schema_version is z.literal(1) — bumping the literal is the formal versioning mechanism for breaking wire-format changes"
    - "Required-not-optional CAP-14 heartbeat counters (events_parsed, parse_errors) so zero is a meaningful 'I'm alive' signal vs missing-field bug"
    - "All four Anthropic Usage fields captured VERBATIM and SEPARATE per ANL-06 / T-02-03 / PITFALL P6 — cost computation deferred to Phase 2"
    - "TDD RED → GREEN cadence with per-task test/feat commit pair; husky pre-commit (lint-staged biome) fires on every commit"

key-files:
  created:
    - packages/shared/src/events/kinds.ts
    - packages/shared/src/events/canonical.ts
    - packages/shared/src/events/claude-code-payload.ts
    - packages/shared/src/events/heartbeat.ts
    - packages/shared/src/events/idempotency.ts
    - packages/shared/src/auth/enrollment.ts
    - packages/shared/src/auth/attach.ts
    - packages/shared/src/auth/uninstall.ts
    - packages/shared/src/events/canonical.test.ts
    - packages/shared/src/events/heartbeat.test.ts
    - packages/shared/src/events/idempotency.test.ts
    - packages/shared/src/auth/auth.test.ts
  modified:
    - packages/shared/package.json
    - packages/shared/src/index.ts
    - package-lock.json

key-decisions:
  - "deriveIdempotencyKey uses Web Crypto (crypto.subtle.digest) NOT node:crypto, so @fennec/shared stays runtime-neutral and the Cloudflare Workers backend can re-import the same function for synthetic events. Hash input is sha256 of 'hostname|tool|session_id|hook_event|monotonic_seq', hex-encoded, sliced to 32 chars (128 bits)."
  - "Cache tokens captured as 4 SEPARATE optional non-negative ints in AnthropicUsageSchema (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens). Never aggregated at capture. This is the verbatim ANL-06 / T-02-03 / PITFALL P6 mitigation — Assumption A2 (Anthropic vs OTel total semantics) remains deferred to Plan 01-06's daemon redaction-wires checkpoint."
  - "CanonicalEventSchema intentionally OMITS org_id and user_id. The backend stamps them from the api_key lookup (Pattern 11). Threat T-02-01 mitigation — clients cannot forge tenancy."
  - "AdapterHeartbeatSchema.events_parsed and parse_errors are REQUIRED (z.number().int().nonnegative()), not optional. Zero is a meaningful 'I'm alive' signal; missing-field would be a daemon bug."
  - "schema_version is z.literal(1) (the value 1, not '1') on every schema. Bumping the literal is the breaking-change versioning mechanism — coordinated with field additions to EventKindSchema, ToolSchema, and ClaudeCodeHookEventSchema."
  - "PKCE verifier enforced 43-128 chars per RFC 7636 §4.1. Shorter values weaken PKCE; longer values are uninteroperable. Caught via Zod min().max() on AttachCallbackRequestSchema.code_verifier."
  - "Real RFC 4122 v4 UUIDs used in test fixtures (f47ac10b-58cc-4372-a567-..., 550e8400-e29b-41d4-a716-...). Zod 4's z.string().uuid() enforces RFC 4122 strictly (version digit 1-8 and variant 8/9/a/b) — placeholder-style UUIDs (111...-222..., 000...-111...) are rejected. This is correct backend behaviour."

patterns-established:
  - "TDD RED → GREEN per-task: separate `test(plan-id): add failing tests for X` commit BEFORE `feat(plan-id): implement X`. RED commit body documents what the schema should do; GREEN commit body documents what was built + any deviation fixes."
  - "Test helpers live IN the test file (buildEvent, buildHeartbeat factories) — keeps cases concise without adding a separate fixtures module."

requirements-completed:
  - CAP-10
  - CAP-13
  - ANL-06

# Metrics
duration: ~33 min
completed: 2026-05-31
---

# Phase 1 Plan 02: Canonical event schema in @fennec/shared

**Zod-validated, runtime-neutral wire-format contract** between the macOS daemon and the Cloudflare Workers backend. Eight schemas + one async key-derivation function shipped from a single Workers-safe package. 49 unit tests, all passing.

## Performance

- **Duration:** ~33 min
- **Started:** 2026-05-31T05:13:00Z (approx)
- **Completed:** 2026-05-31T05:50:30Z
- **Tasks:** 2 (both auto + tdd)
- **Commits:** 4 (one test + one feat per task, RED→GREEN order)

## Accomplishments

- `@fennec/shared` now exports the full canonical-event surface and the daemon-enrollment / dev-attach / uninstall request schemas
- All four Anthropic Usage fields preserved as SEPARATE optional non-negative ints in `ClaudeCodePromptPayloadSchema.usage` (ANL-06 / T-02-03 mitigation locked in)
- `deriveIdempotencyKey` is async + Web Crypto-only (CAP-13 / PITFALL P5) so Workers can re-use the same function later
- `EventBatchSchema` enforces `min(1).max(500)` per the sync-loop batch contract
- `AdapterHeartbeatSchema` makes `events_parsed`/`parse_errors` required at-zero — the missing-field-bug case is rejected at parse-time (CAP-14 / PITFALL P3)
- `EnrollRequestSchema.install_secret.min(32)` enforces brute-force entropy floor (AUTH-14 / T-02-04)
- `AttachCallbackRequestSchema.code_verifier.min(43).max(128)` matches RFC 7636 §4.1 PKCE bounds (AUTH-16)
- `UninstallAuditEventSchema` carries the three valid reasons per D-18/D-19/DAE-19
- 49 vitest tests covering happy paths, boundary cases, and rejection paths
- Downstream typecheck (`npm run typecheck`) clean — daemon + backend workspaces resolve the new exports
- Final barrel `packages/shared/src/index.ts` alphabetised by biome organizeImports

## Task Commits

| # | Phase | Hash | Subject |
|---|-------|------|---------|
| 1 | Task 1 RED | `631410c` | test(01-02): add failing tests for canonical event + payload + heartbeat schemas |
| 2 | Task 1 GREEN | `ac3bf07` | feat(01-02): implement canonical event + payload + heartbeat schemas |
| 3 | Task 2 RED | `a43f038` | test(01-02): add failing tests for idempotency derivation + auth schemas |
| 4 | Task 2 GREEN | `ff07f95` | feat(01-02): implement deriveIdempotencyKey + auth schemas |

Plan-metadata commit follows this SUMMARY.

## Files Created / Modified

### `packages/shared/src/events/`

- `kinds.ts` — `EventKindSchema` (7 kinds) + `EventKind` type
- `canonical.ts` — `ToolSchema` (8 tools), `OsSchema`, `CanonicalEventSchema`, `EventBatchSchema`, + inferred TS types
- `claude-code-payload.ts` — `ClaudeCodeHookEventSchema` (6 hooks per D-22), `AnthropicUsageSchema` (4 SEPARATE token fields per ANL-06), `ClaudeCodePromptPayloadSchema`
- `heartbeat.ts` — `AdapterHeartbeatSchema` + `AdapterHeartbeat` type
- `idempotency.ts` — async `deriveIdempotencyKey(input)` via Web Crypto + `IdempotencyKeyInput` type

### `packages/shared/src/auth/`

- `enrollment.ts` — `EnrollRequestSchema` (`install_secret.min(32)`) + `EnrollResponseSchema`
- `attach.ts` — `AttachCallbackRequestSchema` (`code_verifier.min(43).max(128)`) + `AttachCallbackResponseSchema`
- `uninstall.ts` — `UninstallReasonSchema` + `UninstallAuditEventSchema`

### `packages/shared/src/`

- `index.ts` — barrel re-exporting all 8 modules (alphabetised by biome)

### Tests (all colocated next to source)

- `events/canonical.test.ts` — 12 cases (CanonicalEventSchema + EventBatchSchema + ClaudeCodePromptPayloadSchema)
- `events/heartbeat.test.ts` — 7 cases (AdapterHeartbeatSchema)
- `events/idempotency.test.ts` — 8 cases (deriveIdempotencyKey stability + sensitivity + collision check)
- `auth/auth.test.ts` — 22 cases (enroll + attach + uninstall schemas)

### `packages/shared/`

- `package.json` — added `dependencies.zod@4.4.3`; added `test:watch` script
- `package-lock.json` (root) — zod transitive resolution

## Decisions Made

(Mirrored in the frontmatter `key-decisions` block for STATE.md ingestion.)

1. **Web Crypto over node:crypto for `deriveIdempotencyKey`.** Makes `@fennec/shared` runtime-neutral — the Cloudflare Workers backend (Plan 01-05) can re-import the function for synthetic events without polyfills. Slight cost: async function signature; trivially worth it.
2. **Four separate cache token fields (ANL-06 / T-02-03 / PITFALL P6).** All four Anthropic Usage fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) are SEPARATE optional non-negative ints. The daemon never aggregates. Assumption A2 (Anthropic-docs-says vs OTel-spec-says about whether `input_tokens` already includes cache tokens) is intentionally deferred to Plan 01-06's `checkpoint:human-verify` — Phase 1 captures verbatim, Phase 2 computes totals.
3. **`org_id` / `user_id` OMITTED from CanonicalEventSchema.** Threat T-02-01 — backend stamps tenancy from the api_key lookup (Pattern 11). A daemon cannot forge org membership.
4. **`schema_version = z.literal(1)` across every schema.** Bumping the literal is the formal versioning mechanism. `1` (number) chosen over `"1"` (string) per RESEARCH.md interfaces; the planner left forward-compat phrasing to the executor — number is simpler and the literal type carries the same forward-compat property (any future bump requires a deliberate code change at the schema definition site).
5. **`events_parsed` and `parse_errors` REQUIRED on heartbeat.** Zero is the meaningful "I'm alive with no traffic" signal (CAP-14 / PITFALL P3). Missing-field is a bug, not a valid state.
6. **PKCE verifier 43-128 chars per RFC 7636 §4.1.** Hard bounds enforced via `.min(43).max(128)`.
7. **Real RFC 4122 v4 UUIDs in test fixtures.** Zod 4 ships strict UUID validation (version digit 1-8 + variant 8/9/a/b). The first-draft fixtures used placeholder-style UUIDs that the strict validator (correctly) rejects.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug] Test-fixture UUIDs failed Zod 4's strict RFC 4122 validator**

- **Found during:** Task 2 GREEN (initial `npm -w @fennec/shared run test` after writing source modules)
- **Issue:** The first-draft test fixtures used placeholder-style UUIDs (`11111111-2222-3333-4444-555555555555`, `00000000-1111-2222-3333-444444444444`). Zod 4's `z.string().uuid()` strictly enforces RFC 4122: third segment must start with `1-8` (UUID version) and the fourth with `8/9/a/b` (variant bits). Both happy-path tests (`EnrollResponseSchema > validates a well-formed response`, `AttachCallbackResponseSchema > validates a well-formed response`) failed.
- **Fix:** Replaced fixtures with real RFC 4122 v4 UUIDs (`f47ac10b-58cc-4372-a567-0e02b2c3d479` and `550e8400-e29b-41d4-a716-446655440000`). The `"rejects malformed UUIDs"` negative test still works correctly because it substitutes `api_key_id: "not-a-uuid"`.
- **Files modified:** `packages/shared/src/auth/auth.test.ts`
- **Verification:** `npm -w @fennec/shared run test` → 49/49 passing
- **Committed in:** `ff07f95` (rolled into Task 2 GREEN commit; schema source files were not modified — the bug was strictly in the test fixtures)
- **Rationale for not switching the schema:** The schema is correct as written (the plan explicitly calls for `.uuid()` on these fields). Loosening the validator to accept placeholder UUIDs would defeat the purpose at backend ingest, where forged or malformed UUIDs are a real attack surface. The test fixtures had to align with the validator — not the other way around.

**2. [Auto-format] Biome `organizeImports` alphabetised barrel exports**

- **Found during:** Task 1 GREEN (`npm run lint` after writing initial `index.ts`)
- **Issue:** The initial export order in `packages/shared/src/index.ts` matched the order they were authored (`kinds → canonical → claude-code-payload → heartbeat`). Biome's `assist.actions.source.organizeImports` rule alphabetises export statements identically to imports.
- **Fix:** `npm run lint:fix` reordered exports alphabetically. Re-applied for Task 2 when adding the auth/* modules.
- **Files modified:** `packages/shared/src/index.ts`
- **Verification:** Subsequent `npm run lint` exits 0; downstream import smoke test confirms all 12 named exports still resolve.
- **Committed in:** Final state in `ff07f95`

---

**Total deviations:** 2 auto-fixed
- 1 Rule 1 (test-fixture bug; schema unchanged)
- 1 auto-format from `lint:fix`

**Impact on plan:** None of these were architectural or scope-changing. The schemas match the plan's interfaces block verbatim. No additional surface added beyond what was specified.

## Known Stubs

| File | Why it's a stub | Resolved by |
|---|---|---|
| (none) | — | — |

This plan introduced no stubs. `packages/shared/src/index.ts`'s previous `PLACEHOLDER_VERSION` from Plan 01-01 has been replaced with the real barrel. Every type / schema this plan promised is live and tested.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| (none) | — | All security-relevant surface added (`EnrollRequestSchema`, `AttachCallbackRequestSchema`, `UninstallAuditEventSchema`, `deriveIdempotencyKey`) was in the plan's `<threat_model>` register; no NEW surface was introduced beyond what Plan 01-02 specified. |

## TDD Gate Compliance

Both tasks followed the RED → GREEN cycle with separate commits:

- **Task 1 RED:** `631410c` — `test(01-02): add failing tests for canonical event + payload + heartbeat schemas` (tests fail because modules missing)
- **Task 1 GREEN:** `ac3bf07` — `feat(01-02): implement canonical event + payload + heartbeat schemas` (20/20 pass)
- **Task 2 RED:** `a43f038` — `test(01-02): add failing tests for idempotency derivation + auth schemas` (2 test files fail; the 20 from Task 1 continue to pass)
- **Task 2 GREEN:** `ff07f95` — `feat(01-02): implement deriveIdempotencyKey + auth schemas` (49/49 pass)

REFACTOR step not needed — the GREEN commits already shipped clean code (biome lint-staged in pre-commit). No fail-fast violations: every RED commit's tests genuinely failed because the implementation didn't exist.

## Issues Encountered

- The placeholder-UUID test fixtures was the only surprise; otherwise the plan executed verbatim.
- The pre-commit lint-staged hook fired four times (once per commit) and reformatted nothing meaningful — biome was already happy with the initial output. No additional CI / verification work needed.
- `npm install` for zod ran clean despite the corporate proxy (zod has no problematic transitives). The 2-package additions (zod + an internal transitive) deduped at root.

## Deferred Items

| Item | Rationale | Picked up by |
|---|---|---|
| Assumption A2 cache-token semantics (whether `input_tokens` already includes cache tokens) | Per planner instruction, Phase 1 captures verbatim. The disagreement between Anthropic docs and OTel spec is resolved at cost-computation time. | Plan 01-06 `checkpoint:human-verify` (daemon redaction wires) + Phase 2 cost worker |
| `IdempotencyKeyInput.tool` is typed as `string` (not `Tool` from ToolSchema) | The function is meant to be callable from adapters that don't yet import the full canonical schema (e.g., the lightweight Claude Code shim's IPC layer). A future refactor could tighten the type to `Tool` once all callers are wired. | Plan 01-06 review |
| `playwright@1.49.1` SSL vulnerability (carried from Plan 01-01) | Out of scope for this plan; deferred to Phase 5 or Plan 01-10. | Plan 01-10 or Phase 5 |

## Next Plan Readiness

Plan 01-02 is fully released. The next plan in the wave sequence (01-03 — daemon adapter registry skeleton) can:

- `import { CanonicalEventSchema, deriveIdempotencyKey, ClaudeCodePromptPayloadSchema } from "@fennec/shared"` directly — the typecheck + dist build are already wired
- Rely on `npm run typecheck` failing red if any adapter emit drifts from the canonical shape
- Add adapter-specific Zod payload schemas under `daemon/src/normalize/` without touching `@fennec/shared` (the canonical envelope is closed; only per-tool payload validators add surface from here)

Plan 01-04 (Supabase schema) can align its `ai_events.payload` JSONB column types against `CanonicalEventSchema` + `ClaudeCodePromptPayloadSchema` from the shared package.

Plan 01-05 (backend Hono) can wire `zValidator("json", EventBatchSchema)` and `zValidator("json", EnrollRequestSchema)` from the same imports.

Nothing in Plan 01-02 blocks the rest of Phase 1.

## Self-Check

- `packages/shared/src/events/kinds.ts`: FOUND
- `packages/shared/src/events/canonical.ts`: FOUND
- `packages/shared/src/events/claude-code-payload.ts`: FOUND
- `packages/shared/src/events/heartbeat.ts`: FOUND
- `packages/shared/src/events/idempotency.ts`: FOUND
- `packages/shared/src/auth/enrollment.ts`: FOUND
- `packages/shared/src/auth/attach.ts`: FOUND
- `packages/shared/src/auth/uninstall.ts`: FOUND
- `packages/shared/src/events/canonical.test.ts`: FOUND
- `packages/shared/src/events/heartbeat.test.ts`: FOUND
- `packages/shared/src/events/idempotency.test.ts`: FOUND
- `packages/shared/src/auth/auth.test.ts`: FOUND
- `packages/shared/src/index.ts`: FOUND (re-exports all 8 modules)
- `packages/shared/package.json`: FOUND (`zod@4.4.3` in dependencies)
- Commit `631410c` (Task 1 RED): FOUND
- Commit `ac3bf07` (Task 1 GREEN): FOUND
- Commit `a43f038` (Task 2 RED): FOUND
- Commit `ff07f95` (Task 2 GREEN): FOUND
- `npm -w @fennec/shared run test`: 49/49 pass
- `npm -w @fennec/shared run build`: clean
- `npm run typecheck`: clean (all workspaces)
- `npm run lint`: clean (36 files, biome 2.4.16)
- Downstream import smoke test: all 12 named exports resolve from `@fennec/shared`

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31*
