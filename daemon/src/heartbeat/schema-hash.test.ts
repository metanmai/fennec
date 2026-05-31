/**
 * Schema-hash tests (Task 3 of Plan 01-06).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 14, 15, 16):
 *  - Test 14: computeSchemaHash returns a 16-hex string
 *  - Test 15: same field NAMES → same hash (regardless of values)
 *  - Test 16: different field names → different hash (drift detected)
 */

import { describe, expect, it } from "vitest";
import { computeSchemaHash } from "./schema-hash.js";

describe("computeSchemaHash", () => {
  it("returns a 16-char hex string", async () => {
    const hash = await computeSchemaHash({
      prompt_text: "x",
      session_id: "y",
      usage: { input_tokens: 1 },
    });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns the same hash for the same key-set regardless of values", async () => {
    const a = await computeSchemaHash({
      prompt_text: "hello",
      session_id: "session-1",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const b = await computeSchemaHash({
      prompt_text: "world",
      session_id: "session-2",
      usage: { input_tokens: 999, output_tokens: 1 },
    });
    expect(a).toBe(b);
  });

  it("returns DIFFERENT hashes when the field names change (drift detected)", async () => {
    const before = await computeSchemaHash({
      prompt_text: "x",
      session_id: "y",
      usage: { input_tokens: 1 },
    });
    // upstream renamed `prompt_text` to `prompt`
    const after = await computeSchemaHash({
      prompt: "x",
      session_id: "y",
      usage: { input_tokens: 1 },
    });
    expect(before).not.toBe(after);
  });

  it("returns a stable baseline hash for empty payloads", async () => {
    const a = await computeSchemaHash({});
    const b = await computeSchemaHash(null);
    const c = await computeSchemaHash("not a json string");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("includes nested object keys in the hash (recursive walk)", async () => {
    const a = await computeSchemaHash({ outer: { inner: 1 } });
    const b = await computeSchemaHash({ outer: { renamed: 1 } });
    expect(a).not.toBe(b);
  });

  it("treats a JSON-string payload identically to its parsed object", async () => {
    const obj = { a: 1, b: { c: 2 } };
    const fromObject = await computeSchemaHash(obj);
    const fromString = await computeSchemaHash(JSON.stringify(obj));
    expect(fromString).toBe(fromObject);
  });
});
