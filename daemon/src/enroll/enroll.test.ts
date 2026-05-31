/**
 * Enrollment client tests (Task 1 of Plan 01-08).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 1-4):
 *   - Test 1: POST /api/daemons/enroll with body matching
 *     EnrollRequestSchema; on 200 returns parsed EnrollResponse.
 *   - Test 2: On 401 throws "invalid_or_expired_install_secret".
 *   - Test 3: On 500 throws with the response status.
 *   - Test 4: Refuses to send if install_secret < 32 chars (client-side
 *     Zod validation BEFORE any network call).
 *
 * Threat model anchors:
 *   - T-08-06 (install_secret leak via log): the install_secret must
 *     not appear in any thrown Error.message; the 401-path error uses
 *     a fixed string and the 5xx-path uses status only.
 */

import { describe, expect, it, vi } from "vitest";
import { enrollDaemon } from "./enroll.js";

const VALID_SECRET = "x".repeat(32);
const VALID_RESPONSE = {
  api_key: "fennec_testkey",
  api_key_id: "11111111-2222-4333-8444-555555555555",
  org_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  org_name: "Test Org",
  privacy_policy_url: "https://fennec.test/privacy",
};

describe("enrollDaemon", () => {
  it("Test 1: POSTs to /api/daemons/enroll and returns parsed EnrollResponse on 200", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(VALID_RESPONSE), { status: 200 }));

    const result = await enrollDaemon({
      installSecret: VALID_SECRET,
      machineId: "abcdef12-3456-7890-abcd-ef1234567890",
      hostname: "test-host",
      os: "darwin",
      apiBaseUrl: "https://api.fennec.test",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    const call = fetchFn.mock.calls[0];
    if (!call) throw new Error("expected fetch to be called");
    expect(call[0]).toBe("https://api.fennec.test/api/daemons/enroll");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.install_secret).toBe(VALID_SECRET);
    expect(body.machine_id).toBe("abcdef12-3456-7890-abcd-ef1234567890");
    expect(body.hostname).toBe("test-host");
    expect(body.os).toBe("darwin");

    expect(result).toEqual(VALID_RESPONSE);
  });

  it("Test 2: throws invalid_or_expired_install_secret on 401", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    await expect(
      enrollDaemon({
        installSecret: VALID_SECRET,
        machineId: "abcdef12-3456-7890-abcd-ef1234567890",
        hostname: "test-host",
        os: "darwin",
        apiBaseUrl: "https://api.fennec.test",
        fetchFn,
      }),
    ).rejects.toThrow("invalid_or_expired_install_secret");
  });

  it("Test 3: throws with status on 5xx", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
    await expect(
      enrollDaemon({
        installSecret: VALID_SECRET,
        machineId: "abcdef12-3456-7890-abcd-ef1234567890",
        hostname: "test-host",
        os: "darwin",
        apiBaseUrl: "https://api.fennec.test",
        fetchFn,
      }),
    ).rejects.toThrow(/500/);
  });

  it("Test 4: refuses to send if install_secret is shorter than 32 chars (no network call)", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await expect(
      enrollDaemon({
        installSecret: "tooshort",
        machineId: "abcdef12-3456-7890-abcd-ef1234567890",
        hostname: "test-host",
        os: "darwin",
        apiBaseUrl: "https://api.fennec.test",
        fetchFn,
      }),
    ).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("never echoes install_secret in any thrown error message (T-08-06)", async () => {
    const secret = "supersecret".repeat(4); // 44 chars
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    try {
      await enrollDaemon({
        installSecret: secret,
        machineId: "abcdef12-3456-7890-abcd-ef1234567890",
        hostname: "test-host",
        os: "darwin",
        apiBaseUrl: "https://api.fennec.test",
        fetchFn,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
