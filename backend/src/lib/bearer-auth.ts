import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import type { Env, Variables } from "../env.js";
import { resolveApiKey } from "./resolve-api-key.js";

/**
 * Hono middleware factory wiring `hono/bearer-auth` -> `resolveApiKey`.
 *
 * Pattern 11 in 01-RESEARCH.md: every authenticated route applies this once.
 * The middleware:
 *   1. Reads `Authorization: Bearer <token>` from the request.
 *   2. Calls `resolveApiKey` -> sha256(token) -> lookup `api_keys.token_hash`.
 *   3. On match, populates `c.var.org_id / api_key_id / daemon_machine_id /
 *      hostname` -- this is the auth-context tenancy that handlers stamp onto
 *      every inserted row (per T-05-02, the request body is NEVER trusted).
 *   4. On miss, returns 401 via hono/bearer-auth's default response.
 *
 * Threat T-05-04: this middleware does NOT log the raw bearer token. The Hono
 * default `errorMessage` for `bearer-auth` is a static string ("Unauthorized")
 * -- it cannot leak the rejected token. Application code MUST avoid logging
 * `c.req.header("authorization")` (verified by static grep in tests).
 */
export function fennecBearerAuth(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return bearerAuth({
    verifyToken: async (token, c) => {
      const meta = await resolveApiKey(token, c.env as Env);
      if (!meta) {
        return false;
      }
      c.set("org_id", meta.org_id);
      c.set("api_key_id", meta.api_key_id);
      c.set("daemon_machine_id", meta.daemon_machine_id);
      c.set("hostname", meta.hostname);
      return true;
    },
  });
}
