import { describe, expect, it } from "vitest";
import { formatPlaywrightImportError } from "../../src/providers/backends/real-playwright-backend.js";

describe("formatPlaywrightImportError", () => {
  it("keeps the install hint for missing playwright packages", () => {
    expect(
      formatPlaywrightImportError(
        new Error("Cannot find package 'playwright' imported from /tmp/test.mjs"),
      ),
    ).toContain("Install with: pnpm add playwright");
  });

  it("surfaces non-missing runtime load failures without the install hint", () => {
    const message = formatPlaywrightImportError(
      new Error("__dirname is not defined in ES module scope"),
    );

    expect(message).toBe("Playwright failed to load: __dirname is not defined in ES module scope");
    expect(message).not.toContain("Install with: pnpm add playwright");
  });
});
