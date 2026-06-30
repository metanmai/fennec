---
phase: 02
slug: parallel-adapters-backend-analysis-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` → "Validation Architecture". Per-task rows are filled by the planner against each PLAN's tasks.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 (root + per-workspace configs) |
| **Config file** | `vitest.workspace.ts`, `vitest.config.ts`, `daemon/vitest.config.ts`, `backend/vitest.config.ts`, `tests/vitest.config.ts` |
| **Quick run command** | `npx vitest run <path/to/test>` (or `npm test -w daemon` / `-w backend`) |
| **Full suite command** | `npm test` (root: `vitest run --passWithNoTests`) + `npm run lint` + `npm run typecheck` |
| **Estimated runtime** | ~60 seconds (quick task run ≤ 10s; full suite ~60s) |

---

## Sampling Rate

- **After every task commit:** Run the task's own `npx vitest run <file>` + `npm run lint` + `npm run typecheck`
- **After every plan wave:** Run `npm test` (full root) + both workspace suites
- **Before `/gsd:verify-work`:** Full suite green + the live-capture acceptance checks (one prompt per surface → one staging row ≤ 5 min)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Planner fills one row per PLAN task. Requirement → behavior → test mapping is pre-derived from RESEARCH "Phase Requirements → Test Map" below; the planner binds each to a concrete Task ID and command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {planner-fills} | — | — | CAP-03..09 / CAP-18 / ANL-01..09 | T-02-* / — | {expected secure behavior or "N/A"} | unit / integration | `{command}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → Test reference (from RESEARCH)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-03 | one Codex prompt → one `tool='codex'` row in ≤5min | integration | `npx vitest run daemon/.../codex.test.ts` | ❌ Wave 0 |
| CAP-04 | one Gemini prompt → one `tool='gemini'` row | integration | `npx vitest run daemon/.../gemini.test.ts` | ❌ Wave 0 |
| CAP-05 | one Cursor interaction → one `tool='cursor'` row; read-only open | unit + integration | `npx vitest run daemon/.../cursor.test.ts` | ❌ Wave 0 |
| CAP-06 | one Copilot interaction → one `tool='copilot'` row (sidecar→bridge) | integration | `npx vitest run` | ❌ Wave 0 |
| CAP-07/08 | one ChatGPT/Claude.ai prompt → one row OR defer recorded | manual + integration | manual capture + `npx vitest run extension bridge test` | ❌ Wave 0 |
| CAP-09 | commit/revert/file_edit/branch_switch → matching `git_events.event_type` | unit + integration | `npx vitest run daemon/.../git.test.ts` | ❌ Wave 0 |
| (all CAP) | heartbeat emits events_parsed/parse_errors at zero capture | unit | existing `AdapterCounter` pattern | partial (registry tested) |
| CAP-18 | inspect lists 24h events, redacted, prints backend URL; canary→0 raw | unit | `npx vitest run daemon/.../inspect.test.ts` | ❌ Wave 0 |
| ANL-01 | ingest enqueues; hot-path purity holds | unit (existing guard) + integration | `npx vitest run backend/src/api/events-batch.hot-path.test.ts` | ✅ (extend) |
| ANL-01 | prompt+commit in window → linking `prompt_outcomes` row | integration | `npx vitest run backend/.../correlation.test.ts` | ❌ Wave 0 |
| ANL-02 | confidence is interval (two bounds), not bare number | unit + schema CHECK | `npx vitest run backend/.../prompt-outcomes-schema.test.ts` | ❌ Wave 0 |
| ANL-03 | prompt→commit→revert → `attribution_state='downgraded_by_revert'`, no silent decrement | integration | `npx vitest run backend/.../revert-downgrade.test.ts` | ❌ Wave 0 |
| ANL-04 | one `model_fit_scores` row/prompt; NO LLM/network in scoring | unit + static-import guard | `npx vitest run backend/.../model-fit.no-llm.test.ts` | ❌ Wave 0 |
| ANL-05 | cron writes rollups; totals reconcile with raw query | integration | `npx vitest run backend/.../aggregator.test.ts` | ❌ Wave 0 |
| ANL-07 | distinct `cost_estimated`/`cost_billed`; cache tokens 4 distinct line items | unit | `npx vitest run backend/.../cost-cache-tokens.test.ts` | ❌ Wave 0 |
| ANL-08 | price read from `model_pricing` effective-date; NO hardcoded price | unit + grep guard | `npx vitest run backend/.../no-hardcoded-price.test.ts` | ❌ Wave 0 |
| ANL-09 | subscription is distinct `cost_subscription`, not summed into estimate | unit | `npx vitest run backend/.../subscription-separate.test.ts` | ❌ Wave 0 |

---

## Wave 0 Requirements

- [ ] Add `chokidar@^5.0.0` to `daemon/package.json` (blocks all in-process adapters)
- [ ] Add `@cloudflare/vitest-pool-workers` to `backend` dev deps (Worker queue/cron tests) — or document the mocked-env fallback
- [ ] `daemon/src/adapters/{codex,gemini,cursor,git}/` dirs + `*.test.ts` (CAP-03/04/05/09)
- [ ] `daemon/src/cli/inspect.ts` + `inspect.test.ts` (CAP-18 canary)
- [ ] `daemon/src/adapters/loopback-bridge/` `/v1/events` route test (CAP-06/07/08 ingress)
- [ ] `backend/.../model-fit.no-llm.test.ts` (mirror `events-batch.hot-path.test.ts` static-import grep) — ANL-04 no-LLM guard
- [ ] `backend/.../no-hardcoded-price.test.ts` (grep aggregator source for numeric price literals) — ANL-08
- [ ] Fixture transcripts: a real Codex `rollout-*.jsonl`, a Gemini `session-*.jsonl`, a fixture `state.vscdb` (small), a Copilot `chatSessions` json, a `.git/logs/HEAD` reflog sample — checked into test fixtures
- [ ] Test `model_pricing` seed migration with the Sonnet-5 cutover (two non-overlapping rows) to exercise effective-date selection

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live capture: one prompt per surface → one staging row ≤ 5 min | CAP-03..09 | Requires live CLI/IDE/browser session on the dev machine + staging backend | Issue one prompt in each of Codex, Gemini, Cursor, Copilot, ChatGPT.com, Claude.ai; confirm one matching `ai_events` row per `tool` within 5 min |
| Browser MV3 monkeypatch viability vs live ChatGPT/Claude.ai | CAP-07/08 | Anti-bot + request-shape behavior is external and version-fragile (Q8/Q17) | Exercise the extension against the loopback bridge on the real sites; if detection breaks capture, record the documented-defer disposition at v1-freeze |
| Cloudflare one-push-consumer limit | ANL-01/D2-14 | Enforced server-side at `wrangler deploy`, needs a live Cloudflare account (Q14) | Deploy the single consumer Worker to staging and confirm it drains the queue |
| Staging Postgres version + `btree_gist` availability | ANL-08 | Needs production staging credentials (Q11/Q16) | Confirm staging PG version; verify `CREATE EXTENSION btree_gist` is permitted (else fall back to test-only non-overlap) |
| Live per-token + subscription prices at build | ANL-08/09 | External, volatile vendor pricing (Q12/Q15) | Re-verify all `model_pricing` seed numbers at build; correct via INSERTs (data, not code) |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
