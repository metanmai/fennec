// fennec-hook — the compiled Claude Code hook shim.
//
// Claude Code spawns this binary for every hook fire (configured via
// the system-managed managed-settings.json — see D-19). The shim reads
// the hook payload from stdin, POSTs it to the daemon's loopback
// bridge (http://127.0.0.1:<port>/v1/hook) with the shared
// X-Fennec-Shim-Secret header, and exits 0 within ~15ms.
//
// Per D-23 (fail-open): if the daemon is down, the network errors out,
// or the timeout fires, the shim STILL exits 0 silently. Claude Code's
// user-facing flow must NEVER be blocked or delayed by fennec being
// down. The daemon's own watchdog handles restart; the missed events
// surface in the next adapter heartbeat (parse_errors > 0 with reason
// "daemon-unreachable").
//
// Per Pattern 8 in 01-RESEARCH.md (Hook Handler Shim):
//   - 127.0.0.1 only — never bind 0.0.0.0
//   - 15ms total wall-clock budget (client.Timeout enforces this)
//   - NEVER write to stdout/stderr — Claude Code captures them
//     and may surface stderr to the user; fennec must be invisible.
//
// Threat model (from PLAN.md):
//   - T-07-01 (spoofing): bridge requires X-Fennec-Shim-Secret header.
//     The secret is read from the env at exec time; the daemon's
//     installer (Plan 01-09) sets FENNEC_SHIM_SECRET in the same
//     managed-settings entry that points at this binary.
//   - T-07-03 (DoS): Go cold-start is ~1ms; client.Timeout (15ms) caps
//     the total request budget; fail-open exits 0 within deadline.
//   - T-07-SC: stdlib-only, no external go modules.
package main

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"time"
)

// shimTimeout — the total wall-clock budget per the DAE-18 contract.
// Pattern 8 in 01-RESEARCH.md fixes this at 15ms.
const shimTimeout = 15 * time.Millisecond

// defaultPort — the daemon's loopback bridge port if FENNEC_DAEMON_PORT
// is unset in the environment. Matches the planner's choice (7821).
const defaultPort = "7821"

// run executes one shim invocation. Split out from main() so the tests
// can call it with a custom stdin reader and observe the result. main()
// itself wires stdin/stdout and forces os.Exit(0) regardless of run's
// return value — fail-open per D-23.
func run(stdin io.Reader) {
	// 1. Read the hook payload from stdin. Single Read, no streaming —
	//    Claude Code's hook payloads are small JSON blobs (≤4KB
	//    typically).
	payload, err := io.ReadAll(stdin)
	if err != nil {
		// I/O error reading stdin → fail-open. The daemon's heartbeat
		// will surface the gap in the next interval.
		return
	}

	// 2. Resolve env. Empty secret is acceptable in dev/CI; the daemon
	//    rejects the POST if it actually requires a real secret in prod.
	secret := os.Getenv("FENNEC_SHIM_SECRET")
	port := os.Getenv("FENNEC_DAEMON_PORT")
	if port == "" {
		port = defaultPort
	}

	// 3. Build the request. 127.0.0.1 is hardcoded — never bind 0.0.0.0
	//    (loopback bridge contract; threat T-07-01).
	url := "http://127.0.0.1:" + port + "/v1/hook"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		// http.NewRequest only fails on a bad URL/method which we control
		// at compile time. Fail-open anyway.
		return
	}
	req.Header.Set("X-Fennec-Shim-Secret", secret)
	req.Header.Set("Content-Type", "application/json")

	// 4. Fire with a strict 15ms client.Timeout (covers connect + write
	//    + read). Any error here — connection refused, timeout, daemon
	//    down — exits 0 silently (fail-open per D-23).
	client := &http.Client{Timeout: shimTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return
	}

	// 5. Drain + close the body so the kernel can reclaim the socket.
	//    Don't act on the status code — even a 4xx/5xx means we've
	//    delivered the payload; downstream errors are the daemon's
	//    problem, not the shim's.
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}

func main() {
	run(os.Stdin)
	// Fail-open exit code per D-23 — regardless of whether the POST
	// succeeded, Claude Code's user-facing flow must continue.
	os.Exit(0)
}
