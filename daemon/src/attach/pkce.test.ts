/**
 * PKCE pair tests (Task 2 of Plan 01-08).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 1-2):
 *   - Test 1: generatePkcePair() returns { code_verifier, code_challenge }
 *     where code_verifier is 43-128 chars base64url AND code_challenge
 *     is base64url(sha256(code_verifier)).
 *   - Test 2: Two calls return DIFFERENT pairs (randomness verified).
 *
 * RFC 7636 §4.1: code_verifier = [A-Z][a-z][0-9]-._~, 43-128 chars.
 * RFC 7636 §4.2: code_challenge = base64url(sha256(ascii(code_verifier))).
 */

import { describe, expect, it } from "vitest";
import { generatePkcePair } from "./pkce.js";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("generatePkcePair", () => {
  it("Test 1a: returns base64url code_verifier of 43-128 chars", async () => {
    const { code_verifier } = await generatePkcePair();
    expect(typeof code_verifier).toBe("string");
    expect(code_verifier.length).toBeGreaterThanOrEqual(43);
    expect(code_verifier.length).toBeLessThanOrEqual(128);
    expect(BASE64URL_RE.test(code_verifier)).toBe(true);
  });

  it("Test 1b: code_challenge equals base64url(sha256(code_verifier))", async () => {
    const { code_verifier, code_challenge } = await generatePkcePair();
    const expected = await sha256Base64Url(code_verifier);
    expect(code_challenge).toBe(expected);
    expect(BASE64URL_RE.test(code_challenge)).toBe(true);
  });

  it("Test 2: two calls return different pairs (randomness)", async () => {
    const a = await generatePkcePair();
    const b = await generatePkcePair();
    expect(a.code_verifier).not.toBe(b.code_verifier);
    expect(a.code_challenge).not.toBe(b.code_challenge);
  });
});
