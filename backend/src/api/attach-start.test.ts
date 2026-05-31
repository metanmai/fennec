/**
 * GET /api/auth/sso -- PKCE attach start (AUTH-16, half 1).
 *
 * Plan 01-05 Tests 1 + 2:
 *   - happy path 302 redirect to provider's authorize URL with state stored in KV
 *   - missing/invalid params -> 400
 *
 * Phase 1 implements all three providers (Google / GitHub / Microsoft) and
 * picks one for the Phase 1 dev-OAuth smoke. The plan calls for the surface
 * to support all three; Plan 01-08 (daemon-side attach) picks the actual
 * provider it shells out to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, stubEnv } from "../test-utils/mock-db.js";

vi.mock("../db/client.js", () => ({ pgClient: () => ({}) }));

import attachStartApp from "./attach-start.js";

const PKCE_CHALLENGE = "abcdef0123456789abcdef0123456789abcdef01234"; // 43 chars (S256 base64url)
const STATE = "rand-state-abc123";

describe("GET /api/auth/sso (AUTH-16 start, PKCE)", () => {
  const kv = createMockKv();
  const env = stubEnv({ OAUTH_STATE_KV: kv });

  beforeEach(() => {
    kv.clear();
    vi.clearAllMocks();
  });

  it("Test 1: 302 redirects to GitHub authorize URL with state + code_challenge; stores state in KV", async () => {
    const url = `/api/auth/sso?machine_id=PHASE1_SMOKE_MACHINE&redirect_uri=${encodeURIComponent("http://127.0.0.1:50000/callback")}&code_challenge=${PKCE_CHALLENGE}&state=${STATE}&provider=github`;
    const res = await attachStartApp.request(url, { method: "GET" }, env);
    expect(res.status).toBe(302);

    const location = res.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toContain("github.com/login/oauth/authorize");
    expect(location).toContain(`state=${STATE}`);
    expect(location).toContain(`client_id=${env.OAUTH_GITHUB_CLIENT_ID}`);
    expect(location).toContain("response_type=code");
    expect(location).toContain(`code_challenge=${PKCE_CHALLENGE}`);
    expect(location).toContain("code_challenge_method=S256");

    // KV must record the state with 10-min TTL.
    const meta = kv.getMeta(STATE);
    expect(meta).not.toBeNull();
    expect(meta?.expirationTtl).toBe(600);
    const stored = JSON.parse(meta?.value ?? "{}");
    expect(stored.machine_id).toBe("PHASE1_SMOKE_MACHINE");
    expect(stored.redirect_uri).toBe("http://127.0.0.1:50000/callback");
    expect(stored.code_challenge).toBe(PKCE_CHALLENGE);
    expect(stored.provider).toBe("github");
  });

  it("redirects to Google for provider=google", async () => {
    const url = `/api/auth/sso?machine_id=PHASE1_SMOKE_MACHINE&redirect_uri=${encodeURIComponent("http://127.0.0.1:50000/callback")}&code_challenge=${PKCE_CHALLENGE}&state=${STATE}-g&provider=google`;
    const res = await attachStartApp.request(url, { method: "GET" }, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("accounts.google.com");
    expect(location).toContain(`client_id=${env.OAUTH_GOOGLE_CLIENT_ID}`);
    expect(location).toMatch(/scope=[^&]*(openid|email)/i);
  });

  it("redirects to Microsoft for provider=microsoft", async () => {
    const url = `/api/auth/sso?machine_id=PHASE1_SMOKE_MACHINE&redirect_uri=${encodeURIComponent("http://127.0.0.1:50000/callback")}&code_challenge=${PKCE_CHALLENGE}&state=${STATE}-m&provider=microsoft`;
    const res = await attachStartApp.request(url, { method: "GET" }, env);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toMatch(/login\.microsoftonline\.com/);
    expect(location).toContain(`client_id=${env.OAUTH_MICROSOFT_CLIENT_ID}`);
  });

  it("Test 2: returns 400 when required params are missing", async () => {
    const res = await attachStartApp.request("/api/auth/sso?machine_id=x", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when code_challenge is shorter than 43 chars", async () => {
    const shortChallenge = "tooshort";
    const url = `/api/auth/sso?machine_id=PHASE1_SMOKE_MACHINE&redirect_uri=${encodeURIComponent("http://127.0.0.1:50000/callback")}&code_challenge=${shortChallenge}&state=${STATE}-short&provider=github`;
    const res = await attachStartApp.request(url, { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when provider is not in the supported enum", async () => {
    const url = `/api/auth/sso?machine_id=PHASE1_SMOKE_MACHINE&redirect_uri=${encodeURIComponent("http://127.0.0.1:50000/callback")}&code_challenge=${PKCE_CHALLENGE}&state=${STATE}-bad&provider=okta`;
    const res = await attachStartApp.request(url, { method: "GET" }, env);
    expect(res.status).toBe(400);
  });
});
