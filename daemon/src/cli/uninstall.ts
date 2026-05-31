/**
 * `fennec uninstall` — surgical uninstall (Plan 01-09 Task 1, DAE-19).
 *
 * Two gate modes:
 *   - --org-token <t>: org-tier path (Phase 1: accepts the install_secret
 *     as the org-token; Phase 3 adds a separate org_admin_token table).
 *   - no flags: personal-tier path (sudo is the gate).
 *
 * Both gates require uid==0 — the daemon files live under /Library,
 * /usr/local, /etc, /var/db; only root can remove them.
 *
 * Order matters: emit the uninstall audit BEFORE any filesystem
 * teardown so the backend learns about it even if a subsequent step
 * fails. The daemon will be removed regardless.
 *
 *   1. uid==0
 *   2. Org-token validation (if --org-token mode) — Phase 1 compares
 *      against the persisted install_secret-hash equivalent on disk.
 *      Mismatch → exit 1.
 *   3. readApiKey + getMachineId + hostname
 *   4. emitUninstallAudit (Plan 01-08) — Bearer-auth POST. Failures
 *      are logged but DO NOT block teardown.
 *   5. launchctl unload Helper LaunchAgent (asuser if SUDO_UID set)
 *   6. launchctl unload LaunchDaemon
 *   7. removeFennecHooks (Plan 01-07 surgical filter — leaves synapse
 *      entries intact, unlinks file when empty)
 *   8. unlink binaries: /usr/local/fennec/bin/* + lib dir
 *   9. unlink /var/db/fennec/key, /etc/fennec/shim-secret
 *   10. unlink plists
 *   11. Print "fennec uninstalled. Synapse and other hooks preserved."
 *   12. Exit 0
 *
 * Per D-24: NEVER touches ~/.claude/settings.json — synapse keeps
 * working.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { emitUninstallAudit } from "../attach/uninstall-emitter.js";
import { KEY_PATHS, readApiKey } from "../enroll/api-key-store.js";
import { getMachineId } from "../enroll/machine-id.js";
import { removeFennecHooks } from "../managed-settings/uninstall.js";
import { unloadAgent } from "../service/helper-agent.js";
import { unloadDaemon } from "../service/launchdaemon.js";

export interface RunUninstallInput {
  apiBaseUrl: string;
  os: "darwin" | "linux" | "win32";
  /** Org-tier mode token. Personal-tier omits this and relies on sudo. */
  orgToken?: string;
  hookCommand?: string;
  daemonPlistPath?: string;
  agentPlistPath?: string;
  managedSettingsPath?: string;
  /** Test-only: override api-key path for read. */
  apiKeyOverridePath?: string;
}

const DEFAULT_DAEMON_PLIST_PATH = "/Library/LaunchDaemons/dev.fennec.daemon.plist";
const DEFAULT_AGENT_PLIST_PATH = "/Library/LaunchAgents/dev.fennec.notifier.plist";
const DEFAULT_HOOK_COMMAND = "/usr/local/fennec/bin/fennec-hook";
const DEFAULT_BIN_DIR = "/usr/local/fennec/bin";
const DEFAULT_LIB_DIR = "/usr/local/fennec/lib";
const DEFAULT_SHIM_SECRET_PATH = "/etc/fennec/shim-secret";
const DEFAULT_INSTALL_SECRET_RECORD = "/var/db/fennec/install-secret";

/**
 * Best-effort unlink — logs the failure but does not abort.
 * Used for teardown steps where a missing file is not an error
 * (might have been partially removed by a prior failed uninstall).
 */
function tryUnlink(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch (err) {
    console.warn(`uninstall: could not unlink ${path}: ${(err as Error).message}`);
  }
}

function tryRm(path: string): void {
  try {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`uninstall: could not rm ${path}: ${(err as Error).message}`);
  }
}

function tryLaunchctlUnload(unloader: (path: string) => void, path: string): void {
  if (!existsSync(path)) return;
  try {
    unloader(path);
  } catch (err) {
    console.warn(`uninstall: launchctl unload failed for ${path}: ${(err as Error).message}`);
  }
}

