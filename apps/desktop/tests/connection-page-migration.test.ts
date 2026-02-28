import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Connection page migration", () => {
  it("uses shared operator-ui components instead of the legacy desktop theme module", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Connection.tsx"),
      "utf-8",
    );

    expect(source).toContain('from "@tyrum/operator-ui"');
    expect(source).toContain("Tabs");
    expect(source).toContain("Input");
    expect(source).toContain("Button");
    expect(source).not.toContain('from "../theme.js"');
  });
});

