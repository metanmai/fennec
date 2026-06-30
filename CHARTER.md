# fennec — Charter (v2 reboot)

**Status:** Pre-scaffold. The original fennec design is preserved on `legacy/fennec-v1-design`; v2 fennec is being designed fresh, drawing ideas (and possibly code) from both legacy branches.

**This file is a handoff document, not living docs.** Delete it once the day-1 floor lands.

---

## Reference branches

- `legacy/fennec-v1-design` — original fennec: AI usage + cost observability via local daemon. TypeScript end-to-end (Cloudflare Workers + Hono backend, SvelteKit frontend, Supabase). 67 commits, last 2026-06-02. *Designed thoroughly (STACK.md, license decision, packaging plan), pre-MVP — no working capture loop shipped.*
- `legacy/workpulse-v1` — original WorkPulse: engineering-effort tracker pulling Jira/GitHub/PagerDuty, AI-narrated work output. Python FastAPI + React. 134 commits, working app at pivot date (2026-04-16). *Production-grade code, dormant — has working integrations + 90 days of seed data.*

Treat both as **reference libraries** — `git show legacy/<branch>:<path>` to mine ideas/code. They are not active.

---

## Target stack (v2, provisional — locked at first scaffold)

| Layer | Choice |
|---|---|
| Backend | Rust + Axum + sqlx |
| Frontend | SvelteKit |
| Database | Postgres (Supabase local in dev) |
| Daemon | TypeScript, lifted from `~/Documents/synapse/mcp` |
| Wire contract | OpenAPI spec generated from Rust (`utoipa` or `aide`) → TS types via `openapi-typescript` |
| Scaffolder | Better-Fullstack — https://better-fullstack.dev/new |
| Lint/format | biome (TS), rustfmt + clippy (Rust) |
| Test | vitest (TS), cargo test + proptest (Rust) |

**Rationale for Rust:** chosen for learning value. Backend is mostly I/O-bound; Rust isn't strictly needed for performance, but it's a deliberate learning project.

**Architecture:**
```
User laptop                                Cloud
─────────────────                          ────────────────────────
fennec daemon (TS)  ────HTTPS────────→  fennec backend (Rust)
                                                 │
                                           Postgres ← SvelteKit dashboard
```

Daemon is a **client** on the user's machine, not a deployment sidecar. It coexists in this monorepo with the backend because the wire contract evolves together.

---

## SDLC posture

- **Test-first.** No production code lands without a failing test in the same change.
- **Local-everything.** Full stack runs on a laptop with zero network calls. `make dev` boots Postgres + backend + frontend. `make test` runs every layer, network-disabled by default.
- **Behaviour-only tests.** No mocking your own modules. Tests outlive refactors.
- **Adapter fixtures committed.** Real-world captures pinned in repo. Stale fixtures ARE the signal that adapter targets moved.

---

## Day-1 floor (must exist before first feature commit)

1. `make dev` — boot Postgres + backend + frontend locally with one command
2. `make test` — run all layers, zero network calls, green on fresh checkout
3. `make test:adapter-fixtures` — every adapter against checked-in real captures
4. OpenAPI spec generated from Rust + TS types codegen + schema-drift contract test
5. Determinism harness — `Clock`, `IdGen`, `Rand` injectable in both Rust and TS
6. No-network test mode — default-on flag that fails on network access during tests
7. `CLAUDE.md` + `AGENTS.md` with hard rules:
   - "No production code without a failing test."
   - "No third-party dependency that can't be faked locally."
   - "No test that requires the network."
8. CI = same `make test` against Postgres service container. No CI-only scripts. (Local-parity applied to CI itself.)

---

## Open questions for the next session

1. **Discipline level:** strict TDD (red-green-refactor) vs test-first lite? *Recommend: strict.*
2. **Test types:** property + snapshot tests on top of unit/integration? *Recommend: yes property for parsers/serialisers, yes snapshot for OpenAPI spec, skip mutation testing for now.*
3. **CI:** from day 1, or after first working slice? *Recommend: from day 1 — cheap once `make test` exists.*
4. **Fixture policy:** committed vs regenerated periodically? *Recommend: committed.*
5. **Bind superpowers skills as hard rules?** (`superpowers:test-driven-development`, `superpowers:verification-before-completion`) *Recommend: yes — codify in CLAUDE.md.*
6. **v2 product framing.** What does fennec actually *do* in v2? Three options on the table:
   - **(a)** Same as v1 — AI usage/cost observability via local daemon capture
   - **(b)** Mine v1 WorkPulse — Jira/GH/PD-driven engineering effort narration
   - **(c)** Both lenses unified — one dashboard, two data sources (AI capture + shipped-work narration)
   *Recommend: (a) first to ship credible demo, (c) as v2.5 once core works. Don't try (c) on day 1.*

---

## How to proceed in the next session

1. Open this CHARTER, work through the open questions with the user.
2. Scaffold a fresh project via Better-Fullstack into a *separate* directory to avoid colliding with this checkout:
   ```bash
   npm create better-fullstack@latest
   # target: ~/Documents/fennec-new
   # pick: ecosystem=mixed, backend=rust+axum+sqlx, frontend=typescript+sveltekit, db=postgres
   ```
3. Decide how to bring the scaffold into this repo. Cleanest path:
   - Create an orphan branch `v2/main` with the scaffold contents
   - Force-push `v2/main` to replace `origin/main` (destructive — **confirm with user**)
   - `legacy/fennec-v1-design` and `legacy/workpulse-v1` remain untouched as reference
4. Lift `~/Documents/synapse/mcp` into `daemon/` workspace. Strip synapse-specific bits, keep capture + sync skeleton.
5. Build the **day-1 floor** before any feature code. The floor is the project's foundation — features layered on top inherit its testability guarantees.
6. After day-1 floor lands, delete this `CHARTER.md` — it's a moment-in-time handoff.

---

## Context from the workpulse session (2026-06-08)

This charter was written during a session in the workpulse repo, after deciding to fully separate the two products:

- **workpulse** = job-application automation platform (the active product) — stays in `~/Documents/workpulse`
- **fennec** = engineering/dev observability (you are here)

The original `archive/workpulse-v1` branch (the legacy engineering-analytics product) was moved out of the workpulse repo and now lives here as `legacy/workpulse-v1`. The workpulse repo no longer has any legacy-v1 references.
