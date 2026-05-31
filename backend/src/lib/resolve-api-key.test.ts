import type { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApiKey } from "./resolve-api-key.js";

/**
 * Unit tests for `resolveApiKey`.
 *
 * W-2 RESOLUTION (Plan 01-05): integration tests against a live Hyperdrive
 * + Supabase Postgres are deferred to Plan 01-10 smoke test. These unit tests
 * exercise the lookup against an injected `pg.Client`-shaped mock so the
 * suite is hermetic and runnable in CI without a database.
 *
 * Plan 01-10's smoke proves the SAME hash matches the seeded row in real
 * Postgres -- the `hash.test.ts` precomputed expected value is the contract.
 */

type QueryRow = { api_key_id: string; org_id: string; daemon_machine_id: string; hostname: string };

interface MockClient {
  query: ReturnType<typeof vi.fn>;
}

function buildMockClient(rows: QueryRow[]): { client: Client; mock: MockClient } {
  // We only stub the `query` method that the queries module touches. The
  // remaining `pg.Client` surface (connect, end, etc.) is unused on this path,
  // so we cast through `unknown` rather than implementing 30 fields.
  const mock: MockClient = {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  };
  return { client: mock as unknown as Client, mock };
}

// Minimal stub Env -- resolveApiKey only reads HYPERDRIVE.connectionString IF
// no client is passed; the unit tests below always inject a client so this
// surface is never touched. The cast keeps the type-check honest.
const stubEnv = {
  HYPERDRIVE: { connectionString: "postgresql://stub/disabled" } as unknown as Hyperdrive,
} as unknown as Parameters<typeof resolveApiKey>[1];

const SEEDED_TOKEN = "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd";
const SEEDED_HASH = "42e56dcc783aaa5fcce745d0167f51726a49cad1801c25f8e69f21f0d65961ed";

const SEEDED_ROW: QueryRow = {
  api_key_id: "00000000-0000-0000-0000-000000000005",
  org_id: "00000000-0000-0000-0000-000000000001",
  daemon_machine_id: "00000000-0000-0000-0000-000000000004",
  hostname: "phase1-host",
};

describe("resolveApiKey (unit, with injected client)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the resolved metadata for the seeded Phase 1 API key", async () => {
    const { client, mock } = buildMockClient([SEEDED_ROW]);
    const result = await resolveApiKey(SEEDED_TOKEN, stubEnv, client);

    expect(result).toEqual(SEEDED_ROW);

    // Verify the query was parameterised with the sha256-hex of the bearer
    // token (NOT the raw token) -- threat T-05-01 + T-05-04 mitigation.
    expect(mock.query).toHaveBeenCalledTimes(1);
    const queryArgs = mock.query.mock.calls[0];
    expect(queryArgs).toBeDefined();
    const params = queryArgs?.[1] as unknown[];
    expect(params).toEqual([SEEDED_HASH]);
  });

  it("returns null when the token is unknown (no matching active key)", async () => {
    const { client, mock } = buildMockClient([]);
    const result = await resolveApiKey("wrong_token_does_not_exist_xxxxxxxxxxxxxxxxxxxxxx", stubEnv, client);

    expect(result).toBeNull();
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  it("returns null after the matching key is revoked (the JOIN-with-revoked-filter returns 0 rows)", async () => {
    // Simulates the scenario: the same token was valid earlier, was then
    // revoked (e.g. by /api/daemons/uninstall), and now the partial-index
    // filtered query returns zero rows for the same hash.
    const { client } = buildMockClient([]);
    const result = await resolveApiKey(SEEDED_TOKEN, stubEnv, client);
    expect(result).toBeNull();
  });

  it("computes the SAME sha256 hash regardless of how many times it is called for the same token", async () => {
    const { client, mock } = buildMockClient([SEEDED_ROW]);
    await resolveApiKey(SEEDED_TOKEN, stubEnv, client);
    await resolveApiKey(SEEDED_TOKEN, stubEnv, client);

    const params1 = mock.query.mock.calls[0]?.[1] as unknown[];
    const params2 = mock.query.mock.calls[1]?.[1] as unknown[];
    expect(params1).toEqual(params2);
    expect(params1?.[0]).toBe(SEEDED_HASH);
  });

  it("uses the JOIN-with-daemon_machines query (includes hostname)", async () => {
    const { client, mock } = buildMockClient([SEEDED_ROW]);
    await resolveApiKey(SEEDED_TOKEN, stubEnv, client);

    const sql = mock.query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/FROM api_keys/i);
    expect(sql).toMatch(/JOIN daemon_machines/i);
    expect(sql).toMatch(/revoked_at IS NULL/i);
    expect(sql).toMatch(/m\.hostname/i);
  });
});

describe("resolveApiKey (logging / security surface)", () => {
  it("never spreads the raw bearer token into the query parameter array", async () => {
    const { client, mock } = buildMockClient([SEEDED_ROW]);
    await resolveApiKey(SEEDED_TOKEN, stubEnv, client);

    const params = mock.query.mock.calls[0]?.[1] as unknown[];
    // The first parameter must be the hex hash; the raw token must NOT appear.
    expect(params?.[0]).toBe(SEEDED_HASH);
    expect(JSON.stringify(params)).not.toContain(SEEDED_TOKEN);
  });
});
