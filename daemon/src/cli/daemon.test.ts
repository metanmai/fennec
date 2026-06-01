/**
 * Daemon orchestration smoke test (Plan 01-06/07/08/09 integration).
 *
 * Asserts the wired pipeline starts cleanly, the loopback bridge binds,
 * a POSTed hook reaches the registry's queue end-to-end, and shutdown
 * drains without leaving dangling timers/listeners.
 *
 * This is the unit-level guard for the "daemon orchestration wiring"
 * gap the verifier flagged. The full e2e suite (`tests/e2e/`) covers
 * the real LaunchDaemon + signed pkg path with real infra.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { runDaemon } from "./daemon.js";

const TEST_SHIM_SECRET = "test-shim-secret-1234567890abcdefghij";

let tmpRoot: string;
let env: Env;
let shimSecretPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "fennec-daemon-test-"));
  const dataDir = join(tmpRoot, "data");
  env = {
    apiBaseUrl: "http://127.0.0.1:1/should-never-reach",
    dataDir,
    queuePath: join(dataDir, "events.jsonl"),
    watermarkPath: join(dataDir, "sync-state.json"),
    flushSignalPath: join(dataDir, "daemon-flush-now"),
    seqDir: join(dataDir, "seq"),
  };
  // Ensure dirs exist (loadEnv normally creates these — we're skipping
  // it via envOverride so we do it ourselves here).
  for (const dir of [dataDir, env.seqDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  shimSecretPath = join(tmpRoot, "shim-secret");
  writeFileSync(shimSecretPath, TEST_SHIM_SECRET, { encoding: "utf-8" });
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("runDaemon orchestration", () => {
  it("boots, binds the loopback bridge on an ephemeral port, and shuts down cleanly", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const handle = await runDaemon({
      envOverride: env,
      shimSecretPath,
      port: 0, // kernel-assigned ephemeral port
      installSignalHandlers: false,
      hostnameOverride: "test-host",
      machineIdOverride: "00000000-0000-0000-0000-000000000000",
      log,
    });

    try {
      const addr = handle.bridgeAddress();
      expect(addr).not.toBeNull();
      expect(addr?.host).toBe("127.0.0.1");
      expect(addr?.port).toBeGreaterThan(0);
    } finally {
      await handle.shutdown();
      await handle.done;
    }

    // After shutdown, the bridge should no longer have an address.
    expect(handle.bridgeAddress()).toBeNull();

    // Log surfaces: "booting" and "ready" must have fired; "drained"
    // proves graceful shutdown completed.
    const infoMsgs = log.info.mock.calls.map((c) => c[0] as string);
    expect(infoMsgs.some((m) => m.includes("booting"))).toBe(true);
    expect(infoMsgs.some((m) => m === "ready")).toBe(true);
    expect(infoMsgs.some((m) => m.includes("drained"))).toBe(true);
  });

  it("forwards a posted hook through the bridge → adapter → registry → JSONL queue end-to-end", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const handle = await runDaemon({
      envOverride: env,
      shimSecretPath,
      port: 0,
      installSignalHandlers: false,
      hostnameOverride: "test-host",
      machineIdOverride: "11111111-1111-1111-1111-111111111111",
      log,
    });

    try {
      const addr = handle.bridgeAddress();
      if (!addr) throw new Error("bridge has no address");

      // Real Claude Code UserPromptSubmit payload shape (matches the
      // payload normaliser's expected input from Plan 01-07).
      const hookPayload = {
        hook_event_name: "UserPromptSubmit",
        session_id: "smoke-test-session",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/Users/dev/test-repo",
        prompt: "Smoke test prompt for orchestration test",
      };

      const res = await fetch(`http://${addr.host}:${addr.port}/v1/hook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fennec-Shim-Secret": TEST_SHIM_SECRET,
        },
        body: JSON.stringify(hookPayload),
      });

      expect(res.status).toBe(202);

      // Allow the bridge → adapter → registry pipeline to flush.
      // The Claude Code adapter's forward() is async (fire-and-forget),
      // so we wait a few microtasks + a poll loop for the queue file.
      const queuePath = env.queuePath;
      let attempts = 0;
      while (!existsSync(queuePath) && attempts < 100) {
        await new Promise((r) => setTimeout(r, 10));
        attempts++;
      }

      expect(existsSync(queuePath)).toBe(true);
      const queueContents = readFileSync(queuePath, "utf-8");
      expect(queueContents.length).toBeGreaterThan(0);

      // Parse the first line — must be a redacted CanonicalEvent with
      // tool=claude-code, session_id matching, and the redaction stamp
      // set (Pattern: registry runs canonical → redact → queue.append).
      const firstLine = queueContents.split("\n").filter(Boolean)[0];
      if (!firstLine) throw new Error("queue is empty");
      const event = JSON.parse(firstLine) as Record<string, unknown>;
      expect(event.tool).toBe("claude-code");
      expect(event.kind).toBe("prompt_submitted");
      // hostname comes from os.hostname() at canonical-event-build
      // time — not the heartbeat hostname override. Just assert it's
      // a non-empty string.
      expect(typeof event.hostname).toBe("string");
      expect((event.hostname as string).length).toBeGreaterThan(0);
      expect(event.redaction_applied_at).toBeDefined();
      expect(event.redaction_version_hash).toBeDefined();
      expect(event.idempotency_key).toBeDefined();
      // session_id lives on the payload, not the envelope.
      const payload = event.payload as Record<string, unknown>;
      expect(payload.session_id).toBe("smoke-test-session");
      expect(payload.cwd).toBe("/Users/dev/test-repo");
    } finally {
      await handle.shutdown();
      await handle.done;
    }
  });

  it("boots even when the shim-secret file is missing (pre-enrollment), refusing every hook", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const missingPath = join(tmpRoot, "no-such-file");
    const handle = await runDaemon({
      envOverride: env,
      shimSecretPath: missingPath,
      port: 0,
      installSignalHandlers: false,
      hostnameOverride: "test-host",
      machineIdOverride: "22222222-2222-2222-2222-222222222222",
      log,
    });

    try {
      const addr = handle.bridgeAddress();
      if (!addr) throw new Error("bridge has no address");

      // Try to post with what would normally be a valid secret —
      // since the file was missing, runDaemon installed a freshly
      // generated random secret in memory, so even the "right-looking"
      // secret fails.
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/hook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fennec-Shim-Secret": "would-have-been-real",
        },
        body: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s" }),
      });

      expect(res.status).toBe(401);

      // The warn log must have surfaced the missing-secret state.
      const warnMsgs = log.warn.mock.calls.map((c) => c[0] as string);
      expect(warnMsgs.some((m) => m.includes("shim-secret missing"))).toBe(true);
    } finally {
      await handle.shutdown();
      await handle.done;
    }
  });

  it("reads shim-secret from FENNEC_SHIM_SECRET_PATH env var when opts override absent", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const envVarPath = join(tmpRoot, "env-var-shim-secret");
    const envVarSecret = "env-var-shim-secret-1234567890abcdef";
    writeFileSync(envVarPath, envVarSecret, { encoding: "utf-8" });

    const prevEnv = process.env.FENNEC_SHIM_SECRET_PATH;
    process.env.FENNEC_SHIM_SECRET_PATH = envVarPath;
    let handle: Awaited<ReturnType<typeof runDaemon>>;
    try {
      handle = await runDaemon({
        envOverride: env,
        // No `shimSecretPath` opt — should fall back to env var
        port: 0,
        installSignalHandlers: false,
        hostnameOverride: "test-host",
        machineIdOverride: "44444444-4444-4444-4444-444444444444",
        log,
      });
    } finally {
      if (prevEnv === undefined) delete process.env.FENNEC_SHIM_SECRET_PATH;
      else process.env.FENNEC_SHIM_SECRET_PATH = prevEnv;
    }

    try {
      const addr = handle.bridgeAddress();
      if (!addr) throw new Error("bridge has no address");
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/hook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fennec-Shim-Secret": envVarSecret,
        },
        body: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "env-var-test",
          cwd: "/tmp",
          prompt: "from env-var-loaded secret",
        }),
      });
      expect(res.status).toBe(202);
    } finally {
      await handle.shutdown();
      await handle.done;
    }
  });

  it("reads api-key from FENNEC_API_KEY_PATH env var and skips perm check (local-dev mode)", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const apiKeyPath = join(tmpRoot, "local-api-key");
    // Write WITHOUT mode 0o400 so we can prove the perm-check skip is
    // active — the canonical readApiKey would throw on a non-0o400 file.
    writeFileSync(apiKeyPath, "fennec_local_dev_api_key_xyz", { encoding: "utf-8", mode: 0o644 });

    const prevApiKey = process.env.FENNEC_API_KEY_PATH;
    process.env.FENNEC_API_KEY_PATH = apiKeyPath;
    let handle: Awaited<ReturnType<typeof runDaemon>>;
    try {
      handle = await runDaemon({
        envOverride: env,
        shimSecretPath,
        port: 0,
        installSignalHandlers: false,
        hostnameOverride: "test-host",
        machineIdOverride: "55555555-5555-5555-5555-555555555555",
        log,
      });
    } finally {
      if (prevApiKey === undefined) delete process.env.FENNEC_API_KEY_PATH;
      else process.env.FENNEC_API_KEY_PATH = prevApiKey;
    }

    try {
      // Warn log must have surfaced the local-dev mode disabling perm check.
      const warnMsgs = log.warn.mock.calls.map((c) => c[0] as string);
      expect(warnMsgs.some((m) => m.includes("permission check DISABLED"))).toBe(true);
      expect(warnMsgs.some((m) => m.includes("local-dev mode"))).toBe(true);
    } finally {
      await handle.shutdown();
      await handle.done;
    }
  });

  it("invokes shutdown via an injected shutdownSignal promise", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    let triggerShutdown: () => void = () => {};
    const shutdownSignal = new Promise<void>((resolve) => {
      triggerShutdown = resolve;
    });

    const handle = await runDaemon({
      envOverride: env,
      shimSecretPath,
      port: 0,
      installSignalHandlers: false,
      hostnameOverride: "test-host",
      machineIdOverride: "33333333-3333-3333-3333-333333333333",
      shutdownSignal,
      log,
    });

    // Fire the signal; `done` should resolve.
    triggerShutdown();
    await handle.done;

    expect(handle.bridgeAddress()).toBeNull();
  });
});
