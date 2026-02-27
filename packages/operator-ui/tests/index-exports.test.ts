import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("@tyrum/operator-ui entry exports", () => {
  it("re-exports DialogHeaderProps and DialogFooterProps types", () => {
    const dts = readFileSync(join(process.cwd(), "packages/operator-ui/dist/index.d.mts"), "utf8");

    expect(dts).toContain("type DialogHeaderProps");
    expect(dts).toContain("type DialogFooterProps");
  });
});
