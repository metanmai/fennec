---
phase: 02-parallel-adapters-backend-analysis-layer
updated: 2026-07-01T00:00:00Z
open_count: 24
---

# Open Questions — Phase 2 Parallel Adapters + Backend Analysis Layer

> Auto-decided under uncertainty while running unattended. Review and override as needed.
> Each item already has a tentative choice applied so downstream work could proceed.

## Q1 — Correlation window: what is the ±N-minute value?

- **Question:** ROADMAP success criterion 2 and ANL-01 specify a "±N-minute window" for joining prompts to nearby git events, but leave N unspecified.
- **Tentative choice:** N = 15 minutes (so a ±15-minute join window), as the SPEC default for the correlation worker.
- **Alternatives:** ±5 min (tighter, fewer false-positive correlations, may miss slower edit→commit cycles); ±30 min (looser, catches longer sessions, more spurious joins); per-org configurable window (most flexible, more complexity, deferred).
- **Why uncertain:** No prior fennec decision pins the value; the right number depends on real prompt→commit latency distributions not yet observed. 15 min is a reversible middle ground (synapse/observability convention for "same working session") that can be tuned once staging data exists.
- **Impact:** Affects correlation precision/recall and therefore attribution confidence intervals (ANL-02). Cheap to change — it is a single worker parameter, ideally surfaced as config, not a schema change.
- **Confidence:** MEDIUM.

## Q2 — Browser surface (ChatGPT.com + Claude.ai): GA, submit-and-wait, or defer at v1-freeze?

- **Question:** ROADMAP success criterion 1 and CAP-07/CAP-08 allow the browser MV3 surface to either capture live OR be "explicitly flagged 'submit-and-wait' / 'defer' at the v1-freeze decision point with the architecture unchanged." Which disposition does Phase 2 commit to?
- **Tentative choice:** Build the MV3 extension and exercise it end-to-end against the daemon's local loopback bridge this phase; do NOT block the phase on Chrome Web Store / Firefox AMO review or GA approval. Record the public-store disposition (GA / submit-and-wait / defer) at the v1-freeze decision point. The loopback-bridge architecture is built either way so deferral costs nothing structurally.
- **Alternatives:** Commit to full GA this phase (risk: Chrome Web Store review for a "captures all your AI prompts" extension is unpredictable and could block the whole phase); defer the browser surface entirely (risk: weakens the "see *everything*" pitch; but cleanly reversible since the architecture stays intact).
- **Why uncertain:** Three flagged research risks from roadmap derivation (STATE blockers: MV3 fetch-monkeypatch viability against late-2026 ChatGPT, anti-bot detection of monkeypatched fetch, store-review timing) are unresolved and partly external. CLAUDE.md rates browser-capture MEDIUM confidence and explicitly expects this mechanism to be revisited mid-build.
- **Impact:** Determines whether criterion 1's browser clause is met by live capture or by the documented-defer escape hatch. Building-and-exercising-locally keeps both outcomes open; only the public-store launch decision is deferred.
- **Confidence:** MEDIUM. Recommend `/gsd:plan-phase --research-phase 2` to harden before committing (Cursor SQLite stability + Copilot cache location + MV3 viability are co-flagged in STATE).

---

> Q3–Q7 appended 2026-07-01 by autonomous smart-discuss (02-CONTEXT.md). Each has a tentative HOW-default applied so planning can proceed; revisit before/during plan-phase.

## Q3 — macOS transcript/cache file paths for the new adapters

