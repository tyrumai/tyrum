import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop operator-core sharing", () => {
  it("boots operator core once in App and shares it across all operator pages", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    // App creates the single operator core instance
    expect(app).toContain("useDesktopOperatorCore");

    // Individual operator pages receive core as a prop (not creating their own)
    expect(app).toContain("operatorCore.core");
    expect(app).toContain("<OperatorPageGuard");
  });
});
