/**
 * fennec backend Worker entry point.
 *
 * Phase 1 Plan 01-05 mounts six routes (all wired here so Hono's router knows
 * them at module load):
 *   - POST /api/events/batch        (ING-01..04, AUTH-10)
 *   - POST /api/heartbeats          (CAP-14 storage path)
 *   - POST /api/daemons/enroll      (AUTH-14)
 *   - GET  /api/auth/sso            (AUTH-16, half 1)
 *   - POST /api/daemons/attach-callback (AUTH-16, half 2)
 *   - POST /api/daemons/uninstall   (DAE-19)
 *
 * Plus a `/health` GET for Plan 01-10's smoke check.
 *
 * Plan 01-10's `wrangler deploy` puts this Worker live. Until then the entry
 * exists for `wrangler dev` + the integration tests.
 */

import { Hono } from "hono";
import attachCallbackApp from "./api/attach-callback.js";
import attachStartApp from "./api/attach-start.js";
import daemonsEnrollApp from "./api/daemons-enroll.js";
import daemonsUninstallApp from "./api/daemons-uninstall.js";
import eventsBatchApp from "./api/events-batch.js";
import heartbeatsApp from "./api/heartbeats.js";
import type { Env, Variables } from "./env.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/", eventsBatchApp);
app.route("/", heartbeatsApp);
app.route("/", daemonsEnrollApp);
app.route("/", attachStartApp);
app.route("/", attachCallbackApp);
app.route("/", daemonsUninstallApp);

export default app;
