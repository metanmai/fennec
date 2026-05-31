---
phase: 01-foundations
plan: 01
subsystem: infra

tags:
  - npm-workspaces
  - typescript-5.9
  - biome-2.4
  - vitest-4.1
  - playwright-1.49
  - husky-9
  - lint-staged-16
  - github-actions

# Dependency graph
requires: []
provides:
  - npm workspaces root with @fennec/shared, @fennec/daemon, @fennec/backend, @fennec/installer
  - TypeScript 5.9 strict baseline (tsconfig.base.json) + project references (root tsconfig.json)
  - Biome 2.4.16 lint + format at root (v2 schema with files.includes + assist.actions.source.organizeImports)
  - Vitest 4.1.7 workspace discovery across daemon / backend / packages/shared
  - Playwright 1.49.1 e2e config + tests/e2e/01-phase-1-smoke.spec.ts skeleton
  - tests/canary-secrets.txt (10 distinct secret patterns for PRIV-01 redaction tests)
  - .env.example covering every Phase 1 surface env var
  - Husky 9 pre-commit (lint-staged) + pre-push (lint + typecheck + test:unit)
  - lint-staged 16 config matching ts/tsx/js/jsx/json/md
  - GitHub Actions CI workflow gating PR + push-to-main on lint + typecheck + test:unit
affects:
  - 01-02 (canonical schema in @fennec/shared imports this workspace setup)
  - 01-03 (daemon adapter registry imports @fennec/shared via the workspace symlink)
  - 01-04 (Supabase migrations layered atop the same monorepo)
  - 01-05 (backend Hono on backend/ workspace; will install hono/zod-validator/zod here)
  - 01-06 (JSONL queue + sync loop in daemon/)
  - 01-07 (Claude Code adapter + hook shim build pipeline)
  - 01-08 (Apple notarisation + Windows EV cert procurement — installer/)
  - 01-09 (MDM packaging primitives — installer/macos)
  - 01-10 (Phase 1 smoke test fleshes out tests/e2e/01-phase-1-smoke.spec.ts)
  - All Phase 2..6 plans (every workspace inherits this baseline)

# Tech tracking
tech-stack:
  added:
    - typescript@5.9.3
    - "@biomejs/biome@2.4.16"
    - vitest@4.1.7
    - "@playwright/test@1.49.1"
    - husky@9.1.7
    - lint-staged@16.1.2
    - "@types/node@22.10.5"
    - wrangler@4.93.1 (pinned; see deviations)
  patterns:
    - "npm workspaces with cross-package refs as plain `*` (corp proxy blocks workspace: protocol)"
    - "TypeScript composite + project references; strict + noUncheckedIndexedAccess + verbatimModuleSyntax"
    - "Biome v2 schema (files.includes with negated globs; assist.actions.source.organizeImports)"
    - "Vitest workspace file + per-workspace configs; root config excludes tests/e2e to keep Playwright specs out of Vitest"
    - "test:unit passes --passWithNoTests so Wave 0 succeeds before any real tests land"

key-files:
  created:
    - package.json (root)
    - tsconfig.base.json
    - tsconfig.json
    - biome.json
    - .gitignore
    - .nvmrc
    - .env.example
    - .lintstagedrc.json
    - .husky/pre-commit
    - .husky/pre-push
    - .github/workflows/ci.yml
    - vitest.workspace.ts
    - vitest.config.ts
    - playwright.config.ts
    - tests/canary-secrets.txt
    - tests/e2e/01-phase-1-smoke.spec.ts
    - tests/e2e/.gitkeep
    - tests/manual/.gitkeep
    - daemon/package.json
    - daemon/tsconfig.json
    - daemon/vitest.config.ts
    - daemon/src/index.ts
    - backend/package.json
    - backend/tsconfig.json
    - backend/vitest.config.ts
    - backend/src/index.ts
    - backend/wrangler.jsonc
    - packages/shared/package.json
    - packages/shared/tsconfig.json
    - packages/shared/vitest.config.ts
    - packages/shared/src/index.ts
    - installer/package.json
    - installer/macos/.gitkeep
    - installer/windows/.gitkeep
  modified: []

