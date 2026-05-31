/**
 * NotifierBridge — daemon → Helper LaunchAgent IPC (Plan 01-08 Task 2,
 * DAE-20, D-14, Pattern 6 in 01-RESEARCH.md).
 *
 * Why this exists: macOS LaunchDaemons run as root and have NO GUI
 * session (Pitfall 3). They cannot:
 *   - call `osascript display notification` (fails silently)
 *   - call `open <url>` (fails silently)
 *   - touch any user-session resource (Aqua dock, menubar, browser)
 *
 * The Helper LaunchAgent (built in Task 3) runs in the user-session
 * via /Library/LaunchAgents/com.fennec.notifier.plist, talks to the
 * GUI, and exposes `POST /v1/notify` on 127.0.0.1:7822 for the daemon
 * to call. The daemon's role is to POST a notification request; the
 * Helper Agent then displays it and (optionally) opens a URL.
 *
 * Threat model anchors:
 *   - T-08-08 (notifier executes arbitrary commands via /v1/notify):
 *     the notifier (Task 3) treats `openUrl` as an argv-array argument
 *     to `/usr/bin/open` — no shell expansion. Safe for arbitrary URLs.
 *   - T-08-09 (notifier impersonation by non-fennec process binding
 *     7822): accepted Phase 1 risk; same-user processes could already
 *     imitate. Future phases may add a notifier-secret per install.
 *
 * Fail-open semantics: if the user is logged out, the LaunchAgent has
 * been killed; the POST fails with ECONNREFUSED. We return
 * `{ delivered: false }` and let the caller decide what to do — for
 * the attach flow that means logging a warning and still waiting on
 * the OAuth callback (the user may have a previous browser tab open).
 */

const DEFAULT_NOTIFIER_PORT = 7822;

export interface NotifierBridgeOptions {
  notifierPort?: number;
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

export interface NotifyInput {
  title: string;
  message: string;
  /** Optional URL the notifier should open in the default browser. */
  openUrl?: string;
}

export interface NotifyResult {
  delivered: boolean;
}

export class NotifierBridge {
  private readonly notifierPort: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: NotifierBridgeOptions = {}) {
    const envPort = process.env.FENNEC_NOTIFIER_PORT;
    this.notifierPort = opts.notifierPort ?? (envPort ? Number(envPort) : DEFAULT_NOTIFIER_PORT);
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const url = `http://127.0.0.1:${this.notifierPort}/v1/notify`;
    try {
      const resp = await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (resp.ok) {
        return { delivered: true };
      }
      // Non-2xx → notifier is up but couldn't deliver (e.g. the Aqua
      // session is locked). Treat as delivered=false; the daemon
      // proceeds and waits for the OAuth callback regardless.
      return { delivered: false };
    } catch {
      // Connection refused / ENOTCONN / timeout — notifier is gone.
      // Fail-open per Pattern 6: never throw, return delivered: false.
      return { delivered: false };
    }
  }
}
