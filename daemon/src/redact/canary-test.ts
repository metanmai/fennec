/**
 * 10 canary secrets used by the PRIV-01 redaction smoke test.
 *
 * Mirrors the Wave 0 fixture at `tests/canary-secrets.txt` — keeping a
 * daemon-side copy lets the redactor's unit tests run hermetically
 * without filesystem access to the repo root. The daemon-side list
 * MUST stay in sync with the root file; the `canary.test.ts` asserts
 * both are identical.
 *
 * Every string here is a publicly-documented example placeholder (the
 * `AKIAIOSFODNN7EXAMPLE` AWS docs key, etc.) or a syntactically valid
 * placeholder we generate. None of these are real, active secrets;
 * they exist precisely so we can prove our redactor catches them
 * before any prompt body containing one ever lands in the JSONL queue.
 */

export const CANARIES: readonly string[] = [
  // AWS access key — `aws-access-token` rule
  "AKIAIOSFODNN7EXAMPLE",
  // GitHub PAT — `github-pat` rule (ghp_ + 36 chars)
  "ghp_abcdef0123456789abcdef0123456789abcd",
  // Anthropic API key — `fennec-anthropic-api-key` supplemental rule
  "sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  // JWT bearer — `jwt` rule
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature",
  // RSA private key header — `private-key` rule
  "-----BEGIN RSA PRIVATE KEY-----",
  // Slack bot token — `slack-bot-token` rule
  "xoxb-1234567890-abcdefghijklmnopqrstuvwx",
  // Google API key — `gcp-api-key` rule (AIza prefix)
  "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
  // JWT (longer realistic payload) — `jwt` rule
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  // Stripe live token — `stripe-access-token` rule
  "sk_live_TEST1234567890abcdefghijklmnopqrstuvwx",
  // GitLab PAT — `gitlab-pat` rule (glpat-) — needs 20 chars after prefix
  "glpat-1234567890abcdefghij",
];

export interface CanarySmokeResult {
  pass: boolean;
  /** Canaries that did NOT get redacted — populated only when `pass` is false. */
  failures: string[];
}

/**
 * Run each canary through `redactEvent` and report any that survived
 * unredacted. The redactor module is imported lazily to avoid a circular
 * import (redactor → rules → canary helpers).
 */
export async function runCanarySmoke(): Promise<CanarySmokeResult> {
  const { redactEvent } = await import("./redactor.js");
  const failures: string[] = [];
  for (const c of CANARIES) {
    const event = buildEnvelope({ prompt_text: `Here's my secret: ${c}` });
    const redacted = redactEvent(event);
    const serialised = JSON.stringify(redacted.payload);
    if (serialised.includes(c)) failures.push(c);
  }
  return { pass: failures.length === 0, failures };
}

/** Minimal CanonicalEvent envelope for canary tests. */
function buildEnvelope(payload: Record<string, unknown>) {
  return {
    idempotency_key: "canary-key",
    tool: "claude-code" as const,
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "canary",
    os: "darwin" as const,
    kind: "prompt_submitted" as const,
    payload,
    schema_version: 1 as const,
    redaction_applied_at: "",
    redaction_version_hash: "",
  };
}
