import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Overview page migration", () => {
  it("uses shared operator-ui components instead of inline theme styles", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Overview.tsx"),
      "utf-8",
    );

    expect(source).toContain('from "@tyrum/operator-ui"');
    expect(source).toContain("Card");
    expect(source).toContain("Button");
    expect(source).toContain("StatusDot");
    expect(source).toContain("Badge");
    expect(source).not.toContain('from "../theme.js"');
  });
});

