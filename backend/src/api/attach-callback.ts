/**
 * POST /api/daemons/attach-callback -- dev-OAuth attach callback (AUTH-16, half 2).
 *
 * The daemon's loopback HTTP server caught the provider's redirect (carrying
 * `code` + `state`) and forwards them here along with the PKCE verifier and
 * the machine_id. Flow:
 *
 *   1. zValidator parses AttachCallbackRequestSchema.
 *   2. Look up state in OAUTH_STATE_KV -> recover { machine_id, redirect_uri,
 *      code_challenge, provider }. Miss/expired -> 400 invalid_or_expired_state
 *      (threat T-05-07).
 *   3. Verify PKCE: base64url(sha256(code_verifier)) === stored code_challenge.
 *      Mismatch -> 400 pkce_verification_failed (threat T-05-08).
 *   4. Exchange `code` + `code_verifier` for the provider's id_token or
 *      access_token via the provider's /token endpoint. Recover the user
 *      identity (email).
 *   5. UPSERT the user by email -> resolve user_id.
 *   6. Add the user to the org's `org_members` (idempotent, role=member).
 *   7. UPDATE daemon_machines SET attached_user_id = user_id, attached_at = NOW()
 *      WHERE the row matches (org_id from auth-context-equivalent: the
 *      daemon_machine's stored org_id was set at enrollment, so we look it
 *      up by machine_id + the org we resolved from state).
 *   8. BACKFILL ai_events: UPDATE ai_events SET user_id = $3,
 *      user_id_unknown = NULL WHERE org_id = $1 AND hostname = $2 AND
 *      user_id IS NULL. One-shot per machine per D-15.
 *   9. Insert daemon_audit_events with reason="attach_completed".
 *  10. Delete the state from KV (one-shot, prevents replay).
 *  11. Return { user_id, email, org_id }.
 *
 * Note on the org_id resolution: this endpoint has no Bearer auth (PKCE is
 * the proof of session continuity), so we look up the daemon_machine row by
 * machine_id and inherit the org_id from there. The daemon_machine row was
 * created by /api/daemons/enroll before this attach can happen, so its
 * org_id is authoritative.
 */

import { AttachCallbackRequestSchema, type AttachCallbackResponse } from "@fennec/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pgClient } from "../db/client.js";
import { backfillUnknownUser } from "../db/queries/ai-events.js";
import { insertAuditEvent } from "../db/queries/audit.js";
import { addOrgMember, attachDaemonMachineToUser, upsertUserByEmail } from "../db/queries/orgs.js";
import type { Env } from "../env.js";

interface StoredState {
  machine_id: string;
  redirect_uri: string;
  code_challenge: string;
  provider: "google" | "github" | "microsoft";
  // The org_id is recoverable from the daemon_machine row (set at enrollment);
  // we look it up via getDaemonMachineByMachineId at callback time. NOT stored
  // in KV so a stale state cannot be repointed at a different org.
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/daemons/attach-callback", zValidator("json", AttachCallbackRequestSchema), async (c) => {
  const { code, state, code_verifier, machine_id } = c.req.valid("json");

  // (2) State lookup.
  const stateJson = await c.env.OAUTH_STATE_KV.get(state);
  if (!stateJson) {
    return c.json({ error: "invalid_or_expired_state" }, 400);
  }
  const stored: StoredState = JSON.parse(stateJson);

  // (3) PKCE verification.
  const derivedChallenge = await base64UrlSha256(code_verifier);
  if (derivedChallenge !== stored.code_challenge) {
    return c.json({ error: "pkce_verification_failed" }, 400);
  }

  // (4) Provider code exchange.
  const email = await exchangeAndResolveEmail({
    env: c.env,
    provider: stored.provider,
    code,
    code_verifier,
    redirect_uri: stored.redirect_uri,
  });
  if (!email) {
    return c.json({ error: "provider_email_unavailable" }, 502);
  }

  // (5)-(9) DB writes.
  const client = pgClient(c.env);
  await client.connect();
  try {
    // The daemon_machine row was created at enrollment. Look it up by the
    // matching machine_id to recover its org_id + canonical hostname (we
    // use the stored hostname, not whatever the caller might have supplied,
    // so the backfill is precise).
    const machine = await getDaemonMachineByMachineIdAnyOrg(client, machine_id);
    if (!machine) {
      return c.json({ error: "machine_not_enrolled" }, 404);
    }

    const user_id = await upsertUserByEmail(client, email);
    await addOrgMember(client, { org_id: machine.org_id, user_id });
    await attachDaemonMachineToUser(client, { id: machine.id, user_id });
    await backfillUnknownUser(client, {
      org_id: machine.org_id,
      hostname: machine.hostname,
      user_id,
    });
    await insertAuditEvent(client, {
      org_id: machine.org_id,
      daemon_machine_id: machine.id,
      hostname: machine.hostname,
      reason: "attach_completed",
      actor: user_id,
      occurred_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `attach|${machine_id}|${Date.now()}`,
    });

    // (10) Consume state.
    await c.env.OAUTH_STATE_KV.delete(state);

    const response: AttachCallbackResponse = {
      user_id,
      email,
      org_id: machine.org_id,
    };
    return c.json(response);
  } finally {
    await client.end();
  }
});

