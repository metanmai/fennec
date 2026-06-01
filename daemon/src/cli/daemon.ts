/**
 * Daemon orchestration (Plan 01-06/07/08/09 integration).
 *
 * Boots the long-lived daemon process: wires the adapter registry,
 * loopback bridge, Claude Code adapter, sync loop, and heartbeat
 * scheduler in the right order; registers SIGTERM/SIGINT handlers that
 * shut everything down in reverse order; and only returns once the
 * shutdown promise resolves.
 *
 * Boot order (forward — produces a working pipeline):
 *   1. loadEnv() — resolves dataDir/queuePath/watermarkPath/seqDir
 *   2. getMachineId() — fails fast if the daemon isn't on a supported OS
 *   3. readShimSecret() — null = not yet enrolled; we still boot, the
 *      bridge just refuses every POST until `init`/`wizard` writes one
 *   4. AdapterRegistry — owns the canonical → redact → queue pipeline
 *   5. LoopbackBridge — `127.0.0.1:7821` (matches shim's defaultPort)
 *   6. ClaudeCodeAdapter — subscribes to bridge "hook" events
 *   7. registry.register(adapter) + registry.startAll()
 *   8. bridge.start(port)
 *   9. SyncLoop — flushes the JSONL queue → /api/events/batch
 *  10. HeartbeatScheduler — POSTs /api/heartbeats every minute
 *
 * Shutdown order (reverse — drains then closes):
 *   1. heartbeat.tick() one last time so the final counters reach the
 *      backend before we stop reporting
 *   2. heartbeat.stop()
 *   3. syncLoop.flushNow() one last time so any pending events go
 *      before we exit (best-effort; backend errors leave events in the
 *      JSONL queue for the next boot to pick up — Pattern 5)
 *   4. syncLoop.stop()
 *   5. bridge.stop() — stops accepting new hook posts
 *   6. registry.stopAll() — closes adapters (Claude Code adapter
 *      un-subscribes from the bridge it can no longer post to)
 */

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { ClaudeCodeAdapter } from "../adapters/claude-code/adapter.js";
import { readShimSecret } from "../adapters/loopback-bridge/secret-store.js";
import { LoopbackBridge } from "../adapters/loopback-bridge/server.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { readApiKey } from "../enroll/api-key-store.js";
import { getMachineId } from "../enroll/machine-id.js";
import { type Env, loadEnv } from "../env.js";
import { HeartbeatScheduler } from "../heartbeat/heartbeat.js";
import { redactEvent } from "../redact/redactor.js";
import { SyncLoop } from "../sync/loop.js";

/** Loopback port — matches `shim/main.go` const `defaultPort = "7821"`. */
const LOOPBACK_PORT = 7821;

/** Canonical shim-secret path in production. */
const DEFAULT_SHIM_SECRET_PATH = "/etc/fennec/shim-secret";

/**
 * Sentinel value the bridge will use as `shimSecret` when the secret
 * file doesn't exist yet (daemon booted but operator hasn't enrolled).
 * 64 random bytes so the in-memory value is unguessable by any caller
 * who can probe the bridge but cannot read root-only files — every
 * POST against it 401s, exactly what we want pre-enrollment.
 */
function generatePreEnrollSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface RunDaemonOptions {
  /** Override the canonical shim-secret path (tests). */
  shimSecretPath?: string;
  /** Override the env resolver (tests). */
  envOverride?: Env;
  /** Override the loopback port (tests, e.g. port=0 for ephemeral). */
  port?: number;
  /** OS override — defaults to process.platform. */
  os?: "darwin" | "linux" | "win32";
  /** Inject a shutdown promise (tests use this to resolve early). */
  shutdownSignal?: Promise<void>;
  /** Disable the SIGTERM/SIGINT process-level handlers (tests). */
  installSignalHandlers?: boolean;
  /** Override hostname (tests). */
  hostnameOverride?: string;
  /** Override machine-id resolver (tests). */
  machineIdOverride?: string;
  /** Bearer-safe logger; defaults to console.warn / console.info. */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
}

export interface DaemonHandle {
  /** Resolve when shutdown completes. */
  done: Promise<void>;
  /** Trigger graceful shutdown immediately (idempotent). */
  shutdown: () => Promise<void>;
  /** Loopback bridge's actually-bound address (post-listen). */
  bridgeAddress: () => { host: string; port: number } | null;
}

/**
 * Boot the daemon. Returns a handle whose `done` promise resolves once
 * shutdown finishes — the caller (the CLI dispatcher) awaits `done`.
 *
 * Test note: tests pass `installSignalHandlers: false` and a
 * `shutdownSignal` they control, then await `done`. Production passes
 * neither and lets SIGTERM/SIGINT trigger shutdown.
 */
