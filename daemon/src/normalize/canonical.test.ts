/**
 * Tests for `buildCanonicalEvent` + monotonic sequence file management
 * (Task 2 of Plan 01-06).
 *
 * Behaviours covered (from PLAN.md `<behavior>`):
 *  - Test 3: buildCanonicalEvent stamps hostname/os/occurred_at/idempotency_key/schema_version
 *  - Test 4: same monotonic_seq → same idempotency_key (stable for retry)
 *
 * Sequence files live under a per-test tmpdir so runs are isolated.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCanonicalEvent, bumpMonotonicSeq, readMonotonicSeq } from "./canonical.js";

describe("buildCanonicalEvent", () => {
  let seqDir: string;

  beforeEach(() => {
    seqDir = mkdtempSync(join(tmpdir(), "fennec-canonical-"));
  });

  afterEach(() => {
    rmSync(seqDir, { recursive: true, force: true });
  });

  it("stamps hostname, os, occurred_at, idempotency_key, schema_version on the canonical envelope", async () => {
    const event = await buildCanonicalEvent({
      tool: "claude-code",
      adapter_version: "0.1.0",
      kind: "prompt_submitted",
      payload: { prompt_text: "hello", session_id: "s1", hook_event: "UserPromptSubmit" },
      session_id: "s1",
      hook_event: "UserPromptSubmit",
      seqDir,
    });

    // hostname = os.hostname()
    expect(event.hostname).toBe(os.hostname());

    // os matches the process platform (mapping)
    const expectedOs = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "win32";
    expect(event.os).toBe(expectedOs);

    // occurred_at is an ISO datetime
    expect(typeof event.occurred_at).toBe("string");
    expect(() => new Date(event.occurred_at)).not.toThrow();
    expect(new Date(event.occurred_at).toString()).not.toBe("Invalid Date");

    // idempotency_key is 32-char hex (128 bits)
    expect(event.idempotency_key).toMatch(/^[0-9a-f]{32}$/);

    // schema_version = 1, tool wired through
    expect(event.schema_version).toBe(1);
    expect(event.tool).toBe("claude-code");
    expect(event.adapter_version).toBe("0.1.0");
    expect(event.kind).toBe("prompt_submitted");

    // payload survives untouched (redaction is a downstream concern)
    expect(event.payload.prompt_text).toBe("hello");

    // redaction metadata stamped with empty placeholders — redactor will fill
    expect(event.redaction_applied_at).toBe("");
    expect(event.redaction_version_hash).toBe("");
  });

  it("returns the same idempotency_key when called twice with the same monotonic_seq + identifying fields", async () => {
    // Pre-seed the seq file to a known value so both calls observe seq=42
    writeFileSync(join(seqDir, "claude-code.json"), JSON.stringify({ seq: 42 }));

    const inputA = {
      tool: "claude-code" as const,
      adapter_version: "0.1.0",
      kind: "prompt_submitted" as const,
      payload: {},
      session_id: "session-X",
      hook_event: "UserPromptSubmit",
      seqDir,
      monotonic_seq: 42,
    };
    const eventA = await buildCanonicalEvent(inputA);
    const eventB = await buildCanonicalEvent(inputA);

    expect(eventA.idempotency_key).toBe(eventB.idempotency_key);
  });
});

describe("monotonic sequence file", () => {
  let seqDir: string;

  beforeEach(() => {
    seqDir = mkdtempSync(join(tmpdir(), "fennec-seq-"));
  });

  afterEach(() => {
    rmSync(seqDir, { recursive: true, force: true });
  });

  it("readMonotonicSeq returns 0 when the file does not exist", () => {
    expect(readMonotonicSeq("claude-code", seqDir)).toBe(0);
  });

  it("bumpMonotonicSeq increments + persists + survives the next read", () => {
    const first = bumpMonotonicSeq("claude-code", seqDir);
    const second = bumpMonotonicSeq("claude-code", seqDir);
    const third = bumpMonotonicSeq("claude-code", seqDir);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(third).toBe(3);

    // Read-back returns the latest value
    expect(readMonotonicSeq("claude-code", seqDir)).toBe(3);

    // File on disk is JSON `{ "seq": 3 }`
    const persisted = JSON.parse(readFileSync(join(seqDir, "claude-code.json"), "utf-8")) as {
      seq: number;
    };
    expect(persisted.seq).toBe(3);
  });

  it("isolates sequences per-adapter", () => {
    bumpMonotonicSeq("claude-code", seqDir);
    bumpMonotonicSeq("claude-code", seqDir);
    const codexFirst = bumpMonotonicSeq("codex", seqDir);

    expect(readMonotonicSeq("claude-code", seqDir)).toBe(2);
    expect(codexFirst).toBe(1);
    expect(readMonotonicSeq("codex", seqDir)).toBe(1);
  });
});