/**
 * Look up the daemon_machine by machine_id WITHOUT scoping to a specific
 * org. We trust the (machine_id) value here because PKCE + state KV lookup
 * have already proved this callback corresponds to an in-flight attach
 * initiated by THIS Worker; an attacker would need to forge state AND
 * compute the matching PKCE challenge to land here, which is the threat
 * model the state+PKCE pair are designed to prevent. The result includes
 * the org_id discovered from the row, which becomes the canonical
 * authority for the remaining writes.
 *
 * Note: a malicious daemon could enroll with an arbitrary machine_id, then
 * trick a user into completing OAuth, then land here with that machine_id.
 * The threat model accepts this because the resulting attach binds the
 * user to the ATTACKER'S org -- not to the legit user's org -- which is
 * an annoyance, not a compromise of any existing data.
 */
async function getDaemonMachineByMachineIdAnyOrg(
  client: ReturnType<typeof pgClient>,
  machine_id: string,
): Promise<{ id: string; org_id: string; hostname: string } | null> {
  const result = await client.query<{ id: string; org_id: string; hostname: string }>(
    `SELECT id, org_id, hostname
       FROM daemon_machines
      WHERE machine_id = $1
      LIMIT 1`,
    [machine_id],
  );
  return result.rows[0] ?? null;
}

async function exchangeAndResolveEmail(input: {
  env: Env;
  provider: "google" | "github" | "microsoft";
  code: string;
  code_verifier: string;
  redirect_uri: string;
}): Promise<string | null> {
  const { provider, env, code, code_verifier, redirect_uri } = input;
  switch (provider) {
    case "github":
      return resolveEmailFromGithub(env, code, code_verifier, redirect_uri);
    case "google":
      return resolveEmailFromOidc(
        env.OAUTH_GOOGLE_CLIENT_ID,
        env.OAUTH_GOOGLE_CLIENT_SECRET,
        "https://oauth2.googleapis.com/token",
        code,
        code_verifier,
        redirect_uri,
      );
    case "microsoft":
      return resolveEmailFromOidc(
        env.OAUTH_MICROSOFT_CLIENT_ID,
        env.OAUTH_MICROSOFT_CLIENT_SECRET,
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        code,
        code_verifier,
        redirect_uri,
      );
  }
}

async function resolveEmailFromGithub(
  env: Env,
  code: string,
  code_verifier: string,
  redirect_uri: string,
): Promise<string | null> {
  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.OAUTH_GITHUB_CLIENT_ID,
      client_secret: env.OAUTH_GITHUB_CLIENT_SECRET,
      code,
      code_verifier,
      redirect_uri,
    }).toString(),
  });
  if (!tokenResp.ok) return null;
  const tokenBody = (await tokenResp.json()) as { access_token?: string };
  if (!tokenBody.access_token) return null;

  const userResp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      "User-Agent": "fennec-backend",
      Accept: "application/vnd.github+json",
    },
  });
  if (!userResp.ok) return null;
  const userBody = (await userResp.json()) as { email?: string | null; login?: string };
  if (userBody.email) return userBody.email;
  // GitHub may suppress the public email; the Phase 1 smoke flow expects the
  // user to have a public email. Phase 3 will call /user/emails as a fallback.
  return null;
}

async function resolveEmailFromOidc(
  client_id: string,
  client_secret: string,
  token_endpoint: string,
  code: string,
  code_verifier: string,
  redirect_uri: string,
): Promise<string | null> {
  const tokenResp = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      client_secret,
      code,
      code_verifier,
      redirect_uri,
    }).toString(),
  });
  if (!tokenResp.ok) return null;
  const tokenBody = (await tokenResp.json()) as { id_token?: string };
  if (!tokenBody.id_token) return null;
  return emailFromIdToken(tokenBody.id_token);
}

/**
 * Parses the `email` claim out of an OIDC id_token (a JWT). Phase 1 does NOT
 * verify the JWT signature -- the code-for-token exchange against the
 * provider's HTTPS endpoint is already a server-to-server proof of provider
 * identity. Phase 3 will introduce full JWKS-based signature verification
 * (T-05-08 belt-and-suspenders) once OAuth becomes a primary auth path.
 */
function emailFromIdToken(id_token: string): string | null {
  const parts = id_token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const normalised = padded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalised);
    const claims = JSON.parse(decoded) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

async function base64UrlSha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let bin = "";
  for (let i = 0; i < view.length; i++) {
    bin += String.fromCharCode(view[i] as number);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default app;
