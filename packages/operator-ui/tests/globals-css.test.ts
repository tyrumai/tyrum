import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("globals.css", () => {
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
});
