import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Gateway page migration", () => {
  it("does not depend on the legacy desktop theme module", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Gateway.tsx"),
      "utf-8",
    );

    expect(source).toContain('from "@tyrum/operator-ui"');
    expect(source).toContain("OperatorUiApp");
    expect(source).not.toContain('from "../theme.js"');
  });
});

