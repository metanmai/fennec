/**
 * ING-04 hot-path purity guard.
 *
 * The events-batch handler MUST NOT import any analysis / correlation /
 * model-fit / aggregator module. These modules don't exist yet -- they're a
 * Phase 2 surface and run as Queue consumers. The hot path must stay simple:
 * authenticate -> validate -> upsert -> return.
 *
 * Test: static grep of the handler source for forbidden imports.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ING-04 hot-path purity", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const handlerPath = join(here, "events-batch.ts");
  const source = readFileSync(handlerPath, "utf-8");

  it("events-batch.ts does NOT import a `correlation` module", () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*correlation/);
  });

  it("events-batch.ts does NOT import a `model-fit` module", () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*model-fit/);
  });

  it("events-batch.ts does NOT import an `aggregator` module", () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*aggregator/);
  });

  it("events-batch.ts does NOT import from a generic `analysis` path", () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*analysis/);
  });
});
