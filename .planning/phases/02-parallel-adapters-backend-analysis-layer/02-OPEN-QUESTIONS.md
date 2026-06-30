---
phase: 02-parallel-adapters-backend-analysis-layer
updated: 2026-07-01T00:00:00Z
open_count: 2
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
