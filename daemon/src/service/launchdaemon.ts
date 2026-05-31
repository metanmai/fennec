/**
 * LaunchDaemon plist writer (Plan 01-09 Task 1, DAE-05).
 *
 * Writes /Library/LaunchDaemons/dev.fennec.daemon.plist with the
 * canonical fennec configuration:
 *
 *   - Label dev.fennec.daemon
 *   - ProgramArguments [/usr/local/fennec/bin/fennec, daemon]
 *     (the wrapper script exec's `node /usr/local/fennec/lib/cli.js daemon`
 *      via the system Node 22 on PATH — per W-5 plan-checker resolution
 *      path (a). Postinstall warns about the Node 22+ prerequisite.)
 *   - UserName root, GroupName wheel
 *   - RunAtLoad + KeepAlive both true (CrowdStrike-style always-on per D-01)
 *   - EnvironmentVariables injected from `env` arg (FENNEC_API_URL,
 *     FENNEC_DAEMON_PORT, PATH, plus any caller-supplied extras)
 *   - StandardOut/Err -> /var/log/fennec/daemon.log
 *
 * File ACL: mode 0o644, owner root:wheel (gid 0 maps to wheel on Darwin).
 * `skipChown:true` for non-root tests.
 *
 * Threat model:
 *   - T-09-02: postinstall script + plist content are signed transitively
 *     via the .pkg signature. Any tampering invalidates Apple notarisation.
 *   - launchctl invocations use argv arrays (execFileSync) — no shell
 *     concatenation, no injection surface.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, writeFileSync } from "node:fs";

export interface WritePlistOptions {
  /** Skip chown(root:wheel) — non-root tests must pass true. */
  skipChown?: boolean;
}

/**
 * Escape a string for safe embedding inside a <string>...</string>
 * XML element. The 5 XML predefined entities are the only chars that
 * need escaping in plist text content.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the EnvironmentVariables <dict>...</dict> block from the env
 * map. Always sorts keys alphabetically for deterministic diffs.
 */
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

/**
 * Generate the LaunchDaemon plist XML. The template mirrors
 * 01-RESEARCH.md §LaunchDaemon plist with the W-5 wrapper-script
 * resolution: ProgramArguments points at /usr/local/fennec/bin/fennec
 * (a shell wrapper that exec's node + cli.js), NOT directly at node +
 * a script.
 */
function buildPlistXml(env: Record<string, string>): string {
  const envBlock = buildEnvDict(env);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  fennec LaunchDaemon (Plan 01-09 Task 2, DAE-05, D-19).

  System-level always-on daemon (CrowdStrike-style per D-01). Runs as
  root so it can read system-protected paths (/var/db/fennec/key mode
  0400) and write managed-settings (/Library/Application Support/
  ClaudeCode/managed-settings.json mode 0644 root:wheel).

  ProgramArguments points at the /usr/local/fennec/bin/fennec wrapper
  script which exec's the system Node 22+ on PATH. The wrapper exists
  so the plist does not need to know the absolute path to node — corp
  installs that vendor a different node binary can swap the wrapper
  without touching this plist (W-5 resolution path a).
-->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.fennec.daemon</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/fennec/bin/fennec</string>
        <string>daemon</string>
    </array>

    <key>UserName</key>
    <string>root</string>

    <key>GroupName</key>
    <string>wheel</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ProcessType</key>
    <string>Background</string>

${envBlock}    <key>StandardOutPath</key>
    <string>/var/log/fennec/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/fennec/daemon.log</string>
</dict>
</plist>
`;
}

/**
 * Write the LaunchDaemon plist to `path` with the supplied env vars.
 * Mode 0o644; chown root:wheel in production (skipChown=true in tests).
 */
export function writePlist(path: string, env: Record<string, string>, opts: WritePlistOptions = {}): void {
  const xml = buildPlistXml(env);
  writeFileSync(path, xml, { mode: 0o644 });
  chmodSync(path, 0o644);
  if (!opts.skipChown && process.getuid?.() === 0) {
    chownSync(path, 0, 0); // root:wheel (gid 0 = wheel on Darwin)
  }
}

/**
 * Load the LaunchDaemon via launchctl. Uses argv-array execFileSync —
 * no shell, no injection surface.
 *
 * `launchctl load -w` writes the load record to /var/db/launchd.db
 * so the daemon comes back on reboot.
 */
export function loadDaemon(path: string): void {
  execFileSync("launchctl", ["load", "-w", path], { stdio: "inherit" });
}

/**
 * Unload the LaunchDaemon via launchctl. Argv-array exec.
 */
export function unloadDaemon(path: string): void {
  execFileSync("launchctl", ["unload", path], { stdio: "inherit" });
}
