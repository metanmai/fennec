/**
 * POST /api/events/batch (ING-01 .. ING-04, AUTH-10).
 *
 * Pattern 11 from 01-RESEARCH.md: bearerAuth -> zValidator -> per-event
 * `INSERT ... ON CONFLICT DO NOTHING`. The handler is intentionally tiny.
 *
 * HOT-PATH PURITY GUARD (ING-04): this module MUST NOT import any Phase 2
 * analytics modules (those run as Queue consumers). The ingest path stays
 * hot, dumb, and idempotent. The `events-batch.hot-path.test.ts` unit test
 * enforces this via static `from "..."` import grep on this file's source --
 * see that test for the exact forbidden module-name patterns it checks.
 *
 * org_id stamping: the row's `org_id` is taken from the auth context
 * (c.get("org_id")), NEVER from the request body. Threat T-05-02 mitigation.
 */

import { EventBatchSchema } from "@fennec/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pgClient } from "../db/client.js";
import { type InsertableAiEvent, insertAiEvent } from "../db/queries/ai-events.js";
import type { Env, Variables } from "../env.js";
import { fennecBearerAuth } from "../lib/bearer-auth.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/events/batch", fennecBearerAuth());

app.post("/api/events/batch", zValidator("json", EventBatchSchema), async (c) => {
  const { events } = c.req.valid("json");
  const org_id = c.get("org_id");
  const machine_hostname = c.get("hostname");

  const client = pgClient(c.env);
  await client.connect();
  try {
    let accepted = 0;
    for (const event of events) {
      // D-15: pre-attach events tagged "unknown@${hostname}". Phase 1 default
      // is always-pre-attach until plan 01-08 wires the daemon-side attach;
      // post-attach plumbing of `user_id` lives in plan 01-07 when the
      // daemon learns its bound identity.
      const row: InsertableAiEvent = {
        idempotency_key: event.idempotency_key,
        org_id,
        user_id: null,
        user_id_unknown: `unknown@${event.hostname || machine_hostname}`,
        tool: event.tool,
        occurred_at: event.occurred_at,
        payload: event.payload,
        schema_version: event.schema_version,
        redaction_applied_at: event.redaction_applied_at,
        redaction_version_hash: event.redaction_version_hash,
        hostname: event.hostname,
      };
      const inserted = await insertAiEvent(client, row);
      // We return the count of events the daemon submitted (NOT the number of
      // actual DB inserts). Per ING-02, the daemon retried-and-deduped path
      // sees the same `accepted` count on every retry -- replay-safe.
      accepted += 1;
      void inserted; // intentionally unused -- the daemon doesn't need it
    }
    return c.json({ accepted });
  } finally {
    await client.end();
  }
});

export default app;
