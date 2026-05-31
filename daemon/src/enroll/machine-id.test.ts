/**
 * machine-id tests (Task 1 of Plan 01-08).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 10-12):
 *   - Test 10: getMachineId("darwin") returns a 36-char UUID string
 *     (darwin-only; skipped on Linux/CI).
 *   - Test 11: getMachineId("linux") or ("win32") throws
 *     "machine_id_unsupported_on_phase1_os".
 *   - Test 12: getMachineId is stable — two calls in the same process
 *     return the same value (memoised).
 *
 * D-13 (per-machine API keys keyed on a stable identifier):
 *   IOPlatformUUID is read via the argv-array `ioreg -rd1 -c
 *   IOPlatformExpertDevice` (NO shell concatenation) and the result is
 *   memoised in module scope for stable values across calls.
 */

import { describe, expect, it } from "vitest";
import { _resetMachineIdCacheForTests, getMachineId } from "./machine-id.js";

describe("getMachineId (darwin)", () => {
  it.skipIf(process.platform !== "darwin")("Test 10: returns a 36-char UUID string on macOS", () => {
    _resetMachineIdCacheForTests();
    const id = getMachineId("darwin");
    expect(typeof id).toBe("string");
    // IOPlatformUUID is a UUID — 36 chars with dashes.
    expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i);
  });

  it.skipIf(process.platform !== "darwin")("Test 12: returns the same value on repeated calls (memoised)", () => {
    _resetMachineIdCacheForTests();
    const a = getMachineId("darwin");
    const b = getMachineId("darwin");
    expect(a).toBe(b);
  });
});

describe("getMachineId (non-darwin Phase 1 OSes)", () => {
  it("Test 11a: throws machine_id_unsupported_on_phase1_os for linux", () => {
    _resetMachineIdCacheForTests();
    expect(() => getMachineId("linux")).toThrow(/machine_id_unsupported_on_phase1_os/);
  });

  it("Test 11b: throws machine_id_unsupported_on_phase1_os for win32", () => {
    _resetMachineIdCacheForTests();
    expect(() => getMachineId("win32")).toThrow(/machine_id_unsupported_on_phase1_os/);
  });

  it("throws for unknown OS string (defence-in-depth)", () => {
    _resetMachineIdCacheForTests();
    // @ts-expect-error - intentionally invalid OS value
    expect(() => getMachineId("plan9")).toThrow();
  });
});
