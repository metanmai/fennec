import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";

describe("sha256Hex", () => {
  it("returns a deterministic 64-char lowercase hex string for the same input", async () => {
    const a = await sha256Hex("fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd");
    const b = await sha256Hex("fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the Postgres `encode(digest(value, 'sha256'), 'hex')` output for the seeded api key", async () => {
    // Pre-computed via:
    //   echo -n "fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd" | openssl dgst -sha256
    // and confirmed against `encode(digest(..., 'sha256'), 'hex')` in psql.
    // This is the EXACT hash stored in `api_keys.token_hash` by the seed
    // migration -- the bearer-auth lookup MUST match it.
    const expected = "42e56dcc783aaa5fcce745d0167f51726a49cad1801c25f8e69f21f0d65961ed";
    const actual = await sha256Hex("fennec_phase1_smoke_TESTKEY_aaaa_bbbb_cccc_dddd");
    expect(actual).toBe(expected);
  });

  it("matches the Postgres sha256-hex output for the seeded install secret", async () => {
    // Pre-computed via:
    //   printf 'FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa' | openssl dgst -sha256
    const expected = "096aa282d8b42aa910a2668753b8c92a64e0fd6602bae427ea2f38086e85e8df";
    const actual = await sha256Hex("FENNEC_TEST_INSTALL_SECRET_PHASE1_DO_NOT_USE_IN_PROD_aaaa");
    expect(actual).toBe(expected);
  });

  it("produces different hashes for inputs that differ by a single character", async () => {
    const a = await sha256Hex("fennec_token_a");
    const b = await sha256Hex("fennec_token_b");
    expect(a).not.toBe(b);
  });

  it("handles the empty string deterministically", async () => {
    // sha256("") is a well-known constant; it should NOT crash and should NOT
    // collide with any non-empty input.
    const empty = await sha256Hex("");
    expect(empty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
