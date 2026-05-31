import type { Client } from "pg";

/**
 * Per-machine API key queries against the `api_keys` table
 * (created in `supabase/migrations/20260531000001_orgs_users_keys.sql`).
 *
 * All queries use parameterised `$1`-style placeholders -- NEVER string
 * concatenation -- per threat T-05-03 (SQL injection mitigation).
 */

export interface ResolvedApiKey {
  api_key_id: string;
  org_id: string;
  daemon_machine_id: string;
  hostname: string;
}

/**
 * Looks up an active API key by its sha256-hex token hash.
 *
 * The partial UNIQUE index `idx_api_keys_token_hash WHERE revoked_at IS NULL`
 * (Plan 01-04) keeps this lookup O(1) regardless of how many keys have been
 * revoked historically. The JOIN to `daemon_machines` brings back the hostname
 * the daemon enrolled with so handlers can derive `unknown@${hostname}` for
 * pre-attach events per D-15.
 *
 * Returns `null` if no matching active key exists (caller emits 401).
 */
export async function getApiKeyByTokenHash(client: Client, token_hash: string): Promise<ResolvedApiKey | null> {
  const result = await client.query<ResolvedApiKey>(
    `SELECT k.id AS api_key_id,
            k.org_id,
            k.daemon_machine_id,
            m.hostname
       FROM api_keys k
       JOIN daemon_machines m ON m.id = k.daemon_machine_id
      WHERE k.token_hash = $1
        AND k.revoked_at IS NULL
      LIMIT 1`,
    [token_hash],
  );
  return result.rows[0] ?? null;
}

/**
 * Revokes an API key by id. Used by `/api/daemons/uninstall` (DAE-19) and by
 * the re-enrollment path (Plan 01-05 Task 2): re-enrolling the same machine
 * always issues a fresh token AND marks the prior one revoked, per the
 * idempotency contract documented in `daemons-enroll.ts`.
 */
export async function revokeApiKey(client: Client, api_key_id: string): Promise<void> {
  await client.query(
    `UPDATE api_keys
        SET revoked_at = NOW()
      WHERE id = $1
        AND revoked_at IS NULL`,
    [api_key_id],
  );
}

/**
 * Issues a new API key row. The caller has already generated the raw token
 * (urandom-based base64url) and computed `token_hash = sha256Hex(token)`;
 * this function only persists the hash. The raw token is returned to the
 * daemon by the enroll handler and NEVER stored.
 *
 * Returns the inserted row's id.
 */
export async function issueApiKeyForMachine(
  client: Client,
  input: { org_id: string; daemon_machine_id: string; token_hash: string },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO api_keys (org_id, daemon_machine_id, token_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.org_id, input.daemon_machine_id, input.token_hash],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("issueApiKeyForMachine: insert returned no row");
  }
  return row.id;
}

/**
 * Revokes any currently-active API key for a (org_id, daemon_machine_id)
 * pair. Used during re-enrollment: re-enrolling the same machine always
 * invalidates the prior token before issuing a new one. Idempotent --
 * returns the number of rows revoked (0 on a first-time enroll).
 */
export async function revokeActiveKeysForMachine(
  client: Client,
  input: { org_id: string; daemon_machine_id: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE api_keys
        SET revoked_at = NOW()
      WHERE org_id = $1
        AND daemon_machine_id = $2
        AND revoked_at IS NULL`,
    [input.org_id, input.daemon_machine_id],
  );
  return result.rowCount ?? 0;
}
