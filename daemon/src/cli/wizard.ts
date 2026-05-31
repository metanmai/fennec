/**
 * `fennec wizard` — interactive personal-tier install (Plan 01-09 Task 1,
 * DAE-01, PRIV-07 interactive path).
 *
 * Orchestrates the full personal-tier install flow:
 *
 *   1. uid==0 check (must run via `sudo fennec wizard`).
 *   2. Interactive consent prompt (renderInteractive). Decline → exit 1.
 *   3. Prompt for org install_secret OR auto-generate one for personal
 *      mode (Phase 1 reserves the personal-mode auto-generation flag
 *      for Phase 3 when the org-creation endpoint exists; for now we
 *      require a secret so we exercise the same enrollment path as
 *      MDM installs per D-10).
 *   4. Resolve machineId (IOPlatformUUID via ioreg) + hostname.
 *   5. enrollDaemon → persistApiKey (mode 0400 root:root).
 *   6. Write LaunchDaemon plist + Helper LaunchAgent plist.
 *   7. Write managed-settings hook entries (Plan 01-07 install).
 *   8. launchctl load both plists (Agent uses asuser for the current
 *      session's UID — we read SUDO_UID from env to find the
 *      pre-sudo invoking user).
 *   9. Trigger attach flow (runAttachFlow) — opens browser to SSO.
 *   10. Print success + next steps.
 *
 * All steps are sync-or-await; no fire-and-forget. If any step fails
 * we surface the error to the user verbatim — partial-install state is
 * recoverable via `sudo fennec uninstall` then re-run.
 */

import { hostname as osHostname } from "node:os";
import { confirm, intro, isCancel, outro, text } from "@clack/prompts";
import { runAttachFlow } from "../attach/attach.js";
import { persistApiKey } from "../enroll/api-key-store.js";
import { enrollDaemon } from "../enroll/enroll.js";
import { getMachineId } from "../enroll/machine-id.js";
import { writeFennecHooks } from "../managed-settings/install.js";
import { loadAgentForUser, writePlist as writeAgentPlist } from "../service/helper-agent.js";
import { loadDaemon, writePlist as writeDaemonPlist } from "../service/launchdaemon.js";
import { renderInteractive } from "./consent.js";

export interface RunWizardInput {
  apiBaseUrl: string;
  os: "darwin" | "linux" | "win32";
  /** Hook command path — typically /usr/local/fennec/bin/fennec-hook (Plan 01-07). */
  hookCommand?: string;
  /** Override the LaunchDaemon plist target path; default = system path. */
  daemonPlistPath?: string;
  /** Override the Helper LaunchAgent plist target path; default = system path. */
  agentPlistPath?: string;
  /** Override the managed-settings.json target path; default = OS-canonical. */
  managedSettingsPath?: string;
}

const DEFAULT_DAEMON_PLIST_PATH = "/Library/LaunchDaemons/dev.fennec.daemon.plist";
const DEFAULT_AGENT_PLIST_PATH = "/Library/LaunchAgents/dev.fennec.notifier.plist";
const DEFAULT_HOOK_COMMAND = "/usr/local/fennec/bin/fennec-hook";

export async function runWizard(input: RunWizardInput): Promise<void> {
  // 1. uid==0 gate
  if (process.getuid?.() !== 0) {
    console.error("fennec wizard must be run with sudo. Try: sudo fennec wizard");
    process.exit(1);
  }

  if (input.os !== "darwin") {
    console.error(`fennec wizard is macOS-only in Phase 1 (detected: ${input.os}). Linux + Windows ship in Phase 5.`);
    process.exit(1);
  }

  // 2. Interactive consent gate
  const consented = await renderInteractive({ apiBaseUrl: input.apiBaseUrl });
  if (!consented) {
    console.error("Consent declined. fennec not installed.");
    process.exit(1);
  }

  // 3. Prompt for install_secret
  intro("Org enrollment");
  const installSecretAnswer = await text({
    message: "Paste your org install_secret (from your IT admin), or press Enter to cancel:",
    placeholder: "32+ character secret",
    validate: (value) => {
      if (!value || value.length < 32) return "install_secret must be at least 32 characters.";
      return undefined;
    },
  });
  if (isCancel(installSecretAnswer) || typeof installSecretAnswer !== "string") {
    console.error("No install_secret provided. fennec not installed.");
    process.exit(1);
  }
  const installSecret = installSecretAnswer;

  // 4. Resolve machine identity
  const machineId = getMachineId(input.os);
  const hostname = osHostname();

  // 5. Enroll → persist api_key
  const enroll = await enrollDaemon({
    installSecret,
    machineId,
    hostname,
    os: input.os,
    apiBaseUrl: input.apiBaseUrl,
  });
  persistApiKey(enroll.api_key, input.os);

  // 6. Write LaunchDaemon plist + Helper LaunchAgent plist
  const daemonPlistPath = input.daemonPlistPath ?? DEFAULT_DAEMON_PLIST_PATH;
  const agentPlistPath = input.agentPlistPath ?? DEFAULT_AGENT_PLIST_PATH;
  writeDaemonPlist(daemonPlistPath, {
    FENNEC_API_URL: input.apiBaseUrl,
    FENNEC_DAEMON_PORT: "7821",
    PATH: "/usr/local/fennec/bin:/usr/bin:/bin",
  });
  writeAgentPlist(agentPlistPath, { FENNEC_NOTIFIER_PORT: "7822" });

  // 7. Managed-settings hook entries (additive merge — synapse coexistence)
  const hookCommand = input.hookCommand ?? DEFAULT_HOOK_COMMAND;
  if (input.managedSettingsPath) {
    writeFennecHooks(input.managedSettingsPath, hookCommand);
  }

  // 8. launchctl load both plists
  loadDaemon(daemonPlistPath);
  const sudoUidStr = process.env.SUDO_UID;
  if (sudoUidStr) {
    loadAgentForUser(agentPlistPath, Number(sudoUidStr));
  }

  // 9. Trigger attach flow — opens browser
  const goAttach = await confirm({
    message: "Sign in to attribute your AI usage to your developer identity now?",
    initialValue: true,
  });
  if (!isCancel(goAttach) && goAttach === true) {
    try {
      await runAttachFlow({
        apiBaseUrl: input.apiBaseUrl,
        machineId,
        provider: "google",
      });
    } catch (err) {
      console.warn(
        `Attach flow did not complete (${(err as Error).message}). You can re-run later via the tray notification.`,
      );
    }
  }

  outro(`fennec installed and running. Org: ${enroll.org_name}`);
}
