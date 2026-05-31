/**
 * Cloudflare Workers environment bindings + Hono per-request context variables
 * for the fennec backend (Phase 1 Plan 01-05).
 *
 * The `Env` interface mirrors the bindings declared in `wrangler.jsonc`:
 *   * `HYPERDRIVE` -- Hyperdrive binding to Supabase Postgres direct connection
 *   * `OAUTH_STATE_KV` -- short-lived PKCE state for the dev-OAuth attach flow
 *
 * Secrets (set via `wrangler secret put`) round out the surface:
 *   * `FENNEC_BASE_URL` -- public URL of this Worker (used in privacy_policy_url
 *     + OAuth redirect URIs)
 *   * `OAUTH_<PROVIDER>_CLIENT_ID|SECRET` -- per-provider OAuth credentials
 *
 * The `Variables` interface is the Hono per-request context populated by the
 * bearerAuth middleware (Pattern 11 in 01-RESEARCH.md). The middleware sets
 * `org_id` + `api_key_id` + `daemon_machine_id` + `hostname` from the
 * `api_keys` table lookup; every protected handler reads these via `c.get()`
 * and stamps them onto inserted rows. Per threat T-05-02, the request body is
 * NEVER trusted for tenancy.
 */

export interface Env {
  // Cloudflare bindings (declared in wrangler.jsonc)
  HYPERDRIVE: Hyperdrive;
  OAUTH_STATE_KV: KVNamespace;

  // Secrets (set via `wrangler secret put`)
  FENNEC_BASE_URL: string;
  OAUTH_GOOGLE_CLIENT_ID: string;
  OAUTH_GOOGLE_CLIENT_SECRET: string;
  OAUTH_GITHUB_CLIENT_ID: string;
  OAUTH_GITHUB_CLIENT_SECRET: string;
  OAUTH_MICROSOFT_CLIENT_ID: string;
  OAUTH_MICROSOFT_CLIENT_SECRET: string;
}

/**
 * Hono per-request context variables populated by `fennecBearerAuth()`
 * middleware (see `backend/src/lib/bearer-auth.ts`). All four are guaranteed
 * to be set on any handler chained AFTER the middleware.
 */
export interface Variables {
  org_id: string;
  api_key_id: string;
  daemon_machine_id: string;
  hostname: string;
}
