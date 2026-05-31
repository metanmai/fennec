/**
 * POST /api/daemons/attach-callback (AUTH-16, half 2).
 *
 * Plan 01-05 Tests 3-7. Covers:
 *  - PKCE verification (challenge derived from verifier matches stored)
 *  - state lookup in KV (expired/missing -> 400)
 *  - provider code exchange (mocked via global fetch)
 *  - users UPSERT + org_members + daemon_machines attachment
 *  - unknown@<host> backfill (only matching hostname)
 *  - audit row with reason="attach_completed"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient, createMockKv, stubEnv } from "../test-utils/mock-db.js";

const mockHandle = createMockClient();
vi.mock("../db/client.js", () => ({ pgClient: () => mockHandle.client }));

import attachCallbackApp from "./attach-callback.js";

const PKCE_VERIFIER = "this-is-a-pkce-verifier-of-the-right-length-43-chars-yes";
let PKCE_CHALLENGE = "";

const STATE = "state-abc-123";
const TEST_ORG = "00000000-0000-0000-0000-000000000001";
const TEST_MACHINE = "00000000-0000-0000-0000-000000000004";
const RESOLVED_USER_ID = "00000000-0000-0000-0000-000000000020";

const seededAuth = {
  api_key_id: "00000000-0000-0000-0000-000000000005",
  org_id: TEST_ORG,
  daemon_machine_id: TEST_MACHINE,
  hostname: "phase1-host",
};
vi.mock("../lib/resolve-api-key.js", () => ({
  resolveApiKey: vi.fn(async () => seededAuth),
}));

async function base64UrlSha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const b64 = Buffer.from(new Uint8Array(digest)).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Helper: install a default happy-path DB handler.
function installDefaultHandler() {
  mockHandle.setHandler((sql) => {
    if (/INSERT\s+INTO\s+users/i.test(sql)) {
      return { rows: [{ id: RESOLVED_USER_ID }], rowCount: 1 };
    }
    if (/INSERT\s+INTO\s+org_members/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT\s+id,\s*hostname\s+FROM\s+daemon_machines/i.test(sql)) {
      return { rows: [{ id: TEST_MACHINE, hostname: "phase1-host" }], rowCount: 1 };
    }
    if (/UPDATE\s+daemon_machines\s+SET\s+attached_user_id/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE\s+ai_events\s+SET\s+user_id/i.test(sql)) {
      // Simulate 5 events backfilled (Test 6).
      return { rows: [], rowCount: 5 };
    }
    if (/INSERT\s+INTO\s+daemon_audit_events/i.test(sql)) {
      return { rows: [{ id: "audit-id" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe("POST /api/daemons/attach-callback (AUTH-16 callback)", () => {
  const kv = createMockKv();
  const env = stubEnv({ OAUTH_STATE_KV: kv });
  const originalFetch = global.fetch;

  beforeEach(async () => {
    PKCE_CHALLENGE = await base64UrlSha256(PKCE_VERIFIER);
    kv.clear();
    mockHandle.calls.length = 0;
    installDefaultHandler();
    vi.clearAllMocks();

    await kv.put(
      STATE,
      JSON.stringify({
        machine_id: "PHASE1_SMOKE_MACHINE",
        redirect_uri: "http://127.0.0.1:50000/callback",
        code_challenge: PKCE_CHALLENGE,
        provider: "github",
      }),
      { expirationTtl: 600 },
    );

    // Mock the provider's /access_token + /user endpoints. GitHub returns a
    // bearer token; the handler then GETs /user to recover the email.
    global.fetch = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("github.com/login/oauth/access_token")) {
        return new Response(
          JSON.stringify({ access_token: "gh-token", token_type: "bearer", scope: "read:user user:email" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("api.github.com/user")) {
        return new Response(JSON.stringify({ login: "alice", email: "alice@example.com", id: 12345 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Google/Microsoft path -- the OIDC token endpoint returns id_token.
      if (url.includes("oauth2.googleapis.com/token") || url.includes("login.microsoftonline.com")) {
        // id_token is a JWT; the handler reads its email claim. The header is
        // a fixed base64 of {"alg":"none"} so verification is skipped in
        // Phase 1 (the code exchange is already proof of provider).
        const claims = { email: "alice@example.com", sub: "subject-12345" };
        const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
        return new Response(JSON.stringify({ id_token: `eyJhbGciOiJub25lIn0.${payload}.` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("Test 3: happy path (GitHub) -- exchanges code, upserts user, attaches machine, backfills, audits", async () => {
    const body = {
      code: "github-auth-code",
      state: STATE,
      code_verifier: PKCE_VERIFIER,
      machine_id: "PHASE1_SMOKE_MACHINE",
    };
    const res = await attachCallbackApp.request(
      "/api/daemons/attach-callback",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(200);
    const responseBody = (await res.json()) as {
      user_id: string;
      email: string;
      org_id: string;
    };
    expect(responseBody.email).toBe("alice@example.com");
    expect(responseBody.org_id).toBe(TEST_ORG);
    expect(responseBody.user_id).toBe(RESOLVED_USER_ID);

    const sqls = mockHandle.calls.map((c) => c.sql).join("\n---\n");
    expect(sqls).toMatch(/INSERT\s+INTO\s+users/i);
    expect(sqls).toMatch(/INSERT\s+INTO\s+org_members/i);
    expect(sqls).toMatch(/UPDATE\s+daemon_machines\s+SET\s+attached_user_id/i);
    expect(sqls).toMatch(/UPDATE\s+ai_events\s+SET\s+user_id/i);

    const auditCalls = mockHandle.calls.filter((c) => /INSERT\s+INTO\s+daemon_audit_events/i.test(c.sql));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.params).toContain("attach_completed");

    // KV state is consumed (deleted) after a successful callback.
    expect(kv.getMeta(STATE)).toBeNull();
  });

  it("Test 4: PKCE failure (verifier sha256 != stored challenge) returns 400 pkce_verification_failed", async () => {
    const body = {
      code: "github-auth-code",
      state: STATE,
      code_verifier: "x".repeat(50), // wrong verifier, valid length
      machine_id: "PHASE1_SMOKE_MACHINE",
    };
    const res = await attachCallbackApp.request(
      "/api/daemons/attach-callback",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(400);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe("pkce_verification_failed");

    // No DB writes on PKCE failure.
    const writes = mockHandle.calls.filter((c) => /INSERT|UPDATE/i.test(c.sql));
    expect(writes).toHaveLength(0);
  });

  it("Test 5: state miss (KV expired) returns 400 invalid_or_expired_state", async () => {
    kv.clear();
    const body = {
      code: "github-auth-code",
      state: STATE,
      code_verifier: PKCE_VERIFIER,
      machine_id: "PHASE1_SMOKE_MACHINE",
    };
    const res = await attachCallbackApp.request(
      "/api/daemons/attach-callback",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(400);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe("invalid_or_expired_state");
  });

  it("Test 6: backfills ai_events.user_id WHERE org_id + hostname match AND user_id IS NULL (one-shot, D-15)", async () => {
    // Record how many rows the UPDATE affected via the handler (the default
    // happy-path handler returns rowCount = 5).
    let backfillRowCount = 0;
    mockHandle.setHandler((sql) => {
      if (/INSERT\s+INTO\s+users/i.test(sql)) return { rows: [{ id: RESOLVED_USER_ID }], rowCount: 1 };
      if (/INSERT\s+INTO\s+org_members/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT\s+id,\s*hostname\s+FROM\s+daemon_machines/i.test(sql))
        return { rows: [{ id: TEST_MACHINE, hostname: "phase1-host" }], rowCount: 1 };
      if (/UPDATE\s+daemon_machines/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/UPDATE\s+ai_events/i.test(sql)) {
        backfillRowCount = 5;
        return { rows: [], rowCount: 5 };
      }
      if (/INSERT\s+INTO\s+daemon_audit_events/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const body = {
      code: "github-auth-code",
      state: STATE,
      code_verifier: PKCE_VERIFIER,
      machine_id: "PHASE1_SMOKE_MACHINE",
    };
    const res = await attachCallbackApp.request(
      "/api/daemons/attach-callback",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(backfillRowCount).toBe(5);

    // Verify the backfill SQL filters on org_id + hostname + user_id IS NULL.
    const backfillCall = mockHandle.calls.find((c) => /UPDATE\s+ai_events/i.test(c.sql));
    expect(backfillCall?.sql).toMatch(/user_id IS NULL/);
    expect(backfillCall?.sql).toMatch(/hostname = \$2/);
    expect(backfillCall?.sql).toMatch(/org_id = \$1/);
    // The params include the resolved user_id at position 3.
    expect(backfillCall?.params).toEqual([TEST_ORG, "phase1-host", RESOLVED_USER_ID]);
  });

  it("Test 7: backfill does NOT touch events for a different hostname (SQL filter, not handler logic)", async () => {
    // The backfill SQL filters by hostname; this is verified above (Test 6's
    // parameters). The Phase-1 implementation MUST NOT pass a wildcard hostname.
    const body = {
      code: "github-auth-code",
      state: STATE,
      code_verifier: PKCE_VERIFIER,
      machine_id: "PHASE1_SMOKE_MACHINE",
    };
    await attachCallbackApp.request(
      "/api/daemons/attach-callback",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    const backfillCall = mockHandle.calls.find((c) => /UPDATE\s+ai_events/i.test(c.sql));
    expect(backfillCall?.sql).not.toContain("%");
    expect(backfillCall?.sql).not.toContain("LIKE");
    // The hostname parameter must be the exact daemon_machine.hostname.
    expect(backfillCall?.params[1]).toBe("phase1-host");
  });
});
