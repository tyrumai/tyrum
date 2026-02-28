import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Operator UI app/page component structure", () => {
  it("keeps app.tsx under 200 lines", () => {
    const appSource = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    const lines = appSource.split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(200);
  });

  it("exports each page from components/pages", async () => {
    const expected = [
      { specifier: "../src/components/pages/connect-page.js", exportName: "ConnectPage" },
      { specifier: "../src/components/pages/dashboard-page.js", exportName: "DashboardPage" },
      { specifier: "../src/components/pages/memory-page.js", exportName: "MemoryPage" },
      { specifier: "../src/components/pages/approvals-page.js", exportName: "ApprovalsPage" },
      { specifier: "../src/components/pages/runs-page.js", exportName: "RunsPage" },
      { specifier: "../src/components/pages/pairing-page.js", exportName: "PairingPage" },
      { specifier: "../src/components/pages/settings-page.js", exportName: "SettingsPage" },
      { specifier: "../src/components/pages/desktop-page.js", exportName: "DesktopPage" },
    ] as const;

    for (const { specifier, exportName } of expected) {
      const mod = (await import(specifier)) as Record<string, unknown>;
      expect(mod[exportName]).toBeTypeOf("function");
    }
  });
});
