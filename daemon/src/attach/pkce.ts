/**
 * PKCE code_verifier + code_challenge generation (Plan 01-08 Task 2,
 * AUTH-16, Pattern 10 in 01-RESEARCH.md).
 *
 * RFC 7636 (Proof Key for Code Exchange) — required when an OAuth 2.0
 * client cannot safely store a client secret. The fennec daemon falls
 * in that bucket: it's a native app running on the developer's machine,
 * exposed to local-process inspection, with no notion of a confidential
 * client. PKCE mitigates this by binding the OAuth code exchange to a
 * one-time `code_verifier` that the daemon keeps in memory only.
 *
 * §4.1: code_verifier is a high-entropy cryptographic random string
 *       using the unreserved set [A-Z][a-z][0-9]-._~, 43-128 chars.
 *       Our verifier is base64url(32 random bytes) = 43 chars exactly —
 *       safely within the spec and uses only the unreserved alphabet.
 *
 * §4.2: code_challenge = base64url(sha256(ascii(code_verifier))).
 *       We do this via Web Crypto's subtle.digest('SHA-256', ...) so
 *       the code is runtime-portable to the Workers backend (already
 *       runtime-neutral per the @fennec/shared package constraints).
 *
 * Threat model anchor T-08-03 (code interception by local process):
 *   PKCE makes the intercepted code useless without the verifier,
 *   which never leaves daemon memory. CSRF is mitigated by the `state`
 *   parameter (added in attach.ts, not here).
 */

/**
 * URL-safe base64 encoding (no padding). Maps the standard base64
 * alphabet's '+' → '-', '/' → '_', and strips trailing '=' so the
 * output is safe in URL query strings without further escaping.
 *
 * Done via Buffer to keep the implementation tiny — Node 22's Buffer
 * is universally available in the daemon process.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  code_verifier: string;
  code_challenge: string;
}

export async function generatePkcePair(): Promise<PkcePair> {
  // 32 bytes of crypto-random → 43-char base64url verifier. RFC 7636
  // allows 43-128 chars; using exactly 43 keeps the SSO URL compact.
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const code_verifier = base64UrlEncode(random);

  // SHA-256 the verifier's ASCII bytes — base64url-encode the digest.
  // The result is always 43 chars (32-byte digest → 43-char base64url).
  const verifierBytes = new TextEncoder().encode(code_verifier);
  const digest = await crypto.subtle.digest("SHA-256", verifierBytes);
  const code_challenge = base64UrlEncode(new Uint8Array(digest));

  return { code_verifier, code_challenge };
}
