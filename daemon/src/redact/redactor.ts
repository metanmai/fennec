/**
 * Capture-time redactor (Pattern 3 in 01-RESEARCH.md, threat T-06-01).
 *
 * `redactEvent` runs synchronously BEFORE any event reaches the JSONL
 * queue. Every gitleaks rule is tried against the full
 * `JSON.stringify(event.payload)` blob so nested strings are also
 * scanned. Matches are replaced with `[REDACTED:<rule.id>]`.
 *
 * Stamps `redaction_applied_at = new Date().toISOString()` and
 * `redaction_version_hash` so every event in the JSONL carries proof
 * it was processed by a known ruleset version.
 *
 * Error handling (PITFALL P1): if any regex throws (e.g. a future
 * malformed rule sneaks in), the function re-throws. The
 * registry catches it, counts parse_errors, and DROPS the event —
 * better lost than leaked.
 */

import type { CanonicalEvent } from "@fennec/shared";
import { gitleaksRules, REDACTION_VERSION_HASH } from "./gitleaks-rules.js";

export { REDACTION_VERSION_HASH };

/**
 * Run the gitleaks rules over the event's payload (and any nested
 * strings reached via JSON.stringify) and stamp redaction metadata.
 *
 * Returns a NEW event — the input is not mutated. Caller receives a
 * deep-cloned (by JSON round-trip) payload object.
 */
export function redactEvent(event: CanonicalEvent): CanonicalEvent {
  const redactedPayload = redactPayload(event.payload);
  return {
    ...event,
    payload: redactedPayload,
    redaction_applied_at: new Date().toISOString(),
    redaction_version_hash: REDACTION_VERSION_HASH,
  };
}

/**
 * Recursively walk the payload tree and apply rules to every string
 * value. Returns a fresh object — the input is not mutated.
 *
 * Walking the tree (rather than the planner's original
 * stringify-redact-parse approach) avoids two pitfalls:
 *   1. JSON-escape leakage: in JSON.stringify'd text, `\n`/`\r`/`"`
 *      etc. become `\\n`/`\\r`/`\\"` (two characters each). Upstream
 *      gitleaks rules anchor on the LITERAL whitespace/quote chars
 *      so the JSON-escaped form silently fails to match — the
 *      secret slips through. Walking the parsed structure runs the
 *      rule against the real newline/quote chars as the developer
 *      typed them.
 *   2. JSON structural-character collisions: if a rule's `[REDACTED:<id>]`
 *      marker contained a `"` or `{`, parse-back could fail. Walking
 *      the structure keeps the redacted value inside a string slot,
 *      so structural characters are preserved.
 */
function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const walked = walkRedact(payload);
  // Walked value is always an object because `payload` is. Cast to
  // satisfy the return type — the input shape is preserved end-to-end.
  return walked as Record<string, unknown>;
}

/**
 * Recursive redaction walker. Strings pass through `redactString`;
 * arrays + objects recurse; primitives pass through unchanged.
 */
function walkRedact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(walkRedact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkRedact(v);
    }
    return out;
  }
  return value;
}

/**
 * Run all compiled rules over a string and replace every match. The
 * rule iteration order matches the upstream gitleaks file (alphabetical
 * by ID) followed by fennec supplements — first-match wins because
 * later rules see the already-redacted text.
 *
 * Entropy gating: gitleaks supports an `entropy` threshold on some
 * rules (e.g. `azure-ad-client-secret` entropy = 3). For Phase 1 we
 * intentionally redact regardless of entropy — false positives are
 * cheap (a slightly noisier payload), false negatives are not (a
 * leaked secret in a stored event). PRIV-01 is the bar.
 */
function redactString(input: string): string {
  let out = input;
  for (const rule of gitleaksRules) {
    // Reset lastIndex defensively — RegExp with the `g` flag carries
    // state across `.test()` / `.exec()` calls. `.replace()` resets
    // it internally but explicit reset prevents any future caller of
    // the shared compiled regex from being surprised.
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, `[REDACTED:${rule.id}]`);
  }
  return out;
}
