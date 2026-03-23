import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("globals.css", () => {
  it("imports Tailwind Preflight", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/globals.css"), "utf8");

    expect(css).toContain('@import "tailwindcss/preflight.css" layer(base);');
  });

  it("registers the Tailwind typography plugin", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/globals.css"), "utf8");

    expect(css).toContain('@plugin "@tailwindcss/typography";');
  });

  it("resets native chrome for plain text-entry controls", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/globals.css"), "utf8");

    expect(css).toContain("input:is(");
    expect(css).toContain('[type="text"]');
    expect(css).toContain('[type="password"]');
    expect(css).toContain('[type="url"]');
    expect(css).toContain("textarea {");
    expect(css).toContain("-webkit-appearance: none;");
    expect(css).toContain("background-color: transparent;");
  });

  it("respects prefers-reduced-motion for looping UI animations", () => {
    const css = readFileSync(join(process.cwd(), "packages/operator-ui/src/globals.css"), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("animation-iteration-count: 1 !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
    expect(css).toContain("scroll-behavior: auto !important;");
  });
});
