/**
 * `fennec init` — non-interactive MDM-driven install (Plan 01-09 Task 1,
 * DAE-02, PRIV-07 logged audit path per Pitfall 8).
 *
 * Org-tier install path. Triggered by the .pkg postinstall script when a
 * Configuration Profile is present at
 * /Library/Managed Preferences/dev.fennec.daemon.plist. The org admin
 * pushed the profile via MDM (Jamf / Intune / Workspace ONE); macOS
 * unpacks it into the Managed Preferences directory automatically.
 *
 * Flow:
 *
 *   1. uid==0 gate (postinstall runs as root via Apple pkg installer).
 *   2. Resolve install_secret: from --install-secret arg OR from
 *      --read-config <path> (parses the .mobileconfig) OR from the
 *      default Managed Preferences path via `defaults read`.
 *   3. Resolve machineId + hostname.
 *   4. renderLogged({...}) — write the placeholder consent record
 *      (org_name = "unknown — populated after enrollment") BEFORE any
 *      hook fires. Satisfies PRIV-07 / Pitfall 8.
 *   5. enrollDaemon → persistApiKey.
 *   6. renderLogged again with the now-known org_name.
 *   7. Write LaunchDaemon + Helper LaunchAgent plists.
 *   8. Write managed-settings hook entries.
 *   9. launchctl load both plists.
 *   10. Do NOT block on attach — the Helper LaunchAgent triggers the
 *       attach flow on first user-session login per D-14. Pre-attach
 *       events are tagged unknown@${hostname} per D-15.
 *   11. Exit 0.
 */

import { execFileSync } from "node:child_process";
import { hostname as osHostname } from "node:os";
import { persistApiKey } from "../enroll/api-key-store.js";
import { enrollDaemon } from "../enroll/enroll.js";
import { getMachineId } from "../enroll/machine-id.js";
import { writeFennecHooks } from "../managed-settings/install.js";
import { loadAgentForUser, writePlist as writeAgentPlist } from "../service/helper-agent.js";
import { loadDaemon, writePlist as writeDaemonPlist } from "../service/launchdaemon.js";
import { renderLogged } from "./consent.js";

export interface RunInitInput {
  apiBaseUrl: string;
  os: "darwin" | "linux" | "win32";
  /** Direct install_secret from --install-secret arg. */
  installSecret?: string;
  /** Path to a .mobileconfig or Managed Preferences plist to read from. */
  configPath?: string;
  /** Hook command path — typically /usr/local/fennec/bin/fennec-hook (Plan 01-07). */
  hookCommand?: string;
  daemonPlistPath?: string;
  agentPlistPath?: string;
  managedSettingsPath?: string;
  /** Override the consent log path (tests). */
  consentLogPath?: string;
}

const DEFAULT_DAEMON_PLIST_PATH = "/Library/LaunchDaemons/dev.fennec.daemon.plist";
const DEFAULT_AGENT_PLIST_PATH = "/Library/LaunchAgents/dev.fennec.notifier.plist";
const DEFAULT_HOOK_COMMAND = "/usr/local/fennec/bin/fennec-hook";
const DEFAULT_MANAGED_PROFILE_PATH = "/Library/Managed Preferences/dev.fennec.daemon.plist";

/**
 * Read the org_install_secret value from a macOS Managed Preferences /
 * Configuration Profile .plist. Uses `defaults read` via argv-array
 * execFileSync — no shell, no injection surface.
 *
 * Throws if the file or the key is missing — the caller (init) treats
 * that as a fatal install-time error (the MDM payload was malformed).
 */
function readInstallSecretFromConfig(path: string): string {
  try {
    const output = execFileSync("defaults", ["read", path, "org_install_secret"], {
      encoding: "utf-8",
    });
    return output.trim();
  } catch (err) {
    throw new Error(`mdm_config_read_failed: path=${path} reason=${(err as Error).message}`);
  }
}

export async function runInit(input: RunInitInput): Promise<void> {
  // 1. uid==0
  if (process.getuid?.() !== 0) {
    console.error("fennec init must be run as root (postinstall context).");
    process.exit(1);
  }

  if (input.os !== "darwin") {
    console.error(`fennec init is macOS-only in Phase 1 (detected: ${input.os}).`);
    process.exit(1);
  }

  // 2. Resolve install_secret
  let installSecret: string;
  if (input.installSecret) {
    installSecret = input.installSecret;
  } else {
    const configPath = input.configPath ?? DEFAULT_MANAGED_PROFILE_PATH;
    installSecret = readInstallSecretFromConfig(configPath);
  }
  if (installSecret.length < 32) {
    console.error(`install_secret too short (${installSecret.length} chars; min 32).`);
    process.exit(1);
  }

  // 3. Resolve machine identity
  const machineId = getMachineId(input.os);
  const hostname = osHostname();

  // 4. Write placeholder consent record BEFORE enrollment (PRIV-07 / Pitfall 8)
  renderLogged({
    machineId,
    hostname,
    apiBaseUrl: input.apiBaseUrl,
    logPath: input.consentLogPath,
  });

  // 5. Enroll + persist
  const enroll = await enrollDaemon({
    installSecret,
    machineId,
    hostname,
    os: input.os,
    apiBaseUrl: input.apiBaseUrl,
  });
  persistApiKey(enroll.api_key, input.os);

  // 6. Re-render consent record with the resolved org_name
  renderLogged({
    machineId,
    hostname,
    orgName: enroll.org_name,
    apiBaseUrl: input.apiBaseUrl,
    logPath: input.consentLogPath,
  });

  // 7. Plists
  const daemonPlistPath = input.daemonPlistPath ?? DEFAULT_DAEMON_PLIST_PATH;
  const agentPlistPath = input.agentPlistPath ?? DEFAULT_AGENT_PLIST_PATH;
  writeDaemonPlist(daemonPlistPath, {
    FENNEC_API_URL: input.apiBaseUrl,
    FENNEC_DAEMON_PORT: "7821",
    PATH: "/usr/local/fennec/bin:/usr/bin:/bin",
  });
  writeAgentPlist(agentPlistPath, { FENNEC_NOTIFIER_PORT: "7822" });

  // 8. Managed-settings
  const hookCommand = input.hookCommand ?? DEFAULT_HOOK_COMMAND;
  if (input.managedSettingsPath) {
    writeFennecHooks(input.managedSettingsPath, hookCommand);
  }

  // 9. launchctl load
  loadDaemon(daemonPlistPath);
  const sudoUidStr = process.env.SUDO_UID;
  if (sudoUidStr) {
    loadAgentForUser(agentPlistPath, Number(sudoUidStr));
  }

  // 10. Do NOT block on attach — Helper LaunchAgent triggers the
  // notification + browser-open on first user-session login (D-14).
  console.log(`fennec init: org=${enroll.org_name} machine=${hostname}`);
  console.log("Daemon registered. Tray notification will prompt for SSO attach on next user login.");
}
