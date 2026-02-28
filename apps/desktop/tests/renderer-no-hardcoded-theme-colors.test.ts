import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer theme token usage", () => {
  it("removes the legacy desktop sidebar component", () => {
    expect(existsSync(join(import.meta.dirname, "../src/renderer/components/Sidebar.tsx"))).toBe(
      false,
    );
  });

  it("does not hardcode error message colors in Dashboard", () => {
    const dashboard = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Dashboard.tsx"),
      "utf-8",
    );

    expect(dashboard).not.toContain("#fecaca");
  });
});
