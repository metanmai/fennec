/**
 * Shim-secret store (Plan 01-07 Task 3).
 *
 * The shared secret between the Go hook shim binary and the daemon's
 * loopback bridge. In production:
 *   - Generated at daemon install time (Plan 01-09) via `generateShimSecret()`
 *   - Written to `/etc/fennec/shim-secret` mode 0644 (Pattern 9 threat model:
 *     world-readable so the user-context shim can read it; loopback is
 *     not network-exposed so same-UID processes already have queue access)
 *   - Read by the daemon at boot via `readShimSecret({ shimSecretPath: ... })`
 *   - Embedded into the shim's environment via the managed-settings entry
 *     that points at the shim (FENNEC_SHIM_SECRET = <value>)
 *
 * Threat model:
 *  - T-07-01 (spoofing forged hook posts): the bridge validates this
 *    secret on every POST. Same-UID processes CAN read the file, but
 *    that's accepted in Pattern 9 — local loopback noise is the threat,
 *    not network attackers.
 *  - T-07-SC (no new daemon deps): uses node:crypto + node:fs from stdlib.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export interface ReadShimSecretEnv {
  /** Path to the secret file. Defaults to `/etc/fennec/shim-secret` in prod. */
  shimSecretPath: string;
}

/**
 * Read the daemon's shim secret. Returns `null` if the file doesn't
 * exist (daemon not yet enrolled / installer hasn't run); throws on
 * permission-denied or other I/O error so the daemon can surface a
 * clear startup failure.
 */
export function readShimSecret(env: ReadShimSecretEnv): string | null {
  if (!existsSync(env.shimSecretPath)) return null;
  // readFileSync throws on permission-denied — let it propagate; daemon
  // boot logic catches and logs.
  const raw = readFileSync(env.shimSecretPath, "utf-8");
  // Trim trailing newlines (common in shell-piped secret files). An
  // empty file (zero-byte) is NOT treated as missing — that's a real
  // configuration error and the daemon should refuse loopback POSTs
  // against an empty secret.
  return raw.replace(/[\r\n]+$/, "");
}

/**
 * Generate a 32-byte cryptographically-random shim secret, base64url-encoded
 * (no padding). The result is safe to embed in JSON managed-settings
 * entries or environment variables.
 *
 * 32 bytes (256 bits) is well above the threshold needed to make
 * brute-force forgery infeasible on a local loopback boundary; 43 chars
 * base64url fits comfortably in any env-var-sized buffer.
 */
export function generateShimSecret(): string {
  return randomBytes(32).toString("base64url");
}
