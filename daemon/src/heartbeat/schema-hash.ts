/**
 * Schema-hash drift detection (CAP-15, Open Question 3 option (a) —
 * field-name set hash).
 *
 * `computeSchemaHash(samplePayload)` collects every key seen in the
 * payload (recursive across nested objects + arrays of objects),
 * sorts the keys, joins with "|", and returns the first 16 chars of
 * the sha256-hex digest. The output is stable across calls with
 * identical key-sets (regardless of VALUES), and changes when:
 *   - a field is renamed (e.g. `prompt` → `prompt_text`)
 *   - a field is added or removed
 *   - a nested object's keys change
 *
 * Detection mechanism: the daemon emits the hash on every heartbeat;
 * the backend (Phase 4 dashboard) flags an adapter as "offline /
 * upstream format changed" when consecutive heartbeats from the same
 * adapter+machine report different hashes. Phase 1 just guarantees
 * the field is in the wire format and is computed correctly.
 *
 * Web Crypto API (`crypto.subtle.digest`) is used so the same code
 * can run on the Node 22 daemon and the Cloudflare Workers backend
 * (the latter would re-derive the hash to verify drift). Async — the
 * heartbeat scheduler awaits.
 */

/**
 * Recursively collect every key seen anywhere in the payload tree.
 * Objects contribute their own keys + recurse into values; arrays
 * recurse into each element (no array-index keys are recorded — the
 * point is the SHAPE, not the sequence).
 */
function collectKeys(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out.add(key);
    collectKeys(nested, out);
  }
}

/**
 * Compute a 16-char hex schema hash for the given payload sample.
 *
 * If the payload is a string, it is JSON.parsed first (callers that
 * have the raw JSON line from the queue can pass it directly).
 *
 * Empty / null payloads → hash of the empty string ("e3b0c44298fc1c14"
 * — sha256 of the empty input). Stable + meaningful as a baseline.
 */
export async function computeSchemaHash(samplePayload: unknown): Promise<string> {
  let value: unknown = samplePayload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // Non-JSON string — treat it as a literal value with no keys
      value = {};
    }
  }

  const keys = new Set<string>();
  collectKeys(value, keys);
  const material = Array.from(keys).sort().join("|");

  const bytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(digest).slice(0, 16);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const byte = view[i] as number;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
