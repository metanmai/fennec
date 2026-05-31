/**
 * @fennec/shared — canonical event schema, heartbeat types, and cross-tier
 * contracts shared between the daemon (Node) and the backend (Cloudflare
 * Workers). Phase 1 Plan 01-01 (Wave 0) ships only this placeholder so
 * `tsc --build` produces output and Vitest discovers the workspace. The
 * real `CanonicalEvent` / `AdapterHeartbeat` Zod schemas land in plan 01-02.
 */
export const PLACEHOLDER_VERSION = "0.1.0";
