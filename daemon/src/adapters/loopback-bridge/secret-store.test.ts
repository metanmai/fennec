/**
 * Secret-store tests (Task 3 of Plan 01-07).
 *
 * Covers:
 *  - readShimSecret(env): returns null if the file doesn't exist
 *  - readShimSecret(env): returns the trimmed file contents when present
 *  - generateShimSecret(): produces 32 bytes urandom, base64url-encoded;
 *    different calls yield different secrets.
 *
 * The on-disk secret lives at `/etc/fennec/shim-secret` in production;
 * tests use `mkdtempSync` to write to a tmp path and pass it via env.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateShimSecret, readShimSecret } from "./secret-store.js";

describe("readShimSecret", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fennec-secret-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the secret file does not exist", () => {
    const secret = readShimSecret({ shimSecretPath: join(dir, "missing") });
    expect(secret).toBeNull();
  });

  it("returns the trimmed file contents when the secret file exists", () => {
    const path = join(dir, "shim-secret");
    writeFileSync(path, "my-test-secret-12345\n", { mode: 0o644 });
    const secret = readShimSecret({ shimSecretPath: path });
    expect(secret).toBe("my-test-secret-12345");
  });

  it("returns empty string for an empty file (does NOT treat as missing)", () => {
    const path = join(dir, "shim-secret-empty");
    writeFileSync(path, "", { mode: 0o644 });
    const secret = readShimSecret({ shimSecretPath: path });
    expect(secret).toBe("");
  });
});

describe("generateShimSecret", () => {
  it("produces a non-empty base64url-safe string", () => {
    const secret = generateShimSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it("produces a different secret on each call (entropy check)", () => {
    const a = generateShimSecret();
    const b = generateShimSecret();
    const c = generateShimSecret();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("produces ~43-character secrets (32 bytes base64url-encoded without padding)", () => {
    const secret = generateShimSecret();
    // 32 bytes → 43 chars base64url (without padding) or 44 with =
    expect(secret.length).toBeGreaterThanOrEqual(42);
    expect(secret.length).toBeLessThanOrEqual(44);
  });
});
