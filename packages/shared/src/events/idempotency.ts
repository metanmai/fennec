/**
 * Idempotency key derivation — STABLE across retries (CAP-13, PITFALL P5).
 *
 * The daemon writes events to its append-only JSONL queue with this
 * key already computed and persisted; the sync loop reads the key back
 * from disk on every retry, so the SAME prompt-submitted-event always
 * carries the SAME key even after a daemon restart mid-batch. The
 * backend then deduplicates with `ON CONFLICT (idempotency_key) DO
 * NOTHING` (threat T-02-02).
 *
 * The hash input — `${hostname}|${tool}|${session_id}|${hook_event}|${monotonic_seq}` —
 * is taken POST-redaction so a redacted secret in a prompt body cannot
 * leak into the key. The monotonic_seq is the session-local sequence
 * the adapter increments for every event it captures inside a single
 * Claude Code session; combined with session_id it disambiguates
 * repeated identical hook fires (e.g., a user pressing Enter on the
 * same prompt twice).
 *
 * Implementation notes:
 *   - Web Crypto API only (no `node:crypto`), so this module remains
 *     runtime-neutral and the backend (Cloudflare Workers) can re-use
 *     the same derivation function for synthetic events.
 *   - sha256-hex sliced to 32 chars → 128 bits, sufficient
 *     collision-resistance for the input space (one machine × one
 *     tool × one session × one hook × one seq).
 *   - The function is async because Web Crypto's `digest()` returns a
 *     Promise. Callers must await.
 */

export interface IdempotencyKeyInput {
  hostname: string;
  tool: string;
  session_id: string;
  hook_event: string;
  monotonic_seq: number;
}

export async function deriveIdempotencyKey(input: IdempotencyKeyInput): Promise<string> {
  const material = `${input.hostname}|${input.tool}|${input.session_id}|${input.hook_event}|${input.monotonic_seq}`;
  const bytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = bufferToHex(digest);
  return hex.slice(0, 32);
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
