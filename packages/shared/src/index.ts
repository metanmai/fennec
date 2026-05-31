/**
 * @fennec/shared — canonical event schema, heartbeat types, and
 * cross-tier contracts shared between the daemon (Node 22) and the
 * backend (Cloudflare Workers). Runtime-neutral: zod only, no `node:*`
 * imports, so Workers can consume it without polyfills.
 */

export * from "./events/canonical.js";
export * from "./events/claude-code-payload.js";
export * from "./events/heartbeat.js";
export * from "./events/kinds.js";
