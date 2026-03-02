import { describe, expect, it } from "vitest";

describe("Operator UI app/page component structure", () => {
  it("exports each page from components/pages", async () => {
    const expected = [
      { specifier: "../src/components/pages/connect-page.js", exportName: "ConnectPage" },
      { specifier: "../src/components/pages/dashboard-page.js", exportName: "DashboardPage" },
      { specifier: "../src/components/pages/memory-page.js", exportName: "MemoryPage" },
      { specifier: "../src/components/pages/approvals-page.js", exportName: "ApprovalsPage" },
      { specifier: "../src/components/pages/runs-page.js", exportName: "RunsPage" },
      { specifier: "../src/components/pages/pairing-page.js", exportName: "PairingPage" },
      { specifier: "../src/components/pages/settings-page.js", exportName: "SettingsPage" },
      { specifier: "../src/components/pages/admin-page.js", exportName: "AdminPage" },
      { specifier: "../src/components/pages/desktop-page.js", exportName: "DesktopPage" },
    ] as const;

    for (const { specifier, exportName } of expected) {
      const mod = (await import(specifier)) as Record<string, unknown>;
      expect(mod[exportName]).toBeTypeOf("function");
    }
  });
});
