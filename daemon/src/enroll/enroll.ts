/**
 * Daemon enrollment client (AUTH-14 daemon side, Plan 01-08 Task 1).
 *
 * The daemon's first network conversation with the backend. Trades the
 * org-issued `install_secret` (delivered via MDM payload in org tier
 * per D-08, or self-issued by the personal-tier wizard per D-10) for a
 * per-machine `api_key` that the daemon then writes to disk via
 * `api-key-store.ts` (AUTH-15).
 *
 * Endpoint contract (defined in @fennec/backend Plan 01-05):
 *   POST {apiBaseUrl}/api/daemons/enroll
 *   Body: EnrollRequestSchema { install_secret, machine_id, hostname, os }
 *   200: EnrollResponseSchema { api_key, api_key_id, org_id, org_name, privacy_policy_url }
 *   401: invalid_or_expired_install_secret (backend hashes the secret;
 *        a 401 means the sha256 lookup found nothing or the secret has
 *        expired)
 *   4xx / 5xx: surfaced with the status code; never with the body
 *
 * Threat model anchors:
 *   - T-08-06 (install_secret leak via daemon log): the secret is
 *     NEVER echoed in any thrown Error.message. The 401 path uses a
 *     fixed string; the 5xx path uses status only. The 200 path
 *     redacts the secret from any debug log via `redactSecretForLog`.
 *
 * Re-enrollment contract (per W-3 amendment, finalised in 01-05):
 *   The backend always REVOKES the prior key for (org_id, machine_id)
 *   and ISSUES a fresh one on every successful enrollment. The daemon
 *   side doesn't need to know about prior state — it just calls
 *   enrollDaemon and persists whatever key comes back.
 */

import { EnrollRequestSchema, type EnrollResponse, EnrollResponseSchema } from "@fennec/shared";

export interface EnrollDaemonInput {
  installSecret: string;
  machineId: string;
  hostname: string;
  os: "darwin" | "linux" | "win32";
  apiBaseUrl: string;
  /**
   * Injectable fetch (defaults to globalThis.fetch). Tests pass a
   * vi.fn(); Plan 01-09's installer calls without an override.
   */
  fetchFn?: typeof fetch;
  /**
   * Forwarded to fetch() — used by `buildFetchOptions()` from
   * `../sync/proxy.ts` to surface the HTTPS_PROXY ProxyAgent in
   * corporate environments (Pitfall 13).
   */
  fetchOpts?: RequestInit;
}

/**
 * Redacts a secret-shaped string so we can safely log telemetry without
 * leaking the value. We keep the first 4 chars and the length so the
 * operator can correlate against an MDM rollout without exposing the
 * keyspace.
 */
function redactSecretForLog(secret: string): string {
  if (secret.length <= 8) return "<redacted>";
  return `${secret.slice(0, 4)}…(len=${secret.length})`;
}

export async function enrollDaemon(input: EnrollDaemonInput): Promise<EnrollResponse> {
  // Client-side Zod validation BEFORE making any network call. This
  // catches the "install_secret too short" case (< 32 chars) and other
  // shape violations without leaking telemetry. The backend re-validates
  // (Pattern 11) so this is defence-in-depth, not the load-bearing check.
  const body = EnrollRequestSchema.parse({
    install_secret: input.installSecret,
    machine_id: input.machineId,
    hostname: input.hostname,
    os: input.os,
  });

  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const fetchOpts = input.fetchOpts ?? {};

  const url = `${input.apiBaseUrl}/api/daemons/enroll`;
  const resp = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...fetchOpts,
  });

  if (resp.status === 401) {
    // Fixed error string — never echoes the supplied secret (T-08-06).
    throw new Error("invalid_or_expired_install_secret");
  }
  if (!resp.ok) {
    // Status only — no body, no secret. The body could legitimately
    // contain server-side diagnostics that mention the install_secret_id
    // (operational metadata) and we don't want to surface even that.
    throw new Error(`enroll-failed-${resp.status}`);
  }

  const json = await resp.json();
  const parsed = EnrollResponseSchema.parse(json);

  // Debug-level breadcrumb that's safe to log: api_key_id is the
  // operational identifier the backend uses. The install_secret is
  // logged in redacted form for correlation only.
  // (Production daemon uses a structured logger; here we keep stdout
  // hygienic by writing only one line.)
  console.log(
    `enroll: api_key_id=${parsed.api_key_id} org_id=${parsed.org_id} install_secret=${redactSecretForLog(input.installSecret)}`,
  );

  return parsed;
}
