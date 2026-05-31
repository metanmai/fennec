import type { Client } from "pg";

/**
 * Org + daemon_machine queries.
 *
 * Schema source: `supabase/migrations/20260531000001_orgs_users_keys.sql`.
 * All queries use parameterised placeholders (`$1`, `$2`, ...).
 */

export interface OrgRecord {
  id: string;
  name: string;
}

export interface UpsertedDaemonMachine {
  id: string;
  attached_user_id: string | null;
}

/**
 * Looks up the org row by `install_secret_hash` (Plan 01-05's enroll handler
 * already computed `sha256Hex(install_secret)`). Filters on
 * `install_secret_expires_at > NOW()` -- expired install secrets are rejected
 * with the same error as invalid ones to avoid leaking timing information.
 *
 * Returns `null` if no matching active org is found.
 */
export async function lookupOrgByInstallSecret(client: Client, install_secret_hash: string): Promise<OrgRecord | null> {
  const result = await client.query<OrgRecord>(
    `SELECT id, name
       FROM orgs
      WHERE install_secret_hash = $1
        AND install_secret_expires_at > NOW()
      LIMIT 1`,
    [install_secret_hash],
  );
  return result.rows[0] ?? null;
}

/**
 * Upserts a daemon_machine row by (org_id, machine_id). The UNIQUE constraint
 * on `(org_id, machine_id)` makes the conflict clause deterministic. Returns
 * the row id + the current `attached_user_id` (NULL pre-attach, populated
 * after a successful dev-OAuth attach per D-15).
 *
 * Idempotency contract: re-enrolling the SAME machine_id under the SAME org
 * returns the SAME `id` row -- the daemon_machine identity is stable across
 * re-enrolls. API-key rotation is handled separately by the caller.
 */
export async function upsertDaemonMachine(
  client: Client,
  input: { org_id: string; machine_id: string; hostname: string; os: string },
): Promise<UpsertedDaemonMachine> {
  const result = await client.query<UpsertedDaemonMachine>(
    `INSERT INTO daemon_machines (org_id, machine_id, hostname, os)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, machine_id) DO UPDATE
       SET hostname = EXCLUDED.hostname,
           os       = EXCLUDED.os
     RETURNING id, attached_user_id`,
    [input.org_id, input.machine_id, input.hostname, input.os],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("upsertDaemonMachine: insert returned no row");
  }
  return row;
}

/**
 * Resolves `(machine_id, org_id) -> daemon_machine.id`. Used by the OAuth
 * attach callback to update `attached_user_id` + `attached_at`.
 */
export async function getDaemonMachineByMachineId(
  client: Client,
  input: { org_id: string; machine_id: string },
): Promise<{ id: string; hostname: string } | null> {
  const result = await client.query<{ id: string; hostname: string }>(
    `SELECT id, hostname
       FROM daemon_machines
      WHERE org_id = $1
        AND machine_id = $2
      LIMIT 1`,
    [input.org_id, input.machine_id],
  );
  return result.rows[0] ?? null;
}

/**
 * Updates a daemon_machine to record the attached developer identity.
 * Called once per machine on first successful dev-OAuth attach.
 */
export async function attachDaemonMachineToUser(client: Client, input: { id: string; user_id: string }): Promise<void> {
  await client.query(
    `UPDATE daemon_machines
        SET attached_user_id = $2,
            attached_at      = NOW()
      WHERE id = $1`,
    [input.id, input.user_id],
  );
}

/**
 * UPSERTs a user by email (the OAuth provider returns email; we use it as the
 * stable identity key in Phase 1). Returns the resolved user id.
 *
 * Phase 3 will extend this to capture sso_provider + sso_external_id so the
 * same human identity links across multiple OAuth providers; Phase 1 just
 * needs email -> user_id resolution.
 */
export async function upsertUserByEmail(client: Client, email: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (email)
     VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("upsertUserByEmail: insert returned no row");
  }
  return row.id;
}

/**
 * Adds a user to an org with the default `member` role. Idempotent -- if the
 * user is already a member of the org (e.g. attaching a second machine), the
 * INSERT is a no-op.
 */
export async function addOrgMember(
  client: Client,
  input: { org_id: string; user_id: string; role?: "admin" | "member" },
): Promise<void> {
  await client.query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [input.org_id, input.user_id, input.role ?? "member"],
  );
}
