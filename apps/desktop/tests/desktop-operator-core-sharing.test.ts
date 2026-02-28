import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop operator-core sharing", () => {
  it("boots operator core once in App and shares it across Gateway + Memory pages", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");
    const gateway = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Gateway.tsx"),
      "utf-8",
    );
    const memory = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/Memory.tsx"),
      "utf-8",
    );

    expect(app).toContain("useDesktopOperatorCore");
    expect(gateway).not.toContain("useDesktopOperatorCore");
    expect(memory).not.toContain("useDesktopOperatorCore");
  });
});
