/**
 * @fennec/daemon — entry-point + public API surface.
 *
 * Plan 01-06 ships the in-process pipeline (adapter registry, canonical
 * normalisation, JSONL queue, watermark, rotation, redactor, sync loop,
 * heartbeat emitter). Plans 01-07 / 01-08 added the Claude Code adapter
 * + daemon identity. Plan 01-09 (this file's CLI dispatcher) wires
 * `fennec wizard | init | uninstall | daemon` so the LaunchDaemon plist
 * can boot the daemon process and end-users can run the install
 * subcommands.
 *
 * Two surfaces in one file:
 *   - When imported by other workspaces (or tests), it's the public API
 *     barrel (`export type ...` and `export ...` below).
 *   - When invoked directly via the /usr/local/fennec/bin/fennec wrapper
 *     (which exec's `node /usr/local/fennec/lib/daemon/index.js <sub>`),
 *     the bottom-of-file dispatcher takes over.
 *
 * The dispatcher only runs when `import.meta.url` matches the entry
 * point — i.e. when this file is the process's main module, not when
 * imported as a library.
 */
import { fileURLToPath } from "node:url";

// Adapter contract
export type { Adapter, Emit, EmitInput } from "./adapters/adapter.js";
export type {
  AdapterCounter,
  AdapterRegistryOptions,
  CountersSnapshot,
  RedactFn,
} from "./adapters/registry.js";
export { AdapterRegistry } from "./adapters/registry.js";

// Consent renderer (PRIV-07)
export { renderInteractive, renderLogged } from "./cli/consent.js";
// CLI surfaces (Plan 01-09 Task 1)
export type { DaemonHandle, RunDaemonOptions } from "./cli/daemon.js";
export { runDaemon } from "./cli/daemon.js";
export { runInit } from "./cli/init.js";
export { runUninstall } from "./cli/uninstall.js";
export { runWizard } from "./cli/wizard.js";
export type { Env } from "./env.js";
// Env
export { loadEnv } from "./env.js";
export type { HeartbeatSchedulerOptions } from "./heartbeat/heartbeat.js";
export { DEFAULT_HEARTBEAT_INTERVAL_MS, HeartbeatScheduler } from "./heartbeat/heartbeat.js";
// Heartbeat
export { computeSchemaHash } from "./heartbeat/schema-hash.js";
// Managed-settings install / uninstall (Plan 01-07 Task 4)
export type { HookName, WriteFennecHooksOptions } from "./managed-settings/install.js";
export { ALL_HOOK_NAMES, writeFennecHooks } from "./managed-settings/install.js";
export { removeFennecHooks } from "./managed-settings/uninstall.js";
export type { BuildCanonicalEventInput } from "./normalize/canonical.js";
// Canonical normalisation
export {
  buildCanonicalEvent,
  bumpMonotonicSeq,
  deriveIdempotencyKey,
  readMonotonicSeq,
} from "./normalize/canonical.js";
// Queue
export { appendEvent, replayFromWatermark } from "./queue/jsonl.js";
export type { RotationResult } from "./queue/rotation.js";
export { listRotatedFiles, rotateIfNeeded, THRESHOLD_BYTES_DEFAULT } from "./queue/rotation.js";
export type { Watermark } from "./queue/watermark.js";
export { advanceWatermark, readWatermark } from "./queue/watermark.js";
export type { CanarySmokeResult } from "./redact/canary-test.js";
export { CANARIES, runCanarySmoke } from "./redact/canary-test.js";
// Redactor + PRIV-01 canaries
export type { CompiledRule } from "./redact/gitleaks-rules.js";
export {
  COMPILED_RULE_COUNT,
  GITLEAKS_TOML_SHA256,
  gitleaksRules,
  REDACTION_VERSION_HASH,
} from "./redact/gitleaks-rules.js";
export { redactEvent } from "./redact/redactor.js";
// Service plist writers (DAE-05, DAE-20)
export {
  loadAgent,
  loadAgentForUser,
  unloadAgent,
  writePlist as writeHelperAgentPlist,
} from "./service/helper-agent.js";
export { loadDaemon, unloadDaemon, writePlist as writeLaunchDaemonPlist } from "./service/launchdaemon.js";
export type { BackoffParams } from "./sync/backoff.js";
export { DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS, exponentialBackoff, resetBackoff } from "./sync/backoff.js";
// Sync loop
export type { Batch } from "./sync/batch.js";
export { readNextBatch } from "./sync/batch.js";
export type { SyncLoopOptions } from "./sync/loop.js";
export { DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS, SyncLoop } from "./sync/loop.js";
export { buildFetchOptions, detectExtraCaCerts, detectHttpsProxy } from "./sync/proxy.js";

