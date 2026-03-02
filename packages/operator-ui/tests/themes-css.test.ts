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
});
