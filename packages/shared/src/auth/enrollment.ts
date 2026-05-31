import { z } from "zod";

/**
 * `EnrollRequestSchema` — body of `POST /api/daemons/enroll` (AUTH-14).
 *
 * The daemon trades the org's install_secret (delivered via MDM
 * payload in org-tier installs, or self-issued by the first-run
 * wizard in personal-tier per D-10) for a per-machine API key.
 *
 * `install_secret.min(32)` is a defence-in-depth entropy floor
 * against brute-forcing the keyspace (threat T-02-04). The backend
 * additionally hashes the secret server-side (Plan 01-05) and
 * Phase 3 layers rate-limiting on top.
 *
 * `machine_id.min(8)` rejects placeholder strings; on macOS the
 * stable identifier is IOPlatformUUID (36 chars); Linux uses
 * /etc/machine-id (32 chars); Windows uses the MachineGuid registry
 * value (36 chars) — all comfortably above 8.
 */
export const EnrollRequestSchema = z.object({
  install_secret: z.string().min(32),
  machine_id: z.string().min(8),
  hostname: z.string(),
  os: z.enum(["darwin", "linux", "win32"]),
});
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;

/**
 * `EnrollResponseSchema` — body of the enrollment response. Carries the
 * per-machine API key + org metadata for the first-run UX (privacy
 * policy URL is surfaced in the consent screen per PRIV-07).
 *
 * `api_key` is the raw token; the backend stores only its hash. UUIDs
 * are validated to catch upstream-formatter bugs.
 */
export const EnrollResponseSchema = z.object({
  api_key: z.string().min(1),
  api_key_id: z.string().uuid(),
  org_id: z.string().uuid(),
  org_name: z.string(),
  privacy_policy_url: z.string().url(),
});
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;
