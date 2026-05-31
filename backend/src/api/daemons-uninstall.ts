/**
 * POST /api/daemons/uninstall (DAE-19).
 *
 * The daemon emits this audit event during teardown before its binary is
 * removed (user_initiated personal uninstall, mdm_revoke org pull, or
 * admin_initiated dashboard kill-switch -- the three valid reasons per
 * UninstallReasonSchema).
 *
 * Behaviour:
 *   1. fennecBearerAuth resolves the calling api_key -> { org_id, api_key_id,
 *      daemon_machine_id, hostname }.
 *   2. zValidator(UninstallAuditEventSchema) parses the body (reason must be
 *      in the 3-value enum; outside -> 400).
 *   3. Insert a daemon_audit_events row with the supplied reason.
 *   4. Revoke the calling api_key (sets revoked_at = NOW()). The DAEMON IS
 *     DEAD AFTER THIS CALL -- subsequent calls with the same Bearer token
 *     will return 401 because the partial-index lookup filters revoked rows.
 *   5. Return { audit_id }.
 */

import { UninstallAuditEventSchema } from "@fennec/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pgClient } from "../db/client.js";
import { revokeApiKey } from "../db/queries/api-keys.js";
import { insertAuditEvent } from "../db/queries/audit.js";
import type { Env, Variables } from "../env.js";
import { fennecBearerAuth } from "../lib/bearer-auth.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/daemons/uninstall", fennecBearerAuth());

app.post("/api/daemons/uninstall", zValidator("json", UninstallAuditEventSchema), async (c) => {
  const audit = c.req.valid("json");
  const org_id = c.get("org_id");
  const api_key_id = c.get("api_key_id");
  const daemon_machine_id = c.get("daemon_machine_id");

  const client = pgClient(c.env);
  await client.connect();
  try {
    const audit_id = await insertAuditEvent(client, {
      org_id,
      daemon_machine_id,
      hostname: audit.hostname,
      reason: audit.reason,
      actor: audit.actor ?? null,
      occurred_at: audit.occurred_at,
      schema_version: audit.schema_version,
      idempotency_key: audit.idempotency_key,
    });
    await revokeApiKey(client, api_key_id);
    return c.json({ audit_id });
  } finally {
    await client.end();
  }
});

export default app;
