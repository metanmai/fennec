#!/usr/bin/env node

/**
 * Convert the vendored `daemon/src/redact/gitleaks-rules.toml` (pinned
 * upstream gitleaks v8.21.0 default ruleset) into a JSON file the
 * daemon can import directly.
 *
 * Why a custom parser: Node 22 doesn't ship a TOML parser in stdlib;
 * the gitleaks ruleset uses only a small subset of TOML (a header
 * preamble, an `[allowlist]` block we ignore, and ~180 `[[rules]]`
 * blocks each with `id`, `description`, `regex`, optional `entropy`,
 * and `keywords` array). Hand-rolling ~50 lines avoids an external
 * dep + the build-time complexity of toolchain integration for a
 * one-shot conversion.
 *
 * Output: `daemon/src/redact/gitleaks-rules.json` containing an array
 * of `{ id, description, regex, entropy, keywords }` objects. Each
 * rule is consumed by `daemon/src/redact/gitleaks-rules.ts` which
 * compiles `regex` strings into JavaScript `RegExp` instances at
 * module load time, dropping any rule whose regex is not
 * ECMAScript-compatible (RE2 has some features the JS engine
 * doesn't).
 *
 * The SHA-256 of the source TOML is also recorded so build verifies
 * we converted exactly the pinned upstream content.
 *
 * Run: `node daemon/scripts/build-gitleaks-rules.mjs`
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tomlPath = join(repoRoot, "daemon", "src", "redact", "gitleaks-rules.toml");
const jsonPath = join(repoRoot, "daemon", "src", "redact", "gitleaks-rules.json");
const shaPath = join(repoRoot, "daemon", "src", "redact", "gitleaks-rules.sha");

const tomlContent = readFileSync(tomlPath, "utf-8");
const actualSha = createHash("sha256").update(tomlContent).digest("hex");
const expectedSha = readFileSync(shaPath, "utf-8").trim();

if (actualSha !== expectedSha) {
  console.error(
    `gitleaks-rules.toml SHA mismatch:\n  expected: ${expectedSha}\n  actual:   ${actualSha}\n` +
      `If you intentionally updated the vendored ruleset, update gitleaks-rules.sha to match.`,
  );
  process.exit(1);
}

/**
 * Parse the gitleaks TOML subset. We walk line-by-line, tracking
 * whether we're inside a `[[rules]]` block. Inside such a block we
 * collect:
 *   - id = "<single-quoted or double-quoted>"
 *   - description = "<...>"
 *   - regex = '''<raw>'''           (single-line) or
 *     regex = """<raw>"""           (rare)
 *   - entropy = <float>
 *   - keywords = [ "k1", "k2", ... ]  (may span multiple lines)
 *
 * The `[allowlist]` block and the preamble are ignored: the redactor
 * is conservative by design — gitleaks's allowlist exists to skip
 * common false-positive patterns (e.g., placeholder values), but we
 * want to redact aggressively at capture time. False positives on the
 * daemon's hot path are acceptable; false negatives are not (PRIV-01).
 */
function parseRules(text) {
  const lines = text.split("\n");
  const rules = [];
  let cur = null;
  let inKeywords = false;
  let keywordBuf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) continue;

    if (trimmed === "[[rules]]") {
      if (cur) rules.push(cur);
      cur = { id: "", description: "", regex: "", entropy: null, keywords: [] };
      inKeywords = false;
      keywordBuf = [];
      continue;
    }

    // Stop collecting rules when we hit another top-level table (e.g.
    // a [[rules.allowlist]] sub-table or any [section]). For the
    // gitleaks v8.21.0 default file this never happens after the
    // first [[rules]] block — every entry is a top-level rule with
    // no per-rule allowlist. We bail conservatively just in case.
    if (cur && trimmed.startsWith("[") && trimmed !== "[[rules]]") {
      // Push the current rule, then start ignoring until the next
      // [[rules]] header.
      rules.push(cur);
      cur = null;
      inKeywords = false;
      continue;
    }

    if (!cur) continue;

    // Multi-line keywords array continuation
    if (inKeywords) {
      if (trimmed.startsWith("]")) {
        cur.keywords = keywordBuf;
        inKeywords = false;
        keywordBuf = [];
        continue;
      }
      const m = trimmed.match(/^\s*"([^"]+)"\s*,?\s*$/);
      if (m) keywordBuf.push(m[1]);
      continue;
    }

    // Field assignments
    if (cur.id === "" && trimmed.startsWith("id =")) {
      cur.id = extractQuoted(trimmed);
      continue;
    }
    if (cur.description === "" && trimmed.startsWith("description =")) {
      cur.description = extractQuoted(trimmed);
      continue;
    }
    if (cur.regex === "" && trimmed.startsWith("regex =")) {
      cur.regex = extractRawString(trimmed);
      continue;
    }
    if (cur.entropy === null && trimmed.startsWith("entropy =")) {
      const m = trimmed.match(/entropy\s*=\s*([\d.]+)/);
      if (m) cur.entropy = parseFloat(m[1]);
      continue;
    }
    if (trimmed.startsWith("keywords =")) {
      // Inline array form: keywords = ["a", "b"]
      const inline = trimmed.match(/^keywords\s*=\s*\[(.*)\]\s*$/);
      if (inline) {
        const inner = inline[1];
        cur.keywords = [...inner.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      } else if (trimmed.match(/^keywords\s*=\s*\[\s*$/)) {
        // Multi-line array form
        inKeywords = true;
        keywordBuf = [];
      }
    }
  }
  if (cur) rules.push(cur);
  return rules;
}

/** Extract content from `key = "value"` (double-quoted). */
function extractQuoted(line) {
  const m = line.match(/=\s*"([^"]*)"\s*$/);
  return m ? m[1] : "";
}

/** Extract raw string from `key = '''value'''` (triple single-quoted). */
function extractRawString(line) {
  const m = line.match(/=\s*'''(.*)'''\s*$/);
  if (m) return m[1];
  // Fall back to single-quoted (`key = 'value'`) — rare.
  const single = line.match(/=\s*'([^']*)'\s*$/);
  return single ? single[1] : "";
}

const rules = parseRules(tomlContent).filter((r) => r.id && r.regex);

writeFileSync(
  jsonPath,
  JSON.stringify({ source_sha256: expectedSha, version: "gitleaks-v8.21.0-defaults", rules }, null, 2),
);

console.log(`Wrote ${rules.length} rules to ${jsonPath} (source SHA ${expectedSha.slice(0, 16)}…)`);
