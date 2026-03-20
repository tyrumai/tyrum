import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readAllPaletteCss(): string {
  const themesDir = join(process.cwd(), "packages/operator-ui/src/themes");
  const files = readdirSync(themesDir)
    .filter((f) => f.endsWith(".css"))
    .toSorted();
  return files.map((f) => readFileSync(join(themesDir, f), "utf8")).join("\n");
}

describe("themes.css", () => {
  it("keeps --tyrum-color-bg opaque across all palettes and modes", () => {
    const css = readAllPaletteCss();
    const backgroundValues = Array.from(css.matchAll(/--tyrum-color-bg:\s*([^;]+);/g)).map(
      (match) => match[1].trim(),
    );

    // At least 3 blocks per palette (dark + light + system-light) across 5 palettes.
    expect(backgroundValues.length).toBeGreaterThanOrEqual(15);
    for (const value of backgroundValues) {
      expect(value).not.toBe("transparent");
    }
  });

  it("uses a flat application background instead of gradients", () => {
    const css = readAllPaletteCss();
    const backgroundImages = Array.from(css.matchAll(/--tyrum-app-bg-image:\s*([^;]+);/g)).map(
      (match) => match[1].trim(),
    );

    expect(backgroundImages.length).toBeGreaterThanOrEqual(15);
    expect(backgroundImages.every((value) => value === "none")).toBe(true);
    expect(css).not.toContain("linear-gradient");
    expect(css).not.toContain("radial-gradient");
  });

  it("defines all required variables in every palette file", () => {
    const themesDir = join(process.cwd(), "packages/operator-ui/src/themes");
    const files = readdirSync(themesDir)
      .filter((f) => f.endsWith(".css"))
      .toSorted();

    const requiredVars = [
      "--tyrum-color-bg",
      "--tyrum-app-bg-image",
      "--tyrum-color-bg-subtle",
      "--tyrum-color-bg-card",
      "--tyrum-color-fg",
      "--tyrum-color-fg-muted",
      "--tyrum-color-border",
      "--tyrum-color-primary",
      "--tyrum-color-primary-dim",
      "--tyrum-color-success",
      "--tyrum-color-warning",
      "--tyrum-color-error",
      "--tyrum-color-neutral",
      "--tyrum-color-focus-ring",
      "--tyrum-color-selection",
    ];

    for (const file of files) {
      const css = readFileSync(join(themesDir, file), "utf8");
      for (const varName of requiredVars) {
        const pattern = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
        expect(pattern.test(css), `${file} must define ${varName}`).toBe(true);
      }
    }
  });
});
