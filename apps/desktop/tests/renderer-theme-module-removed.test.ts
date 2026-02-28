import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer legacy theme module removal", () => {
  it("deletes the legacy renderer theme module", () => {
    expect(existsSync(join(import.meta.dirname, "../src/renderer/theme.ts"))).toBe(false);
  });
});
