# Pitfalls Research

**Domain:** AI usage/cost observability — local capture daemon + cloud backend, n8n-style distribution (self-host + managed), multi-tenant.
**Researched:** 2026-05-31
**Confidence:** HIGH for items grounded in synapse's lived experience (BUGS.md, CONCERNS.md, prior PITFALLS.md). HIGH for browser-extension and Manifest V3 limitations (verified against Chrome for Developers docs). HIGH for cost reconciliation pitfalls (Anthropic/LiteLLM bug reports). MEDIUM for compliance specifics (SOC2/GDPR/HIPAA — laws are public, applicability to fennec needs counsel verification before sales claims).

Pitfalls below are ordered by expected blast radius for fennec's domain. Each pitfall has an observable warning sign (file, log line, query, metric) — not vibes. Prevention is mapped to a roadmap phase so the orchestrator can wire it into success criteria.

The taxonomy mirrors the question's structure: privacy/secrets → capture fragility → multi-tenant isolation → outcome correlation → cost accuracy → daemon lifecycle → license/self-host → adoption/surveillance → browser-capture surface → synapse-inherited lessons.

---

## Critical Pitfalls

### Pitfall 1: Captured prompts contain secrets that leak into the cloud backend or breach surface

**What goes wrong:**
A developer pastes a `.env`, a stack trace with a DB URL, a `curl` command with a Bearer token, or a customer PII row into Claude Code / Codex / Cursor / ChatGPT. The daemon captures the prompt verbatim, queues it, syncs to fennec's Supabase. Now those secrets sit in `prompts.body` indefinitely. The next breach (compromised Cloudflare token, Supabase service-role key exfil, malicious insider, SQL-injection in dashboard, accidental public S3 export for analytics) reveals every secret every developer in every customer org has ever pasted into a prompt. This is a **GDPR Article 33 breach** for any EU prompts, a **HIPAA 45 CFR 164.408 breach** for any PHI, a **SOC2 CC6.1 control failure**, and an existential brand-trust event.

