import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceWatermark,
  appendEvent,
  buildCanonicalEvent,
  readWatermark,
  redactEvent,
  replayFromWatermark,
} from "@fennec/daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * ROADMAP success criterion 6 — kill -9 idempotency + replay
 * survival (local, no infra).
 *
 * Simulates the daemon-restart scenario:
 *   1. Capture N events → append to JSONL → watermark advances per
 *      successful ship-to-backend.
 *   2. "kill -9" the daemon mid-ship: the watermark stopped
 *      advancing after event #2 even though events #3–5 made it
 *      to disk.
 *   3. Daemon "restarts" via `replayFromWatermark` — reads from
 *      the last-acknowledged offset forward.
 *   4. The same idempotency_key is produced for the same event
 *      payload, so the backend's
 *      ON CONFLICT (idempotency_key) DO NOTHING
 *      dedupes any retry server-side.
 *
 * Asserts:
 *   - `buildCanonicalEvent` is deterministic for the same input
 *     (pinned `monotonic_seq`) — kill+restart produces identical key.
 *   - Replay from a stale watermark yields exactly the un-acknowledged
 *     tail (no events lost, no events repeated).
 *   - Redactor stamps the same redaction_version_hash on every event
 *     so a replay produces byte-equal payloads (server-side dedupe
 *     is content-stable).
 *
 * Plan 01-10 Step C still requires a live macOS kill -9 of the
 * actual LaunchDaemon process (proving launchd's KeepAlive plus the
 * end-to-end backend dedupe path). This test proves the daemon's
 * queue + watermark + idempotency invariants the end-to-end test
 * relies on.
 */

function makeEvent(promptText: string, hostname: string, occurredAt: string, monotonicSeq: number, seqDir: string) {
  return buildCanonicalEvent({
    tool: "claude-code",
    adapter_version: "0.1.0",
    occurred_at: occurredAt,
    hostname,
    kind: "prompt_submitted",
    payload: { prompt_text: promptText },
    session_id: "kill9-smoke",
    hook_event: "UserPromptSubmit",
    monotonic_seq: monotonicSeq,
    seqDir,
  });
}

describe("ROADMAP criterion 6 — kill -9 idempotency (local, no infra)", () => {
  let tmpRoot: string;
  let queuePath: string;
  let watermarkPath: string;
  let seqDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "fennec-kill9-"));
    queuePath = join(tmpRoot, "events.jsonl");
    watermarkPath = join(tmpRoot, "sync-state.json");
    seqDir = join(tmpRoot, "seq");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("buildCanonicalEvent produces deterministic idempotency_key for identical input", async () => {
    const a = await makeEvent("hello", "host-a", "2026-05-31T12:00:00.000Z", 1, seqDir);
    const b = await makeEvent("hello", "host-a", "2026-05-31T12:00:00.000Z", 1, seqDir);
    expect(a.idempotency_key).toBe(b.idempotency_key);
  });

  it("differs on monotonic_seq, matches on identical pinned (seq, ids)", async () => {
    const a = await makeEvent("hello", "host-a", "2026-05-31T12:00:00.000Z", 1, seqDir);
    const c = await makeEvent("hello", "host-a", "2026-05-31T12:00:00.000Z", 2, seqDir);
    expect(a.idempotency_key).not.toBe(c.idempotency_key);

    // Re-derive A — identical
    const a2 = await makeEvent("hello", "host-a", "2026-05-31T12:00:00.000Z", 1, seqDir);
    expect(a.idempotency_key).toBe(a2.idempotency_key);
  });

  it("redactor produces byte-equal payload on a replay of the same event", async () => {
    const event = await makeEvent(
      "Run with AKIAIOSFODNN7EXAMPLE access key please",
      "host",
      "2026-05-31T12:00:00.000Z",
      1,
      seqDir,
    );
    const first = redactEvent(event);
    const second = redactEvent(event);
    expect(JSON.stringify(first.payload)).toBe(JSON.stringify(second.payload));
    expect(first.redaction_version_hash).toBe(second.redaction_version_hash);
  });

  it("replay from stale watermark yields exactly the events that crashed mid-ship", async () => {
    // Append 5 events to the JSONL queue
    const events = [];
    for (let i = 0; i < 5; i++) {
      const e = await makeEvent(
        `prompt ${i}`,
        "host",
        new Date(Date.UTC(2026, 4, 31, 12, 0, i)).toISOString(),
        i + 1,
        seqDir,
      );
      events.push(e);
      appendEvent(e, queuePath);
    }

    // Simulate: daemon successfully shipped + acknowledged the
    // first 2 events. Watermark advances to event #2's key.
    advanceWatermark(watermarkPath, events[1]?.idempotency_key);

    // Now simulate kill -9 during ship of events 3-5. On restart
    // the daemon calls replayFromWatermark, which skips events 1-2
    // (already acked, watermark = event 2's key) and yields 3-5.
    const wm = readWatermark(watermarkPath);
    const lastAcked = wm?.last_synced_event_idempotency_key ?? null;
    const replay = [];
    for await (const e of replayFromWatermark(queuePath, lastAcked)) {
      replay.push(e);
    }

    expect(replay.length).toBe(3);
    expect(replay.map((e) => e.idempotency_key)).toEqual([
      events[2]?.idempotency_key,
      events[3]?.idempotency_key,
      events[4]?.idempotency_key,
    ]);
  });

  it("a second replay (after another kill mid-ship) produces the SAME idempotency_keys", async () => {
    // Real backend would dedupe via ON CONFLICT (idempotency_key)
    // DO NOTHING. The daemon-side invariant: the SAME event always
    // produces the SAME key, no matter how many times it's replayed.
    const events = [];
    for (let i = 0; i < 3; i++) {
      const e = await makeEvent(
        `prompt ${i}`,
        "host",
        new Date(Date.UTC(2026, 4, 31, 12, 0, i)).toISOString(),
        i + 1,
        seqDir,
      );
      events.push(e);
      appendEvent(e, queuePath);
    }

    // First replay — watermark not advanced (simulating crash before ack)
    const r1: string[] = [];
    for await (const e of replayFromWatermark(queuePath, null)) {
      r1.push(e.idempotency_key);
    }

    // Second replay — same situation (still no watermark advance)
    const r2: string[] = [];
    for await (const e of replayFromWatermark(queuePath, null)) {
      r2.push(e.idempotency_key);
    }

    expect(r1).toEqual(r2);
    expect(r1.length).toBe(3);
  });

  it("watermark file is durable across reads (kill+restart-safe)", async () => {
    const event = await makeEvent("durability", "host", "2026-05-31T12:00:00.000Z", 42, seqDir);
    advanceWatermark(watermarkPath, event.idempotency_key);

    const wm1 = readWatermark(watermarkPath);
    const wm2 = readWatermark(watermarkPath);
    expect(wm1).not.toBeNull();
    expect(wm1?.last_synced_event_idempotency_key).toBe(event.idempotency_key);
    expect(wm2?.last_synced_event_idempotency_key).toBe(event.idempotency_key);

    // Confirm the file is real JSON on disk (operator can `cat` to debug)
    const raw = JSON.parse(readFileSync(watermarkPath, "utf8")) as {
      last_synced_event_idempotency_key?: string;
    };
    expect(raw.last_synced_event_idempotency_key).toBe(event.idempotency_key);

    // Tamper-recovery: corrupt the file and confirm readWatermark
    // returns null (so the daemon restarts from offset 0).
    writeFileSync(watermarkPath, "{not-valid-json", "utf8");
    const wm3 = readWatermark(watermarkPath);
    expect(wm3).toBeNull();
  });
});