key-decisions:
  - "Slopcheck unavailable; user approved all 14 packages via orchestrator AskUserQuestion (not automated verdict). Audit override recorded in commit messages."
  - "Wrangler pinned to 4.93.1 (wrangler>=4.94.0 pulls rosie-skills transitive which the corporate npm proxy 403s). Phase 5 follow-up to revisit wrangler version once self-host story freezes."
  - "Cross-workspace dependency uses plain `*` not `workspace:*` (corp proxy rejects the workspace: protocol; npm workspaces resolve plain `*` locally)."
  - "Biome migrated to v2.4.16 schema (files.includes + assist.actions.source.organizeImports) — v1 schema was rejected at runtime."
  - "test/test:unit npm scripts pass --passWithNoTests so Wave 0 / CI / pre-push hooks succeed before any real tests are written (real tests land in plan 01-02)."
  - "Root vitest.config.ts excludes tests/e2e + tests/manual so Vitest does not auto-pick up Playwright specs (which import @playwright/test, not vitest)."

patterns-established:
  - "Atomic-commit-per-task: chore(01-01) prefix; clear deviation log inside each commit body"
  - "Husky pre-commit = lint-staged only (fast feedback on staged files); pre-push = full lint+typecheck+test:unit gate (second line of defence per T-01-03)"
  - "CI mirrors pre-push exactly so the developer's machine == CI gate"
  - "Workspace placeholder src/index.ts exporting a single PLACEHOLDER_VERSION so tsc --build emits output and Vitest discovers the workspace without real code"

requirements-completed: []

# Metrics
duration: ~12 min
completed: 2026-05-31
---

# Phase 1 Plan 01: Wave 0 monorepo skeleton

**npm workspaces + strict TypeScript + Biome 2.4 + Vitest 4.1 + Playwright 1.49 + husky pre-commit/pre-push + GitHub Actions CI, all gates green, no business logic yet.**

## Performance

