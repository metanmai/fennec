/**
 * Crash-safety test (Task 2 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Test 7):
 *  - Write 10 events, simulate truncation of the last line (overwrite the
 *    last 5 bytes with random), then `replayFromWatermark(null)` yields
 *    9 events (skipping the corrupted one) without throwing.
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@fennec/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, replayFromWatermark } from "./jsonl.js";

function makeEvent(i: number): CanonicalEvent {
  return {
    idempotency_key: `crash-key-${i}`,
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "test",
    os: "darwin",
    kind: "prompt_submitted",
    payload: { i },
    schema_version: 1,
    redaction_applied_at: "2026-05-31T12:00:00.000Z",
    redaction_version_hash: "test-hash",
  };
}

describe("crash-safe replay", () => {
  let dir: string;
  let queuePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-crash-"));
    queuePath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("yields 9 of 10 events when the last line is truncated mid-write", async () => {
    for (let i = 0; i < 10; i++) {
      appendEvent(makeEvent(i), queuePath);
    }

    // Corrupt the last line by overwriting the trailing 5 bytes with garbage
    // that breaks JSON syntax (raw bytes that don't form a closing JSON token).
    const raw = readFileSync(queuePath);
    const truncated = raw.subarray(0, raw.length - 5);
    writeFileSync(queuePath, truncated);
    appendFileSync(queuePath, "@@##!");

    const yielded: string[] = [];
    for await (const evt of replayFromWatermark(queuePath, null)) {
      yielded.push(evt.idempotency_key);
    }

    // 9 events parse cleanly; the corrupted last line is silently dropped
    expect(yielded).toHaveLength(9);
    expect(yielded).toEqual([
      "crash-key-0",
      "crash-key-1",
      "crash-key-2",
      "crash-key-3",
      "crash-key-4",
      "crash-key-5",
      "crash-key-6",
      "crash-key-7",
      "crash-key-8",
    ]);
  });
});
