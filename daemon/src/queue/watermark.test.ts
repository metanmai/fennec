/**
 * Watermark tests (Task 2 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Test 8):
 *  - readWatermark on a non-existent path returns null
 *  - advanceWatermark(key) writes JSON atomically (tmp + rename)
 *  - subsequent readWatermark returns { last_synced_event_idempotency_key }
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { advanceWatermark, readWatermark } from "./watermark.js";

describe("watermark", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-watermark-"));
    path = join(dir, "sync-state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the watermark file does not exist", () => {
    expect(readWatermark(path)).toBeNull();
  });

  it("advanceWatermark writes the file and a subsequent read returns the key", () => {
    advanceWatermark(path, "key-abc");
    const w = readWatermark(path);
    expect(w).toEqual({ last_synced_event_idempotency_key: "key-abc" });
  });

  it("overwrites the prior watermark atomically", () => {
    advanceWatermark(path, "key-1");
    advanceWatermark(path, "key-2");
    advanceWatermark(path, "key-3");
    expect(readWatermark(path)).toEqual({ last_synced_event_idempotency_key: "key-3" });

    // No stale .tmp file left behind — rename is atomic
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("persists exactly the JSON shape backends expect", () => {
    advanceWatermark(path, "key-final");
    const raw = readFileSync(path, "utf-8");
    expect(JSON.parse(raw)).toEqual({ last_synced_event_idempotency_key: "key-final" });
  });
});