- **Duration:** ~12 min (excludes the slopcheck checkpoint wait)
- **Started:** 2026-05-31T05:18:00Z (approx)
- **Completed:** 2026-05-31T05:31:07Z
- **Tasks:** 4 (Task 1 = checkpoint, Tasks 2–4 = auto)
- **Files modified:** 33 net new + 4 generated (`package-lock.json`, three `.husky` internals — auto-ignored by husky's `_/.gitignore`)

## Accomplishments

- Four npm workspaces (`daemon/`, `backend/`, `packages/shared/`, `installer/`) link cleanly via plain `*` refs
- `tsc --build` compiles project references with strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
- `biome check .` clean across 24 files using v2.4.16 schema
- `vitest run --passWithNoTests` discovers all three TS workspaces, exits 0
- `playwright test --list` lists `01-phase-1-smoke.spec.ts` (skipped skeleton; real impl in plan 01-10)
- Pre-commit hook fires `lint-staged` (proven live on the Task 4 commit itself)
- Pre-push hook chains `npm run lint && npm run typecheck && npm run test:unit`
- GitHub Actions CI workflow mirrors the pre-push chain (Node 22, ubuntu-latest)
- 10-line `tests/canary-secrets.txt` ready for plan 01-04's redaction tests
- `.env.example` documents every env var the Phase 1 surfaces (daemon, backend, Apple signing, Windows EV vendor, three OAuth providers) require

## Task Commits

1. **Task 1: slopcheck gate** — *no commit*; resolved via user override (orchestrator AskUserQuestion response approving the 14-package audit). Override is noted in every Task-2 commit message.
2. **Task 2: workspace scaffold + install** — `b7a2f82` (chore)
3. **Task 3: vitest workspaces + playwright + canary fixtures + .env.example** — `9491b24` (chore)
4. **Task 4: husky pre-commit/pre-push + lint-staged + CI** — `ac5c2cd` (chore)

**Plan metadata commit:** *to follow this SUMMARY*

## Files Created/Modified

### Root

- `package.json` — workspaces array, scripts (lint/typecheck/test/test:unit/test:e2e/format/build/clean/prepare), devDependencies pinned
- `tsconfig.base.json` — strict, composite, bundler resolution, ES2022 target
- `tsconfig.json` — project references → packages/shared, daemon, backend
- `biome.json` — v2.4.16 schema, lineWidth 120, double quotes, semicolons always, trailing commas all
- `.gitignore` — node_modules, dist, .wrangler, .env*, *.pkg/msi/deb/rpm, etc.
- `.nvmrc` — `22`
- `.env.example` — daemon transport (FENNEC_*), Supabase (URL + service-role + access-token + DB URL), Cloudflare (account ID + API token), Apple (team ID + notary profile), Windows EV vendor, three OAuth client IDs
- `.lintstagedrc.json` — biome check + format on staged TS/JS/JSON/MD
- `.husky/pre-commit` — `npx lint-staged` (chmod +x)
- `.husky/pre-push` — `npm run lint && npm run typecheck && npm run test:unit` (chmod +x)
- `.github/workflows/ci.yml` — PR + push-to-main; setup-node@v4 with Node 22 + npm cache; runs npm ci then lint+typecheck+test:unit
- `vitest.workspace.ts` — three-workspace tuple
- `vitest.config.ts` — coverage v8; exclude tests/e2e + tests/manual (keep playwright specs out)
- `playwright.config.ts` — chromium, 30s timeout, trace on retry, headless

### `packages/shared/`

- `package.json` (@fennec/shared, type=module, exports dist)
- `tsconfig.json` (extends base, outDir dist, no references)
- `vitest.config.ts` (node env)
- `src/index.ts` (PLACEHOLDER_VERSION constant)

### `daemon/`

- `package.json` (@fennec/daemon, depends on @fennec/shared via `*`)
- `tsconfig.json` (references packages/shared)
- `vitest.config.ts`
- `src/index.ts` (placeholder)

### `backend/`

- `package.json` (@fennec/backend, devDep wrangler@4.93.1, depends on @fennec/shared)
- `tsconfig.json` (references packages/shared)
- `vitest.config.ts` (node env; switches to @cloudflare/vitest-pool-workers in plan 01-05)
- `wrangler.jsonc` (skeleton with nodejs_compat; bindings land in plan 01-05)
- `src/index.ts` (placeholder)

### `installer/`

- `package.json` (@fennec/installer)
- `macos/.gitkeep`, `windows/.gitkeep` (so the dirs exist for plan 01-09)

### `tests/`

- `canary-secrets.txt` (10 distinct secret patterns)
- `e2e/01-phase-1-smoke.spec.ts` (skipped skeleton)
- `e2e/.gitkeep`, `manual/.gitkeep`

## Decisions Made

- Slopcheck unavailable at execution time. The 14-package audit was approved by the user via the orchestrator's AskUserQuestion mechanism on 2026-05-31. Audit table in 01-RESEARCH.md remains `[ASSUMED]`. Every Task 2 commit message acknowledges this is an override, not an automated slopcheck verdict.
- Pinned `wrangler@4.93.1` instead of the research-time `4.95.0`. Versions ≥4.94.0 declare `rosie-skills@^0.6.3` as a transitive; the corporate npm proxy (`pkgproxy-uat.coinswitch.co`) returns 403 for `rosie-skills`. User confirmed `rosie-skills` legitimacy was the cause but elected the pin as smallest-blast-radius. Phase 5 cross-platform polish revisits this.
- Cross-workspace dependency syntax: `"@fennec/shared": "*"` (not `"workspace:*"`). The corporate npm proxy returns `EUNSUPPORTEDPROTOCOL` on `workspace:`. npm workspaces resolve a plain `*` to the local workspace when the name matches a declared workspace. Functionally equivalent.
- `vitest@4.1.7`'s transitive `obug@2.1.1` confirmed legitimate per user (real fork of `debug` by `sxzz`, MIT). The executor's homoglyph-of-`debug` suspicion was over-cautious.
- Biome configured against the v2 schema explicitly — the planner-suggested v1 keys (`files.ignore`, top-level `organizeImports`) crashed Biome 2.4.16 at startup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 + corp-proxy] `workspace:*` protocol unsupported by corporate npm proxy**

- **Found during:** Task 2 (first `npm install` attempt)
- **Issue:** npm 11.12.1 → corporate registry `pkgproxy-uat.coinswitch.co` returns `EUNSUPPORTEDPROTOCOL` on `workspace:*` cross-workspace deps
- **Fix:** Switched `daemon/package.json` and `backend/package.json` `@fennec/shared` ref from `"workspace:*"` to `"*"`; npm workspaces resolve locally
- **Files modified:** `daemon/package.json`, `backend/package.json`
- **Verification:** `npm install` succeeded after the change
- **Committed in:** `b7a2f82`

**2. [Corp-proxy pin] wrangler 4.95.0 → 4.93.1**

