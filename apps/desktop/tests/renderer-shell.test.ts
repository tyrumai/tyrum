import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer shell document", () => {
  function listFilesRecursive(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFilesRecursive(path));
        continue;
      }
      files.push(path);
    }
    return files;
  }

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

  it("does not pull Google Fonts from imported operator-ui styles", () => {
    const operatorUiGlobalsCss = readFileSync(
      join(import.meta.dirname, "../../../packages/operator-ui/src/globals.css"),
      "utf-8",
    );

    expect(operatorUiGlobalsCss).not.toContain("fonts.googleapis.com");
    expect(operatorUiGlobalsCss).not.toContain("fonts.gstatic.com");
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

    expect(indexHtml).toMatch(/color-scheme\s*:\s*light\s+dark/);
  });

  it("applies theme CSS variables for page background and selection colors", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).toContain("var(--tyrum-color-bg");
    expect(indexHtml).toContain("var(--tyrum-color-fg");
    expect(indexHtml).toContain("var(--tyrum-color-selection");
  });

  it("adds focus-visible styles so keyboard navigation has a visible focus ring", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).toContain(":focus-visible");
    expect(indexHtml).toContain("outline");
    expect(indexHtml).toContain("var(--tyrum-color-focus-ring");
  });

  it("respects prefers-reduced-motion to avoid unexpected animations", () => {
    const indexHtml = readFileSync(
      join(import.meta.dirname, "../src/renderer/index.html"),
      "utf-8",
    );

    expect(indexHtml).toContain("prefers-reduced-motion");
  });

  it("does not include web-only font or scrollbar overrides anywhere in renderer sources", () => {
    const rendererDir = join(import.meta.dirname, "../src/renderer");
    const rendererFiles = listFilesRecursive(rendererDir);

    for (const file of rendererFiles) {
      const contents = readFileSync(file, "utf-8");
      expect(contents).not.toContain("fonts.googleapis.com");
      expect(contents).not.toContain("fonts.gstatic.com");
      expect(contents).not.toContain("::-webkit-scrollbar");
    }
  });
});
