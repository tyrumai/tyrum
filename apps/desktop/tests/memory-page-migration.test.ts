import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Memory page migration", () => {
  it("does not rely on the legacy desktop theme module", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Memory.tsx"),
      "utf-8",
    );

    expect(source).toContain('from "@tyrum/operator-ui"');
    expect(source).not.toContain('from "../theme.js"');
  });
});
