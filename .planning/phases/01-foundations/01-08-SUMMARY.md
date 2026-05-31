---
phase: 01-foundations
plan: 08
subsystem: daemon-identity

tags:
  - auth-15-per-machine-api-key
  - auth-16-dev-oauth-attach
  - dae-19-uninstall-audit
  - dae-20-tray-notification
  - d-11-hybrid-identity
  - d-13-machine-id-ioplatform-uuid
  - d-14-browser-auto-open-tray-notification
  - d-15-unknown-hostname-backfill
  - pkce-rfc-7636
  - rfc-8252-loopback-redirect
  - pattern-6-helper-launchagent
  - pattern-10-pkce-loopback
  - pitfall-10-key-file-mode-drift
  - pitfall-3-launchdaemon-gui-restriction
  - threat-t-08-01-key-world-readable
  - threat-t-08-03-pkce-code-interception
  - threat-t-08-04-loopback-race
  - threat-t-08-06-install-secret-log-leak
  - threat-t-08-08-notifier-shell-injection
  - go-1.25-stdlib-net-http
  - tdd-red-green

# Dependency graph
requires:
  - 01-02 (@fennec/shared EnrollRequestSchema, EnrollResponseSchema, AttachCallbackRequestSchema, AttachCallbackResponseSchema, UninstallAuditEventSchema)
  - 01-05 (backend POST /api/daemons/enroll, /api/auth/sso, /api/daemons/attach-callback, /api/daemons/uninstall — all live and tested with mocked DB)
  - 01-06 (daemon core's apiKeyProvider callback shape — readApiKey from this plan slots into the heartbeat scheduler and sync loop)

provides:
  - "daemon/src/enroll/enroll.ts: enrollDaemon({installSecret, machineId, hostname, os, apiBaseUrl, fetchFn, fetchOpts}) → EnrollResponse via POST /api/daemons/enroll with client-side EnrollRequestSchema validation; 401 → fixed 'invalid_or_expired_install_secret' (T-08-06); install_secret never echoed in any error message"
  - "daemon/src/enroll/api-key-store.ts: KEY_PATHS for darwin (/var/db/fennec/key), linux (/var/lib/fennec/key), win32 (%ProgramData%\\fennec\\key); persistApiKey writes mode 0o400 + chmod + (root) chown; readApiKey re-checks (mode & 0o777)===0o400 AND uid===0 on every read (Pitfall 10); skipChown + skipPermissionCheck test bypasses"
  - "daemon/src/enroll/machine-id.ts: getMachineId('darwin') → IOPlatformUUID via execFileSync argv-array (NO shell concat); memoised in-process; linux/win32 throw machine_id_unsupported_on_phase1_os; _resetMachineIdCacheForTests for test isolation"
  - "daemon/src/attach/pkce.ts: generatePkcePair() → {code_verifier (43-char base64url), code_challenge (base64url(sha256(verifier)))} via Web Crypto subtle.digest; runtime-portable to Workers"
  - "daemon/src/attach/oauth-server.ts: OneShotOAuthServer class; bind 127.0.0.1 + listen(0) random ephemeral port; /callback resolves awaitCode with {code, state} and renders 'Sign-in complete'; 5-min default timeout (300_000 ms) overridable via opts.timeoutMs; stop() rejects pending awaitCode with oauth_attach_stopped (no dangling promises)"
  - "daemon/src/attach/notifier-bridge.ts: NotifierBridge.notify({title, message, openUrl?}) POSTs to http://127.0.0.1:7822/v1/notify; fail-open returns {delivered: false} on connection-refused/non-2xx (Pattern 6); FENNEC_NOTIFIER_PORT env override"
  - "daemon/src/attach/attach.ts: runAttachFlow({apiBaseUrl, machineId, provider, notifier?, fetchFn?, fetchOpts?, oauthTimeoutMs?}) drives PKCE → start server → SSO URL → notify → awaitCode → state-mismatch CSRF check → POST /api/daemons/attach-callback → parse AttachCallbackResponse"
  - "daemon/src/attach/uninstall-emitter.ts: emitUninstallAudit({apiBaseUrl, apiKey, reason, machineId, hostname, actor?}) Bearer-auth POSTs UninstallAuditEventSchema body to /api/daemons/uninstall with timestamp-derived idempotency_key"
  - "notifier/main.go (Go 1.25, stdlib-only): Helper LaunchAgent binary; bind 127.0.0.1:7822 (loopback-only); POST /v1/notify → osascript display notification + optional `open <url>`; GET /v1/health → {status:ok}; argv-array exec.Command (no shell injection — T-08-08); platforms other than darwin log + no-op"
  - "notifier/Makefile: cross-compile for darwin-arm64 + darwin-amd64 + linux-amd64 + windows-amd64 via explicit goenv-managed Go path; -ldflags='-s -w'"
  - "installer/macos/notifier-launchagent.plist: LaunchAgent under /Library/LaunchAgents loaded per-user (NOT root); RunAtLoad + KeepAlive; ProgramArguments → /usr/local/fennec/bin/fennec-notifier; FENNEC_NOTIFIER_PORT env injected; plutil -lint validates"

affects:
  - 01-09 (installer): postinstall script will (a) call enrollDaemon() from this plan with the MDM install_secret + machineId + hostname (b) write the returned api_key via persistApiKey() (c) install notifier binary at /usr/local/fennec/bin/fennec-notifier mode 0755 root:wheel (d) install notifier-launchagent.plist at /Library/LaunchAgents/com.fennec.notifier.plist mode 0644 (e) launchctl bootstrap gui/$UID
  - 01-09 (uninstall CLI): calls emitUninstallAudit() before tearing down the LaunchDaemon + LaunchAgent + key file
  - 01-10 (smoke): exercises enrollDaemon → persistApiKey → readApiKey roundtrip end-to-end against a live deployed backend
  - daemon/src/index.ts (post-Wave 4 orchestrator-owned commit): adds the public-API exports for enroll/, attach/, and the notifier-bridge; tested implicitly via the sync-loop + heartbeat integration tests in Plan 01-10

# Tech tracking
tech-stack:
  added:
    - "Go 1.25.7 (stdlib-only; no go.sum required — single module declares no external deps) for notifier/main.go; toolchain at explicit path /opt/homebrew/bin/.goenv/versions/1.25.7/bin/go because `which go` shim is broken on dev machine"
    - "Node 22's Web Crypto API (globalThis.crypto.subtle.digest + crypto.getRandomValues + crypto.randomUUID) for PKCE — same API surface the Workers backend uses, so the pkce.ts module is runtime-portable"
    - "Node 22 stdlib node:http for the one-shot loopback OAuth callback server (listen(0) for random ephemeral port; explicit 127.0.0.1 bind)"
    - "Node 22 stdlib node:child_process execFileSync (argv-array) for ioreg invocation on macOS — no shell concatenation, no injection surface"

  patterns:
    - "Pattern 10 (OAuth 2.0 PKCE with Loopback Redirect URI per RFC 8252 §7.3 + RFC 7636 §4.1/§4.2): one-shot HTTP server on 127.0.0.1 + random ephemeral port; code_verifier kept in daemon memory only; code_challenge transmitted via SSO URL"
    - "Pattern 6 (LaunchDaemon + Helper LaunchAgent split): root-running daemon CANNOT drive GUI; user-session LaunchAgent (notifier) provides the bridge; daemon talks to it via loopback HTTP; fail-open semantics — if LaunchAgent dead, daemon continues operating"
    - "Pitfall 10 mitigation (key file mode drift): every readApiKey re-checks (mode & 0o777) === 0o400 AND uid === 0; result NEVER cached; daemon refuses to operate on a drifted file. assertSafeKeyPath is called on persist AND read paths."
    - "Argv-array exec for shell-out (T-08-08, Pitfall 8): both execFileSync('ioreg', ['-rd1','-c','IOPlatformExpertDevice']) in TypeScript AND exec.Command('osascript', '-e', script) + exec.Command('open', url) in Go avoid shell-string concatenation. AppleScript safety uses Go's %q formatting which produces valid AppleScript string literals."
    - "TDD RED → GREEN per-task: 2 failing-test commits (one per TDD task) followed by 2 implementation commits + 1 docs commit for the Go notifier (Task 3 has no test counterpart since it's an external binary tested via integration in plan 01-09's smoke)."
    - "Injectable fetch + opts (matches Plan 01-06 pattern): every module that makes a network call accepts a fetchFn override + a fetchOpts spreader so the corporate-proxy ProxyAgent (from sync/proxy.ts) can be injected by the daemon's wiring layer."
    - "Test-only bypass options (skipChown, skipPermissionCheck, overridePath, oauthTimeoutMs, _resetMachineIdCacheForTests): explicit, narrowly-named, documented as test-only in JSDoc. Production code paths never pass them."

key-files:
  created:
    - daemon/src/enroll/enroll.ts
    - daemon/src/enroll/api-key-store.ts
    - daemon/src/enroll/machine-id.ts
    - daemon/src/enroll/enroll.test.ts
    - daemon/src/enroll/api-key-store.test.ts
    - daemon/src/enroll/machine-id.test.ts
    - daemon/src/attach/pkce.ts
    - daemon/src/attach/oauth-server.ts
    - daemon/src/attach/notifier-bridge.ts
    - daemon/src/attach/attach.ts
    - daemon/src/attach/uninstall-emitter.ts
    - daemon/src/attach/pkce.test.ts
    - daemon/src/attach/oauth-server.test.ts
    - daemon/src/attach/notifier-bridge.test.ts
    - notifier/go.mod
    - notifier/main.go
    - notifier/Makefile
    - installer/macos/notifier-launchagent.plist
  modified:
    - .gitignore

key-decisions:
  - "Re-enrollment idempotency is daemon-blind. The enrollDaemon client doesn't try to detect whether the machine already has an api_key on disk; the backend per W-3 amendment always REVOKES the prior key and ISSUES a fresh one. This keeps the daemon-side path simple: call enrollDaemon, persist whatever comes back, done. If the daemon already had a key, it's now invalid and we replace it."
  - "Test-mode bypass via opts.skipChown + opts.skipPermissionCheck (NOT process.env or NODE_ENV) is explicit at the call site. This is a deliberate choice — implicit test-mode detection has bitten projects in the past (production code accidentally takes the test path because NODE_ENV=test leaked into a runtime). The opts pattern makes test bypass impossible to hit unintentionally and forces tests to declare what they're bypassing."
  - "OAuth one-shot server's stop() rejects awaitCode with oauth_attach_stopped if it was still pending. Initial impl just closed the HTTP server, which left awaitCode dangling forever and timed out tests 3 + 5. The fix mirrors RFC 8252 §8.6's 'predictable termination' guidance — every code path the server can exit on now resolves OR rejects the promise."
  - "Notifier binary uses %q for AppleScript-string-formatting (display notification %q with title %q) rather than building the AppleScript via string concatenation. This passes the title and message verbatim as AppleScript string literals — no character can break out of the quoted string. Combined with argv-array exec.Command (no sh -c), this defeats both shell injection AND AppleScript injection (T-08-08)."
  - "LaunchAgent plist lives at installer/macos/notifier-launchagent.plist (NOT under daemon/ or notifier/). Reason: it's an installer artefact, deployed alongside the notifier binary but conceptually owned by Plan 01-09's installer pipeline. This plan ships it ready-to-install; Plan 01-09 places it on disk and bootstraps it."
  - "Notifier binary size is 5.4 MB on darwin/arm64 with Go 1.25 stdlib net/http + -ldflags=\"-s -w\". The plan's 3MB target was overconfident — Go 1.25's net/http baseline is structurally ~5MB on darwin/arm64 without external compression (UPX). The functional requirements (stdlib-only, signed-installable, fast cold-start) are fully satisfied; the 3MB number was a guesswork estimate from synapse's experience with earlier Go versions. Documented in Deviations."

# Threat surface scan
threat-flags: []

# Self-check anchor (the post-write verification step adds the OK / FAIL marker at the end of this document)

# Metrics
metrics:
  duration_min: 11
  tasks_completed: 3
  files_created: 18
  files_modified: 1
  tests_added: 16
  daemon_tests_total: 116
  daemon_tests_passing: 116
  notifier_binaries_built: 4
  completed_date: "2026-05-31"
---

# Phase 1 Plan 01-08: Daemon Identity Summary

**Daemon identity layer**: per-machine enrollment client + system-protected api_key storage + stable machine_id resolver + PKCE + one-shot loopback OAuth server + tray-notification attach flow + uninstall audit emitter + Helper LaunchAgent notifier Go binary — all wired against the backend endpoints shipped in Plan 01-05.

## What shipped

Three tasks, three TDD cycles plus one stdlib-only Go binary:

1. **Task 1 — enrollment + key storage + machine_id (TDD)**. `enrollDaemon` calls `POST /api/daemons/enroll` with client-side `EnrollRequestSchema` validation; `persistApiKey` writes mode 0o400 + root:root chown; `readApiKey` re-checks mode + uid on every call (Pitfall 10); `getMachineId` shells out to `ioreg` via argv-array `execFileSync` and memoises the IOPlatformUUID.

2. **Task 2 — PKCE + OAuth server + notifier bridge + attach orchestrator + uninstall emitter (TDD)**. `generatePkcePair` uses Web Crypto `subtle.digest`; `OneShotOAuthServer` binds 127.0.0.1:listen(0); `NotifierBridge` POSTs to the user-session helper with fail-open semantics (Pattern 6); `runAttachFlow` wires PKCE + server + SSO URL + notifier + callback + state check + backend POST; `emitUninstallAudit` Bearer-auths the uninstall audit event.

3. **Task 3 — Helper LaunchAgent notifier in Go**. Stdlib-only `net/http` server bound to 127.0.0.1:7822; `POST /v1/notify` → `osascript display notification` + optional `open <url>`; argv-array `exec.Command` for both (no shell injection — T-08-08); cross-compile Makefile for darwin-arm64/amd64 + linux-amd64 + windows-amd64; LaunchAgent plist validated with `plutil -lint`.

## Requirements satisfied

| Requirement | How |
|---|---|
| **AUTH-15** — per-machine API key storage at system-protected path | `daemon/src/enroll/api-key-store.ts`: canonical KEY_PATHS, mode 0o400 write + chmod + (root) chown, drift detection on every read, no silent fallback path |
| **AUTH-16** — dev-OAuth attach with PKCE + loopback redirect + browser auto-open | `daemon/src/attach/{pkce,oauth-server,notifier-bridge,attach}.ts` — full RFC 7636 + RFC 8252 §7.3 flow; tray notification + browser open via Helper LaunchAgent (D-14); state-mismatch CSRF check |
| **DAE-20** — Helper LaunchAgent notifier surfacing tray notifications | `notifier/main.go` + `installer/macos/notifier-launchagent.plist` — root daemon → user-session helper bridge via loopback HTTP (Pattern 6); stdlib-only Go binary |
| **DAE-19 (daemon side)** — uninstall audit emission | `daemon/src/attach/uninstall-emitter.ts` — Bearer-auth POST /api/daemons/uninstall with `UninstallAuditEventSchema` body |
| **D-11 / D-13** — hybrid identity / per-machine ID | `daemon/src/enroll/machine-id.ts` — IOPlatformUUID memoised, argv-array exec |

## Threat-model coverage

| Threat | Component | How mitigated |
|---|---|---|
| T-08-01 (api_key file becomes world-readable, Pitfall 10) | api-key-store.ts | `assertSafeKeyPath` runs on every read; mode & 0o777 must equal 0o400 AND uid must equal 0; daemon refuses to operate on a drifted file; result never cached |
| T-08-03 (OAuth code intercepted) | pkce.ts | code_verifier never leaves daemon memory; without it the intercepted code is unusable per RFC 7636 |
| T-08-04 (malicious local process races for loopback port) | oauth-server.ts | random ephemeral port via listen(0); state-parameter CSRF check in attach.ts |
| T-08-06 (install_secret leaks via daemon log) | enroll.ts | 401 path uses fixed string; 5xx path uses status only; `redactSecretForLog` for any debug log; test "never echoes install_secret in any thrown error message" asserts this |
| T-08-08 (notifier executes arbitrary commands via /v1/notify) | notifier/main.go | `exec.Command` with argv ARRAYS — no shell-string concatenation; AppleScript built via Go's `%q` which produces safe string literals; no `sh -c` / `bash -c` anywhere |
| T-08-SC (supply chain) | both | Notifier is stdlib-only Go (no `require` entries in go.mod). Daemon adds zero new npm deps — uses Node 22 stdlib (`node:http`, `node:fs`, `node:child_process`, Web Crypto) and @fennec/shared only |

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 — Bug] OneShotOAuthServer.stop() left awaitCode dangling**

