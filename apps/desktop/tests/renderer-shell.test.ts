import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer shell document", () => {
  it("resets outer page margin and overflow to avoid viewport scrollbars", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );
    expect(indexHtml).toContain("html, body, #root");
    expect(indexHtml).toContain("margin: 0");
    expect(indexHtml).toContain("overflow: hidden");
  });
});
