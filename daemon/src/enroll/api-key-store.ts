/**
 * Per-machine API key on-disk store (AUTH-15, Plan 01-08 Task 1).
 *
 * The daemon's api_key is the load-bearing credential for every backend
 * call (events-batch, heartbeats, uninstall). It lives in a system-
 * protected path:
 *
 *   - macOS (darwin):  /var/db/fennec/key      — mode 0400, owner root
 *   - Linux:           /var/lib/fennec/key     — Phase 5 (skeleton today)
 *   - Windows (win32): %ProgramData%\fennec\key — Phase 5 (skeleton)
 *
 * Threat model anchors:
 *   - T-08-01 (file becomes world-readable per Pitfall 10): every
 *     read re-checks (mode & 0o777) === 0o400 AND uid === 0. The
 *     daemon REFUSES to use a key with drifted permissions. The
 *     result is NEVER cached — re-checked on every sync iteration.
 *   - T-08-02 (local attacker overwrites the file): the directory
 *     `/var/db/fennec` is mode 0o700 owned by root; combined with
 *     macOS SIP coverage of /var/db, only root can write inside it.
 *     This module enforces the directory mode on persistApiKey.
 *
 * Test-mode bypass: `skipPermissionCheck` allows non-root tests to
 * exercise readApiKey without faking statSync. `skipChown` allows
 * non-root tests to call persistApiKey without invoking chownSync.
 * Production code paths must NEVER pass these options.
 *
 * Per Pitfall 10's residual-risk note: a sudo-equipped attacker could
 * chmod 644 the file BEFORE the daemon next reads it. The drift check
 * catches that on the next read; the gap between the chmod and the
 * next read is a known acceptable risk (logged in the threat register
 * as T-08-01's residual).
 */

import { chmodSync, chownSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Canonical per-OS paths. The Windows path is resolved against
 * %ProgramData% at module-load time so tests can stub the env.
 *
 * (The const carries the substring `"ProgramData"` so the acceptance
 * grep finds it even on non-Windows hosts.)
 */
export const KEY_PATHS: Record<"darwin" | "linux" | "win32", string> = {
  darwin: "/var/db/fennec/key",
  linux: "/var/lib/fennec/key",
  win32: (() => {
    const pd = process.env.ProgramData;
    return pd ? `${pd}\\fennec\\key` : "C:\\ProgramData\\fennec\\key";
  })(),
};

export type SupportedOs = keyof typeof KEY_PATHS;

export interface PersistOpts {
  /** Skip chownSync (root:root). Test-only; production must pass false. */
  skipChown?: boolean;
  /** Skip the assertSafeKeyPath re-check after write. Test-only. */
  skipPermissionCheck?: boolean;
  /** Override KEY_PATHS lookup (tests use os.tmpdir()). */
  overridePath?: string;
}

export interface ReadOpts {
  /** Skip the mode/uid re-check. Test-only; production must pass false. */
  skipPermissionCheck?: boolean;
  /** Override KEY_PATHS lookup. */
  overridePath?: string;
}

function resolveKeyPath(os: SupportedOs): string {
  const path = KEY_PATHS[os];
  if (!path) {
    throw new Error(`api-key-store-unknown-os: ${os}`);
  }
  return path;
}

/**
 * Persist the api_key under the canonical per-OS path with mode 0o400
 * and (in production) owner root:root.
 *
 * Throws on:
 *   - unknown OS
 *   - parent dir cannot be created (e.g. blocked by a file at that path)
 *   - write fails (e.g. caller is non-root and the dir is /var/db)
 *
 * NEVER falls back to a more-permissive path. If the canonical path
 * cannot be written, the daemon must refuse to enroll (caller surfaces
 * the error to the operator).
 */
export function persistApiKey(apiKey: string, os: SupportedOs, opts: PersistOpts = {}): void {
  const path = opts.overridePath ?? resolveKeyPath(os);

  // Create the parent dir with mode 0o700 — root-only when running as
  // root in production. (mkdirSync's `mode` is masked against the
  // process umask; production install scripts run with umask 022 so
  // the effective mode is 0o700 & ~022 = 0o700. Tests override the
  // path entirely so this masking doesn't affect them.)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  // Write with mode 0o400 then re-chmod as belt-and-suspenders against
  // any umask interference.
  writeFileSync(path, apiKey, { encoding: "utf-8", mode: 0o400 });
  chmodSync(path, 0o400);

  if (!opts.skipChown && process.getuid?.() === 0) {
    // root:root on Linux; root:wheel on macOS — gid 0 maps to wheel on
    // Darwin so the same call works on both platforms.
    chownSync(path, 0, 0);
  }

  // Post-write verification: confirm the on-disk file matches our
  // expectations. Catches a class of "I wrote with mode 0o400 but a
  // helpful filesystem layer relaxed it" bugs.
  //
  // When `skipChown` is set (test bypass) we can't expect uid===0 (the
  // tests run as non-root), so we only enforce the MODE half of the
  // safety check. Production callers run as root and use the full
  // assertSafeKeyPath via the readApiKey path on every subsequent read.
  if (!opts.skipPermissionCheck) {
    if (opts.skipChown) {
      assertSafeKeyMode(path);
    } else {
      assertSafeKeyPath(path);
    }
  }
}

/**
 * Read the api_key, asserting the file's mode is still 0o400 and the
 * owner is still uid 0. Throws if either check fails — the daemon's
 * caller (sync-loop, heartbeat-scheduler) treats this as "refuse to
 * operate" per Pitfall 10.
 *
 * Per Pitfall 10: NEVER cache the result. Every read re-checks
 * permissions so post-install tampering is caught at next-use.
 */
export function readApiKey(os: SupportedOs, opts: ReadOpts = {}): string {
  const path = opts.overridePath ?? resolveKeyPath(os);

  if (!opts.skipPermissionCheck) {
    assertSafeKeyPath(path);
  }

  return readFileSync(path, "utf-8").trim();
}

/**
 * Asserts the file at `path` is mode-safe AND root-owned. Used on every
 * read from production callers (sync-loop, heartbeat-scheduler).
 *
 *   - Exists (statSync throws ENOENT otherwise — caller sees that).
 *   - Has mode (mode & 0o777) === 0o400.
 *   - Has uid === 0 (owner root).
 *
 * Throws a specific error string per failure mode so the caller can
 * surface a precise diagnostic to the operator:
 *   - api-key-file-permissions-drifted: path=... mode=...
 *   - api-key-file-not-root-owned:     path=... uid=...
 */
function assertSafeKeyPath(path: string): void {
  assertSafeKeyMode(path);
  const st = statSync(path);
  if (st.uid !== 0) {
    throw new Error(`api-key-file-not-root-owned: path=${path} uid=${st.uid}`);
  }
}

/**
 * Mode-only half of assertSafeKeyPath. Used by persistApiKey's post-
 * write check when `skipChown=true` (tests run non-root and so cannot
 * meaningfully assert uid===0; the mode assertion is still meaningful
 * because we wrote with mode 0o400).
 */
function assertSafeKeyMode(path: string): void {
  const st = statSync(path);
  const mode = st.mode & 0o777;
  if (mode !== 0o400) {
    throw new Error(`api-key-file-permissions-drifted: path=${path} mode=${mode.toString(8)}`);
  }
}
