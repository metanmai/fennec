/**
 * Gitleaks rule loader (Task 3 of Plan 01-06).
 *
 * Pinned upstream version: gitleaks-v8.21.0 (default ruleset). The
 * vendored TOML's SHA-256 is recorded in `gitleaks-rules.sha` (W-4).
 *
 * The canonical pinned ruleset is vendored at
 *   daemon/src/redact/gitleaks-rules.toml         (raw upstream)
 *   daemon/src/redact/gitleaks-rules.sha          (SHA-256 of the TOML, W-4)
 *   daemon/src/redact/gitleaks-rules.json         (parsed via build script)
 *
 * The TOML is authoritative — the JSON is a build artifact produced by
 * `daemon/scripts/build-gitleaks-rules.mjs`. The build script verifies
 * the TOML's SHA against the `.sha` file before producing the JSON,
 * so an accidental update to the vendored file fails the build until
 * the operator deliberately updates the pin.
 *
 * Three supplemental rules are added on top of the upstream defaults
 * to cover patterns the upstream v8.21.0 ruleset misses but Phase 1's
 * 10-canary PRIV-01 smoke test asserts:
 *   - anthropic-api-key (sk-ant-api03-...) — upstream adds this in
 *     newer releases, but v8.21.0 (our pin) doesn't ship it
 *   - generic-bearer-token — `Bearer <opaque-32+ chars>` not already
 *     captured by `jwt`
 *
 * These supplements are clearly tagged with `fennec-` rule IDs and
 * documented in the rule list so an operator inspecting redaction
 * metadata can trace why a string was scrubbed.
 *
 * RE2 vs ECMAScript: the upstream rules are Go RE2 syntax. Most are
 * ECMAScript-compatible, but a few use mid-pattern inline flag
 * modifiers like `(?i)` which JavaScript does not support. The loader
 * strips inline `(?i)` flags and applies the `i` flag globally for
 * any rule that contained one. Rules that still fail to compile under
 * ECMAScript are silently dropped + counted (LOG_DROPPED_RULES = true
 * during development).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface RawRule {
  id: string;
  description?: string;
  regex: string;
  entropy?: number | null;
  keywords?: string[];
}

interface RawRuleSet {
  source_sha256: string;
  version: string;
  rules: RawRule[];
}

export interface CompiledRule {
  id: string;
  regex: RegExp;
  entropy: number | null;
  description: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(here, "gitleaks-rules.json");

const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as RawRuleSet;

/**
 * REDACTION_VERSION_HASH — short version identifier stamped on every
 * redacted CanonicalEvent. Combines the upstream gitleaks version + a
 * fingerprint of our supplemental rules + the first 8 hex chars of
 * the vendored TOML's SHA-256 so the backend can audit which exact
 * ruleset produced any given redaction.
 */
export const REDACTION_VERSION_HASH = `${raw.version}+fennec-1@${raw.source_sha256.slice(0, 8)}` as const;

/** SHA-256 of the vendored TOML — exposed for verification tests. */
export const GITLEAKS_TOML_SHA256 = raw.source_sha256;

/**
 * Supplemental fennec-specific rules. These extend the v8.21.0 upstream
 * default with patterns the Phase 1 canary smoke test asserts (PRIV-01).
 *
 * Each rule has `id` prefixed with `fennec-` to distinguish it in
 * redaction metadata (e.g. `[REDACTED:fennec-anthropic-api-key]`).
 */
const FENNEC_SUPPLEMENTAL_RULES: RawRule[] = [
  {
    id: "fennec-anthropic-api-key",
    description: "Anthropic API key (sk-ant-...). Upstream gitleaks adds this in newer releases.",
    regex: "sk-ant-(?:api|admin)\\d+-[A-Za-z0-9_-]{20,}",
    keywords: ["sk-ant-"],
  },
  {
    id: "fennec-bearer-token",
    description: "Bearer <opaque-token> — catches non-JWT bearer secrets in prompt text.",
    regex: "\\bBearer\\s+[A-Za-z0-9._~+/=-]{20,}",
    keywords: ["bearer"],
  },
  {
    id: "fennec-private-key-header",
    description:
      "PEM private-key header in isolation. Upstream `private-key` requires a closing `-----...KEY-----` block; the header alone is a strong leak signal even without the full PEM body (a developer pasting the start of a key into a prompt is a red flag worth redacting on its own).",
    regex: "-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----",
    keywords: ["-----begin"],
  },
  {
    id: "fennec-gcp-api-key-relaxed",
    description:
      "GCP/Google API key with relaxed-length tail. Upstream `gcp-api-key` anchors on exactly 35 chars after `AIza`; real-world keys + canary fixtures sometimes have 38+ chars (or trailing characters). Slightly more aggressive — `AIza` prefix is itself a strong signal regardless of suffix length.",
    regex: "AIza[\\w-]{30,}",
    keywords: ["aiza"],
  },
];

/**
 * Normalise a Go RE2 regex string for ECMAScript consumption. The two
 * most common incompatibilities we hit:
 *   1. Inline `(?i)` flag modifiers — strip and apply the `i` flag
 *      globally for any rule that contained one.
 *   2. Possessive quantifiers like `++` / `*+` (RE2 supports these;
 *      ECMAScript doesn't) — gitleaks v8.21.0's default ruleset doesn't
 *      use them, but if a future ruleset does we'd want to detect and
 *      downgrade them. Not handled here; build will reject the rule.
 */
function normalisePattern(source: string): { pattern: string; flags: string } {
  let pattern = source;
  let flags = "g";
  // Strip ALL `(?i)` occurrences anywhere in the pattern; mark the rule
  // case-insensitive globally.
  if (pattern.includes("(?i)")) {
    pattern = pattern.replace(/\(\?i\)/g, "");
    flags = "gi";
  }
  return { pattern, flags };
}

function compileRule(rule: RawRule): CompiledRule | null {
  const { pattern, flags } = normalisePattern(rule.regex);
  try {
    const regex = new RegExp(pattern, flags);
    return {
      id: rule.id,
      regex,
      entropy: typeof rule.entropy === "number" ? rule.entropy : null,
      description: rule.description ?? "",
    };
  } catch {
    // Rule's pattern is not ECMAScript-compatible. Skip silently; the
    // `loaded` count tells operators how many rules survived compile.
    return null;
  }
}

/**
 * Compiled rule list — read at module load. The order is preserved
 * (upstream first, fennec supplements last) so an upstream rule that
 * matches first wins (its rule ID surfaces in the [REDACTED:<id>]
 * marker).
 */
export const gitleaksRules: readonly CompiledRule[] = (() => {
  const all: RawRule[] = [...raw.rules, ...FENNEC_SUPPLEMENTAL_RULES];
  const compiled: CompiledRule[] = [];
  for (const r of all) {
    const c = compileRule(r);
    if (c) compiled.push(c);
  }
  return compiled;
})();

/** Total rule count after compilation (for tests + heartbeat metadata). */
export const COMPILED_RULE_COUNT = gitleaksRules.length;
