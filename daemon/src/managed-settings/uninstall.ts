/**
 * Managed-settings uninstall (Plan 01-07 Task 4).
 *
 * Surgically removes ONLY fennec's hook entries from
 * managed-settings.json. Critical properties (D-24):
 *
 *   1. ONLY fennec entries removed. Other tools' entries (e.g.
 *      synapse running in user-layer settings, OR another tool
 *      writing into managed-settings) are preserved verbatim.
 *
 *   2. FILE UNLINKED when empty. If after removing fennec entries
 *      ALL hook arrays are empty AND no other top-level keys exist,
 *      the file is deleted. This is the cleanup contract: a fennec
 *      uninstall leaves no trace if there was nothing else to manage.
 *
 *   3. ~/.claude/settings.json is NEVER touched. The synapse
 *      coexistence (D-20 / DAE-11) is preserved by the simple fact
 *      that this function takes a `path` argument and only writes to
 *      that path — never to a user-settings location. The test
 *      `preserves ~/.claude/settings.json byte-equal` is the
 *      load-bearing assertion.
 *
 *   4. PRESERVE 2-SPACE INDENT (Pitfall 7) on rewrite.
 *
 * Threat model:
 *  - T-07-5 (uninstall blasts the whole file) — mitigated by surgical
 *    filter + structural preservation.
 *  - T-07-SC — node:fs stdlib only.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

interface HookEntry {
  type: string;
  command: string;
}

interface ManagedSettings {
  hooks?: Partial<Record<string, HookEntry[]>>;
  [key: string]: unknown;
}

/**
 * Remove fennec's hook entries (`command === hookCommand`) from each
 * hook array in the file at `path`. Hook arrays that become empty are
 * removed entirely. The file itself is unlinked if it becomes empty of
 * meaningful content.
 *
 * No-op when the file doesn't exist. Throws on malformed JSON (same
 * contract as the installer — malformed managed-settings is a
 * manual-intervention scenario).
 */
export function removeFennecHooks(path: string, hookCommand: string): void {
  // 1. No-op if the file doesn't exist
  if (!existsSync(path)) return;

  // 2. Read + parse
  const raw = readFileSync(path, "utf-8");
  if (raw.trim() === "") {
    // Empty file → unlink and done
    unlinkSync(path);
    return;
  }
  const data: ManagedSettings = JSON.parse(raw) as ManagedSettings;

  // 3. If there are no hooks at all, the file has nothing for fennec.
  //    Leave the file alone (other tools may use it).
  if (!data.hooks || typeof data.hooks !== "object" || Array.isArray(data.hooks)) {
    return;
  }
  const hooks = data.hooks as Record<string, HookEntry[]>;

  // 4. For each hook array, filter out fennec's entries. If the
  //    remaining array is empty, delete the key entirely so the
  //    file stays tidy.
  for (const hookName of Object.keys(hooks)) {
    const arr = hooks[hookName];
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((entry) => entry?.command !== hookCommand);
    if (filtered.length === 0) {
      delete hooks[hookName];
    } else {
      hooks[hookName] = filtered;
    }
  }

  // 5. If `hooks` is now an empty object AND no other top-level keys
  //    exist, unlink the file. Otherwise rewrite.
  const otherKeys = Object.keys(data).filter((k) => k !== "hooks");
  const hooksEmpty = Object.keys(hooks).length === 0;
  if (hooksEmpty && otherKeys.length === 0) {
    unlinkSync(path);
    return;
  }

  // If hooks is empty but other keys exist, remove the hooks key
  // entirely (don't leave a dangling `"hooks": {}`).
  if (hooksEmpty) {
    delete data.hooks;
  }

  // 6. Rewrite with 2-space indent (Pitfall 7); preserve key order
  //    by relying on JSON.stringify's iteration of the existing
  //    object's own property order (V8 / Node guarantee insertion
  //    order for string keys).
  const serialised = JSON.stringify(data, null, 2);
  writeFileSync(path, serialised, { mode: 0o644 });
}