export async function runDaemon(opts: RunDaemonOptions = {}): Promise<DaemonHandle> {
  const log = opts.log ?? {
    info: (msg) => process.stdout.write(`fennec daemon: ${msg}\n`),
    warn: (msg, err) => {
      const errStr = err instanceof Error ? `: ${err.message}` : err !== undefined ? `: ${String(err)}` : "";
      process.stderr.write(`fennec daemon: ${msg}${errStr}\n`);
    },
  };

  // 1. Env
  const env = opts.envOverride ?? loadEnv();
  log.info(`booting (data-dir=${env.dataDir}, api=${env.apiBaseUrl})`);

  // 2. Machine ID — fail fast on an unsupported OS so the LaunchDaemon
  // doesn't respawn-loop on Linux/Win32 in Phase 1.
  const os = opts.os ?? (process.platform as "darwin" | "linux" | "win32");
  let machineId: string;
  try {
    machineId = opts.machineIdOverride ?? getMachineId(os);
  } catch (err) {
    log.warn("machine_id resolution failed; cannot boot", err);
    throw err;
  }
  log.info(`machine_id=${machineId}`);

  // 3. Shim-secret — null if pre-enrollment; we still boot but the
  // bridge will reject every POST (every shim send will 401 until the
  // wizard runs).
  const shimSecretPath = opts.shimSecretPath ?? DEFAULT_SHIM_SECRET_PATH;
  let shimSecret = readShimSecret({ shimSecretPath });
  if (!shimSecret) {
    log.warn(
      `shim-secret missing at ${shimSecretPath}; loopback bridge will refuse hooks until 'fennec wizard' or 'fennec init' runs`,
      undefined,
    );
    shimSecret = generatePreEnrollSecret();
  }

  // 4. Adapter registry — uses the real redactor (PRIV-01 gitleaks rules).
  const registry = new AdapterRegistry({
    queuePath: env.queuePath,
    seqDir: env.seqDir,
    redact: redactEvent,
    logError: (msg, err) => log.warn(msg, err),
  });

  // 5. Loopback bridge
  const bridge = new LoopbackBridge({
    shimSecret,
    logger: (...args: unknown[]) => log.info(`[loopback] ${args.map((a) => stringifyArg(a)).join(" ")}`),
  });

  // 6. Claude Code adapter — subscribes to bridge "hook" events
  const adapter = new ClaudeCodeAdapter(bridge, {
    logger: (...args: unknown[]) => log.warn(`[claude-code] ${args.map((a) => stringifyArg(a)).join(" ")}`),
  });

  // 7. Register + start adapters BEFORE the bridge accepts traffic so
  // the very first POST has a listener attached.
  registry.register(adapter);
  await registry.startAll();

  // 8. Start the bridge
  const port = opts.port ?? LOOPBACK_PORT;
  await bridge.start(port);
  const bound = bridge.address();
  if (bound) {
    log.info(`loopback bridge listening on ${bound.host}:${bound.port}`);
  }

  // 9. Sync loop — every iteration re-reads the api_key (Pitfall 10:
  // never cache; re-check 0o400+uid=0 on every read).
  const apiKeyProvider = async (): Promise<string | null> => {
    try {
      return readApiKey(os);
    } catch (err) {
      // ENOENT → pre-enrollment; permission drift → operator must
      // intervene. Either way, return null and let the loop defer.
      log.warn("api_key unavailable; sync deferred", err);
      return null;
    }
  };

  const syncLoop = new SyncLoop({
    apiBaseUrl: env.apiBaseUrl,
    apiKeyProvider,
    queuePath: env.queuePath,
    watermarkPath: env.watermarkPath,
    registry,
    logError: (msg, err) => log.warn(msg, err),
  });
  syncLoop.start();

  // 10. Heartbeat scheduler
  const heartbeat = new HeartbeatScheduler({
    apiBaseUrl: env.apiBaseUrl,
    apiKeyProvider,
    registry,
    hostname: opts.hostnameOverride ?? hostname(),
    logError: (msg, err) => log.warn(msg, err),
  });
  heartbeat.start();

  log.info("ready");

  // ───────────────────────────────────────────────────────────────
  // Shutdown plumbing
  // ───────────────────────────────────────────────────────────────
  let shuttingDown = false;
  let shutdownResolve: () => void = () => {};
  const doneShutdown = new Promise<void>((resolve) => {
    shutdownResolve = resolve;
  });

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return doneShutdown;
    shuttingDown = true;
    log.info("shutdown: starting graceful drain");

    // Reverse order: stop reporting first, then drain queue, then
    // close bridge, then stop adapters.
    try {
      await heartbeat.tick();
    } catch (err) {
      log.warn("shutdown: final heartbeat tick failed", err);
    }
    heartbeat.stop();

    try {
      await syncLoop.flushNow();
    } catch (err) {
      log.warn("shutdown: final flush failed", err);
    }
    syncLoop.stop();

    try {
      await bridge.stop();
    } catch (err) {
      log.warn("shutdown: bridge.stop failed", err);
    }

    try {
      await registry.stopAll();
    } catch (err) {
      log.warn("shutdown: registry.stopAll failed", err);
    }

    log.info("shutdown: drained");
    shutdownResolve();
    return doneShutdown;
  };

  // Wire process-level signals unless the caller opted out (tests).
  const installSignals = opts.installSignalHandlers ?? true;
  if (installSignals) {
    const onSignal = (sig: NodeJS.Signals): void => {
      log.info(`received ${sig}; shutting down`);
      void shutdown();
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  }

  // Caller-injected shutdown trigger (tests).
  if (opts.shutdownSignal) {
    void opts.shutdownSignal.then(() => shutdown());
  }

  return {
    done: doneShutdown,
    shutdown,
    bridgeAddress: () => bridge.address(),
  };
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
