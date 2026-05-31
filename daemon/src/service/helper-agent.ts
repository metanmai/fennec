/**
 * Helper LaunchAgent plist writer (Plan 01-09 Task 1, DAE-20).
 *
 * Writes /Library/LaunchAgents/dev.fennec.notifier.plist — the
 * per-user-session helper agent that drives macOS tray notifications.
 *
 * Pattern 6 (LaunchDaemon + Helper LaunchAgent split): the root daemon
 * cannot interact with the GUI (Pitfall 3 in 01-RESEARCH.md); it talks
 * to this Agent via loopback HTTP (127.0.0.1:7822) and the Agent
 * displays notifications / opens browser URLs on the user's behalf.
 *
 * The Agent binary itself is the Go notifier built in Plan 01-08 Task 3
 * (at notifier/build/fennec-notifier-darwin-arm64). The installer
 * (Plan 01-09 build-pkg.sh) places that binary at
 * /usr/local/fennec/bin/fennec-notifier root:wheel mode 0755 and this
 * plist at /Library/LaunchAgents/dev.fennec.notifier.plist root:wheel
 * mode 0644.
 *
 * Note: Plan 01-08 also ships installer/macos/notifier-launchagent.plist
 * (Label "com.fennec.notifier") as a standalone reference. This module
 * is the dev.fennec.* variant used by the full Plan 01-09 install
 * pipeline. The two are deliberately distinct so the older artefact
 * stays available for reference; Plan 01-09's installer uses the new
 * dev.fennec.notifier identifier consistently across daemon + agent.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, writeFileSync } from "node:fs";

export interface WritePlistOptions {
  /** Skip chown(root:wheel) — non-root tests must pass true. */
  skipChown?: boolean;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildEnvDict(env: Record<string, string>): string {
  const sortedKeys = Object.keys(env).sort();
  if (sortedKeys.length === 0) return "";
  const entries = sortedKeys
    .map((k) => `        <key>${xmlEscape(k)}</key>\n        <string>${xmlEscape(env[k] ?? "")}</string>`)
    .join("\n");
  return `    <key>EnvironmentVariables</key>
    <dict>
${entries}
    </dict>
`;
}

function buildPlistXml(env: Record<string, string>): string {
  const envBlock = buildEnvDict(env);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  fennec Helper LaunchAgent (Plan 01-09 Task 2, DAE-20, Pattern 6).

  Loaded per-user-session (NOT as root). LaunchDaemons cannot drive
  the GUI; this Agent bridges the gap. The root daemon POSTs to
  http://127.0.0.1:7822/v1/notify; this Agent's Go binary (built in
  Plan 01-08) renders the system notification + optionally opens a
  URL in the user's default browser.

  Lifecycle:
    - RunAtLoad: launchd starts the Agent at user login / fast user
      switch
    - KeepAlive: launchd respawns if it dies
    - Lives under /Library/LaunchAgents so it loads for every user
      that signs in on this machine

  See also installer/macos/notifier-launchagent.plist from Plan 01-08
  (com.fennec.notifier Label) — that file is kept as a reference; the
  Plan 01-09 install pipeline uses this dev.fennec.notifier variant
  to align with the LaunchDaemon's dev.fennec.daemon identifier.
-->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.fennec.notifier</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/fennec/bin/fennec-notifier</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ProcessType</key>
    <string>Background</string>

${envBlock}    <key>StandardOutPath</key>
    <string>/var/log/fennec/notifier.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/fennec/notifier.log</string>
</dict>
</plist>
`;
}

/**
 * Write the Helper LaunchAgent plist to `path`. Mode 0o644; chown
 * root:wheel in production (skipChown=true in tests).
 */
export function writePlist(path: string, env: Record<string, string>, opts: WritePlistOptions = {}): void {
  const xml = buildPlistXml(env);
  writeFileSync(path, xml, { mode: 0o644 });
  chmodSync(path, 0o644);
  if (!opts.skipChown && process.getuid?.() === 0) {
    chownSync(path, 0, 0); // root:wheel
  }
}

/**
 * Load the Helper LaunchAgent into the current user session.
 *
 * Two modes:
 *   - loadAgent(path): default — `launchctl load -w <path>`. Used
 *     when the calling process is already in the user's session.
 *   - loadAgentForUser(path, uid): used when the calling process is
 *     root (e.g. postinstall script) and needs to load the Agent
 *     into a specific user's GUI session. `launchctl asuser <uid>
 *     launchctl load <path>` is the canonical pattern.
 */
export function loadAgent(path: string): void {
  execFileSync("launchctl", ["load", "-w", path], { stdio: "inherit" });
}

export function loadAgentForUser(path: string, uid: number): void {
  execFileSync("launchctl", ["asuser", String(uid), "launchctl", "load", "-w", path], { stdio: "inherit" });
}

export function unloadAgent(path: string): void {
  execFileSync("launchctl", ["unload", path], { stdio: "inherit" });
}
