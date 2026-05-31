/**
 * Rotation tests (Task 2 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Test 9):
 *  - rotateIfNeeded with a queue file >100MB renames to events-<timestamp>.jsonl
 *    and creates a fresh empty events.jsonl
 *  - listRotatedFiles returns sorted rotated files
 *
 * We use a small threshold for the size-trigger test (kilobytes, not 100MB)
 * to avoid writing 100MB to tmpdir on every CI run, while still exercising
 * the real fs.statSync path. The 100MB constant in the implementation is
 * checked via grep in PLAN.md acceptance criteria.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRotatedFiles, rotateIfNeeded } from "./rotation.js";

describe("rotation", () => {
  let dir: string;
  let queuePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-rotation-"));
    queuePath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when the queue is below the threshold", () => {
    writeFileSync(queuePath, "small\n");
    const result = rotateIfNeeded(queuePath, 1024);
    expect(result.rotated).toBe(false);
    expect(readFileSync(queuePath, "utf-8")).toBe("small\n");
  });

  it("does nothing when the queue file does not exist", () => {
    const result = rotateIfNeeded(queuePath, 1024);
    expect(result.rotated).toBe(false);
  });

  it("renames the queue and creates a fresh empty file when over threshold", () => {
    // 2KB of payload to clearly exceed the 1KB threshold
    const content = `${"x".repeat(2048)}\n`;
    writeFileSync(queuePath, content);

    const result = rotateIfNeeded(queuePath, 1024);
    expect(result.rotated).toBe(true);
    expect(result.rotatedTo).toBeDefined();
    expect(result.rotatedTo).toMatch(/events-.*\.jsonl$/);

    // Fresh queue exists and is empty
    expect(existsSync(queuePath)).toBe(true);
    expect(readFileSync(queuePath, "utf-8")).toBe("");

    // Rotated file still has the prior content
    expect(existsSync(result.rotatedTo as string)).toBe(true);
    expect(readFileSync(result.rotatedTo as string, "utf-8")).toBe(content);
  });

  it("listRotatedFiles returns rotated files in sorted (chronological) order", async () => {
    // Create rotated files with sortable ISO timestamps
    const ts1 = "2026-05-31T10-00-00-000Z";
    const ts2 = "2026-05-31T11-00-00-000Z";
    const ts3 = "2026-05-31T12-00-00-000Z";
    writeFileSync(join(dir, `events-${ts2}.jsonl`), "two\n");
    writeFileSync(join(dir, `events-${ts1}.jsonl`), "one\n");
    writeFileSync(join(dir, `events-${ts3}.jsonl`), "three\n");
    // Decoy: live queue must NOT appear in the list
    writeFileSync(join(dir, "events.jsonl"), "live\n");

    const files = listRotatedFiles(dir);
    expect(files).toHaveLength(3);
    expect(files[0]).toContain(ts1);
    expect(files[1]).toContain(ts2);
    expect(files[2]).toContain(ts3);
  });
});
