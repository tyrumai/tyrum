// @vitest-environment node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("gateway app-route dead code", () => {
  it("does not keep the legacy app-route helper and type modules", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const removed = [
      resolve(currentDir, "../../src/app-route-helpers.ts"),
      resolve(currentDir, "../../src/app-route-types.ts"),
    ];

    for (const path of removed) {
      expect(existsSync(path)).toBe(false);
    }
  });
});
