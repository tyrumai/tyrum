import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("themes.css", () => {
  it("keeps --tyrum-color-bg opaque across theme modes", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/themes.css"), "utf8");
    const backgroundValues = Array.from(css.matchAll(/--tyrum-color-bg:\s*([^;]+);/g)).map(
      (match) => match[1].trim(),
    );

    expect(backgroundValues.length).toBeGreaterThanOrEqual(3);
    for (const value of backgroundValues) {
      expect(value).not.toBe("transparent");
    }
  });

  it("uses a flat application background instead of gradients", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/themes.css"), "utf8");
    const backgroundImages = Array.from(css.matchAll(/--tyrum-app-bg-image:\s*([^;]+);/g)).map(
      (match) => match[1].trim(),
    );

    expect(backgroundImages.length).toBeGreaterThanOrEqual(3);
    expect(backgroundImages.every((value) => value === "none")).toBe(true);
    expect(css).not.toContain("linear-gradient");
    expect(css).not.toContain("radial-gradient");
  });
});
