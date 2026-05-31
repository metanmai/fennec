/**
 * POST /api/heartbeats (CAP-14).
 *
 * Adapter heartbeats are emitted on a timer regardless of whether any events
 * were parsed. `events_parsed = 0` is a meaningful "alive but quiet" signal
 * vs the implicit "dead" we'd get from silence (per PITFALL P3). The row's
 * `idempotency_key UNIQUE` constraint plus `ON CONFLICT DO NOTHING` prevents
 * double-recording the same interval if the daemon retries.
 *
 * org_id + daemon_machine_id come from the auth context (T-05-02 mitigation).
 */

import { AdapterHeartbeatSchema } from "@fennec/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pgClient } from "../db/client.js";
import { insertHeartbeat } from "../db/queries/heartbeats.js";
import type { Env, Variables } from "../env.js";
import { fennecBearerAuth } from "../lib/bearer-auth.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/heartbeats", fennecBearerAuth());

app.post("/api/heartbeats", zValidator("json", AdapterHeartbeatSchema), async (c) => {
  const hb = c.req.valid("json");
  const org_id = c.get("org_id");
  const daemon_machine_id = c.get("daemon_machine_id");

  const client = pgClient(c.env);
  await client.connect();
  try {
    await insertHeartbeat(client, {
      org_id,
      daemon_machine_id,
      adapter: hb.adapter,
      adapter_version: hb.adapter_version,
      schema_hash: hb.schema_hash,
      events_parsed: hb.events_parsed,
      parse_errors: hb.parse_errors,
      daemon_unreachable_count: hb.daemon_unreachable_count,
      interval_start: hb.interval_start,
      interval_end: hb.interval_end,
      schema_version: hb.schema_version,
      idempotency_key: hb.idempotency_key,
    });
    return c.json({ status: "recorded" }, 201);
  } finally {
    await client.end();
  }
});

export default app;