- **Found during:** Task 2 (second `npm install` attempt)
- **Issue:** wrangler@4.94.0+ declares `rosie-skills@^0.6.3` as a transitive. Corporate proxy returns 403 on `rosie-skills`. After researching the manifest history with the user, the smallest-blast-radius fix was to pin wrangler to the last version that doesn't pull that transitive (4.93.1).
- **Fix:** `backend/package.json` `devDependencies.wrangler` pinned to `4.93.1`
- **Files modified:** `backend/package.json`
- **Verification:** `npm install` succeeded; tsc, biome, vitest, playwright all clean
- **Committed in:** `b7a2f82`
- **Follow-up:** Phase 5 (cross-platform polish) revisits wrangler version when self-host distribution story freezes.

**3. [Rule 3 - schema] biome.json v1 → v2.4.16 schema**

- **Found during:** Task 3 (`npm run lint` first invocation)
- **Issue:** Biome 2.4.16 rejected the planner-suggested v1 keys: `files.ignore` and top-level `organizeImports`
- **Fix:** Migrated to v2 schema — `files.includes` array with negated globs (`!**/node_modules`, `!**/dist`, etc.) without trailing `/**` (per the `useBiomeIgnoreFolder` lint rule introduced in 2.2.0), and `assist.actions.source.organizeImports: "on"` instead of the top-level block
- **Files modified:** `biome.json`
- **Verification:** `npm run lint` exits 0; 24 files checked clean
- **Committed in:** `9491b24`

**4. [Rule 3 - blocking] Root vitest.config.ts must exclude tests/e2e + tests/manual**

- **Found during:** Task 3 (`npx vitest run --passWithNoTests` first invocation)
- **Issue:** Vitest auto-discovers `*.spec.ts` files anywhere in the repo. `tests/e2e/01-phase-1-smoke.spec.ts` imports `test` from `@playwright/test`, which crashed Vitest's import.
- **Fix:** Added `exclude` array to root `vitest.config.ts`: `**/node_modules/**`, `**/dist/**`, `**/.wrangler/**`, `**/tests/e2e/**`, `**/tests/manual/**`
- **Files modified:** `vitest.config.ts`
- **Verification:** `npm run test:unit` exits 0 with "No test files found"
- **Committed in:** `9491b24`

**5. [Rule 1 - bug] test + test:unit scripts need `--passWithNoTests`**

- **Found during:** Task 3 (final verification chain before commit)
- **Issue:** Vitest exits 1 by default when zero test files match (current Wave 0 state). That would make the pre-push hook (Task 4) fail every commit until plan 01-02 lands real tests, and would block CI on the first PR.
- **Fix:** Both `test` and `test:unit` npm scripts now pass `--passWithNoTests`. The flag is non-harmful once tests exist (`vitest` still reports normally when tests are present).
- **Files modified:** `package.json`
- **Verification:** `npm run test:unit` exits 0
- **Committed in:** `9491b24`

**6. [Auto-format] Biome inline-collapsed array literals in tsconfigs / vitest.workspace.ts**

- **Found during:** Task 3 (`npm run lint:fix` after deviation 3)
- **Issue:** Biome's formatter collapsed multi-line `references` and `defineWorkspace` arrays into single lines because they fit under `lineWidth: 120`. Cosmetic only.
- **Fix:** Accepted the formatter output (re-running `lint:fix` is idempotent)
- **Files modified:** `backend/tsconfig.json`, `daemon/tsconfig.json`, `tsconfig.json`, `vitest.workspace.ts`, `vitest.config.ts`, `biome.json` (the formatter also touched its own file)
- **Verification:** Subsequent `npm run lint` exits 0
- **Committed in:** `9491b24`

---

**Total deviations:** 6 auto-fixed
- 1 Rule 1 (bug — passWithNoTests)
- 2 Rule 3 (blocking — biome v2 schema, vitest exclude)
- 2 corporate-proxy workarounds (`workspace:*` → `*`, wrangler 4.93.1 pin)
- 1 auto-format from `lint:fix`

**Impact on plan:** None of these were architectural. All necessary for the Wave 0 acceptance criteria to pass. No scope creep — no new functionality was added beyond what the plan specified.

## Known Stubs

