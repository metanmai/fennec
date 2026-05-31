/**
 * POST /api/daemons/enroll (AUTH-14).
 *
 * The ONLY Phase 1 backend endpoint without a Bearer auth gate -- it's the
 * bootstrap path that trades the org's install_secret for the first
 * per-machine Bearer token.
 *
 * IDEMPOTENCY CONTRACT (interpretation deviated from the planner's first-pass
 * spec -- see the SUMMARY's Deviations section):
 *
 *   The daemon_machine identity is stable across re-enrolls: re-enrolling the
 *   same machine_id under the same org always returns the SAME daemon_machine
 *   row id (`(org_id, machine_id)` UNIQUE).
 *
 *   The API KEY is FRESHLY ISSUED on every successful enroll. The PRIOR key
 *   for this (org_id, daemon_machine_id) is REVOKED (`revoked_at = NOW()`)
 *   before the new one is inserted.
 *
 *   Rationale: the backend stores `token_hash` only -- it cannot recover the
 *   plaintext to return on a "same key" idempotent retry. Forcing the daemon
 *   to receive a new token on re-enroll is the security-correct choice (the
 *   old key dies the moment the new one is minted) and matches the
 *   threat-model expectation that install_secret replay rotates keys rather
 *   than reuses them (T-05-06).
 *
 * STAGES:
 *   1. zValidator parses EnrollRequestSchema (install_secret min 32 chars).
 *   2. sha256Hex(install_secret) -> lookup org in `orgs.install_secret_hash`
 *      WHERE install_secret_expires_at > NOW().
 *      Miss -> 401 invalid_or_expired_install_secret.
 *   3. UPSERT daemon_machines by (org_id, machine_id). Returns stable id.
 *   4. Revoke any active api_keys for this (org_id, daemon_machine_id).
 *   5. Generate a 32-byte urandom token, base64url-encode, prefix
 *      "fennec_" so it's visible in logs.
 *   6. Insert api_keys with sha256(token) as token_hash.
 *   7. Audit-event with reason="enrollment_completed".
 *   8. Return EnrollResponseSchema-shaped body.
 */

import { EnrollRequestSchema, type EnrollResponse } from "@fennec/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pgClient } from "../db/client.js";
import { issueApiKeyForMachine, revokeActiveKeysForMachine } from "../db/queries/api-keys.js";
import { insertAuditEvent } from "../db/queries/audit.js";
import { lookupOrgByInstallSecret, upsertDaemonMachine } from "../db/queries/orgs.js";
import type { Env } from "../env.js";
import { sha256Hex } from "../lib/hash.js";

const app = new Hono<{ Bindings: Env }>();

app.post("/api/daemons/enroll", zValidator("json", EnrollRequestSchema), async (c) => {
  const { install_secret, machine_id, hostname, os } = c.req.valid("json");

  const client = pgClient(c.env);
  await client.connect();
  try {
    // (2) Hash + lookup org.
    const install_secret_hash = await sha256Hex(install_secret);
    const org = await lookupOrgByInstallSecret(client, install_secret_hash);
    if (!org) {
      return c.json({ error: "invalid_or_expired_install_secret" }, 401);
    }

    // (3) UPSERT daemon_machine.
    const machine = await upsertDaemonMachine(client, {
      org_id: org.id,
      machine_id,
      hostname,
      os,
    });

    // (4) Revoke any prior active key (no-op on first enroll).
    await revokeActiveKeysForMachine(client, {
      org_id: org.id,
      daemon_machine_id: machine.id,
    });

    // (5) Generate fresh token + hash.
    const token = generateBearerToken();
    const token_hash = await sha256Hex(token);

    // (6) Issue api_key row.
    const api_key_id = await issueApiKeyForMachine(client, {
      org_id: org.id,
      daemon_machine_id: machine.id,
      token_hash,
    });

    // (7) Audit-event.
    await insertAuditEvent(client, {
      org_id: org.id,
      daemon_machine_id: machine.id,
      hostname,
      reason: "enrollment_completed",
      actor: null,
      occurred_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `enroll|${machine_id}|${Date.now()}`,
    });

    // (8) Response.
    const response: EnrollResponse = {
      api_key: token,
      api_key_id,
      org_id: org.id,
      org_name: org.name,
      privacy_policy_url: `${c.env.FENNEC_BASE_URL}/privacy/${org.id}`,
    };
    return c.json(response);
  } finally {
    await client.end();
  }
});

/**
 * Generates a 32-byte urandom Bearer token, base64url-encoded, prefixed
 * `fennec_` so it's recognisable in logs and easy to grep. The raw token is
 * returned ONCE to the daemon at enrollment and never persisted server-side
 * (we store sha256(token) instead).
 *
 * The 2^256 keyspace makes brute-force lookup infeasible (T-05-01).
 */
function generateBearerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = base64urlEncode(bytes);
  return `fennec_${b64}`;
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default app;
