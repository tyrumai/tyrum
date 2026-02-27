import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer theme token usage", () => {
  it("does not hardcode sidebar foreground colors that break light mode readability", () => {
    const sidebar = readFileSync(
      join(import.meta.dirname, "../src/renderer/components/Sidebar.tsx"),
      "utf-8",
    );

    expect(sidebar).not.toContain('color: "#fff"');
    expect(sidebar).not.toContain('active ? "#fff"');
  });

  it("does not hardcode gateway error message color", () => {
    const gateway = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Gateway.tsx"),
      "utf-8",
    );

    expect(gateway).not.toContain("#fecaca");
  });
});