| File | Why it's a stub | Resolved by |
|---|---|---|
| `daemon/src/index.ts` | exports only `PLACEHOLDER_VERSION` | plan 01-03 (daemon skeleton + adapter registry) |
| `backend/src/index.ts` | same | plan 01-05 (Hono routes) |
| `packages/shared/src/index.ts` | same | plan 01-02 (canonical event schema) |
| `backend/wrangler.jsonc` | no Hyperdrive / Queues / Analytics Engine bindings | plan 01-05 |
| `tests/e2e/01-phase-1-smoke.spec.ts` | `test.skip(...)` with empty body | plan 01-10 (Phase 1 smoke implementation) |

These stubs are intentional and load-bearing for `tsc --build` + `vitest discovery` + `playwright list` to succeed in Wave 0.

## Threat Flags

None — Plan 01-01 ships no network endpoints, no auth paths, no file access patterns at trust boundaries, and no schema. All surface lives in the dev tooling layer.

## Audit Trail (slopcheck override)

| When | Who | What |
|---|---|---|
| 2026-05-31 (research) | `/gsd:plan-phase` researcher | All 14 packages tagged `[ASSUMED]` in 01-RESEARCH.md §Package Legitimacy Audit because slopcheck was unavailable |
| 2026-05-31 (execute) | this executor | Verified `slopcheck` unreachable (`command not found`); HALTED at Task 1 checkpoint |
| 2026-05-31 (execute) | user via orchestrator AskUserQuestion | Explicit `approved` for all 14 packages after reviewing maintainers + source repos |
| 2026-05-31 (execute) | this executor | Surfaced suspect transitives `rosie-skills` (wrangler@4.95.0) and `obug` (vitest@4.1.7); HALTED again pending user verdict |
| 2026-05-31 (execute) | user via orchestrator AskUserQuestion | Confirmed `obug` legitimate (real `debug` fork by sxzz); chose wrangler pin to 4.93.1 to sidestep `rosie-skills` |
| 2026-05-31 (execute) | this executor | Proceeded with installs; commit messages acknowledge override |

## Issues Encountered

- The `gsd-sdk state.advance-plan` command originally failed because STATE.md said "Plan: 0 of TBD". Updated to "Plan: 1 of 10" before re-running; advance succeeded.
- npm audit reports 2 high severity vulnerabilities in `playwright<1.55.1` (SSL verification when downloading browsers, GHSA-7mvr-c777-76hp). Plan 01-01 pins `@playwright/test@1.49.1`. No browsers are downloaded in Wave 0 (we only invoke `playwright test --list`). Deferred to a follow-up (Phase 1 close or Phase 5) — upgrading mid-plan would risk unaudited transitives, conflicting with the slopcheck-conservative posture.

## Deferred Items

| Item | Rationale | Picked up by |
|---|---|---|
| Wrangler version revisit | Pinned to 4.93.1 to sidestep corp-proxy block; needs re-evaluation when self-host distribution decision lands | Phase 5 |
| Playwright SSL vulnerability (`@playwright/test@1.49.1` → 1.55+) | npm audit high; no impact in Wave 0 (no browsers downloaded) | Plan 01-10 or Phase 5 |
| `tests/e2e/01-phase-1-smoke.spec.ts` full implementation | Currently `test.skip(...)` | Plan 01-10 |

## Next Phase Readiness

Wave 0 acceptance gates are all green. The next plan in the wave sequence (01-02 — canonical event schema in `@fennec/shared`) can:

- Import the workspace scaffold directly (just add files under `packages/shared/src/`)
- Install Zod into `packages/shared/` and have it deduped at root (npm workspaces handles this)
- Rely on `npm run typecheck` failing red if the schema doesn't satisfy strict mode
- Add real tests that the new `--passWithNoTests` flag will surface normally

Nothing in Plan 01-01 is a half-step or blocker for the rest of Phase 1.

## Self-Check

- `package.json`: FOUND
- `tsconfig.base.json`: FOUND
- `biome.json`: FOUND
- `vitest.workspace.ts`: FOUND
- `playwright.config.ts`: FOUND
- `tests/canary-secrets.txt`: FOUND (10 lines)
- `.env.example`: FOUND
- `.husky/pre-commit`: FOUND (executable, contains `lint-staged`)
- `.husky/pre-push`: FOUND (executable, contains `npm run lint && npm run typecheck && npm run test:unit`)
- `.github/workflows/ci.yml`: FOUND
- Commit `b7a2f82` (Task 2): FOUND
- Commit `9491b24` (Task 3): FOUND
- Commit `ac5c2cd` (Task 4): FOUND

## Self-Check: PASSED

---
*Phase: 01-foundations*
*Completed: 2026-05-31*
