import type { Client } from "pg";
import { pgClient } from "../db/client.js";
import { getApiKeyByTokenHash, type ResolvedApiKey } from "../db/queries/api-keys.js";
import type { Env } from "../env.js";
import { sha256Hex } from "./hash.js";

/**
 * Resolves a Bearer token to its `(org_id, api_key_id, daemon_machine_id,
 * hostname)` metadata via sha256 lookup in `api_keys.token_hash`.
 *
 * Two call patterns:
 *
 *  1. Production hot path (bearer-auth middleware): pass `env` and let the
 *     function manage the pg client lifecycle. The bearer-auth middleware
 *     calls this from a Hono `verifyToken` callback (Pattern 11). The middleware
 *     opens its own connection because Hono's bearerAuth API does not allow
 *     passing a request-scoped client through the verifier signature.
 *
 *  2. Test / internal calls: pass `client` directly when you already have an
 *     open connection (e.g. the unit tests in `resolve-api-key.test.ts` inject
 *     a mock `pg.Client`-shaped object).
 *
 * Returns `null` on miss (unknown token, revoked key, or invalid signature
 * shape) -- never throws on lookup failure. Threat T-05-01 mitigated by the
 * sha256 lookup itself (an attacker cannot brute force 2^256).
 *
 * Threat T-05-04 mitigated: this function does NOT log the raw token. Only
 * the api_key_id (UUID) is exposed up the call chain.
 */
export async function resolveApiKey(token: string, env: Env, client?: Client): Promise<ResolvedApiKey | null> {
  const token_hash = await sha256Hex(token);
  if (client) {
    return getApiKeyByTokenHash(client, token_hash);
  }
  // Production path: open a one-shot connection for the lookup. The
  // bearer-auth middleware does not have a place to plumb the per-request
  // client through Hono's verifyToken callback, so we accept a slightly
  // larger per-request DB cost on the auth lookup (one extra round trip)
  // in exchange for a simpler integration. Hyperdrive pooling absorbs the
  // overhead at the edge.
  const ownedClient = pgClient(env);
  await ownedClient.connect();
  try {
    return await getApiKeyByTokenHash(ownedClient, token_hash);
  } finally {
    await ownedClient.end();
  }
}
