/**
 * GET /api/auth/sso -- PKCE attach flow start (AUTH-16, half 1).
 *
 * The daemon (Plan 01-08) spins up a loopback HTTP server on a random port,
 * builds a PKCE verifier + challenge per RFC 7636, then opens the user's
 * default browser at:
 *   ${FENNEC_BASE_URL}/api/auth/sso?machine_id=...&redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=<S256>&state=<rand>&provider=<google|github|microsoft>
 *
 * This handler:
 *   1. Validates the query params with Zod (code_challenge >= 43 chars per
 *      RFC 7636; state >= 8 chars).
 *   2. Stores (state -> { machine_id, redirect_uri, code_challenge, provider })
 *      in OAUTH_STATE_KV with a 10-minute TTL.
 *   3. 302-redirects the browser to the provider's authorize endpoint with
 *      response_type=code, client_id (from env), redirect_uri, state, scope
 *      (provider-specific), code_challenge, code_challenge_method=S256.
 *
 * Threat T-05-07 mitigation: state is server-stored. The matching POST
 * /api/daemons/attach-callback handler verifies state was actually issued
 * by this server within the last 10 minutes.
 *
 * Provider choice (Phase 1): all three providers are wired so the daemon
 * can drive any of them. Plan 01-08 picks GitHub for the Phase 1 smoke run
 * because it's the easiest to provision for solo dev (no OAuth-app review
 * needed); the surface here is provider-agnostic so swapping is trivial.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";

const QuerySchema = z.object({
  machine_id: z.string().min(8),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  state: z.string().min(8),
  provider: z.enum(["google", "github", "microsoft"]),
});

const app = new Hono<{ Bindings: Env }>();

app.get("/api/auth/sso", zValidator("query", QuerySchema), async (c) => {
  const { machine_id, redirect_uri, code_challenge, state, provider } = c.req.valid("query");

  // Persist state -> { ... } in KV for 10 minutes. The callback verifies
  // PKCE against the stored code_challenge (threats T-05-07 + T-05-08).
  await c.env.OAUTH_STATE_KV.put(state, JSON.stringify({ machine_id, redirect_uri, code_challenge, provider }), {
    expirationTtl: 600,
  });

  const url = buildAuthorizeUrl(provider, {
    client_id: clientIdFor(c.env, provider),
    redirect_uri,
    state,
    code_challenge,
  });
  return c.redirect(url, 302);
});

function clientIdFor(env: Env, provider: "google" | "github" | "microsoft"): string {
  switch (provider) {
    case "google":
      return env.OAUTH_GOOGLE_CLIENT_ID;
    case "github":
      return env.OAUTH_GITHUB_CLIENT_ID;
    case "microsoft":
      return env.OAUTH_MICROSOFT_CLIENT_ID;
  }
}

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
}

function buildAuthorizeUrl(provider: "google" | "github" | "microsoft", p: AuthorizeParams): string {
  const base = authorizeBase(provider);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    state: p.state,
    code_challenge: p.code_challenge,
    code_challenge_method: "S256",
    scope: scopesFor(provider),
  });
  return `${base}?${params.toString()}`;
}

function authorizeBase(provider: "google" | "github" | "microsoft"): string {
  switch (provider) {
    case "google":
      return "https://accounts.google.com/o/oauth2/v2/auth";
    case "github":
      return "https://github.com/login/oauth/authorize";
    case "microsoft":
      // Multi-tenant Entra endpoint -- Phase 1 supports any AAD tenant.
      return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
  }
}

function scopesFor(provider: "google" | "github" | "microsoft"): string {
  switch (provider) {
    case "google":
      return "openid email profile";
    case "github":
      return "read:user user:email";
    case "microsoft":
      return "openid email profile";
  }
}

export default app;
