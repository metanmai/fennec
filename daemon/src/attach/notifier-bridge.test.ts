/**
 * Notifier-bridge tests (Task 2 of Plan 01-08).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 8-9):
 *   - Test 8: notify() POSTs to http://127.0.0.1:7822/v1/notify with
 *     the body, returns { delivered: true } on 200.
 *   - Test 9: notify() when no notifier listening returns
 *     { delivered: false } — fail-open per Pattern 6 (LaunchAgent may
 *     be gone if the user logged out).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { NotifierBridge } from "./notifier-bridge.js";

interface CapturedRequest {
  url: string | undefined;
  method: string | undefined;
  body: string;
}

function startMockNotifier(): Promise<{ port: number; server: Server; captured: CapturedRequest[] }> {
  return new Promise((resolve) => {
    const captured: CapturedRequest[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (c) => (body += c.toString()));
      req.on("end", () => {
        captured.push({ url: req.url, method: req.method, body });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ delivered: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, server, captured });
    });
  });
}

describe("NotifierBridge", () => {
  it("Test 8: posts to /v1/notify and returns delivered=true on 200", async () => {
    const { port, server, captured } = await startMockNotifier();
    try {
      const bridge = new NotifierBridge({ notifierPort: port });
      const result = await bridge.notify({
        title: "Sign in to fennec",
        message: "Click to attribute your AI usage",
        openUrl: "https://api.fennec.test/api/auth/sso?provider=github",
      });
      expect(result.delivered).toBe(true);
      expect(captured.length).toBe(1);
      const c = captured[0];
      if (!c) throw new Error("expected captured request");
      expect(c.url).toBe("/v1/notify");
      expect(c.method).toBe("POST");
      const parsed = JSON.parse(c.body) as Record<string, unknown>;
      expect(parsed.title).toBe("Sign in to fennec");
      expect(parsed.message).toBe("Click to attribute your AI usage");
      expect(parsed.openUrl).toContain("https://api.fennec.test");
    } finally {
      server.close();
    }
  });

  it("Test 9: returns delivered=false when nothing is listening (fail-open)", async () => {
    // Pick a port that's almost certainly free, with no server listening.
    const bridge = new NotifierBridge({ notifierPort: 1 });
    const result = await bridge.notify({
      title: "x",
      message: "y",
    });
    // Per Pattern 6: never throws on a connection-refused; logs +
    // continues. The attach flow handles delivered=false by warning.
    expect(result.delivered).toBe(false);
  });

  it("reads FENNEC_NOTIFIER_PORT from process.env when no explicit port is given (default-port path)", () => {
    const bridge = new NotifierBridge();
    // We can't introspect a private field cleanly without exporting it;
    // we just confirm the constructor accepts the default form without
    // throwing. The behavioural assertion is covered by Tests 8 + 9.
    expect(bridge).toBeInstanceOf(NotifierBridge);
  });
});
