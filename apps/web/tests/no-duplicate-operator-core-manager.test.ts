// @vitest-environment node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("apps/web", () => {
  it("does not keep a duplicate operator-core manager implementation", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const legacyManagerPath = resolve(currentDir, "../src/operator-core-manager.ts");
    expect(existsSync(legacyManagerPath)).toBe(false);
  });
});
