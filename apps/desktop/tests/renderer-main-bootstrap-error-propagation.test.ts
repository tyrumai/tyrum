import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer bootstrap error propagation", () => {
  it("does not wrap initial render in an async bootstrap that is called via void", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/renderer/main.tsx"), "utf-8");

    expect(source).not.toMatch(/\basync function bootstrap\b/);
    expect(source).not.toMatch(/\bvoid bootstrap\(\);\b/);
  });
});
