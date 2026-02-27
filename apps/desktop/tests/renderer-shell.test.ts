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

  it("uses system typography without runtime Google Fonts fetch", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).not.toContain("fonts.googleapis.com");
    expect(indexHtml).not.toContain("fonts.gstatic.com");
  });

  it("does not apply web-only custom scrollbar styling", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).not.toContain("::-webkit-scrollbar");
    expect(indexHtml).not.toContain("::-webkit-scrollbar-track");
    expect(indexHtml).not.toContain("::-webkit-scrollbar-thumb");
  });

  it("declares a supported color scheme for native control rendering", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).toContain("color-scheme: light dark");
  });
});
