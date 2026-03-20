import { describe, expect, it } from "vitest";
import { OPERATOR_ROUTE_DEFINITIONS } from "../src/operator-routes.js";

const TEST_TIMEOUT_MS = 15_000;

describe("Operator UI app/page component structure", () => {
  it(
    "exports each page from components/pages",
    async () => {
      const expected = [
        { specifier: "../src/components/pages/connect-page.js", exportName: "ConnectPage" },
        { specifier: "../src/components/pages/dashboard-page.js", exportName: "DashboardPage" },
        { specifier: "../src/components/pages/chat-page-ai-sdk.js", exportName: "AiSdkChatPage" },
        { specifier: "../src/components/pages/approvals-page.js", exportName: "ApprovalsPage" },
        { specifier: "../src/components/pages/runs-page.js", exportName: "RunsPage" },
        { specifier: "../src/components/pages/workboard-page.js", exportName: "WorkBoardPage" },
        { specifier: "../src/components/pages/agents-page.js", exportName: "AgentsPage" },
        { specifier: "../src/components/pages/extensions-page.js", exportName: "ExtensionsPage" },
        { specifier: "../src/components/pages/memory-page.js", exportName: "MemoryPage" },
        { specifier: "../src/components/pages/pairing-page.js", exportName: "PairingPage" },
        {
          specifier: "../src/components/pages/desktop-environments-page.js",
          exportName: "DesktopEnvironmentsPage",
        },
        {
          specifier: "../src/components/pages/node-config/node-config-page.js",
          exportName: "NodeConfigPage",
        },
        { specifier: "../src/components/pages/settings-page.js", exportName: "SettingsPage" },
        { specifier: "../src/components/pages/configure-page.js", exportName: "ConfigurePage" },
      ] as const;

      for (const { specifier, exportName } of expected) {
        const mod = (await import(specifier)) as Record<string, unknown>;
        expect(mod[exportName]).toBeTypeOf("function");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("keeps the PR 1124 primary navigation shape in the shared route table", () => {
    const sidebarShortcutIds = OPERATOR_ROUTE_DEFINITIONS.filter(
      (route) => route.navGroup === "sidebar" && route.shortcut,
    ).map((route) => route.id);

    expect(sidebarShortcutIds).toEqual([
      "dashboard",
      "chat",
      "approvals",
      "workboard",
      "agents",
      "extensions",
      "memory",
      "pairing",
      "configure",
    ]);
  });
});
