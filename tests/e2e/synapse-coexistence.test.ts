import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_HOOK_NAMES, removeFennecHooks, writeFennecHooks } from "@fennec/daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * DAE-11 / D-20 / D-24 — synapse coexistence smoke (local, no infra).
 *
 * Asserts the fennec daemon's managed-settings installer:
 *   1. Writes its hook entries into a system-layer managed-settings file
 *   2. Leaves a synapse-style user-settings file BYTE-IDENTICAL
 *      before/after install
 *   3. Surgical uninstall: removes ONLY fennec entries, leaves
 *      sibling entries (e.g. a synapse-style hook ALSO in
 *      managed-settings) intact, and leaves user-settings byte-equal
 *      AGAIN.
 *
 * This is the locally-runnable portion of Plan 01-10 Step E. The
 * remaining live verification (fire a Claude Code event, assert BOTH
 * fennec heartbeat AND synapse hook handler ran) requires Claude
 * Code + a synapse install + manual operator steps and lives in
 * tests/manual/synapse-coexistence-smoke.sh.
 *
 * The byte-equality SHA-256 is the load-bearing assertion: even one
 * accidental newline change in ~/.claude/settings.json would prove
 * the additive merge contract is broken.
 */

const FENNEC_HOOK_PATH = "/usr/local/fennec/bin/fennec-hook";
const SYNAPSE_HOOK_PATH = "/usr/local/synapse/bin/synapse-hook";

// The hook entry shape Claude Code actually reads: { type: "command", command }.
// We model synapse's user-settings the same way so the byte-equality
// assertion is testing a realistic shape, not a synthetic one.
const SYNAPSE_USER_SETTINGS = JSON.stringify(
  {
    hooks: {
      UserPromptSubmit: [{ type: "command", command: SYNAPSE_HOOK_PATH }],
    },
  },
  null,
  2,
);

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("DAE-11 synapse coexistence (local, no infra)", () => {
  let tmpRoot: string;
  let userSettings: string;
  let managedSettings: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "fennec-synapse-coexistence-"));
    userSettings = join(tmpRoot, "user-claude-settings.json");
    managedSettings = join(tmpRoot, "managed-settings.json");
    writeFileSync(userSettings, SYNAPSE_USER_SETTINGS, { mode: 0o644 });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("fennec install does not touch ~/.claude/settings.json (byte-equal SHA-256)", () => {
    const preSha = sha256(readFileSync(userSettings));

    writeFennecHooks(managedSettings, FENNEC_HOOK_PATH, { skipChown: true });

    const postSha = sha256(readFileSync(userSettings));
    expect(postSha, "user-settings file mutated during fennec install").toBe(preSha);
  });

  it("managed-settings contains fennec entries for all 6 D-22 hooks after install", () => {
    writeFennecHooks(managedSettings, FENNEC_HOOK_PATH, { skipChown: true });
    const parsed = JSON.parse(readFileSync(managedSettings, "utf8")) as {
      hooks?: Record<string, Array<{ type: string; command: string }>>;
    };
    expect(parsed.hooks).toBeDefined();
    const hookNames = Object.keys(parsed.hooks ?? {}).sort();
    expect(hookNames).toEqual([...ALL_HOOK_NAMES].sort());

    // Every hook array should contain a fennec entry
    for (const name of ALL_HOOK_NAMES) {
      const entries = parsed.hooks?.[name] ?? [];
      const hasFennec = entries.some((e) => e.command === FENNEC_HOOK_PATH);
      expect(hasFennec, `${name} missing fennec hook`).toBe(true);
    }
  });

  it("install is additive — pre-existing managed-settings entries are preserved", () => {
    // Pre-populate managed-settings with a synapse-style entry
    writeFileSync(
      managedSettings,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [{ type: "command", command: SYNAPSE_HOOK_PATH }],
          },
        },
        null,
        2,
      ),
      { mode: 0o644 },
    );

    writeFennecHooks(managedSettings, FENNEC_HOOK_PATH, { skipChown: true });

    const afterInstall = JSON.parse(readFileSync(managedSettings, "utf8")) as {
      hooks: Record<string, Array<{ type: string; command: string }>>;
    };
    const ups = afterInstall.hooks.UserPromptSubmit ?? [];
    const hasSynapse = ups.some((e) => e.command === SYNAPSE_HOOK_PATH);
    const hasFennec = ups.some((e) => e.command === FENNEC_HOOK_PATH);
    expect(hasSynapse, "synapse entry removed during fennec install (D-20 broken)").toBe(true);
    expect(hasFennec, "fennec entry missing after install").toBe(true);
  });

  it("surgical uninstall removes ONLY fennec entries from managed-settings", () => {
    // Pre-populate managed-settings with a synapse-style entry,
    // install fennec (additive), then uninstall and confirm only
    // fennec entries are gone.
    writeFileSync(
      managedSettings,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [{ type: "command", command: SYNAPSE_HOOK_PATH }],
          },
        },
        null,
        2,
      ),
      { mode: 0o644 },
    );

    writeFennecHooks(managedSettings, FENNEC_HOOK_PATH, { skipChown: true });
    removeFennecHooks(managedSettings, FENNEC_HOOK_PATH);

    const afterUninstall = JSON.parse(readFileSync(managedSettings, "utf8")) as {
      hooks: Record<string, Array<{ type: string; command: string }>>;
    };
    const ups = afterUninstall.hooks?.UserPromptSubmit ?? [];
    const synapseStillThere = ups.some((e) => e.command === SYNAPSE_HOOK_PATH);
    const fennecRemoved = !ups.some((e) => e.command === FENNEC_HOOK_PATH);
    expect(synapseStillThere, "synapse entry incorrectly removed (D-24 broken)").toBe(true);
    expect(fennecRemoved, "fennec entry survived uninstall").toBe(true);
  });

  it("user-settings file is byte-equal AGAIN after install+uninstall round trip", () => {
    const preSha = sha256(readFileSync(userSettings));

    writeFennecHooks(managedSettings, FENNEC_HOOK_PATH, { skipChown: true });
    removeFennecHooks(managedSettings, FENNEC_HOOK_PATH);

    const postSha = sha256(readFileSync(userSettings));
    expect(postSha, "round-trip mutated user-settings").toBe(preSha);
  });
});
