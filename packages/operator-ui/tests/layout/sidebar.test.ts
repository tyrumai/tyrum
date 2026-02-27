// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { LayoutDashboard, ShieldCheck } from "lucide-react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Sidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders brand, nav items, connection indicator, and theme toggle", () => {
    const ThemeProvider = (operatorUi as Record<string, unknown>)["ThemeProvider"];
    const Sidebar = (operatorUi as Record<string, unknown>)["Sidebar"];

    expect(ThemeProvider).toBeDefined();
    expect(Sidebar).toBeDefined();

    const onNavigate = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(
        ThemeProvider as React.ComponentType,
        null,
        React.createElement(Sidebar as React.ComponentType, {
          items: [
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
            { id: "approvals", label: "Approvals", icon: ShieldCheck, testId: "nav-approvals" },
          ],
          activeItemId: "approvals",
          onNavigate,
          connectionStatus: "connected",
        }),
      ),
    );

    expect(container.textContent).toContain("Tyrum");
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Approvals");

    const active = container.querySelector("[data-testid='nav-approvals']");
    expect(active?.getAttribute("data-active")).toBe("true");

    expect(container.querySelector("[data-testid='connection-status-dot']")).not.toBeNull();
    expect(container.querySelector("[data-testid='theme-toggle']")).not.toBeNull();

    cleanupTestRoot({ container, root });
  });
});