function tryAsuserUnload(path: string, uid: number): void {
  if (!existsSync(path)) return;
  try {
    execFileSync("launchctl", ["asuser", String(uid), "launchctl", "unload", path], { stdio: "inherit" });
  } catch (err) {
    console.warn(`uninstall: launchctl asuser unload failed for ${path}: ${(err as Error).message}`);
  }
}

export async function runUninstall(input: RunUninstallInput): Promise<void> {
  // 1. uid==0
  if (process.getuid?.() !== 0) {
    console.error("fennec uninstall must be run with sudo (or via MDM revoke).");
    process.exit(1);
  }

  if (input.os !== "darwin") {
    console.error(`fennec uninstall is macOS-only in Phase 1 (detected: ${input.os}).`);
    process.exit(1);
  }

  // 2. Org-token validation (Phase 1: trivial — the install-secret
  //    record on disk is the comparator. Phase 3 adds a separate
  //    org_admin_token table the backend validates.)
  if (input.orgToken !== undefined) {
    if (!existsSync(DEFAULT_INSTALL_SECRET_RECORD)) {
      console.warn(
        `uninstall: no install-secret record at ${DEFAULT_INSTALL_SECRET_RECORD}; ` +
          "skipping org-token check (sudo is sufficient).",
      );
    } else {
      const persistedSecret = readFileSync(DEFAULT_INSTALL_SECRET_RECORD, "utf-8").trim();
      if (persistedSecret !== input.orgToken) {
        console.error("org-token mismatch. Uninstall denied.");
        process.exit(1);
      }
    }
  }

  // 3. Read api_key + machine identity (best-effort — if the key file
  //    is missing the daemon was never fully installed; skip the audit
  //    and proceed with teardown.)
  let apiKey: string | null = null;
  try {
    apiKey = readApiKey(input.os, { overridePath: input.apiKeyOverridePath });
  } catch (err) {
    console.warn(`uninstall: could not read api_key: ${(err as Error).message} — skipping audit.`);
  }
  const machineId = (() => {
    try {
      return getMachineId(input.os);
    } catch {
      return "unknown";
    }
  })();
  const hostname = osHostname();

  // 4. Emit uninstall audit BEFORE teardown
  if (apiKey) {
    try {
      await emitUninstallAudit({
        apiBaseUrl: input.apiBaseUrl,
        apiKey,
        reason: input.orgToken !== undefined ? "admin_initiated" : "user_initiated",
        machineId,
        hostname,
      });
    } catch (err) {
      console.warn(`uninstall: audit emit failed: ${(err as Error).message} — continuing with teardown.`);
    }
  }

  // 5. Unload Helper LaunchAgent
  const agentPlistPath = input.agentPlistPath ?? DEFAULT_AGENT_PLIST_PATH;
  const sudoUidStr = process.env.SUDO_UID;
  if (sudoUidStr) {
    tryAsuserUnload(agentPlistPath, Number(sudoUidStr));
  } else {
    tryLaunchctlUnload(unloadAgent, agentPlistPath);
  }

  // 6. Unload LaunchDaemon
  const daemonPlistPath = input.daemonPlistPath ?? DEFAULT_DAEMON_PLIST_PATH;
  tryLaunchctlUnload(unloadDaemon, daemonPlistPath);

  // 7. Surgical managed-settings removal (preserves synapse + other tools)
  const hookCommand = input.hookCommand ?? DEFAULT_HOOK_COMMAND;
  if (input.managedSettingsPath && existsSync(input.managedSettingsPath)) {
    try {
      removeFennecHooks(input.managedSettingsPath, hookCommand);
    } catch (err) {
      console.warn(`uninstall: managed-settings cleanup failed: ${(err as Error).message}`);
    }
  }

  // 8. Binaries + lib
  tryRm(DEFAULT_BIN_DIR);
  tryRm(DEFAULT_LIB_DIR);

  // 9. api_key + shim-secret + install-secret record
  tryUnlink(input.apiKeyOverridePath ?? KEY_PATHS[input.os]);
  tryUnlink(DEFAULT_SHIM_SECRET_PATH);
  tryUnlink(DEFAULT_INSTALL_SECRET_RECORD);

  // 10. Plists
  tryUnlink(daemonPlistPath);
  tryUnlink(agentPlistPath);

  console.log("fennec uninstalled. Synapse and other Claude Code hooks (if any) preserved.");
}
