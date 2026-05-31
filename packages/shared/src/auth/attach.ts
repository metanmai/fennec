import { z } from "zod";

/**
 * `AttachCallbackRequestSchema` — body of `POST /api/daemons/attach`
 * (AUTH-16, Pattern 10 in 01-RESEARCH.md).
 *
 * The dev-OAuth attach flow uses RFC 8252 §7.3 loopback redirect URIs
 * with PKCE per RFC 7636. The daemon's loopback server catches the
 * provider's redirect, then forwards (code, state, code_verifier,
 * machine_id) to the backend, which exchanges the code for an SSO
 * token and binds user_id → daemon_machine.
 *
 * RFC 7636 §4.1 mandates `code_verifier` length 43-128 chars. Shorter
 * values weaken PKCE; longer values are uninteroperable across
 * providers. The schema enforces both bounds.
 */
export const AttachCallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  machine_id: z.string().min(8),
});
export type AttachCallbackRequest = z.infer<typeof AttachCallbackRequestSchema>;

/**
 * `AttachCallbackResponseSchema` — body of the response. Returns the
 * resolved user identity for the daemon to display in `fennec status`
 * and to log to /var/log/fennec/daemon.log. The org_id is echoed for
 * sanity (it must match the enrolled api_key's org_id).
 */
export const AttachCallbackResponseSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  org_id: z.string().uuid(),
});
export type AttachCallbackResponse = z.infer<typeof AttachCallbackResponseSchema>;
