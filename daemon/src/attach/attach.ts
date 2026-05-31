/**
 * Dev-OAuth attach flow orchestrator (Plan 01-08 Task 2, AUTH-16,
 * D-14, D-15, Pattern 10).
 *
 * Drives the full PKCE + browser + callback dance:
 *
 *   1. Generate PKCE pair (verifier kept in memory only).
 *   2. Start the one-shot loopback OAuth callback server (random port).
 *   3. Build the backend's SSO start URL with the loopback redirect_uri,
 *      the code_challenge, the state, and the requested OAuth provider.
 *   4. Ask the notifier (Helper LaunchAgent) to:
 *        - display a tray notification "Sign in to fennec"
 *        - open the SSO URL in the default browser
 *   5. Await the OAuth callback (5-min timeout).
 *   6. CSRF check: returned state MUST match the state we generated.
 *   7. POST { code, state, code_verifier, machine_id } to the backend's
 *      /api/daemons/attach-callback (built in Plan 01-05); the backend
 *      exchanges the code with the provider, resolves the user, and
 *      backfills the unknown@hostname events (D-15).
 *   8. Return { user_id, email, org_id } parsed via
 *      AttachCallbackResponseSchema.
 *
 * If the notifier returns delivered=false (LaunchAgent dead / user
 * logged out), we still wait on awaitCode — D-14 says the daemon
 * captures events tagged unknown@hostname until attach completes; the
 * user may attach at any later time. The orchestrator doesn't force-
 * fail when the LaunchAgent is missing.
 */

import { AttachCallbackRequestSchema, type AttachCallbackResponse, AttachCallbackResponseSchema } from "@fennec/shared";
import { NotifierBridge } from "./notifier-bridge.js";
import { OneShotOAuthServer } from "./oauth-server.js";
import { generatePkcePair } from "./pkce.js";

export type AttachProvider = "google" | "github" | "microsoft";

export interface RunAttachFlowInput {
  apiBaseUrl: string;
  machineId: string;
  provider: AttachProvider;
  /** Optional injectable notifier (tests pass a mock; production uses default). */
  notifier?: NotifierBridge;
  /** Injectable fetch — defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  fetchOpts?: RequestInit;
  /** Optional 5-min override for tests. */
  oauthTimeoutMs?: number;
}

/**
 * Logs an attach-flow status line. Notifier-not-delivered is a warning,
 * not an error — D-14 explicitly says the daemon keeps capturing events
 * while waiting for attach.
 */
function logAttach(level: "info" | "warn" | "error", msg: string): void {
  const tag = `attach[${level}]:`;
  if (level === "error") console.error(tag, msg);
  else if (level === "warn") console.warn(tag, msg);
  else console.log(tag, msg);
}

export async function runAttachFlow(input: RunAttachFlowInput): Promise<AttachCallbackResponse> {
  const { code_verifier, code_challenge } = await generatePkcePair();

  const server = new OneShotOAuthServer({ timeoutMs: input.oauthTimeoutMs });
  const { callbackUrl, awaitCode } = await server.start();

  const state = crypto.randomUUID();
  const ssoUrl =
    `${input.apiBaseUrl}/api/auth/sso` +
    `?machine_id=${encodeURIComponent(input.machineId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&code_challenge=${encodeURIComponent(code_challenge)}` +
    `&state=${encodeURIComponent(state)}` +
    `&provider=${encodeURIComponent(input.provider)}`;

  const notifier = input.notifier ?? new NotifierBridge();
  const { delivered } = await notifier.notify({
    title: "Sign in to fennec",
    message: "Click to attribute your AI usage to your developer identity",
    openUrl: ssoUrl,
  });
  if (!delivered) {
    logAttach("warn", "notifier-not-delivered; await callback may still succeed if user opened the SSO URL manually");
  }

  let returned: { code: string; state: string };
  try {
    returned = await awaitCode;
  } finally {
    // Make sure the server is closed even if awaitCode rejects.
    server.stop();
  }

  if (returned.state !== state) {
    throw new Error("oauth_state_mismatch");
  }

  const body = AttachCallbackRequestSchema.parse({
    code: returned.code,
    state: returned.state,
    code_verifier,
    machine_id: input.machineId,
  });

  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const fetchOpts = input.fetchOpts ?? {};
  const resp = await fetchFn(`${input.apiBaseUrl}/api/daemons/attach-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...fetchOpts,
  });

  if (!resp.ok) {
    throw new Error(`attach-callback-failed-${resp.status}`);
  }

  const json = await resp.json();
  return AttachCallbackResponseSchema.parse(json);
}
