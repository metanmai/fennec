/**
 * One-shot OAuth callback server tests (Task 2 of Plan 01-08).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 3-7):
 *   - Test 3: server.start() returns { port, callbackUrl, awaitCode };
 *     server bound to 127.0.0.1 (never 0.0.0.0).
 *   - Test 4: GET /callback?code=...&state=... resolves awaitCode and
 *     responds 200 with "Sign-in complete. You can close this tab.".
 *   - Test 5: GET to any other path returns 404; awaitCode NOT resolved.
 *   - Test 6: After awaitCode resolves, server stops listening
 *     (subsequent GET fails ECONNREFUSED).
 *   - Test 7: If timeout elapses without callback, awaitCode rejects
 *     with "oauth_attach_timeout".
 *
 * Test 7 uses opts.timeoutMs (100ms) to keep the test fast — production
 * uses the 5-minute default per RFC 8252 §7.3 guidance.
 */

import { describe, expect, it } from "vitest";
import { OneShotOAuthServer } from "./oauth-server.js";

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const resp = await fetch(url);
  return { status: resp.status, body: await resp.text() };
}

describe("OneShotOAuthServer", () => {
  it("Test 3: start() returns { port, callbackUrl, awaitCode } bound to 127.0.0.1", async () => {
    const server = new OneShotOAuthServer();
    const { port, callbackUrl, awaitCode } = await server.start();
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
    expect(callbackUrl).toBe(`http://127.0.0.1:${port}/callback`);
    expect(awaitCode).toBeInstanceOf(Promise);
    server.stop();
    // Drain the rejected promise so the test runner does not flag an
    // unhandled rejection when stop() rejects it.
    try {
      await awaitCode;
    } catch {
      /* expected */
    }
  });

  it("Test 4: GET /callback resolves awaitCode and returns 200", async () => {
    const server = new OneShotOAuthServer();
    const { port, awaitCode } = await server.start();
    const r = await httpGet(`http://127.0.0.1:${port}/callback?code=abc&state=xyz`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("Sign-in complete");
    const result = await awaitCode;
    expect(result).toEqual({ code: "abc", state: "xyz" });
  });

  it("Test 5: GET to a non-callback path returns 404; awaitCode not resolved", async () => {
    const server = new OneShotOAuthServer();
    const { port, awaitCode } = await server.start();
    const r = await httpGet(`http://127.0.0.1:${port}/other`);
    expect(r.status).toBe(404);

    // Race awaitCode against a short sleep; awaitCode should NOT win.
    const winner = await Promise.race([
      awaitCode.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);
    expect(winner).toBe("timeout");
    server.stop();
    try {
      await awaitCode;
    } catch {
      /* expected */
    }
  });

  it("Test 6: after awaitCode resolves, server stops listening", async () => {
    const server = new OneShotOAuthServer();
    const { port, awaitCode } = await server.start();
    await httpGet(`http://127.0.0.1:${port}/callback?code=a&state=s`);
    await awaitCode;

    // Subsequent fetch should fail with ECONNREFUSED. fetch throws.
    let threw = false;
    try {
      await fetch(`http://127.0.0.1:${port}/callback?code=b&state=s2`);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("Test 7: 100ms timeout rejects awaitCode with oauth_attach_timeout", async () => {
    const server = new OneShotOAuthServer({ timeoutMs: 100 });
    const { awaitCode } = await server.start();
    await expect(awaitCode).rejects.toThrow(/oauth_attach_timeout/);
  });
});
