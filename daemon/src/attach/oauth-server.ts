/**
 * One-shot OAuth callback server (Plan 01-08 Task 2, Pattern 10).
 *
 * AUTH-16's loopback redirect URI per RFC 8252 §7.3: native apps using
 * OAuth 2.0 should bind a server on `127.0.0.1` (loopback only, NEVER
 * a wildcard-bound interface) at a random ephemeral port, advertise
 * that URL as the OAuth provider's `redirect_uri`, await the provider's
 * GET callback once, then shut down. This is the canonical pattern
 * Tailscale, 1Password CLI, and the GitHub CLI all use.
 *
 * Threat model anchors:
 *   - T-08-04 (malicious local process races the daemon for port): the
 *     random ephemeral port (via listen(0)) means the attacker must win
 *     a race between the daemon's port assignment and the daemon's
 *     subsequent connect. The `state` parameter (added in attach.ts)
 *     is the load-bearing CSRF defence regardless.
 *   - T-08-03 (code interception): the response page is short and
 *     contains no script; it just tells the user the flow completed.
 *
 * Timeout: 5 minutes (300_000 ms) per RFC 8252 §8.6 guidance — long
 * enough for the user to click through SSO + 2FA on a slow browser
 * but short enough that an abandoned attach attempt doesn't hold the
 * port forever. Tests override this via `opts.timeoutMs`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = "Sign-in complete. You can close this tab.";

export interface OneShotOAuthServerOptions {
  /** Override the timeout for tests. Production uses the 5-min default. */
  timeoutMs?: number;
}

export interface OAuthCallback {
  code: string;
  state: string;
}

export interface OneShotOAuthServerStartResult {
  port: number;
  callbackUrl: string;
  awaitCode: Promise<OAuthCallback>;
}

export class OneShotOAuthServer {
  private server?: Server;
  private resolver?: (v: OAuthCallback) => void;
  private rejecter?: (e: Error) => void;
  private settled = false;
  private timer?: NodeJS.Timeout;
  private readonly timeoutMs: number;

  constructor(opts: OneShotOAuthServerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(): Promise<OneShotOAuthServerStartResult> {
    const awaitCode = new Promise<OAuthCallback>((resolve, reject) => {
      this.resolver = resolve;
      this.rejecter = reject;
    });

    this.server = createServer((req, res) => this.handle(req, res));

    // EXPLICIT 127.0.0.1 — loopback only, never a wildcard (T-08-04).
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = this.server.address() as AddressInfo;
    const port = addr.port;
    const callbackUrl = `http://127.0.0.1:${port}/callback`;

    this.timer = setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.rejecter?.(new Error("oauth_attach_timeout"));
      }
      this.stop();
    }, this.timeoutMs);

    return { port, callbackUrl, awaitCode };
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "";
    if (url.startsWith("/callback")) {
      // Parse the query string for code+state. We never trust the host
      // header (the URL constructor needs SOMETHING; we use the literal
      // loopback host since that's the only place this server runs).
      const parsed = new URL(url, "http://127.0.0.1");
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");

      if (code && state) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(SUCCESS_HTML);
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        if (!this.settled) {
          this.settled = true;
          this.resolver?.({ code, state });
        }
        // Defer stop() to the next tick so the response actually
        // flushes — closing too eagerly truncates the body the user
        // sees in their browser.
        setImmediate(() => this.stop());
        return;
      }
      // Missing params → 400, no resolve.
      res.statusCode = 400;
      res.end("missing code or state");
      return;
    }
    // Anything else → 404, no resolve.
    res.statusCode = 404;
    res.end("not found");
  }

  /**
   * Tear down the server. If `awaitCode` is still pending (caller is
   * stopping early — test cleanup, daemon shutdown), reject it with
   * `oauth_attach_stopped` so the awaiter sees a clean failure instead
   * of a dangling promise.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.settled) {
      this.settled = true;
      this.rejecter?.(new Error("oauth_attach_stopped"));
    }
    this.server?.close();
    this.server = undefined;
  }
}
