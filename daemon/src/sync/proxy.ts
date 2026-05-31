/**
 * Corporate-proxy + TLS bundle support (DAE-10 / Pitfall 13 / threat
 * T-06-07).
 *
 * Two env vars matter:
 *
 *   - NODE_EXTRA_CA_CERTS — Node 22 honors this NATIVELY. The path
 *     points at a PEM file with extra trust roots that get unioned
 *     into the default TLS trust store at boot. No code needed in
 *     the daemon for this to work; we only LOG that we noticed.
 *
 *   - HTTPS_PROXY — Node 22's global undici fetch does NOT honor
 *     this automatically. We need to construct an `undici.ProxyAgent`
 *     and pass it via the `dispatcher` option on every fetch call.
 *     The `buildFetchOptions()` helper produces that dispatcher (or
 *     an empty object) based on the env.
 *
 * Threat: a corporate Netskope/Zscaler middlebox terminates TLS with
 * a self-signed CA; without honoring NODE_EXTRA_CA_CERTS the daemon
 * fails to handshake; without honoring HTTPS_PROXY the daemon fails
 * to route. Both env vars are the standard escape hatch for
 * enterprise deployments per Pitfall 13.
 */

/**
 * Detection-only check for NODE_EXTRA_CA_CERTS. Returns true when set.
 * Node honors the env var natively at startup — no daemon code needed
 * beyond noting we detected it (heartbeats include this status so the
 * backend can confirm the daemon is correctly trusting the corp CA).
 */
export function detectExtraCaCerts(env: NodeJS.ProcessEnv = process.env): {
  detected: boolean;
  path: string | undefined;
} {
  const path = env.NODE_EXTRA_CA_CERTS;
  return { detected: typeof path === "string" && path.length > 0, path };
}

/**
 * Detection of HTTPS_PROXY config. The actual `undici.ProxyAgent`
 * instantiation lives in `buildFetchOptions` below — kept separate so
 * tests can assert detection without instantiating the agent.
 */
export function detectHttpsProxy(env: NodeJS.ProcessEnv = process.env): {
  detected: boolean;
  url: string | undefined;
} {
  const url = env.HTTPS_PROXY ?? env.https_proxy;
  return { detected: typeof url === "string" && url.length > 0, url };
}

/**
 * Construct the per-fetch options that route through HTTPS_PROXY when
 * set. Returns `{ dispatcher: ProxyAgent }` for the proxy case, or an
 * empty object otherwise.
 *
 * The HTTPS_PROXY (uppercase) variant is checked first per RFC standard;
 * the lowercase `https_proxy` is also recognised because the curl
 * convention is widely used.
 *
 * `undici` is imported dynamically: the daemon doesn't declare it as
 * a direct dep (per threat T-06-SC — "no new npm install of external
 * packages") and relies on Node 22's bundled undici / the
 * workspace-hoisted version from backend. If the import fails at
 * runtime, we return empty options with a logged warning rather than
 * crash — fail-open per Pitfall 13's "corporate proxy compatibility"
 * stance.
 */
export async function buildFetchOptions(
  env: NodeJS.ProcessEnv = process.env,
  // biome-ignore lint/suspicious/noExplicitAny: Dispatcher is an undici-specific type; using any keeps the daemon free of a direct undici dep
): Promise<{ dispatcher?: any }> {
  const proxyUrl = env.HTTPS_PROXY ?? env.https_proxy;
  if (!proxyUrl || proxyUrl.length === 0) return {};

  try {
    // Dynamic import keeps the bundle/typecheck clean when undici is
    // not declared as a direct daemon dep.
    const { ProxyAgent } = (await import("undici")) as {
      ProxyAgent: new (url: string) => unknown;
    };
    const dispatcher = new ProxyAgent(proxyUrl);
    return { dispatcher };
  } catch (err) {
    // undici unavailable — log and fall back to direct fetch. The
    // daemon will likely fail to reach the backend (the corporate
    // proxy will refuse direct connections), but we surface this in
    // the heartbeat's daemon_unreachable_count and don't crash.
    console.warn("HTTPS_PROXY set but undici ProxyAgent unavailable:", err);
    return {};
  }
}
