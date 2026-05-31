/**
 * sha256-hex hashing for Bearer-token + install-secret lookups.
 *
 * MUST match Postgres-side `encode(digest(value, 'sha256'), 'hex')` exactly
 * (see `supabase/migrations/20260531000007_seed_phase1_test_data.sql`). Both
 * sides emit lowercase hex.
 *
 * Implementation note: uses the Web Crypto API (`crypto.subtle.digest`) and
 * therefore runs unchanged on Node 22, Cloudflare Workers, and any modern
 * runtime. Aligns with `@fennec/shared`'s `deriveIdempotencyKey` design
 * (runtime-neutral). No `node:crypto` import.
 *
 * Performance: Web Crypto's SHA-256 is a single C-level call in V8 + workerd,
 * sub-microsecond for the ~50-byte inputs we hash (Bearer tokens,
 * install_secret strings).
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(digest);
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
