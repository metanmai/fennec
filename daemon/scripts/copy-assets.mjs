#!/usr/bin/env node
/**
 * Post-tsc step: copy non-TS assets (vendored gitleaks ruleset) into
 * the `dist/` tree so the compiled daemon can load them at runtime.
 *
 * tsc only emits .js/.d.ts/.map files. The redactor needs:
 *   - daemon/src/redact/gitleaks-rules.toml   (canonical pinned source)
 *   - daemon/src/redact/gitleaks-rules.json   (pre-parsed for loader)
 *   - daemon/src/redact/gitleaks-rules.sha    (W-4 verification pin)
 * to be present alongside the compiled JS so `readFileSync` from
 * `dist/redact/gitleaks-rules.js` finds them in the same directory.
 *
 * Run automatically by `npm run build`; can also be invoked directly.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const daemonRoot = join(here, "..");
const assets = [
  ["src/redact/gitleaks-rules.toml", "dist/redact/gitleaks-rules.toml"],
  ["src/redact/gitleaks-rules.json", "dist/redact/gitleaks-rules.json"],
  ["src/redact/gitleaks-rules.sha", "dist/redact/gitleaks-rules.sha"],
];

for (const [src, dest] of assets) {
  const absSrc = join(daemonRoot, src);
  const absDest = join(daemonRoot, dest);
  if (!existsSync(absSrc)) {
    console.error(`copy-assets: missing source ${absSrc}`);
    process.exit(1);
  }
  mkdirSync(dirname(absDest), { recursive: true });
  copyFileSync(absSrc, absDest);
}

console.log(`Copied ${assets.length} asset(s) into dist/redact/`);
