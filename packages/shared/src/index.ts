/**
 * @fennec/shared — canonical event schema, heartbeat types, auth
 * request/response shapes, and idempotency-key derivation shared
 * between the daemon (Node 22) and the backend (Cloudflare Workers).
 *
 * Runtime-neutral: this module's full transitive surface uses only
 * `zod` and the Web Crypto API — no `node:*` imports — so Workers
 * can consume it without polyfills (Pattern 1 in 01-RESEARCH.md).
 */

export * from "./auth/attach.js";
export * from "./auth/enrollment.js";
export * from "./auth/uninstall.js";
export * from "./events/canonical.js";
export * from "./events/claude-code-payload.js";
export * from "./events/heartbeat.js";
export * from "./events/idempotency.js";
export * from "./events/kinds.js";
