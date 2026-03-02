import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin page dead code", () => {
  it("does not keep legacy HTTP panels and contracts panel under pages/", () => {
    expect(
      existsSync(
        join(process.cwd(), "packages/operator-ui/src/components/pages/admin-http-panels.tsx"),
      ),
    ).toBe(false);

    expect(
      existsSync(
        join(process.cwd(), "packages/operator-ui/src/components/pages/admin-http-contracts.tsx"),
      ),
    ).toBe(false);
  });
});
