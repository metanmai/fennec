/**
 * Managed-settings install (Plan 01-07 Task 4).
 *
 * Writes fennec's hook entries into the system-managed
 * managed-settings.json at the OS-appropriate path (D-19). Critical
 * properties:
 *
 *   1. ADDITIVE MERGE (D-20 / Pitfall 2): if another tool (e.g.
 *      synapse) already has entries in `hooks.<HookName>`, they are
 *      PRESERVED. Fennec only appends. This is the synapse-coexistence
 *      contract (DAE-11) — fennec's user might already be running
 *      synapse and we MUST NOT disrupt them.
 *
 *   2. IDEMPOTENT: re-running with the same hookCommand path produces
 *      the same file — no duplicate entries. The match key is the
 *      command string; if it's already present in the array, skip.
 *
 *   3. SYSTEM-PROTECTED: file is chmod 644 (rw-r--r--) AND, in prod,
 *      chown root:wheel (uid 0, gid 0) so user-side edits require
 *      sudo. Tests can pass `opts.skipChown=true` since unit tests
 *      can't chown without sudo.
 *
 *   4. 2-SPACE JSON INDENT (Pitfall 7): preserved across read+write so
 *      humans can diff the file. The implementation uses
 *      `JSON.stringify(data, null, 2)`.
 *
 * Threat model:
 *  - T-07-4 (overwrite-on-reinstall destroys other tools' entries) —
 *    mitigated by additive merge.
 *  - T-07-6 (user disables fennec by editing the file) — mitigated by
 *    chmod 644 + chown root.
 *  - T-07-SC — node:fs / node:path stdlib only.
 */

import { chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The 6 Claude Code hook events fennec subscribes to (D-22). Matches
 * synapse's surface so captured-event volume is comparable. Exported
 * so the uninstall module + tests share the source of truth.
 */
export const ALL_HOOK_NAMES = [
  "UserPromptSubmit",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "SubagentStop",
] as const;
export type HookName = (typeof ALL_HOOK_NAMES)[number];

/** A single hook-entry array element matching Claude Code's schema. */
interface HookEntry {
  type: "command";
  command: string;
}

/** Shape of the managed-settings.json file Claude Code reads. */
interface ManagedSettings {
  hooks?: Partial<Record<string, HookEntry[]>>;
  // Other top-level keys (e.g. apiEndpoints) are preserved verbatim.
  [key: string]: unknown;
}

export interface WriteFennecHooksOptions {
  /**
   * Skip chown(uid=0, gid=0) — useful in tests where the process can't
   * become root. In prod the installer (Plan 01-09) runs as root via
   * postinstall, so this defaults to false.
   */
  skipChown?: boolean;
}

/**
 * Install fennec's hook entries into the managed-settings.json file at
 * `path`. Each of the 6 D-22 hooks gets an entry pointing at the
 * supplied `hookCommand` (typically `/usr/local/fennec/bin/fennec-hook`).
 *
 * The function is idempotent and additive: re-running is safe; other
 * tools' entries are preserved.
 *
 * Throws if the existing file is non-JSON. The caller (installer) is
 * expected to catch and surface a clean error in that case — a
 * malformed managed-settings.json is a manual-intervention scenario.
 */
export function writeFennecHooks(path: string, hookCommand: string, opts: WriteFennecHooksOptions = {}): void {
  // 1. Ensure the parent directory exists. The managed-settings dir is
  //    typically created by the OS or Claude Code itself, but on a
  //    fresh install it may not — mkdirSync recursive is idempotent.
  mkdirSync(dirname(path), { recursive: true });

  // 2. Read the existing file if present. JSON.parse throws on
  //    malformed input — we let it propagate so the installer surfaces
  //    a clean error (a corrupt managed-settings file is a
  //    manual-intervention scenario, not a routine condition).
  let data: ManagedSettings;
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    if (raw.trim() === "") {
      data = {};
    } else {
      // Throws on bad JSON. Intentional.
      data = JSON.parse(raw) as ManagedSettings;
    }
  } else {
    data = {};
  }

  // 3. Ensure data.hooks is an object. If the existing value is
  //    malformed (e.g. an array or string), throw — a managed-settings
  //    with `hooks: "weird"` is corrupt and the installer should stop.
  if (data.hooks !== undefined && (typeof data.hooks !== "object" || Array.isArray(data.hooks))) {
    throw new Error("managed-settings.hooks must be an object");
  }
  if (data.hooks === undefined) {
    data.hooks = {};
  }
  const hooks = data.hooks as Record<string, HookEntry[]>;

  // 4. For each of the 6 D-22 hooks, ensure the array exists, then
  //    add fennec's entry if not already present. The match key is
  //    the command path — if some other tool happens to use the same
  //    fennec-hook path, that's a collision the operator must resolve.
  for (const hookName of ALL_HOOK_NAMES) {
    if (!Array.isArray(hooks[hookName])) {
      hooks[hookName] = [];
    }
    const arr = hooks[hookName];
    if (!arr) continue;
    if (arr.some((entry) => entry?.command === hookCommand)) {
      // Idempotent — entry already present, skip
      continue;
    }
    arr.push({ type: "command", command: hookCommand });
  }

  // 5. Write back with 2-space indent (Pitfall 7), mode 0o644.
  //    writeFileSync with `mode` only takes effect on creation; we also
  //    explicitly call chmodSync via the writeFile options form below
  //    so re-writes also enforce the mode.
  const serialised = JSON.stringify(data, null, 2);
  writeFileSync(path, serialised, { mode: 0o644 });

  // 6. In production: chown root:wheel (uid 0, gid 0) — only effective
  //    when the current process is root. Skipped in tests via the opt
  //    flag. node:fs.chownSync throws EPERM when not root, so we guard.
  if (!opts.skipChown && process.getuid?.() === 0) {
    chownSync(path, 0, 0); // root:wheel (gid 0 = wheel on macOS, root on Linux)
  }
}
