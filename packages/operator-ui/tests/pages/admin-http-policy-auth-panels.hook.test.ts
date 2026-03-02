import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AdminHttpPolicyAuthPanels", () => {
  it("uses useAdminMutationAccess instead of duplicating admin mode logic", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/operator-ui/src/components/pages/admin-http-policy-auth-panels.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("useAdminMutationAccess");
    expect(source).not.toContain("isAdminModeActive");
  });
});