- **Question:** What are the exact, current macOS on-disk locations for Codex CLI transcripts, Gemini CLI transcripts, Cursor's `workspaceStorage`/SQLite, and Copilot's local cache that the new adapters must watch/read?
- **Tentative choice:** Use the standard macOS locations (e.g. `~/.codex/`, `~/.gemini/`, `~/Library/Application Support/Cursor/User/workspaceStorage/`, Copilot's `~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/`), each isolated behind a per-adapter `resolvePaths(os)` function (D2-05) so Phase 5 can branch for Linux/Windows without touching capture logic.
- **Alternatives:** Hard-code single paths inline (brittle; rejected); auto-discover by scanning common dirs (more robust, more complexity — defer).
- **Why uncertain:** CLAUDE.md rates these LOW/MEDIUM confidence — synapse confirms macOS/Linux for Codex/Gemini but Copilot cache locations are "undocumented, budget rework time" and Cursor paths vary by version. Verified only at build/exercise time on the dev machine.
- **Impact:** Wrong paths = an adapter captures zero events (heartbeat still fires, so failure is visible, not silent). Cheap to fix — a single function per adapter.
- **Confidence:** MEDIUM (Codex/Gemini), LOW (Copilot cache, Cursor SQLite location).

## Q4 — Cursor SQLite read-only access mechanism while Cursor is running

- **Question:** How does the Cursor adapter read Cursor's local SQLite safely while Cursor may hold the DB open (locks, WAL, multi-DB)?
- **Tentative choice:** Open read-only / immutable and poll on a chokidar mtime watch (D2-04); if the DB is locked, copy-then-read the snapshot. Never write/migrate Cursor's DB.
- **Alternatives:** Hold a long-lived read connection (risks lock contention with Cursor); use `better-sqlite3` (adds a native dep — against the daemon's zero-native-dep posture, so prefer a read-only open via an existing/stdlib path or copy-then-read).
- **Why uncertain:** STATE explicitly flags "Cursor SQLite multi-DB stability" as a Phase 2 research risk. Behaviour against a live Cursor on late-2026 macOS is unverified.
- **Impact:** A bad access mode could miss rows or (worst case) contend with Cursor; read-only + copy-on-lock keeps it safe. Reversible.
- **Confidence:** LOW. Recommend hardening via `/gsd:plan-phase --research-phase 2`.

## Q5 — Confidence-band thresholds for `prompt_outcomes` (ANL-02)

- **Question:** What signal thresholds map a correlation to `low` / `medium` / `high` confidence (and the numeric `confidence_low`/`confidence_high` bounds)?
- **Tentative choice:** Rule-derived v1 (D2-18): tight time gap + same repo/branch + a commit touching files → high; loose gap or branch mismatch → low; in-between → medium. Exact gap cutoffs and bound values are documented constants, tuned against staging data.
- **Alternatives:** Single fixed band for all correlations (too blunt); a learned/statistical model (premature — no data yet).
- **Why uncertain:** No prior fennec decision pins the thresholds; the right cutoffs depend on real prompt→commit latency distributions not yet observed (same root uncertainty as Q1's N).
- **Impact:** Affects how the Phase 4 dashboard portrays attribution certainty. Reversible — a worker constant, not a schema change (the interval shape is locked; only the values move).
- **Confidence:** MEDIUM (shape STRONG/locked; thresholds MEDIUM).

## Q6 — Rule-based model-fit heuristic weights + verdict cutoffs (ANL-04)

- **Question:** What weights combine prompt length, file-edit size, tool-call count, and model tier into the score, and where are the `under_powered` / `fit` / `over_powered` cutoffs?
- **Tentative choice:** A transparent weighted "task heaviness" score with documented starting weights, stored alongside the input signals so the verdict is explainable and re-derivable (D2-21); model→tier mapping seeded as data (D2-22). Tune weights against staging data.
- **Alternatives:** Equal weights (simplest baseline); a decision-tree of explicit rules (more readable, more brittle). Both reversible.
- **Why uncertain:** No empirical fennec data yet on what "right-sized model" looks like per task class; weights are a first guess. The constraint that it stays rule-based (no LLM) is STRONG/locked — only the numbers are open.
- **Impact:** Affects the model-fit verdict surfaced in Phase 4. Reversible — config/constants; the "no LLM/network in scoring path" guard is the load-bearing invariant, not the weights.
- **Confidence:** MEDIUM.

## Q7 — Subscription pricing: same-table discriminator vs sibling table (ANL-09)

- **Question:** Should subscription products (Copilot ~$19/mo, ChatGPT Pro ~$20/mo) live in `model_pricing` behind a `pricing_kind` discriminator (`per_token` vs `subscription`) or in a separate `subscription_pricing` table?
- **Tentative choice:** Same-table `pricing_kind` discriminator in `model_pricing` (leaner; one effective-date mechanism) — D2-27. The hard requirement (subscription cost is a distinct rollup field, never summed into `cost_estimated`) holds either way.
- **Alternatives:** Sibling `subscription_pricing` table (cleaner separation, a second effective-date mechanism to maintain).
- **Why uncertain:** Both satisfy the SPEC acceptance; it's a schema-ergonomics taste call with no prior fennec precedent. Migrating between the two later is a contained migration.
- **Impact:** Schema shape of the pricing layer; the rollup's separate `cost_subscription` field is unaffected by the choice.
- **Confidence:** MEDIUM (requirement STRONG/locked; table shape is the open part).

---

> Q8–Q13 appended 2026-07-01 by `/gsd:plan-phase --research-phase 2` (research-only mode, autonomous). These are the LOW/MEDIUM-confidence, externally-dependent items surfaced in `02-RESEARCH.md` that the planner should schedule explicit build-time verify tasks for. Several REFINE the locked CONTEXT decisions (D2-04/D2-14/D2-27) — see notes.

## Q8 — Browser MV3 capture viability against late-2026 ChatGPT.com + Claude.ai (gates Q2)

- **Question:** Does the `world: MAIN` + `run_at: document_start` content-script `window.fetch` / `XMLHttpRequest.prototype.send` monkeypatch still fire on live ChatGPT.com and Claude.ai chat completions, without anti-bot detection breaking the session or detecting the patch? What are the current completion request URL/method shapes per site so the content script knows what to capture?
- **Tentative choice:** Build a minimal raw-MV3 extension and exercise it against the daemon loopback bridge this phase (per D2-11); treat live capture as best-effort. If the monkeypatch is detected or the request shapes can't be reliably captured, take the documented-defer escape hatch at v1-freeze (Q2) with the loopback architecture intact.
- **Why uncertain:** No live POC was performed in research; CLAUDE.md rates this MEDIUM and explicitly expects revisit mid-build. Anti-bot behaviour and request URLs are version-fragile and external.
- **Impact:** Directly gates the CAP-07/08 GA-vs-defer decision (Q2). Architecture is built either way, so deferral is structurally free.
- **Confidence:** LOW. Verify at build time with a throwaway extension on the real sites.

## Q9 — Gemini CLI per-turn token persistence

- **Question:** Does `~/.gemini/tmp/<project>/chats/session-*.jsonl` (or the current Gemini transcript location) persist any per-turn token/usage field, or are token counts unavailable for the Gemini surface?
- **Tentative choice:** Assume Gemini transcripts may lack reliable per-turn token usage; the cost worker nulls tokens for Gemini rows when absent (graceful degradation, mirroring the Copilot no-token case).
- **Why uncertain:** Research could not re-observe a live Gemini session schema (ephemeral / aged-out files); path verified, token field not confirmed.
- **Impact:** Affects whether Gemini events carry a `cost_estimated` or null tokens. Reversible — a normaliser field-presence check.
- **Confidence:** LOW. Run a live `gemini` prompt at build time and inspect the JSONL.

## Q10 — Cursor WAL change-detection + `node:sqlite` flag-gating

- **Question:** Does a new Cursor prompt bump the mtime of `state.vscdb` (or `state.vscdb-wal`) within the adapter's chokidar poll window, so the watcher fires? And does Node 22's built-in `node:sqlite` `DatabaseSync(path, { readOnly: true })` require an `--experimental-sqlite` flag on the pinned Node 22 minor?
- **Tentative choice:** Poll on a chokidar mtime watch of both `state.vscdb` and `state.vscdb-wal`; open read-only via `node:sqlite` (RESEARCH confirmed a live read-only open worked against the WAL DB on Node 22.23.1 this machine). If a flag is required on the pinned minor, gate it in the daemon launch.
- **Why uncertain:** WAL writes may land in the `-wal` sidecar without bumping the main DB mtime promptly; the `node:sqlite` flag requirement varies by Node 22 minor.
- **Impact:** Wrong watch target = missed Cursor captures (heartbeat still fires, so failure is visible). Reversible.
- **Confidence:** MEDIUM. (Refines D2-04/Q4 — the read mechanism is now RESOLVED to `node:sqlite` read-only; only change-detection + flag-gating remain to verify.)

## Q11 — Supabase Postgres version + `btree_gist` for the non-overlap pricing constraint

- **Question:** What Postgres version does the staging Supabase run, and is `CREATE EXTENSION btree_gist` permitted (needed for the `EXCLUDE USING gist` non-overlapping-effective-date constraint on `model_pricing`)?
- **Tentative choice:** Use `CREATE EXTENSION IF NOT EXISTS btree_gist` + an `EXCLUDE USING gist (model WITH =, token_kind WITH =, tstzrange(effective_from, effective_to) WITH &&)` constraint (Supabase permits btree_gist). If PG ≥18 on staging, `WITHOUT OVERLAPS` is an alternative.
- **Why uncertain:** Staging PG version not confirmed in research; the extension availability is Supabase-plan-dependent (though generally allowed).
- **Impact:** Determines whether non-overlap is enforced by constraint (preferred) or by a test only. Reversible.
- **Confidence:** MEDIUM. Confirm against staging at build time.

## Q12 — Pricing currency + Copilot's usage-based billing model (refines D2-27/ANL-09)

- **Question:** The verified 2026-07-01 seed prices differ from the SPEC: GitHub Copilot Pro is now **$10/mo** (and moved to usage-based/credit billing on 2026-06-01), not $19; ChatGPT **Plus** is $20/mo. How should Copilot's now-usage-based billing be represented as a fixed "subscription" line, and what are the current per-token Claude/GPT prices at build time?
- **Tentative choice:** Seed `model_pricing` with the verified 2026-07-01 numbers via the `pricing_kind` discriminator (per RESEARCH recommendation favouring same-table over a sibling table — refines Q7); represent Copilot as a subscription line as a documented simplification, flagged that Copilot is really usage-based now. Re-verify all prices at build (volatile). Seed BOTH Sonnet 5 intro rows around the 2026-08-31→09-01 cutover as a live test of the effective-date machinery.
- **Why uncertain:** Prices are volatile (research valid ~1 week for pricing); Copilot's usage-based shift makes a flat-subscription model an approximation.
- **Impact:** Seed-data accuracy for `cost_estimated` and `cost_subscription`. Reversible — data rows, not code (the no-hardcoded-price constraint guarantees this).
- **Confidence:** MEDIUM. Re-verify at build.

## Q13 — Git event transport: standard ingest path vs separate git endpoint (genuine plan-time design decision)

- **Question:** Should `tool: "git"` events route through the standard adapter → registry → JSONL queue → `POST /api/events/batch` ingest path and into `git_events` (requiring a dumb tool-branch in ingest that writes `git_events` instead of `ai_events`), or via a separate git endpoint/queue?
- **Tentative choice:** Prefer routing through the existing ingest path with a dumb tool-discriminator branch (git → `git_events`, all other tools → `ai_events`), keeping one transport and preserving ING-04 hot-path purity. The correlation worker then reads `git_events` directly.
- **Why uncertain:** The Phase 1 ingest path currently writes `ai_events` only; the git-watcher (D2-06) emits `git_events`. RESEARCH (A4) flags this as a real architectural fork the planner must resolve, not a settled CONTEXT decision.
- **Impact:** Determines ingest branching + whether a second endpoint exists. Affects the hot-path-purity test surface. Contained either way.
- **Confidence:** MEDIUM. Planner decides; either path is testable.

---

> Q14–Q18 appended 2026-07-01 by claim-validation pass 1 (02-EVIDENCE.md). These are claims marked UNVERIFIABLE in the ledger — could not be validated in this environment; assumed-true with a safe default, verify on return. Several overlap existing Q8/Q11/Q12 but are recorded here as explicit "could-not-validate" entries per the validation protocol.

## Q14 — Cloudflare "one push consumer per queue" limit (EVIDENCE C36 — UNVERIFIABLE)

- **Claim:** A Cloudflare Queue allows only ONE active push consumer; two push-consumer Workers on the same queue fail at publish (refines D2-14).
- **Could not validate:** This is an account/deploy-time platform limit. Local `wrangler 4.93.1 deploy --dry-run` with two consumers on one queue did NOT reject at config validation — the limit is enforced server-side at `wrangler deploy`, which needs a live Cloudflare account (out of scope here).
- **Assumed true** (documented Cloudflare limit, RESEARCH C7.4). **Safe default:** Option A — ONE queue + ONE consumer Worker running correlation + model-fit as two idempotent functions. This honors the limit regardless and is simpler/cheaper. Verify by an actual `wrangler deploy` to staging during the build.
- **Confidence:** MEDIUM (well-documented limit; just not locally confirmable).

## Q15 — Live per-token pricing (Claude + GPT) at build time (EVIDENCE C37/C38 — UNVERIFIABLE; see also Q12)

- **Claim:** The 2026-07-01 seed per-MTok prices in RESEARCH C11.2/C11.3 (Opus 4.8 $5/$25; Sonnet 5 $2/$10 intro → $3/$15 from 2026-09-01; Haiku 4.5 $1/$5; GPT-5.5 $5/$30; GPT-4.1 $2/$8; GPT-4o $2.50/$10; nano $0.10).
- **Could not validate:** External, paid-vendor pricing pages; no live web fetch performed; volatile (research valid ~1 week for pricing).
- **Assumed true** as the seed. **Safe default:** seed `model_pricing` via the effective-date table (so prices are data, not code — corrections are INSERTs); re-verify all numbers at build. Seed BOTH Sonnet-5 rows around the 2026-08-31→09-01 cutover (the EXCLUDE machinery is PROVEN, C16 — this exercises it live).
- **Confidence:** MEDIUM. Re-verify at build.

## Q16 — Staging Supabase Postgres version + btree_gist availability (EVIDENCE C17 — partial; see also Q11)

- **Claim:** Staging Postgres permits `CREATE EXTENSION btree_gist` and is < 18 (so the EXCLUDE form, not `WITHOUT OVERLAPS`).
- **Could not validate:** Only the LOCAL dev Postgres was reachable (PostgreSQL 17.10 — EXCLUDE proven there, C16). The staging Supabase instance needs production credentials (out of scope).
- **Assumed true** (Supabase generally allows btree_gist; Phase 1 targets PG15+). **Safe default:** use the EXCLUDE-constraint form (proven on PG 17.10); if staging is ≥18, `WITHOUT OVERLAPS` is an optional cleaner alternative. Confirm the staging version at build.
- **Confidence:** MEDIUM.

## Q17 — MV3 monkeypatch viability on live ChatGPT/Claude.ai (EVIDENCE C39 — UNVERIFIABLE; duplicate of Q8)

- **Claim:** `world:MAIN`+`document_start` `fetch`/`XHR` monkeypatch fires on live ChatGPT.com + Claude.ai completions without anti-bot breakage; current completion request URL shapes.
- **Could not validate:** Requires a live browser session against late-2026 sites + observing anti-bot behavior; no live POC performed (same as Q8).
- **Assumed best-effort.** **Safe default:** build-and-exercise-locally against the loopback bridge (D2-11); take the documented-defer escape hatch at v1-freeze (Q2) if detection/anti-bot breaks. Architecture built either way.
- **Confidence:** LOW. (Tracked primarily under Q8.)

## Q18 — Gemini live transcript schema + token field (EVIDENCE C40 — UNVERIFIABLE-here; duplicate of Q9)

- **Claim:** Live `~/.gemini/tmp/<project>/chats/session-*.jsonl` filename + whether it persists per-turn token usage.
- **Could not validate:** The `tmp/<project>/` dirs exist but contain zero `*.jsonl` right now (chats are ephemeral / aged out). Could not observe the live schema or token field this session.
- **Assumed:** Gemini transcripts may lack reliable per-turn tokens — cost worker nulls them (graceful degradation, like Copilot). **Safe default:** run a live `gemini` prompt at build and inspect the JSONL (Q9).
- **Confidence:** LOW. (Tracked primarily under Q9; the ephemerality risk is CONFIRMED.)

---

> Q19 appended 2026-07-01 while authoring 02-10-PLAN.md (MV3 browser extension plan) unattended. A safe reversible default was applied so the plan could be written; revisit at execute time.

## Q19 — Browser-extension workspace directory name: `browser-extension/` vs `extension/`

- **Question:** 02-RESEARCH.md (§B.6) and 02-PATTERNS.md (§No Analog Found) name the MV3 browser workspace `extension/`, but the 02-10 plan-authoring directive named it `browser-extension/`. Which directory name does the workspace ship under?
- **Tentative choice:** `browser-extension/` — used throughout 02-10-PLAN.md (files, must_haves, threat model, root-`workspaces` append). Chosen because (a) the plan-authoring directive is the most recent explicit instruction, and (b) `browser-extension/` is more self-documenting alongside the sibling `vscode-extension/` (02-09) — the two out-of-process capture clients read as a matched pair.
- **RESOLVED (adversarial-review-cycle-1 replan):** 02-PATTERNS.md's three `extension/` workspace-directory references (the pattern-assignment table row, the §NO IN-REPO ANALOG heading, and the No-Analog-Found row) were renamed to `browser-extension/` to match the plans. 02-RESEARCH.md carries NO bare `extension/` workspace-directory name — its mentions ("the MV3 extension", "the extension") are conceptual, not a directory, so no rename was needed there. The single doc name of record is now `browser-extension/` across plans + PATTERNS.
- **Alternatives:** `extension/` (shorter). Either works — it is a directory name only, referenced nowhere in production runtime logic; the manifest, content-script, SW, and bridge-client are name-agnostic.
- **Why uncertain:** Pure naming reconciliation between design artifacts; no functional impact. The root `package.json` `workspaces` entry + any doc cross-refs must use the SAME name the plan ships.
- **Impact:** Cosmetic/organisational. Reconciled to `browser-extension/` everywhere the workspace directory is named.
- **Confidence:** HIGH (that either name works); the divergence is now resolved to `browser-extension/`.

---

> Q20–Q22 appended 2026-07-01 by adversarial-review-cycle-1 replan (Plans 04 + 01). Each resolves a HIGH concern with a safe default applied in-plan and defers the residual maturation here.

## Q20 — repo→project mapping maturation (H4 residual)

- **Question:** How does an `ai_events.repo_remote` (added by Plan 04 migration 014) map to a concrete `project_id` for `daily_rollups_by_project`?
- **Tentative choice (applied this phase):** `daily_rollups_by_project.project_id` is NULLABLE, with a per-org "default project" fallback for rows whose repo→project mapping is not yet resolved (Plan 04 Task 2 / H4). The aggregator (Plan 07) groups unresolved rows under the default project. Full repo_remote→project resolution (canonicalising remotes, matching to a `projects` row, handling forks/mirrors) matures in Phase 3/4 when the projects UX lands.
- **Why deferred:** A robust repo→project mapping needs the Phase-3 projects/membership model and remote-canonicalisation rules that don't exist yet; forcing `project_id NOT NULL` now (as the original schema did) would either block inserts or invent bogus project rows.
- **Safe default:** nullable project_id + org-default-project fallback; no data is lost (repo_remote is persisted on ai_events, so a Phase-3 backfill can re-derive project_id).
- **Confidence:** HIGH (that nullable+default is safe this phase); the mapping algorithm itself is MEDIUM and deferred.

## Q21 — rolling partition-ahead mechanism: pg_cron vs documented monthly migration (H1 residual)

- **Question:** Does staging Supabase permit `CREATE EXTENSION pg_cron` + `cron.schedule(...)` so the monthly partition-ahead job runs automatically, or must a monthly manual migration task be run?
- **Tentative choice (applied this phase):** Plan 04 migration 008 creates the 2026-07/08 + DEFAULT partitions unconditionally (closing the H1 gap regardless), and ATTEMPTS to install a pg_cron monthly job inside a privilege-guarded `DO` block that RAISE NOTICEs (does not hard-fail) if pg_cron is unavailable. If pg_cron is present → automatic rolling-ahead. If absent → the README's documented "monthly partition-ahead migration task" governs, and the Plan 04 Task 5 blocking gate + a monthly reminder cover it.
- **Why deferred:** pg_cron availability is Supabase-plan-dependent and only confirmable against live staging credentials (Q11/Q16 track the same environment uncertainty). The DEFAULT partition is a safety net so a missed rollout degrades pruning rather than throwing.
- **Safe default:** unconditional 07/08/DEFAULT partitions + guarded pg_cron attempt + documented manual fallback; record which path was taken in the 02-04-SUMMARY at push time.
- **Confidence:** MEDIUM (pg_cron availability); HIGH (the gap itself is closed either way).

## Q22 — /v1/events Origin/Sec-Fetch-Site allowlist exact values (H6 residual)

- **Question:** What is the exact Origin / Sec-Fetch-Site allowlist the hardened `/v1/events` route accepts, given the paired browser extension is the intended caller?
- **Tentative choice (applied this phase):** Plan 01 Task 2 rejects any request whose `Sec-Fetch-Site` is `cross-site` (403) and requires `Content-Type: application/json` (415 otherwise), which together block a hostile page's simple/cross-site fetch; it accepts the extension service-worker's `Sec-Fetch-Site: none`/same-origin + extension-origin. The precise `chrome-extension://<id>` / `moz-extension://<id>` origin string depends on the extension id, which is not fixed until the extension is packaged (Plan 09/10).
- **Why deferred:** The extension id (hence its exact origin) is assigned at pack/store time; the allowlist must be finalised against the real id. The `Sec-Fetch-Site`/Content-Type gates are id-independent and hold now.
- **Safe default:** enforce the id-independent gates (Sec-Fetch-Site cross-site reject + Content-Type require + timingSafeEqual token + body cap) this phase; finalise the exact extension-origin allowlist entry when Plan 09/10 pins the extension id — record it in the 02-01-SUMMARY / 02-09/10 SUMMARY.
- **Confidence:** HIGH (the id-independent gates are the load-bearing mitigation); the exact origin string is a contained follow-up.

---

> Q23–Q24 appended 2026-07-01 by adversarial-review-cycle-1 replan (Plan 07). Each resolves a MEDIUM/LOW concern with a safe default applied in-plan and defers the residual maturation here.

## Q23 — subscription-cost per-entity attribution + per-machine rollup key maturation (Plan 07 MEDIUM + H4 residual)

- **Question:** (a) How is a `cost_subscription` line (Copilot/ChatGPT subscriptions) attributed to a specific user/seat, given there is no per-seat/assignment table this phase? (b) How do per-user rollups stay distinct while `daily_rollups_by_user.user_id` is a UUID column and Phase-2 events have `user_id=NULL`?
- **Tentative choice (applied this phase):** (a) `cost_subscription` is scoped to an ORG-LEVEL line — `getSubscriptionCost({ org_id, day })` sums the org's active subscription monthly_price; it is NOT split per-user by guessing. (b) The aggregator groups source rows by `COALESCE(user_id::text, user_id_unknown)` and, for NULL-user machines, writes a DETERMINISTIC synthetic UUID derived from `user_id_unknown` (namespaced) into the rollup `user_id`, so `UNIQUE (org_id, user_id, day)` yields one row PER MACHINE rather than one shared NULL row. The synthetic key is a rollup-layer convenience (never written onto `ai_events`); Phase-3 attach re-keys it via the `attachUser` (org_id, hostname) backfill.
- **Why deferred:** Per-seat subscription attribution needs the Phase-3 org/membership/seat model (who holds which subscription) that doesn't exist yet; forcing a per-user split now would invent bogus attributions. A dedicated per-machine rollup key column (vs a synthetic UUID in the user_id column) is also a Phase-3 identity-model concern.
- **Safe default:** org-level subscription line + deterministic synthetic per-machine user_id; no data lost (raw user_id_unknown persists on ai_events, so Phase-3 can re-derive both the seat attribution and the real user_id).
- **Confidence:** HIGH (that org-level + synthetic-key is safe this phase); the per-seat model + a real rollup key column are MEDIUM and deferred.

## Q24 — GPT/OpenAI (and Gemini/Copilot) per-token cost pricing deferral (Plan 07 LOW; EVIDENCE C38 UNVERIFIABLE)

- **Question:** Should the Phase-2 cost model + `model_pricing` seed include GPT/OpenAI per-token prices (and Gemini/Copilot), given no capture surface reliably supplies GPT token counts this phase and the GPT prices are UNVERIFIABLE here (EVIDENCE C38)?
- **Tentative choice (applied this phase):** The cost model + seed (migration 016) cover ONLY models with PROVEN token accounting — Anthropic (four usage fields captured verbatim, EVIDENCE C31). GPT/OpenAI per-token rows are DEFERRED (not seeded). A GPT/Gemini/Copilot event therefore has no matching per-token price row and `computeEstimatedCost` treats it as 0 (graceful degradation, same path as absent tokens, EVIDENCE C10) — documented, not a bug. Copilot/ChatGPT still contribute via the org-level `cost_subscription` line (Q23).
- **Why deferred:** GPT token counts are not reliably available from the Phase-2 capture surfaces (Copilot cache has no per-turn tokens — C10; Gemini transcripts ephemeral / token-field unconfirmed — C40/Q9); seeding GPT per-token prices would imply an accuracy the token data can't support. Because prices are DATA in the effective-date table (ANL-08, no hardcoded constants), adding GPT later is an INSERT, not a code change.
- **Safe default:** Anthropic-only per-token seed this phase; GPT/Gemini/Copilot per-token cost = 0 with the subscription line covering the flat products; re-verify + add GPT prices (and confirm a GPT token source) in a later phase. Re-verify ALL prices at build (volatile — Q12/Q15).
- **Confidence:** HIGH (that Anthropic-only + graceful-zero is safe this phase); GPT token availability + prices are LOW/deferred.
