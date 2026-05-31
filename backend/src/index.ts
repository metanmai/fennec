/**
 * @fennec/backend — Cloudflare Workers + Hono ingest service. Phase 1 Plan
 * 01-01 (Wave 0) ships only this placeholder; the Hono routes
 * (`/api/daemons/enroll`, `/api/events/batch`, `/api/daemons/attach-callback`,
 * `/api/daemons/uninstall`) and Supabase wiring arrive in plans 01-05 / 01-06.
 *
 * Note: `@cloudflare/workers-types` is intentionally NOT depended on in this
 * plan — it lands in plan 01-05 alongside the actual Worker code.
 */
export const PLACEHOLDER_VERSION = "0.1.0";
