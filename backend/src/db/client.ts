import { Client } from "pg";
import type { Env } from "../env.js";

/**
 * Per-request `pg.Client` factory using the Hyperdrive binding. Hyperdrive
 * provides a pooled `connectionString` at the edge so the Worker avoids the
 * 50-150ms per-request TCP+TLS handshake to Supabase Postgres
 * (`developers.cloudflare.com/hyperdrive`).
 *
 * Lifecycle contract (Pattern 11 in 01-RESEARCH.md):
 *   const client = pgClient(env);
 *   await client.connect();
 *   try {
 *     // ... await client.query(...) ...
 *   } finally {
 *     ctx.waitUntil(client.end());
 *   }
 *
 * Why we don't cache the client across requests: every Hono request maps to
 * its own short-lived Worker isolate's `fetch` invocation; the Hyperdrive
 * binding is the connection pool. Reusing a `pg.Client` across requests would
 * leak partial transaction state on a worker recycle.
 */
export function pgClient(env: Env): Client {
  return new Client({ connectionString: env.HYPERDRIVE.connectionString });
}
