import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Permissions page migration", () => {
  it("uses shared operator-ui components instead of the legacy desktop theme module", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Permissions.tsx"),
      "utf-8",
    );

    expect(source).toContain('from "@tyrum/operator-ui"');
    expect(source).toContain("RadioGroup");
    expect(source).toContain("Switch");
    expect(source).toContain("Textarea");
    expect(source).not.toContain('from "../theme.js"');
  });
});
