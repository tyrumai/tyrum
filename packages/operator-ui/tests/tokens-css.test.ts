import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tokens.css", () => {
  it("does not declare an unbundled primary font family", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/tokens.css"), "utf8");
    const fontSansLine = css
      .split("\n")
      .find((line) => line.trimStart().startsWith("--font-sans:"));

    expect(fontSansLine).toBeDefined();
    expect(fontSansLine).not.toContain('"Outfit"');
  });
});
