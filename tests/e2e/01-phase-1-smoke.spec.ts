import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";

/**
 * Phase 1 end-to-end smoke spec — implements the automatable portions
 * of ROADMAP Phase 1 success criteria.
 *
 * RUN CONTEXT
 * -----------
 * This spec REQUIRES real infrastructure provisioned in Plan 01-10:
 *
 *   - Supabase project with all 7 migrations applied (Task 2 of 01-10)
 *   - Cloudflare Worker deployed at FENNEC_API_URL (Task 3 of 01-10)
 *   - Signed + notarised fennec.pkg installed on this machine via
 *     `sudo installer -pkg installer/build/fennec.pkg -target /` (Task 4)
 *   - `sudo fennec wizard` completed with FENNEC_TEST_INSTALL_SECRET
 *     pasted so the LaunchDaemon is loaded + the api_key is at
 *     /var/db/fennec/key (Task 4)
 *
 * Without those, the spec halts at the first health check with a
 * clear error pointing the operator at tests/e2e/README.md.
 *
 * REQUIRED ENV
 *   FENNEC_API_URL                       e.g. https://fennec-backend.<account>.workers.dev
 *   SUPABASE_URL                         e.g. https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY            service_role key (smoke-test reads ai_events)
 *
 * OPTIONAL ENV
 *   FENNEC_DAEMON_LOOPBACK_URL           default http://127.0.0.1:7821
 *   FENNEC_SHIM_SECRET_PATH              default /etc/fennec/shim-secret
 *   FENNEC_TEST_TIMEOUT_MS               default 300000 (5 minutes)
 *
 * See tests/e2e/README.md for the full setup checklist.
 */

const DEFAULT_DAEMON_URL = "http://127.0.0.1:7821";
const DEFAULT_SHIM_SECRET_PATH = "/etc/fennec/shim-secret";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 90 * 1000;
const IDEMPOTENCY_OBSERVATION_MS = 30 * 1000;
const POLL_INTERVAL_MS = 10 * 1000;

interface SmokeEnv {
  apiUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  daemonUrl: string;
  shimSecret: string;
  rowTimeoutMs: number;
}

function loadEnv(): SmokeEnv {
  const apiUrl = process.env.FENNEC_API_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const daemonUrl = process.env.FENNEC_DAEMON_LOOPBACK_URL ?? DEFAULT_DAEMON_URL;
  const secretPath = process.env.FENNEC_SHIM_SECRET_PATH ?? DEFAULT_SHIM_SECRET_PATH;
  const rowTimeoutMs = Number.parseInt(process.env.FENNEC_TEST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);

  if (!apiUrl) throw missingEnvError("FENNEC_API_URL");
  if (!supabaseUrl) throw missingEnvError("SUPABASE_URL");
  if (!serviceRoleKey) throw missingEnvError("SUPABASE_SERVICE_ROLE_KEY");

  let shimSecret: string;
  try {
    shimSecret = readFileSync(secretPath, "utf8").trim();
  } catch (err) {
    throw new Error(
      `Could not read shim secret from ${secretPath}: ${(err as Error).message}\n` +
        "On macOS, the postinstall script writes this to /etc/fennec/shim-secret\n" +
        "with mode 0644. If the file does not exist, the signed .pkg has not\n" +
        "been installed (see tests/e2e/README.md → Step 4).",
    );
  }

  return { apiUrl, supabaseUrl, serviceRoleKey, daemonUrl, shimSecret, rowTimeoutMs };
}

function missingEnvError(name: string): Error {
  return new Error(
    `Missing required env var: ${name}.\n` +
      "See tests/e2e/README.md for the full env checklist. This spec is\n" +
      "designed for the Phase 1 smoke test in Plan 01-10 and requires real\n" +
      "Supabase + Cloudflare + macOS daemon infrastructure to run.",
  );
}

interface HookPayload {
  session_id: string;
  hook_event_name: string;
  prompt: string;
  cwd: string;
  transcript_path: string;
}

function buildHookPayload(prompt: string): HookPayload {
  return {
    session_id: "smoke-test",
    hook_event_name: "UserPromptSubmit",
    prompt,
    cwd: "/tmp",
    transcript_path: "/tmp/transcript.jsonl",
  };
}

