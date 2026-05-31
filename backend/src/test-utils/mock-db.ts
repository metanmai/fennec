/**
 * In-memory `pg.Client`-shaped mock for unit tests.
 *
 * Per W-2 mitigation (Plan 01-05): integration tests against a live
 * Hyperdrive/Postgres are deferred to Plan 01-10. This mock lets the
 * handler tests exercise the SQL path symbolically: it records every
 * call to `client.query`, returns canned rows by SQL fragment match,
 * and gives tests a per-call inspector for parameter arrays + SQL text.
 *
 * The mock is intentionally NOT a SQL engine. It uses crude fragment
 * matching against the queries' first-line patterns -- enough to exercise
 * the upsert / SELECT branches without re-implementing Postgres. Tests
 * that need richer behaviour register a custom matcher.
 */

import type { Client } from "pg";
import { type MockInstance, vi } from "vitest";

export type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number };

export interface MockClientHandle {
  client: Client;
  query: MockInstance;
  /** Convenience: every (sql, params) pair the handler observed, in order. */
  calls: Array<{ sql: string; params: unknown[] }>;
  /** Replace the default `() => ({ rows: [] })` handler. */
  setHandler: (handler: QueryHandler) => void;
}

export function createMockClient(initialHandler?: QueryHandler): MockClientHandle {
  let handler: QueryHandler = initialHandler ?? (() => ({ rows: [] }));
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    return { rows: out.rows, rowCount: out.rowCount ?? out.rows.length };
  });

  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query,
  } as unknown as Client;

  return {
    client,
    query: query as unknown as MockInstance,
    calls,
    setHandler: (h) => {
      handler = h;
    },
  };
}

/**
 * Stub Env. Only HYPERDRIVE.connectionString is referenced by the queries
 * layer; KV + OAuth secrets are filled in test-by-test as needed.
 */
export function stubEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    HYPERDRIVE: { connectionString: "postgresql://stub/disabled" } as unknown as Hyperdrive,
    OAUTH_STATE_KV: createMockKv(),
    FENNEC_BASE_URL: "https://api.fennec.test",
    OAUTH_GOOGLE_CLIENT_ID: "google-client-id",
    OAUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
    OAUTH_GITHUB_CLIENT_ID: "github-client-id",
    OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
    OAUTH_MICROSOFT_CLIENT_ID: "microsoft-client-id",
    OAUTH_MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    ...overrides,
  };
}

export interface MockEnv {
  HYPERDRIVE: Hyperdrive;
  OAUTH_STATE_KV: KVNamespace;
  FENNEC_BASE_URL: string;
  OAUTH_GOOGLE_CLIENT_ID: string;
  OAUTH_GOOGLE_CLIENT_SECRET: string;
  OAUTH_GITHUB_CLIENT_ID: string;
  OAUTH_GITHUB_CLIENT_SECRET: string;
  OAUTH_MICROSOFT_CLIENT_ID: string;
  OAUTH_MICROSOFT_CLIENT_SECRET: string;
}

/**
 * Minimal `KVNamespace`-shaped in-memory store. Honours `expirationTtl` only
 * to the extent of recording it; tests can read it back via `getMeta`.
 */
export interface MockKv extends KVNamespace {
  getMeta: (key: string) => { value: string; expirationTtl?: number } | null;
  clear: () => void;
}

export function createMockKv(): MockKv {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: options?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      const keys = Array.from(store.keys()).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
    getMeta(key: string) {
      return store.get(key) ?? null;
    },
    clear() {
      store.clear();
    },
  } as unknown as MockKv;
  return kv;
}
