/**
 * writeFennecHooks install tests (Task 4 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md Tests 4–7 + 11):
 *  - Test 4: writeFennecHooks on a missing file → creates the file with all
 *           6 D-22 hooks pointing at the supplied hookCommand path.
 *  - Test 5: After install, file mode is 0o644 (or readable by all; chown
 *           is skipped in tests via opts.skipChown).
 *  - Test 6: Pre-existing file with another tool's entry — running
 *           writeFennecHooks ADDS fennec's entries without touching the
 *           other-tool entry (additive merge per D-20 / Pitfall 2).
 *  - Test 7: Re-running writeFennecHooks (idempotent install) does NOT
 *           duplicate fennec's entries.
 *  - Test 11: ~/.claude/settings.json is NEVER touched (synapse
 *            coexistence assertion — DAE-11 / D-20). Byte-equal pre/post.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALL_HOOK_NAMES, writeFennecHooks } from "./install.js";

const HOOK_CMD = "/usr/local/fennec/bin/fennec-hook";
const OTHER_TOOL_CMD = "node /Users/dev/synapse/hook-handler.js";

function sha256(buf: Buffer | string): string {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

describe("writeFennecHooks", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-install-"));
    path = join(dir, "managed-settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file with all 6 D-22 hooks when none exists", () => {
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(data.hooks).toBeDefined();
    const hooks = data.hooks as Record<string, unknown>;
    for (const hookName of ALL_HOOK_NAMES) {
      const entries = hooks[hookName] as Array<{ type: string; command: string }>;
      expect(Array.isArray(entries), `${hookName} should be an array`).toBe(true);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe("command");
      expect(entries[0]?.command).toBe(HOOK_CMD);
    }
    expect(Object.keys(hooks)).toHaveLength(6);
  });

  it("writes the file with mode 0o644 (readable by all, writable only by root)", () => {
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });
    const mode = statSync(path).mode & 0o777;
    // 0o644 = rw-r--r-- — root owns and writes; others read
    expect(mode).toBe(0o644);
  });

  it("ADDS fennec entries to an existing file without removing other tools' entries (D-20)", () => {
    // Pre-seed a managed-settings file with another tool's hook entry
    const preExisting = {
      hooks: {
        UserPromptSubmit: [{ type: "command", command: OTHER_TOOL_CMD }],
      },
    };
    writeFileSync(path, JSON.stringify(preExisting, null, 2), { mode: 0o644 });

    writeFennecHooks(path, HOOK_CMD, { skipChown: true });

    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const hooks = data.hooks as Record<string, Array<{ type: string; command: string }>>;
    // UserPromptSubmit has BOTH entries — other tool first, fennec second
    expect(hooks.UserPromptSubmit).toHaveLength(2);
    expect(hooks.UserPromptSubmit?.find((e) => e.command === OTHER_TOOL_CMD)).toBeDefined();
    expect(hooks.UserPromptSubmit?.find((e) => e.command === HOOK_CMD)).toBeDefined();
    // Other 5 hooks have only fennec's entry
    for (const hookName of ALL_HOOK_NAMES.filter((h) => h !== "UserPromptSubmit")) {
      expect(hooks[hookName]).toHaveLength(1);
      expect(hooks[hookName]?.[0]?.command).toBe(HOOK_CMD);
    }
  });

  it("is idempotent — re-running with the same hookCommand does NOT duplicate entries", () => {
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });

    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const hooks = data.hooks as Record<string, Array<{ command: string }>>;
    for (const hookName of ALL_HOOK_NAMES) {
      expect(hooks[hookName]).toHaveLength(1);
      expect(hooks[hookName]?.[0]?.command).toBe(HOOK_CMD);
    }
  });

  it("preserves user-settings (~/.claude/settings.json equivalent) byte-equal — synapse coexistence (D-20 / DAE-11)", () => {
    // Fixture: a synapse-like user-settings file in a separate path
    const userSettingsPath = join(dir, "user-settings.json");
    const userSettings = {
      hooks: {
        UserPromptSubmit: [{ type: "command", command: "node /home/dev/synapse/handler.js" }],
        SessionStart: [{ type: "command", command: "node /home/dev/synapse/handler.js" }],
      },
      otherSetting: "preserved",
    };
    writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2), { mode: 0o644 });
    const sha_before = sha256(readFileSync(userSettingsPath));

    // Install fennec hooks into the managed-settings path — a DIFFERENT file
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });

    // Assert: user-settings file is byte-equal before/after
    const sha_after = sha256(readFileSync(userSettingsPath));
    expect(sha_after).toBe(sha_before);
  });

  it("creates parent directories if missing (mkdirSync recursive)", () => {
    const nestedPath = join(dir, "deep", "nested", "managed-settings.json");
    writeFennecHooks(nestedPath, HOOK_CMD, { skipChown: true });
    expect(statSync(nestedPath).isFile()).toBe(true);
  });

  it("emits 2-space JSON indent (Pitfall 7) for human readability and diff stability", () => {
    writeFennecHooks(path, HOOK_CMD, { skipChown: true });
    const raw = readFileSync(path, "utf-8");
    // 2-space indent → object body lines start with 2 spaces (not tabs, not 4)
    expect(raw).toMatch(/^\{\n {2}"hooks": \{/);
  });

  it("rejects malformed pre-existing files gracefully — non-JSON content does NOT crash", () => {
    writeFileSync(path, "this is not json", { mode: 0o644 });
    // Expected: throws (so the caller / installer can surface a clean error).
    expect(() => writeFennecHooks(path, HOOK_CMD, { skipChown: true })).toThrow();
  });

  it("preserves a non-fennec top-level key in the existing file", () => {
    const preExisting = {
      hooks: {
        UserPromptSubmit: [{ type: "command", command: OTHER_TOOL_CMD }],
      },
      apiEndpoints: { "claude-code": "https://api.anthropic.com" },
    };
    writeFileSync(path, JSON.stringify(preExisting, null, 2), { mode: 0o644 });

    writeFennecHooks(path, HOOK_CMD, { skipChown: true });

    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(data.apiEndpoints).toEqual({ "claude-code": "https://api.anthropic.com" });
  });
});