**Why it happens:**
Three converging forces:
1. The natural way to ship v1 fast is "store prompts raw, redact later in the UI." That's correct for capability but catastrophic for liability — once raw is in cold storage, "later" becomes "after the breach."
2. The team reads "we self-host" as the privacy answer for enterprise and assumes SaaS-tier customers tacitly accept the risk. Customers haven't — they assume any observability tool redacts at source.
3. Secret-scanning is hard to do well: gitleaks/trufflehog catch common patterns (AWS keys, GitHub tokens, Stripe keys) but miss custom auth tokens, PII, and free-form business secrets ([Snyk's 2025 report: 28M+ secrets leaked on GitHub alone](https://snyk.io/articles/state-of-secrets/)).

**How to avoid:**
1. **Redact at capture time, not ingest time.** The daemon must redact before the event ever leaves the user's machine. The cloud should *never* see raw secrets. Ingest-time redaction is a defense-in-depth layer — not the primary defense. Reasoning: ingest-time redaction puts the secret in transit over the wire (TLS-terminating proxies may log it), on the worker's stack (logged on uncaught exception), and on the database's WAL/backups for the redaction window. Capture-time redaction means the raw never exists outside the user's machine.
2. **Ship two-layer redaction in the daemon**: (a) high-entropy + known-pattern scan using gitleaks' default ruleset (the rules are TOML, [embeddable freely](https://github.com/zricethezav/gitleaks) — vendor the ruleset, do not depend on the binary), (b) a customer-configurable regex list for org-specific tokens. Both run synchronously before `appendEvent`. Redacted regions become `[REDACTED:TYPE]` placeholders so the prompt still parses for analytics (length, model-fit lens) without exposing the secret.
3. **Hash, don't store, when possible.** The model-fit lens (Phase 2 differentiator) needs `prompt_length`, `tool_calls`, `model_used`, and a coarse classifier (debug? boilerplate? doc?). It does **not** need the literal prompt text. Store the literal text only when the user explicitly opts a project into "store prompts" mode for drill-down. Default to **structural metadata + redacted excerpt**, opt-in to full text.
4. **Per-org data retention** must be a v1 setting, not a v2 feature. Default 30 days for prompts in SaaS, 90 days for self-host, with a hard delete path that survives backups (logical delete + retention policy on Supabase point-in-time-recovery).
5. **Sign a DPA template (Article 28) before the first enterprise sale.** [Mandatory for EU B2B SaaS](https://secureprivacy.ai/blog/data-processing-agreements-dpas-for-saas). Without it, EU sales are blocked.

**Warning signs (observable):**
- `grep -i "sk-\|ghp_\|AKIA\|Bearer " backend/db/prompts.body` returns >0 rows on a sample dump → redaction failed at capture; this is a P0 incident.
- A customer files a "delete me" GDPR Article 17 request and the engineering team can't honor it within 30 days → there's no deletion path, you're noncompliant the moment the request lands.
- A self-hoster reports `[REDACTED:AWS_KEY]` is rendering wrong in the dashboard → integration is wired correctly; the warning sign is the absence of these markers in prod data.
- Wrangler tail shows `error: invalid JSON` on the ingest endpoint and the body contains a `sk-...` substring → daemon's redactor missed it; ingest-time defense-in-depth saved you this time.

**Severity:** CRITICAL — single largest existential risk in this domain.

**Phase to address:** **Phase 1 (Capture daemon).** Must ship with redaction wired before the daemon writes its first cloud event. This is non-negotiable; cannot be retrofitted safely. Verification: every event in `cloud.prompts` has a `redaction_applied_at` timestamp and the redactor's version hash, and a smoke test pastes 10 canary secrets through the daemon and asserts 0 reach the backend.

---

### Pitfall 2: Capture-time redaction is "best effort" and silently misses customer-specific secrets

**What goes wrong:**
Pitfall 1 says redact at capture. Fine — but the daemon ships with gitleaks' default rules, which know about ~150 well-known secret patterns. A customer's internal auth token format (`acme_prod_xxxx`), a customer's internal employee ID format, a customer's internal hostname (`db.acme-internal.com`), a customer's PII (names, emails, social security numbers in a debug snippet) — none of these match the defaults. The daemon happily captures, the cloud happily stores, and the customer doesn't notice until their CISO runs a compliance audit and finds employee SSNs in fennec's database.

**Why it happens:**
Default redaction rulesets cover developer-secret patterns, not enterprise-PII. ML-based PII detection (Presidio, AWS Comprehend) is heavier and slower than regex — pressures the daemon's hot path. So teams ship "good enough" defaults and stop.

**How to avoid:**
1. **Customer-configurable redaction rules.** Surface a UI in the dashboard (and a config file for self-host) where org admins can add their own regex patterns. Daemon pulls these rules at startup and on a refresh interval (5 min). Reject rules that don't compile.
2. **A "secret drill" test.** Before customer onboarding, the customer pastes 5-10 realistic prompts containing their org-specific tokens into a sandbox. Daemon shows them what got redacted (highlighted in red) and what didn't. They iterate until everything sensitive is redacted. This becomes part of the onboarding checklist.
3. **Layered: client + ingest + storage.** Daemon redacts → ingest re-redacts (defense in depth + catches old daemons) → storage encrypts at rest with per-org KMS keys (rotates the blast radius down).
4. **Don't claim "PII-safe by default."** Marketing copy must say "redacts common secret patterns; org-specific PII redaction requires configuration." Overclaiming is the lawsuit vector — under-claiming is the trust win.

**Warning signs:**
- Onboarding checklist doesn't include a redaction drill → customer will find a PHI/PII leak in their first audit.
- Self-host config doesn't expose a redaction.yaml → customers can't comply with their own data classifications.
- Dashboard renders raw prompt text without highlighting redacted regions → no way to verify redaction is working without a SQL dump.

**Severity:** CRITICAL — the failure mode is silent compliance violation.

**Phase to address:** **Phase 1 (Capture)** for default rules, **Phase 3 (Multi-tenant dashboard)** for the customer-configurable rules UI.

---

### Pitfall 3: Capture adapter breakage goes silent — tool changes, daemon keeps running, data disappears

**What goes wrong:**
Synapse documented this exact issue ([synapse/.planning/research/PITFALLS.md](file:///Users/Tanmai.N/Documents/synapse/.planning/research/PITFALLS.md)). Tool transcript formats change between versions: Codex CLI rotated its session JSONL path during 2025 ([~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl](https://inventivehq.com/knowledge-base/openai/where-configuration-files-are-stored)); Cursor's storage moved from a single SQLite into a multi-database stack ([ItemTable composerData vs legacy aichat.chatdata vs aiService.prompts](https://vibe-replay.com/blog/cursor-local-storage/)); Claude Code's hook system has had multiple breaking changes in 2.0.x ([SessionStart hooks no longer display user-visible messages as of 2.1.0](https://github.com/anthropics/claude-code/issues/10373), [hook duplicate-message bug 2.0.17-2.0.22](https://github.com/anthropics/claude-code/issues/9602), [UserPromptSubmit race condition](https://github.com/anthropics/claude-code/issues/17277)). When the format changes, the adapter silently captures zero events. Fennec's dashboard shows "AI usage down 40% this week" — the customer assumes their team stopped using AI, not that fennec broke.

**Why it happens:**
1. Adapters are opportunistic file watchers. They don't have a contract with the upstream tool.
2. "Zero events" looks identical to "user took a vacation."
3. Schemas evolve under the tool's product needs, not fennec's stability.
4. A `try/catch` in the adapter swallows the parse error and returns "no new events" instead of "I failed to parse."

**How to avoid:**
1. **Every adapter must emit a heartbeat event regardless of whether it found new transcripts.** `AdapterHeartbeat { adapter: "cursor", version_detected: "0.42.1", schema_hash: "abc...", events_parsed: 0, parse_errors: 2 }`. The backend tracks adapter heartbeats per machine and alerts the customer when `events_parsed > 0` flips to `events_parsed == 0 && parse_errors > 0` for >24h.
2. **Schema-hash detection.** Every adapter computes a hash of the first few lines / table columns / hook payload shape on startup and pins it. If the hash changes, the adapter logs "schema drift detected, falling back to safe mode" and stops auto-parsing. Customer gets an in-dashboard banner: "Cursor 0.43 broke our adapter — we're updating, your data for the last X hours is being captured but parsing is paused."
3. **Adapter contract tests** maintained against snapshot transcripts of every supported tool version. CI runs them on every adapter change. New tool version comes out, the snapshot adds a row, CI either passes (forward-compatible) or fails (forces an adapter update).
4. **Graceful failure mode = "we lost this surface" UI.** When an adapter is broken, the dashboard explicitly says "Cursor capture is offline" with a doc link, not "no Cursor activity." Asymmetric: silent absence is the trap.
5. **Version pinning + version-skew telemetry.** Daemon reports installed adapter versions on every heartbeat. Backend computes "fleet adapter version distribution." When 10% of a customer's machines lag the latest adapter by >2 versions, that's a "push your developers to upgrade" signal in the admin dashboard.

**Warning signs:**
- A customer-facing dashboard chart goes flat for a specific tool while other tools' charts stay healthy → adapter is silently broken.
- `SELECT adapter, COUNT(*) FROM events GROUP BY adapter, DATE(captured_at)` shows a sudden drop for one adapter on the same calendar week the upstream tool released a major version → highly correlated with adapter break.
- Adapter heartbeats stop arriving from a machine while the daemon log says "running OK" → adapter crashed silently inside an otherwise-healthy daemon.

**Severity:** CRITICAL — the product's pitch is "we see *everything* your org spends on AI." A broken adapter directly invalidates that.

**Phase to address:** **Phase 1 (Capture)** for the heartbeat + schema-hash mechanisms; **Phase 4 (Adapter maturity)** for the version-skew dashboard.

---

### Pitfall 4: Browser capture is fundamentally unreliable — Manifest V3, corporate IT, and cert-trust constraints

**What goes wrong:**
PROJECT.md acknowledges browser is the hard surface. Concretely: (a) Manifest V3 [removed the blocking `webRequest` API](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests) for general extensions — only `declarativeNetRequest` remains, with a [30,000-rule cap and no callback-based interception](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), meaning the extension can *block/redirect* but cannot *read response bodies* of API calls; (b) the extension can only see DOM-rendered content, which means stream-rendered ChatGPT/Claude.ai responses are visible but raw API payloads (cached tokens, tool-call structures, latency) are not; (c) the proxy fallback requires installing fennec's CA cert system-wide, which corporate IT will [reject outright](https://www.zscaler.com/blogs/product-insights/ssl-inspection-developer-environments-unlock-advanced-threat-protection) — they already have Zscaler/Netskope, fennec can't be a second MITM in the chain ([cert pinning breaks if double-intercepted](https://help.zscaler.com/zia/certificate-pinning-and-ssltls-inspection)); (d) the extension surface itself is a security red flag — [a January 2026 campaign compromised 900K+ users via malicious "AI assistant" Chrome extensions](https://thehackernews.com/2026/01/two-chrome-extensions-caught-stealing.html) that scraped ChatGPT/Claude DOM. Fennec's extension will be guilty by association unless it positions itself with extreme caution.

**Why it happens:**
The fundamental tension: to capture *what was sent to the model*, you need access to the network request. Modern browsers deliberately don't give that to extensions because that's literally what malware wants. So fennec has to choose: (1) DOM scraping — fragile, incomplete, misses caching headers and tool-call payloads, (2) proxy with cert install — won't pass enterprise IT, (3) browser dev-tools protocol — works but requires running Chrome in remote-debugging mode, (4) skip browser entirely — but then the pitch "we see *everything*" is broken.

**How to avoid:**
1. **Recommend the corporate browser AI policy path.** For enterprise customers, the answer is *not* "install our extension on every developer's browser." It's "configure ChatGPT/Claude.ai admin consoles to export usage data via their APIs" (Anthropic and OpenAI both ship Workspace/Org-level analytics APIs in 2026). Position the fennec browser extension as the *individual / SMB* path and the *org-level export integration* as the enterprise path.
2. **Be honest in marketing.** "Browser capture covers DOM content of ChatGPT and Claude.ai chats — full prompts and responses. It does NOT capture raw API metadata (cache hits, tool-call payloads), which is a known limitation of Manifest V3." This is the [n8n / Activepieces honest-positioning move](https://www.activepieces.com/blog/what-is-n8n) and it earns trust faster than over-claiming and being caught.
3. **Don't ship a TLS-intercepting proxy at all in v1.** The friction-to-payoff ratio is wrong. Skip it. Revisit in v2 only if a paying customer demands it AND is willing to install the cert org-wide.
4. **Build the extension with the same security review as a security tool would face.** Publish the source. Get a security review from a third party (Trail of Bits, NCC) before listing in Chrome Web Store — the [malicious-extension scandal](https://www.ox.security/blog/malicious-chrome-extensions-steal-chatgpt-deepseek-conversations/) means the store reviewers will scrutinize permissions aggressively. Use minimal permissions (`activeTab` not `<all_urls>`, no `cookies`, no `webRequest` scope).
5. **Never read user session cookies.** That's the line you do not cross. The extension reads page DOM only. Auth is handled by the user signing into fennec.app from the same browser; the extension talks to fennec via its own auth, not by piggybacking on the user's ChatGPT/Claude.ai session.
6. **Audit log every captured page.** Each browser-captured prompt has a `source_tab_url`, `dom_capture_timestamp`, `extension_version`. If a customer says "the extension is reading things it shouldn't," there's an audit trail.

**Warning signs:**
- Extension review fails Chrome Web Store policy due to permissions → had wrong scope; fix before launching publicly.
- Enterprise sales conversation hits "I'm not installing your CA cert" early → expected; pivot the conversation to "we don't require that, here's the API integration path."
- Browser-captured token counts are systematically lower than vendor-billed token counts → cache hits aren't visible to DOM scraping; expected limitation, document it.

**Severity:** CRITICAL for product positioning, CRITICAL for trust. Existential if mishandled.

**Phase to address:** **Phase 2 (Adapter maturity)** — start with CLI/IDE adapters in Phase 1, defer browser to Phase 2. Be willing to ship v1 without browser if it's not stable. The "all 4 surfaces" goal in PROJECT.md is the marketing pitch; v1 can ship with 3 of 4 honestly and a "browser coming Q3" callout.

---

### Pitfall 5: Multi-tenant data isolation is enforced in application code, not the database — one missing check leaks tenants

**What goes wrong:**
Synapse hit this exact bug, three times ([CONCERNS.md "/api/events/batch writes events without project membership check — Critical"](file:///Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md), [project-status without membership check](file:///Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md), [project-events without membership check](file:///Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md)). The backend uses Supabase's `service_role` key, which bypasses RLS ([documented Supabase footgun](https://supabase.com/docs/guides/database/postgres/row-level-security)). Every API handler is therefore the sole defender against cross-tenant data spillage. One handler that forgets the `requireRole(db, project_id, user.id)` check, and an authenticated user can paginate through another customer's prompts.

**Why it happens:**
1. The service-role pattern is fast to develop with — no fighting RLS during prototyping.
2. RLS policies are [hard to debug across joins](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) and add per-query overhead.
3. The discipline ("never write a handler without the membership check") breaks under deadline pressure or copy-paste.
4. The failure mode is invisible — the leak doesn't show up in your own testing because your test user has access to everything.

**How to avoid:**
1. **Defense in depth: BOTH service-role with mandatory check AND RLS as a backstop.** Even if you use the service-role for performance, enable RLS on every customer-data table and write a baseline policy. The application-code check is still mandatory, but if it fails, RLS catches it. Belt + suspenders.
2. **Mandatory middleware on every project-scoped route.** Hono middleware ordering: `authMiddleware → projectScopeMiddleware → handler`. The `projectScopeMiddleware` reads `:project_id` from path, calls `requireRole`, sets `c.var.project = { id, role }`. Handlers that need a project read from `c.var.project`, never from the URL directly. Routes that don't use the middleware can't read project data — enforce this via a route-level check at startup ("every route under `/api/projects/:id/*` must have the middleware").
3. **Pre-commit hook that grep's for unsafe patterns.** A simple script: any new handler in `backend/src/api/` that takes a `project_id` from the URL/body must contain `requireRole` or `projectScopeMiddleware` in the same file. Block the commit if not.
4. **Quarterly tenant-isolation drill.** Spin up two test orgs, one admin in each. Try every endpoint with each other's IDs. Every endpoint that returns data when it shouldn't is a P0 ticket. This is a 1-hour drill that prevents the worst-case "discovered by a customer security audit" path.
5. **Service-role key handling.** The service-role key never leaves the backend Worker. Never put it in `.env` of the daemon, the frontend, or CI logs. Rotate quarterly. Treat it like a root cred.

**Warning signs:**
- New API handler PR without a membership check in the diff → block in review.
- A customer accidentally enumerates UUIDs and sees data → catastrophic; this should have been caught by the drill.
- The frontend renders a "you don't have access" 403 from one route but accidentally gets data from another → inconsistent enforcement; audit immediately.
- Test fixtures use a single user with access to all projects → can't catch isolation bugs; fix the fixtures.

**Severity:** CRITICAL — single tenant leak destroys the trust that took years to build.

**Phase to address:** **Phase 3 (Multi-tenant backend / dashboard).** Verification: every route in `backend/src/api/` is covered by a tenant-isolation test that asserts 403 when a user tries to access another tenant's project_id.

---

### Pitfall 6: Outcome correlation over-claims — "this prompt wrote 60% of the commit" when it's actually fuzzy matching

**What goes wrong:**
The model-fit + outcome lenses are fennec's differentiation. The honest mechanism is fuzzy string-matching: take the code blocks the AI emitted in the prompt's response, scan the next N minutes of git commits for code that's ≥X% similar, attribute the prompt → commit if similarity passes. This is a *heuristic*. But the dashboard says "Sarah's prompts produced 4,200 lines of shipped code this week" with a number, not a confidence interval. Engineering manager prints the chart, presents in a quarterly review, lays off Bob who showed "127 lines" — Bob was reviewing PRs, mentoring, debugging. Fennec just enabled a wrong layoff. Beyond the moral disaster, this is the [GitClear failure mode the research literature has called out](https://arc.dev/talent-blog/impact-of-ai-on-code/): keyword-based AI attribution [has accuracy that drops from 88% to 1% under adversarial conditions](https://arxiv.org/pdf/1905.12386), and 77-81% of developers can be impersonated by their teammates.

**Why it happens:**
1. Fuzzy matching is precise-enough for *directional* claims ("usage is going up") but lacks the rigor for *individual* claims ("Bob writes less AI code").
2. The temptation to render a single confident number is overwhelming — "AI attribution: 47%" is more clickable than "AI attribution: 47% ±18% (heuristic)."
3. Multi-author confounds: pair programming, code review back-and-forth, partial AI assistance, refactored code — all blur the boundary.
4. Time-window confounds: prompt at 3:14pm, commit at 4:02pm — did the prompt's code make it in, or did the dev type it from scratch, or did they pull a stale branch?
5. Revert confounds: AI wrote it, dev shipped it, code review reverted it — does that count as "AI shipped"? Fennec must decide.

**How to avoid:**
1. **Surface confidence with every attribution number.** No raw "60% AI" — always "60% AI (heuristic match, medium confidence)" or render a tooltip with the method and caveats. Borrow the OpenTelemetry GenAI semantic conventions approach ([opt-in content recording, structured attributes with confidence](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)) — explicit signal of what's measured vs inferred.
2. **Default views are aggregated and anonymous.** The default per-user view is opt-in for the individual; the default org view shows team-level aggregates with no per-developer breakdown. Engineering managers can drill into individual views, but the UI surfaces a friction warning ("Individual usage data is intended for the developer's self-reflection, not performance evaluation. Read the methodology before using.").
3. **No vanity metrics.** "Lines of AI code" should not be the headline number anywhere. The headline should be "cost per shipped PR" (project-level) or "model-fit score" (your model-of-choice for this task), both of which are less weaponizable.
4. **Publish methodology.** A public doc explaining: how attribution is computed, what the confidence levels mean, why a low AI-attribution number does NOT mean a developer is unproductive (they might be reviewing, mentoring, on-call, doing customer support, fixing infrastructure). Link to it from every per-user view. This is the [SPACE-vs-DORA disclaimer](https://www.allstacks.com/blog/dora-metrics/) framing applied to AI attribution.
5. **Avoid time-window single-shot matching.** Use a multi-signal match: code similarity AND temporal proximity AND same-author AND not-in-stash-before-prompt. Each signal is a confidence boost. Single-signal matches are flagged "weak."
6. **Reverts are explicit.** If a commit is reverted within 7 days, the attribution is downgraded to "shipped then reverted" — not silently subtracted from totals (that erases history) but flagged in the analytics.

**Warning signs:**
- A customer manager screenshots the per-dev view and posts it in a team Slack as a ranking → critical adoption issue, push back hard.
- Methodology page has <100 views/month → docs aren't being read; bake the confidence levels deeper into the UI.
- A developer files a bug "fennec missed a prompt I clearly wrote with AI" → false-negative is fine, false-positive is unacceptable. Tune toward false-negatives.
- A customer asks "can I export this to BambooHR / Workday" → they're using it for performance review. Decide whether to make this hard (recommended) or block it entirely.

**Severity:** CRITICAL for trust + ethics. Misuse is what kills adoption fastest, and the product's design choices shape misuse risk.

**Phase to address:** **Phase 4 (Dashboards)** for the UI affordances; **Phase 2 (Outcome correlation engine)** for the confidence-scoring algorithm itself. Both must be in place before the per-user view is shown to customers other than the indie tier.

---

### Pitfall 7: Cost / token counts don't match the vendor's invoice — customer says "you're wrong"

**What goes wrong:**
Daemon captures `usage.input_tokens = 8421`, applies $3/MTok pricing, says "$0.025." Customer's Anthropic invoice at end of month says they spent $400 less than fennec reported, or $400 more. Customer assumes fennec is broken. Trust erodes. Three concrete causes:
1. **Anthropic and OpenAI prompt caching.** [Cache reads cost 10% of input price, cache writes cost 125-200% of input](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). The daemon doesn't know if a prompt hit the cache — that's known only from the response's `cache_creation_input_tokens` / `cache_read_input_tokens` fields. If the daemon captures the request body but not the response usage block, or aggregates incorrectly, the cost calculation is wrong by 70-90%. ([LiteLLM had this exact bug — input tokens were double-counted as both "prompt tokens" and "cache creation tokens"](https://github.com/BerriAI/litellm/issues/9812)).
2. **Mid-month pricing changes.** Anthropic and OpenAI revise prices ([Anthropic raised Claude 3.5 Sonnet prices in 2025](https://platform.claude.com/docs/en/about-claude/pricing)). If fennec hardcodes prices, the moment a customer sees a different number on their invoice, they call BS.
3. **Free-tier / included usage.** GitHub Copilot is [bundled in seat licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses) — $19/user/mo flat. ChatGPT Pro is $20/mo flat. The customer hasn't "spent" extra tokens; the seat fee is the cost. Fennec computing "$X in tokens" for these surfaces is double-counting.

**Why it happens:**
The simplification "tokens × price = cost" works for raw API usage but breaks for everything else. Subscription products, caching, prompt batching, free tiers, regional pricing, discounts — every one is a delta.

**How to avoid:**
1. **Distinguish "estimated cost" from "billed cost."** Two separate columns. Estimated cost is fennec's daemon-derived number with full disclosure of method. Billed cost is the actual invoice amount, which fennec pulls in via the provider's billing API ([Anthropic admin API, OpenAI billing API](https://platform.claude.com/docs/en/about-claude/pricing)) once a month and reconciles. Reconciliation deltas are surfaced as "estimation off by X%" — the customer sees the gap and trusts the methodology.
2. **Capture the full response usage block.** Daemon must capture `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` separately. Don't aggregate at capture; aggregate at query time so the data model can absorb pricing updates.
3. **Pricing table is data, not code.** Maintain a `model_pricing` table with effective-date ranges. Cost queries do a temporal join `WHERE event_at BETWEEN effective_from AND effective_to`. When Anthropic updates prices, edit one table, not deploy code.
4. **Different cost model for subscription products.** For Copilot/ChatGPT-Pro/Claude-Pro-on-claude.ai, surface "included in seat license" rather than a token cost. Don't double-count.
5. **Document the reconciliation gap.** Every cost view has a footer: "Estimated cost based on token capture + current pricing. Actual billing may differ due to caching, discounts, and billing-cycle alignment. Verified against last month's invoice: ±2.3%."
6. **OpenTelemetry GenAI compliance.** Use [the standard `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` attribute names](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — gives a vendor-neutral foundation and customers who already have OTel pipelines feel at home.

**Warning signs:**
- Customer's monthly support ticket: "your dashboard says we spent $X but our Anthropic bill says $Y" → reconciliation isn't visible enough.
- Estimation accuracy <±10% on a given week → caching detection is broken; bug.
- Costs for Copilot users are non-zero in the dashboard → subscription model isn't handled; bug.
- A customer's cost number changes after a hard refresh by >5% → cost is being computed on the fly with mutable inputs; cache the snapshot.

**Severity:** HIGH — every customer's first dashboard load is "is this correct?" Wrong numbers = no trust = churn.

**Phase to address:** **Phase 2 (Backend + ingestion)** for the data model (cache tokens separately); **Phase 4 (Dashboards)** for the estimated-vs-billed UI; **Phase 5+ (Enterprise)** for the provider-API reconciliation.

---

### Pitfall 8: Developer surveillance perception kills bottom-up adoption — "fennec is watching me"

**What goes wrong:**
A startup IT team installs fennec across the dev org. Day 1, a Slack channel lights up: "what is this daemon? It's capturing my prompts? Including the one where I asked Claude to fix the bug in my side-project code I shouldn't have been working on at 2am?" Trust collapses overnight. Half the team uninstalls the daemon (it's a user-space process — they can). Manager pushback. EU offices invoke their works council. [Research is unambiguous: AI monitoring → resistance, complaints, intent to quit](https://www.shrm.org/topics-tools/news/employee-relations/ai-surveillance-in-the-workplace-linked-to-employee-resistance--). [The EU AI Act treats workplace surveillance as high-risk](https://www.europarl.europa.eu/RegData/etudes/STUD/2025/774670/EPRS_STU(2025)774670_EN.pdf).

**Why it happens:**
The product is genuinely capturing developer activity to compute cost/usage analytics. The framing "AI cost observability for engineering leaders" sounds neutral, but to a developer, "tool installed on my laptop that reads my prompts and reports to my manager" reads as surveillance. The truth is somewhere in between, but the perception is what kills adoption.

**How to avoid:**
1. **The dashboard's default view is org-level cost, not per-developer.** Per-developer views are opt-in (the developer enables them for self-reflection) or admin-gated (the org admin can see them, but the surface explicitly warns about misuse). This is the [anonymized-by-default pattern](https://trustarc.com/resource/employee-data-privacy-balancing-monitoring-and-trust/) that mitigates surveillance perception.
2. **The developer sees what fennec sees.** A `fennec inspect` CLI command shows the developer every event captured from their machine in the last 24h, with redactions visible. Transparency is the trust win. Add an [in-tool consent moment on first daemon run](https://posthog.com/blog/open-source-telemetry-ethical) ("fennec will capture AI prompts from these tools and send them to your org's fennec instance. Continue? View privacy policy.").
3. **Pause / private-mode.** The developer can pause capture for 30 min ("I'm prototyping personal code") with one CLI command. The pause is logged ("fennec was paused for 30 min on 2026-05-31 14:00") but the prompts during that window are not captured. This single feature defuses the "I can't do anything personal on my work laptop" objection.
4. **Marketing pivots away from "track your developers."** Use [GitLab's framing](https://about.gitlab.com/blog/gitlab-loves-mattermost/): "understand your AI spend by project, choose the right model for the right task." The customer is the engineering leader buying budget visibility, NOT the manager performing reviews. The product should make the second use case actively hard.
5. **EU works council compliance.** For EU enterprise sales, the [Eurofound employee monitoring guidance](https://www.eurofound.europa.eu/en/publications/all/employee-monitoring-moving-target-regulation) requires consultation with the works council before installation. Fennec ships a "works council brief" document (1-pager explaining what's captured, retention, redaction, employee rights) that the customer hands to their council. This is a sales-enablement asset.
6. **Audit log of admin actions.** When an admin views a specific developer's data, that view is logged and the developer can see (in their personal dashboard) who has viewed their data. Mutually-aware monitoring rebalances the power asymmetry.

**Warning signs:**
- Developer forums on HN / Reddit / Bluesky mention "fennec is keylogger-y" → reputation damage is happening; respond publicly.
- Sales calls keep stalling at "we'd need to consult our works council" without a path forward → ship the works-council brief.
- A customer cancels with "morale was tanking" → the surveillance framing killed it; post-mortem.
- An EU customer asks "do you support the works-council consultation process" → if you don't have an answer in 5 seconds, you're losing the deal.

**Severity:** HIGH — adoption killer. The product can be technically excellent and still fail here.

**Phase to address:** **Phase 4 (Dashboards) and Phase 5 (Distribution).** The per-dev default-view decision is a Phase 4 dashboard call. The pause feature, consent flow, and works-council asset are Phase 5 distribution work.

---

### Pitfall 9: License / self-host pitfall — the n8n model has friction that fennec will inherit

**What goes wrong:**
N8n's Sustainable Use License [restricts commercial use](https://docs.n8n.io/sustainable-use-license/) — you can't sell a SaaS where fennec's value is "substantially" the offering. Adopters love "self-hostable" but the moment a customer wants to white-label or wrap fennec in their internal IaaS-for-engineering, the license blocks. Mattermost faced [community backlash](https://forum.mattermost.com/t/a-critical-response-to-mattermost-s-recent-changes/25407) when they restricted Entry Edition features. Adjacent: self-hosters running outdated versions = CVE exposure that lands as "fennec was breached" headlines; cloud-vs-self-host parity drift = self-host users complain "the cloud has features we don't"; telemetry from self-hosted instances = [PostHog-style controversy](https://posthog.com/blog/open-source-telemetry-ethical) if not handled with explicit opt-in.

**Why it happens:**
The fair-code / dual-license / OSS-with-paid-features models all have known failure modes. The community's tolerance for restriction has dropped post-Elastic/MongoDB/Redis license changes. Any restriction looks like a betrayal of the OSS framing.

**How to avoid:**
1. **Pick the license once, communicate it loudly, and don't change it.** If [n8n Sustainable Use License](https://docs.n8n.io/sustainable-use-license/) is the call, say so in the README, in the docs, on the pricing page, and at install time (`fennec install` shows "by installing, you agree to..."). The most-hated path is "Apache 2.0 → Fair Code mid-flight" (Elastic, Redis). Don't relicense.
2. **Self-host telemetry is opt-in, off by default, with a transparent payload.** [Continue.dev hit a bug where telemetry was sent even when disabled](https://github.com/continuedev/continue/issues/2082) — that's the reputation hit you cannot recover from. Default off. When on, document the exact payload and make it inspectable.
3. **Feature parity: be explicit about what's gated.** SaaS-only features (SSO, audit log export, support SLA) are clearly listed. Self-host gets the same code, only those features are flag-gated. No "self-host is a worse version of the same thing." The Mattermost backlash was specifically about [stripping working features](https://forum.mattermost.com/t/a-critical-response-to-mattermost-s-recent-changes/25407).
4. **CVE process.** When a CVE lands in fennec, push notifications to self-hosters via the daemon (in-product banner) with a 30-day upgrade window before disclosing publicly. Self-hosters who ignore upgrades despite repeated notifications are on their own — but they were told.
5. **Don't promise more than you can deliver.** "Self-hostable" is true. "Drop-in replacement for fennec.app" is something you have to maintain forever — every UI feature, every adapter update, every dashboard polish. Be honest: "self-host gets the same core; cloud-only features X, Y, Z."

**Warning signs:**
- A GitHub issue titled "license change?" gets >10 thumbs-up → community is anxious; address publicly.
- Self-host adoption metric (downloads or active instances reporting via the opt-in telemetry) stalls → feature gap with cloud, or the install path is broken.
- A CVE is disclosed and 60% of self-hosters are on the old version 90 days later → notification path isn't working.
- Cloud-host pricing page is unclear about what's open-source vs paid → either friction in sales or community resentment.

**Severity:** HIGH — distribution model is core to PROJECT.md's strategy; getting it wrong recompounds.

**Phase to address:** **Phase 5+ (Distribution).** License + telemetry decisions need to be locked in before the public repo is published. CVE process is a v1.1+ concern but the channel (in-product banner) must exist in v1.

---

## Moderate Pitfalls

### Pitfall 10: Daemon resource drain — silent CPU/RAM/disk cost = uninstall trigger

**What goes wrong:**
Synapse documented this implicitly via the [`runFlushCycle` reads entire events.jsonl every 10s](file:///Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md) pattern. On macOS, [launchd-driven background processes are a common source of CPU/battery drain complaints](https://discussions.apple.com/thread/6616343). Fennec's daemon watches multiple transcript directories, watches git activity, syncs to cloud — if any of those polls aggressively or reads unbounded files into memory, the daemon shows up in Activity Monitor at 15% CPU. Developer uninstalls without filing a bug. Fennec has no signal except "active machine count dropped 20%."

**How to avoid:**
1. **Resource budgets.** Daemon should target <1% CPU steady-state, <100MB RAM, <50MB/hr disk write. Wire a self-monitor that logs current usage every 5 min. Customers can run `fennec status` and see the numbers.
2. **Incremental file reads.** Track byte offsets, never re-read transcripts. (Synapse's exact bug — has an improvement path in CONCERNS.md.)
3. **Watch-don't-poll where possible.** Use `fs.watch` / `fsevents` / `inotify` rather than polling intervals.
4. **Battery-aware on laptops.** On macOS, listen for power-source changes; back off polling when on battery <30%.

**Warning signs:** `fennec status` shows >5% CPU averaged over an hour, daemon log shows "events.jsonl is N MB" where N>100, customer reports "my laptop fan is on constantly since I installed fennec."

**Severity:** MEDIUM — silent failure mode; only signal is decreased adoption.

**Phase to address:** **Phase 1 (Capture)** initial sizing; **Phase 4 (Dashboards)** for the user-visible `fennec status`.

---

### Pitfall 11: Cross-machine identity merge — same developer on two laptops, fennec sees two users

**What goes wrong:**
Developer has work MacBook and home Linux box. Daemon installs on both. Daemon generates a machine UUID, sends events tagged with that UUID. Without explicit identity tying, fennec shows "User MacBook-Pro-A1234" and "User linux-tower-x9" as separate developers — billing per-user, dashboard per-user, attribution split. Synapse handled this with [cross-device sign-in via API key + repo-URL auto-linking](file:///Users/Tanmai.N/Documents/synapse/README.md) — fennec must do the same.

**How to avoid:**
1. **Sign-in once per machine, API key ties machine to user.** Daemon's first run requires `fennec login` (browser OAuth or paste-token). All events from that machine are tagged with the user's stable user_id.
2. **Per-device tracking inside the user's identity.** Events keep a `device_name` for the dashboard's "your last activity on laptop-A" UX, but billing/attribution rolls up to the user.
3. **Handle multi-account on one machine.** A developer might have a personal account and a work account. Daemon supports profiles: `fennec --profile work daemon`, `fennec --profile personal daemon`. The default profile is `default`. Document this explicitly; expect confusion.
4. **Merge UI for the rare wrong-link case.** If a developer's machines somehow got linked to two different fennec users (e.g., they switched API keys mid-stream), the dashboard has a "merge these users" admin action. Synapse documented exactly this pattern.

**Warning signs:** User count > seat count for a given org (suggests duplicate identities); admin asks "why does the dashboard show two of me."

**Severity:** MEDIUM — billing-impacting; correctness-impacting for outcome correlation.

**Phase to address:** **Phase 1 (Capture / auth)** for the API-key flow; **Phase 3 (Multi-tenant backend)** for merge UI.

---

### Pitfall 12: Windows Defender / corporate EDR quarantines the daemon binary

**What goes wrong:**
[Unsigned Go/Node binaries get flagged by Windows Defender frequently](https://github.com/vercel-labs/agent-browser/issues/382), with `Wacatac.H!ml` being a common false-positive. A developer downloads fennec on a corporate Windows laptop; Defender quarantines the binary on first run, the install seemingly succeeds but the daemon never starts. Customer reports "fennec doesn't work on Windows" — they don't know it was quarantined, and the IT team has no log of the quarantine because Defender deleted the file. PROJECT.md flags Windows as a known friction point.

**How to avoid:**
1. **Code-sign the Windows binary.** EV code signing cert (~$300-700/yr) buys reputation and substantially reduces Defender flagging. [Authenticode signing](https://www.airlockdigital.com/airlock-blog/digicert-incident-and-microsoft-defender-false-positive-what-happened-and-what-it-means) is mandatory for any serious Windows shipment.
2. **Sign macOS binaries too.** Notarize via Apple Developer Program (~$99/yr). Without it, Gatekeeper will block the first run with the "unidentified developer" dialog.
3. **Submit binaries to Microsoft / WDSI for pre-clearance.** Microsoft has a [false-positive submission flow](https://www.airlockdigital.com/airlock-blog/digicert-incident-and-microsoft-defender-false-positive-what-happened-and-what-it-means) that pre-emptively whitelists.
4. **Install path tells the user what to expect.** "Installing fennec on Windows requires admin privileges and a code-signing trust. Click 'install' — if Windows shows a SmartScreen warning, click 'More info → Run anyway.'" The install fails gracefully and tells the user the next step.
5. **Test on Windows before shipping.** Synapse documented Windows as a known friction point that was deferred — fennec must include Windows in the pre-release test matrix.

**Warning signs:** Active-machine count from Windows is <20% of the customer's known Windows seat count; install support tickets that mention "Defender."

**Severity:** MEDIUM — Windows is ~30-40% of enterprise dev machines. Friction here = lost deals.

**Phase to address:** **Phase 1 (Daemon)** for code signing in the build pipeline before Windows beta. Without it, Windows v1 is unshippable.

---

### Pitfall 13: TLS-intercepting proxy fights the corporate TLS-intercepting proxy

**What goes wrong:**
PROJECT.md proposes a TLS-intercept proxy as the browser fallback. But corporate networks already run Zscaler/Netskope/Forcepoint which themselves intercept TLS. [Zscaler explicitly cannot inspect cert-pinned apps like Microsoft 365](https://help.zscaler.com/zia/certificate-pinning-and-ssltls-inspection); two MITM stacks in a chain double the cert chain and break pinning everywhere. The developer's `npm install` fails, `git push` fails, fennec doesn't work — the user uninstalls all three. Synapse hit this directly with [REQ-BUG-03: `npx synapsesync` failed on Netskope](file:///Users/Tanmai.N/Documents/synapse/docs/BUGS.md), fixed with a fallback resolver.

**How to avoid:**
1. **Don't ship a TLS-intercept proxy in v1.** Already in Pitfall 4; reiterating.
2. **Daemon respects system CA store and corporate proxy env vars.** `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` should all work. Test against a Netskope/Zscaler corporate network as part of release QA.
3. **Doctor command surfaces proxy issues.** `fennec doctor` should detect: "I tried to reach api.fennec.app and got X. Likely corporate proxy. Set HTTPS_PROXY to your corp proxy URL." Actionable.
4. **Fallback install paths.** If `npm install` fails on the corporate proxy, the install guide shows `curl -fsSL ... | sh` (direct download). Don't rely on npm/pypi being reachable.

**Warning signs:** Support tickets mention "SSL handshake," "self-signed certificate in cert chain," "Zscaler," "Netskope," "Forcepoint."

**Severity:** MEDIUM — affects a significant minority of enterprise customers; fixable with environmental respect.

**Phase to address:** **Phase 1 (Daemon)** for proxy env-var support; **Phase 5 (Distribution)** for the alternate install paths.

---

### Pitfall 14: Daemon auto-update creates a new attack surface

**What goes wrong:**
Daemon needs to auto-update — adapters break, security patches ship, new tools get added. Naive implementation: `daemon checks for new version every hour, downloads, replaces binary, restarts.` This is a privileged-code-execution path: anyone who can MITM the update endpoint or compromise the update-signing key can push a malicious daemon to every fennec install. Worst case scenario.

**How to avoid:**
1. **Sign every release.** GPG or Sigstore signing; daemon verifies signature before installing.
2. **Update endpoint over HTTPS with cert pinning.** Daemon pins the fennec CA / cert fingerprint. (Yes, the same cert pinning fennec breaks for others — but here it's correct.)
3. **Staged rollouts.** Don't push v1.4 to 100% of fleet on day 1. 1% canary → 10% → 50% → 100% over a week. Catch regressions before they brick everyone.
4. **Manual update path for the paranoid.** Customers who don't want auto-update can disable it and run `fennec update` manually. Default on, configurable off.
5. **Update notes visible.** Each auto-update logs what changed; the user can see in `fennec status` "updated from 1.3 → 1.4 on 2026-06-01: bug fix in cursor adapter."

**Warning signs:** Update endpoint TLS cert changes unexpectedly (CDN provider rotation, key migration); release builds aren't signed.

**Severity:** MEDIUM — low probability, but if it fails, it's a supply-chain incident across the customer base.

**Phase to address:** **Phase 5 (Distribution / Production)** before auto-update is enabled. v1 can ship with no auto-update if the alternative is a hasty implementation.

---

### Pitfall 15: Synapse + fennec coexistence — two daemons on the same machine, shared user

**What goes wrong:**
A likely user (Tanmai, the user) has synapse and fennec both installed. Both daemons hook into Claude Code's SessionStart, both watch Cursor's SQLite, both append to `events.jsonl`-style logs. Race conditions on hook firing; double-flushing the same Claude Code transcript; the user's machine running 2x the resource drain of either alone.

**How to avoid:**
1. **Hook handler chaining, not exclusive.** Claude Code's hooks support multiple entries in `settings.json`. Fennec and synapse can coexist if both write their own entries with unique commands. The user's settings file ends up like `{ "hooks": { "UserPromptSubmit": [{cmd: "synapse-hook"}, {cmd: "fennec-hook"}] }}`. Document this — don't overwrite the user's existing hook entries.
2. **No shared state in `~/`.** Synapse uses `~/.synapse/`; fennec uses `~/.fennec/`. Different ports if there's any local IPC. Different LaunchAgent labels.
3. **Detect coexistence at install time.** `fennec wizard` should detect an existing synapse install and ask "I see synapse is installed. Confirm you want fennec installed alongside?" with docs on how the two relate.
4. **Decide the relationship publicly.** Is synapse → fennec a migration path? Are they peers? Are they meant to merge? PROJECT.md says "independent codebase, not a fork, not a layer." Communicate that clearly so users don't expect data interchange.

**Warning signs:** User reports "weird behavior in Claude Code after installing both" — likely hook collision.

**Severity:** MEDIUM — affects a small set of users (specifically Tanmai's dogfood + early adopters) but they're the most influential users.

**Phase to address:** **Phase 1 (Daemon installer)** for the coexistence-detection logic.

---

## Lower-Severity Pitfalls (still worth tracking)

### Pitfall 16: HIPAA edge case — a healthcare customer wants to use fennec

**What goes wrong:**
A healthcare-adjacent dev team wants fennec. Their AI prompts contain PHI (a developer pasted a patient record into Claude Code to debug a data-import bug). Fennec captures it. Now fennec is processing PHI without a [BAA](https://www.aptible.com/hipaa/hipaa-compliant-ai). HIPAA breach.

**How to avoid:**
1. **No PHI in SaaS tier.** Self-host is the only HIPAA-compliant path. Make this explicit. Sales call: "are you handling PHI? Then self-host."
2. **BAA template ready.** Self-host customers handling PHI sign a BAA with their AI provider directly (Anthropic, OpenAI HIPAA-eligible). Fennec is a tool they self-host; fennec is not the BAA party.
3. **Redact PHI patterns in the default ruleset.** SSN, MRN, phone number patterns. Document the PHI redaction as best-effort defense in depth.

**Severity:** LOW (rare customer) but HIGH if it happens.

**Phase to address:** **Phase 5+ (Enterprise)**, with explicit docs.

---

### Pitfall 17: Demo / staging tenant mixing with prod

**What goes wrong:**
Common SaaS bug. A "demo org" gets created in prod for sales demos. The seed data has fake user identities. A real user joins, their data lands in the demo org, gets shown to the next sales prospect.

**How to avoid:**
1. **Demo data in a separate environment.** Demo is its own deploy, separate Supabase project, separate Cloudflare worker.
2. **Or, hard-coded demo-org-id checks.** If `org_id == "demo-org-xxx"`, route to read-only seed data, never accept real writes.

**Severity:** MEDIUM if it happens.

**Phase to address:** **Phase 5+ (Distribution / Production)** before public demo links exist.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store prompts raw, redact in UI | Fast to ship capture | Liability bomb on first breach | **Never** — capture-time redaction is non-negotiable |
| Use Supabase service-role key for all backend queries | Skip RLS during prototyping | Every handler is the sole defender of tenant isolation (synapse hit this 3x) | Acceptable IF every handler has middleware-enforced checks AND RLS is enabled as a backstop |
| Single ProjectStatus shape, unversioned, used by daemon + backend + frontend | Fast iteration | Version skew → silent brief breakage (synapse-PITFALLS.md Pitfall 6) | Never in v1+; version the shape from day one |
| Hardcoded pricing per model in code | Easy initial implementation | Every Anthropic/OpenAI price change = redeploy | Acceptable for v1 if priced-table refactor is a Phase 2 commitment |
| `fs.watch` polling at 100ms intervals "to be safe" | Fast pickup of new transcripts | Background CPU drain → uninstalls | Never — use OS events or 1-5s polling minimum |
| Cache hits ignored in cost computation | Simpler v1 math | Cost estimates off by 70%+ in cache-heavy customers | Acceptable for v1 if banner discloses "cache-not-detected" estimation |
| Browser extension with `<all_urls>` permission "for flexibility" | One scope to rule them all | Chrome Web Store review red flag, security audit failure | Never — minimal scopes only |
| Backend ingest endpoint accepts any project_id in body | Simple ingestion | Cross-tenant write (synapse CONCERNS.md "Critical") | Never; middleware enforcement is mandatory |
| Unsigned Windows binary "to ship faster" | Skip code-signing setup | Defender quarantines, customer can't install | Never for v1; budget for the cert |
| Skip the works-council brief for EU sales | Saves a day of doc writing | Deals stall at consultation requirement | Acceptable only if no EU sales pipeline; otherwise blocking |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code hooks | Assume hook payload shape is stable | Pin a schema hash; alert on drift; reference [v2.0.x breaking changes](https://github.com/anthropics/claude-code/issues/9602) |
| Cursor SQLite | Read from one DB ([composer.composerData](https://vibe-replay.com/blog/cursor-local-storage/)) only | Read all three (composer, legacy aichat, aiService.prompts); newer Cursor versions may move data again |
| Codex CLI sessions | Hardcode `~/.codex/sessions/` path | Honor `$CODEX_HOME` env var; sessions may move out of `~` |
| Anthropic API responses | Aggregate `input_tokens` as the only cost driver | Capture `cache_creation_input_tokens` and `cache_read_input_tokens` separately ([LiteLLM bug](https://github.com/BerriAI/litellm/issues/9812)) |
| Supabase | Trust `service_role` for everything | Use service_role with mandatory app-layer checks; enable RLS as backstop |
| Cloudflare Workers | One per-request reducer call, full table scan (synapse #1) | Watermark + incremental reduce; the reducer becomes O(new events) not O(total events) |
| Chrome Web Store | Request `<all_urls>` "to be safe" | Minimal scopes; expect aggressive review post-[Jan 2026 malicious-extension scandal](https://thehackernews.com/2026/01/two-chrome-extensions-caught-stealing.html) |
| Windows Defender | Ship unsigned binary | Code-sign with EV cert; submit to WDSI pre-clearance |
| Corporate proxies (Zscaler/Netskope) | Hardcode public CA trust | Respect `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`; `fennec doctor` diagnoses |
| OAuth / API key flow | Long-lived API keys in `.config.json` mode 0644 | Mode 0o600; document; long-term integrate keychain |
| Self-host telemetry | Default-on, opaque payload | [Default-off; opt-in with inspectable payload](https://posthog.com/blog/open-source-telemetry-ethical) |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full re-reduce of project status on every batch | Worker CPU climbing, latency on `/events/batch` | Watermark + incremental fold (synapse already has the pattern in their incremental reducer) | At ~10k events per project / 100+ active projects |
| Reading entire `events.jsonl` every flush cycle | Daemon RAM growing, disk reads constant | Byte-offset reads, rotation at N events / M bytes | At ~100MB events.jsonl |
| `Promise.all` over per-project reducers in one request | 1101 / subrequest-limit errors | `Promise.allSettled`; cap distinct project IDs per request at 20 | At ~25+ distinct projects per batch (synapse-CONCERNS.md) |
| Browser-extension DOM scrape on every mutation | Scroll lag on long ChatGPT chats | Throttled mutation observer + diff-only extraction | At ~50+ message conversations |
| Per-event database write (no batching) | Postgres connection pool exhausted | Batch inserts (100 events per insert); transactional | At ~10 events/sec sustained |
| Backend computing dashboard charts on every page load | Dashboard slow, repeated queries | Materialized views; refresh on event-insert trigger | At ~100k events in scope of a chart |
| Synchronous file I/O in hot daemon paths | Daemon hangs on slow disks | `fs.promises` everywhere; never sync in capture loop | At any disk-pressure event (cloud backup running, etc.) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Daemon writes API key to `~/.fennec/config.json` mode 0644 | Other local processes read the key (synapse-CONCERNS.md "API keys persisted to disk in plaintext") | Mode 0o600; long-term keychain |
| Frontend reads project data without checking membership in the URL | Cross-tenant via crafted URLs | Backend is the only authz boundary; frontend assumes nothing |
| Self-host instance ships with default JWT secret | Token forgery against the instance | Generate at install; reject startup if default |
| Update endpoint serves unsigned binaries | Supply-chain compromise | Sigstore / GPG signed; verify before install |
| Browser extension requests `cookies` permission | "Why does fennec need my cookies?" red flag + actual attack surface | Never request `cookies` permission. Auth via fennec's own login, not by stealing the user's session |
| Daemon logs full request body on error | Secrets in `daemon.log` even if redacted in capture | Sanitize log output; redact again on the way to the log |
| Embedding / analytics service accepts requests without auth check | Anyone on internal network reads embeddings | Required env var on startup; reject if unset (synapse pattern) |
| Invite tokens not bound to recipient email | Anyone with the URL accepts (synapse-CONCERNS.md "Invite acceptance does not verify email match") | Bind invite to email; verify on accept |
| API keys logged in CI logs (echoed in install scripts) | Public CI logs leak keys | Mask in CI; never echo |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Daemon installs silently, no permission prompt | Surveillance perception | [Explicit consent moment](https://posthog.com/blog/open-source-telemetry-ethical) on first run with privacy summary |
| Per-developer dashboard is the default landing page | Performance-review weaponization | Org-aggregate by default; per-dev opt-in or admin-gated with friction |
| Cost estimate shown without "estimated" disclaimer | Customer trust collapses on first invoice mismatch | "Estimated cost — see methodology" with reconciliation gap visible |
| Adapter offline shows "no activity" in dashboard | Customer assumes their team stopped using AI | Banner: "Cursor adapter offline — last successful capture 18h ago" |
| AI attribution rendered as a single confident percentage | Headline number used in HR reviews | Show confidence interval + tooltip on methodology + warning against perf-review use |
| Long-running operations (sync, redaction-rule update) with no progress | Customer thinks daemon is hung | Progress events to local log + visible in `fennec status` |
| First-run wizard requires admin / sudo without warning | User bounces at the sudo prompt | Pre-flight check; tell user what privileges are needed and why |
| Default retention is "forever" | GDPR Article 17 violation | Default 30 days SaaS / 90 days self-host; configurable |
| Self-host setup requires reading 5 docs | Adoption friction | Single `fennec install` script that detects and fixes 80% of issues |
| Browser extension auto-launches with broad permissions | Chrome Web Store rejection + user distrust | Minimal scopes; `activeTab` not `<all_urls>`; permission-rationale link in install flow |

---

## "Looks Done But Isn't" Checklist

- [ ] **Daemon capture for tool X is working:** Often missing the heartbeat-when-zero-events signal — verify the dashboard distinguishes "no AI usage" from "adapter offline."
- [ ] **Multi-tenant backend is secure:** Often missing membership checks on at least one route — verify by running the quarterly tenant-isolation drill with two test orgs.
- [ ] **Cost numbers match invoices:** Often missing cache-token separation — verify by capturing a cache-heavy session and comparing to Anthropic's response usage block.
- [ ] **Secret redaction is working:** Often missing customer-specific patterns — verify by running the onboarding redaction drill with 10 realistic prompts.
- [ ] **Self-host install is documented:** Often missing the corporate-proxy fallback path — verify by attempting install on a Netskope/Zscaler network.
- [ ] **Browser extension is published:** Often missing the security review or has too-broad permissions — verify by reading the Chrome Web Store review checklist.
- [ ] **Outcome correlation is rendering numbers:** Often missing the confidence indicator — verify every attribution number has a confidence level visible without hover.
- [ ] **Windows daemon "installs":** Often quarantined by Defender — verify by installing on a fresh Windows VM with default Defender settings.
- [ ] **License is published:** Often missing from the README or install screen — verify by counting where the license is surfaced.
- [ ] **Per-developer view is "available":** Often missing the consent friction or methodology link — verify by spot-checking the UI for the warnings.
- [ ] **GDPR delete-me flow works:** Often missing the backup-retention deletion path — verify by simulating an Article 17 request and timing how long deletion takes.
- [ ] **EU sales conversation:** Often missing the works-council brief — verify by asking a fictional EU customer "send the brief" and seeing how fast it arrives.
- [ ] **Auto-update is "enabled":** Often missing signing verification — verify by attempting to install an unsigned mock binary; daemon should refuse.
- [ ] **`fennec status` shows daemon health:** Often missing resource numbers — verify CPU/RAM/disk are visible.
- [ ] **Daemon-side redaction runs synchronously:** Often async with race conditions — verify by attempting a prompt that should redact and checking the cloud event is already redacted.

---

## Recovery Strategies

When pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Secrets leaked into prompts table | HIGH | (1) Determine blast radius via SQL audit; (2) Notify affected customers within 72h (GDPR Article 33); (3) Rotate affected secrets if known (offer a script); (4) Delete the leaked data; (5) Post-mortem and redaction-rule update; (6) External security audit |
| Cross-tenant data leak | CATASTROPHIC | (1) Immediate read-only mode on affected endpoint; (2) Audit-log review for the leak window; (3) Notify all customers whose data was accessed; (4) GDPR/CCPA notifications; (5) Patch + RLS backstop + middleware audit; (6) External legal counsel |
| Adapter silently broken for >24h | MEDIUM | (1) In-product banner to affected customers; (2) Backfill events from local cache if available; (3) Communication: blog post explaining what was lost, what was captured, what was retrieved; (4) Ship adapter fix; (5) Add adapter-version-coverage CI |
| Cost estimate off by >10% | MEDIUM | (1) Reconciliation report comparing fennec-estimate to vendor-billed; (2) Per-customer adjustment for the affected window; (3) Fix the cause (usually cache-detection or pricing-table); (4) Public methodology update |
| Daemon resource drain reported | LOW | (1) Snapshot of resource usage from `fennec status`; (2) Profile the daemon under the customer's workload; (3) Patch the hot path; (4) Push update; (5) Apologize for fan noise |
| Surveillance-perception backlash | HIGH (reputation) | (1) Public statement of what fennec captures and doesn't; (2) Reissue consent flow + opt-in to existing users; (3) Make per-developer views admin-only-with-developer-consent for affected customer; (4) Long-term: pivot marketing copy |
| Windows Defender quarantine | LOW per-customer, HIGH if widespread | (1) Submit binary to WDSI; (2) Code-sign if not already; (3) Update install guide with the "Run anyway" workaround; (4) `fennec doctor` detects quarantine and tells the user |
| Update endpoint compromise | CATASTROPHIC | (1) Disable auto-update fleet-wide; (2) Investigate compromise vector; (3) Rotate signing keys; (4) Notify customers; (5) Ship new signed binary; (6) Forensic timeline |
| Self-host CVE disclosed before patch | HIGH | (1) Coordinate disclosure window with reporters; (2) Patch ASAP; (3) Push notification to all self-host instances; (4) Public post-mortem |
| License-change backlash | HIGH (reputation) | (1) Pause the change; (2) Community thread acknowledging concerns; (3) Re-engage; (4) Better: don't change the license. Lock it once. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls. **Roadmap recommendation: every phase has explicit "out of scope this phase" + "pitfalls addressed" sections.**

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1: Secrets in prompts → cloud | **Phase 1 (Capture)** mandatory | Canary-secret smoke test: 10 secrets through daemon, 0 reach cloud |
| 2: Customer-specific secret patterns | **Phase 1** defaults, **Phase 3** UI | Onboarding redaction drill is a documented step |
| 3: Adapter breakage silent | **Phase 1** heartbeats, **Phase 4** dashboard alerts | Dashboard shows "adapter offline" banner for any adapter quiet >24h |
| 4: Browser capture fragility | **Phase 2 (Adapters)** explicit deferral; v1 ships with 3 surfaces, browser is v1.1 | Pre-launch announcement: "browser coming Q3" with reasoning |
| 5: Multi-tenant isolation | **Phase 3 (Backend)** mandatory | Tenant-isolation drill in CI before public access |
| 6: Outcome correlation over-claim | **Phase 2 (Correlation engine)** + **Phase 4 (Dashboard)** | Every attribution number has a visible confidence indicator |
| 7: Cost ≠ invoice | **Phase 2** cache-token capture, **Phase 4** dashboard disclosure, **Phase 5+** reconciliation API | Test against real Anthropic invoice; gap <±10% |
| 8: Surveillance perception | **Phase 4 (Dashboards)** default views, **Phase 5 (Distribution)** consent + pause + works-council brief | EU customer sales call survives "what do you capture and who sees it" |
| 9: License / self-host friction | **Phase 5+ (Distribution)** before public repo | License surfaced in README + install + dashboard |
| 10: Daemon resource drain | **Phase 1** sizing, **Phase 4** `fennec status` | Daemon <1% CPU steady on a 100-event-day customer |
| 11: Cross-machine identity | **Phase 1 (Auth)** + **Phase 3 (Merge UI)** | Same user signs in on two machines, dashboard shows one user with two devices |
| 12: Windows Defender quarantine | **Phase 1 (Daemon)** code signing | Fresh Windows VM install + Defender default settings → daemon runs |
| 13: Proxy fights proxy | **Phase 1 (Daemon)** env-var support, **Phase 5 (Distribution)** alternate install | Install + sync on Netskope/Zscaler network |
| 14: Auto-update attack surface | **Phase 5+ (Distribution)** before auto-update is enabled | Unsigned binary rejected by daemon updater |
| 15: Synapse + fennec coexistence | **Phase 1 (Installer)** detect & handle | Both daemons installed → both function; no hook collision |
| 16: HIPAA edge case | **Phase 5+ (Enterprise)** with explicit docs | Self-host docs say "for PHI, use self-host" |
| 17: Demo / staging mixing | **Phase 5+ (Production)** | Demo lives in a separate environment |

---

## Sources

### Synapse references (lived experience, HIGH confidence)

- [/Users/Tanmai.N/Documents/synapse/.planning/research/PITFALLS.md](file:///Users/Tanmai.N/Documents/synapse/.planning/research/PITFALLS.md) — Pitfalls from synapse's launch milestone (capture loop, telemetry, waitlist funnel)
- [/Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md](file:///Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md) — Service-role RLS bypass; cross-tenant write vulnerability; performance bottlenecks
- [/Users/Tanmai.N/Documents/synapse/docs/BUGS.md](file:///Users/Tanmai.N/Documents/synapse/docs/BUGS.md) — Netskope proxy block (REQ-BUG-03); daemon lifecycle bugs; deploy-drift signals

### Privacy / compliance (verified, HIGH confidence)

- [Sustainable Use License | n8n Docs](https://docs.n8n.io/sustainable-use-license/)
- [Why 28 million credentials leaked on GitHub in 2025 — Snyk](https://snyk.io/articles/state-of-secrets/) — secrets-in-code prevalence
- [SaaS DPA Guide: GDPR Requirements, Subprocessors, and Automation](https://secureprivacy.ai/blog/data-processing-agreements-dpas-for-saas)
- [Data Processing Agreement Template — GDPR.eu](https://gdpr.eu/data-processing-agreement/)
- [HIPAA-Compliant AI: What Developers Need to Know — Aptible](https://www.aptible.com/hipaa/hipaa-compliant-ai)
- [OpenAI HIPAA BAA: What It Actually Covers (And What Leaves PHI Exposed) — Protecto](https://www.protecto.ai/blog/openai-hipaa-baa-what-it-actually-covers-and-what-leaves-phi-exposed/)
- [SOC 2 Audit Costs 2026 — The Sector Post](https://www.thesectorpost.com/compliance/soc2/audit-costs)
- [SOC 2 Tools: Vanta vs Drata vs Secureframe — Secureleap](https://www.secureleap.tech/blog/soc-2-tools-vanta-drata-secureframe-guide-2025)

### Capture fragility (verified, HIGH confidence)

- [Codex CLI session storage path — InventiveHQ](https://inventivehq.com/knowledge-base/openai/where-configuration-files-are-stored)
- [PixelPaw-Labs/codex-trace — Codex CLI session JSONL format](https://github.com/PixelPaw-Labs/codex-trace)
- [What Does Cursor Store on Your Machine? — vibe-replay](https://vibe-replay.com/blog/cursor-local-storage/) — Cursor storage internals
- [Claude Code SessionStart hooks not working for new conversations — Issue #10373](https://github.com/anthropics/claude-code/issues/10373)
- [Claude Code hook regression in 2.0.17-2.0.22 — Issue #9602](https://github.com/anthropics/claude-code/issues/9602)
- [UserPromptSubmit hook not triggering consistently — Issue #17277](https://github.com/anthropics/claude-code/issues/17277)
- [Plugin hook output not captured — Issue #12151](https://github.com/anthropics/claude-code/issues/12151)

### Browser capture (verified, HIGH confidence)

- [Replace blocking web request listeners — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests)
- [chrome.declarativeNetRequest API reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) — Manifest V3 30k rule limit
- [Two Chrome Extensions Caught Stealing ChatGPT and DeepSeek Chats — Hacker News](https://thehackernews.com/2026/01/two-chrome-extensions-caught-stealing.html)
- [Chrome Extensions Steal ChatGPT and DeepSeek Conversations — OX Security](https://www.ox.security/blog/malicious-chrome-extensions-steal-chatgpt-deepseek-conversations/)
- [Certificate Pinning and SSL/TLS Inspection — Zscaler Help Portal](https://help.zscaler.com/zia/certificate-pinning-and-ssltls-inspection)
- [SSL Inspection in Developer Environments — Zscaler blog](https://www.zscaler.com/blogs/product-insights/ssl-inspection-developer-environments-unlock-advanced-threat-protection)

### Cost / tokens (verified, HIGH confidence)

- [Prompt caching — Anthropic Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 1.25x write / 0.1x read pricing
- [Anthropic API Pricing — Anthropic Docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [LiteLLM Anthropic cost calculation bug with prompt caching — Issue #9812](https://github.com/BerriAI/litellm/issues/9812) — exact double-counting failure mode
- [GitHub Copilot usage metrics — GitHub Docs](https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics)
- [GitHub Copilot licenses — GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)
- [OpenTelemetry GenAI Semantic Conventions for spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — vendor-neutral attribute names

### Multi-tenant / Supabase (verified, HIGH confidence)

- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Best Practices for Multi-Tenant Apps — Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Row-Level Security in Supabase: Multi-Tenant SaaS — DEV Community](https://dev.to/issuecapture/row-level-security-in-supabase-multi-tenant-saas-from-day-one-4lon)
- [Enforcing RLS in Supabase: LockIn's Multi-Tenant Architecture — DEV](https://dev.to/blackie360/-enforcing-row-level-security-in-supabase-a-deep-dive-into-lockins-multi-tenant-architecture-4hd2)

### Daemon / install (verified, HIGH confidence)

- [Windows Defender false-positive on unsigned binaries — vercel-labs/agent-browser Issue #382](https://github.com/vercel-labs/agent-browser/issues/382)
- [Wails empty project flagged by Defender — Issue #3308](https://github.com/wailsapp/wails/issues/3308)
- [Nim and Go programs flagged as malware on Windows — Hacker News](https://news.ycombinator.com/item?id=34594743)
- [DigiCert Code-Signing Incident — Airlock Digital](https://www.airlockdigital.com/airlock-blog/digicert-incident-and-microsoft-defender-false-positive-what-happened-and-what-it-means)
- [launchd CPU usage troubleshooting — MacPaw](https://macpaw.com/how-to/launchd-process-mac)

### Open-source / self-host (verified, HIGH confidence)

- [Announcing the new Sustainable Use License — n8n Blog](https://blog.n8n.io/announcing-new-sustainable-use-license/)
- [Mattermost open-source missteps — Mattermost blog](https://mattermost.com/blog/top-7-missteps-of-the-mattermost-open-source-project/)
- [A Critical Response to Mattermost's Recent Changes — Forum](https://forum.mattermost.com/t/a-critical-response-to-mattermost-s-recent-changes/25407)
- [Should open source projects track you? — PostHog](https://posthog.com/blog/open-source-telemetry-ethical)
- [PostHog telemetry opt-out controversy — Continue.dev Issue #2082](https://github.com/continuedev/continue/issues/2082) — non-respect of disable flag
- [Fair-code definition — faircode.io](https://faircode.io/)

### Adoption / surveillance (verified, MEDIUM-HIGH confidence)

- [AI Surveillance in the Workplace Linked to Employee Resistance, Turnover — SHRM](https://www.shrm.org/topics-tools/news/employee-relations/ai-surveillance-in-the-workplace-linked-to-employee-resistance--)
- [Algorithmic versus human surveillance — National Library of Medicine](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11332184/)
- [European Parliamentary Research Service — Workplace Surveillance Study](https://www.europarl.europa.eu/RegData/etudes/STUD/2025/774670/EPRS_STU(2025)774670_EN.pdf)
- [Employee monitoring: A moving target for regulation — Eurofound](https://www.eurofound.europa.eu/en/publications/all/employee-monitoring-moving-target-regulation)
- [Proceed With Caution When Remotely Monitoring Employees in the EU — Davis Wright Tremaine](https://www.dwt.com/blogs/privacy--security-law-blog/2020/11/employee-data-monitoring-gdpr-compliance)
- [Employee Data Privacy: Balancing Monitoring and Trust — TrustArc](https://trustarc.com/resource/employee-data-privacy-balancing-monitoring-and-trust/)
- [Training and deploying AI within the GDPR framework — Gilbert + Tobin](https://www.gtlaw.com.au/insights/training-and-deploying-ai-within-the-gdpr-framework)

### Attribution methodology (verified, MEDIUM confidence)

- [GitClear's analysis of 153M lines of code — Arc Talent](https://arc.dev/talent-blog/impact-of-ai-on-code/)
- [Misleading Authorship Attribution of Source Code using Adversarial Learning — arXiv](https://arxiv.org/pdf/1905.12386) — 88% → 1% accuracy under attack
- [The AI Attribution Paradox: Transparency as Social Strategy — arXiv](https://arxiv.org/html/2512.00867v1)
- [Fingerprinting AI Coding Agents on GitHub — arXiv](https://arxiv.org/pdf/2601.17406)
- [DORA Metrics: Complete Guide for Engineering Leaders — Gitrecap](https://www.gitrecap.com/blog/what-are-dora-metrics) — perils of individual ranking

### Secret scanning (verified, HIGH confidence)

- [TruffleHog — GitHub](https://github.com/trufflesecurity/trufflehog)
- [How to redact secrets from logs with Grafana Alloy and Loki — Grafana Labs](https://grafana.com/blog/how-to-redact-secrets-from-logs-with-grafana-alloy-and-loki/)
- [detect-secrets vs Gitleaks vs TruffleHog vs GitGuardian — DevSecOps.ae](https://devsecops.ae/secrets-scanners-comparison-2026/)
- [TruffleHog — A Deep Dive on Secret Management — Jit](https://www.jit.io/resources/appsec-tools/trufflehog-a-deep-dive-on-secret-management-and-how-to-fix-exposed-secrets)

### Adjacent / multi-account (verified, MEDIUM confidence)

- [Managing Multiple Git Identities on a Single Machine — Zoltan Toma](https://zoltantoma.com/posts/2025/2025-10-12-managing-multiple-git-identities/)
- [Managing multiple accounts — GitHub Docs](https://docs.github.com/en/account-and-profile/how-tos/account-management/managing-multiple-accounts)

---
*Pitfalls research for: AI usage/cost observability platform*
*Researched: 2026-05-31*
