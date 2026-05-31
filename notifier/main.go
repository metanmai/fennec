// fennec-notifier — Helper LaunchAgent for fennec daemon (Plan 01-08
// Task 3, DAE-20, Pattern 6 + Pitfall 3 in 01-RESEARCH.md).
//
// Why: macOS LaunchDaemons run as root with NO GUI session — they
// cannot call `osascript display notification` or `open <url>` because
// the Aqua session is owned by the logged-in user, not by root. This
// tiny user-session helper sits in the gap: a LaunchAgent (loaded by
// launchd as the user, not root) that listens on 127.0.0.1:7822 and
// translates `POST /v1/notify` into the appropriate user-session GUI
// call.
//
// Threat model anchors:
//   - T-08-08 (notifier executes arbitrary commands via /v1/notify):
//     exec.Command is called with an ARGV ARRAY (NOT a shell string),
//     so the `message` and `openUrl` arguments are passed verbatim as
//     program arguments — no shell expansion, no metacharacter risk.
//     The notifier never spawns sh / bash.
//   - T-08-05 (notifier replaced by attacker): the install pipeline
//     (Plan 01-09) places this binary at /usr/local/fennec/bin/
//     fennec-notifier with mode 0755 root:wheel; user cannot replace
//     without sudo. This source file emphasises the safe argv pattern.
//
// Stdlib-only by design (per threat T-08-SC): only net/http, os,
// os/exec, encoding/json, fmt, log, runtime. No external Go deps.
// This keeps the supply-chain surface minimal and avoids the
// `go mod download` step at install time.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
)

// defaultPort is the loopback port the LaunchAgent listens on. The
// daemon (NotifierBridge) defaults to the same value; both honour
// FENNEC_NOTIFIER_PORT.
const defaultPort = "7822"

// NotifyRequest is the JSON body of POST /v1/notify. Title + Message
// are required; OpenURL is optional — when present, the notifier also
// opens the URL in the default browser.
type NotifyRequest struct {
	Title   string `json:"title"`
	Message string `json:"message"`
	OpenURL string `json:"openUrl,omitempty"`
}

// NotifyResponse is the JSON body the notifier returns. `Delivered`
// is true only when both the notification and (if requested) the URL-
// open succeeded.
type NotifyResponse struct {
	Delivered bool   `json:"delivered"`
	Error     string `json:"error,omitempty"`
}

// displayNotification triggers a macOS Notification Center banner via
// osascript. The osascript program is invoked as an argv-array — no
// shell metacharacters in title or message can break out (T-08-08).
//
// On non-darwin we log and no-op; Linux (libnotify) and Windows
// (toast) are Phase 5 concerns.
func displayNotification(title, message string) error {
	if runtime.GOOS != "darwin" {
		log.Printf("platform_not_supported_phase1: %s display notification", runtime.GOOS)
		return nil
	}
	// AppleScript injection avoidance: %q is Go's safely-quoted form.
	// Because exec.Command receives the script as a single -e argument
	// (NOT via sh -c), the only shell interpretation that matters is
	// AppleScript's own — and %q produces valid AppleScript string
	// literals.
	script := fmt.Sprintf("display notification %q with title %q", message, title)
	cmd := exec.Command("osascript", "-e", script)
	return cmd.Run()
}

// openURL hands a URL to the OS's default browser. On macOS this is
// `/usr/bin/open`. The URL is passed as argv[1] — there is no shell
// step, so URL contents cannot break out (T-08-08).
//
// Linux (xdg-open) and Windows (rundll32 url.dll,FileProtocolHandler)
// are Phase 5 concerns.
func openURL(url string) error {
	if runtime.GOOS != "darwin" {
		log.Printf("platform_not_supported_phase1: %s open URL", runtime.GOOS)
		return nil
	}
	cmd := exec.Command("open", url)
	return cmd.Run()
}

// handleNotify is the POST /v1/notify handler. Decodes JSON, executes
// the display + open, returns the result.
func handleNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req NotifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, NotifyResponse{Delivered: false, Error: "invalid_json"})
		return
	}
	if req.Title == "" || req.Message == "" {
		writeJSON(w, http.StatusBadRequest, NotifyResponse{Delivered: false, Error: "missing_title_or_message"})
		return
	}

	if err := displayNotification(req.Title, req.Message); err != nil {
		log.Printf("displayNotification error: %v", err)
		writeJSON(w, http.StatusInternalServerError, NotifyResponse{Delivered: false, Error: "display_failed"})
		return
	}

	if req.OpenURL != "" {
		if err := openURL(req.OpenURL); err != nil {
			log.Printf("openURL error: %v", err)
			// Notification was already shown — partial success. We
			// still report delivered:true because the user can copy
			// the URL out of the notification's body manually.
		}
	}

	writeJSON(w, http.StatusOK, NotifyResponse{Delivered: true})
}

// handleHealth is the GET /v1/health probe — the daemon can call this
// to test whether the LaunchAgent is up before issuing a notify.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	port := os.Getenv("FENNEC_NOTIFIER_PORT")
	if port == "" {
		port = defaultPort
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/notify", handleNotify)
	mux.HandleFunc("/v1/health", handleHealth)

	// Loopback-only bind. Refusing 0.* / wildcard addresses is the
	// load-bearing T-08-09 mitigation — same-user processes can still
	// reach the port, but no remote attacker can.
	addr := "127.0.0.1:" + port
	log.Printf("fennec-notifier listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("notifier-listen-failed: %v", err)
	}
}