// ─────────────────────────────────────────────────────────────────────
// CLI dispatcher (Plan 01-09 Task 1)
//
// Only runs when this file is the process's main module — i.e. when
// the /usr/local/fennec/bin/fennec wrapper script invokes
// `node /usr/local/fennec/lib/daemon/index.js <sub> [args]`.
// When the file is imported as a library (e.g. by vitest, by another
// workspace, by integration tests) the dispatcher is a no-op.
// ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: fennec <command> [options]",
      "",
      "Commands:",
      "  wizard                                Interactive personal-tier install (sudo required)",
      "  init [--install-secret <s>]           Non-interactive MDM-driven install (sudo required)",
      "  init --read-config <path>             Read install_secret from a Configuration Profile",
      "  uninstall [--org-token <t>]           Remove fennec (org-token for org-tier, sudo for personal)",
      "  daemon                                Run the long-lived daemon process (LaunchDaemon-invoked)",
      "",
      "Environment:",
      "  FENNEC_API_URL                        Backend base URL (default https://api.fennec.dev)",
      "",
    ].join("\n"),
  );
}

/**
 * Parse a `--flag value` pair from a flat argv array. Returns undefined
 * if the flag is absent. Throws if the flag is present but missing a
 * value (next argv slot is another --flag or end-of-args).
 */
function getFlag(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return value;
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const apiBaseUrl = process.env.FENNEC_API_URL ?? "https://api.fennec.dev";
  const os = process.platform as "darwin" | "linux" | "win32";

  switch (sub) {
    case "wizard": {
      const { runWizard: runWizardFn } = await import("./cli/wizard.js");
      await runWizardFn({ apiBaseUrl, os });
      return 0;
    }
    case "init": {
      const installSecret = getFlag(rest, "--install-secret");
      const configPath = getFlag(rest, "--read-config");
      const { runInit: runInitFn } = await import("./cli/init.js");
      await runInitFn({ apiBaseUrl, os, installSecret, configPath });
      return 0;
    }
    case "uninstall": {
      const orgToken = getFlag(rest, "--org-token");
      const { runUninstall: runUninstallFn } = await import("./cli/uninstall.js");
      await runUninstallFn({ apiBaseUrl, os, orgToken });
      return 0;
    }
    case "daemon": {
      // Boot the long-lived daemon: adapter-registry +
      // loopback-bridge + Claude Code adapter + sync loop +
      // heartbeat scheduler. Returns a handle whose `done` promise
      // resolves on SIGTERM/SIGINT (signal handlers installed inside
      // runDaemon). The LaunchDaemon plist invokes this with
      // KeepAlive=true, so process.exit on shutdown lets launchd
      // respawn cleanly only when the daemon actually exits.
      const { runDaemon: runDaemonFn } = await import("./cli/daemon.js");
      const handle = await runDaemonFn({ os });
      await handle.done;
      return 0;
    }
    case undefined:
    case "--help":
    case "-h":
    case "help": {
      printUsage();
      return 0;
    }
    default: {
      process.stderr.write(`fennec: unknown command '${sub}'\n\n`);
      printUsage();
      return 1;
    }
  }
}

// Run the dispatcher iff this file is the process's main module.
// `import.meta.url` is the file:// URL of THIS file; argv[1] is the
// invoked script. They match when this file is the entry point.
const isMain = (() => {
  try {
    const entryPath = process.argv[1];
    if (!entryPath) return false;
    return fileURLToPath(import.meta.url) === entryPath;
  } catch {
    return false;
  }
})();

if (isMain) {
  dispatch(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`fennec: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
