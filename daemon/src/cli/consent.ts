/**
 * Consent renderer (Plan 01-09 Task 1, PRIV-07).
 *
 * Two surfaces:
 *
 *   1. renderInteractive() — @clack/prompts confirm()-driven gate used
 *      by `fennec wizard`. Personal-tier install path. Returns true iff
 *      the user explicitly clicks "Yes I consent". Ctrl+C / cancel
 *      counts as "no consent".
 *
 *   2. renderLogged({...}) — writes a one-page consent record to
 *      /var/log/fennec/first-run-consent.txt for the MDM-driven
 *      non-interactive install path (Pitfall 8 in 01-RESEARCH.md). The
 *      org admin is treated as the operator-who-consented; this audit
 *      record gives the dev a discoverable trail of what was installed
 *      and what data flows where. The file is written BEFORE the
 *      enrollment call so the record exists even if enrollment fails.
 *
 * Both surfaces share the same disclosureText() body so the dev sees
 * the same information regardless of install path. The interactive
 * variant renders via @clack/prompts' note() block; the logged variant
 * embeds it in a plaintext file with mode 0o640 (root + adm read,
 * everyone else denied).
 */

import { chownSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { confirm, intro, isCancel, note } from "@clack/prompts";

export interface RenderInteractiveInput {
  apiBaseUrl: string;
}

export interface RenderLoggedInput {
  machineId: string;
  hostname: string;
  /** Resolved post-enrollment; "unknown — populated after enrollment" pre-enrollment. */
  orgName?: string;
  apiBaseUrl: string;
  /** Override for tests; defaults to /var/log/fennec/first-run-consent.txt. */
  logPath?: string;
}

const DEFAULT_LOG_PATH = "/var/log/fennec/first-run-consent.txt";

/**
 * Build the one-page disclosure text shown to the user in both surfaces.
 * Keep it short, factual, and free of marketing language — this is a
 * trust document.
 */
function disclosureText(apiBaseUrl: string): string {
  return [
    "What fennec captures on this machine:",
    "",
    "  - Claude Code prompts and responses (6 hook events: UserPromptSubmit, PostToolUse,",
    "    SessionStart, SessionEnd, PreCompact, SubagentStop)",
    "  - Anthropic token counts (input, output, cache creation, cache read) — verbatim",
    "  - Workspace metadata: current directory, git remote, git branch",
    "",
    "What fennec redacts at capture time (before any data leaves this machine):",
    "",
    "  - Secrets matching gitleaks v8.21.0 default rules (~181 patterns)",
    "  - Plus 4 fennec-supplemental rules: Anthropic API keys (sk-ant-...),",
    "    opaque Bearer tokens, PEM headers, relaxed GCP API key form",
    "",
    "Where data flows:",
    "",
    `  Events -> POST ${apiBaseUrl}/api/events/batch over HTTPS,`,
    "  authenticated per-machine via Bearer token.",
    "",
    "Privacy policy:",
    "",
    `  ${apiBaseUrl}/privacy (served by your fennec instance)`,
    "  Local copy bundled in this installation: docs/PRIVACY.md",
    "",
    "Local inspection:",
    "",
    "  Run `fennec inspect` to review what was captured in the last 24 hours.",
    "  (Phase 2 feature — coming.)",
  ].join("\n");
}

/**
 * Interactive consent prompt for `fennec wizard`. Returns true iff the
 * user explicitly consents. Cancel (Ctrl+C) and explicit "no" both
 * return false — there is no implicit consent path.
 */
export async function renderInteractive(input: RenderInteractiveInput): Promise<boolean> {
  intro("Welcome to fennec");
  note(disclosureText(input.apiBaseUrl), "What fennec captures");

  const answer = await confirm({
    message: "Do you consent to fennec capturing your AI usage on this machine?",
    initialValue: false,
  });

  if (isCancel(answer)) return false;
  return answer === true;
}

/**
 * Write a one-page consent audit record. Used by `fennec init` (MDM
 * path) BEFORE enrollment fires the first hook — satisfies PRIV-07
 * per Pitfall 8. The record is enriched post-enrollment with the
 * resolved org_name via a second call.
 *
 * File mode 0o640 (rw-r-----) — root + adm group readable, world denied.
 * Parent dirs created with mode 0o750. In production (uid 0) the file
 * is chowned root:root; tests run as non-root and skip the chown.
 */
export function renderLogged(input: RenderLoggedInput): void {
  const logPath = input.logPath ?? DEFAULT_LOG_PATH;
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o750 });

  const orgLine = input.orgName ?? "unknown — populated after enrollment";
  const content = [
    "# fennec first-run consent audit record",
    `# Written: ${new Date().toISOString()}`,
    "",
    `machine_id:   ${input.machineId}`,
    `hostname:     ${input.hostname}`,
    `org_name:     ${orgLine}`,
    `api_base_url: ${input.apiBaseUrl}`,
    "",
    "----------------------------------------------------------------------",
    "",
    disclosureText(input.apiBaseUrl),
    "",
    "----------------------------------------------------------------------",
    "",
    "This record was created by `fennec init` (MDM-driven install). The org",
    "operator that pushed the MDM payload is the consenting actor; this file",
    "exists so the developer on this machine has a discoverable trail of",
    "what was installed and what data flows where.",
    "",
  ].join("\n");

  writeFileSync(logPath, content, { mode: 0o640 });
  if (process.getuid?.() === 0) {
    chownSync(logPath, 0, 0);
  }
}