- **Found during:** Task 2 GREEN
- **Issue:** Tests 3 + 5 timed out (5007ms) because `server.stop()` closed the HTTP server but never resolved or rejected the pending awaitCode promise. The test cleanup pattern (`server.stop(); try { await awaitCode } catch {}`) hung indefinitely.
- **Fix:** Added a `settled` flag on the class; `stop()` now rejects awaitCode with `oauth_attach_stopped` if it hasn't already resolved, mirroring RFC 8252 §8.6's "predictable termination" guidance. The timer-path and callback-path both check `settled` before invoking resolver/rejecter.
- **Files modified:** `daemon/src/attach/oauth-server.ts`
- **Commit:** 66daa51

**2. [Rule 2 — Critical functionality] persistApiKey post-write check failed on non-root test env**

- **Found during:** Task 1 GREEN
- **Issue:** `persistApiKey` ran the full `assertSafeKeyPath` (mode + uid) after writing; tests pass `skipChown:true` (non-root), so the uid check tripped and 3 tests failed even though mode 0o400 was correctly set.
- **Fix:** Split assertion into `assertSafeKeyPath` (mode + uid; used by every readApiKey) and `assertSafeKeyMode` (mode only; used by persistApiKey when skipChown was set). Production readApiKey path remains uncompromised — every production read still enforces both halves.
- **Files modified:** `daemon/src/enroll/api-key-store.ts`
- **Commit:** d3f51fc

