/**
 * Tests for `appendEvent` + `replayFromWatermark` (Task 2 of Plan 01-06).
 *
 * Behaviours covered (from PLAN.md `<behavior>`):
 *  - Test 5: two appendEvent calls → file contains exactly 2 parseable JSONL lines
 *  - Test 6: 50 concurrent appendEvent calls → file contains 50 parseable lines (no torn lines)
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@fennec/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, replayFromWatermark } from "./jsonl.js";

function makeEvent(idempotency_key: string, suffix: string): CanonicalEvent {
  return {
    idempotency_key,
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: "2026-05-31T12:00:00.000Z",
    hostname: "test-host",
    os: "darwin",
    kind: "prompt_submitted",
    payload: { suffix },
    schema_version: 1,
    redaction_applied_at: "2026-05-31T12:00:00.000Z",
    redaction_version_hash: "test-hash",
  };
}

describe("appendEvent", () => {
  let dir: string;
  let queuePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-jsonl-"));
    queuePath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends two events as two parseable JSONL lines", () => {
    const e1 = makeEvent("key-1", "one");
    const e2 = makeEvent("key-2", "two");

    appendEvent(e1, queuePath);
    appendEvent(e2, queuePath);

    const raw = readFileSync(queuePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0] as string) as CanonicalEvent;
    const parsed2 = JSON.parse(lines[1] as string) as CanonicalEvent;
    expect(parsed1.idempotency_key).toBe("key-1");
    expect(parsed2.idempotency_key).toBe("key-2");
    expect((parsed1.payload as { suffix: string }).suffix).toBe("one");
    expect((parsed2.payload as { suffix: string }).suffix).toBe("two");
  });

  it("handles 50 concurrent appends without torn lines", async () => {
    const events = Array.from({ length: 50 }, (_, i) => makeEvent(`key-${i}`, `s${i}`));

    // Spawn 50 concurrent appends via Promise.all over async wrappers that
    // immediately defer the synchronous call via setImmediate. The O_APPEND
    // semantics in jsonl.ts must serialise these on the file descriptor.
    await Promise.all(
      events.map(
        (e) =>
          new Promise<void>((resolve) => {
            setImmediate(() => {
              appendEvent(e, queuePath);
              resolve();
            });
          }),
      ),
    );

    const raw = readFileSync(queuePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(50);

    // Every line must parse as JSON — no partial / torn writes
    const keys = new Set<string>();
    for (const line of lines) {
      const parsed = JSON.parse(line) as CanonicalEvent;
      keys.add(parsed.idempotency_key);
    }
    expect(keys.size).toBe(50);
  });
});

describe("replayFromWatermark", () => {
  let dir: string;
  let queuePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-replay-"));
    queuePath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("yields all events when watermark is null", async () => {
    appendEvent(makeEvent("a", "1"), queuePath);
    appendEvent(makeEvent("b", "2"), queuePath);
    appendEvent(makeEvent("c", "3"), queuePath);

    const yielded: string[] = [];
    for await (const evt of replayFromWatermark(queuePath, null)) {
      yielded.push(evt.idempotency_key);
    }
    expect(yielded).toEqual(["a", "b", "c"]);
  });

  it("skips up to and including the watermark", async () => {
    appendEvent(makeEvent("a", "1"), queuePath);
    appendEvent(makeEvent("b", "2"), queuePath);
    appendEvent(makeEvent("c", "3"), queuePath);

    const yielded: string[] = [];
    for await (const evt of replayFromWatermark(queuePath, "b")) {
      yielded.push(evt.idempotency_key);
    }
    expect(yielded).toEqual(["c"]);
  });

  it("returns nothing when queue file does not exist", async () => {
    const yielded: string[] = [];
    for await (const evt of replayFromWatermark(queuePath, null)) {
      yielded.push(evt.idempotency_key);
    }
    expect(yielded).toEqual([]);
  });
});
