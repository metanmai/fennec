# Fennec — Product Thinking & Open Decisions

> Working notes from a design session (June 2026). Captures the strategic reframe,
> competitor-gap research, scoring philosophy, and access model. Meant as context for
> implementation work. Nothing here is built yet — these are decisions and arguments.

## The core reframe

- **Original framing:** AI cost observability / "how efficiently are engineers coding vs. expectation."
- **The trap:** *individual efficiency scoring* is the exact landmine that maimed LinearB, Jellyfish, and Swarmia. It's statistically invalid (can't see task difficulty from telemetry), gets gamed (Goodhart), and gets the tool branded as spyware — which kills bottom-up adoption.
- **The reframe:** *AI-leverage intelligence* — "where is AI helping vs. hurting this team, and how do we get better leverage?" — plus **contextual evidence for human-owned evaluation.**
- **Positioning fork to resolve:** FinOps-for-AI (cost story, buyer = platform/eng-ops) vs. Engineering-intelligence (outcomes story, buyer = VP Eng/CTO). Pick the spear tip; don't be both at v1.

## What the incumbents get wrong (from forum/review research)

- **Numbers don't match lived experience** (esp. Jellyfish) → credibility death. Manager trusts their eyes, tool becomes shelfware.
- They measure **git/Jira activity, not the actual work**; no complexity weighting. Ten trivial PRs beat one hard architectural change.
- **Jellyfish:** needs near-perfect Jira hygiene + data is ~24h stale.
- **Surveillance perception kills adoption.** LinearB has the scars (started with individual comparison, spent years running from it). Swarmia's entire identity collapsed to "the tool developers don't hate."
- **Numbers without action items** — a gauge, not a next step.
- Per-seat pricing pain, slow/unintuitive setup, poor time-to-value.
- **The white space nobody owns:** can't prove AI *caused* a speedup; can't tie AI-generated code to its *later* rework/bugs; can't say which tool (Cursor/Copilot/Claude Code) gives the best speed/quality tradeoff. **← this is fennec's wedge and moat.**

## Scoring philosophy

- **Do not build a developer "credit score."** A context-aware composite scalar is still a scalar — false precision + Goodhart + the thing that gets you branded spyware. More inputs don't fix it; they hide the problem.
- **Score artifacts and AI-interactions, not people.** "This AI-generated PR was reworked 3× in 30 days" = safe, evidence-backed observation. "This engineer is a 6/10" = judgment with no evidence. Aggregate to team patterns; **never a per-person leaderboard.**
- **Automate the evidence, not the verdict** (radiology-AI model: machine flags + contextualizes the scan, the human decides). Deliverable = an **evidence-backed contribution dossier** (clickable down to prompts + diffs) that does ~90% of review prep. Manager owns the call.
- **Every score decomposable to its evidence** — one click to the prompts/commits behind it. Auditability is THE feature; it's the direct fix for "doesn't match lived experience."
- **Calibrate against downstream truth** (revert / rework / bug), not against peers.
- **Refuse to score when signal is insufficient.** Show "not enough data," never a confident number off three commits.
- **Pick metrics where gaming = the desired behavior.** e.g. "AI code that survives 30 days without rework" can only be gamed by actually reviewing AI output carefully. Fitness-tracker principle: if the cheat is the goal, the metric won.
- **Cleaner target than productivity:** "was AI used well in this interaction" is measurable (accepted/edited/reverted, model-vs-task fit). "Is this engineer productive" is not.

## Inputs / integrations

- **Trustworthy spine (score-eligible):** git + AI-interaction telemetry (prompts, accept/edit/revert, model choice, downstream rework).
- **Context only — NEVER scored:** Slack (scoring it rewards the loudest person, punishes heads-down seniors), Jira (process-hygiene proxy, not work). Great for enriching the dossier, never a graded dimension.
- **Identity resolution** across GitHub / Jira / Slack / email is a genuinely hard sub-problem (same human, many handles). Budget for it.

## Access & visibility model

- **Manager access scoped DOWN the org subtree only** (least privilege, no lateral/upward snooping) — correct, keep it.
- **Keep developer self-visibility:** a developer can always read their own node. Same RBAC rule, one addition. Org-tree scoping and dev visibility are NOT in conflict.
- **Symmetric visibility = the trust moat:** the developer sees *exactly* what their manager sees about them. No hidden manager-only view. Make it a hard product guarantee — it's also a forcing function (if you'd be uncomfortable showing the dev a metric, it shouldn't exist).
- **Dev view = speedometer** (real-time, self-coaching, makes devs *want* it installed), not a retrospective report card.
- **Manager-only / covert is a one-way door:** the day one engineer finds the hidden capture tool, trust is gone regardless of responsible use. Also kills the coaching product, and is a legal problem (EU works-council consent, NYC Local Law 144 bias audits, EU AI Act = employment decisions are high-risk).
- **Reports:** optional, manager-generated — but **evidence-linked** (not context-free numbers, or you've reintroduced the original problem), and consider **notifying the subject** when a report about them is generated ("you'll always know when you've been written up" = strong trust feature).

## Org-defined rubric — with guardrails

- Let orgs define dimensions/weights so it fits their existing review process (flexibility = sales win).
- But fennec must **not be a neutral pipe for toxic metrics.** Ship opinionated, research-backed defaults + **active warnings** when an org wires up a known-bad metric (e.g. LOC). Override allowed, but *against stated advice.* The guardrail is itself a differentiator.

## Open decisions (yours to resolve)

1. **Spear tip:** cost (FinOps) vs. outcomes (AI-leverage intelligence)? — leaning outcomes; that's where the moat is.
2. **First customer:** platform-eng lead with a runaway AI bill, or CTO needing AI-ROI proof? Different product.
3. **Per-person score in reviews — yes/no?** Strong recommendation: evidence dossier + human verdict, not an auto-score.
4. **v1 capture surface:** recommend **Claude Code / Codex local file-watch ONLY** for the demo — no browser extension, no TLS-MITM. Proves the prompt→outcome thesis fast; the browser extension is where a month disappears.
5. **Scope realism:** the full spec (daemon ×3 OS + browser ext + IDE ext + backend + multi-tenant cloud) is 6–12 months, not 4–8 weeks. Cut v1 hard.

## Reality checks

- Solo dev: build **cloud-first**, ship self-host as the *same code* via docker-compose. Don't let it fork into two products.
- The **AI-attribution wedge is the moat**; a DORA dashboard is table stakes. Lead with the moat.
