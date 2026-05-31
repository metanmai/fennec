/**
 * Stable per-machine identifier (D-13, Plan 01-08 Task 1).
 *
 * The daemon's `machine_id` is the keyspace anchor for the per-machine
 * api_key model — two machines belonging to the same human user have
 * two distinct api_keys, both keyed on their own machine_id. Cross-
 * machine identity merge happens server-side at user_id resolution
 * time (per attach-callback in Plan 01-05), not at the daemon.
 *
 * Per-OS source of stability:
 *   - darwin: IOPlatformUUID via `ioreg -rd1 -c IOPlatformExpertDevice`
 *     Stable across reboots and OS upgrades; only changes on a
 *     motherboard replacement (Apple silicon: a logic-board swap).
 *     This is the same identifier Apple's notarisation toolchain uses.
 *   - linux: /etc/machine-id or /var/lib/dbus/machine-id (Phase 5)
 *   - win32: HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid (Phase 5)
 *
 * Phase 1 only needs darwin; linux + win32 throw an explicit
 * "machine_id_unsupported_on_phase1_os" error rather than returning a
 * silent placeholder (which would silently break enrollment with a
 * confusing 400 from the backend).
 *
 * Security: the `ioreg` invocation uses execFileSync with an argv
 * ARRAY (NOT a shell string) so there is no shell expansion and no
 * code-injection surface. The output is grepped via a regex that
 * extracts only the UUID value.
 */

import { execFileSync } from "node:child_process";

let cached: string | null = null;

/**
 * Returns the stable per-machine UUID. Memoised within the process —
 * the first call shells out to `ioreg` (~5-20ms on macOS) and every
 * subsequent call returns the cached value (zero cost).
 *
 * Throws:
 *   - on unsupported OS (linux/win32 in Phase 1)
 *   - if the IOPlatformUUID line is missing from ioreg output
 */
export function getMachineId(os: "darwin" | "linux" | "win32"): string {
  if (cached !== null) return cached;

  if (os === "darwin") {
    // execFileSync with argv ARRAY — no shell, no concatenation, no
    // injection surface. The IOPlatformExpertDevice service exposes
    // IOPlatformUUID as a string property.
    const output = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
      encoding: "utf-8",
    });

    // Extract IOPlatformUUID — the line looks like:
    //   "IOPlatformUUID" = "12345678-1234-5678-1234-567812345678"
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (!match || !match[1]) {
      throw new Error("machine_id_resolution_failed: IOPlatformUUID not found in ioreg output");
    }
    cached = match[1];
    return cached;
  }

  if (os === "linux" || os === "win32") {
    throw new Error(`machine_id_unsupported_on_phase1_os: ${os}`);
  }

  throw new Error(`machine_id_unknown_os: ${String(os)}`);
}

/**
 * Test-only: drop the in-process cache so a fresh call re-reads
 * IOPlatformUUID. Underscore prefix signals "test-only" per project
 * convention — production code paths must NEVER call this.
 */
export function _resetMachineIdCacheForTests(): void {
  cached = null;
}
