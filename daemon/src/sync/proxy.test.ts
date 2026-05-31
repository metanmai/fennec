/**
 * Proxy + extra CA detection tests (Task 3 of Plan 01-06; DAE-10 /
 * Pitfall 13).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 9, 10):
 *  - Test 9: NODE_EXTRA_CA_CERTS detection (Node honors natively;
 *    daemon only needs to report it was seen, in heartbeat metadata)
 *  - Test 10: HTTPS_PROXY → daemon constructs undici ProxyAgent + the
 *    dispatcher surfaces in buildFetchOptions output
 */

import { describe, expect, it } from "vitest";
import { buildFetchOptions, detectExtraCaCerts, detectHttpsProxy } from "./proxy.js";

describe("detectExtraCaCerts", () => {
  it("reports detected=true when NODE_EXTRA_CA_CERTS is set", () => {
    const result = detectExtraCaCerts({ NODE_EXTRA_CA_CERTS: "/etc/ssl/corp-ca.pem" });
    expect(result.detected).toBe(true);
    expect(result.path).toBe("/etc/ssl/corp-ca.pem");
  });

  it("reports detected=false when NODE_EXTRA_CA_CERTS is unset", () => {
    const result = detectExtraCaCerts({});
    expect(result.detected).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it("reports detected=false for an empty-string NODE_EXTRA_CA_CERTS", () => {
    const result = detectExtraCaCerts({ NODE_EXTRA_CA_CERTS: "" });
    expect(result.detected).toBe(false);
  });
});

describe("detectHttpsProxy", () => {
  it("detects uppercase HTTPS_PROXY", () => {
    const result = detectHttpsProxy({ HTTPS_PROXY: "http://corp-proxy:3128" });
    expect(result.detected).toBe(true);
    expect(result.url).toBe("http://corp-proxy:3128");
  });

  it("detects lowercase https_proxy", () => {
    const result = detectHttpsProxy({ https_proxy: "http://lowercase:3128" });
    expect(result.detected).toBe(true);
    expect(result.url).toBe("http://lowercase:3128");
  });

  it("prefers HTTPS_PROXY over https_proxy when both are set", () => {
    const result = detectHttpsProxy({
      HTTPS_PROXY: "http://upper:3128",
      https_proxy: "http://lower:3128",
    });
    expect(result.url).toBe("http://upper:3128");
  });

  it("reports detected=false when neither is set", () => {
    const result = detectHttpsProxy({});
    expect(result.detected).toBe(false);
    expect(result.url).toBeUndefined();
  });
});

describe("buildFetchOptions", () => {
  it("returns an empty object when no proxy is configured", async () => {
    const opts = await buildFetchOptions({});
    expect(opts).toEqual({});
  });

  it("constructs a Dispatcher when HTTPS_PROXY is set", async () => {
    const opts = await buildFetchOptions({ HTTPS_PROXY: "http://corp-proxy:3128" });
    // We don't introspect the ProxyAgent's internals — we just confirm
    // a dispatcher object was produced (undici's ProxyAgent constructor
    // doesn't actually connect until a fetch fires through it).
    expect(opts.dispatcher).toBeDefined();
    expect(opts.dispatcher).not.toBeNull();
  });

  it("constructs a Dispatcher when lowercase https_proxy is set", async () => {
    const opts = await buildFetchOptions({ https_proxy: "http://corp-proxy:3128" });
    expect(opts.dispatcher).toBeDefined();
  });
});
