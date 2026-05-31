/**
 * Loopback bridge server (Plan 01-07 Task 3).
 *
 * Binds to `127.0.0.1` ONLY (never the wildcard interface). Accepts:
 *   - POST /v1/hook — authenticated via `X-Fennec-Shim-Secret`; parses
 *     the JSON body and emits a "hook" event with the parsed payload.
 *     The Claude Code adapter subscribes to this and normalises into
 *     CanonicalEvent inputs.
 *   - GET  /v1/health — health probe, returns 200 `{status:"ok"}`.
 *
 * Pattern 9 in 01-RESEARCH.md (Loopback IPC Security): the shim-secret
 * header is the trust boundary; same-UID processes can read the secret
 * file and forge requests, but that's accepted because they could
 * already write to the JSONL queue directly. The header guards against
 * cross-UID processes and external network probes (which can't reach
 * 127.0.0.1 anyway, but defense-in-depth).
 *
 * Threat model:
 *  - T-07-01 (spoofed hook posts) — mitigated by the secret header
 *  - T-07-03 (DoS) — keep handler synchronous + fast; the shim's 15ms
 *    budget means a slow bridge slows Claude Code's hot path
 *  - T-07-SC — node:http + node:events from stdlib; no new deps
 */

import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface LoopbackBridgeOptions {
  /** The expected X-Fennec-Shim-Secret header value. */
  shimSecret: string;
  /**
   * Optional logger — defaults to no-op so tests don't spam stdout.
   * In production the daemon wires this to its structured logger.
   */
  logger?: (...args: unknown[]) => void;
}

/**
 * Loopback HTTP bridge that brokers between the Go hook shim and the
 * Claude Code adapter. Extends EventEmitter so the adapter can subscribe
 * to "hook" events with the parsed payload.
 *
 * Events emitted:
 *   - "hook" (payload: unknown): a successful POST /v1/hook with valid
 *     auth + parseable JSON body. The adapter is expected to validate
 *     the payload shape downstream.
 */
export class LoopbackBridge extends EventEmitter {
  private readonly shimSecret: string;
  private readonly logger: (...args: unknown[]) => void;
  private httpServer: Server | null = null;

  constructor(opts: LoopbackBridgeOptions) {
    super();
    this.shimSecret = opts.shimSecret;
    this.logger = opts.logger ?? (() => {});
  }

  /**
   * Start listening on the supplied port. Pass `0` to let the kernel
   * pick an ephemeral port (handy for tests). The server is bound to
   * `127.0.0.1` explicitly — NEVER the wildcard interface — so external network
   * traffic can't reach this bridge regardless of host firewall.
   */
  async start(port: number): Promise<void> {
    if (this.httpServer) {
      throw new Error("LoopbackBridge already started");
    }

    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(port, "127.0.0.1", () => {
        this.httpServer?.off("error", reject);
        resolve();
      });
    });
  }

  /** Stop the server. Idempotent. */
  async stop(): Promise<void> {
    if (!this.httpServer) return;
    const server = this.httpServer;
    this.httpServer = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /**
   * Return the actually-bound address + port, or `null` if not listening.
   * Used by tests to discover the kernel-assigned ephemeral port.
   */
  address(): { host: string; port: number } | null {
    if (!this.httpServer) return null;
    const addr = this.httpServer.address();
    if (!addr || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // GET /v1/health
    if (req.method === "GET" && req.url === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // POST /v1/hook
    if (req.method === "POST" && req.url === "/v1/hook") {
      this.handleHookPost(req, res);
      return;
    }

    // Anything else → 404. Do not leak that we have any other routes.
    res.writeHead(404);
    res.end();
  }

  private handleHookPost(req: IncomingMessage, res: ServerResponse): void {
    // 1. Validate the shim-secret header BEFORE reading the body. Cheap
    //    rejection of unauthenticated traffic; never log the header
    //    value (per T-07-SC + T-06-06 — secrets must not be logged).
    const providedSecret = req.headers["x-fennec-shim-secret"];
    if (typeof providedSecret !== "string" || providedSecret !== this.shimSecret) {
      // Log the rejection with the source address so an admin tailing
      // the daemon log can spot a flood of forged attempts.
      this.logger("rejected-loopback-attempt", {
        remoteAddr: req.socket.remoteAddress,
        url: req.url,
      });
      res.writeHead(401);
      res.end();
      return;
    }

    // 2. Read the body fully, then parse as JSON.
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let parsed: unknown;
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        parsed = JSON.parse(raw);
      } catch (err) {
        // Malformed JSON. Don't echo the body or the error message
        // (could contain secrets the shim mistakenly forwarded).
        this.logger("loopback-bridge-malformed-json", { err: (err as Error).message });
        res.writeHead(400);
        res.end();
        return;
      }

      // 3. Emit the parsed payload synchronously. The adapter handler is
      //    async but we don't await it — the shim's 15ms budget means
      //    we MUST respond fast; the adapter does its own bookkeeping
      //    downstream.
      this.emit("hook", parsed);

      // 4. 202 — accepted, will process. The shim doesn't act on the
      //    code beyond logging, but 202 is semantically correct for
      //    fire-and-forget queue ingestion.
      res.writeHead(202);
      res.end();
    });
    req.on("error", (err) => {
      this.logger("loopback-bridge-request-error", { err: err.message });
      res.writeHead(400);
      res.end();
    });
  }
}