async function postHook(env: SmokeEnv, payload: HookPayload): Promise<Response> {
  const res = await fetch(`${env.daemonUrl}/v1/hook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fennec-Shim-Secret": env.shimSecret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`daemon /v1/hook returned ${res.status}: ${body}`);
  }
  return res;
}

interface SupabasePollOptions {
  table: string;
  /** Postgrest filter, e.g. `payload->>prompt_text=ilike.*UUID*` */
  filter: string;
  timeoutMs: number;
}

/** Poll Supabase REST until at least one row matches or timeout. */
async function pollForRow(env: SmokeEnv, opts: SupabasePollOptions): Promise<Record<string, unknown> | null> {
  const url = `${env.supabaseUrl}/rest/v1/${opts.table}?${opts.filter}&select=*&limit=1`;
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Accept-Profile": "public",
  };
  const startedAt = Date.now();
  while (Date.now() - startedAt < opts.timeoutMs) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const rows = (await res.json()) as Record<string, unknown>[];
      const first = rows[0];
      if (first !== undefined) return first;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

/**
 * Step 1-2: backend + daemon health checks. These prove the entire
 * pipeline is reachable before we start firing real hooks.
 */
test("phase 1 smoke: prompt in Claude Code → ai_events row", async () => {
  test.setTimeout(15 * 60 * 1000);
  const env = loadEnv();

  // Step 1 — backend /health
  const backendHealth = await fetch(`${env.apiUrl}/health`);
  if (backendHealth.status !== 200) {
    throw new Error(
      `backend /health returned ${backendHealth.status} (expected 200). ` +
        `Is the Worker deployed at ${env.apiUrl}? See tests/e2e/README.md → Step 3.`,
    );
  }

  // Step 2 — daemon /v1/health
  const daemonHealth = await fetch(`${env.daemonUrl}/v1/health`);
  if (daemonHealth.status !== 200) {
    throw new Error(
      `daemon /v1/health returned ${daemonHealth.status} (expected 200). ` +
        "Is the fennec LaunchDaemon loaded? Run `sudo launchctl list | grep fennec`.",
    );
  }

  // Step 3 — inject a hook with a unique uuid for grep-ability
  const uuid = randomUUID();
  const prompt = `Hello fennec smoke test ${uuid}`;
  await postHook(env, buildHookPayload(prompt));

  // Step 4 — poll Supabase for the row
  const filter = `payload->>prompt_text=ilike.*${uuid}*`;
  const row = await pollForRow(env, {
    table: "ai_events",
    filter,
    timeoutMs: env.rowTimeoutMs,
  });
  if (row === null) {
    throw new Error(
      `ai_events row for uuid=${uuid} did not arrive within ${env.rowTimeoutMs}ms. ` +
        "Check daemon logs at /var/log/fennec/daemon.log and adapter_heartbeats " +
        "in Supabase for parse_errors > 0.",
    );
  }

  // Step 5 — assert per-row invariants
  if (row.org_id !== "00000000-0000-0000-0000-000000000001") {
    throw new Error(`ai_events row has wrong org_id: ${String(row.org_id)}`);
  }
  if (row.schema_version !== 1) {
    throw new Error(`ai_events row has wrong schema_version: ${String(row.schema_version)}`);
  }
  if (!row.redaction_applied_at) {
    throw new Error("ai_events row missing redaction_applied_at");
  }
  if (!row.redaction_version_hash) {
    throw new Error("ai_events row missing redaction_version_hash");
  }

  // Step 6 — idempotency: re-POST the same payload, expect still 1 row
  await postHook(env, buildHookPayload(prompt));
  await new Promise((r) => setTimeout(r, IDEMPOTENCY_OBSERVATION_MS));

  const countRes = await fetch(`${env.supabaseUrl}/rest/v1/ai_events?${filter}&select=*`, {
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      Prefer: "count=exact",
    },
  });
  const dedupeRows = (await countRes.json()) as unknown[];
  if (dedupeRows.length !== 1) {
    throw new Error(
      `idempotency check failed: expected 1 row, got ${dedupeRows.length}. ` +
        "ON CONFLICT (idempotency_key) DO NOTHING is not firing.",
    );
  }

  // Step 7 — heartbeat: adapter_heartbeats has events_parsed > 0
  const heartbeat = await pollForRow(env, {
    table: "adapter_heartbeats",
    filter: "adapter=eq.claude-code&order=received_at.desc",
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
  });
  if (heartbeat === null) {
    throw new Error("no adapter_heartbeat for claude-code within 90s");
  }
  if (!heartbeat.events_parsed || (heartbeat.events_parsed as number) < 1) {
    throw new Error(`adapter_heartbeat has events_parsed=${String(heartbeat.events_parsed)} (expected ≥ 1)`);
  }
  if (heartbeat.parse_errors && (heartbeat.parse_errors as number) > 0) {
    throw new Error(`adapter_heartbeat has parse_errors=${String(heartbeat.parse_errors)} (expected 0)`);
  }
  if (!heartbeat.schema_hash) {
    throw new Error("adapter_heartbeat missing schema_hash");
  }

  // Step 8 — canary redaction: paste a canary, assert it doesn't reach ai_events.payload
  const canary = "AKIAIOSFODNN7EXAMPLE";
  const canaryPrompt = `Smoke canary ${uuid} ${canary}`;
  await postHook(env, buildHookPayload(canaryPrompt));

  const canaryFilter = `payload->>prompt_text=ilike.*${uuid}*REDACTED*`;
  const canaryRow = await pollForRow(env, {
    table: "ai_events",
    filter: canaryFilter,
    timeoutMs: env.rowTimeoutMs,
  });
  if (canaryRow === null) {
    throw new Error("canary row never landed in ai_events");
  }
  const canaryPayloadStr = JSON.stringify(canaryRow.payload);
  if (canaryPayloadStr.includes(canary)) {
    throw new Error(`PRIV-01 LEAK: canary '${canary}' reached ai_events.payload — redactor failed`);
  }
  if (!canaryPayloadStr.includes("[REDACTED:")) {
    throw new Error("canary row has no [REDACTED:...] token — redactor did not stamp a replacement");
  }
});
