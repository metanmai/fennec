/**
 * removeFennecHooks uninstall tests (Task 4 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md Tests 8–10):
 *  - Test 8: Pre-existing file with BOTH fennec + other-tool entries —
 *           removeFennecHooks removes ONLY fennec entries; other-tool
 *           entries preserved. (D-24 surgical uninstall.)
 *  - Test 9: Pre-existing file with ONLY fennec entries — file becomes
 *           empty of meaningful content → unlinkSync(path).
 *  - Test 10: removeFennecHooks NEVER touches ~/.claude/settings.json
 *            (verified by byte-equal SHA-256 on a separate user-settings
 *            fixture).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeFennecHooks } from "./uninstall.js";

const HOOK_CMD = "/usr/local/fennec/bin/fennec-hook";
const OTHER_TOOL_CMD = "node /Users/dev/synapse/hook-handler.js";

function sha256(buf: Buffer | string): string {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

describe("removeFennecHooks", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-uninstall-"));
    path = join(dir, "managed-settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes ONLY fennec entries — preserves another tool's blocks (D-24 surgical)", () => {
    const data = {
      hooks: {
        // Two separate blocks: one for OTHER_TOOL, one for fennec
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: OTHER_TOOL_CMD }] },
          { hooks: [{ type: "command", command: HOOK_CMD }] },
        ],
        PostToolUse: [{ hooks: [{ type: "command", command: HOOK_CMD }] }],
      },
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o644 });

    removeFennecHooks(path, HOOK_CMD);

    const result = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    // UserPromptSubmit still has the OTHER_TOOL block (fennec block dropped)
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe(OTHER_TOOL_CMD);
    // PostToolUse is gone entirely (only had fennec block → all blocks dropped)
    expect(hooks.PostToolUse).toBeUndefined();
  });

  it("UNLINKS the file when all entries removed and no other top-level keys remain", () => {
    // Pre-existing file containing ONLY fennec blocks (all 6 hooks)
    const fennecBlock = { hooks: [{ type: "command", command: HOOK_CMD }] };
    const data = {
      hooks: {
        UserPromptSubmit: [fennecBlock],
        PostToolUse: [fennecBlock],
        SessionStart: [fennecBlock],
        SessionEnd: [fennecBlock],
        PreCompact: [fennecBlock],
        SubagentStop: [fennecBlock],
      },
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o644 });

    removeFennecHooks(path, HOOK_CMD);

    expect(existsSync(path)).toBe(false);
  });

  it("KEEPS the file when another top-level key remains, even if all hooks were fennec's", () => {
    const data = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK_CMD }] }],
      },
      apiEndpoints: { "claude-code": "https://api.anthropic.com" },
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o644 });

    removeFennecHooks(path, HOOK_CMD);

    expect(existsSync(path)).toBe(true);
    const result = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(result.apiEndpoints).toEqual({ "claude-code": "https://api.anthropic.com" });
    // hooks should be absent or empty — no fennec command anywhere
    const hooks = result.hooks as Record<string, unknown> | undefined;
    if (hooks) {
      for (const key of Object.keys(hooks)) {
        const blocks = hooks[key] as Array<{ hooks?: Array<{ command: string }> }> | undefined;
        if (Array.isArray(blocks)) {
          const allCommands = blocks.flatMap((b) => b.hooks?.map((h) => h.command) ?? []);
          expect(allCommands).not.toContain(HOOK_CMD);
        }
      }
    }
  });

  it("is a no-op when the file does not exist (no throw)", () => {
    // path was never written
    expect(() => removeFennecHooks(path, HOOK_CMD)).not.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("preserves ~/.claude/settings.json byte-equal — synapse coexistence (D-20 / DAE-11)", () => {
    // Set up TWO files:
    //   1. managed-settings.json at `path` — fennec entries to remove
    //   2. user-settings.json — synapse equivalent that must NOT be touched
    const userSettingsPath = join(dir, "user-settings.json");
    const userSettings = {
      hooks: {
        UserPromptSubmit: [{ type: "command", command: "node /home/dev/synapse/handler.js" }],
      },
    };
    writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2), { mode: 0o644 });
    const sha_before = sha256(readFileSync(userSettingsPath));

    // Install + uninstall fennec entries in managed-settings
    writeFileSync(
      path,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK_CMD }] }],
          },
        },
        null,
        2,
      ),
      { mode: 0o644 },
    );
    removeFennecHooks(path, HOOK_CMD);

    // user-settings.json untouched
    const sha_after = sha256(readFileSync(userSettingsPath));
    expect(sha_after).toBe(sha_before);
  });

  it("preserves 2-space indent on the rewritten file (Pitfall 7)", () => {
    const data = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: OTHER_TOOL_CMD }] },
          { hooks: [{ type: "command", command: HOOK_CMD }] },
        ],
      },
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o644 });

    removeFennecHooks(path, HOOK_CMD);

    const raw = readFileSync(path, "utf-8");
    expect(raw).toMatch(/^\{\n {2}"hooks": \{/);
  });

  it("strips fennec entries from a block that ALSO contains another tool's entry, preserves the survivor", () => {
    // Edge case: a single block with TWO inner entries — one fennec, one other.
    // The fennec entry is removed; the surviving block keeps the other entry.
    const data = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: HOOK_CMD },
              { type: "command", command: OTHER_TOOL_CMD },
              { type: "command", command: "/some/third/tool" },
            ],
          },
        ],
      },
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o644 });

    removeFennecHooks(path, HOOK_CMD);

    const result = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const hooks = result.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.UserPromptSubmit?.[0]?.hooks).toHaveLength(2);
    expect(hooks.UserPromptSubmit?.[0]?.hooks?.map((e) => e.command)).toEqual([OTHER_TOOL_CMD, "/some/third/tool"]);
  });
});
