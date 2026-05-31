# fennec Privacy

This document describes what fennec captures on this machine, what gets
redacted before any data leaves it, where the data flows, and how to
review what was captured locally. It is referenced by the first-run
consent surfaces (`fennec wizard` interactive flow and `fennec init`
audited consent record at `/var/log/fennec/first-run-consent.txt`)
per PRIV-07.

## What fennec captures

The fennec daemon runs as a system-level LaunchDaemon (per D-01 — always-on,
CrowdStrike-style). It captures the following AI usage events from this
machine:

**Claude Code hook events** (6 events per D-22):

  - `UserPromptSubmit` — prompt text submitted to Claude Code
  - `PostToolUse` — tool-call response (after a tool runs)
  - `SessionStart` — session boot
  - `SessionEnd` — session shutdown
  - `PreCompact` — context-window compaction trigger
  - `SubagentStop` — subagent termination

**Anthropic Usage token counts** (4 fields per A2 / ANL-06, verbatim):

  - `input_tokens`
  - `output_tokens`
  - `cache_creation_input_tokens`
  - `cache_read_input_tokens`

**Workspace metadata** (per CAP-02):

  - Current working directory (`cwd`)
  - Git remote URL
  - Git branch name

Phase 1 captures **only** Claude Code events. Phase 2 adds Codex, Gemini,
Cursor, Copilot, and browser adapters.

## What fennec redacts at capture time

**Before any data leaves this machine**, the daemon runs every event
payload through a synchronous redactor that applies:

  - **gitleaks v8.21.0 default ruleset** — 181 patterns covering AWS / GCP /
    Stripe / Slack / Twilio / SendGrid / etc. The TOML is vendored at
    `daemon/src/redact/gitleaks-rules.toml` and SHA-256 pinned
    (`1a1944db…`). Per W-4, the build script refuses to regenerate the
    compiled ruleset if the TOML drifts.
  - **4 fennec-supplemental rules** layered on top of upstream:
      - `fennec-anthropic-api-key` — `sk-ant-(api|admin)\d+-…`
      - `fennec-bearer-token` — opaque `Bearer …` tokens
      - `fennec-private-key-header` — bare PEM `-----BEGIN ... PRIVATE KEY-----`
      - `fennec-gcp-api-key-relaxed` — `AIza…` with relaxed length

The redaction layer is **tree-walking** (not stringify-redact-parse): it
walks the payload structure and runs each rule against developer-typed
strings with real whitespace + quote characters, so rules anchored on
`[\n]` / `["]` / `[']` fire correctly. Capture-time redaction is the
PRIV-01 trust-posture requirement and is validated by a 10-canary smoke
test (`daemon/src/redact/canary.test.ts`) that asserts every canary is
redacted before reaching the JSONL queue.

## Where data flows

After redaction, events are appended to a local append-only JSONL queue
at `/var/db/fennec/queue/events.jsonl` (CAP-11). A sync loop drains the
queue every 5 seconds in 100-event batches (CAP-12) and POSTs them to
your org's fennec backend:

  - Endpoint: `${FENNEC_API_URL}/api/events/batch`
  - Transport: HTTPS only
  - Authentication: per-machine Bearer token (api_key stored at
    `/var/db/fennec/key` mode 0400 root-owned per AUTH-15)
  - Default URL: `https://api.fennec.dev` (managed cloud) — your org
    admin may have configured a self-hosted backend instead

`NODE_EXTRA_CA_CERTS` + `HTTPS_PROXY` are honoured so corp networks
with TLS-inspecting proxies (Netskope, ZScaler, etc.) work without
disabling secret-redaction.

## How to inspect what was captured locally

`fennec inspect` will let any developer on this machine see exactly what
was captured locally in the last 24 hours, with redactions applied
(CAP-18). This is a **Phase 2 feature** — coming after the dashboard
ships in Phase 4 — but the contract is: full visibility into your own
local capture, no exceptions.

## Org admin responsibilities + retention

The org administrator who deployed fennec via MDM (or who issued the
install_secret for personal-tier installs) is responsible for:

  - Data retention policy (Phase 3 ships a configurable retention UI in
    the admin dashboard)
  - GDPR / privacy compliance for the data the backend receives
  - Surfacing the org's specific privacy policy at
    `${FENNEC_BASE_URL}/privacy/${org_id}` (Phase 3 backend route)

Phase 1 ships only this static `PRIVACY.md` as the source — the backend
serves it via `${FENNEC_BASE_URL}/privacy` (optional Phase 1 static
route; full per-org polish in Phase 3).

## Uninstalling

  - **Personal tier:** `sudo fennec uninstall`
  - **Org tier (MDM):** the org admin removes the Configuration Profile
    via your MDM tool; the daemon's eventual MDM-revoke handler will run
    the uninstall path automatically.

`fennec uninstall` emits an audit event (DAE-19) to the backend
**before** filesystem teardown so the audit reaches the org dashboard
even if subsequent teardown steps fail. Per D-24, the uninstaller is
surgical — it removes only fennec's entries from
`/Library/Application Support/ClaudeCode/managed-settings.json` and
leaves other tools' entries (e.g. synapse in `~/.claude/settings.json`)
untouched.

## Contact

For privacy questions, contact your org admin first. For questions
about the fennec project itself, see the canonical repository.