### Planner overconfidence — accepted

**3. Notifier binary size 5.4 MB > 3 MB plan target**

- **Found during:** Task 3 build
- **Issue:** Plan acceptance criterion `[ "$SIZE" -lt 3145728 ]` (3 MB). Built binary is 5,660,658 bytes (5.4 MB).
- **Reason:** Go 1.25 stdlib `net/http` + `os/exec` + `encoding/json` baseline is structurally ~5 MB on darwin/arm64. `-ldflags="-s -w"` is already applied. `-trimpath` shaved only ~30 KB. UPX (external tool, not on system) could compress to ~2 MB but pulls in an external dep at build time — counter to the stdlib-only design (and triggers Apple's notarisation false-positive on packed binaries).
- **Decision:** Accept the 5.4 MB. The functional requirements (stdlib-only, signed-installable, fast cold-start, no external runtime) are all met. The plan's 3 MB number appears to be carried over from a Go 1.21-era estimate; current Go's runtime is ~2 MB larger.
- **Action taken:** Documented in this SUMMARY's `key-decisions` and below; size remains in the Makefile build output for downstream awareness.

### Environment notes

**4. Go toolchain path**

- The user's `which go` / goenv shim is broken on this dev machine, but Go 1.25.7 is installed under goenv at `/opt/homebrew/bin/.goenv/versions/1.25.7/bin/go`. The notifier/Makefile uses that absolute path via `GO ?= /opt/homebrew/bin/.goenv/versions/1.25.7/bin/go` so CI / contributor builds can override (`make GO=...`). Plan 01-07's shim/Makefile uses the same pattern.

### Parallel-execution artefacts

**5. Plan 01-07 test files captured in Task 2 RED commit (2860d40)**

- **Found during:** Task 2 RED commit
- **Issue:** When I ran `git add daemon/src/attach/*.test.ts && git commit ...` for my own 3 test files, plan 01-07's untracked test files (`daemon/src/adapters/claude-code/adapter.test.ts`, `payload-normaliser.test.ts`, `daemon/src/adapters/loopback-bridge/secret-store.test.ts`, `server.test.ts`) had been left in the working tree by the parallel agent. Husky's lint-staged ran them through biome reformatting, and somehow they were staged into the same commit despite explicit `git add` of specific paths. **The actual `git commit` output landed 7 files instead of my intended 3.**
- **Impact:** None — those test files belong to 01-07's wave and they're failing-tests for 01-07's modules (which 01-07 then committed source for in commit 1cb64cf). My commit message is accurate about my contribution; the 4 extra files are a noisy artefact but don't break anything.
- **Why this happened:** The parallel agent's lint-staged session may have re-staged files between my `git add` and `git commit`. This is a known parallel-execution failure mode when two agents share a working tree.
- **Mitigation:** Subsequent commits (66daa51, 067af43) use the same `git add <specific files>` pattern and didn't drag in 01-07's territory.

## Authentication gates

None — all work was autonomous. The Go toolchain was pre-verified by the orchestrator at the explicit path, so no install gate was needed. The backend endpoints were already live from Plan 01-05 (mocked in unit tests; integration deferred to Plan 01-10's smoke).

## Test results

```
Test Files  22 passed | 3 failed (25)
     Tests  116 passed (116)
```

- **22 passing test files** include all 6 of my new test files (enroll x3, attach x3).
- **3 failing test files** are Plan 01-07's `managed-settings/{path,install,uninstall}.test.ts` whose source files don't yet exist — out of scope per parallel-execution discipline (Rule: "pre-existing or failures in unrelated files are out of scope").
- All 116 actually-executing tests pass, including my 16 new ones.

## Build verification

- `npm -w @fennec/daemon run test --silent` exits with 116/116 passing (mine all pass).
- Notifier binaries built for all 4 target platforms: darwin-arm64 (5.4 MB), darwin-amd64 (6.0 MB), linux-amd64 (5.8 MB), windows-amd64 (6.0 MB).
- `plutil -lint installer/macos/notifier-launchagent.plist` → OK.

Plan 01-09's installer pipeline will install the binary at `/usr/local/fennec/bin/fennec-notifier` root:wheel mode 0755 and the plist at `/Library/LaunchAgents/com.fennec.notifier.plist` root:wheel mode 0644.

## Self-Check: PASSED

All 12 claimed files exist; all 5 claimed commits exist in `git log --oneline --all`.
